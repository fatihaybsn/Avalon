import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { exactKeys, text, type Scope, within } from './policy.ts';

export const NOTE_TOOLS = ['jarvis_note_read', 'jarvis_note_write'];
export const MEMORY_TOOLS = ['jarvis_memory_search', 'jarvis_memory_get', ...NOTE_TOOLS];
export type Origin = { kind: 'user' | 'model' | 'web'; userId: string; taskId: string; projectId: string; sessionId: string; sessionKey: string; runId: string; deviceId: string; userInputHash?: string };
type Reference = { id: string; revision: number };
export type Note = { id: string; revision: number; recordedAt: string; origin: Origin; category: string; content: string; sources: string[]; derivedFrom: Reference[]; artifacts: string[]; supersedes?: Reference; priorPath?: string };
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const revName = (n: number) => `r${String(n).padStart(8, '0')}.md`;
const recordPath = (id: string, n: number) => `memory/records/${id}/${revName(n)}`;
function idCheck(id: unknown): string { if (typeof id !== 'string' || !uuid.test(id)) throw new Error('Invalid record id'); return id; }
function revision(n: unknown): number { if (!Number.isSafeInteger(n) || Number(n) < 0 || Number(n) > 99999998) throw new Error('Invalid revision'); return Number(n); }
// Synchronous final effect: no await between authority recheck, CAS and exclusive
// publication. Immutable revisions also provide cross-process CAS with O_EXCL.
function checked(workspace: string, relative: string, make = false): string {
  const root = path.resolve(workspace);
  const absolute = path.resolve(root, relative);
  if (!within(root, absolute)) throw new Error('Outside memory workspace');
  let cursor = path.parse(absolute).root;
  for (const part of absolute.slice(cursor.length).split(path.sep)) {
    cursor = path.join(cursor, part);
    if (make && cursor !== absolute && !fs.existsSync(cursor)) { try { fs.mkdirSync(cursor); } catch (e) { if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e; } }
    if (fs.existsSync(cursor)) { const s = fs.lstatSync(cursor); if (s.isSymbolicLink() || (s.isFile() && s.nlink !== 1)) throw new Error('Linked memory path refused'); }
  }
  return absolute;
}
export function readNote(workspace: string, id: unknown, wanted?: number): Note {
  const valid = idCheck(id);
  const folder = checked(workspace, `memory/records/${valid}`);
  const names = fs.readdirSync(folder).filter(n => /^r\d{8}\.md$/.test(n)).sort();
  if (!names.length) throw new Error('Record missing');
  const filename = wanted === undefined ? names.at(-1)! : revName(revision(wanted));
  const raw = fs.readFileSync(checked(workspace, `memory/records/${valid}/${filename}`), 'utf8');
  const first = raw.split('\n')[0];
  const note = JSON.parse(first.slice('<!-- jarvis-note '.length, -' -->'.length)) as Note;
  if (!first.startsWith('<!-- jarvis-note ') || note.id !== valid || revName(note.revision) !== filename) throw new Error('Corrupt note; no overwrite');
  return note;
}
export function writeNote(workspace: string, input: Record<string, unknown>, origin: Origin, assertCurrent: () => void, root?: string): { note: Note; path: string } {
  exactKeys(input, ['id', 'expectedRevision', 'category', 'content', 'sources', 'derivedFrom', 'artifacts']);
  const expected = revision(input.expectedRevision);
  const id = input.id === undefined ? randomUUID() : idCheck(input.id);
  if (input.id === undefined && expected !== 0) throw new Error('New record requires revision 0');
  const category = text(input.category, 'category');
  if (!['preference', 'decision', 'correction', 'finding', 'inference'].includes(category)) throw new Error('Invalid category');
  if (origin.kind !== 'user' && ['preference', 'decision', 'correction'].includes(category)) throw new Error('User statements require admitted operator RPC, never model labels');
  const content = text(input.content, 'short note', 1800);
  const strings = (value: unknown, name: string): string[] => { if (value === undefined) return []; if (!Array.isArray(value) || value.length > 8) throw new Error(`Invalid ${name}`); return value.map(v => text(v, name, 2048)); };
  const sources = strings(input.sources, 'sources');
  for (const s of sources) { const url = new URL(s); if (url.protocol !== 'https:' || url.username || url.password) throw new Error('Source must be HTTPS without credentials'); }
  if (origin.kind === 'web' && !sources.length) throw new Error('Web source required');
  const artifacts = strings(input.artifacts, 'artifacts');
  for (const artifact of artifacts) { if (!root || !path.isAbsolute(artifact) || !within(root, artifact)) throw new Error('Artifact outside project'); const target = checked(root, path.relative(root, artifact)); if (!fs.statSync(target).isFile()) throw new Error('Artifact must be an existing project file'); }
  if (input.derivedFrom !== undefined && (!Array.isArray(input.derivedFrom) || input.derivedFrom.length > 8)) throw new Error('Invalid derivation');
  const derivedFrom = ((input.derivedFrom ?? []) as Record<string, unknown>[]).map(r => { exactKeys(r, ['id', 'revision']); const ref = { id: idCheck(r.id), revision: revision(r.revision) }; readNote(workspace, ref.id, ref.revision); return ref; });
  let prior: Note | undefined;
  try { prior = readNote(workspace, id); } catch (e) { if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e; }
  if ((prior?.revision ?? 0) !== expected) throw new Error('REVISION_CONFLICT: reread latest record; prior information preserved');
  if (prior && prior.origin.userId !== origin.userId) throw new Error('Record belongs to another principal');
  if (prior && origin.kind !== 'user' && (prior.origin.kind === 'user' || prior.origin.projectId !== origin.projectId)) throw new Error('Model/web cannot supersede a user statement or another project record');
  const note: Note = { id, revision: expected + 1, recordedAt: new Date().toISOString(), origin: { ...origin }, category, content, sources, derivedFrom, artifacts, ...(prior ? { supersedes: { id, revision: prior.revision }, priorPath: recordPath(id, prior.revision) } : {}) };
  const rel = recordPath(id, note.revision);
  assertCurrent();
  const target = checked(workspace, rel, true);
  const metadata = JSON.stringify(note).replaceAll('<', '\\u003c').replaceAll('>', '\\u003e');
  const body = `<!-- jarvis-note ${metadata} -->\n# ${category} — ${id} / revision ${note.revision}\n\n${content}\n\nSource kind: ${origin.kind}; user: ${origin.userId}; task: ${origin.taskId}; project: ${origin.projectId}; date: ${note.recordedAt}.\n${prior ? `Supersedes: ${note.priorPath}\n` : ''}Sources: ${sources.join(', ')}\nDerived from: ${derivedFrom.map(r => recordPath(r.id, r.revision)).join(', ')}\nArtifacts (stored separately): ${artifacts.join(', ')}\n`;
  assertCurrent();
  try { fs.writeFileSync(target, body, { flag: 'wx', encoding: 'utf8' }); }
  catch (e) { if ((e as NodeJS.ErrnoException).code === 'EEXIST') throw new Error('REVISION_CONFLICT: concurrent write; prior information preserved'); throw e; }
  return { note, path: rel };
}
export function originFor(scope: Scope, kind: Origin['kind']): Origin {
  const { userId, taskId, projectId, sessionId, sessionKey, runId, deviceId } = scope;
  return { kind, userId, taskId, projectId, sessionId, sessionKey, runId, deviceId };
}
// Reject superseded markers retained by earlier derived source files.
export function currentDerivedText(workspace: string, textValue: string) {
  const markers = textValue.matchAll(/JARVIS_(?:NOTE_CURRENT|CURRENT|ACTIVE)_([0-9a-f_]{36})_R(\d{8})/g);
  for (const marker of markers) {
    const note = readNote(workspace, marker[1].replaceAll('_', '-'));
    if (note.revision !== Number(marker[2]) || note.origin.kind !== 'user' || !['preference', 'decision', 'correction'].includes(note.category)) return false;
  }
  return true;
}
export function memoryParams(name: string, params: Record<string, unknown>) {
  if (name === 'jarvis_memory_search') { exactKeys(params, ['query']); return { query: text(params.query, 'query', 256) }; }
  if (name === 'jarvis_memory_get') {
    exactKeys(params, ['path', 'from', 'lines']); const p = text(params.path, 'memory path', 512);
    if (!/^(MEMORY\.md|USER\.md|memory\/(?:[a-zA-Z0-9_-]+\/)*[a-zA-Z0-9_-]+\.md)$/.test(p)) throw new Error('Only source note paths');
    const from = params.from ?? 1, lines = params.lines ?? 30;
    if (!Number.isSafeInteger(from) || Number(from) < 1 || !Number.isSafeInteger(lines) || Number(lines) < 1 || Number(lines) > 80) throw new Error('Invalid bounded read');
    return { path: p, from, lines };
  }
  if (name === 'jarvis_note_read') { exactKeys(params, ['id']); return { id: idCheck(params.id) }; }
  if (name === 'jarvis_note_write') { exactKeys(params, ['id', 'expectedRevision', 'category', 'content', 'source', 'sources', 'derivedFrom', 'artifacts']); if (params.source !== undefined && params.source !== 'user' && params.source !== 'task') throw new Error('Invalid source'); return structuredClone(params); }
  throw new Error('Unknown memory tool');
}
