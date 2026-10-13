import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { readNote, noteView, currentDerivedText } from './notes.ts';

type Candidate = { key: string; text: string; resultEntry: string; sourceRef: string; [key: string]: unknown };
export type SelectedDream = { prompt: string; keys: string[]; sources: string[]; visibleEntries: string[]; assertCurrent: () => void };
export function selectDiaryContext(workspace: string, raw: string): SelectedDream {
  if (!raw.startsWith('Write a dream diary entry from these memory fragments:')) throw new Error('Unexpected memory inference; cloud withheld');
  const snippets = [...new Set(raw.split('\n').filter(line => line.startsWith('- JARVIS_NOTE_CURRENT_')).map(line => line.slice(2)))];
  if (!snippets.length || snippets.length > 6) throw new Error('No bounded selected diary sources');
  const pinned = snippets.map(snippet => {
    const match = /^JARVIS_NOTE_CURRENT_([0-9a-f_]{36})_R(\d{8})\b/.exec(snippet);
    if (!match) throw new Error('Invalid diary source');
    const note = readNote(workspace, match[1].replaceAll('_', '-'));
    const view = noteView(workspace, note);
    if (!view || note.revision !== Number(match[2]) || view.text.trim() !== snippet) throw new Error('Stale diary source');
    return { id: note.id, revision: note.revision, view };
  });
  const assertCurrent = () => { for (const p of pinned) if (readNote(workspace, p.id).revision !== p.revision || fs.readFileSync(path.join(workspace, p.view.path), 'utf8') !== p.view.text) throw new Error('Diary source changed'); };
  assertCurrent();
  return { prompt: `Write a dream diary entry from these memory fragments:\n${snippets.map(s => `- ${s}`).join('\n')}`, keys: [], sources: pinned.map(p => `${p.view.path}#L1-L1`), visibleEntries: [], assertCurrent };
}
export function selectDreamContext(workspace: string, raw: string): SelectedDream {
  const data = JSON.parse(raw) as { currentMemory?: unknown; candidates?: unknown };
  if (typeof data.currentMemory !== 'string' || !Array.isArray(data.candidates) || !data.candidates.length || data.candidates.length > 6) throw new Error('Unsupported native Dreaming prompt; cloud withheld');
  const candidates = data.candidates as Candidate[];
  const pinned = candidates.map(c => {
    if (!c || typeof c.key !== 'string' || typeof c.text !== 'string' || typeof c.resultEntry !== 'string' || typeof c.sourceRef !== 'string') throw new Error('Invalid native candidate');
    const match = /^memory\/current\/\d{4}-\d{2}-\d{2}-([0-9a-f-]{36})-r\d{8}\.md#L1-L[12]$/.exec(c.sourceRef);
    if (!match) throw new Error('Only selected one-line daily note sources may reach the cloud');
    const note = readNote(workspace, match[1]);
    const view = noteView(workspace, note);
    if (!view || !c.sourceRef.startsWith(`${view.path}#L1-L`) || c.text !== view.text.trim() || !c.resultEntry.includes(view.marker)) throw new Error('Stale/unselected native candidate');
    const target = path.join(workspace, view.path);
    const stat = fs.lstatSync(target);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 || fs.readFileSync(target, 'utf8') !== view.text) throw new Error('Native source view changed');
    return { id: note.id, revision: note.revision, target, text: view.text, content: note.content };
  });
  const words = new Set(pinned.flatMap(p => p.content.toLocaleLowerCase('tr').match(/[\p{L}\p{N}]{4,}/gu) ?? []));
  const visibleEntries = data.currentMemory.split(/\r?\n/).map(line => line.trim()).filter(line => {
    if (!line || line.startsWith('#') || line.startsWith('<!--') || line === '```') return false;
    if (!currentDerivedText(workspace, line)) return false;
    return pinned.some(p => line.includes(p.id) || line.includes(p.id.replaceAll('-', '_'))) || (line.toLocaleLowerCase('tr').match(/[\p{L}\p{N}]{4,}/gu) ?? []).some(word => words.has(word));
  }).slice(0, 12);
  if (visibleEntries.join('\n').length > 4000) throw new Error('Related memory context exceeds cloud budget');
  const assertCurrent = () => {
    for (const p of pinned) if (readNote(workspace, p.id).revision !== p.revision || fs.readFileSync(p.target, 'utf8') !== p.text) throw new Error('REVISION_CONFLICT: source corrected while Dreaming was running');
  };
  assertCurrent();
  return { prompt: JSON.stringify({ currentMemory: visibleEntries.join('\n'), candidates: candidates.map(c => ({ key: c.key, text: c.text, resultEntry: c.resultEntry, sourceRef: c.sourceRef })) }), keys: candidates.map(c => c.key), sources: candidates.map(c => c.sourceRef), visibleEntries, assertCurrent };
}
export function validateDreamDecision(selected: SelectedDream, raw: string) {
  selected.assertCurrent();
  const data = JSON.parse(raw);
  if (!data || Object.keys(data).join(',') !== 'operations' || !Array.isArray(data.operations) || data.operations.length !== selected.keys.length) throw new Error('Invalid structured model decision');
  const remaining = new Set(selected.keys);
  for (const op of data.operations) {
    if (!op || Object.keys(op).some(k => !['candidateKey', 'action', 'priorEntries'].includes(k)) || !remaining.delete(op.candidateKey) || !['added', 'merged', 'superseded'].includes(op.action) || !Array.isArray(op.priorEntries) || op.priorEntries.some((line: unknown) => typeof line !== 'string' || !selected.visibleEntries.includes(line)) || (op.action === 'added' ? op.priorEntries.length !== 0 : op.priorEntries.length === 0)) throw new Error('Model attempted an unseen entry or invalid operation');
  }
  return { keys: selected.keys, sources: selected.sources, actions: data.operations.map((op: { action: string }) => op.action), digest: createHash('sha256').update(raw).digest('hex') };
}
