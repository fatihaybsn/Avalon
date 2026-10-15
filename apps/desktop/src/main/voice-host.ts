import {BrowserWindow,globalShortcut,ipcMain,desktopCapturer,shell} from 'electron';
import fs from 'node:fs/promises';
import path from 'node:path';
import type {Rpc} from './gateway.ts';
import {mediaFrame,VoiceRpc} from './voice-policy.ts';
import {VoiceDecisions} from './voice-decisions.ts';
import type {VoiceState,VoiceCommand,VoiceMediaCommand} from '../shared/voice.ts';
export class VoiceHost {
  readonly state:VoiceState={phase:'idle',detail:'Görüşme kapalı',muted:false,inputId:'',outputId:'',inputs:[],outputs:[],shortcut:'Control+Alt+Space',shortcutRegistered:false,idleMinutes:0};
  window?:BrowserWindow;
  readonly policy:VoiceRpc;
  readonly decisions:VoiceDecisions;
  ready=false;
  private lastActivity=Date.now();
  private activeSpeech=false;
  private timer?:ReturnType<typeof setInterval>;
  private pending=false;
  private stopped?:()=>void;
  constructor(private rpc:Rpc,private dev:boolean,private dir:string,private settingsFile:string,private selected:()=>string|undefined,private waitingDecision:()=>boolean,private publish:()=>void,projectRoot?:()=>string|undefined){
    this.policy=new VoiceRpc(rpc,target=>this.capture(target),async url=>{const u=new URL(url);if(u.protocol!=='https:'||u.username||u.password)throw new Error('Host link hedefi reddedildi');await shell.openExternal(u.href);},projectRoot);
    this.decisions=new VoiceDecisions(rpc,()=>({allowed:this.policy.allowed&&this.state.voiceSessionId===this.policy.voiceId&&['listening','thinking'].includes(this.state.phase),voiceId:this.policy.voiceId,key:this.policy.key,muted:this.state.muted}),
      (token,text)=>this.send({type:'question',token,text}),text=>{this.state.detail=text;this.context(text);this.publish();});
  }
  private async capture(target:string){
    if(!this.policy.allowed)throw new Error('Görüşme kapalı');
    const windowTarget=/pencere\s*:\s*(.+)/i.exec(target)?.[1]?.trim();
    const types:Array<'screen'|'window'>=[windowTarget?'window':'screen'];
    const list=await desktopCapturer.getSources({types,thumbnailSize:{width:0,height:0},fetchWindowIcons:false});
    const selected=windowTarget?list.filter(s=>s.name.toLocaleLowerCase('tr')===windowTarget.toLocaleLowerCase('tr')):list;
    if(selected.length!==1)throw new Error('Hedef belirsiz; tek ekran veya pencere: tam pencere adı belirtin');
    if(!this.policy.allowed)throw new Error('Görüşme kapandı');
    const frame=(await desktopCapturer.getSources({types,thumbnailSize:{width:1440,height:900},fetchWindowIcons:false})).find(s=>s.id===selected[0].id&&s.name===selected[0].name);
    if(!this.policy.allowed||!frame||frame.thumbnail.isEmpty())throw new Error('Kare alınamadı veya hedef/görüşme değişti');
    const data=frame.thumbnail.toJPEG(75).toString('base64');if(data.length>1000000)throw new Error('Kare boyutu sınırı');return {data};
  }
  context(text:string){if(this.ready&&this.policy.allowed&&text.length<=12000)this.send({type:'context',text});}
  get permitted(){return this.policy.allowed;}
  get canAnnounce(){return this.policy.allowed&&!this.state.muted&&!this.activeSpeech&&!this.decisions.active&&this.state.phase==='listening';}
  trusted(event:Electron.IpcMainEvent|Electron.IpcMainInvokeEvent){return mediaFrame(event.sender.id,this.window?.webContents.id,event.senderFrame?.url??'',event.senderFrame===this.window?.webContents.mainFrame,this.dev);}
  async initialize(){
    try {const p=JSON.parse(await fs.readFile(this.settingsFile,'utf8'));if(typeof p.shortcut==='string'&&p.shortcut.length<100)this.state.shortcut=p.shortcut;if(Number.isFinite(p.idleMinutes)&&p.idleMinutes>=0&&p.idleMinutes<=240)this.state.idleMinutes=p.idleMinutes;}catch{}
    ipcMain.on('jarvis:voice-ready',event=>{if(this.trusted(event)){this.ready=true;this.publish();}});
    ipcMain.on('jarvis:voice-decision',(event,p)=>{
      if(!this.trusted(event)||!p||typeof p.token!=='string'||p.token.length>128||!this.policy.allowed||this.state.muted)return;
      try{if(p.type==='presented')this.decisions.presented(p.token);
        else if(p.type==='input'&&typeof p.id==='string'&&p.id.length<128)this.decisions.input(p.token,p.id);
        else if(p.type==='final'&&typeof p.id==='string'&&typeof p.text==='string'&&p.text.length<=8000)void this.decisions.final(p.token,p.id,p.text).catch(()=>{this.decisions.clear();});
      }catch{this.decisions.clear();}
    });
    ipcMain.handle('jarvis:voice-rpc',async(event,method,params)=>{if(!this.trusted(event))throw new Error('Media sender rejected');try{return await this.policy.request(method,params);}catch{throw new Error('Talk isteği reddedildi veya Gateway erişilemiyor; ses kapsamı/token/model ayarını kontrol edin');}});
    ipcMain.on('jarvis:voice-state',(event,p)=>{
      if(!this.trusted(event)||!p||typeof p!=='object')return;
      if(['idle','connecting','listening','thinking','error'].includes(p.phase)){this.state.phase=p.phase;if(['idle','error'].includes(p.phase)){this.policy.revoke();this.state.turnId=undefined;this.state.voiceSessionId=undefined;}}
      if(typeof p.detail==='string')this.state.detail=p.detail.replace(/auth_tokens\/[^\s]+|AIza[\w-]+|access_token=[^\s&]+/g,'[gizli]').slice(0,240);
      if(typeof p.muted==='boolean')this.state.muted=p.muted;
      if(typeof p.activeSpeech==='boolean'){this.activeSpeech=p.activeSpeech;if(p.activeSpeech)this.lastActivity=Date.now();}
      if(typeof p.turnId==='string'&&p.turnId.length<=1024)this.state.turnId=p.turnId;
      if(typeof p.voiceSessionId==='string'&&p.voiceSessionId===this.policy.voiceId)this.state.voiceSessionId=p.voiceSessionId;
      for(const k of ['inputId','outputId'] as const)if(typeof p[k]==='string'&&p[k].length<=512)this.state[k]=p[k];
      for(const k of ['inputs','outputs'] as const)if(Array.isArray(p[k]))this.state[k]=p[k].slice(0,64).filter((d:any)=>typeof d.id==='string'&&typeof d.label==='string').map((d:any)=>({id:d.id.slice(0,512),label:d.label.slice(0,160)}));
      this.publish();
    });
    ipcMain.on('jarvis:voice-stopped',event=>{if(this.trusted(event))this.stopped?.();});
    this.window=new BrowserWindow({show:false,width:320,height:160,webPreferences:{preload:path.join(this.dir,'media-preload.cjs'),contextIsolation:true,sandbox:true,nodeIntegration:false,webviewTag:false,webSecurity:true,backgroundThrottling:false,autoplayPolicy:'no-user-gesture-required',partition:'jarvis-desktop'}});
    const wc=this.window.webContents;
    wc.setWindowOpenHandler(()=>({action:'deny'}));
    wc.on('will-navigate',e=>e.preventDefault());
    wc.on('will-frame-navigate',e=>e.preventDefault());
    wc.on('will-redirect',e=>e.preventDefault());
    wc.on('will-attach-webview',e=>e.preventDefault());
    wc.on('render-process-gone',()=>{this.policy.revoke();this.ready=false;this.state.phase='error';this.state.detail='Ses bileşeni kapandı; görüşme kendiliğinden yeniden açılmaz';this.publish();});
    await this.window.loadURL(this.dev?'http://127.0.0.1:5173/voice.html':'jarvis://app/voice.html');
    this.registerShortcut(this.state.shortcut);
    this.timer=setInterval(()=>{
      if(this.ready)void this.decisions.refresh();
      if(!this.state.idleMinutes||!this.policy.allowed||this.state.phase==='connecting'||this.state.phase==='thinking'||this.waitingDecision()||this.decisions.active||this.activeSpeech)return;
      if(Date.now()-this.lastActivity>=this.state.idleMinutes*60000)void this.action('end','');
    },1000);
  }
  private send(c:VoiceMediaCommand){if(!this.ready||!this.window||this.window.isDestroyed())throw new Error('Ses bileşeni hazır değil');this.window.webContents.send('jarvis:voice-command',c);}
  private registerShortcut(value:string){
    if(this.state.shortcutRegistered)globalShortcut.unregister(this.state.shortcut);
    this.state.shortcut=value;this.state.shortcutRegistered=false;
    try{this.state.shortcutRegistered=globalShortcut.register(value,()=>{void this.action(this.policy.allowed?'end':'start','').catch(()=>{this.state.detail='Kısayol görüşmeyi başlatamadı; bağlantıyı kontrol edin';this.publish();});});}catch{}
    if(!this.state.shortcutRegistered)this.state.detail='Kısayol kaydedilemedi veya başka uygulamayla çakışıyor';this.publish();
  }
  async action(command:VoiceCommand,value:string){
    if(command==='shortcut'){this.registerShortcut(value);await this.save();return;}
    if(command==='idle'){const n=Number(value);if(!Number.isInteger(n)||n<0||n>240)throw new Error('Süre 0–240 arasında tam dakika olmalı');this.state.idleMinutes=n;await this.save();this.publish();return;}
    if(command==='start'){
      if(this.pending||this.policy.allowed)throw new Error('Görüşme zaten açık');
      const key=this.selected();if(!key||!this.rpc.connected)throw new Error('Bağlı sohbet seçin');
      this.pending=true;try{this.policy.begin(key);this.state.sessionKey=key;this.state.phase='connecting';this.state.detail='Görüşme hazırlanıyor';this.state.turnId=undefined;this.state.voiceSessionId=undefined;this.lastActivity=Date.now();this.send({type:'start',sessionKey:key});this.publish();}catch(e){this.policy.revoke();throw e;}finally{this.pending=false;}return;
    }
    if(command==='end'){this.policy.revoke();this.send({type:'end'});return;}
    if(command==='mute'){this.send({type:'mute',value:!this.state.muted});return;}
    if(command==='stopOutput'){if(this.state.turnId)this.send({type:'stopOutput',turnId:this.state.turnId});return;}
    if(command==='input'||command==='output'){this.send({type:command,value});return;}
    if(command==='devices')this.send({type:'devices'});
  }
  private save(){return fs.writeFile(this.settingsFile,JSON.stringify({shortcut:this.state.shortcut,idleMinutes:this.state.idleMinutes}));}
  event(event:string,payload:any){
    if(event==='desktop.disconnected'){this.policy.revoke();if(this.ready)this.send({type:'end'});return;}
    // Remote Talk/mode/transcript/chat events NEVER start, unmute or play local media.
    if(this.ready&&this.policy.allowed&&event==='chat')this.window?.webContents.send('jarvis:voice-event',{event,payload});
  }
  async shutdown(){
    this.policy.revoke();if(this.timer)clearInterval(this.timer);if(this.state.shortcutRegistered)globalShortcut.unregister(this.state.shortcut);
    if(this.ready&&this.window&&!this.window.isDestroyed())await new Promise<void>(resolve=>{const timer=setTimeout(resolve,2500);this.stopped=()=>{clearTimeout(timer);resolve();};this.send({type:'shutdown'});});
    this.window?.destroy();this.state.phase='idle';this.ready=false;
  }
}
