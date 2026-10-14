import type {OpenClawPluginApi} from 'openclaw/plugin-sdk/plugin-entry';
import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {dispatchGatewayMethod} from 'openclaw/plugin-sdk/gateway-method-runtime';
import {exactKeys,text,fingerprint,safePath,within,type Scope} from './policy.ts';
import type {WorkLedger} from './work.ts';
type Binding={scope:Scope;assertCurrent:()=>void};
export async function resolveRecipient(rpc:(m:string,p:Record<string,unknown>)=>Promise<any>,query:string,ref?:string){
 const rows=(await rpc('conversations.list',{agentId:'main',query,limit:100})).conversations??[];
 if(!rows.length)return {ready:false,reason:'Bağlı hesap veya alıcı bulunamadı; kanal/hesap bağlantısı ve kesin alıcı gerekli',candidates:[]};
 // A model choosing one of two identically named people is not user selection.
 if(rows.length!==1)return {ready:false,reason:'Alıcı/hesap belirsiz; kullanıcıya hesap ve tam alıcı adresini sesle sorun',candidates:rows};
 const r=rows[0];if(ref&&ref!==r.conversationRef)throw new Error('Recipient changed; resolve again');
 const accounts=(await rpc('channels.status',{probe:false,channel:r.channel})).channelAccounts?.[r.channel]??[];
 const account=accounts.find((a:any)=>a.accountId===r.accountId&&a.enabled!==false&&a.configured===true&&(a.connected===true||a.linked===true));
 if(!account)return {ready:false,reason:'Gerçek gönderen hesap bağlantısı doğrulanamadı; kullanıcı bağlantısı gerekli',candidates:rows};
 return {ready:true,recipient:r,sender:{channel:r.channel,accountId:r.accountId,name:account.name??r.accountId}};
}
export function installSending(api:OpenClawPluginApi,scopeFor:(ctx:any)=>Binding,ledger:WorkLedger,authorize:(id:string,tool:string,p:Record<string,unknown>,s:Scope,a:any)=>Promise<any>,dispatch=dispatchGatewayMethod){
 const rpc=async(m:string,p:Record<string,unknown>)=>{const r=await dispatch(m,p,{expectFinal:true,timeoutMs:65000});if(!r.ok)throw new Error(r.error?.message??'Native channel unavailable');return r.payload as any;};
 api.registerTool({contextVersion:2,create(ctx){if(ctx.agentId!=='main')return null;return [{name:'jarvis_send',label:'Tek dış gönderim',description:'Resolve a real native channel account and recipient, then request a separate frozen one-message approval. Ambiguous recipients require the human. At most one immutable local attachment below the current file grant (8 MiB). Payment and automatic replies are unavailable. Never retry an unknown send.',parameters:{type:'object' as const,properties:{action:{type:'string',enum:['resolve','send']},query:{type:'string',maxLength:256},conversationRef:{type:'string',maxLength:256},message:{type:'string',maxLength:8000},attachmentPath:{type:'string',maxLength:1024}},required:['action','query'],additionalProperties:false},async execute(callId:string,p:Record<string,unknown>){
  exactKeys(p,['action','query','conversationRef','message','attachmentPath']);const b=scopeFor(ctx),s=b.scope;ctx.assertInvocationCurrent();b.assertCurrent();
  if(s.role==='research'||!/gönder|ilet|send/iu.test(s.userStatement??''))throw new Error('Actual user send task required; research/findings cannot authorize sending');
  const query=text(p.query,'recipient query',256);
  if(!(s.userStatement??'').toLocaleLowerCase('tr').includes(query.toLocaleLowerCase('tr')))throw new Error('Recipient query must come from the actual user request');
  const resolved=await resolveRecipient(rpc,query,p.conversationRef as string|undefined);b.assertCurrent();ctx.assertInvocationCurrent();
  if(p.action==='resolve'||!resolved.ready)return {content:[{type:'text' as const,text:JSON.stringify(resolved)}],details:resolved};
  if(p.action!=='send')throw new Error('Unsupported send operation');
  const message=text(p.message,'complete message',8000),recipient=resolved.recipient!,sender=resolved.sender!;
  let attachment:{path:string;filename:string;size:number;sha256:string}|undefined,bytes:Buffer|undefined;
  if(p.attachmentPath){
    if(!s.root||!/ekle|ekli|dosya|belge|attachment/iu.test(s.userStatement??''))throw new Error('Current file grant and actual user attachment request required');
    const file=await safePath(p.attachmentPath);if(!within(s.root,file))throw new Error('Attachment outside current file grant');
    const stat=await fs.stat(file);if(!stat.isFile()||stat.size>8*1024*1024)throw new Error('Single regular attachment must be at most 8 MiB');
    bytes=await fs.readFile(file);if(bytes.length>8*1024*1024)throw new Error('Attachment changed/too large');
    attachment={path:file,filename:path.basename(file),size:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')};
  }
  const frozen={sender,recipient,message,attachments:attachment?[attachment]:[],operationId:callId};
  const gate=await authorize(callId,'jarvis_send',frozen,s,{title:'JARVIS: tek mesaj gönderimi'});
  if(gate.block)throw new Error(gate.blockReason);b.assertCurrent();ctx.assertInvocationCurrent();
  const current=await resolveRecipient(rpc,query,recipient.conversationRef);b.assertCurrent();ctx.assertInvocationCurrent();
  if(!current.ready||fingerprint({sender:current.sender,recipient:current.recipient})!==fingerprint({sender,recipient}))throw new Error('Sender/recipient changed; new approval required');
  if(attachment){const file=await safePath(attachment.path),stat=await fs.stat(file);if(file!==attachment.path||stat.size!==attachment.size||stat.size>8*1024*1024||createHash('sha256').update(await fs.readFile(file)).digest('hex')!==attachment.sha256)throw new Error('Attachment changed; new approval required');}
  const attempt=await ledger.change(s.userId,s.taskId,'send-attempt:'+callId,'external-send-attempt',{callId,channel:sender.channel,accountId:sender.accountId,target:recipient.target,contentHash:fingerprint(message),attachments:attachment?[attachment]:[]},()=>{},()=>{b.assertCurrent();ctx.assertInvocationCurrent();});
  if(!attempt.changed)throw new Error('This native send was already attempted; no retry');
  b.assertCurrent();ctx.assertInvocationCurrent();ctx.assertInputCommitAllowed?.();
  let result:any;
  try{result=attachment?await rpc('send',{agentId:s.agentId,sessionKey:s.sessionKey,idempotencyKey:callId,channel:sender.channel,accountId:sender.accountId,to:recipient.target,...recipient.threadId?{threadId:recipient.threadId}:{},message,buffer:bytes!.toString('base64'),filename:attachment.filename,contentType:'application/octet-stream',forceDocument:true}):await rpc('conversations.send',{agentId:s.agentId,sourceSessionKey:s.sessionKey,operationId:callId,conversationRef:recipient.conversationRef,message});if(attachment)result={status:'native-accepted',native:result,deliveryConfirmed:false};}
  catch{await ledger.change(s.userId,s.taskId,'send-unknown:'+callId,'external-send-unknown',{callId},r=>{r.state='unknown';r.blocker='Send outcome unknown; no retry';});throw new Error('Gönderim sonucu belirsiz; otomatik tekrar yapılmadı');}
  await ledger.change(s.userId,s.taskId,'send-result:'+callId,'external-send-result',{callId,...result},r=>{r.result=result.status==='sent'?'sent':result.status;r.blocker=result.status==='sent'?undefined:'Native send is not confirmed delivered; do not retry';});
  return {content:[{type:'text' as const,text:JSON.stringify(result)}],details:result};
 }}];}},{names:['jarvis_send']});
}
