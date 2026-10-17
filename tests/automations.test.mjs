import test from 'node:test';
import assert from 'node:assert/strict';
import {automationParams} from '../plugins/jarvis/automations.ts';
import {evaluate} from '../plugins/jarvis/policy.ts';
import {applyAutomations} from '../scripts/jarvis-automation-config.mjs';
import {separateCodexTools} from '../scripts/codex-worker-policy.mjs';
import {scheduledTaskScope,consumeScheduledAdmission} from '../plugins/jarvis/scheduled-task.ts';
import fs from 'node:fs/promises';
import path from 'node:path';
const scope={agentId:'main',sessionKey:'agent:main:private',sessionId:'sid',runId:'r',role:'memory',userStatement:'Her gün 09:30 su içmemi hatırlat',expiresAt:Date.now()+60000};
const job=()=>({name:'Su',description:'Su hatırlatması',schedule:{kind:'cron',expr:'30 9 * * *',tz:'Europe/Istanbul'},payload:{kind:'agentTurn',message:'su',toolsAllow:[]}});
test('native request binds reminder purpose, Istanbul time and durable current conversation delivery',()=>{
 const p=automationParams({action:'add',job:job()},scope);
 assert.equal(p.job.sessionKey,scope.sessionKey);assert.equal(p.job.sessionTarget,'current');assert.deepEqual(p.job.delivery,{mode:'announce'});
 assert.equal(p.job.schedule.staggerMs,0);assert.deepEqual(p.job.payload.toolsAllow,[]);assert.ok(p.job.payload.message.includes(scope.userStatement));
 assert.equal(job().sessionKey,undefined);
});
test('native boundary rejects command, webhook, another session, paid model, inherited tool effects and force replay',()=>{
 for(const patch of [{delivery:{mode:'webhook',to:'https://example.com'}},{sessionKey:'agent:main:other'},{agentId:'research'},{sessionTarget:'isolated'},{trigger:{script:'fetch()'}},{schedule:{kind:'stream',command:['pwsh']}},{payload:{kind:'agentTurn',message:'x',toolsAllow:['exec']}},{payload:{kind:'agentTurn',message:'x',toolsAllow:[],model:'paid'}}])assert.throws(()=>automationParams({action:'add',job:{...job(),...patch}},scope));
 assert.throws(()=>automationParams({action:'run',jobId:'j'},scope));
 assert.throws(()=>automationParams({action:'add',gatewayToken:'secret',job:job()},scope));
});
test('only explicit current user scheduling can mutate; management targets must be named',()=>{
 for(const userStatement of [undefined,'araştır: her gün 09:30 hatırlatma nasıl çalışır','Merhaba'])assert.throws(()=>automationParams({action:'add',job:job()},{...scope,userStatement}));
 assert.throws(()=>automationParams({action:'remove',jobId:'j'},scope));
 assert.equal(automationParams({action:'remove',jobId:'j'},{...scope,userStatement:'j otomasyonunu kaldır'}).action,'remove');
 assert.deepEqual(automationParams({action:'update',jobId:'j',job:{enabled:false}},{...scope,userStatement:'j otomasyonunu duraklat'}).job,{enabled:false});
 assert.throws(()=>automationParams({action:'add',job:job()},{...scope,role:'research'}));
 assert.throws(()=>automationParams({action:'add',job:job()},{...scope,userStatement:'Her gün 10:30 hatırlat'}));
});
test('existing task authority stays authoritative; stale identity cannot enable native scheduling',async()=>{
 const event={toolName:'automations',params:{action:'add',job:job()}},ctx={...scope};
 assert.equal((await evaluate(event,ctx,scope)).params.sessionKey,undefined);
 for(const key of ['runId','sessionId','sessionKey','agentId'])assert.equal((await evaluate(event,{...ctx,[key]:'other'},scope)).block,true);
 assert.equal((await evaluate(event,ctx,{...scope,expiresAt:0})).block,true);
});
test('config opt-in enables only existing main native tool and preserves research and worker permissions',()=>{
 const c={plugins:{entries:{jarvis:{config:{nativeAutomations:true}}}},agents:{entries:{main:{tools:{allow:['read']}},research:{tools:{allow:['tavily_search']}}}},tools:{allow:['read'],deny:['automations','cron','exec']}};
 const research=structuredClone(c.agents.entries.research);
 const p=applyAutomations(c);assert.deepEqual(p.agents.entries.main.tools.allow,['read','automations']);assert.deepEqual(p.agents.entries.research,research);assert.deepEqual(p.tools.deny,['exec']);
 assert.equal(p.plugins.entries.jarvis.config.operatorAdmin,undefined);
});

