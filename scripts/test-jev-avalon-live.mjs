// Opt-in REAL integration check: provider requests, one authorized Notepad save,
// real Hermes host handoffs, and Gemini audio through the Avalon renderer.
// Never mocks model responses, MCP host replies, task completion or playback.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { _electron as electron } from 'playwright-core';
import { loadEnvFiles } from '../electron/configStore.mjs';

if (!process.argv.includes('--run-live')) throw Error('Pass --run-live: this test uses provider quota and real Windows input.');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
loadEnvFiles({ repoRoot: root });
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'avalon-jev-live-'));
const output = path.join(temp, 'jev-result.txt');
const expected = 'Jev Avalon doğrulaması başarılı.';
const title = process.env.AVALON_JEV_TEST_WINDOW_TITLE;
if (!title) throw Error('Select one empty Notepad window and set AVALON_JEV_TEST_WINDOW_TITLE to its exact title.');
if (!process.env.GEMINI_API_KEY) throw Error('Gemini key is required for the real completion-audio check.');
const report = { startedUtc: new Date().toISOString(), realProviders: true, simulatedHost: false,
  output, expected, targetTitle: title, approvals: [], events: [], ok: false };
const env = { ...process.env, IRIS_START_PROD: '1', IRIS_BRAIN_RELAY: 'true',
  IRIS_TEST_HOOKS: '1', IRIS_TEST_SKIP_WELCOME: '1', IRIS_TEST_CONFIG_PATH: path.join(temp, '.env'),
  IRIS_TEST_RUN_REGISTRY_PATH: path.join(temp, 'runs.json'), IRIS_HERMES_AUTOSTART: 'false',
  IRIS_REMOTE_ENABLED: 'false', IRIS_WAKE_WORD: 'false', IRIS_LOAD_TEST_DATA: 'false',
  IRIS_AUTO_SLEEP_SECONDS: '600', IRIS_PERMISSION_MODE: 'standard', IRIS_CONVERSATION_LANGUAGE: 'tr' };
