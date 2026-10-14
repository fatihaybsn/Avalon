import test from 'node:test';
import assert from 'node:assert/strict';
import { DesktopController } from '../src/main/controller.ts';
import { RpcError, type Rpc } from '../src/main/gateway.ts';
import { validateAction, trustedFrame } from '../src/main/validation.ts';
import { projectMessages, projectApproval } from '../src/main/projection.ts';

const first = 'agent:main:jarvis:daily:first', second = 'agent:main:jarvis:project:second';
class Fake implements Rpc {
  connected = true;
  calls: { method: string; params: any; mutation: boolean }[] = [];
  rows: any[] = [{ key: first, sessionId: 'one', displayName: 'Günlük', hasActiveRun: false }, { key: second, sessionId: 'two', displayName: 'Proje', hasActiveRun: true, activeRunIds: ['existing-run'] }];
  failSend = false;
  historyGate?: (params: any) => Promise<any>;
  async request(method: string, params: any, mutation = false): Promise<any> {
    this.calls.push({ method, params, mutation });
    if (method === 'sessions.list') return { sessions: structuredClone(this.rows) };
    if (method === 'chat.history') return this.historyGate ? this.historyGate(params) : { messages: [], sessionInfo: this.rows.find(s => s.key === params.sessionKey) };
    if (method.endsWith('.approval.list')) return [];
    if (method === 'sessions.create') { this.rows.push({ key: params.key, sessionId: 'new', displayName: params.displayName }); return { key: params.key }; }
    if (method === 'jarvis.work.start' && this.failSend) throw new RpcError('WRITE_OUTCOME_UNKNOWN');
    return {};
  }
}
function setup() { const rpc = new Fake(); const controller = new DesktopController(rpc, 'main', () => {}); return { rpc, controller }; }

