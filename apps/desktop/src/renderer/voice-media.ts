import {RealtimeTalkSession,createTalkSessionController,type TalkEvent,type TalkController} from '../../vendor/talk/runtime.js';
import type {MediaBridge,VoiceMediaCommand} from '../shared/voice.ts';
declare global {interface Window {jarvisMedia:MediaBridge}}
const bridge=window.jarvisMedia;
let call:RealtimeTalkSession|undefined, turns:TalkController|undefined;
let generation=0, muted=false, inputId='',outputId='', outputTurn:string|undefined;
let inputActive=false;
const listeners=new Set<(e:{event:string;payload:any})=>void>();
const client={request:<T=any>(method:string,params:object)=>bridge.request(method,params as Record<string,unknown>) as Promise<T>,addEventListener:(l:(e:{event:string;payload:any})=>void)=>{listeners.add(l);return()=>{listeners.delete(l);};}};
bridge.event(e=>{for(const l of listeners)l(e);});
async function devices(){
  const list=await navigator.mediaDevices.enumerateDevices();
  bridge.report({inputs:list.filter(d=>d.kind==='audioinput').map(d=>({id:d.deviceId,label:d.label||'Mikrofon'})),outputs:list.filter(d=>d.kind==='audiooutput').map(d=>({id:d.deviceId,label:d.label||'Hoparlör'}))});
}
navigator.mediaDevices.addEventListener('devicechange',()=>{void devices().catch(()=>bridge.report({detail:'Ses cihazları okunamadı'}));});
function talkEvent(event:TalkEvent,epoch:number){
  if(epoch!==generation)return;
  if(event.type==='output.audio.delta'&&event.turnId){
    if(turns?.activeTurnId!==event.turnId)turns?.startTurn({turnId:event.turnId});
    turns?.startOutputAudio({turnId:event.turnId});outputTurn=event.turnId;
    bridge.report({turnId:event.turnId});
  }
  if((event.type==='turn.ended'||event.type==='turn.cancelled')&&event.turnId){
    turns?.finishOutputAudio({turnId:event.turnId});
    if(event.type==='turn.cancelled')turns?.cancelTurn({turnId:event.turnId});else turns?.endTurn({turnId:event.turnId});
    // Queued PCM may outlive provider generation; retain the output id for stop playback.
  }
  if(event.type==='session.closed')bridge.report({phase:'idle',activeSpeech:false});
}
async function end(){
  ++generation;const old=call;call=undefined;turns=undefined;outputTurn=undefined;
  inputActive=false;
  // Upstream stop releases tracks, pumps, AudioContexts, sources and provider socket
  // synchronously, then drains finalized transcript writes before logical close.
  try {await old?.stop();} finally {bridge.report({phase:'idle',detail:'Görüşme kapalı',muted:false,activeSpeech:false,turnId:undefined});}
}
async function command(c:VoiceMediaCommand){
  if(c.type==='context'){call?.updateContext(c.text);return;}
  if(c.type==='shutdown'){try{await end();}finally{bridge.stopped();}return;}
  if(c.type==='end'){await end();return;}
  if(c.type==='devices'){await devices();return;}
  if(c.type==='start'){
    if(call)throw new Error('Görüşme zaten açık');
    const epoch=++generation;muted=false;outputTurn=undefined;
    turns=createTalkSessionController({sessionId:`local-${epoch}`,provider:'google',mode:'realtime',transport:'provider-websocket',brain:'agent-consult'});
    const active=new RealtimeTalkSession(client,c.sessionKey,{
      onStatus:(phase,detail)=>{if(epoch===generation){bridge.report({phase,detail:detail??(phase==='listening'?'Dinleniyor':phase==='thinking'?'Yanıt hazırlanıyor':phase==='idle'?'Görüşme kapalı':'Bağlanıyor')});if(phase==='error')void end().finally(()=>bridge.report({phase:'error',detail:detail??'Ses bağlantısı kesildi'})).catch(()=>{});}},
      onInputLevel:level=>{if(epoch===generation)inputActive=level>0.025&&!muted;},
      onTalkEvent:event=>talkEvent(event,epoch)
    },{provider:'google',model:'gemini-3.8-live',transport:'provider-websocket'},{inputDeviceId:inputId||undefined});
    call=active;
    try {await active.start();if(epoch!==generation)return;await active.setSink(outputId);bridge.report({voiceSessionId:active.getVoiceSessionId(),muted:false});await devices();}
    catch(error){if(epoch===generation){await end().catch(()=>{});throw error;}return;}
    return;
  }
  if(c.type==='mute'){muted=c.value;if(muted)inputActive=false;call?.setMuted(muted);bridge.report({muted});return;}
  if(c.type==='input'){inputId=c.value;await call?.switchInput(inputId);bridge.report({inputId});await devices();return;}
  if(c.type==='output'){await call?.setSink(c.value);outputId=c.value;bridge.report({outputId});return;}
  if(c.type==='stopOutput'&&c.turnId===outputTurn){call?.cancelOutput(c.turnId);turns?.finishOutputAudio({turnId:c.turnId});bridge.report({activeSpeech:false});}
}
setInterval(()=>{if(call)bridge.report({activeSpeech:inputActive||call.isOutputPlaying()});},500);
bridge.command(c=>{void command(c).catch(async error=>{await end().catch(()=>{});bridge.report({phase:'error',detail:error instanceof Error?error.message:'Ses işlemi başarısız'});});});
bridge.ready();
