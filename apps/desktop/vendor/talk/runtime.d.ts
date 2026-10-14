export type TalkEvent = {type:string;sessionId:string;turnId?:string;payload:unknown;final?:boolean};
export interface TalkController {
  readonly activeTurnId?:string; readonly outputAudioActive:boolean;
  startTurn(p?:{turnId?:string}):{turnId:string};
  startOutputAudio(p?:{turnId?:string}):{turnId:string};
  finishOutputAudio(p?:{turnId?:string}):unknown;
  endTurn(p?:{turnId?:string}):{ok:boolean};
  cancelTurn(p?:{turnId?:string}):{ok:boolean};
}
export function createTalkSessionController(p:{sessionId:string;mode:string;transport:string;brain:string;provider:string}):TalkController;
export class RealtimeTalkSession {
  constructor(client:{request<T=any>(method:string,params:object,options?:unknown):Promise<T>;addEventListener(listener:(e:{event:string;payload:any})=>void):()=>void},sessionKey:string,callbacks:{onStatus?:(status:'idle'|'connecting'|'listening'|'thinking'|'error',detail?:string)=>void;onInputLevel?:(level:number)=>void;onTalkEvent?:(event:TalkEvent)=>void},options:{provider:string;model:string;transport:string},local:{inputDeviceId?:string});
  start():Promise<void>; stop():Promise<void>; getVoiceSessionId():string|undefined;
  updateContext(text:string):void;
  presentQuestion(text:string):void;
  isOutputPlaying():boolean;
  setMuted(value:boolean):void; setSink(id:string):Promise<void>|undefined;
  switchInput(id:string):Promise<void>|undefined; cancelOutput(turnId:string):boolean;
}
