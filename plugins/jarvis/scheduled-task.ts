import {makeScope, type Scope} from './policy.ts';

// These are restrictions within native cron's captured executable tool cap.
// One-use human decisions, worker selection and external effects are not inherited.
export const SCHEDULED_TASK_TOOLS=['read','write','edit','jarvis_work_read','jarvis_work_note','jarvis_memory_search','jarvis_memory_get','jarvis_note_read'];
export function consumeScheduledAdmission(store:{getRunContext(p:{runId:string;namespace:string}):unknown;setRunContext(p:{runId:string;namespace:string;value:{consumed:boolean}}):boolean},runId:string) {
  const key={runId,namespace:'scheduled-admission'};
  if(store.getRunContext(key)||!store.setRunContext({...key,value:{consumed:true}}))throw new Error('Scheduled task authority already consumed or revoked; no replay');
}
export function scheduledTaskDescription(purpose:string,scope:Partial<Scope>,tools:unknown[]) {
  if(scope.role!=='project'||!scope.root||!scope.userId||!scope.deviceId||!scope.projectId||!scope.taskId||!tools.length||tools.some(t=>typeof t!=='string'||!SCHEDULED_TASK_TOOLS.includes(t)))throw new Error('Complex automation requires the current admitted project and supported native tool cap');
  return JSON.stringify({jarvisScheduledTask:1,purpose,sessionKey:scope.sessionKey,userId:scope.userId,deviceId:scope.deviceId,projectId:scope.projectId,parentTaskId:scope.taskId,root:scope.root,tools:[...new Set(tools)],timezone:'Europe/Istanbul',delivery:scope.sessionKey});
}
export async function scheduledTaskScope(admission:{jobId:string;runId:string;sessionKey:string;sessionId:string;agentId:string;job:{description?:string;owner?:{sessionKey?:string};createdActor?:{id?:string};scheduledToolPolicy?:{mode?:string};toolsAllowProvenance?:{source?:string};payload:{toolsAllow?:string[];model?:string;fallbacks?:string[]}}}) {
  const a=admission;let data:any;try{data=JSON.parse(a.job.description??'');}catch{return undefined;}
  if(data?.jarvisScheduledTask!==1)return undefined;
  const tools=a.job.payload.toolsAllow;
  if(a.job.payload.model!=='opencode/space-bunny-free'||!Array.isArray(a.job.payload.fallbacks)||a.job.payload.fallbacks.length)throw new Error('Scheduled task must retain Space Bunny through OpenCode without fallback');
  if(a.agentId!=='main'||data.sessionKey!==a.sessionKey||a.job.owner?.sessionKey!==a.sessionKey||a.job.createdActor?.id!==data.userId||a.job.scheduledToolPolicy?.mode!=='account'||a.job.toolsAllowProvenance?.source!=='final-executable-surface'||!Array.isArray(tools)||!tools.length||JSON.stringify(tools)!==JSON.stringify(data.tools)||tools.some(t=>!SCHEDULED_TASK_TOOLS.includes(t)))throw new Error('Scheduled task is outside its native creator/session/tool admission');
  const scope=await makeScope({runId:a.runId,projectId:data.projectId,taskId:`cron:${a.jobId}:${a.runId}`,role:'project',root:data.root,ttlMs:3_600_000},{agentId:a.agentId,sessionKey:a.sessionKey,sessionId:a.sessionId,userId:data.userId,deviceId:data.deviceId});
  // Never turn the old scheduling statement into a fresh human request/approval.
  return {scope,tools};
}
