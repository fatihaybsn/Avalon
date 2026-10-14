import {OpenCode,type OpenCodeClient,type OpenCodeEvent} from '@opencode/client';
import type {OpenClawPluginApi} from 'openclaw/plugin-sdk/plugin-entry';
import {profileConnection,profileRoot,shellWorkerEnv} from '../../scripts/jarvis-opencode-profile.mjs';
import {workerContract,WORKER_INSTRUCTIONS,type WorkerBinding} from './worker-contract.ts';
import {exactKeys,text,workText,fingerprint} from './policy.ts';
import type {WorkLedger,ResourceOwners,WorkRecord} from './work.ts';
type Connection={client:OpenCodeClient;pid:number};
type Worker={binding:WorkerBinding;id:string;client:OpenCodeClient;busy:boolean;unknown:boolean;stopped:boolean;abort:()=>void};
export function installOpenCode(api:OpenClawPluginApi,ledger:WorkLedger,owners:ResourceOwners,connect:()=>Promise<Connection>=async()=>{
 const s=profileConnection(),client=OpenCode.make({baseUrl:s.url,headers:s.headers});
 const info=await client.server.info({signal:AbortSignal.timeout(10000)});
 if(info.version!=='2.0.28'||info.pid!==s.pid)throw new Error('Private OpenCode server identity changed; no fallback');
 return {client,pid:info.pid};
}) {
 const workers=new Map<string,Worker>(),starting=new Set<string>(),attempted=new Set<string>(),streams=new Map<OpenCodeClient,AbortController>();
 const current=(w:Worker)=>{w.binding.assertCurrent();if(w.binding.signal.aborted||w.binding.scope.expiresAt<=Date.now()||w.stopped||w.unknown)throw new Error('OpenCode task expired, interrupted or outcome unknown');};
 const record=(w:Worker,id:string,kind:string,data:Record<string,unknown>,apply:(r:WorkRecord)=>void=()=>{})=>ledger.change(w.binding.scope.userId,w.binding.scope.taskId,id,kind,data,apply);
 async function observe(e:OpenCodeEvent) {
  if(!('data' in e)||!e.data||typeof e.data!=='object'||e.type.includes('reasoning'))return;
  const d=e.data as Record<string,unknown>,w=[...workers.values()].find(w=>w.id===d.sessionID);if(!w)return;
  if(!['session.execution.started','session.execution.succeeded','session.execution.failed','session.execution.interrupted','session.tool.called','session.tool.success','session.tool.failed','permission.asked','permission.replied','form.created','form.replied','form.cancelled'].includes(e.type))return;
  const ids=Object.fromEntries(['sessionID','messageID','toolID','requestID','formID'].filter(k=>typeof d[k]==='string').map(k=>[k,d[k]]));
  await record(w,`opencode-event:${e.id}`,e.type,{eventId:e.id,...ids},r=>{
   if(typeof d.messageID==='string')r.worker!.itemId=d.messageID;
   if(typeof d.requestID==='string')r.worker!.requestId=d.requestID;
   if(e.type==='session.execution.started'){w.busy=true;r.state='running';}
   if(e.type.startsWith('session.execution.')&&e.type!=='session.execution.started') {
    w.busy=false;owners.releaseCall(w.binding.scope.runId,w.id);
    r.state=w.stopped?'unknown':e.type==='session.execution.succeeded'?'ended':e.type==='session.execution.failed'?'failed':'unknown';
    r.result=e.type==='session.execution.succeeded'?'native-ended':e.type==='session.execution.failed'?'native-error':'unverified';
    r.blocker=w.stopped?'Native interruption observed; every child process stop not proven':'Execution ended; JARVIS result review required';
   }
  });
 }
 async function subscribe(client:OpenCodeClient) {
  if(streams.has(client))return;
  const ac=new AbortController();streams.set(client,ac);
  let ready!:()=>void;const started=new Promise<void>(resolve=>{ready=resolve;});
  void(async()=>{try{for await(const event of client.event.subscribe({signal:ac.signal,onActivity:ready}))await observe(event);}
   catch{if(!ac.signal.aborted)for(const w of workers.values())if(w.client===client){w.unknown=true;await record(w,'opencode-stream-lost','opencode-stream-lost',{},r=>{r.state='unknown';r.blocker='Native event stream lost; no replay or worker fallback';});}}
  })();
  await Promise.race([started,new Promise<void>((_,reject)=>{const t=setTimeout(()=>reject(new Error('Native event stream unavailable')),10000);t.unref();})]);
 }
 async function pending(w:Worker) {
  const permissions=await w.client.permission.list({sessionID:w.id});
  const listed=await w.client.session.form.list({sessionID:w.id});
  const forms=[];for(const f of listed){const detail=await w.client.session.form.get({sessionID:w.id,formID:f.id});if(detail.state.status==='pending')forms.push(detail);}
  return {permissions,forms};
 }
 async function interrupt(runId:string) {
  const w=workers.get(runId);if(!w)throw new Error('No admitted OpenCode worker');
  if(w.stopped)throw new Error('Interrupt already requested; inspect status');w.stopped=true;
  await record(w,'opencode-interrupt','opencode-interrupt',{},r=>{r.state='cancel-requested';r.blocker='Native interrupt requested; child-process termination not yet proven';});
  const receipt=await w.client.session.interrupt({sessionID:w.id});
  return {native:receipt,cancellationConfirmed:false};
 }
 async function status(w:Worker) {
  const info=await w.client.session.get({sessionID:w.id});
  const active=await w.client.session.active();const p=await pending(w);
  const messages=await w.client.message.list({sessionID:w.id,limit:6,order:'desc',type:'assistant'});
  const result=messages.data.filter(m=>m.type==='assistant').flatMap(m=>m.content.filter(c=>c.type==='text').map(c=>c.text)).join('\n').slice(0,24000);
  const diff=await w.client.session.diff({sessionID:w.id});
  w.binding.assertCurrent();
  return {worker:'opencode',sessionId:w.id,nativeActive:Boolean(active[w.id]),outcome:info.outcome,pending:p,result,diff,reviewRequired:true,cancellationConfirmed:false,revision:(await ledger.get(w.binding.scope.userId,w.binding.scope.taskId)).revision};
 }
 async function control(b:WorkerBinding,p:Record<string,unknown>,action:string) {
  b.assertCurrent();if(b.signal.aborted||b.scope.expiresAt<=Date.now())throw new Error('Task authority expired');
  const old=workers.get(b.scope.runId);
  if(action==='start') {
   exactKeys(p,['sessionKey','agentId','runId','worker','projectRoot','expectedRevision','model','thinking','request','purpose','scope','context','output','verification']);
   if(old||starting.has(b.scope.runId)||attempted.has(b.scope.runId))throw new Error('Worker already attempted; inspect status, never replay');starting.add(b.scope.runId);
   try {
    const r=(await ledger.create(b.scope,b.scope.userStatement??workText(p.request,'request',4000))).record;
    if(r.execution==='codex')throw new Error('Task already admitted to Codex; no silent switch');
    const contract=await workerContract(p,b.scope,r.revision,'opencode');attempted.add(b.scope.runId);
    await ledger.change(b.scope.userId,b.scope.taskId,'opencode-attempt','opencode-attempt',contract,v=>{v.execution='opencode';v.state='prepared';});
    const {client}=await connect();await subscribe(client);b.assertCurrent();
    const [providerID,id]=contract.model.split('/');
    const catalog=await client.model.list({location:{directory:contract.projectRoot}});
    const chosen=catalog.data.find(m=>m.providerID===providerID&&m.id===id&&m.enabled);
    if(!chosen||!chosen.variants?.some(v=>v.id===contract.thinking))throw new Error('Requested OpenCode model/thinking unavailable; no fallback');
    const session=await client.session.create({title:`JARVIS ${b.scope.taskId}`.slice(0,64),model:{providerID,id,variant:contract.thinking},location:{directory:contract.projectRoot},metadata:{taskId:b.scope.taskId,projectId:b.scope.projectId,revision:r.revision}});
    const w:Worker={binding:b,id:session.id,client,busy:false,unknown:false,stopped:false,abort:()=>{void interrupt(b.scope.runId).catch(()=>{});}};workers.set(b.scope.runId,w);
    await record(w,'opencode-admission','opencode-admission',contract,v=>{v.execution='opencode';v.worker={sessionId:w.id,threadId:w.id};});
    // Per-session shell environment shadows model/server credentials. The server
    // itself receives only the provider key and a generated loopback password.
    await client.session.environment({sessionID:w.id,variables:shellWorkerEnv(process.env,profileRoot())});
    b.signal.addEventListener('abort',w.abort,{once:true});
    return await send(w,JSON.stringify(contract),'queue');
   } catch(e){if(attempted.has(b.scope.runId))await ledger.change(b.scope.userId,b.scope.taskId,'opencode-start-unknown','opencode-start-unknown',{},v=>{v.state='unknown';v.blocker='Native creation/start outcome unconfirmed; no replay or fallback';});throw e;}
   finally{starting.delete(b.scope.runId);}
  }
  exactKeys(p,['sessionKey','agentId','runId','expectedRevision','message','inputId']);
  if(!old)throw new Error('No admitted OpenCode worker');const w=old;
  if(w.binding.scope.sessionId!==b.scope.sessionId||w.binding.scope.userId!==b.scope.userId||w.binding.scope.deviceId!==b.scope.deviceId)throw new Error('Original worker owner required');
  if(action==='status')return status(w);
  const r=await ledger.get(b.scope.userId,b.scope.taskId);if(p.expectedRevision!==r.revision)throw new Error('Task revision changed');
  if(action==='interrupt')return interrupt(b.scope.runId);
  current(w);const q=await pending(w);if(q.permissions.length||q.forms.length)throw new Error('Native user decision pending; model cannot resolve or replace it');
  const active=Boolean((await w.client.session.active())[w.id]);
  if(action==='steer'&&!active||action==='continue'&&active)throw new Error('Use steer for running work, continue for idle work');
  if(!['steer','continue'].includes(action))throw new Error('Unsupported worker control');
  const message=workText(p.message,'continuation',12000),inputId=text(p.inputId,'inputId',128);
  if(message.trimStart().startsWith('/'))throw new Error('Runtime/model commands are not task continuations');
  const changed=await record(w,`opencode-input:${inputId}`,'opencode-continuation',{action,message,inputId},v=>{if(v.revision!==p.expectedRevision)throw new Error('Revision conflict');v.revision++;});
  if(!changed.changed)return {dispatched:false};
  return send(w,message,action==='steer'?'steer':'queue');
 }
 async function send(w:Worker,message:string,delivery:'queue'|'steer') {
  current(w);const q=await pending(w);if(q.permissions.length||q.forms.length)throw new Error('Native user decision pending');
  owners.claim([`file:${w.binding.scope.root}`],w.binding.scope.runId,w.id,()=>current(w),w.binding.signal);w.busy=true;
  try{const receipt=await w.client.session.prompt({sessionID:w.id,text:WORKER_INSTRUCTIONS+'\n\n'+message,delivery});
   await record(w,`opencode-inbox:${receipt.id}`,'opencode-native-input',{sessionID:w.id,inboxID:receipt.id,delivery},r=>{r.state='running';r.worker!.turnId=receipt.id;});return {worker:'opencode',sessionId:w.id,inboxId:receipt.id,reviewRequired:true};
  }catch(e){w.unknown=true;await record(w,'opencode-send-unknown','opencode-send-unknown',{},r=>{r.state='unknown';r.blocker='Native prompt outcome uncertain; no blind retry or fallback';});throw e;}
 }
 api.on('gateway_stop',async()=>{for(const w of workers.values()){w.binding.signal.removeEventListener('abort',w.abort);if(w.busy&&!w.stopped)await interrupt(w.binding.scope.runId).catch(()=>{});}for(const ac of streams.values())ac.abort();});
 async function answer(b:WorkerBinding,p:Record<string,unknown>) {
  exactKeys(p,['sessionKey','agentId','runId','expectedRevision','kind','requestId','requestHash','decision','answer']);
  const w=workers.get(b.scope.runId);if(!w)throw new Error('No current OpenCode worker');current(w);
  if((await ledger.get(b.scope.userId,b.scope.taskId)).revision!==p.expectedRevision)throw new Error('Decision revision changed');
  const requestId=text(p.requestId,'native request ID',256),q=await pending(w);
  const original=p.kind==='permission'?q.permissions.find(v=>v.id===requestId):q.forms.find(v=>v.id===requestId);
  if(!original||fingerprint(original)!==p.requestHash)throw new Error('Native request changed/resolved; read and present it again');
  if(p.kind==='permission') {
   if(!q.permissions.some(v=>v.id===requestId)||!['once','reject'].includes(String(p.decision)))throw new Error('Exact pending permission and once/reject required; no automatic/always approval');
   await w.client.permission.reply({sessionID:w.id,requestID:requestId,decision:p.decision as 'once'|'reject'});
  } else if(p.kind==='form') {
   if(!q.forms.some(v=>v.id===requestId)||!p.answer||typeof p.answer!=='object'||Array.isArray(p.answer)||JSON.stringify(p.answer).length>12000)throw new Error('Exact pending form and bounded answer required');
   await w.client.session.form.reply({sessionID:w.id,formID:requestId,answer:p.answer as Record<string,string|number|boolean|string[]>});
  } else if(p.kind==='cancel-form') {
   if(!q.forms.some(v=>v.id===requestId))throw new Error('Exact pending form required');
   await w.client.session.form.cancel({sessionID:w.id,formID:requestId});
  } else throw new Error('Unsupported native decision kind');
  await record(w,`opencode-user-decision:${requestId}`,'opencode-user-decision',{requestId,kind:p.kind});return {resolved:true,requestId};
 }
 return {control,answer,interruptParent:interrupt,has:(run:string)=>workers.has(run),observe,
  async decisions(b:WorkerBinding){const w=workers.get(b.scope.runId);if(!w)return [];current(w);const q=await pending(w),revision=(await ledger.get(b.scope.userId,b.scope.taskId)).revision;current(w);return [...q.permissions.map(raw=>({kind:'permission',raw})),...q.forms.map(raw=>({kind:'form',raw}))].map(({kind,raw})=>({family:'opencode',kind,id:raw.id,requestHash:fingerprint(raw),sessionId:w.id,runId:b.scope.runId,taskId:b.scope.taskId,revision,expiresAtMs:b.scope.expiresAt,status:'pending',raw}));},
  async observation(r:WorkRecord){const w=workers.get(r.runId);if(!w)return {nativeUnavailable:true};const s=await status(w);return {sessionId:w.id,hasActiveRun:s.nativeActive,activeRunIds:s.nativeActive?[r.runId]:[],run:s.nativeActive?{status:'pending'}:s.outcome?{status:s.outcome==='succeeded'?'ok':'error',endedAt:Date.now()}:undefined,workerOutput:s};}};
}
