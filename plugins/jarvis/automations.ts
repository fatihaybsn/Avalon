import type {Scope} from './policy.ts';
import {workText} from './policy.ts';
import {scheduledTaskDescription} from './scheduled-task.ts';
export type SessionAutomationRequest={sessionKey:string;agentId:string;action:'list'|'get'|'runs'|'add'|'update'|'remove';jobId?:string;job?:Record<string,unknown>;expectedConfigRevision?:string;offset?:number};
export async function dispatchSessionAutomation(input:SessionAutomationRequest){
  const sdk=await import('openclaw/plugin-sdk/gateway-method-runtime');
  const call=(sdk as unknown as {dispatchSessionAutomation?:(p:SessionAutomationRequest)=>Promise<{ok:boolean;payload?:unknown;error?:{message?:string}}>}).dispatchSessionAutomation;
  if(!call)throw new Error('Selected native session-automation extension is not installed; no admin/model fallback');
  const r=await call(input);if(!r.ok)throw new Error(r.error?.message??'Native automation refused; read current state before retry');return r.payload as any;
}

const keys=(value:Record<string,unknown>,allowed:string[])=>{if(Object.keys(value).some(k=>!allowed.includes(k)))throw new Error('Automation field outside selected native contract');};
const object=(value:unknown):Record<string,unknown>=>{if(!value||typeof value!=='object'||Array.isArray(value))throw new Error('Automation object required');return value as Record<string,unknown>;};
const bounded=(value:unknown,max=1800)=>{if(typeof value!=='string'||!value.trim()||value.length>max||/[\x00-\x1f]/.test(value))throw new Error('Bounded automation text required');return value;};
export const AUTOMATION_GUIDANCE='Use the native automations tool for explicitly requested reminders/schedules only. No planning/subagent/worker for a simple reminder. Europe/Istanbul wall time; at timestamps require +03:00. Supply purpose in description, concrete task, current private conversation delivery, and explicit toolsAllow (empty for reminders). Complex scheduled tasks require the current admitted project root; select only needed read/write/edit, jarvis_work_read/jarvis_work_note, jarvis_memory_search/jarvis_memory_get/jarvis_note_read tools. The host records the actual project constraints; a prompt cannot grant another path, external-send/payment/worker authority or a fresh user decision. Prepare complex prompts through the existing Space Bunny/OpenCode task only as needed. Native cron captures the executable cap; a later occurrence restores only its own project scope and writes results to this conversation. Never create shell/script/stream/webhook jobs. Never recreate a known job after an ambiguous mutation or not-found; read native state. Purpose/prompt edits must include an explicit payload; time/name/pause edits may omit it. Native cron owns identity, grants, revision conflict checks, persistence, catch-up and retries. Never claim a missed/offline job ran.';