test('IPC rejects arbitrary RPC, paths, extra fields and foreign frames/origins', () => {
  for (const action of [{ type: 'shell', command: 'calc' }, { type: 'snapshot', token: 'secret' }, { type: 'create', title: 'p', kind: 'project', cwd: 'C:\\' }, { type: 'send', key: first, message: 'x', method: 'approval.resolve' }, { type: 'send', key: first }, { type: 'create', title: 'x', kind: 'fork' }]) assert.throws(() => validateAction(action));
  assert.deepEqual(validateAction({ type: 'send', key: first, message: 'test' }), { type: 'send', key: first, message: 'test' });
  assert.equal(trustedFrame(1, 1, 'jarvis://app/', true, false), true);
  for (const [id, u, top] of [[2, 'jarvis://app/', true], [1, 'jarvis://other/', true], [1, 'jarvis://app/other.html', true], [1, 'https://example.com/', true], [1, 'jarvis://app/', false]] as const) assert.equal(trustedFrame(id, 1, u, top, false), false);
  assert.equal(trustedFrame(1, 1, 'http://127.0.0.1:5173/', true, true), true);
  assert.equal(trustedFrame(1, 1, 'http://127.0.0.1:5173.evil.test/', true, true), false);
});
test('switching sessions reads selected history and preserves a running task', async () => {
  const { rpc, controller } = setup(); await controller.refresh(); await controller.select(second); await controller.select(first);
  assert.equal(controller.snapshot.sessions.find(s => s.key === second)?.active, true);
  assert.deepEqual(rpc.calls.filter(c => c.mutation), []);
  assert.equal(rpc.calls.some(c => /abort|reset|delete|steer/.test(c.method)), false);
});
test('a stale history response cannot overwrite a newer selection', async () => {
  const { rpc, controller } = setup(); await controller.refresh();
  let resolveOld!: (value: any) => void;
  rpc.historyGate = p => p.sessionKey === first ? new Promise(r => resolveOld = r) : Promise.resolve({ messages: [{ role: 'user', content: 'new-selected' }] });
  const old = controller.select(first); await new Promise(r => setTimeout(r, 0));
  await controller.select(second); resolveOld({ messages: [{ role: 'user', content: 'late-old' }] }); await old;
  assert.equal(controller.snapshot.selected, second); assert.equal(controller.snapshot.messages[0].text, 'new-selected');
});
test('create uses same agent and a new isolated key without copying raw history or starting a turn', async () => {
  const { rpc, controller } = setup(); await controller.refresh(); await controller.create('Örnek', 'project');
  const params = rpc.calls.find(c => c.method === 'sessions.create')!.params;
  assert.equal(params.agentId, 'main'); assert.match(params.key, /^agent:main:jarvis:project:/);
  for (const k of ['fork', 'parentSessionKey', 'message', 'task', 'cwd', 'model', 'worktree']) assert.equal(Object.hasOwn(params, k), false);
  assert.equal(controller.snapshot.messages.length, 0);
});
test('human-selected scope and chat send use one run/idempotency identity; UI cannot bind identity fields', async () => {
  const { rpc, controller } = setup(); await controller.refresh(); controller.setRoot(first, 'C:\\projects\\example'); await controller.send(first, 'write this');
  const bind = rpc.calls.find(c => c.method === 'jarvis.scope.bind')!.params, send = rpc.calls.find(c => c.method === 'jarvis.work.start')!.params;
  assert.equal(bind.runId, send.runId); assert.equal(bind.taskId, send.runId); assert.equal(send.sessionId, undefined);
  assert.equal(bind.sessionKey, first); assert.equal(bind.root, 'C:\\projects\\example'); assert.equal(bind.userId, undefined); assert.equal(bind.deviceId, undefined);
  assert.equal(bind.userInput, send.message);
  assert.equal(rpc.calls.some(c => c.method === 'approval.resolve'), false);
});
test('ambiguous send remains unknown and read reconnect never resends a mutation', async () => {
  const { rpc, controller } = setup(); await controller.refresh(); rpc.failSend = true;
  await assert.rejects(controller.send(first, 'do it'), e => e instanceof RpcError && e.code === 'WRITE_OUTCOME_UNKNOWN');
  assert.equal(controller.snapshot.submissions[0].status, 'unknown'); const writes = rpc.calls.filter(c => c.mutation).length;
  controller.event('desktop.disconnected', {}); await controller.connected(); controller.stop();
  assert.equal(rpc.calls.filter(c => c.mutation).length, writes);
  assert.equal(controller.snapshot.submissions[0].status, 'unknown');
  assert.equal(rpc.calls.some(c => c.method === 'chat.history' && c.params.inputRunIds?.length === 1), true);
});
test('a failed scope bind never sends chat and active sessions reject sends', async () => {
  const { rpc, controller } = setup(); await controller.refresh();
  await controller.select(second);
  await assert.rejects(controller.send(second, 'interrupt'), e => e instanceof RpcError && e.code === 'SESSION_BUSY');
  await controller.select(first);
  controller.setRoot(first, 'C:\\example'); const original = rpc.request.bind(rpc);
  rpc.request = async (method, params, mutation) => { if (method === 'jarvis.scope.bind') throw new RpcError('WRITE_OUTCOME_UNKNOWN'); return original(method, params, mutation); };
  await assert.rejects(controller.send(first, 'do it')); assert.equal(rpc.calls.some(c => c.method === 'jarvis.work.start'), false);
});
test('a replaced session incarnation loses its previous human folder grant', async () => {
  const { rpc, controller } = setup(); await controller.refresh(); controller.setRoot(first, 'C:\\example');
  rpc.rows[0].sessionId = 'replacement'; await controller.refresh(); await controller.send(first, 'text');
  assert.equal(controller.snapshot.sessions[0].scopeRoot, undefined);
  const bind = rpc.calls.find(c => c.method === 'jarvis.scope.bind')!.params;
  assert.equal(bind.role, 'memory'); assert.equal(bind.root, undefined);
  assert.equal(bind.userInput, 'text');
});
test('chat does not request admin-only provenance fields or permit Gateway slash controls', async () => {
  const { rpc, controller } = setup(); await controller.refresh();
  await assert.rejects(controller.send(first, '/reset'), e => e instanceof RpcError && e.code === 'CONTROL_COMMAND_DISABLED');
  await controller.send(first, 'ordinary chat');
  assert.equal(rpc.calls.find(c => c.method === 'jarvis.work.start')!.params.suppressCommandInterpretation, undefined);
});
test('wire v4 snapshot+delta is not double-counted; duplicates and background output are isolated', async () => {
  const { controller } = setup(); await controller.refresh();
  controller.event('chat', { runId: 'r', sessionKey: first, state: 'delta', seq: 1, message: { content: 'Hello' }, deltaText: 'Hello' });
  controller.event('chat', { runId: 'r', sessionKey: first, state: 'delta', seq: 2, deltaText: ' world' });
  controller.event('chat', { runId: 'r', sessionKey: first, state: 'delta', seq: 2, deltaText: ' duplicate' });
  assert.equal(controller.snapshot.streaming, 'Hello world');
  controller.event('chat', { runId: 'other', sessionKey: second, state: 'delta', seq: 1, message: { content: 'background' }, deltaText: 'background' });
  assert.equal(controller.snapshot.streaming, 'Hello world');
  controller.event('chat', { runId: 'r', sessionKey: first, state: 'delta', seq: 3, replace: true, deltaText: '' });
  assert.equal(controller.snapshot.streaming, '');
});
test('renderer projections omit keys, runtime params, model config and raw tool output', () => {
  assert.deepEqual(projectMessages([{ role: 'toolResult', content: 'secret' }, { role: 'system', content: 'system' }, { id: 'm', role: 'assistant', content: '<script>untrusted text</script>', apiKey: 'secret' }]), [{ id: 'm', role: 'assistant', text: '<script>untrusted text</script>' }]);
  const p = projectApproval({ id: 'approval', request: { sessionKey: first, runId: 'r', params: { token: 'hidden' } }, presentation: { title: 'Preview', description: 'Fixed target' }, token: 'hidden' }, 'plugin');
  assert.equal(p?.title, 'Preview'); assert.equal(JSON.stringify(p).includes('hidden'), false);
});
test('native approval array replay reads canonical sanitized get and never exposes raw request params', async () => {
  const { rpc, controller } = setup(); const original = rpc.request.bind(rpc);
  rpc.request = async (method, params, mutation) => {
    if (method === 'plugin.approval.list') return [{ id: 'real-reference', request: { sessionKey: first, runId: 'bound-run', params: { token: 'hidden' } } }];
    if (method === 'approval.get') return { approval: { id: 'real-reference', kind: 'plugin', status: 'pending', presentation: { title: 'Fixed action', description: 'Target', detail: 'SHA256 preview' } } };
    return original(method, params, mutation);
  };
  await controller.refresh();
  assert.equal(controller.snapshot.approvalsAvailable, true); assert.equal(controller.snapshot.approvals.length, 1);
  assert.equal(controller.snapshot.approvals[0].runId, 'bound-run'); assert.match(controller.snapshot.approvals[0].details, /SHA256 preview/);
  assert.equal(JSON.stringify(controller.snapshot).includes('hidden'), false);
});

