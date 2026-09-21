#!/usr/bin/env node
// Quét link markdown gãy trong toàn bộ file .md được git track.
// docs-standard §8 yêu cầu "quét link hỏng trước khi commit đụng docs" — đây là bản tự động của nó.
//
// Chỉ quét file ĐƯỢC GIT TRACK: file mới chưa `git add` sẽ không được quét — đúng như thực tế
// (từng có một link gãy chỉ lộ ra sau khi commit vì lúc quét file còn ở trạng thái untracked).
//
// Dùng: node scripts/check-links.mjs   (hoặc qua `npm run check`)

import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const files = execSync('git ls-files "*.md"', { encoding: 'utf8' }).trim().split('\n').filter(Boolean)
  // Historical records stay immutable and may cite a document intentionally removed from the live set.
  .filter((file) => !/^(docs\/(?:_archive|delivery|exchanges)\/|conclave\/)/.test(file));

let hong = 0;
for (const f of files) {
  const dir = path.dirname(f);
  const noiDung = fs.readFileSync(f, 'utf8');
  // Bắt [text](duong/dan.md) và [text](duong/dan.md#neo). Bỏ qua http(s)/mailto.
  for (const m of noiDung.matchAll(/\]\(([^)#\s]+\.md)(#[^)]*)?\)/g)) {
    const target = m[1];
    if (/^(https?:|mailto:)/.test(target)) continue;
    if (!fs.existsSync(path.resolve(dir, target))) {
      console.error(`  GÃY  ${f}  ->  ${target}`);
      hong++;
    }
  }
}

if (hong > 0) {
  console.error(`\n✖ ${hong} link markdown gãy`);
  process.exit(1);
}
console.log(`✔ link markdown: ${files.length} file, 0 link gãy`);
