import test from 'node:test';
import assert from 'node:assert/strict';
import {audioPermission,mediaFrame,voiceNetwork,VoiceRpc,GOOGLE_VOICE_SOCKET} from '../src/main/voice-policy.ts';
import {RealtimeTalkSession,createTalkSessionController} from '../vendor/talk/runtime.js';
const key='agent:main:jarvis:project:voice';
const socket=`wss://generativelanguage.googleapis.com${GOOGLE_VOICE_SOCKET}`;
const session=()=>({provider:'google',transport:'provider-websocket',protocol:'google-live-bidi',model:'gemini-3.8-live',voiceSessionId:'voice-one',clientSecret:'auth_tokens/test-only',websocketUrl:socket,expiresAt:Date.now()+60000,audio:{inputSampleRateHz:16000,outputSampleRateHz:24000},initialMessage:{setup:{model:'models/gemini-3.8-live'}}});
const create={sessionKey:key,provider:'google',model:'gemini-3.8-live',transport:'provider-websocket',capabilities:['voice-transcript','voice-selection']};
class Rpc {
  connected=true;calls=[];allocate=async()=>session();
  async request(method,params){this.calls.push({method,params});if(method==='talk.client.create')return this.allocate();if(method==='talk.client.toolCall')return{runId:'voice-run',agentId:'main',agentSessionKey:key};return{ok:true};}
}
test('only the authorized local media top-frame receives audio permission; text/phone/reload has no grant',()=>{
  assert.equal(audioPermission('media',true,5,5,'jarvis://app/voice.html',true,false,['audio']),true);
  for(const [active,sender,url,top,types] of [[false,5,'jarvis://app/voice.html',true,['audio']],[true,6,'jarvis://app/voice.html',true,['audio']],[true,5,'jarvis://app/',true,['audio']],[true,5,'https://phone.example/voice.html',true,['audio']],[true,5,'jarvis://app/voice.html',false,['audio']],[true,5,'jarvis://app/voice.html',true,['video']],[true,5,'jarvis://app/voice.html',true,['audio','video']]])assert.equal(audioPermission('media',active,sender,5,url,top,false,types),false);
  assert.equal(audioPermission('display-capture',true,5,5,'jarvis://app/voice.html',true,false,['audio']),false);
  assert.equal(mediaFrame(5,5,'http://127.0.0.1:5173/voice.html',true,true),true);
  assert.equal(mediaFrame(5,5,'jarvis://app/voice.html?remote=start',true,false),false);
  assert.equal(voiceNetwork(socket),true);
  for(const u of [socket.replace('wss:','https:'),socket.replace('googleapis.com','googleapis.com.evil'),socket+'?key=raw',socket.replace(GOOGLE_VOICE_SOCKET,'/anything')])assert.equal(voiceNetwork(u),false);
});
test('voice RPC pins standard 3.8 and single provider, rejects remote start and raw keys',async()=>{
  const rpc=new Rpc(),host=new VoiceRpc(rpc);
  await assert.rejects(host.request('talk.client.create',create));assert.equal(rpc.calls.length,0);
  host.begin(key);
  await assert.rejects(host.request('talk.client.create',{...create,model:'gemini-3.1-live'}));
  await assert.rejects(host.request('talk.client.create',{...create,reasoningEffort:'extended'}));
  const result=await host.request('talk.client.create',create);assert.equal(result.voiceSessionId,'voice-one');
  assert.deepEqual(rpc.calls[0].params,{sessionKey:key,provider:'google',model:'gemini-3.8-live',mode:'realtime',transport:'provider-websocket',brain:'agent-consult',capabilities:['voice-transcript']});
  await assert.rejects(host.request('talk.client.create',create));
  const rpc2=new Rpc(),host2=new VoiceRpc(rpc2);rpc2.allocate=async()=>({...session(),clientSecret:'AIza_TEST_RAW_KEY'});host2.begin(key);
  await assert.rejects(host2.request('talk.client.create',create));assert.equal(rpc2.calls.at(-1).method,'talk.client.close');
});
test('cancel during provider allocation closes the late call and cannot adopt it',async()=>{
  const rpc=new Rpc(),host=new VoiceRpc(rpc);let resolve;rpc.allocate=()=>new Promise(r=>resolve=r);host.begin(key);
  const starting=host.request('talk.client.create',create);host.revoke();resolve(session());await assert.rejects(starting);
  assert.equal(host.voiceId,undefined);assert.equal(rpc.calls.at(-1).method,'talk.client.close');
});
test('transcript and cancellation are bound to the owning voice and exact consult run',async()=>{
  const rpc=new Rpc(),host=new VoiceRpc(rpc);host.begin(key);await host.request('talk.client.create',create);
  await assert.rejects(host.request('talk.client.transcript',{sessionKey:key,voiceSessionId:'stale',entryId:'one',role:'user',text:'evet'}));
  await assert.rejects(host.request('chat.abort',{sessionKey:key,agentId:'main',runId:'written-phone-job'}));
  await host.request('talk.client.toolCall',{sessionKey:key,voiceSessionId:'voice-one',callId:'consult',name:'openclaw_agent_consult',args:{task:'test'}});
  host.revoke();await host.request('chat.abort',{sessionKey:key,agentId:'main',runId:'voice-run'});
  await host.request('talk.client.transcript',{sessionKey:key,voiceSessionId:'voice-one',entryId:'one',role:'user',text:'final'});
  assert.equal(rpc.calls.filter(c=>c.method==='chat.abort').length,1);
  assert.equal(rpc.calls.find(c=>c.method==='talk.client.transcript').params.entryId,'one');
  await assert.rejects(host.request('config.patch',{}));
});
test('native controller rejects stale turn cancellation',()=>{
  const c=createTalkSessionController({sessionId:'voice',mode:'realtime',transport:'provider-websocket',brain:'agent-consult',provider:'google'});
  c.startTurn({turnId:'old'});c.startTurn({turnId:'new'});assert.equal(c.cancelTurn({turnId:'old'}).ok,false);assert.equal(c.activeTurnId,'new');
});

