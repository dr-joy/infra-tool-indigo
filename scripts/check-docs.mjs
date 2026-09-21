#!/usr/bin/env node

import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));

// Tài liệu ở gốc repo cũng CHỊU LUẬT docs-standard, không phải vùng tự do (L-003).
const DOCS_GOC = ['README.md', 'CLAUDE.md', 'instroduction/README.md'];

const files = execSync('git ls-files "*.md"', { cwd: root, encoding: 'utf8' })
  .trim().split('\n').filter((f) => f && !f.startsWith('docs/_archive/') && !f.startsWith('docs/exchanges/'));

const loi = [];

// ── 1. Lệnh npm được nhắc trong tài liệu có thật không ───────────────────────
for (const f of files) {
  const noiDung = fs.readFileSync(path.join(root, f), 'utf8');
  for (const m of noiDung.matchAll(/npm run ([a-z][a-z0-9:_-]*)/g)) {
    if (!pkg.scripts[m[1]]) loi.push(`${f}: nhắc \`npm run ${m[1]}\` nhưng package.json không có script này`);
  }
}

// ── 2. Đường dẫn trong dòng `> Nguồn:` có tồn tại không (docs-standard §4) ───
let soNguon = 0;
for (const f of files) {
  for (const line of fs.readFileSync(path.join(root, f), 'utf8').split(/\r?\n/)) {
    if (!/^>\s*Nguồn/.test(line)) continue;
    for (const m of line.matchAll(/`([^`]+)`/g)) {
      const t = m[1];
      if (!/[/.]/.test(t)) continue;            // không phải đường dẫn (vd `LEAD=5'`)
      soNguon++;
      // Glob (`server/routes/*`, `test/**/*.test.ts`): chỉ kiểm thư mục gốc còn tồn tại.
      const canKiem = t.includes('*') ? t.split('*')[0].replace(/\/$/, '') : t;
      if (canKiem && !fs.existsSync(path.join(root, canKiem))) {
        loi.push(`${f}: dòng Nguồn trỏ \`${t}\` — không tồn tại`);
      }
    }
  }
}

// ── 3. Tài liệu gốc repo còn đủ không ────────────────────────────────────────
for (const f of DOCS_GOC) {
  if (!fs.existsSync(path.join(root, f))) {
    loi.push(`thiếu tài liệu gốc \`${f}\` — nếu cố ý xoá thì cập nhật DOCS_GOC trong scripts/check-docs.mjs và docs/README.md`);
  }
}

if (loi.length > 0) {
  console.error('  Tài liệu lệch thực tế:');
  loi.forEach((l) => console.error(`    ✖ ${l}`));
  console.error(`\n✖ ${loi.length} chỗ tài liệu không khớp thực tế (docs-standard §4, §5)`);
  process.exit(1);
}
console.log(`✔ tài liệu khớp thực tế: ${files.length} file, ${soNguon} đường dẫn Nguồn, ${DOCS_GOC.length} doc gốc`);
