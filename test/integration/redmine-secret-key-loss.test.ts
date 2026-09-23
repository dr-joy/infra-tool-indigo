// QA-2026-09-12: review toàn diện tính năng Settings/Redmine.
//
// Bug thật tìm thấy + sửa: nếu secret.key (master key mã hóa API key, nằm NGOÀI thư mục data — xem
// server/lib/secret.ts) bị mất/đổi giữa 2 lần khởi động app — đúng khoảng trống chính code đã tự ghi
// chú ("backup/restore riêng tasks.sqlite mà quên secret.key") — giaiMa() ném lỗi xác thực GCM
// ("Unsupported state or unable to authenticate data"). Lỗi này rơi thẳng ra ngoài, làm
// GET /redmine/config (gọi mỗi lần mở màn Settings) vỡ 500 mù mờ vĩnh viễn, không có đường nào phục
// hồi qua UI cho tới khi ai đó biết đường xoá tay dòng cấu hình trong DB.
//
// Test này PHẢI spawn tiến trình con thật (không chạy trong cùng process của node:test) vì
// `masterKey` được cache theo module — chỉ đọc lại file lúc IMPORT ĐẦU TIÊN của 1 tiến trình, nên
// xoá file giữa chừng trong CÙNG 1 process sẽ không tái hiện được bug (module vẫn dùng key cũ trong
// bộ nhớ). Kịch bản thật (mất secret.key) luôn đi kèm khởi động lại app, nên spawn 2 tiến trình con
// là mô phỏng đúng nhất, không phải giả lập gượng ép.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const fixture = path.join(repoRoot, 'test', 'integration', 'fixtures', 'redmine-secret-key-child.mjs');

function runChild(tmpAppData: string, action: 'set' | 'get'): { status: number; body: any } {
  const out = execFileSync(process.execPath, ['--import', 'tsx', fixture, tmpAppData, action], {
    encoding: 'utf8',
    cwd: repoRoot
  });
  return JSON.parse(out);
}

test('QA: secret.key bị mất giữa 2 lần khởi động -> GET /me/redmine KHÔNG được vỡ 500, phải coi như chưa có key', () => {
  const tmpAppData = fs.mkdtempSync(path.join(os.tmpdir(), 'tm-redmine-secretkey-itest-'));
  try {
    const setResult = runChild(tmpAppData, 'set');
    assert.equal(setResult.status, 200, JSON.stringify(setResult.body));
    assert.equal(setResult.body.hasKey, true);

    const keyFile = path.join(tmpAppData, 'TaskManager', 'secret.key');
    assert.ok(fs.existsSync(keyFile), 'secret.key phải được tự sinh sau khi lưu API key lần đầu');
    fs.unlinkSync(keyFile);

    const getResult = runChild(tmpAppData, 'get');
    assert.equal(getResult.status, 200, `phải trả 200 (coi như chưa có key), không được 500 — body: ${JSON.stringify(getResult.body)}`);
    assert.equal(getResult.body.hasKey, false, 'key cũ không giải mã lại được nữa -> coi như chưa cấu hình');
    assert.equal(getResult.body.baseUrl, 'https://redmine.example.com', 'URL không mã hóa, vẫn phải giữ nguyên dù key bị mất (Admin cấu hình, tách khỏi khoá cá nhân)');
  } finally {
    fs.rmSync(tmpAppData, { recursive: true, force: true });
  }
});
