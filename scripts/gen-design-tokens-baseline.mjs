#!/usr/bin/env node
// Sinh lại `scripts/design-tokens-baseline.json` từ trạng thái THẬT của `src/styles.css` hiện tại.
//
// CHỈ chạy khi bạn CHỦ ĐÍCH đổi baseline (thêm token mới rồi cập nhật `:root`, hoặc chấp nhận một
// hardcode mới có lý do chính đáng) — không phải cách để "làm cho cổng xanh" khi không hiểu vì sao
// nó đỏ. Sau khi chạy, LUÔN soi `git diff -- scripts/design-tokens-baseline.json`: diff phải khớp
// đúng với thay đổi bạn vừa làm, không lẫn hardcode nào khác lọt vào.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { quetCssChoToken, VUNG_QUET } from './check-design-tokens.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const baselinePath = path.join(root, 'scripts', 'design-tokens-baseline.json');

const baseline = [];
for (const rel of VUNG_QUET) {
  const abs = path.join(root, rel);
  if (!fs.existsSync(abs)) continue;
  const { muc } = quetCssChoToken(fs.readFileSync(abs, 'utf8'), rel);
  for (const m of muc) baseline.push({ file: m.file, thuocTinh: m.thuocTinh, giaTri: m.giaTri });
}

fs.writeFileSync(baselinePath, JSON.stringify(baseline, null, 2) + '\n');
console.log(`Đã sinh lại baseline: ${baseline.length} mục. Soi \`git diff -- scripts/design-tokens-baseline.json\` trước khi commit.`);
