import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import guard from '../plugins/jarvis/opencode-guard.mjs';
import { writeNote, readNote, currentDerivedText, noteView } from '../plugins/jarvis/notes.ts';
import { buildMemoryBackend } from '../plugins/jarvis/opencode-memory.ts';
import { selectDreamContext, selectDiaryContext, validateDreamDecision } from '../plugins/jarvis/dreaming-context.ts';
import { admitNativeRecallCall } from '../plugins/jarvis/dreaming.ts';
import { guardedDreamStream, DREAM_MODEL, DREAM_MODELS } from '../plugins/jarvis/gemini-dreaming.ts';

test('Dreaming falls through five terminal availability errors only, preserves boundaries and records actual model', async () => {
  fs.mkdirSync('tmp', { recursive: true });
  const root = fs.mkdtempSync(path.resolve('tmp/dreaming-fallback-'));
  const origin = { kind: 'user', userId: 'test-user', deviceId: 'test-device', taskId: 'test-task', projectId: 'stage05-test', sessionId: 'test-session', sessionKey: 'agent:main:test', runId: 'test-run' };
  try {
    const n = writeNote(root, { expectedRevision: 0, category: 'preference', content: 'TEST ONLY: imaginary widget format jade.' }, origin, () => {});
    const v = noteView(root, n.note);
    const request = { messages: [{ role: 'user', content: JSON.stringify({ currentMemory: '- Bananas private hidden record.', candidates: [{ key: 'test-fallback', text: v.text.trim(), resultEntry: v.text.trim(), sourceRef: `${v.path}#L1-L1` }] }), timestamp: 0 }], tools: [] };
    let mode = 'success', evidence, failures = [], calls = [];
    const inner = async (model, context, options) => {
      calls.push(model.id);
      assert.ok(!JSON.stringify(context).includes('Bananas'));
      assert.deepEqual(context.tools, []);
      assert.equal((await options.onPayload({ generationConfig: {} }, model)).generationConfig.responseMimeType, 'application/json');
      if (mode === 'timeout') throw new Error('network timeout: unknown outcome');
      if (mode === 'stale') writeNote(root, { id: n.note.id, expectedRevision: 1, category: 'correction', content: 'TEST ONLY: format changed.' }, origin, () => {});
      return { result: async () => ({ role: 'assistant', content: [{ type: 'text', text: mode === 'invalid' ? '{}' : JSON.stringify({ operations: [{ candidateKey: 'test-fallback', action: 'added', priorEntries: [] }] }) }], stopReason: mode === 'success' && model.id === DREAM_MODELS.at(-1) || mode === 'invalid' ? 'stop' : 'error', errorMessage: mode === 'auth' ? '403 PERMISSION_DENIED' : '503 UNAVAILABLE: high demand' }) };
    };
    const wrapped = guardedDreamStream(inner, root, e => evidence = e, e => failures.push(e));
    await (await wrapped({ id: DREAM_MODEL }, request, {})).result();
    assert.deepEqual(calls, DREAM_MODELS);
    assert.equal(evidence.modelId, DREAM_MODELS.at(-1));
    assert.equal(failures.length, 0);
    for (const m of ['exhausted', 'timeout', 'auth', 'invalid']) {
      mode = m; calls = [];
      await assert.rejects(wrapped({ id: DREAM_MODEL }, request, {}));
      assert.equal(calls.length, m === 'exhausted' ? 5 : 1);
    }
    mode = 'stale'; calls = [];
    await assert.rejects(wrapped({ id: DREAM_MODEL }, request, {}), /REVISION_CONFLICT|Stale/);
    assert.equal(calls.length, 1);
    assert.equal(readNote(root, n.note.id).revision, 2);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('Gemini stream boundary withholds full memory, hidden entries, tools and stale replies', async () => {
  fs.mkdirSync('tmp', { recursive: true });
  const root = fs.mkdtempSync(path.resolve('tmp/dreaming-google-'));
  const origin = { kind: 'user', userId: 'test-user', deviceId: 'test-device', taskId: 'test-task', projectId: 'stage05-test', sessionId: 'test-session', sessionKey: 'agent:main:test', runId: 'test-run' };
  try {
    const n = writeNote(root, { expectedRevision: 0, category: 'preference', content: 'TEST ONLY: imaginary widget format copper.' }, origin, () => {});
    const v = noteView(root, n.note);
    const request = { messages: [{ role: 'user', content: JSON.stringify({ currentMemory: '- Widget format is known.\n- Bananas private hidden record.', candidates: [{ key: 'native-test', text: v.text.trim(), resultEntry: v.text.trim(), sourceRef: `${v.path}#L1-L1` }] }), timestamp: 0 }], tools: [], systemPrompt: 'Unselected ambient secret' };
    const decision = JSON.stringify({ operations: [{ candidateKey: 'native-test', action: 'added', priorEntries: [] }] });
    let evidence, mode = 'valid';
    const inner = async (model, context, options) => {
      assert.ok(!JSON.stringify(context).includes('Bananas'));
      assert.ok(!JSON.stringify(context).includes('ambient secret'));
      assert.deepEqual(context.tools, []);
      const body = await options.onPayload({ config: {} }, model);
      assert.equal(body.config.responseMimeType, 'application/json');
      assert.deepEqual(body.config.responseSchema.required, ['operations']);
      return { result: async () => {
        if (mode === 'stale') writeNote(root, { id: n.note.id, expectedRevision: 1, category: 'correction', content: 'TEST ONLY: imaginary widget format silver.' }, origin, () => {});
        return { role: 'assistant', content: mode === 'tool' ? [{ type: 'toolCall', id: 'forbidden', name: 'write', arguments: {} }] : [{ type: 'text', text: mode === 'hidden' ? JSON.stringify({ operations: [{ candidateKey: 'native-test', action: 'superseded', priorEntries: ['- Bananas private hidden record.'] }] }) : decision }], stopReason: 'stop' };
      } };
    };
    const wrapped = guardedDreamStream(inner, root, e => evidence = e, () => {});
    const valid = await wrapped({ id: DREAM_MODEL }, request, {});
    assert.deepEqual(evidence.keys, ['native-test']);
    assert.equal((await valid.result()).content[0].text, decision);
    mode = 'hidden'; await assert.rejects(wrapped({ id: DREAM_MODEL }, request, {}), /unseen/);
    mode = 'tool'; await assert.rejects(wrapped({ id: DREAM_MODEL }, request, {}), /tool/);
    mode = 'stale'; await assert.rejects(wrapped({ id: DREAM_MODEL }, request, {}), /REVISION_CONFLICT/);
    assert.equal(readNote(root, n.note.id).revision, 2);
    assert.equal(readNote(root, n.note.id, 1).revision, 1);
    await assert.rejects(wrapped({ id: DREAM_MODEL }, { ...request, tools: [{ name: 'write' }] }, {}), /cloud withheld/);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

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

test('daily view invalidation, cloud selection and unseen/stale decisions retain source revisions', () => {
  fs.mkdirSync('tmp', { recursive: true });
  const root = fs.mkdtempSync(path.resolve('tmp/dreaming-context-'));
  const origin = { kind: 'user', userId: 'test-user', deviceId: 'test-device', taskId: 'test-task', projectId: 'stage05-test', sessionId: 'test-session', sessionKey: 'agent:main:test', runId: 'test-run' };
  try {
    const saved = writeNote(root, { expectedRevision: 0, category: 'preference', content: 'TEST ONLY: example widget exports use the copper format.' }, origin, () => {});
    const v = noteView(root, saved.note);
    assert.match(v.path, /^memory\/current\/\d{4}-\d{2}-\d{2}-[0-9a-f-]+-r00000001\.md$/);
    const candidate = { key: 'test-native-key', text: v.text.trim(), resultEntry: `- ${v.text.trim()} Source: ${v.path}#L1-L1`, sourceRef: `${v.path}#L1-L1` };
    const raw = JSON.stringify({ currentMemory: '# Memory\n- Example widget exports are documented.\n- Hidden unrelated secret for bananas.\n', candidates: [candidate] });
    const selected = selectDreamContext(root, raw);
    assert.equal(selected.prompt.includes('Hidden unrelated secret'), false);
    assert.equal(selected.visibleEntries.length, 1);
    assert.deepEqual(validateDreamDecision(selected, JSON.stringify({ operations: [{ candidateKey: candidate.key, action: 'added', priorEntries: [] }] })).actions, ['added']);
    assert.throws(() => validateDreamDecision(selected, JSON.stringify({ operations: [{ candidateKey: candidate.key, action: 'superseded', priorEntries: ['- Hidden unrelated secret for bananas.'] }] })), /unseen/);
    const diary = selectDiaryContext(root, `Write a dream diary entry from these memory fragments:\n- ${v.text.trim()}\nDiary continuity context:\n- Hidden old diary`);
    assert.equal(diary.prompt.includes('Hidden old diary'), false);
    const corrected = writeNote(root, { id: saved.note.id, expectedRevision: 1, category: 'correction', content: 'TEST ONLY: example widget exports now use the silver format.' }, origin, () => {});
    assert.notEqual(corrected.dreaming.viewPath, saved.dreaming.viewPath);
    assert.equal(readNote(root, saved.note.id, 1).content, saved.note.content);
    assert.equal(fs.readFileSync(path.join(root, v.path), 'utf8').includes(v.marker), false);
    assert.equal(currentDerivedText(root, v.text), false);
    assert.throws(() => selected.assertCurrent(), /REVISION_CONFLICT/);
    assert.throws(() => selectDreamContext(root, raw), /Stale/);
    assert.throws(() => diary.assertCurrent(), /changed/);
    assert.throws(() => writeNote(root, { id: saved.note.id, expectedRevision: 1, category: 'correction', content: 'stale' }, origin, () => {}), /REVISION_CONFLICT/);
    const web = writeNote(root, { expectedRevision: 0, category: 'finding', content: 'untrusted claim', sources: ['https://example.com'] }, { ...origin, kind: 'web' }, () => {});
    assert.equal(web.dreaming.eligible, false);
    const long = writeNote(root, { expectedRevision: 0, category: 'preference', content: 'x'.repeat(900) }, origin, () => {});
    assert.equal(long.dreaming.eligible, false);
    assert.equal(readNote(root, long.note.id).content.length, 900);
    assert.equal(admitNativeRecallCall({ toolName: 'memory_search', toolCallId: 'spoof', params: { query: v.marker } }, { agentId: 'main', runId: 'spoof' }), undefined);
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
