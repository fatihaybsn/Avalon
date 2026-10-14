import { exactKeys, text, safePath, within, publicUrl, fingerprint, type Scope } from './policy.ts';
import path from 'node:path';
import {isGuiTool,guiParams,configuredGuiNode} from './gui-policy.ts';

export const QUICK_TOOLS = ['jarvis_windows', 'jarvis_recycle', 'jarvis_document', 'jarvis_draft'];
export const APPS = ['notepad', 'calculator', 'paint'];
export type QuickGrant = { tool: string; params: Record<string, unknown> };
export const operationHash = (p: unknown): string => fingerprint(sortJson(p));
function sortJson(p: unknown): unknown {
  if(Array.isArray(p))return p.map(sortJson);
  if(p && typeof p==='object')return Object.fromEntries(Object.entries(p).sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>[k,k==='path'&&typeof v==='string'?path.win32.normalize(v).toLowerCase():sortJson(v)]));
  return p;
}
export function quickParams(tool: string, p: Record<string, unknown>): Record<string, unknown> {
  if(isGuiTool(tool))return guiParams(tool,p);
  if (tool === 'jarvis_windows') {
    exactKeys(p, ['action', 'app', 'window', 'value']);
    const actions = ['resolve', 'open', 'status', 'focus', 'minimize', 'restore', 'close', 'audio_status', 'volume', 'mute', 'media', 'power_status', 'power'];
    if (!actions.includes(String(p.action))) throw new Error('Unknown Windows action');
    const appAction = actions.slice(0, 7).includes(String(p.action));
    if (appAction && !APPS.includes(String(p.app))) throw new Error('Host app catalog required');
    if (!appAction && p.app !== undefined) throw new Error('Unexpected app');
    if (['focus', 'minimize', 'restore', 'close'].includes(String(p.action))) {
      const w = p.window as Record<string, unknown>;
      if (!w || typeof w !== 'object' || Array.isArray(w)) throw new Error('Select exact observed window; clarify ambiguity with user');
      exactKeys(w, ['pid', 'started', 'exe', 'hwnd']);
      if (!Number.isSafeInteger(w.pid) || Number(w.pid) <= 0 || !/^\d+$/.test(String(w.started)) || !/^\d+$/.test(String(w.hwnd))) throw new Error('Invalid window identity');
      text(w.exe, 'exe');
    } else if (p.window !== undefined) throw new Error('Unexpected window');
    if (p.action === 'volume') { if (typeof p.value !== 'number' || !Number.isFinite(p.value) || p.value < 0 || p.value > 100) throw new Error('Volume 0..100'); }
    else if (p.action === 'mute') { if (typeof p.value !== 'boolean') throw new Error('Boolean mute required'); }
    else if (p.action === 'media') { if (!['play_pause', 'next', 'previous', 'stop'].includes(String(p.value))) throw new Error('Unknown media action'); }
    else if (p.action === 'power') { if (!['saver', 'balanced', 'performance'].includes(String(p.value))) throw new Error('Unknown power mode'); }
    else if (p.value !== undefined) throw new Error('Unexpected value');
  } else if (tool === 'jarvis_recycle' || tool === 'jarvis_document') {
    exactKeys(p, tool === 'jarvis_recycle' ? ['path'] : ['path', 'kind']);
    text(p.path, 'path', 2048);
    if (tool === 'jarvis_document' && !['text', 'pdf', 'office', 'image', 'ocr'].includes(String(p.kind))) throw new Error('Unknown document adapter');
  } else if (tool === 'jarvis_draft') {
    exactKeys(p, ['path', 'content', 'show']); text(p.path, 'path', 2048);
    if (typeof p.content !== 'string' || p.content.length > 100000 || (p.show !== undefined && typeof p.show !== 'boolean')) throw new Error('Bounded note required');
    if (!/\.txt$/i.test(String(p.path))) throw new Error('Draft must be a plain .txt note');
  } else if (tool === 'browser') {
    const action = String(p.action);
    const keys: Record<string, string[]> = {
      status: [], start: [], tabs: [], open: ['url'], navigate: ['url', 'targetId'],
      snapshot: ['targetId', 'maxChars', 'refs'], screenshot: ['targetId', 'fullPage'], text: ['targetId', 'maxChars'],
      focus: ['targetId'], close: ['targetId'], act: ['targetId', 'request']
    };
    if (!(action in keys)) throw new Error('Unsupported browser action');
    exactKeys(p, ['action', 'profile', 'target', 'node', ...keys[action]]);
    if (!['jarvis-visible', 'jarvis-background'].includes(String(p.profile)) || !['host','node'].includes(String(p.target))) throw new Error('Explicit managed profile/target required');
    if(p.target==='node'&&!/^[a-f0-9]{64}$/.test(String(p.node)))throw new Error('Exact native browser node ID required');
    if(p.target==='host'&&p.node!==undefined)throw new Error('Host browser cannot carry a node selector');
    if (['open', 'navigate'].includes(action) && !(action==='open' && p.url==='about:blank')) publicUrl(p.url);
    if (!['status', 'start', 'tabs', 'open'].includes(action) && !/^[a-fA-F0-9]{32}$/.test(text(p.targetId, 'exact observed CDP tab ID', 128))) throw new Error('Observed CDP target ID required; aliases/labels are not resource identities');
    if (p.maxChars !== undefined && (!Number.isSafeInteger(p.maxChars) || Number(p.maxChars) < 1 || Number(p.maxChars) > 20000)) throw new Error('Bounded snapshot required');
    if (p.refs !== undefined && !['aria', 'role'].includes(String(p.refs))) throw new Error('Invalid refs');
    if (p.fullPage !== undefined && typeof p.fullPage !== 'boolean') throw new Error('Invalid screenshot');
    if (action === 'act') {
      const r = p.request as Record<string, unknown>;
      if (!r || typeof r !== 'object') throw new Error('Request required');
      if(r.kind==='click'||r.kind==='type')throw new Error('Browser submit/payment parameters cannot be frozen by this generic action; use a concrete native service operation');
      // No JS, generic key chords, coordinate clicks, uploads, downloads or batches.
      if (r.kind === 'click') exactKeys(r, ['kind', 'ref']);
      else if (r.kind === 'type') { exactKeys(r, ['kind', 'ref', 'text']); if (typeof r.text !== 'string' || r.text.length > 4096) throw new Error('Bounded text required'); }
      else if (r.kind === 'hover') exactKeys(r, ['kind', 'ref']);
      else throw new Error('Browser interaction unavailable');
      text(r.ref, 'fresh snapshot ref', 128);
    }
  } else throw new Error('Unknown narrow tool');
  return structuredClone(p);
}
export function quickGrants(value: unknown): QuickGrant[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > 24) throw new Error('At most 24 exact operator operations');
  return value.map(g => { if (!g || typeof g !== 'object') throw new Error('Invalid grant'); exactKeys(g, ['tool', 'params']); return { tool: text(g.tool, 'tool'), params: quickParams(g.tool, g.params) }; });
}
export async function quickDecision(tool: string, input: Record<string, unknown>, scope: Scope) {
  const p = quickParams(tool, input);
  if(tool==='browser'&&configuredGuiNode()&&(p.target!=='node'||p.node!==configuredGuiNode()))throw new Error('Stage08 browser is pinned to the interactive native node; no silent host fallback');
  if (!scope.quick?.some(g => g.tool === tool && operationHash(g.params) === operationHash(p))) throw new Error('Exact authenticated operator operation required');
  if(tool==='browser' && p.profile==='jarvis-background' && /görerek|görünür|ekranda göster/i.test(scope.userStatement ?? '')) throw new Error('Visible request cannot become headless');
  if (p.path) {
    p.path = await safePath(p.path);
    if (!scope.root || !within(scope.root, String(p.path)) || String(p.path).toLowerCase() === scope.root.toLowerCase()) throw new Error('Exact file must stay below project root');
  }
  // Every browser interaction can send data/submit/payment; always a frozen,
  // manual native approval. Close never chooses an unsaved-data dialog.
  const critical = tool === 'jarvis_recycle' || tool === 'jarvis_windows' && p.action === 'close' || tool === 'browser' && ['act', 'close'].includes(String(p.action));
  return { params: p, ...(critical ? { requireApproval: { title: 'JARVIS: exact operation', description: `${tool} ${JSON.stringify(p)}; task ${scope.taskId}; hash ${operationHash(p)}. Click/type can submit data/payment; manual allow-once only.`.slice(0,512), severity: 'critical' as const, allowedDecisions: ['allow-once', 'deny'] as Array<'allow-once' | 'deny'>, timeoutMs: 60000 } } : {}) };
}
