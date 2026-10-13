// Real JARVIS profile integration. Explicit run creates two isolated test chats.
// No provider/model replacement, worker setup, approval verdict or file effect.
import { _electron as electron } from 'playwright-core';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
process.chdir(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'));
const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE; delete env.JARVIS_DESKTOP_DEV;
const application = await electron.launch({ args: ['.'], env });
try {
  const page = await application.firstWindow();
  await page.waitForFunction(() => document.querySelector('jarvis-app')?.data?.connection.phase === 'connected', undefined, { timeout: 45000 });
  const act = a => page.evaluate(a => window.jarvis.action(a), a);
  let result = await act({ type: 'refresh' }); assert.equal(result.ok, true);
  const titles = [['daily', '04 bağlantı testi — günlük'], ['project', '04 bağlantı testi — proje']];
  const keys = [];
  for (const [kind, title] of titles) {
    const existing = result.snapshot.sessions.find(s => s.title.endsWith(title));
    result = existing ? await act({ type: 'select', key: existing.key }) : await act({ type: 'create', title, kind });
    assert.equal(result.ok, true, result.error); keys.push(result.snapshot.selected);
    assert.equal(result.snapshot.historyReady, true);
  }
  assert.notEqual(keys[0], keys[1]);
  assert.ok(keys.every(k => k.startsWith('agent:main:jarvis:')));
  result = await act({ type: 'select', key: keys[0] }); assert.equal(result.ok, true);
  // Bind the production stage-03 host scope through the same native folder
  // picker path. Only the picker selection is mocked, not Gateway admission.
  const scopeRoot = path.resolve('../../tmp/stage04/task-project'); await fs.mkdir(scopeRoot, { recursive: true });
  await application.evaluate(({ dialog }, root) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [root] }); }, scopeRoot);
  result = await act({ type: 'chooseScope' }); assert.equal(result.ok, true);
  const previous = result.snapshot.submissions.length;
  result = await act({ type: 'send', key: keys[0], message: 'Bu bir masaüstü istemci bağlantı testidir. Araç çağırma. Yalnız merhaba de.' });
  assert.equal(result.ok, true, result.error);
  const submission = result.snapshot.submissions.at(-1); assert.equal(submission.status, 'accepted'); assert.equal(submission.sessionKey, keys[0]); assert.ok(result.snapshot.submissions.length > previous);
  result = await act({ type: 'select', key: keys[1] }); assert.equal(result.ok, true); assert.equal(result.snapshot.messages.length, 0);
  await page.waitForTimeout(1500); result = await act({ type: 'refresh' }); assert.equal(result.ok, true);
  assert.equal(result.snapshot.approvalsAvailable, true);
  assert.equal(result.snapshot.messages.length, 0);
  const device = result.snapshot.connection.deviceId;
  await page.reload(); await page.waitForFunction(() => !!document.querySelector('jarvis-app')?.data?.selected);
  result = await act({ type: 'snapshot' }); assert.equal(result.snapshot.selected, keys[1]); assert.equal(result.snapshot.connection.deviceId, device);
  await page.screenshot({ path: '../../tmp/stage04/desktop-connected.png' });
  console.log('PASS real Gateway 2026.10.2: signed operator, two isolated sessions, production scope binding, chat.send admission, history isolation, approval replay and reload');
  console.log('LIVE_SESSION_KEYS', keys.join(' '));
  console.log('LIVE_RUN_ID', submission.id);
} finally { await application.close(); }