export function automationParams(input:Record<string,unknown>,scope:Pick<Scope,'sessionKey'|'userStatement'|'role'>&Partial<Scope>){
  if(scope.role==='research')throw new Error('Research cannot schedule actions');
  keys(input,['action','jobId','job','includeDisabled','limit','offset','runId']);
  const action=bounded(input.action,24),statement=scope.userStatement??'';
  if(!['status','list','get','runs','add','update','remove'].includes(action))throw new Error('Unsupported automation operation; no force-run/replay');
  const p=structuredClone(input);
  if(['get','runs','update','remove'].includes(action))bounded(p.jobId,128);
  if(['add','update','remove'].includes(action)){
    if(!/(hatırlat|otomasyon|zamanla|remind|automation|schedule)/iu.test(statement)||/^(?:araştır|ara|kontrol et)\s*:/iu.test(statement))throw new Error('Explicit current user automation request required');
    if(action!=='add'&&!statement.includes(String(p.jobId)))throw new Error('User must identify the exact automation before changing it');
  }
  if(action==='remove'&&!/(kaldır|sil|remove|delete)/iu.test(statement))throw new Error('Explicit removal required');
  if(['add','update'].includes(action)){
    const j=object(p.job);keys(j,['name','description','enabled','schedule','sessionTarget','sessionKey','agentId','payload','delivery']);
    if(j.delivery!==undefined){const d=object(j.delivery);keys(d,['mode']);if(d.mode!=='announce')throw new Error('Only native private conversation commit supported');}
    if(j.agentId!==undefined&&j.agentId!=='main'||j.sessionKey!==undefined&&j.sessionKey!==scope.sessionKey||j.sessionTarget!==undefined&&j.sessionTarget!=='current')throw new Error('Only this private conversation may be targeted');
    if(action==='add'){
      bounded(j.name,120);bounded(j.description);object(j.schedule);object(j.payload);
      j.agentId='main';j.sessionKey=scope.sessionKey;j.sessionTarget='current';
      j.delivery={mode:'announce'};
    }
    if(j.enabled!==undefined&&typeof j.enabled!=='boolean')throw new Error('Boolean enabled required');
    if(j.schedule!==undefined){
      const s=object(j.schedule);
      if(s.kind==='at'){
        keys(s,['kind','at']);const at=bounded(s.at,40);
        if(!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:00\+03:00$/.test(at)||!Number.isFinite(Date.parse(at))||Date.parse(at)<=Date.now())throw new Error('Future Europe/Istanbul +03:00 timestamp required');
        if(!statement.includes(at.slice(0,10))||!statement.includes(at.slice(11,16)))throw new Error('Exact user date and time required');
      }else if(s.kind==='cron'){
        keys(s,['kind','expr','tz','staggerMs']);
        const m=/^(\d{1,2}) (\d{1,2}) \* \* (\*|[0-6])$/.exec(String(s.expr));
        if(!m||Number(m[1])>59||Number(m[2])>23||s.tz!=='Europe/Istanbul'||s.staggerMs!==undefined&&s.staggerMs!==0)throw new Error('Only exact daily/weekly Europe/Istanbul schedule supported');
        const hh=m[2].padStart(2,'0')+':'+m[1].padStart(2,'0');
        const days=['pazar','pazartesi','salı','çarşamba','perşembe','cuma','cumartesi'];
        if(!statement.includes(hh)||m[3]==='*'&&!/her gün|günlük/iu.test(statement)||m[3]!=='*'&&!new RegExp('(?:^|\\s)'+days[Number(m[3])]+'(?:\\s|$|[,.;])','iu').test(statement))throw new Error('Exact user daily/weekly time required');
        s.staggerMs=0;
      }else throw new Error('Only one-shot/daily/weekly scheduling supported');
    }
    if(j.payload!==undefined){
      const payload=object(j.payload);keys(payload,['kind','message','toolsAllow']);
      if(payload.kind!=='agentTurn'||!Array.isArray(payload.toolsAllow))throw new Error('Explicit native agentTurn tool cap required');
      workText(payload.message,'automation message',1800);
      if(payload.toolsAllow.length){
        if(!/(otomasyon|zamanla|automation|schedule)/iu.test(statement)||!/(dosya|rapor|belge|proje|özet|düzenle|üret|file|report|read|write)/iu.test(statement))throw new Error('A reminder cannot grant tool effects; explicit scheduled project work required');
        j.description=scheduledTaskDescription(bounded(j.description),scope,payload.toolsAllow);
        payload.model='opencode/space-bunny-free';payload.fallbacks=[];
        payload.message=String(payload.message)+'\nBu zamanlanmış iş yalnız kayıtlı proje ve native araç kapsamındadır. Önceki kullanıcı isteği yeni onay değildir. Dış gönderim/ödeme/işçi başlatma yapma; belirsiz işlemi tekrarlama.';
      }else{
        // Purpose is the original current request, not model-invented execution authority.
        payload.message='Kullanıcının kayıtlı hatırlatma isteği: '+statement+'\nYalnız hatırlatmayı bildir. Dış işlem yapma veya yapılmış sayma.';
      }
    }
    if(j.description!==undefined&&!(j.payload as {toolsAllow?:unknown[]}|undefined)?.toolsAllow?.length){
      if(action==='update'&&j.payload===undefined)throw new Error('Purpose edits require an explicit payload; preserve the native task scope');
      j.description=bounded(j.description)+'\nEurope/Istanbul; hedef/görev kapsamı: yalnız bu özel sohbette hatırlatma; teslim: '+scope.sessionKey;
    }
  }else if(p.job!==undefined)throw new Error('Unexpected automation patch');
  return p;
}
