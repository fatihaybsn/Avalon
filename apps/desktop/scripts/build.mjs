import { build } from 'esbuild';
import { build as viteBuild } from 'vite';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
process.chdir(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'));
// Fail if the preserved upstream source or its pinned attribution has drifted.
const source = JSON.parse(await fs.readFile('vendor/openclaw/SOURCE.json', 'utf8'));
for (const entry of source.files) {
  const sha = createHash('sha256').update(await fs.readFile(path.join('vendor/openclaw', entry.path))).digest('hex');
  if (sha !== entry.sha256) throw new Error(`Upstream source changed: ${entry.path}`);
}
await fs.mkdir('dist', { recursive: true });
await import('./vendor-talk.mjs');
await build({ entryPoints: ['src/main/main.ts'], bundle: true, platform: 'node', format: 'cjs', target: 'node24', outfile: 'dist/main.cjs', external: ['electron'], sourcemap: false });
await build({ entryPoints: ['src/main/preload.ts'], bundle: true, platform: 'node', format: 'cjs', target: 'node24', outfile: 'dist/preload.cjs', external: ['electron'], sourcemap: false });
await build({ entryPoints: ['src/main/media-preload.ts'], bundle: true, platform: 'node', format: 'cjs', target: 'node24', outfile: 'dist/media-preload.cjs', external: ['electron'], sourcemap: false });
await fs.copyFile('assets/tray.png', 'dist/tray.png');
await viteBuild();
