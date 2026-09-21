#!/usr/bin/env node
// CỔNG CHẤT LƯỢNG chạy tại máy — bản thay thế cho CI (xem ADR-P2 trong
// docs/standards/team-operating-standard.md).
//
// Gom MỌI mục của Definition of Done mà MÁY kiểm được vào MỘT lệnh: `npm run check`.
// Lý do tồn tại: DoD có 5-6 mục máy kiểm được, nằm rải ở 4 chuẩn khác nhau. Bắt người
// nhớ đủ 6 lệnh là cách chắc chắn để một lệnh bị bỏ quên lúc vội.
//
// Mục nào máy KHÔNG kiểm được (soi diff, smoke thủ công, AC đạt chưa, test đỏ trước khi
// sửa bug) thì vẫn là việc của người — xem qa-standard §9.

import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const BUDGET_BUNDLE_KB = 508;

const buoc = [];
let hong = 0;

function chay(ten, lenh, opts = {}) {
  process.stdout.write(`\n▶ ${ten}\n`);
  try {
    execSync(lenh, { cwd: root, stdio: opts.im ? 'pipe' : 'inherit' });
    buoc.push(['✔', ten]);
    return true;
  } catch {
    buoc.push(['✖', ten]);
    hong++;
    return false;
  }
}

function kiem(ten, fn) {
  process.stdout.write(`\n▶ ${ten}\n`);
  try {
    const canhBao = fn();
    buoc.push([canhBao ? '!' : '✔', ten]);
  } catch (e) {
    console.error(`  ${e.message}`);
    buoc.push(['✖', ten]);
    hong++;
  }
}

// ── 1. Kiểu ──────────────────────────────────────────────────────────────────
chay('TypeScript (tsc --noEmit)', 'npx tsc --noEmit');

// ── 2. Test ──────────────────────────────────────────────────────────────────
chay('Test backend + frontend', 'npm test');

// ── 3. Build ─────────────────────────────────────────────────────────────────
chay('Build (vite)', 'npx vite build');

// ── 4. Ngân sách bundle (performance-standard §1) ────────────────────────────
kiem(`Ngân sách bundle chính (≤ ${BUDGET_BUNDLE_KB} kB)`, () => {
  const assets = path.join(root, 'dist', 'assets');
  if (!fs.existsSync(assets)) throw new Error('chưa có dist/assets — build thất bại?');
  const entry = fs.readdirSync(assets)
    .filter((f) => /^index-.*\.js$/.test(f))
    .map((f) => ({ f, kb: fs.statSync(path.join(assets, f)).size / 1024 }))
    .sort((a, b) => b.kb - a.kb)[0];
  if (!entry) throw new Error('không tìm thấy bundle entry index-*.js');
  const kb = entry.kb.toFixed(1);
  if (entry.kb > BUDGET_BUNDLE_KB) {
    throw new Error(`${entry.f} = ${kb} kB, VƯỢT budget ${BUDGET_BUNDLE_KB} kB.
    Xem performance-standard §2: dep mới? quên React.lazy? Vượt có lý do -> ghi vào commit message
    và nâng BUDGET_BUNDLE_KB trong scripts/check.mjs (đừng nâng lặng lẽ).`);
  }
  console.log(`  ${entry.f} = ${kb} kB / ${BUDGET_BUNDLE_KB} kB`);
});

// ── 5. Link tài liệu (docs-standard §8) ──────────────────────────────────────
chay('Link markdown', 'node scripts/check-links.mjs');

// ── 5b. Tài liệu khớp thực tế (docs-standard §4, §5 — bài học L-003) ─────────
chay('Tài liệu khớp thực tế', 'node scripts/check-docs.mjs');

// ── 5c. Gốc thời gian giờ VN (rules/07 §8.1 — bài học BUG-20260803/BUG-20260804) ──
// Rule "mọi quyết định theo thời gian phải quy về giờ VN" đã bị vi phạm 3 lần NGAY SAU khi được
// viết thành chữ, vì không cổng nào thi hành nó. Xem CR-20260804-cong-may-gio-vn.
chay('Gốc thời gian (giờ VN)', 'node scripts/check-tz.mjs');

