import type {OpenClawPluginApi} from 'openclaw/plugin-sdk/plugin-entry';
import {randomUUID} from 'node:crypto';
import {selectedWorker,WORKER_GUIDANCE,WORKER_DEFAULTS,type WorkerBinding} from './worker-contract.ts';
import type {installCodex} from './codex.ts';
import type {installOpenCode} from './opencode.ts';
import type {WorkLedger} from './work.ts';
import {exactKeys} from './policy.ts';
import {profileConnection} from '../../scripts/jarvis-opencode-profile.mjs';
import {OpenCode} from '@opencode/client';
export function installWorkers(api:OpenClawPluginApi,live:(run?:string)=>WorkerBinding|undefined,ledger:WorkLedger,codex:ReturnType<typeof installCodex>|undefined,opencode:ReturnType<typeof installOpenCode>,toolScope:(ctx:any)=>WorkerBinding) {
 api.registerGatewayMethod('jarvis.worker.setup',async({respond})=>{try{const s=profileConnection(),c=OpenCode.make({baseUrl:s.url,headers:s.headers}),info=await c.server.info({signal:AbortSignal.timeout(10000)});if(info.pid!==s.pid||info.version!=='2.0.28')throw new Error('Private server identity mismatch');respond(true,{workers:['codex','opencode'],defaults:WORKER_DEFAULTS,opencode:{version:info.version,authenticated:true,loopback:true,fullAccess:true},mainModel:'opencode/space-bunny-free',mainRuntime:'jarvis-opencode-main',liveProjectAcceptance:'Deferred joint Stage09/10 note-app scenario; not yet run'});}catch(e){respond(false,undefined,{code:'UNAVAILABLE',message:e instanceof Error?e.message:'Private server unavailable'});}},{scope:'operator.read',profileAccess:'required'});
 const control=async(b:WorkerBinding,p:Record<string,unknown>,action:string)=>{
  const choice=selectedWorker(b.scope);if(p.worker!==undefined&&p.worker!==choice)throw new Error('Worker differs from original user selection; unavailable tools cannot silently fall back');
  const r=await ledger.get(b.scope.userId,b.scope.taskId).catch(()=>undefined);
  if(r?.execution&&r.execution!=='local'&&r.execution!==choice)throw new Error('Another worker owns this task');
  if(choice==='opencode')return opencode.control(b,p,action);
  if(!codex)throw new Error('Selected Codex unavailable; no fallback');
  let result:any;await codex.control(b,p,action,(ok,payload,error)=>{if(!ok)throw new Error(error?.message??'Codex unavailable');result=payload;});return result;
 };
 api.registerTool({contextVersion:2,create(ctx){
  if(ctx.agentId!=='main')return null;
  return [{name:'jarvis_worker',label:'Seçilen kodlama işçisi',description:'Start/read/continue/steer/interrupt only the worker named in the original human request. OpenClaw fills task/project identities. Read actual result and diff before the next prompt. Native permission/form questions require the human; this tool cannot answer them. Status may wait briefly for ongoing work. Full access was explicitly selected; no fallback.',
   parameters:{type:'object' as const,properties:{action:{type:'string',enum:['start','status','continue','steer','interrupt']},worker:{type:'string',enum:['codex','opencode']},expectedRevision:{type:'integer'},model:{type:'string'},thinking:{type:'string',enum:['none','off','low','medium','high','xhigh','max']},request:{type:'string'},purpose:{type:'string'},scope:{type:'string'},context:{type:'string'},output:{type:'string'},verification:{type:'string'},message:{type:'string'}},required:['action'],additionalProperties:false},
   async execute(callId:string,args:Record<string,unknown>){const b=toolScope(ctx);ctx.assertInvocationCurrent();ctx.assertInputCommitAllowed?.();
    exactKeys(args,['action','worker','expectedRevision','model','thinking','request','purpose','scope','context','output','verification','message']);
    const action=String(args.action),choice=selectedWorker(b.scope);const {action:_,worker:__,...fields}=args;
    const p:Record<string,unknown>={...fields,runId:b.scope.runId,sessionKey:b.scope.sessionKey,agentId:b.scope.agentId};
    if(action==='start')Object.assign(p,{worker:choice,projectRoot:b.scope.root,model:args.model});
    if(args.worker!==undefined&&args.worker!==choice)throw new Error('Original human worker selection required');
    if(action==='continue'||action==='steer')p.inputId=callId||randomUUID();
    let result=await control(b,p,action);
    // A bounded native wait reduces repeated planner turns, without a new queue.
    if(['start','continue','status'].includes(action)) {
     const deadline=Date.now()+25000;
     for(;;){b.assertCurrent();ctx.assertInvocationCurrent();const s=await control(b,{runId:b.scope.runId,sessionKey:b.scope.sessionKey,agentId:b.scope.agentId},'status');result=s;
      if(!s?.nativeActive||Date.now()>=deadline||s.pending?.permissions?.length||s.pending?.forms?.length||s.pendingQuestions?.length)break;
      await new Promise(r=>setTimeout(r,1000));}
    }
    ctx.assertInvocationCurrent();return {content:[{type:'text' as const,text:JSON.stringify(result)}],details:result};
   }}];
 }},{names:['jarvis_worker']});
 for(const action of ['start','status','continue','steer','interrupt'])api.registerGatewayMethod(`jarvis.worker.${action}`,async({params,client,sessionAccessAuthority:access,respond})=>{
  try{const b=live(String(params.runId));if(!b||!access||client?.invalidated||client?.connect.role!=='operator'||(client.authenticatedUserProfile?.profileId??client.authenticatedUserId)!==b.scope.userId||client.connect.device?.id!==b.scope.deviceId||access.target.sessionId!==b.scope.sessionId||access.target.sessionKey!==b.scope.sessionKey)throw new Error('Current original operator task required');access.assertCurrent();respond(true,await control(b,params,action));}
  catch(e){respond(false,undefined,{code:'INVALID_REQUEST',message:e instanceof Error?e.message:'Worker unavailable'});}
 },{scope:'operator.write',profileAccess:'required',sessionAccess:{mode:'write'}});
 api.registerGatewayMethod('jarvis.worker.answer',async({params,client,sessionAccessAuthority:access,respond})=>{
  try{const b=live(String(params.runId));if(!b||!access||client?.invalidated||client?.connect.role!=='operator'||!client.connect.scopes?.includes('operator.approvals')||(client.authenticatedUserProfile?.profileId??client.authenticatedUserId)!==b.scope.userId||!client.connect.device?.id||access.target.sessionId!==b.scope.sessionId||access.target.sessionKey!==b.scope.sessionKey||selectedWorker(b.scope)!=='opencode')throw new Error('Original authenticated human decision authority required');access.assertCurrent();respond(true,await opencode.answer(b,params));}
  catch(e){respond(false,undefined,{code:'INVALID_REQUEST',message:e instanceof Error?e.message:'Native decision unavailable'});}
 },{scope:'operator.write',profileAccess:'required',sessionAccess:{mode:'write'}});
 api.registerGatewayMethod('jarvis.worker.requests',async({params,client,sessionAccessAuthority:access,respond})=>{
  try{const b=live(String(params.runId));if(!b||!access||!client||client.invalidated||client.connect.role!=='operator'||!client.connect.scopes?.includes('operator.approvals')||(client.authenticatedUserProfile?.profileId??client.authenticatedUserId)!==b.scope.userId||!client.connect.device?.id||access.target.sessionId!==b.scope.sessionId||access.target.sessionKey!==b.scope.sessionKey)throw new Error('Original human decision authority required');access.assertCurrent();const choice=selectedWorker(b.scope);respond(true,{requests:choice==='opencode'?await opencode.decisions(b):await codex?.decisions(b)??[]});}
  catch(e){respond(false,undefined,{code:'INVALID_REQUEST',message:e instanceof Error?e.message:'Worker requests unavailable'});}
  // Session-scoped methods must declare operator.write; the handler still
  // requires operator.approvals on the client, so the real gate is stricter.
  },{scope:'operator.write',profileAccess:'required',sessionAccess:{mode:'write'}});
 api.on('before_prompt_build',(_e,ctx)=>ctx.agentId==='main'?{appendSystemContext:WORKER_GUIDANCE}:undefined);
 return {control};
}
