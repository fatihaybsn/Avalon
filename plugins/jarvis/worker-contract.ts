import fs from 'node:fs/promises';
import path from 'node:path';
import {text,workText,type Scope} from './policy.ts';
export type WorkerBinding={scope:Scope;assertCurrent:()=>void;signal:AbortSignal};
export const WORKER_DEFAULTS={codex:{model:'openai/gpt-6-luna',thinking:'xhigh'},opencode:{model:'opencode/space-bunny-free',thinking:'max'}} as const;
export function workerSettings(p:Record<string,unknown>,scope:Scope,worker:'codex'|'opencode') {
 const statement=scope.userStatement??'';
 const qualified=statement.match(/\b(?:openai|opencode)\/[a-zA-Z0-9._-]+\b/i)?.[0];
 const nativeCodexName=worker==='codex'?statement.match(/\bgpt-[a-zA-Z0-9._-]+\b/i)?.[0]:undefined;
 const named=nativeCodexName?`openai/${nativeCodexName}`:worker==='codex'&&/\bluna\s*6\b/i.test(statement)?'openai/gpt-6-luna':worker==='opencode'&&/\b(?:space-bunny-free|space\s+bunny\s+free)\b/i.test(statement)?'opencode/space-bunny-free':undefined;
 const effort=statement.match(/\b(none|off|low|medium|high|xhigh|max)\b/i)?.[1]?.toLowerCase();
 const model=text(qualified??named??p.model??WORKER_DEFAULTS[worker].model,'selected worker model',160);
 const thinking=text(effort??p.thinking??WORKER_DEFAULTS[worker].thinking,'thinking',16);
 if(!['none','off','low','medium','high','xhigh','max'].includes(thinking))throw new Error('Unsupported thinking choice; no fallback');
 return {model,thinking};
}
export const WORKER_INSTRUCTIONS='You are the user-selected external coding worker. OpenClaw owns the task and permissions; JARVIS/Space Bunny plans and reviews. Implement the smallest sufficient solution to the supplied request in projectRoot. Perform ordinary edits, terminal/dependency/Git reads and relevant checks without repeated questions. Ask real missing user choices through native forms; never fabricate or answer a human permission. Preserve the selected model/provider. Do not alter JARVIS control files, shared memory or credentials. Return concrete changed files/diff, checks and remaining limitations. Full access is explicitly selected; cwd is not OS isolation. Native completion is not user acceptance.';
export const WORKER_GUIDANCE='As the JARVIS main manager, carry out authorized file, terminal and PC operations through the current task\'s OpenClaw MCP tools. Use openclaw_read, openclaw_write and openclaw_edit for files, with the schemas supplied in the active catalog. OpenCode native read is an unreachable-path compatibility entry only; never use it for real work. Do not substitute native read, shell or other local tools for an unavailable OpenClaw tool; report the blocker. Delegate through jarvis_worker only when the original user request explicitly selects that coding worker. Use the simplest sufficient method for the current user goal. Research, architecture and phases only when requested or needed. Preserve the explicitly selected worker/model. For an explicitly selected coding worker, use jarvis_worker to hand off request, purpose, scope, relevant context, output and verification with the current projectRoot/revision. Review actual results, changed files/diff and checks against requirements before the next prompt. Execution ended is not acceptance. Wait/read the same worker for ongoing work; never end the managing turn claiming an unfinished worker succeeded. Correct the same job when needed. New user conditions require a current accepted revision. Record concise explained rationale and concrete changes, not hidden reasoning. Native permission/forms/preferences belong to the real user; do not answer them. If the user wants visible Notepad requirements, use the existing guarded jarvis_draft/Windows tools first. No fixed number of prompts or separate mode classifier. Unavailable worker stays unavailable; no silent fallback.';
export async function workerContract(p:Record<string,unknown>,scope:Scope,revision:number,worker:'codex'|'opencode') {
 if(scope.role!=='project'||!scope.root)throw new Error('Current project task required');
 if(p.worker!==worker||p.expectedRevision!==revision)throw new Error('Explicit worker choice and current revision required');
 if(typeof p.projectRoot!=='string'||path.win32.normalize(p.projectRoot).toLowerCase()!==path.win32.normalize(scope.root).toLowerCase())throw new Error('Project root differs from admitted task');
 const root=await fs.realpath(scope.root);if(!(await fs.stat(root)).isDirectory())throw new Error('Project directory required');
 const {model,thinking}=workerSettings(p,scope,worker);
 if(!/^[\w.-]+\/[\w.-]+$/.test(model)||worker==='codex'&&!model.startsWith('openai/')||worker==='opencode'&&!model.startsWith('opencode/'))throw new Error('Unsupported explicit model/provider; no fallback');
 const contract=Object.fromEntries(['request','purpose','scope','context','output','verification'].map(k=>[k,workText(p[k],k,k==='context'?12000:4000)]));
 return {...contract,worker,projectRoot:root,model,thinking,permissionMode:'full',taskId:scope.taskId,projectId:scope.projectId,revision};
}
export function selectedWorker(scope:Scope) {
 const matches=[...new Set(scope.userStatement?.match(/\b(codex|open\s*cod[e]?)\b/gi)?.map(s=>s.toLowerCase()==='codex'?'codex':'opencode')??[])];
 if(matches.length!==1)throw new Error('Current original user request must select one worker; ask user rather than choose or switch');
 return matches[0] as 'codex'|'opencode';
}
