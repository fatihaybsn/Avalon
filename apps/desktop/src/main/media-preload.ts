import {contextBridge,ipcRenderer} from 'electron';
import type {MediaBridge,VoiceMediaCommand,VoiceState} from '../shared/voice.ts';
const bridge:MediaBridge=Object.freeze({
  request:(method:string,params:Record<string,unknown>)=>ipcRenderer.invoke('jarvis:voice-rpc',method,params),
  report:(state:Partial<VoiceState>)=>ipcRenderer.send('jarvis:voice-state',state),
  ready:()=>ipcRenderer.send('jarvis:voice-ready'),
  stopped:()=>ipcRenderer.send('jarvis:voice-stopped'),
  decision:(event:Parameters<MediaBridge['decision']>[0])=>ipcRenderer.send('jarvis:voice-decision',event),
  command:(listener:(c:VoiceMediaCommand)=>void)=>{const h=(_:unknown,c:VoiceMediaCommand)=>listener(c);ipcRenderer.on('jarvis:voice-command',h);return()=>ipcRenderer.removeListener('jarvis:voice-command',h);},
  event:(listener:(e:{event:string;payload:any})=>void)=>{const h=(_:unknown,e:{event:string;payload:any})=>listener(e);ipcRenderer.on('jarvis:voice-event',h);return()=>ipcRenderer.removeListener('jarvis:voice-event',h);}
});
contextBridge.exposeInMainWorld('jarvisMedia',bridge);
