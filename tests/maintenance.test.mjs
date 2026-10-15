import test, {after} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {RawCopyMaintenance,RAW_DAYS_MS,MAINTENANCE_INTERVAL_MS,installMaintenance,NATIVE_MAINTENANCE_BLOCKERS} from '../plugins/jarvis/maintenance.ts';
import {previewForget} from '../plugins/jarvis/forget.ts';
import {writeNote,readNote,memoryParams} from '../plugins/jarvis/notes.ts';
import {installLive} from '../plugins/jarvis/live.ts';
import {applyMaintenance} from '../scripts/jarvis-stage14-config.mjs';

const tmp=path.resolve('tmp');fs.mkdirSync(tmp,{recursive:true});
const scratch=fs.mkdtempSync(path.join(tmp,'stage14-'));
after(()=>{assert.ok(scratch.startsWith(tmp+path.sep));fs.rmSync(scratch,{recursive:true});});
const digest=b=>createHash('sha256').update(b).digest('hex');
function store(){const rows=new Map();let scans=0;return {rows,get scans(){return scans;},async lookup(k){return structuredClone(rows.get(k));},async register(k,v){rows.set(k,structuredClone(v));},async registerIfAbsent(k,v){if(rows.has(k))return false;rows.set(k,structuredClone(v));return true;},async delete(k){return rows.delete(k);},async entriesInKeyRange(q){scans++;return [...rows].filter(([k])=>k>=q.keyStartInclusive&&k<q.keyEndExclusive).sort(([a],[b])=>a.localeCompare(b)).slice(0,q.limit).map(([key,value])=>({key,value:structuredClone(value)}));}};}
function fixture(){const root=fs.mkdtempSync(path.join(scratch,'raw-')),s=store(),abort=new AbortController();let busy=false,safe=true,now=Date.UTC(2026,9,15);const engine=new RawCopyMaintenance(root,s,()=>busy,abort.signal,async()=>safe,()=>now);return {root,s,abort,engine,set busy(v){busy=v;},set safe(v){safe=v;},set now(v){now=v;},get now(){return now;}};}
function copy(f,age=31){const id=randomUUID(),messageAt=f.now-age*86400000,messageId=randomUUID();const raw=JSON.stringify({kind:'jarvis-raw-message-v1',messageId,timestamp:messageAt,role:'user',content:'Fixture raw message, never a persistent note'});const file=path.join(f.root,id+'.json');fs.writeFileSync(file,raw);return {file,descriptor:{id,messageId,messageAt,sha256:digest(raw),userId:'user',taskId:'task'}};}
const track=(f,c)=>f.engine.track(c.descriptor,()=>{});