test('independent heavy work uses a fresh native subagent session without writing or superseding its active parent', async () => {
  const { rpc, controller } = setup(); await controller.refresh(); await controller.select(second);
  controller.setRoot(second, 'C:\\separate-project');
  await controller.independent(second, 'independent work');
  const created = rpc.calls.find(c => c.method === 'sessions.create')!.params;
  assert.match(created.key, /^agent:main:subagent:jarvis:/);
  assert.equal(created.parentSessionKey, undefined); assert.equal(created.message, undefined);
  const bind = rpc.calls.find(c => c.method === 'jarvis.scope.bind')!.params;
  assert.equal(bind.projectId, second); assert.equal(bind.sessionKey, created.key);
  assert.equal(bind.root, 'C:\\separate-project');
  assert.equal(rpc.calls.find(c => c.method === 'jarvis.work.start')!.params.independent, true);
  assert.equal(rpc.calls.some(c => /abort|steer|reset/.test(c.method)), false);
  assert.equal(controller.snapshot.sessions.find(s => s.key === second)?.active, true);
});

test('steer/cancel IPC selects an exact retained task/revision; status and current output never trigger a model', async () => {
  const { rpc, controller } = setup(), original = rpc.request.bind(rpc);
  const work = { taskId: 'retained-task', projectId: 'p', projectRevision: 1, revision: 4, recordVersion: 12, agentId: 'main', sessionKey: second, sessionId: 'two', runId: 'exact-run', request: 'source', state: 'running', result: 'unverified', steering: {}, updatedAt: new Date().toISOString() };
  rpc.request = async (method, params, mutation) => {
    if (method === 'jarvis.work.status') { rpc.calls.push({ method, params, mutation: false }); return { records: [work], resources: [] }; }
    if (method === 'jarvis.work.read') { rpc.calls.push({ method, params, mutation: false }); return { output: { content: [{ type: 'text', text: 'actual native output' }] } }; }
    return original(method, params, mutation);
  };
  await controller.refresh(); await controller.workAction('workRead', 'retained-task');
  assert.equal(controller.snapshot.workOutput, 'actual native output');
  assert.equal(rpc.calls.some(c => c.mutation), false);
  await controller.workAction('steer', 'retained-task', 'new direction');
  const steer = rpc.calls.find(c => c.method === 'jarvis.work.steer')!.params;
  assert.equal(steer.taskId, work.taskId); assert.equal(steer.sessionKey, second); assert.equal(steer.expectedRevision, 4);
  await controller.workAction('cancel', 'retained-task');
  assert.equal(rpc.calls.find(c => c.method === 'jarvis.work.cancel')!.params.expectedRevision, 4);
  assert.equal(rpc.calls.some(c => ['agent', 'chat.send', 'jarvis.work.start'].includes(c.method)), false);
});
