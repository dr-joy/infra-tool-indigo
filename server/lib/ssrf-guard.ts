import { BlockList, isIPv4, isIPv6 } from 'node:net';
import { resolve4, resolve6 } from 'node:dns/promises';
import https, { type RequestOptions } from 'node:https';
import { HttpError } from './utils.js';

// CR-20260913 Lát 5 (FR-44) — chống SSRF khi App tự gọi ra Redmine, kể cả khi URL do Admin cấu hình.
// Đúng 11 quy tắc chốt kỹ thuật 19/09 (Council 74715c65, CR §Nhóm D FR-44). Dùng `https.request` (KHÔNG
// dùng `fetch` toàn cục) vì cần override DNS lookup ở đúng lúc mở socket (quy tắc 6) và vì `fetch` mặc
// định tự theo redirect (quy tắc 7) — `https.request` không bao giờ tự theo redirect, dễ kiểm soát hơn.

// ── Quy tắc 3: allowlist cổng là HẰNG SỐ trong code, không phải cấu hình Admin ─────────────────────
const ALLOWED_PORTS = new Set<number>([443]);

// ── Quy tắc 5: ngoại lệ mạng nội bộ là allowlist HẠ TẦNG cố định (biến môi trường lúc triển khai),
// KHÔNG phải quyền Admin tự tạo qua UI. Rỗng theo mặc định.
const INFRA_HOSTNAME_ALLOWLIST = new Set(
  (process.env.REDMINE_INTERNAL_HOSTNAME_ALLOWLIST || '')
    .split(',')
    .map((h) => h.trim().toLowerCase())
    .filter(Boolean)
);

// ── Quy tắc 4: chặn loopback/private/link-local/unspecified/multicast/reserved (cả A lẫn AAAA) ─────
const PRIVATE_BLOCKLIST = new BlockList();
// IPv4
PRIVATE_BLOCKLIST.addSubnet('0.0.0.0', 8, 'ipv4');
PRIVATE_BLOCKLIST.addSubnet('10.0.0.0', 8, 'ipv4');
PRIVATE_BLOCKLIST.addSubnet('100.64.0.0', 10, 'ipv4');
PRIVATE_BLOCKLIST.addSubnet('127.0.0.0', 8, 'ipv4');
PRIVATE_BLOCKLIST.addSubnet('169.254.0.0', 16, 'ipv4');
PRIVATE_BLOCKLIST.addSubnet('172.16.0.0', 12, 'ipv4');
PRIVATE_BLOCKLIST.addSubnet('192.0.0.0', 24, 'ipv4');
PRIVATE_BLOCKLIST.addSubnet('192.0.2.0', 24, 'ipv4');
PRIVATE_BLOCKLIST.addSubnet('192.88.99.0', 24, 'ipv4');
PRIVATE_BLOCKLIST.addSubnet('192.168.0.0', 16, 'ipv4');
PRIVATE_BLOCKLIST.addSubnet('198.18.0.0', 15, 'ipv4');
PRIVATE_BLOCKLIST.addSubnet('198.51.100.0', 24, 'ipv4');
PRIVATE_BLOCKLIST.addSubnet('203.0.113.0', 24, 'ipv4');
PRIVATE_BLOCKLIST.addSubnet('224.0.0.0', 4, 'ipv4'); // multicast
PRIVATE_BLOCKLIST.addSubnet('240.0.0.0', 4, 'ipv4'); // reserved (kể cả 255.255.255.255)
// IPv6 (BlockList tự xử lý địa chỉ IPv4-mapped ::ffff:a.b.c.d khớp với subnet IPv4 ở trên)
PRIVATE_BLOCKLIST.addAddress('::1', 'ipv6'); // loopback
PRIVATE_BLOCKLIST.addAddress('::', 'ipv6'); // unspecified
PRIVATE_BLOCKLIST.addSubnet('fc00::', 7, 'ipv6'); // unique local (private)
PRIVATE_BLOCKLIST.addSubnet('fe80::', 10, 'ipv6'); // link-local
PRIVATE_BLOCKLIST.addSubnet('ff00::', 8, 'ipv6'); // multicast
PRIVATE_BLOCKLIST.addSubnet('2001:db8::', 32, 'ipv6'); // documentation
PRIVATE_BLOCKLIST.addSubnet('64:ff9b::', 96, 'ipv6'); // NAT64 (có thể lộ IPv4 nội bộ bên trong)