// ── 5d. Design token — hardcode mới ngoài baseline (CR-20260913-c, BL-20260913-005) ──────────
// Cổng snapshot multiset: chặn giá trị màu/typography/spacing hardcode MỚI trong src/styles.css,
// không chặn giá trị đã có trước CR này (baseline). Đếm-tổng bị vượt qua dễ (xoá 1 thêm 1 khác),
// nên khoá theo đúng bộ ba (file, thuộc tính, giá trị).
chay('Design token (hardcode mới ngoài baseline)', 'node scripts/check-design-tokens.mjs');

// ── 5d2. BE error-code registry — mã lỗi MỚI ngoài registry (CR-20260913-c) ──────────────────
chay('BE error-code registry', 'node scripts/check-error-codes.mjs');

// ── 5e. Đồng bộ definition -> task release không match theo tên (CR-20260814-hop-nhat FR-9) ──
// BUG-20260814: đổi tên definition từng làm mất task đã chạy vì route "lưu 1 definition" match
// DELETE theo `ten_task`. Rule "không match theo tên" chỉ có người gác thì sẽ lại lọt.
chay('Đồng bộ release không match theo tên', 'node scripts/check-release-sync.mjs');

// ── 5f. Exe còn khớp code không (bài học L-009) ──────────────────────────────
// Sửa xong + commit + push mà quên `npm run package` thì app người dùng vẫn là bản cũ — với họ là
// CHƯA SỬA. Cảnh báo, không chặn: lúc đang code thì exe cũ là bình thường.
kiem('Exe khớp code chạy thật', () => {
  const out = execSync('node scripts/check-exe-fresh.mjs', { cwd: root, encoding: 'utf8' });
  process.stdout.write(out);
  return out.includes('⚠'); // true -> đánh dấu '!' ở bảng tổng kết
});

// ── 6. File nguồn quên `git add` ─────────────────────────────────────────────
// Máy này có sẵn mọi file trên đĩa nên test vẫn xanh dù bạn quên add — đây đúng là lớp lỗi
// mà CI trên máy sạch sẽ bắt được. Không có CI thì kiểm thủ công ở đây.
kiem('File nguồn chưa được git add', () => {
  const out = execSync('git ls-files --others --exclude-standard', { cwd: root, encoding: 'utf8' });
  const soChua = out.split('\n').filter((f) => /^(src|server|test|scripts)\//.test(f.trim()));
  if (soChua.length > 0) {
    console.warn('  ⚠ có file nguồn chưa track (test vẫn xanh vì file nằm sẵn trên đĩa):');
    soChua.forEach((f) => console.warn(`     ${f}`));
    console.warn('  -> `git add` nếu thuộc thay đổi này, hoặc thêm vào .gitignore.');
    return true; // cảnh báo, không chặn
  }
  console.log('  không có file nguồn nào bị bỏ quên');
});

// ── Tổng kết ─────────────────────────────────────────────────────────────────
console.log('\n' + '─'.repeat(58));
for (const [dau, ten] of buoc) console.log(`  ${dau}  ${ten}`);
console.log('─'.repeat(58));

if (hong > 0) {
  console.error(`\n✖ ${hong} cổng KHÔNG đạt — chưa được coi là xong.\n`);
  process.exit(1);
}
console.log(`
✔ Mọi cổng MÁY kiểm được đều đạt.

  Còn lại là việc của NGƯỜI (qa-standard §9) — máy không kiểm hộ được:
    □ Đã đọc lại toàn bộ \`git diff --staged\` như review code người khác chưa?
    □ Logic mới/đã sửa có test tương ứng chưa? (bugfix: test đỏ TRƯỚC khi sửa)
    □ Đụng UI-flow -> đã smoke thủ công chưa? (qa-standard §8)
    □ Đổi hành vi -> đã cập nhật docs/specs + docs/rules trong cùng lần giao chưa?
    □ Commit message có \`Ref: CR-… (FR-x)\` chưa?
`);
