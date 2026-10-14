export type VoiceState = {
  phase: 'idle' | 'connecting' | 'listening' | 'thinking' | 'error'; detail: string;
  muted: boolean; sessionKey?: string; voiceSessionId?: string; turnId?: string;
  inputId: string; outputId: string; inputs: {id:string;label:string}[]; outputs: {id:string;label:string}[];
  shortcut: string; shortcutRegistered: boolean; idleMinutes: number;
};
export type VoiceCommand = 'start' | 'end' | 'mute' | 'stopOutput' | 'input' | 'output' | 'shortcut' | 'idle' | 'devices';
export type VoiceMediaCommand = {type:'start'; sessionKey:string} | {type:'context';text:string} | {type:'end'|'shutdown'|'devices'} | {type:'mute';value:boolean} | {type:'input'|'output';value:string} | {type:'stopOutput';turnId:string};
export interface MediaBridge {
  request(method:string,params:Record<string,unknown>):Promise<any>;
  report(state:Partial<VoiceState> & {activeSpeech?:boolean}):void;
  ready():void;
  stopped():void;
  command(listener:(command:VoiceMediaCommand)=>void):()=>void;
  event(listener:(event:{event:string;payload:any})=>void):()=>void;
}
