import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

// Native admission budgets only. No application-side backlog or scheduler.
export function applyWork(config) {
  config.agents.defaults.maxConcurrent = 3;
  config.agents.defaults.subagents = { ...config.agents.defaults.subagents, maxConcurrent: 3 };
  for (const tools of [config.agents.entries.main.tools, config.tools]) tools.allow = [...new Set([...tools.allow, 'jarvis_work_note', 'jarvis_work_read'])];
  return config;
}
export function assertWork(config) {
  assert.equal(config.agents.defaults.maxConcurrent, 3);
  assert.equal(config.agents.defaults.subagents.maxConcurrent, 3);
  for (const tools of [config.agents.entries.main.tools, config.tools]) for (const name of ['jarvis_work_note', 'jarvis_work_read']) assert.ok(tools.allow.includes(name), `Missing ${name}`);
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const checking = process.argv[2] === '--check';
  const filename = checking ? path.resolve(process.argv[3]) : path.join(process.env.USERPROFILE, '.openclaw-jarvis/openclaw.json');
  const before = fs.readFileSync(filename, 'utf8'), config = JSON.parse(before);
  if (checking) { assertWork(config); console.log('JARVIS stage06 native concurrency and narrow work tools OK'); }
  else {
    const backup = path.join(path.dirname(filename), 'openclaw.before-stage06.json');
    if (!fs.existsSync(backup)) fs.writeFileSync(backup, before, { flag: 'wx' });
    fs.writeFileSync(filename, JSON.stringify(applyWork(config), null, 2) + '\n');
    console.log('Stage06 native settings applied; restart/reload and verify before claiming live readiness.');
  }
}
