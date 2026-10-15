import test from 'node:test';
import assert from 'node:assert/strict';
import {InputAttempts,bindChatTask,sendBrowserChat} from '../apps/desktop/src/shared/chat-task.ts';
import {ScheduledResults} from '../apps/desktop/src/shared/scheduled-results.ts';
import {BrowserTalkOwner} from '../apps/desktop/src/shared/browser-talk-owner.ts';
import {VoiceDecisions} from '../apps/desktop/src/shared/voice-decisions.ts';
import {VoiceRpc} from '../apps/desktop/src/main/voice-policy.ts';
const key='agent:main:jarvis:daily:phone';
test('phone text and receipt/reconnect paths never obtain PC audio authority or resend a prior input',async()=>{
 const data=new Map(),storage={getItem:k=>data.get(k)??null,setItem:(k,v)=>data.set(k,v)};globalThis.sessionStorage=storage;
 const calls=[],rpc={connected:true,async request(m,p){calls.push([m,p]);if(m==='jarvis.work.status')return {records:[{sessionKey:key,sessionId:'sid',projectId:'project'}]};if(m==='jarvis.scope.bind')return {bound:true,sessionId:'sid'};if(m==='jarvis.work.start')return {record:{runId:p.runId},dispatched:true};throw new Error(m);}};
 const pc=new VoiceRpc(rpc);await sendBrowserChat(rpc,{sessionKey:key,sessionId:'sid',idempotencyKey:'phone-input-1',message:'Yazılı görev'});
 assert.equal(pc.allowed,false);assert.equal(pc.voiceId,undefined);
 assert.equal(calls.find(([m])=>m==='jarvis.scope.bind')[1].projectId,'project');
 const before=calls.length;await assert.rejects(sendBrowserChat(rpc,{sessionKey:key,idempotencyKey:'phone-input-1',message:'Yazılı görev'}));assert.equal(calls.length,before);
 assert.equal(calls.some(([m])=>m.startsWith('talk.')||m.includes('voice')),false);
 const restored=new InputAttempts(storage);assert.throws(()=>restored.consume('phone-input-1'));
});
test('shared task binding keeps selected project and explicit folder; history is not copied',async()=>{
 let p;await bindChatTask({async request(m,v){assert.equal(m,'jarvis.scope.bind');p=v;}},key,'r','Talimat',{projectId:'same-project',root:'C:\\chosen'});
 assert.equal(p.projectId,'same-project');assert.equal(p.role,'project');assert.equal(p.userInput,'Talimat');assert.equal(p.history,undefined);
});
test('scheduled notification uses admission snapshot and exact run; old result is never labeled with a new job revision',()=>{
 const updates=new ScheduledResults(),job={agentId:'main',owner:{sessionKey:key},sessionKey:key,sessionTarget:'current',name:'eski ad',configRevision:'old'};
 updates.receive({action:'started',jobId:'j',runAtMs:10,job},[key]);
 const r=updates.receive({action:'finished',jobId:'j',runId:'run',runAtMs:10,job:{...job,name:'yeni ad',configRevision:'new'},completionStatus:'succeeded',summary:'özgün sonuç'},[key]);
 assert.ok(r.text.includes('eski ad'));assert.ok(r.text.includes('old'));assert.equal(r.text.includes('new'),false);
 assert.equal(updates.receive({action:'finished',jobId:'j',runId:'run',runAtMs:10,job},[key]),undefined);
 assert.equal(updates.receive({action:'finished',jobId:'j',runId:'offline',runAtMs:1,job},[key]),undefined);
 assert.equal(updates.drain(key).length,1);assert.equal(updates.drain(key).length,0);
});
test('browser voice requires secure local action; background/reconnect cannot reopen it',async()=>{
 const doc=new EventTarget();doc.hidden=false;globalThis.document=doc;
 const events=new EventTarget();globalThis.addEventListener=events.addEventListener.bind(events);globalThis.removeEventListener=events.removeEventListener.bind(events);
 Object.defineProperty(globalThis,'navigator',{configurable:true,value:{userActivation:{isActive:false}}});
 globalThis.isSecureContext=false;let stopped=0;
 const session={getVoiceSessionId:()=> 'phone-voice',presentQuestion(){},isOutputPlaying:()=>false,updateContext(){},async stop(){stopped++;}};
 const client={connected:true,async request(){return {records:[],requests:[],grants:[]};}};
 const owner=new BrowserTalkOwner(client,key,()=>session);assert.throws(()=>owner.startLocal(true));
 globalThis.isSecureContext=true;assert.throws(()=>owner.startLocal());owner.startLocal(true);
 doc.hidden=true;doc.dispatchEvent(new Event('visibilitychange'));await Promise.resolve();assert.equal(stopped,1);
 client.connected=false;client.connected=true;assert.equal(stopped,1);assert.throws(()=>owner.startLocal());owner.close();
});
test('two paired-device presentations obey the native registry first decision',async()=>{
 let rows=[{family:'approval',kind:'plugin',id:'one',status:'pending',taskId:'t',revision:1,expiresAtMs:Date.now()+60000,params:{target:'fixed'}}],resolved=0;
 const rpc={async request(m){if(m==='jarvis.decisions.pending')return {requests:rows};if(m==='jarvis.decisions.grants')return {grants:[]};if(m==='approval.resolve'){resolved++;rows=[];return {}; }throw new Error(m);}};
 const make=voice=>new VoiceDecisions(rpc,()=>({allowed:true,voiceId:voice,key,muted:false}),()=>{},()=>{});
 const a=make('pc'),b=make('phone');
 for(const c of [a,b]){await c.refresh();c.presented(c.active.token);c.input(c.active.token,'utterance');}
 await a.final(a.active.token,'utterance','evet');await b.final(b.active.token,'utterance','evet');assert.equal(resolved,1);
});
