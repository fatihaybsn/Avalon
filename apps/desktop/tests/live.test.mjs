import test from 'node:test';
import assert from 'node:assert/strict';
import {VoiceRpc,GOOGLE_VOICE_SOCKET,audioPermission} from '../src/main/voice-policy.ts';
import {WorkUpdates,boundedContext} from '../src/main/work-updates.ts';
import {RealtimeTalkSession} from '../vendor/talk/runtime.js';
const key='agent:main:live';
const allocation=()=>({provider:'google',transport:'provider-websocket',protocol:'google-live-bidi',model:'gemini-3.8-live',voiceSessionId:'voice',clientSecret:'auth_tokens/test-only',websocketUrl:`wss://generativelanguage.googleapis.com${GOOGLE_VOICE_SOCKET}`,expiresAt:Date.now()+60000,audio:{inputSampleRateHz:16000,outputSampleRateHz:24000},initialMessage:{setup:{model:'models/gemini-3.8-live'}}});
const create={sessionKey:key,provider:'google',model:'gemini-3.8-live',transport:'provider-websocket'};
test('media boundary accepts only named tools and captures one authorized frame; remote/unknown tools cannot capture',async()=>{
  let frames=0;const methods=[];
  const rpc={connected:true,async request(method,p){methods.push(method);if(method==='talk.client.create')return allocation();if(method==='jarvis.work.status')return{records:[]};if(p.name==='jarvis_screen')return{singleFrameRequest:true,userTarget:'ekrana bak'};return{ok:true};}};
  const host=new VoiceRpc(rpc,async target=>{assert.equal(target,'ekrana bak');frames++;return{data:'JPEG-fixture'};});host.begin(key);await host.request('talk.client.create',create);
  const p={sessionKey:key,voiceSessionId:'voice',callId:'one',name:'jarvis_screen',args:{}};
  await assert.rejects(host.request('talk.client.toolCall',{...p,voiceSessionId:'other'}));await assert.rejects(host.request('talk.client.toolCall',{...p,name:'tools.invoke'}));
  const result=await host.request('talk.client.toolCall',p);assert.equal(result.image.data,'JPEG-fixture');assert.equal(frames,1);
  host.revoke();await assert.rejects(host.request('talk.client.toolCall',{...p,callId:'two'}));assert.equal(frames,1);
  assert.equal(audioPermission('media',false,1,1,'jarvis://app/voice.html',true,false,['audio']),false);
});
test('meaningful host changes preserve source/count and steering stage; technical repetition stays quiet and unread survives denied notification',()=>{
  const updates=new WorkUpdates();const r={taskId:'t',projectId:key,sessionKey:key,revision:1,state:'running',result:'unverified',model:{finding:'12 kaynak; 2 sorun',sources:['https://example.com/original']},steering:{}};
  updates.update([r],key);assert.equal(updates.update([{...r,recordVersion:22}],key).context.length,0);
  const changed=updates.update([{...r,revision:2,steering:{input:{revision:2,stage:'accepted',text:'new condition'}}}],key);assert.equal(changed.context[0].steering.input.stage,'accepted');assert.equal(changed.context[0].finding,'12 kaynak; 2 sorun');
  assert.equal(JSON.parse(boundedContext(changed.context)).records[0].model.finding,'12 kaynak; 2 sorun');
  const done=updates.update([{...r,state:'ended',result:'native-final'}]);assert.equal(done.completed.length,1);assert.equal(updates.unread.has('t'),true);assert.equal(updates.update([{...r,state:'ended',result:'native-final'}]).completed.length,0);updates.read('t');assert.equal(updates.unread.size,0);
  const large=JSON.parse(boundedContext([{...r,model:{finding:'a'.repeat(16000),sources:r.model.sources}}]));assert.equal(large.records[0].detailsOmitted,true);assert.equal(large.records[0].readOriginal,'jarvis_output');
});
const tick=()=>new Promise(r=>setTimeout(r,0));
function browser(){
  const sockets=[];
  class Track extends EventTarget {enabled=true;stop(){}}
  const stream=()=>{const t=new Track();return{getTracks:()=>[t],getAudioTracks:()=>[t]};};
  const node=()=>({connect(){},disconnect(){},gain:{value:1},onaudioprocess:null});
  class Context{currentTime=0;destination={};constructor(p){this.sampleRate=p.sampleRate;}createMediaStreamSource(){return node();}createScriptProcessor(){return node();}createGain(){return node();}async close(){} }
  class Socket extends EventTarget{static OPEN=1;readyState=0;sent=[];constructor(){super();sockets.push(this);queueMicrotask(()=>{this.readyState=1;this.dispatchEvent(new Event('open'));});}send(s){const v=JSON.parse(s);this.sent.push(v);if(v.setup)queueMicrotask(()=>this.message({setupComplete:{}}));}message(v){this.dispatchEvent(new MessageEvent('message',{data:JSON.stringify(v)}));}close(){this.readyState=3;this.dispatchEvent(new Event('close'));}}
  const prior={navigator:Object.getOwnPropertyDescriptor(globalThis,'navigator'),WebSocket:globalThis.WebSocket,AudioContext:globalThis.AudioContext,window:globalThis.window};
  Object.defineProperty(globalThis,'navigator',{configurable:true,value:{mediaDevices:{getUserMedia:async()=>stream()}}});Object.assign(globalThis,{WebSocket:Socket,AudioContext:Context,window:globalThis});
  return{sockets,restore(){Object.defineProperty(globalThis,'navigator',prior.navigator);Object.assign(globalThis,{WebSocket:prior.WebSocket,AudioContext:prior.AudioContext,window:prior.window});}};
}
test('actual pinned Talk sends custom result/image once, cancels pending call, and uses current client content after a consult closes',async()=>{
  const b=browser(),listeners=new Set(),requests=[];let release,consultRun;
  const client={addEventListener(fn){listeners.add(fn);return()=>listeners.delete(fn);},async request(method,p){requests.push({method,p});if(method==='talk.client.create')return allocation();if(method==='talk.client.toolCall'){
    if(p.name==='jarvis_screen')return{image:{data:'JPEG-fixture'}};
    if(p.name==='jarvis_research')return new Promise(r=>release=r);
    if(p.name==='openclaw_agent_consult'){consultRun='run';return{runId:'run',agentId:'main',agentSessionKey:key};}
    return{records:[]};
  }return{ok:true};}};
  const call=new RealtimeTalkSession(client,key,{}, {provider:'google',model:'gemini-3.8-live',transport:'provider-websocket'},{});
  try{await call.start();const ws=b.sockets[0];
    ws.message({toolCall:{functionCalls:[{id:'frame',name:'jarvis_screen',args:{}}]}});await tick();await tick();assert.equal(ws.sent.filter(v=>v.realtimeInput?.video).length,1);assert.equal(ws.sent.find(v=>v.toolResponse?.functionResponses[0].id==='frame').toolResponse.functionResponses[0].response.imageSent,true);
    ws.message({toolCall:{functionCalls:[{id:'frame',name:'jarvis_screen',args:{}}]}});await tick();assert.equal(ws.sent.filter(v=>v.realtimeInput?.video).length,1);
    ws.message({toolCall:{functionCalls:[{id:'reader',name:'jarvis_research',args:{query:'public'}}]}});await tick();ws.message({toolCallCancellation:{ids:['reader']}});await tick();assert.equal(requests.some(r=>r.method==='jarvis.live.cancelCall'&&r.p.callId==='reader'),true);release({data:'late'});await tick();assert.equal(ws.sent.some(v=>v.toolResponse?.functionResponses[0].id==='reader'),false);
    ws.message({toolCall:{functionCalls:[{id:'consult',name:'openclaw_agent_consult',args:{task:'test'}}]}});await tick();assert.equal(consultRun,'run');call.updateContext('Ara bulgu: 12 kaynak');const interim=ws.sent.at(-1).toolResponse.functionResponses[0];assert.equal(interim.id,'consult');assert.equal(interim.willContinue,true);
    for(const listener of listeners)listener({event:'chat',payload:{runId:'run',state:'final',message:{content:[{type:'text',text:'Asıl çıktı: 12 kaynak.'}]}}});await tick();call.updateContext('Güncel tamamlanmış kayıt: 12 kaynak');assert.equal(ws.sent.at(-1).clientContent.turnComplete,false);assert.equal(ws.sent.at(-1).toolResponse,undefined);
  }finally{await call.stop();b.restore();}
});