function isSafeAddress(address: string): boolean {
  if (isIPv4(address)) return !PRIVATE_BLOCKLIST.check(address, 'ipv4');
  if (isIPv6(address)) return !PRIVATE_BLOCKLIST.check(address, 'ipv6');
  return false;
}

async function resolveAndValidate(hostname: string): Promise<string[]> {
  if (isIPv4(hostname) || isIPv6(hostname)) {
    // URL dùng thẳng IP literal — vẫn phải qua đúng kiểm tra như hostname.
    if (!isSafeAddress(hostname)) throw new HttpError(400, 'Địa chỉ IP Redmine thuộc dải nội bộ/không hợp lệ — bị chặn (chống SSRF)', 'SSRF_BLOCKED');
    return [hostname];
  }
  const [v4, v6] = await Promise.all([
    resolve4(hostname).catch(() => [] as string[]),
    resolve6(hostname).catch(() => [] as string[])
  ]);
  const all = [...v4, ...v6];
  if (all.length === 0) throw new HttpError(502, 'Không phân giải được tên miền Redmine (DNS)', 'REDMINE_DNS_FAILED');
  // Quy tắc 4: BẤT KỲ đáp án nào không an toàn -> chặn CẢ YÊU CẦU, không chỉ lọc bớt.
  for (const addr of all) {
    if (!isSafeAddress(addr)) {
      throw new HttpError(400, 'Tên miền Redmine phân giải ra địa chỉ IP nội bộ/không hợp lệ — bị chặn (chống SSRF)', 'SSRF_BLOCKED');
    }
  }
  return all;
}

// ── Quy tắc 10: semaphore theo user + toàn app, đơn giản (in-memory, 1 tiến trình) ─────────────────
const MAX_PER_USER_INFLIGHT = 2;
const MAX_GLOBAL_INFLIGHT = 8;
const perUserInFlight = new Map<number, number>();
let globalInFlight = 0;

function acquireSlot(userId: number): () => void {
  const current = perUserInFlight.get(userId) || 0;
  if (globalInFlight >= MAX_GLOBAL_INFLIGHT || current >= MAX_PER_USER_INFLIGHT) {
    const err = new HttpError(429, 'Quá nhiều yêu cầu gọi Redmine cùng lúc, vui lòng thử lại sau', 'REDMINE_RATE_LIMITED');
    (err as HttpError & { retryAfterSeconds?: number }).retryAfterSeconds = 2;
    throw err;
  }
  perUserInFlight.set(userId, current + 1);
  globalInFlight += 1;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    globalInFlight -= 1;
    const n = (perUserInFlight.get(userId) || 1) - 1;
    if (n <= 0) perUserInFlight.delete(userId);
    else perUserInFlight.set(userId, n);
  };
}

// ── Quy tắc 9: timeout riêng connect/headers/body/tổng; Quy tắc 9b: trần byte đọc streaming ────────
const CONNECT_TIMEOUT_MS = 5_000;
const HEADERS_TIMEOUT_MS = 8_000;
const BODY_TIMEOUT_MS = 8_000;
const TOTAL_TIMEOUT_MS = 15_000;
const MAX_RESPONSE_BYTES = 5 * 1024 * 1024; // 5MB — đủ cho JSON trả lời của Redmine

export interface SafeRedmineFetchOptions {
  method?: 'GET' | 'POST';
  headers?: Record<string, string>;
  actorUserId: number;
  requestId: string;
}

export interface SafeRedmineFetchResult {
  status: number;
  bodyText: string;
}

