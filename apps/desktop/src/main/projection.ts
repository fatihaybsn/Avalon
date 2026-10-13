import type { Message, Session, Approval } from '../shared/contracts.ts';
export function record(v: unknown): Record<string, any> { return v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, any> : {}; }
export function text(v: unknown, max = 16000) { return typeof v === 'string' ? v.slice(0, max) : ''; }
export function messageText(value: unknown) {
  const m = record(value);
  if (typeof m.content === 'string') return text(m.content, 50000);
  if (Array.isArray(m.content)) return m.content.filter((b: any) => ['text', 'input_text', 'output_text'].includes(b?.type)).map((b: any) => text(b.text, 50000)).join('\n').slice(0, 50000);
  return text(m.text, 50000);
}
export function projectMessages(values: unknown): Message[] {
  if (!Array.isArray(values)) return [];
  return values.slice(-100).flatMap((v, index) => {
    const m = record(v);
    if (!['user', 'assistant'].includes(m.role)) return [];
    const t = messageText(m);
    return t ? [{ id: text(m.id ?? m.messageId) || `history-${index}`, role: m.role, text: t }] : [];
  });
}
export function projectSession(v: unknown): Session | undefined {
  const s = record(v);
  if (typeof s.key !== 'string' || typeof s.sessionId !== 'string') return;
  return { key: text(s.key, 256), sessionId: text(s.sessionId, 256), title: text(s.displayName ?? s.label ?? s.derivedTitle ?? s.key, 160), active: s.hasActiveRun === true, runIds: Array.isArray(s.activeRunIds) ? s.activeRunIds.map((r: any) => text(r, 256)).filter(Boolean) : [], queued: s.hasQueuedRun === true || s.queuedCount > 0 };
}
export function projectApproval(v: unknown, kind: string): Approval | undefined {
  const a = record(v), request = record(a.request), p = record(a.presentation ?? request.presentation ?? request);
  if (typeof a.id !== 'string') return;
  const source = record(a.source);
  const details = [text(p.description ?? p.warningText, 4000), text(p.detail ?? p.details, 16000)].filter(Boolean).join('\n');
  return { id: text(a.id, 256), kind: text(a.kind ?? a.approvalKind) || kind, status: text(a.status) || 'pending', title: text(p.title ?? p.commandPreview ?? p.commandText, 200) || 'OpenClaw onayı', details, sessionKey: text(a.sessionKey ?? source.sessionKey ?? request.sessionKey) || undefined, runId: text(a.runId ?? source.runId ?? request.runId) || undefined, expiresAtMs: typeof a.expiresAtMs === 'number' ? a.expiresAtMs : undefined };
}