test('message time decides expiry despite new file mtime; unrelated durable files survive',async()=>{
  const f=fixture(),old=copy(f),fresh=copy(f,2);fs.writeFileSync(path.join(f.root,'MEMORY.md'),'permanent fact');
  await track(f,old);await track(f,fresh);const result=await f.engine.tick();
  assert.equal(result.removed,1);assert.equal(fs.existsSync(old.file),false);assert.ok(fs.existsSync(fresh.file));assert.equal(fs.readFileSync(path.join(f.root,'MEMORY.md'),'utf8'),'permanent fact');
  assert.equal(f.s.rows.get('audit:'+old.descriptor.id).state,'removed');
  assert.equal(JSON.stringify([...f.s.rows]).includes('Fixture raw message'),false);
});
test('boundary is 30 days and no traffic extends the original timestamp',async()=>{
  const f=fixture(),c=copy(f,30);f.now-=1;await track(f,c);assert.equal((await f.engine.tick()).removed,0);f.now+=1;assert.equal((await f.engine.tick()).removed,1);assert.equal(RAW_DAYS_MS,30*86400000);
});
test('idle check reads only the persisted watermark; batches never exceed four',async()=>{
  const f=fixture();assert.equal((await f.engine.tick()).state,'idle');assert.equal(f.s.scans,0);
  for(let i=0;i<5;i++)await track(f,copy(f));assert.equal((await f.engine.tick()).removed,4);assert.equal((await f.engine.tick()).removed,1);
});
test('speech/playback/active write, maintenance lock, and shutdown defer removal',async()=>{
  const f=fixture(),c=copy(f);await track(f,c);f.busy=true;assert.equal((await f.engine.tick()).state,'deferred');f.busy=false;
  fs.writeFileSync(path.join(f.root,'.maintenance.lock'),'');assert.equal((await f.engine.tick()).state,'deferred');fs.unlinkSync(path.join(f.root,'.maintenance.lock'));
  f.abort.abort();assert.equal((await f.engine.tick()).removed,0);assert.ok(fs.existsSync(c.file));
});
test('missing continuation summary blocks only its managed copy, and the issue survives later ticks',async()=>{
  const f=fixture(),c=copy(f);await track(f,c);f.safe=false;
  assert.equal((await f.engine.tick()).state,'partial');assert.ok(fs.existsSync(c.file));assert.equal((await f.engine.tick()).blocked,1);
  assert.match(f.s.rows.get('issue:'+c.descriptor.id).reason,/continuation/);
});
test('changed content and hardlinks refuse removal without blind retry',async()=>{
  for(const mode of ['changed','hardlink']){
    const f=fixture(),c=copy(f);await track(f,c);
    if(mode==='changed')fs.appendFileSync(c.file,' ');else fs.linkSync(c.file,path.join(f.root,'outside-link'));
    assert.equal((await f.engine.tick()).state,'partial');assert.ok(fs.existsSync(c.file));assert.equal((await f.engine.tick()).removed,0);
  }
});
test('foreign root junction and unsupported mixed/reasoning file cannot be enrolled',async()=>{
  const f=fixture(),c=copy(f);const link=path.join(scratch,'link-'+randomUUID());fs.symlinkSync(f.root,link,'junction');
  const engine=new RawCopyMaintenance(link,f.s,()=>false,f.abort.signal,async()=>true,()=>f.now);
  await assert.rejects(engine.track(c.descriptor,()=>{}),/Linked/);
  fs.writeFileSync(c.file,JSON.stringify({kind:'jarvis-raw-message-v1',messageId:c.descriptor.messageId,timestamp:c.descriptor.messageAt,role:'reasoning',content:'not accepted'}));
  c.descriptor.sha256=digest(fs.readFileSync(c.file));await assert.rejects(track(f,c),/unsupported format/);
});
test('busy/abort arriving during summary validation prevents final unlink',async()=>{
  const f=fixture(),c=copy(f);await track(f,c);
  const engine=new RawCopyMaintenance(f.root,f.s,()=>false,f.abort.signal,async()=>{f.abort.abort();return true;},()=>f.now);
  assert.equal((await engine.tick()).removed,0);assert.ok(fs.existsSync(c.file));
});
test('interrupted successful unlink resumes bookkeeping, without deleting another file',async()=>{
  const f=fixture(),c=copy(f);await track(f,c);const key=[...f.s.rows.keys()].find(k=>k.startsWith('raw:'));f.s.rows.get(key).phase='removing';fs.unlinkSync(c.file);
  assert.equal((await f.engine.tick()).removed,1);assert.equal(f.s.rows.get('audit:'+c.descriptor.id).state,'removed-after-interrupted-bookkeeping');
});
test('eligibility is durable before enrollment; cancellation cannot commit a hidden raw row',async()=>{
  const f=fixture(),c=copy(f),register=f.s.register;let current=true;
  f.s.register=async(k,v)=>{await register(k,v);if(k==='watermark')current=false;};
  await assert.rejects(f.engine.track(c.descriptor,()=>{if(!current)throw Error('revoked');}),/revoked/);
  assert.equal([...f.s.rows.keys()].some(k=>k.startsWith('raw:')),false);assert.ok(fs.existsSync(c.file));
  assert.equal((await f.engine.tick()).removed,0);
});
test('native lifecycle schedules immediate bounded startup then 60000ms and joins on stop',async()=>{
  let service,scheduled,stopped=false;const s=store(),abort=new AbortController();
  const status=installMaintenance({registerService(v){service=v;},on(){},runtime:{state:{openKeyedStore(){return s;}}}},()=>false,async()=>true);
  assert.deepEqual(NATIVE_MAINTENANCE_BLOCKERS,['unclassified-custom-control-raw-payloads']);
  service.start({stateDir:scratch,scheduler:{signal:abort.signal,now:Date.now,schedule(p){scheduled=p;return {async stop(){stopped=true;}};}}});
  assert.equal(service.apiVersion,2);assert.equal(scheduled.delayMs,0);assert.equal(scheduled.everyMs,MAINTENANCE_INTERVAL_MS);await scheduled.run();assert.equal(status.status().complete,false);assert.deepEqual(status.status().nativeBlocked,NATIVE_MAINTENANCE_BLOCKERS);await service.stop();assert.ok(stopped);
});
test('configuration adds the narrow forget preview/apply tools without provider or Full access changes',()=>{
  const c={agents:{entries:{main:{tools:{allow:['existing']}}}},tools:{allow:['existing']},plugins:{entries:{codex:{config:{appServer:{sandbox:'danger-full-access'}}}}},models:{primary:'unchanged',fallbacks:[]}};
  const expected=structuredClone(c);expected.agents.entries.main.tools.allow.push('jarvis_note_forget_preview','jarvis_note_forget');expected.tools.allow.push('jarvis_note_forget_preview','jarvis_note_forget');
  assert.deepEqual(applyMaintenance(structuredClone(c)),expected);assert.deepEqual(applyMaintenance(applyMaintenance(structuredClone(c))),expected);
});
const origin={kind:'user',userId:'owner',taskId:'task',projectId:'project',sessionId:'session',sessionKey:'agent:main:session',runId:'run',deviceId:'device'};
test('forget preview follows versions and mixed derivations; never mutates source or claims deletion',()=>{
  const workspace=fs.mkdtempSync(path.join(scratch,'notes-'));
  const save=input=>writeNote(workspace,{expectedRevision:0,category:'preference',content:'Koyu tema tercih ediyorum.',...input},origin,()=>{});
  const a=save({}),other=save({content:'Türkçe yanıtları tercih ediyorum.'});
  save({id:a.note.id,expectedRevision:1,category:'correction',content:'Açık tema tercih ediyorum.'});
  const mixed=save({content:'İki tercihi birleştiren not',derivedFrom:[{id:a.note.id,revision:1},{id:other.note.id,revision:1}]});
  const result=previewForget(workspace,'owner',a.note.id,2,()=>{});
  assert.deepEqual(result.related.find(n=>n.id===a.note.id).revisions,[1,2]);assert.equal(result.related.find(n=>n.id===mixed.note.id).mixed,true);assert.equal(result.canApply,false);assert.equal(result.sourceChanged,false);assert.match(result.message,/henüz silinmedi/);
  assert.equal(readNote(workspace,a.note.id,1).content,a.note.content);assert.equal(readNote(workspace,other.note.id).content,other.note.content);
  assert.throws(()=>previewForget(workspace,'foreign',a.note.id,2,()=>{}),/owner/);assert.throws(()=>previewForget(workspace,'owner',a.note.id,1,()=>{}),/REVISION_CONFLICT/);assert.throws(()=>previewForget(workspace,'owner',a.note.id,2,()=>{throw Error('revoked');}),/revoked/);
  assert.throws(()=>memoryParams('jarvis_note_forget_preview',{id:a.note.id,expectedRevision:2,session:'whole-session'}),/Unknown/);
});
test('Live exposes preview only and open speech session conservatively holds maintenance',async()=>{
  const methods={};const live=installLive({config:{},registerGatewayMethod(n,fn){methods[n]=fn;},on(){}},()=>scratch,async()=>{},async()=>{});
  const request={params:{sessionKey:'agent:main:test',agentId:'main'},client:{connId:'connection',authenticatedUserId:'owner',connect:{role:'operator',scopes:['operator.talk','operator.write'],device:{id:'device'}}},sessionAccessAuthority:{target:{agentId:'main',sessionId:'session',sessionKey:'agent:main:test'},assertCurrent(){},retain(){return {assertCurrent(){},signal:new AbortController().signal,release(){}};}}};
  assert.equal(live.isBusy(),false);const catalog=await new Promise(resolve=>methods['jarvis.live.catalog']({...request,respond:(ok,p,e)=>{assert.equal(ok,true,e?.message);resolve(p);}}));
  assert.ok(catalog.tools.some(t=>t.name==='jarvis_forget_preview'));assert.equal(catalog.tools.some(t=>t.name==='jarvis_forget_apply'),false);
  await new Promise(resolve=>methods['jarvis.live.open']({...request,params:{...request.params,voiceSessionId:'voice'},respond:(ok,p,e)=>{assert.equal(ok,true,e?.message);resolve(p);}}));assert.equal(live.isBusy(),true);
});
