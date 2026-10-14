import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { installCodex, codexContract, CODEX_AGENT } from '../plugins/jarvis/codex.ts';
import { WorkLedger, ResourceOwners } from '../plugins/jarvis/work.ts';
import { enableCodex } from '../scripts/jarvis-codex-config.mjs';
import { applyPolicy, assertPolicy } from '../scripts/jarvis-policy-config.mjs';
import { n as createGatewayMethodRegistry } from '../node_modules/openclaw/dist/registry-aQKhFQO5.mjs';

const root = await fs.mkdtemp(path.join(os.tmpdir(), 'jarvis-codex-test-'));
function store() { const rows=new Map(); return { async entriesInKeyRange(){return [];}, async lookup(k){return structuredClone(rows.get(k));}, async registerIfAbsent(k,v){if(rows.has(k))return false;rows.set(k,structuredClone(v));return true;},async update(k,fn){const v=fn(structuredClone(rows.get(k)));if(v!==undefined)rows.set(k,structuredClone(v));return v!==undefined;} }; }
function fixture() {
  const descriptors=[];
  const methods={},hooks={},requests=[],abort=new AbortController(); let valid=true, question=false, native, authType='oauth';
  const scope={runId:'parent',taskId:'task',projectId:'project',userId:'user',deviceId:'device',agentId:'main',sessionKey:'agent:main:test',sessionId:'parent-sid',root,role:'project',expiresAt:Date.now()+60000,confirmationPaths:[],urls:[]};
  const binding={scope,signal:abort.signal,assertCurrent(){if(!valid)throw new Error('revoked');}};
  const live=id=>valid&&id==='parent'?binding:undefined;
  const ledger=new WorkLedger(store(),store(),store());
  const api={config:{},runtime:{agent:{resolveAgentDir(){return 'private-codex-agent';}},modelAuth:{ensureAuthProfileStore(){return {profiles:authType?{'openai:jarvis-codex':{provider:'openai',type:authType}}:{}};}}},registerGatewayMethod(n,fn,options){methods[n]=fn;descriptors.push({name:n,handler:fn,owner:{kind:'plugin',id:'jarvis'},...options});},on(n,fn){hooks[n]=fn;},agent:{events:{registerAgentEventSubscription(s){native=s;}}},logger:{error(){}}};
  let childKey,childRun;
  const rpc=async(method,p)=>{requests.push({method,p});
    if(method==='sessions.create'){childKey=p.key;return {key:p.key,sessionId:'child-sid'};}
    if(method==='question.list')return {questions:question?[{id:'question-original',sessionKey:childKey,status:'pending'}]:[]};
    if(method==='chat.send'){if(!p.queueMode)childRun=p.idempotencyKey;return {runId:p.idempotencyKey,status:'accepted'};}
    if(method==='sessions.describe')return {sessionId:'child-sid',hasActiveRun:true,activeRunIds:[childRun]};
    if(method==='chat.abort')return {aborted:true,runIds:[p.runId]};
    if(method==='agent.wait')return {status:'pending'};
    if(method==='sessions.diff')return {files:[],additions:0,deletions:0};
    throw new Error(method);
  };
  const worker=installCodex(api,live,ledger,rpc,new ResourceOwners());
  const client={authenticatedUserId:'user',connect:{role:'operator',scopes:['operator.admin'],device:{id:'device'}}};
  const access={target:{sessionId:'parent-sid',sessionKey:scope.sessionKey},assertCurrent(){binding.assertCurrent();}};
  async function call(action,p={},actor=client){let result;await methods['jarvis.codex.'+action]({req:{method:'jarvis.codex.'+action},params:{sessionKey:scope.sessionKey,agentId:'main',runId:'parent',...p},client:actor,sessionAccessAuthority:access,respond(ok,payload,error){result={ok,payload,error};}});return result;}
  const contract={worker:'codex',projectRoot:root,expectedRevision:1,model:'openai/explicit-user-selection',request:'Fix the selected project',purpose:'Correct the bug',scope:'Project code',context:'Accepted requirements',output:'Code and diff',verification:'Relevant regression check'};
  return {descriptors,call,contract,ledger,requests,scope,worker,abort,native,client,auth(type){authType=type;},revoked(){valid=false;},question(){question=true;},ctx(){return {agentId:CODEX_AGENT,sessionKey:childKey,sessionId:'child-sid',runId:childRun};}};
}
test('Codex methods satisfy the installed Gateway session registry contract',()=>{
  const registry=createGatewayMethodRegistry(fixture().descriptors);
  for(const action of ['start','status','continue','steer','interrupt']) {
    assert.equal(registry.getScope('jarvis.codex.'+action),'operator.write');
    assert.equal(registry.requiresAuthenticatedProfile('jarvis.codex.'+action),true);
  }
});
test('full-access leaf preserves effective main/research tool restrictions and default model',()=>{
  const before=applyPolicy({agents:{defaults:{workspace:root,model:{primary:'opencode/space-bunny-free',fallbacks:[]}},entries:{}},plugins:{entries:{}}},root);
  const c=enableCodex(before,'C:\\private\\codex.exe',root,[]);
  assert.deepEqual(c.tools.exec,before.tools.exec);assert.deepEqual(c.agents.defaults.model,before.agents.defaults.model);
  for(const id of ['main','research']) for(const name of new Set([...before.tools.allow,...before.tools.deny,...before.agents.entries[id].tools.allow])) {
    const allowed=(cfg)=>{const a=cfg.agents.entries[id].tools;return (!cfg.tools.allow||cfg.tools.allow.includes(name))&&(!a.allow||a.allow.includes(name))&&!cfg.tools.deny?.includes(name)&&!a.deny?.includes(name);};
    assert.equal(allowed(c),allowed(before),`${id}/${name}`);
  }
  assert.equal(c.plugins.entries.codex.config.appServer.sandbox,'danger-full-access');
  assert.equal(c.plugins.entries.codex.config.appServer.approvalPolicy,'never');
  assert.deepEqual(c.agents.entries[CODEX_AGENT].tools,{profile:'minimal'});
  assertPolicy(c,root);
});
test('ingress validates explicit worker, root, contract and revision before dispatch',async()=>{
  const f=fixture();
  for(const change of [{worker:'opencode'},{projectRoot:path.dirname(root)},{verification:''},{expectedRevision:2},{model:'some-other-provider/model'}]) {
    await assert.rejects(codexContract({...f.contract,...change},f.scope,1));
  }
  const bad=await f.call('start',f.contract,{...f.client,authenticatedUserId:'other'});assert.equal(bad.ok,false);assert.equal(f.requests.length,0);
  const started=await f.call('start',f.contract);assert.equal(started.ok,true,started.error?.message);
  const created=f.requests.find(r=>r.method==='sessions.create');assert.equal(created.p.permissionMode,'full');assert.equal(created.p.agentRuntime,'codex');assert.equal(created.p.cwd,root);
  assert.ok(!('fork' in created.p));assert.ok(!('parentSessionKey' in created.p));
  const duplicate=await f.call('start',f.contract);assert.equal(duplicate.ok,false);assert.equal(f.requests.filter(r=>r.method==='sessions.create').length,1);
});
test('relay boundary requires exact native identity/current grant and denies general host capabilities',async()=>{
  const f=fixture();await f.call('start',f.contract);
  assert.deepEqual(f.worker.beforeTool({toolName:'exec'},f.ctx()),{});
  for(const key of ['runId','sessionId','sessionKey']) assert.equal(f.worker.beforeTool({toolName:'exec'},{...f.ctx(),[key]:'forged'}).block,true);
  for(const name of ['jarvis_note_write','memory_search','nodes','gateway','message','request_user_input']) assert.equal(f.worker.beforeTool({toolName:name},f.ctx()).block,true);
  f.revoked();assert.equal(f.worker.beforeTool({toolName:'exec'},f.ctx()).block,true);
});
test('pending native question blocks new steer identity and never resolves on behalf of user',async()=>{
  const f=fixture();await f.call('start',f.contract);f.question();
  const r=await f.call('steer',{expectedRevision:1,message:'Change the approach',inputId:'new-input'});assert.equal(r.ok,false);assert.match(r.error.message,/question/);
  assert.equal(f.requests.filter(r=>r.method==='chat.send').length,1);
  assert.equal(f.requests.some(r=>/resolve|answer/i.test(r.method)),false);
  const record=await f.ledger.get('user','task');assert.equal(record.revision,1);
});
test('native identities are retained, reasoning omitted and interrupt receipt never claims full cancellation',async()=>{
  const f=fixture();await f.call('start',f.contract);
  await f.native.handle({runId:f.ctx().runId,sessionId:'child-sid',seq:1,stream:'codex_app_server.lifecycle',data:{threadId:'thread',turnId:'turn',phase:'turn_started'}});
  await f.native.handle({runId:f.ctx().runId,sessionId:'child-sid',seq:2,stream:'codex_app_server.item',data:{type:'reasoning',itemId:'opaque',text:'secret reasoning'}});
  const r=await f.ledger.get('user','task');assert.equal(r.worker.threadId,'thread');assert.equal(r.worker.turnId,'turn');assert.equal(JSON.stringify(r).includes('opaque'),false);
  const stopped=await f.call('interrupt',{expectedRevision:1});assert.equal(stopped.ok,true);assert.equal(stopped.payload.cancellationConfirmed,false);
  assert.ok(f.requests.some(r=>r.method==='chat.abort'));assert.equal(f.worker.beforeTool({toolName:'exec'},f.ctx()).block,true);
  assert.equal((await f.ledger.get('user','task')).state,'cancel-requested');
});
test('steer uses native queueMode steer without interrupt or executor fallback',async()=>{
  const f=fixture();await f.call('start',f.contract);
  const r=await f.call('steer',{expectedRevision:1,message:'Use the accepted alternative',inputId:'steer-1'});assert.equal(r.ok,true,r.error?.message);
  const send=f.requests.at(-1);assert.equal(send.method,'chat.send');assert.equal(send.p.queueMode,'steer');assert.equal(send.p.idempotencyKey,'steer-1');
  assert.equal(f.requests.some(r=>r.method==='chat.abort'),false);
});
test('missing subscription and API-key credentials cannot start a worker or fall back',async()=>{
  for(const type of [undefined,'api_key']){const f=fixture();f.auth(type);const r=await f.call('start',f.contract);assert.equal(r.ok,false);assert.match(r.error.message,/subscription login/);assert.equal(f.requests.length,0);}
});
test('retained work reconciliation follows Codex identity rather than parent run',async()=>{
  const f=fixture();await f.call('start',f.contract);const r=await f.ledger.get('user','task');
  const reconciled=await f.ledger.reconcile(r,{sessionId:r.worker.sessionId,activeRunIds:[r.worker.runId],run:{status:'pending'}});
  assert.equal(reconciled.state,r.state);assert.equal(reconciled.blocker,r.blocker);
});
test('unresolved native approval also holds steering and cannot be answered by a model',async()=>{
  const f=fixture();await f.call('start',f.contract);
  await f.native.handle({runId:f.ctx().runId,sessionId:'child-sid',seq:1,stream:'approval',data:{requestId:22}});
  const r=await f.call('steer',{expectedRevision:1,message:'Keep working',inputId:'replacement'});assert.equal(r.ok,false);assert.match(r.error.message,/approval/);
  assert.equal(f.requests.filter(r=>r.method==='chat.send').length,1);
  assert.equal((await f.ledger.get('user','task')).worker.requestId,22);
});