delete env.ELECTRON_RUN_AS_NODE;
// Silence prevents the real room microphone feeding personal speech back into
// the test. The renderer's real output audio and playback acknowledgements stay on.
const silence = Buffer.alloc(44 + 32000);
silence.write('RIFF', 0); silence.writeUInt32LE(silence.length - 8, 4); silence.write('WAVEfmt ', 8);
silence.writeUInt32LE(16, 16); silence.writeUInt16LE(1, 20); silence.writeUInt16LE(1, 22);
silence.writeUInt32LE(16000, 24); silence.writeUInt32LE(32000, 28); silence.writeUInt16LE(2, 32);
silence.writeUInt16LE(16, 34); silence.write('data', 36); silence.writeUInt32LE(32000, 40);
const capture = path.join(temp, 'silence.wav'); fs.writeFileSync(capture, silence);
let app, page, runId, eventIndex = 0;
const approved = new Set();
const started = Date.now();
async function collect() {
  const fresh = await page.evaluate(index => window.__jevLiveEvents.slice(index), eventIndex);
  eventIndex += fresh.length;
  for (const event of fresh) {
    report.events.push(event);
    if (event.type === 'hermes_task_event' && event.event === 'tool.started')
      console.log(JSON.stringify({ event: 'worker_tool', tool: event.tool, elapsedMs: Date.now() - started }));
    if (event.type === 'hermes_task_update' && event.status)
      console.log(JSON.stringify({ event: 'worker_state', status: event.status, elapsedMs: Date.now() - started }));
    if (event.type === 'hermes_interaction' && event.action === 'request') {
      const interaction = event.interaction;
      if (approved.has(interaction.id)) continue;
      if (interaction.type !== 'approval' || interaction.secret)
        throw Error(`Unexpected human interaction: ${interaction.type}. ${interaction.question}`);
      const description = `${interaction.command || ''} ${interaction.question || ''}`;
      // Authorization is limited to this requested test and its observation/readback.
      if (!/jev_windows_pilot|typesafe_|skill_view|read_file|windows-task-routing/i.test(description) && !description.includes(output))
        throw Error(`Approval outside the test scope: ${description}`);
      approved.add(interaction.id);
      report.approvals.push({ type: 'once', description });
      const response = await page.evaluate(payload => window.iris.respondHermesInteraction(payload), {
        run_id: event.run_id, interaction_id: interaction.id, interaction_type: 'approval', value: 'once',
      });
      if (['blocked', 'error'].includes(response.status)) throw Error(`Approval failed: ${response.error}`);
    }
  }
}
async function until(check, timeout, label) {
  const limit = Date.now() + timeout;
  while (Date.now() < limit) {
    await collect();
    const value = await check();
    if (value) return value;
    await new Promise(resolve => setTimeout(resolve, 400));
  }
  throw Error(`Timed out: ${label}`);
}
try {
  app = await electron.launch({ args: [path.join(root, 'electron/main.mjs'),
    `--user-data-dir=${path.join(temp, 'chromium')}`, '--use-fake-ui-for-media-stream',
    '--use-fake-device-for-media-stream', `--use-file-for-fake-audio-capture=${capture}`,
    '--autoplay-policy=no-user-gesture-required'], cwd: root, env });
  page = await app.firstWindow();
  await page.waitForSelector('.deck', { timeout: 30000 });
  await page.evaluate(() => {
    window.__jevLiveEvents = [];
    window.__jevLiveAudio = [];
    window.iris.onSidecarEvent(event => window.__jevLiveEvents.push(event));
    window.iris.onAudioChunk(chunk => window.__jevLiveAudio.push({
      utteranceId: chunk.utteranceId, mimeType: chunk.mimeType, data: chunk.data,
    }));
  });
  const session = await page.evaluate(() => window.iris.createHermesSession());
  assert.ok(session.ok && session.id, 'A new test conversation must be created');
  await page.evaluate(id => window.iris.saveConfig({ IRIS_HERMES_SESSION: id }), session.id);
  report.conversationSession = session.id;
  await page.evaluate(() => window.iris.startSidecar());
  await until(async () => (await page.evaluate(() => window.iris.getSidecarStatus()))?.running, 45000, 'Gemini Live connection');
  console.log('Real Gemini Live connection established.');
  const task = `Bu yetkilendirilmiş Jev entegrasyon testidir. Yalnızca başlığı ${JSON.stringify(title)} olan hazır boş Not Defteri penceresinde GUI üzerinden ${JSON.stringify(expected)} metnini, satır sonu eklemeden yaz ve Ctrl+S ile ${JSON.stringify(output)} adlı YENİ UTF-8 dosyasına kaydet. Masaüstü işlemlerini mcp__jev_windows_pilot__typesafe_windows, typesafe_run ve typesafe_respond ile yap; CUA veya kodla dosyaya yazma kullanma. Jev needs_host isteğinde gereken metni/yolu sen sağla, görüntüyü gerçekten değerlendir. En fazla 20 adım ve 180 saniyelik tek Jev koşusu kullan. Aynı masaüstünde başka yürütücü çalıştırma. Sonucu yalnızca dosyayı okuyarak doğrula; dosya doğruysa son yanıtın yalnızca 'Jev doğrulaması tamamlandı.' olsun. Başlamadan önce görev önerisi hazırla.`;
  report.task = task;
  assert.equal(fs.existsSync(output), false);
  await page.evaluate(text => window.iris.sendCommand({ type: 'text', text }), task);
  const proposal = await until(() => report.events.find(e => e.type === 'brain_proposal' && e.proposal_id), 90000, 'real brain task proposal');
  assert.equal(fs.existsSync(output), false, 'Conversation must not create the file before approval');
  const decision = await page.evaluate(id => window.iris.respondTaskProposal(id, 'once'), proposal.proposal_id);
  assert.ok(!['blocked', 'error'].includes(decision.status), JSON.stringify(decision));
  console.log('Real conversation proposal approved once; awaiting Hermes → Jev execution.');
  const complete = await until(() => {
    const start = report.events.find(e => e.type === 'hermes_task_update' && e.run_id);
    if (start) runId = start.run_id;
    return report.events.find(e => e.type === 'hermes_completion' && (!runId || e.run_id === runId));
  }, 300000, 'actual Jev worker completion');
  report.workerCompletion = complete;
  assert.ok(fs.existsSync(output), 'The requested output file was not created');
  assert.deepEqual(fs.readFileSync(output), Buffer.from(expected, 'utf8'), 'Saved text must match exact UTF-8 bytes');
  report.exactFileMatch = true;
  const tools = report.events.filter(e => e.type === 'hermes_task_event' && e.tool).map(e => e.tool);
  report.workerTools = [...new Set(tools)];
  assert.ok(tools.some(name => name.includes('jev_windows_pilot') && name.endsWith('typesafe_run')), 'Real Hermes worker must call Jev');
  assert.ok(tools.some(name => name.includes('jev_windows_pilot') && name.endsWith('typesafe_respond')), 'Real Hermes worker must answer Jev host handoffs');
  assert.ok(!tools.includes('write_file') && !tools.includes('patch'), 'The host must not write the output directly');
  const firstTerminal = report.events.find(e => e.type === 'hermes_task_event' && e.event === 'tool.started' && e.tool === 'terminal');
  if (firstTerminal) {
    assert.ok(fs.statSync(output).birthtimeMs < firstTerminal.timestamp * 1000,
      'The GUI must create the file before the host terminal verification starts');
    report.fileCreatedBeforeTerminalVerification = true;
  }
  const playback = await until(() => report.events.find(e => e.type === 'voice_playback_complete' && e.run_id === complete.run_id), 90000, 'Gemini completion audio and renderer playback');
  report.completionPlayback = playback;
  report.fidelity = report.events.filter(e => e.type === 'voice_fidelity');
  report.completionFidelity = report.fidelity.find(e => e.utterance_id === playback.utterance_id) || null;
  const chunks = await page.evaluate(() => window.__jevLiveAudio);
  report.audioBytes = chunks.reduce((sum, item) => sum + (item.data ? Buffer.from(item.data, 'base64').length : 0), 0);
  assert.ok(report.audioBytes > 0, 'Real Gemini audio bytes are required');
  report.ok = true;
  console.log(JSON.stringify({ ok: true, exactFileMatch: true, realHostHandoffs: true,
    completionPlayback: true, audioBytes: report.audioBytes, output }));
} catch (error) {
  report.error = error.stack || String(error);
  if (app) report.relayState = await app.evaluate(() => globalThis.__irisTest.relayState()).catch(() => null);
  console.error(error.message);
  process.exitCode = 1;
} finally {
  if (page) await collect().catch(() => {});
  if (runId && page) await page.evaluate(id => window.iris.stopTask(id), runId).catch(() => {});
  if (page) await page.evaluate(() => window.iris.stopSidecar()).catch(() => {});
  await app?.close().catch(() => {});
  report.seconds = Number(((Date.now() - started) / 1000).toFixed(2));
  fs.writeFileSync(path.join(temp, 'result.json'), JSON.stringify(report, null, 2));
  const publicFolder = path.join(root, 'validation/live-jev'); fs.mkdirSync(publicFolder, { recursive: true });
  fs.writeFileSync(path.join(publicFolder, 'latest.json'), JSON.stringify({ ok: report.ok, seconds: report.seconds,
    realProviders: true, simulatedHost: false, exactFileMatch: report.exactFileMatch || false,
    workerTools: report.workerTools || [], completionPlayback: Boolean(report.completionPlayback),
    audioBytes: report.audioBytes || 0, error: report.error?.split('\n')[0] || null,
    detailFile: path.join(temp, 'result.json') }, null, 2));
  console.log(`Jev live integration report: ${path.join(temp, 'result.json')}`);
}
