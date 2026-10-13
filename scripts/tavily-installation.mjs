import fs from 'node:fs';
import path from 'node:path';

// Inspect only the existing native installer project roots; no new registry.
export function resolveInstalledTavily(profileDir = path.join(process.env.USERPROFILE, '.openclaw-jarvis')) {
  const projects = path.join(profileDir, 'npm', 'projects');
  const matches = [];
  for (const entry of fs.readdirSync(projects, { withFileTypes: true })) {
    if (!entry.isDirectory() || !entry.name.startsWith('openclaw-tavily-plugin-')) continue;
    const root = path.join(projects, entry.name, 'node_modules', '@openclaw', 'tavily-plugin');
    const filename = path.join(root, 'package.json');
    if (!fs.existsSync(filename)) continue;
    const pkg = JSON.parse(fs.readFileSync(filename, 'utf8'));
    if (pkg.name === '@openclaw/tavily-plugin' && pkg.version === '2026.10.2') matches.push(root);
  }
  if (matches.length !== 1) throw new Error('Exactly one native Tavily 2026.10.2 installation is required');
  return matches[0];
}
