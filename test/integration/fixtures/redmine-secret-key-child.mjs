// Fixture chạy trong tiến trình CON riêng (không phải qua node:test) — cần thiết vì bug bị test
// (server/lib/secret.ts: masterKey cache theo module, chỉ đọc lại file lúc IMPORT ĐẦU TIÊN của
// tiến trình) chỉ tái hiện được khi mất secret.key GIỮA 2 LẦN KHỞI ĐỘNG tiến trình thật — không thể
// tái hiện trong cùng 1 process của node:test vì module đã cache masterKey trong bộ nhớ.
// Dùng: node --import tsx redmine-secret-key-child.mjs <tmpAppDataDir> <set|get>
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const [, , tmpAppData, action] = process.argv;
process.env.APPDATA = tmpAppData;

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const { app } = await import(`file://${path.join(repoRoot, 'server', 'app.js')}`);

const server = app.listen(0, '127.0.0.1', async () => {
  const port = server.address().port;
  const base = `http://127.0.0.1:${port}`;
  try {
    if (action === 'set') {
      const res = await fetch(`${base}/api/redmine/config`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ baseUrl: 'redmine.example.com', apiKey: 'super-secret-key-123' })
      });
      process.stdout.write(JSON.stringify({ status: res.status, body: await res.json() }));
    } else {
      const res = await fetch(`${base}/api/redmine/config`);
      process.stdout.write(JSON.stringify({ status: res.status, body: await res.json() }));
    }
  } finally {
    server.close();
  }
});
