import test from 'node:test';
import assert from 'node:assert/strict';
import {installDecisions} from '../plugins/jarvis/decisions.ts';
import {resolveRecipient,installSending} from '../plugins/jarvis/sending.ts';
import {MANAGER_PERMISSIONS,assertManagerSession} from '../scripts/manager-permissions.mjs';
import {workerConfig} from '../scripts/jarvis-opencode-profile.mjs';

test('manager native policy readback fails closed without changing coding Full access',()=>{
 const c=workerConfig();assert.equal(c.permissions.find(p=>p.action==='shell').effect,'allow');
 assert.deepEqual(c.agents['jarvis-manager'].permissions,MANAGER_PERMISSIONS);
 assertManagerSession({id:'native-id',agent:'jarvis-manager',permissions:MANAGER_PERMISSIONS},'native-id');
 for(const session of [{id:'other',agent:'jarvis-manager',permissions:MANAGER_PERMISSIONS},{id:'native-id',agent:'build',permissions:MANAGER_PERMISSIONS},{id:'native-id',agent:'jarvis-manager',permissions:[{action:'*',resource:'*',effect:'allow'}]}])assert.throws(()=>assertManagerSession(session,'native-id'));
});
function host(){
 let current=true,revision=1,decision='allow-once',cancel;
 const scope={userId:'u',deviceId:'d',sessionKey:'agent:main:test',sessionId:'sid',runId:'run',taskId:'task',projectId:'agent:main:test',role:'project',expiresAt:Date.now()+60000};
 const calls=[],methods={};
 const api={registerGatewayMethod:(n,h)=>methods[n]=h,on:()=>{}};
 const binding={scope,assertCurrent:()=>{if(!current)throw new Error('revoked');}};
 const bridge=installDecisions(api,()=>current?[binding]:[],async()=>revision,()=>{current=false;},async(m,p)=>{calls.push([m,p]);if(m==='plugin.approval.request'){cancel?.();return {ok:true,payload:{decision}};}return {ok:true,payload:[]};});
 return {bridge,calls,scope,methods,change:()=>revision++,revoke:()=>{current=false;},deny:()=>decision='deny',during:fn=>cancel=fn};
}
test('host freezes full final parameters in the native registry and permits only exact allow-once',async()=>{
 const h=host(),params={path:'C:/task/a.txt',content:'tam içerik'};
 const r=await h.bridge.authorize('call','write',params,h.scope,{title:'Exact write'});
 assert.deepEqual(r.params,params);const [,p]=h.calls[0],detail=JSON.parse(p.detail);
 assert.deepEqual(detail.params,params);assert.equal(detail.revision,1);assert.equal(detail.taskId,'task');assert.ok(detail.nonce);assert.deepEqual(p.allowedDecisions,['allow-once','deny']);
 h.deny();assert.equal((await h.bridge.authorize('call2','write',params,h.scope,{title:'Exact write'})).block,true);
});
test('native decision cannot execute after revocation, cancellation, revision or parameter change',async()=>{
 for(const change of ['revision','params','revoke','abort']){
  const h=host(),p={path:'C:/a',content:'one'},ac=new AbortController();
  h.during(()=>{if(change==='revision')h.change();if(change==='params')p.content='two';if(change==='revoke')h.revoke();if(change==='abort')ac.abort();});
  try{const r=await h.bridge.authorize('call','write',p,h.scope,{title:'Exact'},ac.signal);assert.equal(r.block,true);}catch(e){assert.match(e.message,/revoked|aborted|Grant revoked/);}
 }
 const h=host();assert.equal((await h.bridge.authorize('big','write',{content:'x'.repeat(15000)},h.scope,{title:'Exact'})).block,true);assert.equal(h.calls.length,0);
});
test('models and other devices cannot list/revoke another human grant',async()=>{
 const h=host();
 const invoke=async client=>{let result;await h.methods['jarvis.decisions.revoke']({params:{runId:'run'},client,sessionAccessAuthority:{target:{sessionKey:h.scope.sessionKey},assertCurrent(){}},respond:(ok,p)=>result={ok,p}});return result;};
 const c={connect:{role:'operator',scopes:['operator.approvals'],device:{id:'d'}},authenticatedUserId:'u'};
 for(const client of [{...c,connect:{...c.connect,scopes:['operator.write']}},{...c,authenticatedUserId:'other'},{...c,connect:{...c.connect,device:{id:'other'}}},{...c,connect:{...c.connect,role:'agent'}}])assert.equal((await invoke(client)).ok,false);
 assert.equal((await invoke(c)).ok,true);
});
test('native sending requires one real recipient/account, never chooses between namesakes',async()=>{
 const person={conversationRef:'conv_a',accountId:'account',channel:'whatsapp',target:'+901234',label:'Ali'};
 const rpc=async(m)=>m==='conversations.list'?{conversations:[person]}:{channelAccounts:{whatsapp:[{accountId:'account',configured:true,linked:true,enabled:true,name:'Gerçek hesap'}]}};
 assert.equal((await resolveRecipient(rpc,'Ali')).ready,true);
 assert.equal((await resolveRecipient(async()=>({conversations:[person,{...person,conversationRef:'conv_b'}]}),'Ali')).ready,false);
 assert.equal((await resolveRecipient(async()=>({conversations:[]}),'Ali')).ready,false);
 assert.equal((await resolveRecipient(async m=>m==='conversations.list'?{conversations:[person]}:{channelAccounts:{}},'Ali')).ready,false);
 await assert.rejects(resolveRecipient(rpc,'Ali','conv_other'));
});
test('send waits for frozen approval, records native result, and never retries an unknown attempt',async()=>{
 for(const mode of ['deny','allow','unknown','changed']){
  let factory,approved=false,target='Ali',sends=0;const seen=new Set(),events=[];
  const scope={userId:'u',taskId:'task',agentId:'main',sessionKey:'agent:main:test',role:'memory',userStatement:"Ali'ye mesaj gönder"};
  installSending({registerTool:d=>{factory=d.create;}},()=>({scope,assertCurrent(){}}),{async change(u,t,id,kind,data,apply=()=>{},current=()=>{}){current();events.push({id,kind,data});const changed=!seen.has(id);seen.add(id);apply({});return {changed};}},async(id,tool,params)=>{if(!seen.has('send-attempt:call_one'))assert.equal(sends,0);assert.equal(params.recipient.target,'Ali');if(mode==='changed')target='Başka alıcı';approved=mode!=='deny';return approved?{params}:{block:true,blockReason:'Denied'};},async(m)=>{
   if(m==='conversations.list')return {ok:true,payload:{conversations:[{conversationRef:'conv_exact',channel:'whatsapp',accountId:'account',target,label:'Ali'}]}};
   if(m==='channels.status')return {ok:true,payload:{channelAccounts:{whatsapp:[{accountId:'account',configured:true,linked:true}]}}};
   if(m==='conversations.send'){assert.equal(approved,true);sends++;if(mode==='unknown')throw new Error('lost response');return {ok:true,payload:{status:'sent',messageId:'real-native-id'}};}
   throw new Error(m);
  });
  const [tool]=factory({agentId:'main',assertInvocationCurrent(){}}),args={action:'send',query:'Ali',conversationRef:'conv_exact',message:'Tam son metin'};
  if(mode==='allow'){const result=await tool.execute('call_one',args);assert.equal(result.details.messageId,'real-native-id');assert.equal(events.at(-1).data.status,'sent');}
  else await assert.rejects(tool.execute('call_one',args));
  assert.equal(sends,['allow','unknown'].includes(mode)?1:0);
  if(mode==='unknown'){await assert.rejects(tool.execute('call_one',args));assert.equal(sends,1);assert.ok(events.some(e=>e.kind==='external-send-unknown'));}
 }
});