const tick=()=>new Promise(resolve=>setTimeout(resolve,0));
function browser(){
  const tracks=[],processors=[],contexts=[],sources=[],sockets=[],constraints=[];
  class Track extends EventTarget {enabled=true;readyState='live';stop(){this.readyState='ended';}}
  const stream=()=>{const track=new Track();tracks.push(track);return{getTracks:()=>[track],getAudioTracks:()=>[track]};};
  class Socket extends EventTarget {
    static OPEN=1;readyState=0;sent=[];
    constructor(url){super();this.url=url;sockets.push(this);queueMicrotask(()=>{this.readyState=1;this.dispatchEvent(new Event('open'));});}
    send(raw){const value=JSON.parse(raw);this.sent.push(value);if(value.setup)queueMicrotask(()=>this.message({setupComplete:{}}));}
    message(value){this.dispatchEvent(new MessageEvent('message',{data:JSON.stringify(value)}));}
    close(){this.readyState=3;this.dispatchEvent(new Event('close'));}
  }
  const node=()=>({connect(){},disconnect(){},gain:{value:1},onaudioprocess:null});
  class Context {
    currentTime=0;destination={};closed=false;
    constructor(p){this.sampleRate=p.sampleRate;contexts.push(this);}
    createMediaStreamSource(){return node();}createScriptProcessor(){const p=node();processors.push(p);return p;}createGain(){return node();}
    createBuffer(_channels,length){return{getChannelData:()=>new Float32Array(length)};}
    createBufferSource(){const s=new EventTarget();s.connect=()=>{};s.start=()=>{};s.stopped=false;s.stop=()=>{s.stopped=true;};sources.push(s);return s;}
    async setSinkId(id){this.sink=id;}async close(){this.closed=true;}
  }
  const old={navigator:Object.getOwnPropertyDescriptor(globalThis,'navigator'),WebSocket:globalThis.WebSocket,AudioContext:globalThis.AudioContext,window:globalThis.window};
  Object.defineProperty(globalThis,'navigator',{configurable:true,value:{mediaDevices:{getUserMedia:async c=>{constraints.push(c);return stream();}}}});
  Object.assign(globalThis,{WebSocket:Socket,AudioContext:Context,window:globalThis});
  return{tracks,processors,contexts,sources,sockets,constraints,restore(){Object.defineProperty(globalThis,'navigator',old.navigator);Object.assign(globalThis,{WebSocket:old.WebSocket,AudioContext:old.AudioContext,window:old.window});}};
}
test('ready Talk media path: no forced consult, actual mute gate, device switch, output stop, final-only writes and cleanup',async()=>{
  const b=browser(),rpc=new Rpc(),host=new VoiceRpc(rpc);host.begin(key);
  const events=[],client={request:(m,p)=>host.request(m,p),addEventListener:()=>()=>{}};
  const call=new RealtimeTalkSession(client,key,{onTalkEvent:e=>events.push(e)},{provider:'google',model:'gemini-3.8-live',transport:'provider-websocket'},{});
  try {
    await call.start();const ws=b.sockets[0];assert.equal(b.constraints[0].audio.echoCancellation,true);
    const samples={inputBuffer:{getChannelData:()=>new Float32Array([0.25,-0.25])}};
    b.processors.at(-1).onaudioprocess(samples);const sent=ws.sent.length;
    call.setMuted(true);assert.equal(b.tracks[0].enabled,false);assert.equal(b.processors.at(-1).onaudioprocess,null);assert.equal(ws.sent.length,sent+1);assert.deepEqual(ws.sent.at(-1),{realtimeInput:{audioStreamEnd:true}});
    call.setMuted(false);assert.equal(b.tracks[0].enabled,true);b.processors.at(-1).onaudioprocess(samples);
    await call.switchInput('chosen-mic');assert.equal(b.tracks[0].readyState,'ended');assert.deepEqual(b.constraints.at(-1).audio.deviceId,{exact:'chosen-mic'});
    await call.setSink('chosen-speaker');assert.equal(b.contexts[1].sink,'chosen-speaker');
    ws.message({serverContent:{inputTranscription:{text:'mer',finished:false}}});await tick();assert.equal(rpc.calls.some(c=>c.method==='talk.client.transcript'),false);
    ws.message({serverContent:{inputTranscription:{text:'haba',finished:true},modelTurn:{parts:[{inlineData:{data:'AAAAAA==',mimeType:'audio/pcm;rate=24000'}}]}}});await tick();
    const turn=events.find(e=>e.type==='output.audio.delta').turnId;
    assert.equal(call.cancelOutput('wrong-turn'),false);assert.equal(b.sources[0].stopped,false);
    assert.equal(call.cancelOutput(turn),true);assert.equal(b.sources[0].stopped,true);
    ws.message({serverContent:{modelTurn:{parts:[{inlineData:{data:'AAAAAA=='}}]},outputTranscription:{text:'selam',finished:true},turnComplete:true}});await tick();
    assert.equal(b.sources.length,1);assert.equal(rpc.calls.filter(c=>c.method==='talk.client.toolCall').length,0);
    await call.stop();assert.equal(b.tracks.every(t=>t.readyState==='ended'),true);assert.equal(b.contexts.every(c=>c.closed),true);assert.equal(ws.readyState,3);
    const writes=rpc.calls.filter(c=>c.method==='talk.client.transcript');assert.equal(writes.length,2);assert.equal(writes[0].params.text,'merhaba');assert.equal(new Set(writes.map(w=>w.params.entryId)).size,2);assert.equal(rpc.calls.at(-1).method,'talk.client.close');
    const count=rpc.calls.length;ws.message({serverContent:{inputTranscription:{text:'stale',finished:true}}});await tick();assert.equal(rpc.calls.length,count);
  } finally {await call.stop();b.restore();}
});
test('closing native Talk may abort only its accepted consult, never an unrelated written job',async()=>{
  const b=browser(),rpc=new Rpc(),host=new VoiceRpc(rpc);host.begin(key);
  const call=new RealtimeTalkSession({request:(m,p)=>host.request(m,p),addEventListener:()=>()=>{}},key,{},create,{});
  try {
    await call.start();b.sockets[0].message({toolCall:{functionCalls:[{id:'consult',name:'openclaw_agent_consult',args:{task:'test'}}]}});await tick();await tick();
    host.revoke();await call.stop();await tick();
    assert.deepEqual(rpc.calls.filter(c=>c.method==='chat.abort').map(c=>c.params.runId),['voice-run']);
  } finally{await call.stop();b.restore();}
});
