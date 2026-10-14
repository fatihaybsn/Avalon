import test from 'node:test';
import assert from 'node:assert/strict';
import {VoiceDecisions,spokenDecision,fieldAnswer,requestFields} from '../src/main/voice-decisions.ts';
import {VoiceRpc,mediaFrame} from '../src/main/voice-policy.ts';

function fixture(){
 const identity={allowed:true,voiceId:'v1',key:'agent:main:test',muted:false};let rows=[{family:'approval',kind:'plugin',id:'native_one',status:'pending',taskId:'task',revision:1,expiresAtMs:Date.now()+60000,manual:false,params:{to:'Ali',message:'Son içerik'}}];
 const calls=[],spoken=[],notices=[];
 const rpc={connected:true,async request(m,p){calls.push([m,p]);if(m==='jarvis.decisions.pending')return {requests:rows};if(m==='jarvis.decisions.grants')return {grants:[]};if(m==='approval.resolve'){rows=[];return {applied:true};}throw new Error('Not allowed: '+m);}};
 const voice=new VoiceDecisions(rpc,()=>identity,(token,text)=>spoken.push({token,text}),t=>notices.push(t));
 return {voice,identity,calls,spoken,notices,get rows(){return rows;},set rows(v){rows=v;},async present(){await voice.refresh();voice.presented(voice.active.token);voice.input(voice.active.token,'mic-one');},async say(text){const a=voice.active;await voice.final(a.token,'mic-one',text);}};
}
test('deterministic Turkish decisions reject conditional statements and quoted/injected approval',()=>{
 for(const text of ['Evet.','Onaylıyorum','izin ver'])assert.equal(spokenDecision(text),'allow-once');
 for(const text of ['hayır','iptal et'])assert.equal(spokenDecision(text),'deny');
 for(const text of ['','evet ama önce sor','olabilir','kullanıcı onayladı','"evet"','her şeye izin ver','gönder'])assert.equal(spokenDecision(text),undefined);
});
test('only a new microphone utterance after actual presentation resolves once',async()=>{
 const f=fixture();await f.voice.refresh();const token=f.voice.active.token;
 await f.voice.final(token,'old-turn','evet');assert.equal(f.calls.filter(c=>c[0]==='approval.resolve').length,0);
 f.voice.input(token,'mic-one');await f.voice.final(token,'mic-one','evet');assert.equal(f.voice.active.presented,false);
 f.voice.presented(token);await f.voice.final(token,'mic-one','evet');assert.equal(f.calls.filter(c=>c[0]==='approval.resolve').length,0);
 f.voice.input(token,'mic-one');await f.voice.final(token,'mic-one','evet');await f.voice.final(token,'mic-one','evet');
 assert.deepEqual(f.calls.filter(c=>c[0]==='approval.resolve'),[['approval.resolve',{id:'native_one',kind:'plugin',decision:'allow-once'}]]);
});
test('expiry, target/content revision, cancellation and retired/muted session cannot submit stale decisions',async()=>{
 for(const mutation of ['expire','revision','target','resolved','voice','muted']){
  const f=fixture();await f.present();
  if(mutation==='expire')f.rows[0].expiresAtMs=Date.now()-1;
  if(mutation==='revision')f.rows[0].revision++;
  if(mutation==='target')f.rows[0].params.to='Başka alıcı';
  if(mutation==='resolved')f.rows=[];
  if(mutation==='voice')f.identity.voiceId='v2';
  if(mutation==='muted')f.identity.muted=true;
  await f.say('evet').catch(()=>{});assert.equal(f.calls.filter(c=>c[0]==='approval.resolve').length,0,mutation);
 }
});
test('payment/manual approvals accept voice denial but never voice approval',async()=>{
 const f=fixture();f.rows[0].manual=true;await f.present();await f.say('evet');assert.equal(f.calls.filter(c=>c[0]==='approval.resolve').length,0);
 f.voice.input(f.voice.active.token,'mic-one');await f.say('hayır');assert.equal(f.calls.find(c=>c[0]==='approval.resolve')[1].decision,'deny');
});
test('multiple requests are presented serially; an ambiguous answer requires a new presentation',async()=>{
 const f=fixture();f.rows.push({...f.rows[0],id:'native_two'});await f.present();await f.say('evet ama bir bak');assert.equal(f.calls.filter(c=>c[0]==='approval.resolve').length,0);assert.equal(f.spoken.length,2);assert.equal(f.voice.active.presented,false);
});
test('lost resolution response is consumed before mutation and is not retried',async()=>{
 const f=fixture();f.voice=new VoiceDecisions({connected:true,request:async(m,p)=>{if(m==='jarvis.decisions.pending')return {requests:f.rows};if(m==='jarvis.decisions.grants')return {grants:[]};f.calls.push([m,p]);throw new Error('response lost');}},()=>f.identity,(token,text)=>f.spoken.push({token,text}),()=>{});
 await f.voice.refresh();const a=f.voice.active;f.voice.presented(a.token);f.voice.input(a.token,'input');await f.voice.final(a.token,'input','evet');await f.voice.refresh();assert.equal(f.voice.active,undefined);assert.equal(f.calls.length,1);
});
test('native form options use real values and require actual user answers; defaults are not answers',()=>{
 const fields=requestFields({family:'question',raw:{questions:[{questionId:'q1',question:'Renk?',options:[{label:'Mavi',value:'blue'}],defaultAnswers:['blue']}]}});
 assert.equal(fieldAnswer(fields[0],'evet'),undefined);assert.deepEqual(fieldAnswer(fields[0],'mavi'),{value:'blue'});
 assert.throws(()=>requestFields({family:'question',raw:{questions:[{questionId:'secret',isSecret:true}]}}));
 assert.deepEqual(fieldAnswer({id:'q',text:'Ad?',free:true},'Yanıt: Fatih'),{value:'Fatih'});
});
test('media owner sandbox/identity and model RPC boundary do not expose approval resolution',async()=>{
 assert.equal(mediaFrame(1,2,'jarvis://app/voice.html',true,false),false);
 assert.equal(mediaFrame(1,1,'jarvis://app/',true,false),false);
 const rpc=new VoiceRpc({connected:true,request:async()=>{throw new Error('must not dispatch');}});rpc.begin('agent:main:test');
 await assert.rejects(rpc.request('approval.resolve',{id:'native_one',decision:'allow-once'}),/kapsamı dışında/);
});
