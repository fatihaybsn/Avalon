import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {createRequire} from 'node:module';
import {installOpenCode} from '../plugins/jarvis/opencode.ts';
import {WorkLedger,ResourceOwners} from '../plugins/jarvis/work.ts';
import {workerContract,workerSettings,selectedWorker} from '../plugins/jarvis/worker-contract.ts';
import {cleanWorkerEnv,shellWorkerEnv,workerConfig} from '../scripts/jarvis-opencode-profile.mjs';
import {applyWorkers} from '../scripts/jarvis-worker-config.mjs';
import {applyPolicy,assertPolicy} from '../scripts/jarvis-policy-config.mjs';
const root=await fs.mkdtemp(path.join(os.tmpdir(),'jarvis-stage10-'));
function store(){const rows=new Map();return {async entriesInKeyRange(){return[];},async lookup(k){return structuredClone(rows.get(k));},async registerIfAbsent(k,v){if(rows.has(k))return false;rows.set(k,structuredClone(v));return true;},async update(k,fn){const v=fn(structuredClone(rows.get(k)));if(v!==undefined)rows.set(k,structuredClone(v));return v!==undefined;}};}
function fixture(){const ledger=new WorkLedger(store(),store(),store()),owners=new ResourceOwners(),calls=[],abort=new AbortController();let valid=true,active=true,permissions=[],forms=[];let stop;
 const b={scope:{runId:'owner',sessionId:'main-id',sessionKey:'agent:main:test',agentId:'main',userId:'u',deviceId:'d',projectId:'p',taskId:'t',role:'project',root,expiresAt:Date.now()+60000,confirmationPaths:[],urls:[],userStatement:'OpenCode ile bu projeyi düzelt'},signal:abort.signal,assertCurrent(){if(!valid)throw new Error('revoked');}};
 const c={model:{list:async()=>({data:[{providerID:'opencode',id:'space-bunny-free',enabled:true,variants:['low','medium','high','xhigh','max'].map(id=>({id}))}]})},server:{info:async()=>({version:'2.0.28',pid:1})},event:{async *subscribe({signal,onActivity}){onActivity();await new Promise(r=>signal.addEventListener('abort',r,{once:true}));}},
 session:{create:async p=>{calls.push(['create',p]);return {id:'ses_worker'};},environment:async p=>calls.push(['environment',p]),prompt:async p=>{calls.push(['prompt',p]);return {id:'inbox_real_'+calls.filter(c=>c[0]==='prompt').length};},get:async()=>({id:'ses_worker',outcome:active?undefined:'succeeded'}),active:async()=>active?{ses_worker:{type:'running'}}:{},diff:async()=>[],interrupt:async()=>{calls.push(['interrupt']);return {interrupted:true};},form:{list:async()=>forms,get:async({formID})=>({...forms.find(f=>f.id===formID),state:{status:'pending'}}),reply:async p=>{calls.push(['answer',p]);forms=[];}}},permission:{list:async()=>permissions,reply:async p=>{calls.push(['permission',p]);permissions=[];}},message:{list:async()=>({data:[{type:'assistant',content:[{type:'text',text:'visible result'},{type:'reasoning',text:'hidden'}]}]})}};
 const api={on(n,fn){if(n==='gateway_stop')stop=fn;}};const adapter=installOpenCode(api,ledger,owners,async()=>({client:c,pid:1}));
 const contract={worker:'opencode',projectRoot:root,expectedRevision:1,model:'opencode/space-bunny-free',request:'Fix bug',purpose:'Meet request',scope:'Existing code',context:'Accepted requirement',output:'Diff and result',verification:'Relevant check'};
 return {b,ledger,calls,adapter,contract,stop:()=>stop(),permission(){permissions=[{id:'request_original',sessionID:'ses_worker'}];},form(){forms=[{id:'form_original',sessionID:'ses_worker',title:'Name'}];},idle(){active=false;},revoke(){valid=false;}};
}
test('private environment drops all unrelated secrets and profile overrides; permission config does not auto-answer',()=>{
 const env=cleanWorkerEnv({PATH:'system',JARVIS_GATEWAY_TOKEN:'private',GEMINI_API_KEY:'private',CUSTOM_JARVIS_SECRET:'private',OPENCODE_CONFIG_CONTENT:'unsafe',OPENCODE_API_KEY:'provider'},root);
 assert.equal(env.OPENCODE_API_KEY,'provider');for(const k of ['JARVIS_GATEWAY_TOKEN','GEMINI_API_KEY','CUSTOM_JARVIS_SECRET','OPENCODE_CONFIG_CONTENT'])assert.equal(env[k],undefined);
 assert.ok(env.XDG_DATA_HOME.startsWith(root));assert.equal(workerConfig().share,'disabled');assert.ok(!JSON.stringify(workerConfig()).includes('always'));
});
test('profile helper supports the installed synchronous plugin loader and preserves shell system environment',()=>{
 assert.equal(typeof createRequire(import.meta.url)('../scripts/jarvis-opencode-profile.mjs').profileConnection,'function');
 const env=shellWorkerEnv({Path:'native-path',SystemRoot:'windows',OPENCODE_API_KEY:'provider',JARVIS_TOKEN:'secret'},root);
 assert.equal(env.PATH,'native-path');assert.equal(env.SystemRoot,'windows');assert.equal(env.OPENCODE_API_KEY,'');assert.equal(env.JARVIS_TOKEN,undefined);
});
test('stage10 keeps main model, global shell denial and research policy; only selected worker catalog added',()=>{
 const c=applyPolicy({agents:{defaults:{workspace:root,model:{primary:'opencode/space-bunny-free',fallbacks:[]}},entries:{}},plugins:{entries:{}}},root),before=structuredClone(c);
 applyWorkers(c);const after=applyPolicy(c,root);assertPolicy(after,root);assert.deepEqual(after.tools.exec,before.tools.exec);assert.deepEqual(after.agents.entries.research,before.agents.entries.research);assert.deepEqual(after.agents.defaults.model,before.agents.defaults.model);assert.equal(after.agents.defaults.models['opencode/space-bunny-free'].agentRuntime.id,'jarvis-opencode-main');
});
test('common contract requires original worker choice, exact root/revision and bounded fields',async()=>{
 const f=fixture();assert.equal(selectedWorker(f.b.scope),'opencode');assert.throws(()=>selectedWorker({...f.b.scope,userStatement:'choose something'}));
 for(const p of [{worker:'codex'},{expectedRevision:2},{model:'paid/other'},{projectRoot:path.dirname(root)},{verification:''}])await assert.rejects(workerContract({...f.contract,...p},f.b.scope,1,'opencode'));
 await f.stop();
});
test('worker defaults apply only to omitted settings and explicit human settings take priority',()=>{
 assert.deepEqual(workerSettings({}, {}, 'codex'),{model:'openai/gpt-6-luna',thinking:'xhigh'});
 assert.deepEqual(workerSettings({}, {}, 'opencode'),{model:'opencode/space-bunny-free',thinking:'max'});
 assert.deepEqual(workerSettings({model:'openai/gpt-6-sol',thinking:'low'}, {}, 'codex'),{model:'openai/gpt-6-sol',thinking:'low'});
 assert.deepEqual(workerSettings({model:'openai/gpt-6-sol',thinking:'low'},{userStatement:'Codex ile Luna 6 xhigh kullan'},'codex'),{model:'openai/gpt-6-luna',thinking:'xhigh'});
 assert.deepEqual(workerSettings({model:'openai/gpt-6-luna'},{userStatement:'Codex ile gpt-6-sol low kullan'},'codex'),{model:'openai/gpt-6-sol',thinking:'low'});
 assert.equal(selectedWorker({userStatement:'OpenCod kullanarak uygulama yap'}),'opencode');
});
test('native identity, secret shadowing, steer/continue and visible result follow one session',async()=>{
 const f=fixture();await f.adapter.control(f.b,f.contract,'start');assert.equal(f.calls.find(c=>c[0]==='environment')[1].variables.OPENCODE_API_KEY,'');assert.equal(f.calls.find(c=>c[0]==='create')[1].model.variant,'max');
 let s=await f.adapter.control(f.b,{},'status');assert.equal(s.result,'visible result');assert.equal(s.sessionId,'ses_worker');
 await f.adapter.control(f.b,{expectedRevision:1,message:'New constraint',inputId:'steer_one'},'steer');assert.equal(f.calls.filter(c=>c[0]==='prompt').at(-1)[1].delivery,'steer');
 await assert.rejects(f.adapter.control(f.b,{expectedRevision:2,message:'continue',inputId:'wrong'},'continue'));f.idle();
 await f.adapter.control(f.b,{expectedRevision:2,message:'Correct output',inputId:'continue_one'},'continue');assert.equal(f.calls.filter(c=>c[0]==='prompt').at(-1)[1].delivery,'queue');await f.stop();
});
test('real pending request blocks new input; user once decision uses exact ID and cannot be replayed',async()=>{
 const f=fixture();await f.adapter.control(f.b,f.contract,'start');f.permission();await assert.rejects(f.adapter.control(f.b,{expectedRevision:1,message:'ignore',inputId:'new'},'steer'));
 await assert.rejects(f.adapter.answer(f.b,{expectedRevision:1,kind:'permission',requestId:'other',decision:'once'}));await assert.rejects(f.adapter.answer(f.b,{expectedRevision:1,kind:'permission',requestId:'request_original',decision:'always'}));
 await f.adapter.answer(f.b,{expectedRevision:1,kind:'permission',requestId:'request_original',decision:'once'});await assert.rejects(f.adapter.answer(f.b,{expectedRevision:1,kind:'permission',requestId:'request_original',decision:'once'}));await f.stop();
});
test('native interruption never asserts every subprocess stopped; revoked task cannot steer',async()=>{
 const f=fixture();await f.adapter.control(f.b,f.contract,'start');const r=await f.adapter.control(f.b,{expectedRevision:1},'interrupt');assert.equal(r.cancellationConfirmed,false);assert.equal(f.calls.filter(c=>c[0]==='interrupt').length,1);f.revoke();await assert.rejects(f.adapter.control(f.b,{expectedRevision:1,message:'resume',inputId:'x'},'continue'));await f.stop();
});
test.after(()=>fs.rm(root,{recursive:true,force:true}));
