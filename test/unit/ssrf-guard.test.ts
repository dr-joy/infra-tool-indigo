// safeRedmineFetch/buildRedmineUrl (server/lib/ssrf-guard.ts) — CR-20260913 Lát 5 (FR-44). File này
// (260 dòng) chưa có test nào trước lượt sửa này (xác nhận bằng grep toàn bộ test/ trước khi viết) —
// vi phạm "AC âm bắt buộc" của CR (dòng ~1783: "Redmine trả redirect hoặc DNS đổi giữa lúc kiểm
// tra/kết nối (rebinding) đều bị chặn"), phát hiện ở Council review vòng 1 Lát 5.
//
// Cách mock: ssrf-guard.ts dùng `https.request` (không phải `fetch`) chính vì cần tự truyền option
// `lookup` để ghim IP đã kiểm — nên test cũng phải mock đúng ở tầng đó, không mock `fetch`. Dùng
// `mock.module()` của node:test (cần cờ --experimental-test-module-mocks, đã thêm vào script
// `test:server` trong package.json) để thay `node:https` (hàm request) và `node:dns/promises`
// (resolve4/resolve6) — named import trực tiếp (`import { resolve4 } from 'node:dns/promises'`)
// KHÔNG monkeypatch được (đã tự kiểm chứng: gán lại property trên module namespace ném
// "Cannot assign to read only property"; và gán lên default-export object không phản ánh sang named
// import ở module khác) — chỉ `mock.module()` mới thay được named export cho named-import khác module.
//
// Mỗi test tự `mock.module()` rồi `finally { .restore() }`, và tự import LẠI ssrf-guard.ts với query
// string tăng dần (`?t=N`) để né ES module cache — vì mock chỉ có hiệu lực cho lần import kế tiếp của
// module đó, và module dưới test giữ state module-level (semaphore in-flight) nên mỗi test cũng nên
// có instance sạch.
import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { HttpError } from '../../server/lib/utils.js';

let importCounter = 0;
async function freshImport() {
  importCounter += 1;
  return import(`../../server/lib/ssrf-guard.js?t=${importCounter}`);
}

type FakeResponse = EventEmitter & { statusCode: number; destroy: () => void };
type FakeRequest = EventEmitter & { destroy: () => void; end: () => void };

// Giả lập https.request đủ để chạy hết luồng thật của safeRedmineFetch: bắn 'socket' rồi 'connect'
// (để connectTimer bị huỷ ngay, không phải chờ timeout thật 5s), gọi response callback, rồi bắn
// data/end. Không giả timeout/error trừ khi scenario cần.
function fakeRequestFactory(opts: { statusCode?: number; bodyChunks?: Buffer[]; captureOptions?: (o: unknown) => void }) {
  const { statusCode = 200, bodyChunks = [Buffer.from('{}')], captureOptions } = opts;
  return function fakeRequest(requestOptions: unknown, responseCallback: (res: FakeResponse) => void): FakeRequest {
    captureOptions?.(requestOptions);
    const req = new EventEmitter() as FakeRequest;
    req.destroy = () => {};
    req.end = () => {
      process.nextTick(() => {
        const socket = new EventEmitter();
        req.emit('socket', socket);
        socket.emit('connect');
        process.nextTick(() => {
          const res = new EventEmitter() as FakeResponse;
          res.statusCode = statusCode;
          res.destroy = () => {};
          responseCallback(res);
          process.nextTick(() => {
            for (const chunk of bodyChunks) res.emit('data', chunk);
            res.emit('end');
          });
        });
      });
    };
    return req;
  };
}

// ── Ca thuận (FR-44, nhãn con truy vết trong CR) — gọi Redmine hợp lệ trả đúng dữ liệu ────────────
test('ca thuận: hostname resolve ra IP công khai, Redmine trả 200 -> pass qua bình thường', async () => {
  const dnsMock = mock.module('node:dns/promises', {
    namedExports: { resolve4: async () => ['93.184.216.34'], resolve6: async () => [] }
  });
  const httpsMock = mock.module('node:https', {
    defaultExport: { request: fakeRequestFactory({ statusCode: 200, bodyChunks: [Buffer.from('{"user":{"id":1}}')] }) }
  });
  try {
    const { safeRedmineFetch, buildRedmineUrl } = await freshImport();
    const target = buildRedmineUrl('https://redmine.example.com', '/users/current.json');
    const result = await safeRedmineFetch(target, { actorUserId: 1, requestId: 'ok-1' });
    assert.equal(result.status, 200);
    assert.equal(result.bodyText, '{"user":{"id":1}}');
  } finally {
    dnsMock.restore();
    httpsMock.restore();
  }
});

// ── AC âm bắt buộc: "Redmine trả redirect ... đều bị chặn" ─────────────────────────────────────────
for (const statusCode of [301, 302, 307]) {
  test(`AC âm: Redmine trả redirect ${statusCode} -> bị từ chối, KHÔNG tự follow`, async () => {
    const dnsMock = mock.module('node:dns/promises', {
      namedExports: { resolve4: async () => ['93.184.216.34'], resolve6: async () => [] }
    });
    const httpsMock = mock.module('node:https', { defaultExport: { request: fakeRequestFactory({ statusCode }) } });
    try {
      const { safeRedmineFetch, buildRedmineUrl } = await freshImport();
      const target = buildRedmineUrl('https://redmine.example.com', '/x');
      await assert.rejects(
        () => safeRedmineFetch(target, { actorUserId: 2, requestId: `redir-${statusCode}` }),
        (err: unknown) => {
          assert.ok(err instanceof HttpError);
          assert.equal(err.code, 'SSRF_BLOCKED');
          assert.match(err.message, /redirect/i);
          return true;
        }
      );
    } finally {
      dnsMock.restore();
      httpsMock.restore();
    }
  });
}

