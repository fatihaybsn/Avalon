import {randomUUID} from 'node:crypto';
import type {OpenClawPluginApi} from 'openclaw/plugin-sdk/plugin-entry';
import {dispatchGatewayMethod} from 'openclaw/plugin-sdk/gateway-method-runtime';
import {fingerprint,type Scope} from './policy.ts';
import {selectedWorker} from './worker-contract.ts';

// Presentation bindings only. OpenClaw remains the sole decision registry.
export function installDecisions(api:OpenClawPluginApi,bindings:()=>Array<{scope:Scope;assertCurrent:()=>void}>,revision:(s:Scope)=>Promise<number>,revoke:(id:string)=>void,dispatch=dispatchGatewayMethod) {
 const previews=new Map<string,{scope:Scope;revision:number;params:Record<string,unknown>;manual:boolean;nonce:string}>();
 const rpc=async(method:string,params:Record<string,unknown>)=>{const r=await dispatch(method,params,{expectFinal:true,timeoutMs:65000});if(!r.ok)throw new Error(r.error?.message??'Native decision unavailable');return r.payload as any;};
 const owner=(o:any)=>{const a=o.sessionAccessAuthority,c=o.client;if(!a||c?.invalidated||c?.connect.role!=='operator'||!c.connect.scopes?.includes('operator.approvals'))throw new Error('Human approval client required');a.assertCurrent();return bindings().filter(b=>{try{b.assertCurrent();return b.scope.expiresAt>Date.now()&&b.scope.userId===(c.authenticatedUserProfile?.profileId??c.authenticatedUserId)&&b.scope.deviceId===c.connect.device?.id&&(b.scope.sessionKey===a.target.sessionKey||b.scope.projectId===a.target.sessionKey);}catch{return false;}});};
 for(const action of ['pending','grants','revoke'])api.registerGatewayMethod('jarvis.decisions.'+action,async o=>{
  try{const owned=owner(o);if(action==='grants'){o.respond(true,{grants:await Promise.all(owned.map(async b=>{let worker;try{worker=selectedWorker(b.scope);}catch{}return {runId:b.scope.runId,taskId:b.scope.taskId,sessionKey:b.scope.sessionKey,revision:await revision(b.scope),role:b.scope.role,root:b.scope.root,expiresAt:b.scope.expiresAt,...worker?{worker}:{}};}))});return;}
   if(action==='revoke'){const b=owned.find(b=>b.scope.runId===o.params.runId);if(!b||Object.keys(o.params).some(k=>!['sessionKey','agentId','runId'].includes(k)))throw new Error('Exact own grant required');revoke(b.scope.runId);o.respond(true,{revoked:true,undo:false});return;}
   const results=[];
   for(const kind of ['plugin','exec'])for(const row of await rpc(kind+'.approval.list',{})){
    let nonce:string|undefined;try{nonce=JSON.parse(row.request?.detail??'{}').nonce;}catch{}
    const view=nonce?previews.get(nonce):undefined;
    const candidates=owned.filter(b=>b.scope.sessionKey===row.request?.sessionKey);
    const b=view?candidates.find(b=>b.scope.runId===view.scope.runId):candidates.find(b=>b.scope.runId===row.request?.runId)??(candidates.length===1?candidates[0]:undefined);if(!b)continue;
    const a=(await rpc('approval.get',{id:row.id})).approval;if(a?.status!=='pending')continue;
    const rev=await revision(b.scope);
    if(row.request?.pluginId==='jarvis'&&!view)continue;
    if(view&&(view.scope.runId!==b.scope.runId||view.revision!==rev))continue;
    results.push({family:'approval',id:a.id,kind,status:a.status,expiresAtMs:a.expiresAtMs,createdAtMs:a.createdAtMs,sessionKey:b.scope.sessionKey,runId:b.scope.runId,taskId:b.scope.taskId,revision:rev,manual:!view||view.manual,presentation:a.presentation,...view?{nonce:view.nonce,params:view.params}:{}});
   }
   o.sessionAccessAuthority!.assertCurrent();o.respond(true,{requests:results});
  }catch(e){o.respond(false,undefined,{code:'INVALID_REQUEST',message:e instanceof Error?e.message:'Decision unavailable'});}
 },{scope:'operator.approvals',profileAccess:'required',sessionAccess:{mode:'write'}});
 api.on('gateway_stop',()=>previews.clear());
 return {
  async authorize(callId:string,tool:string,params:Record<string,unknown>,scope:Scope,approval:any,signal?:AbortSignal){
   signal?.throwIfAborted();
   const frozen=structuredClone(params),rev=await revision(scope),nonce=randomUUID(),manual=tool==='browser';
   const detail=JSON.stringify({taskId:scope.taskId,revision:rev,runId:scope.runId,action:tool,params:frozen,nonce,manual});
   if(detail.length>14000)return {block:true,blockReason:'Full operation preview exceeds native approval limit; operation not started'};
   previews.set(nonce,{scope,revision:rev,params:frozen,manual,nonce});
   const aborted=()=>previews.delete(nonce);signal?.addEventListener('abort',aborted,{once:true});
   try{
    const result=await rpc('plugin.approval.request',{pluginId:'jarvis',title:approval.title,description:`${tool}; task ${scope.taskId}; revision ${rev}; request ${nonce}`,detail,toolName:tool,toolCallId:callId,agentId:scope.agentId,sessionKey:scope.sessionKey,severity:'critical',allowedDecisions:['allow-once','deny'],timeoutMs:60000,twoPhase:false});
    signal?.throwIfAborted();const current=bindings().find(b=>b.scope.runId===scope.runId);if(!current)throw new Error('Grant revoked');current.assertCurrent();
    if(scope.expiresAt<=Date.now()||result.decision!=='allow-once'||await revision(scope)!==rev||fingerprint(params)!==fingerprint(frozen))return {block:true,blockReason:'Exact current allow-once not received; operation blocked'};
    return {params:frozen};
   }finally{signal?.removeEventListener('abort',aborted);previews.delete(nonce);}
  },
 };
}
