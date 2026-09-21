// Đóng gói app thành 1 file TaskManager.exe (Node Single Executable Application).
// Kết quả nằm trong release/TaskManager/ gồm: TaskManager.exe + dist/ (giao diện).
// Máy khác chỉ cần copy cả thư mục này, double-click TaskManager.exe là chạy,
// không cần cài Node.
import { build } from 'esbuild';
import { rcedit } from 'rcedit';
import { execFileSync } from 'node:child_process';
import {
  mkdirSync, rmSync, cpSync, copyFileSync, existsSync, writeFileSync,
} from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const buildDir = path.join(root, 'build');
const outDir = path.join(root, 'release', 'TaskManager');
const icon = path.join(root, 'assets', 'app-icon.ico');

// DB dùng chung (phải khớp server/paths.ts). Backup mỗi lần build để phòng rủi ro.
const userBaseDir = process.env.APPDATA || process.env.XDG_DATA_HOME || os.homedir();
const sharedDataDir = path.join(userBaseDir, 'TaskManager', 'data');
const sharedDbFile = path.join(sharedDataDir, 'tasks.sqlite');

function log(msg) {
  console.log(`\n▸ ${msg}`);
}

// Backup DB trước khi build: 1 file duy nhất, GHI ĐÈ bản cũ (rolling) để không sinh ra
// quá nhiều backup. Dùng VACUUM INTO -> bản sao nhất quán, gộp luôn WAL.
function backupDatabase() {
  if (!existsSync(sharedDbFile)) {
    console.log('  (chưa có DB dùng chung, bỏ qua backup)');
    return;
  }
  const backupDir = path.join(sharedDataDir, 'backups');
  mkdirSync(backupDir, { recursive: true });
  const backupFile = path.join(backupDir, 'tasks-build-backup.sqlite');
  rmSync(backupFile, { force: true }); // VACUUM INTO yêu cầu file đích chưa tồn tại
  const sqlPath = backupFile.replace(/\\/g, '/').replace(/'/g, "''");
  const src = new DatabaseSync(sharedDbFile, { readOnly: true });
  try {
    src.exec(`VACUUM INTO '${sqlPath}'`);
  } finally {
    src.close();
  }
  console.log(`  Đã backup DB -> ${backupFile}`);
}

// 0. Backup DB dùng chung (1 file rolling) trước khi build.
log('Backup DB dùng chung trước khi build');
backupDatabase();

// 1. Dọn build cũ. DB nằm ngoài thư mục release (trong %APPDATA%) nên không bị ảnh hưởng;
//    ở đây chỉ thay exe + giao diện (dist).
rmSync(buildDir, { recursive: true, force: true });
mkdirSync(buildDir, { recursive: true });
mkdirSync(outDir, { recursive: true });
rmSync(path.join(outDir, 'TaskManager.exe'), { force: true });
rmSync(path.join(outDir, 'dist'), { recursive: true, force: true });

// 1. Bundle server (ESM TypeScript) -> 1 file CommonJS.
//    node:sqlite và các builtin khác tự động là external (platform node).
log('Bundle server -> build/server.cjs');
await build({
  entryPoints: [path.join(root, 'server', 'index.ts')],
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node24',
  outfile: path.join(buildDir, 'server.cjs'),
  banner: {
    // import.meta.url không có trong CJS bundle -> shim để createRequire chạy được
    js: "const { pathToFileURL } = require('node:url'); const import_meta_url = pathToFileURL(__filename).href;",
  },
  define: { 'import.meta.url': 'import_meta_url' },
  logLevel: 'info',
});

// 2. Build frontend (vite) -> dist/
log('Build frontend (vite build)');
const npmCmd = process.platform === 'win32' ? 'npm.cmd' : 'npm';
execFileSync(npmCmd, ['run', 'build'], { cwd: root, stdio: 'inherit', shell: true });

// 3. Tạo SEA config + sinh blob
log('Sinh SEA blob');
const seaConfig = {
  main: path.join(buildDir, 'server.cjs'),
  output: path.join(buildDir, 'sea-prep.blob'),
  disableExperimentalSEAWarning: true,
  useSnapshot: false,
  useCodeCache: false,
};
const seaConfigPath = path.join(buildDir, 'sea-config.json');
writeFileSync(seaConfigPath, JSON.stringify(seaConfig, null, 2));
execFileSync(process.execPath, ['--experimental-sea-config', seaConfigPath], {
  cwd: root,
  stdio: 'inherit',
});

// 4. Copy node.exe -> TaskManager.exe
log('Tạo TaskManager.exe từ node runtime');
const exePath = path.join(outDir, 'TaskManager.exe');
copyFileSync(process.execPath, exePath);

// 5. Đặt icon + thông tin app TRƯỚC khi inject blob.
//    (rcedit ghi lại resource của PE; làm sau khi inject dễ kẹt/hỏng blob.)
log('Đặt icon cho exe');
if (existsSync(icon)) {
  await rcedit(exePath, {
    icon,
    'version-string': {
      ProductName: 'Task Manager',
      FileDescription: 'Task Manager - Kanban Dashboard',
      CompanyName: 'Personal',
      LegalCopyright: '',
    },
  });
} else {
  console.warn('  (không thấy assets/app-icon.ico, bỏ qua bước icon)');
}

// 6. Inject blob vào exe
log('Inject SEA blob vào exe (postject)');
const postjectBin = path.join(root, 'node_modules', 'postject', 'dist', 'cli.js');
execFileSync(process.execPath, [
  postjectBin,
  exePath,
  'NODE_SEA_BLOB',
  path.join(buildDir, 'sea-prep.blob'),
  '--sentinel-fuse', 'NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2',
  '--overwrite',
], { cwd: root, stdio: 'inherit' });

// 7. Copy dist (giao diện) cạnh exe
log('Copy giao diện (dist) vào thư mục portable');
cpSync(path.join(root, 'dist'), path.join(outDir, 'dist'), { recursive: true });

// 8. Tạo shortcut ngoài Desktop (chỉ máy Windows hiện tại)
if (process.platform === 'win32') {
  log('Tạo shortcut "Task Manager" ngoài Desktop');
  const ps = [
    "$ws = New-Object -ComObject WScript.Shell;",
    "$lnk = Join-Path ([Environment]::GetFolderPath('Desktop')) 'Task Manager.lnk';",
    "$s = $ws.CreateShortcut($lnk);",
    `$s.TargetPath = '${exePath}';`,
    `$s.WorkingDirectory = '${outDir}';`,
    `$s.IconLocation = '${icon},0';`,
    "$s.Description = 'Task Manager - Kanban Dashboard';",
    "$s.Save()",
  ].join(' ');
  try {
    execFileSync('powershell', ['-NoProfile', '-Command', ps], { stdio: 'inherit' });
  } catch {
    console.warn('  (không tạo được shortcut, bỏ qua)');
  }
}

log(`XONG! App nằm tại: ${outDir}`);
console.log('  -> Copy cả thư mục TaskManager sang máy khác, double-click TaskManager.exe.');