test('automation composition preserves per-agent file/research caps after Codex separation',()=>{
 const c={plugins:{entries:{jarvis:{config:{nativeAutomations:true}}}},agents:{entries:{main:{tools:{allow:['read','write','edit']}},research:{tools:{allow:['tavily_search','web_fetch']}}}},tools:{allow:['read','write','edit','tavily_search','web_fetch'],deny:['exec','process']}};
 separateCodexTools(c,'C:/profile');
 const research=structuredClone(c.agents.entries.research),worker=structuredClone(c.agents.entries['jarvis-codex']);
 applyAutomations(c);
 assert.equal(Object.hasOwn(c.tools,'allow'),false);
 assert.deepEqual(c.agents.entries.main.tools.allow,['read','write','edit','automations']);
 assert.deepEqual(c.agents.entries.main.tools.deny,['exec','process']);
 assert.deepEqual(c.agents.entries.research,research);assert.deepEqual(c.agents.entries['jarvis-codex'],worker);
 const once=structuredClone(c);applyAutomations(c);assert.deepEqual(c,once);
});
test('native scheduled project occurrence restores file tools without replaying human decisions',async()=>{
 const root=await fs.mkdtemp(path.resolve('tmp','jarvis-scheduled-'));
 try{
  const creator={...scope,role:'project',root,userId:'human',deviceId:'pc',projectId:'project',taskId:'original',userStatement:'Her gün 09:30 proje dosyalarını oku ve rapor yaz, zamanla'};
  const spec=job();spec.payload.toolsAllow=['read','write'];spec.payload.message='Proje dosyalarını oku.\nRapor yaz.';
  assert.throws(()=>automationParams({action:'add',job:spec},{...creator,userStatement:scope.userStatement}));
  const normalized=automationParams({action:'add',job:spec},creator).job;
  assert.equal(JSON.parse(normalized.description).root,root);
  const admission={runId:'scheduled-run',jobId:'job',sessionKey:scope.sessionKey,sessionId:'sid',agentId:'main',job:{...normalized,owner:{sessionKey:scope.sessionKey},createdActor:{id:'human'},scheduledToolPolicy:{mode:'account'},toolsAllowProvenance:{source:'final-executable-surface'}}};
  const admitted=await scheduledTaskScope(admission);
  const scratch=new Map();const store={getRunContext:p=>scratch.get(p.namespace),setRunContext:p=>{scratch.set(p.namespace,p.value);return true;}};
  consumeScheduledAdmission(store,admission.runId);scratch.set('scope',admitted.scope);scratch.delete('scope');
  assert.throws(()=>consumeScheduledAdmission(store,admission.runId),/revoked/);
  assert.throws(()=>consumeScheduledAdmission({getRunContext:()=>undefined,setRunContext:()=>false},'other'));
  assert.equal(admitted.scope.projectId,'project');assert.equal(admitted.scope.userStatement,undefined);assert.deepEqual(admitted.scope.quick,[]);
  assert.equal((await evaluate({toolName:'write',params:{path:path.join(root,'report.txt'),content:'report'}},admitted.scope,admitted.scope)).block,undefined);
  for(const bad of [{owner:{sessionKey:'other'}},{createdActor:{id:'other'}},{payload:{toolsAllow:['jarvis_send']}},{toolsAllowProvenance:{source:'authenticated-requester'}}])await assert.rejects(()=>scheduledTaskScope({...admission,job:{...admission.job,...bad}}));
  for(const name of ['exec','jarvis_send','jarvis_worker','automations'])assert.throws(()=>automationParams({action:'add',job:{...spec,payload:{...spec.payload,toolsAllow:[name]}}},creator));
  const forged=automationParams({action:'add',job:{...spec,description:JSON.stringify({root:'C:\\Windows',userId:'other'})}},creator);
  assert.equal(JSON.parse(forged.job.description).root,root);assert.equal(JSON.parse(forged.job.description).userId,'human');
 }finally{await fs.rm(root,{recursive:true,force:true});}
});
