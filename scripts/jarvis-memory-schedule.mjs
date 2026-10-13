// Configure only Memory Core's existing managed job. No new job/scheduler.
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const cli = path.join(repo, 'node_modules/openclaw/openclaw.mjs');
const profile = path.join(process.env.USERPROFILE, '.openclaw-jarvis');
const env = { ...process.env, OPENCLAW_STATE_DIR: profile, OPENCLAW_CONFIG_PATH: path.join(profile, 'openclaw.json') };
function call(method, params) {
  const output = execFileSync(process.execPath, [cli, '--profile', 'jarvis', 'gateway', 'call', method, '--params', JSON.stringify(params), '--json'], { cwd: repo, env, encoding: 'utf8', timeout: 60000, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  return JSON.parse(output);
}
function managedJob(result) {
  const jobs = result.jobs.filter(job => job.name === 'Memory Dreaming Promotion' && job.description?.startsWith('[managed-by=memory-core.short-term-promotion]'));
  if (jobs.length !== 1) throw new Error('Exactly one existing native Memory Core job required; no new job created');
  return jobs[0];
}
try {
  const job = managedJob(call('cron.list', { includeDisabled: true }));
  if (job.schedule.kind !== 'cron' || job.schedule.expr !== '0 */6 * * *' || job.schedule.tz !== 'Europe/Istanbul' || job.enabled !== true) throw new Error('Memory Core schedule/config differs; apply reviewed stage05 config first');
  if (job.schedule.staggerMs !== 0) call('cron.update', { id: job.id, patch: { schedule: { kind: 'cron', expr: '0 */6 * * *', tz: 'Europe/Istanbul', staggerMs: 0 } } });
  const observed = managedJob(call('cron.list', { includeDisabled: true }));
  if (observed.id !== job.id || observed.schedule.staggerMs !== 0) throw new Error('Native schedule update not confirmed; do not retry an unknown mutation blindly');
  console.log(JSON.stringify({ id: observed.id, enabled: observed.enabled, schedule: observed.schedule, lightContext: observed.payload.lightContext }));
} catch { console.error('Native Memory Core exact schedule not confirmed. Existing job was not replaced; inspect Gateway cron state before retrying.'); process.exitCode = 1; }
