#!/usr/bin/env node
// Cài git hook từ scripts/hooks/ vào .git/hooks/.
//
// Vì sao cần bước này: `.git/hooks/` KHÔNG được git track, nên hook không tự đi theo repo.
// Máy mới clone về sẽ không có hook nào — đó là điểm yếu cố hữu của hook (xem ADR-P2).
// Giữ bản gốc trong `scripts/hooks/` (có track) rồi copy sang là cách rẻ nhất, không cần
// thêm dependency như husky.
//
// Dùng: npm run hooks:install

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const nguon = path.join(root, 'scripts', 'hooks');
const dich = path.join(root, '.git', 'hooks');

if (!fs.existsSync(dich)) {
  console.error('✖ Không thấy .git/hooks — đang chạy ngoài một git repo?');
  process.exit(1);
}

let n = 0;
for (const ten of fs.readdirSync(nguon)) {
  const to = path.join(dich, ten);
  fs.copyFileSync(path.join(nguon, ten), to);
  try { fs.chmodSync(to, 0o755); } catch { /* Windows không cần */ }
  console.log(`  ✔ ${ten}`);
  n++;
}
console.log(`\n✔ Đã cài ${n} hook. Từ giờ \`git push\` sẽ chạy \`npm run check\` trước.`);
console.log('  Bỏ qua một lần khi cần: git push --no-verify');
