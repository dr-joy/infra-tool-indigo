// Bundle server/mcp.ts -> dist-mcp/mcp.mjs (1 file, đủ MCP SDK + zod).
// Claude Desktop chạy: node dist-mcp/mcp.mjs  (không cần tsx, không phụ thuộc cwd).
import { build } from 'esbuild';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

await build({
  entryPoints: [path.join(root, 'server', 'mcp.ts')],
  outfile: path.join(root, 'dist-mcp', 'mcp.mjs'),
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node18',
  // Chèn shim cho __dirname/import.meta trong ESM (một số dep dùng tới).
  banner: {
    js: "import { createRequire as __cr } from 'module'; const require = __cr(import.meta.url);",
  },
});

console.log('✓ Bundled -> dist-mcp/mcp.mjs');
