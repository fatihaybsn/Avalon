import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { applyPolicy, assertPolicy } from './jarvis-policy-config.mjs';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const profileDir = path.join(os.homedir(), '.openclaw-jarvis');
const filename = path.join(profileDir, 'openclaw.json');
if (fs.existsSync(filename)) {
  console.log('Existing JARVIS profile preserved. Apply reviewed stage 03 policy separately if required.');
} else {
  const config = JSON.parse(fs.readFileSync(path.join(repo, 'config', 'jarvis.openclaw.json'), 'utf8'));
  config.agents.defaults.workspace = path.join(profileDir, 'workspace');
  const prepared = applyPolicy(config, profileDir);
  assertPolicy(prepared, profileDir);
  fs.mkdirSync(profileDir, { recursive: true });
  fs.mkdirSync(prepared.agents.defaults.workspace, { recursive: true });
  fs.mkdirSync(prepared.agents.entries.research.workspace, { recursive: true });
  fs.writeFileSync(filename, JSON.stringify(prepared, null, 2) + '\n', { flag: 'wx' });
  console.log('JARVIS profile initialized for this computer; no credentials copied.');
}
