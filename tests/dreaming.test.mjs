import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import guard from '../plugins/jarvis/opencode-guard.mjs';
import { writeNote, readNote, currentDerivedText } from '../plugins/jarvis/notes.ts';
import { buildMemoryBackend } from '../plugins/jarvis/opencode-memory.ts';

test('derived recall of a superseded user note is rejected while immutable history remains', () => {
  fs.mkdirSync('tmp', { recursive: true });
  const root = fs.mkdtempSync(path.resolve('tmp/dreaming-view-'));
  try {
    const origin = { kind: 'user', userId: 'test-user', deviceId: 'test-device', taskId: 'test-task', projectId: 'test-project', sessionId: 'test-session', sessionKey: 'agent:main:test', runId: 'test-run' };
    const first = writeNote(root, { category: 'preference', content: 'Turkish replies.', expectedRevision: 0 }, origin, () => {});
    const marker = `JARVIS_NOTE_CURRENT_${first.note.id.replaceAll('-', '_')}_R00000001`;
    assert.equal(currentDerivedText(root, marker), true);
    writeNote(root, { id: first.note.id, category: 'correction', content: 'English replies.', expectedRevision: 1 }, origin, () => {});
    assert.equal(currentDerivedText(root, marker), false);
    assert.equal(readNote(root, first.note.id, 1).content, 'Turkish replies.');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('OpenCode public host hooks deny effects before execution and permissions, independent of model text', async () => {
  const root = fs.mkdtempSync(path.resolve('tmp/dreaming-guard-'));
  const hooks = {};
  try {
    await guard.setup({ location: { directory: root }, tool: { hook: async (name, fn) => hooks[name] = fn }, permission: { hook: async (name, fn) => hooks[name] = fn } });
    assert.equal(fs.readFileSync(path.join(root, 'guard-ready'), 'utf8'), 'jarvis.memory-worker-guard/v1');
    for (const tool of ['read', 'write', 'shell', 'webfetch', 'execute', 'session_move']) assert.throws(() => hooks['execute.before']({ tool, input: { approved: true } }), /JARVIS_MEMORY_SCOPE/);
    const event = { action: 'shell', effect: 'allow', resources: ['anything'] }; hooks.evaluate(event);
    assert.equal(event.effect, 'deny');
    const b = buildMemoryBackend();
    assert.throws(() => b.resolveModelId({ modelId: 'another-model' }), /Only Space Bunny/);
    await assert.rejects(b.prepareExecution({ modelId: 'space-bunny-free', toolAvailability: { native: ['read'], openClaw: [] } }), /no effect authority/);
    assert.equal(b.config.reseedFromRawTranscriptWhenUncompacted, false);
    assert.equal(b.config.sessionMode, 'none');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