// ── AC âm bắt buộc: IP private/loopback bị chặn thẳng (đơn giản, không qua rebinding) ──────────────
test('AC âm: URL dùng thẳng IP loopback (127.0.0.1) làm hostname -> bị chặn ngay, không cần DNS', async () => {
  // Không mock resolve4/resolve6: nhánh isIPv4(hostname) trong resolveAndValidate() không gọi DNS,
  // nên nếu code lỡ gọi resolve4/resolve6 thật ở đây test sẽ tự lộ ra (không mock = gọi thật sẽ có
  // khả năng lỗi/treo khác với kỳ vọng "chặn ngay lập tức").
  const httpsMock = mock.module('node:https', { defaultExport: { request: fakeRequestFactory({ statusCode: 200 }) } });
  try {
    const { safeRedmineFetch, buildRedmineUrl } = await freshImport();
    const target = buildRedmineUrl('https://127.0.0.1', '/x');
    await assert.rejects(
      () => safeRedmineFetch(target, { actorUserId: 3, requestId: 'loopback-1' }),
      (err: unknown) => {
        assert.ok(err instanceof HttpError);
        assert.equal(err.code, 'SSRF_BLOCKED');
        assert.match(err.message, /nội bộ|không hợp lệ/i);
        return true;
      }
    );
  } finally {
    httpsMock.restore();
  }
});

test('AC âm: hostname resolve ra dải private (10.0.0.0/8) qua DNS -> bị chặn', async () => {
  const dnsMock = mock.module('node:dns/promises', {
    namedExports: { resolve4: async () => ['10.1.2.3'], resolve6: async () => [] }
  });
  const httpsMock = mock.module('node:https', { defaultExport: { request: fakeRequestFactory({ statusCode: 200 }) } });
  try {
    const { safeRedmineFetch, buildRedmineUrl } = await freshImport();
    const target = buildRedmineUrl('https://redmine.internal.example.com', '/x');
    await assert.rejects(
      () => safeRedmineFetch(target, { actorUserId: 4, requestId: 'private-dns-1' }),
      (err: unknown) => {
        assert.ok(err instanceof HttpError);
        assert.equal(err.code, 'SSRF_BLOCKED');
        return true;
      }
    );
  } finally {
    dnsMock.restore();
    httpsMock.restore();
  }
});

// ── AC âm bắt buộc: "DNS đổi giữa lúc kiểm tra/kết nối (rebinding) đều bị chặn" ─────────────────────
// Kịch bản thật: request đầu resolve ra IP công khai (qua kiểm), nhưng nếu code tự resolve LẠI lúc mở
// socket (gọi dns.lookup hệ thống lần 2) thì có thể ăn đúng bản ghi đã bị đổi sang IP private giữa hai
// lần đó. ssrf-guard.ts né bằng cách GHIM sẵn địa chỉ đã kiểm qua option `lookup` riêng của
// https.request (dòng ~169-181) — không bao giờ để module https/net tự gọi lại dns.lookup thật.
// Test dựng "DNS bị rebind" bằng cách mock node:dns (không phải node:dns/promises) trả về IP private
// nếu bị gọi, rồi xác nhận: (a) `requestOptions.lookup` khi được gọi (giả lập đúng việc net module làm
// lúc mở socket) luôn trả về ĐÚNG IP công khai đã resolve ban đầu; (b) hàm dns.lookup hệ thống (đã
// "nhiễm độc" trả IP private) KHÔNG hề được gọi — chứng minh không có lần resolve thứ hai nào.
test('AC âm: DNS rebinding — lookup ghim đúng IP đã kiểm ban đầu, không tự resolve lại qua dns.lookup hệ thống', async () => {
  const poisonedLookup = mock.fn((_host: string, _opts: unknown, cb: (e: Error | null, address: string, family: number) => void) => {
    cb(null, '10.0.0.5', 4); // giả lập: nếu bị gọi, DNS "đã rebind" sẽ trả IP private
  });
  const dnsLookupMock = mock.module('node:dns', { namedExports: { lookup: poisonedLookup } });
  const dnsPromisesMock = mock.module('node:dns/promises', {
    namedExports: { resolve4: async () => ['93.184.216.34'], resolve6: async () => [] }
  });
  let capturedLookup: ((host: string, opts: unknown, cb: (e: Error | null, address: string, family: number) => void) => void) | undefined;
  const httpsMock = mock.module('node:https', {
    defaultExport: {
      request: fakeRequestFactory({
        statusCode: 200,
        captureOptions: (o) => { capturedLookup = (o as { lookup?: typeof capturedLookup }).lookup; }
      })
    }
  });
  try {
    const { safeRedmineFetch, buildRedmineUrl } = await freshImport();
    const target = buildRedmineUrl('https://redmine.example.com', '/x');
    await safeRedmineFetch(target, { actorUserId: 9, requestId: 'rebind-1' });

    assert.ok(capturedLookup, 'requestOptions.lookup phải được truyền cho https.request');
    const [, address] = await new Promise<[Error | null, string, number]>((resolve) => {
      capturedLookup!('redmine.example.com', {}, (e, a, f) => resolve([e, a, f]));
    });
    assert.equal(address, '93.184.216.34', 'phải dùng IP đã ghim từ lúc kiểm (resolveAndValidate), không phải IP rebind sau đó');
    assert.equal(poisonedLookup.mock.calls.length, 0, 'không được gọi lại dns.lookup hệ thống lúc mở socket — đó chính là chỗ hở rebinding');
  } finally {
    dnsLookupMock.restore();
    dnsPromisesMock.restore();
    httpsMock.restore();
  }
});