// Quy tắc 8: caller PHẢI ghép path bằng new URL() — không nhận path tuỳ ý dạng chuỗi nối thô.
export function buildRedmineUrl(baseUrl: string, fixedPath: string): URL {
  return new URL(fixedPath, baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`);
}

export async function safeRedmineFetch(target: URL, options: SafeRedmineFetchOptions): Promise<SafeRedmineFetchResult> {
  const startedAt = Date.now();
  const log = (status: string, extra?: Record<string, unknown>) => {
    // Quy tắc 11: log CHỈ gồm request id/actor/hostname/thao tác/trạng thái/thời gian — KHÔNG bao giờ
    // log header API key hay body.
    console.log('[redmine-ssrf]', {
      requestId: options.requestId,
      actorUserId: options.actorUserId,
      hostname: target.hostname,
      method: options.method || 'GET',
      status,
      durationMs: Date.now() - startedAt,
      ...extra
    });
  };

  // Quy tắc 1: chỉ https:
  if (target.protocol !== 'https:') { log('rejected_protocol'); throw new HttpError(400, 'Chỉ chấp nhận URL Redmine https://', 'SSRF_BLOCKED'); }
  // Quy tắc 2: cấm username/password/fragment; hostname đã được IDNA-hoá bởi chính new URL().
  if (target.username || target.password) { log('rejected_userinfo'); throw new HttpError(400, 'URL Redmine không được chứa username/password', 'SSRF_BLOCKED'); }
  if (target.hash) { log('rejected_fragment'); throw new HttpError(400, 'URL Redmine không được chứa fragment (#...)', 'SSRF_BLOCKED'); }
  // Quy tắc 3: cổng phải trong allowlist hằng số (cổng mặc định https rỗng = 443, hợp lệ).
  const port = target.port ? Number(target.port) : 443;
  if (!ALLOWED_PORTS.has(port)) { log('rejected_port'); throw new HttpError(400, `Cổng ${port} không được phép gọi Redmine`, 'SSRF_BLOCKED'); }

  const release = acquireSlot(options.actorUserId);
  try {
    const hostname = target.hostname.toLowerCase();
    let addresses: string[];
    if (INFRA_HOSTNAME_ALLOWLIST.has(hostname)) {
      // Quy tắc 5: ngoại lệ hạ tầng cố định theo hostname (biến môi trường triển khai) — vẫn resolve
      // để có IP thật cho bước ghim kết nối, nhưng bỏ qua bước chặn dải private (đây chính là dải nội
      // bộ nơi Redmine thật đang chạy).
      const [v4, v6] = await Promise.all([resolve4(hostname).catch(() => []), resolve6(hostname).catch(() => [])]);
      addresses = [...v4, ...v6];
      if (addresses.length === 0) { log('dns_failed'); throw new HttpError(502, 'Không phân giải được tên miền Redmine (DNS)', 'REDMINE_DNS_FAILED'); }
    } else {
      addresses = await resolveAndValidate(hostname);
    }
    const pinnedAddress = addresses[0];
    const pinnedFamily = isIPv6(pinnedAddress) ? 6 : 4;

    // Quy tắc 6: kết nối tới ĐÚNG IP đã kiểm qua `lookup` riêng — KHÔNG để https module tự resolve lại
    // (đó là chỗ hở DNS rebinding: kiểm 1 lần rồi resolve lại lần 2 có thể ra IP khác). `hostname` gốc
    // vẫn được giữ nguyên cho request options -> Host header + TLS SNI đúng, chỉ có bước MỞ SOCKET là
    // bị ép dùng địa chỉ đã kiểm.
    const requestOptions: RequestOptions = {
      protocol: target.protocol,
      hostname: target.hostname,
      port,
      path: `${target.pathname}${target.search}`,
      method: options.method || 'GET',
      headers: options.headers,
      lookup: (_host, _opts, callback) => { callback(null, pinnedAddress, pinnedFamily); },
      timeout: CONNECT_TIMEOUT_MS
    };

    const result = await new Promise<SafeRedmineFetchResult>((resolvePromise, rejectPromise) => {
      let settled = false;
      const finish = (fn: () => void) => { if (settled) return; settled = true; fn(); };

      const totalTimer = setTimeout(() => {
        finish(() => { req.destroy(); rejectPromise(new HttpError(504, 'Gọi Redmine quá thời gian cho phép (tổng)', 'REDMINE_TIMEOUT')); });
      }, TOTAL_TIMEOUT_MS);

      let connectTimer: ReturnType<typeof setTimeout> | null = setTimeout(() => {
        finish(() => { req.destroy(); rejectPromise(new HttpError(504, 'Kết nối Redmine quá thời gian cho phép', 'REDMINE_TIMEOUT')); });
      }, CONNECT_TIMEOUT_MS);
      let headersTimer: ReturnType<typeof setTimeout> | null = null;

      const req = https.request(requestOptions, (res) => {
        if (headersTimer) { clearTimeout(headersTimer); headersTimer = null; }
        // Quy tắc 7: CẤM mọi redirect — https.request không tự theo, chỉ cần từ chối tường minh ở đây.
        if (res.statusCode != null && res.statusCode >= 300 && res.statusCode < 400) {
          finish(() => { clearTimeout(totalTimer); res.destroy(); rejectPromise(new HttpError(502, 'Redmine trả về redirect — không được chấp nhận', 'SSRF_BLOCKED')); });
          return;
        }
        const bodyTimer = setTimeout(() => {
          finish(() => { clearTimeout(totalTimer); res.destroy(); rejectPromise(new HttpError(504, 'Đọc phản hồi Redmine quá thời gian cho phép', 'REDMINE_TIMEOUT')); });
        }, BODY_TIMEOUT_MS);

        const chunks: Buffer[] = [];
        let total = 0;
        res.on('data', (chunk: Buffer) => {
          total += chunk.length;
          if (total > MAX_RESPONSE_BYTES) {
            finish(() => { clearTimeout(bodyTimer); clearTimeout(totalTimer); res.destroy(); rejectPromise(new HttpError(502, 'Phản hồi Redmine vượt giới hạn cho phép', 'SSRF_BLOCKED')); });
            return;
          }
          chunks.push(chunk);
        });
        res.on('end', () => {
          finish(() => {
            clearTimeout(bodyTimer);
            clearTimeout(totalTimer);
            resolvePromise({ status: res.statusCode || 0, bodyText: Buffer.concat(chunks).toString('utf8') });
          });
        });
        res.on('error', (err) => {
          finish(() => { clearTimeout(bodyTimer); clearTimeout(totalTimer); rejectPromise(err); });
        });
      });
      req.on('socket', (socket) => {
        socket.once('connect', () => {
          if (connectTimer) { clearTimeout(connectTimer); connectTimer = null; }
          // Sau khi kết nối xong, đổi sang đếm thời gian chờ HEADER riêng (quy tắc 9).
          headersTimer = setTimeout(() => {
            finish(() => { clearTimeout(totalTimer); req.destroy(); rejectPromise(new HttpError(504, 'Chờ header phản hồi Redmine quá thời gian cho phép', 'REDMINE_TIMEOUT')); });
          }, HEADERS_TIMEOUT_MS);
        });
      });
      req.on('timeout', () => {
        finish(() => { clearTimeout(totalTimer); req.destroy(); rejectPromise(new HttpError(504, 'Kết nối Redmine quá thời gian cho phép', 'REDMINE_TIMEOUT')); });
      });
      req.on('error', (err) => {
        finish(() => {
          clearTimeout(totalTimer);
          if (connectTimer) clearTimeout(connectTimer);
          if (headersTimer) clearTimeout(headersTimer);
          rejectPromise(err instanceof Error ? err : new Error(String(err)));
        });
      });
      req.end();
    });

    log('ok', { httpStatus: result.status });
    return result;
  } catch (error) {
    log('error', { message: error instanceof Error ? error.message : String(error) });
    throw error;
  } finally {
    release();
  }
}
