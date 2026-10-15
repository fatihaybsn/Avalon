type Client={request(method:string,params:object):Promise<any>};
// Used by both authenticated clients; never called by history/reconnect/notification.
export async function bindChatTask(client:Client,key:string,id:string,message:string,options:{projectId:string;root?:string}){
  const short=message.trim().replace(/\s+/gu,' ');
  const userInput=message.length<=4096&&short.length<=1800&&!/[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(message)?{userInput:message}:{};
  return client.request('jarvis.scope.bind',{sessionKey:key,agentId:'main',runId:id,taskId:id,projectId:options.projectId,...options.root?{role:'project',root:options.root}:{role:'memory'},...userInput});
}
// Only IDs are retained in this tab, never content, credentials or voice grants.
export class InputAttempts {
  private ids:Set<string>;
  constructor(private storage?:Pick<Storage,'getItem'|'setItem'>){const raw=storage?.getItem('jarvis-attempted-inputs');const rows=raw?JSON.parse(raw):[];if(!Array.isArray(rows)||rows.some(v=>typeof v!=='string'))throw new Error('Input receipt metadata invalid; inspect native history');this.ids=new Set(rows);}
  consume(id:string){if(this.ids.has(id)||this.ids.size>=512)throw new Error('Bu giriş daha önce denendi veya giriş makbuzu sınırı dolu. Otomatik gönderilmedi; native kaydı inceleyin ve yeni açık talimat verin.');this.ids.add(id);this.storage?.setItem('jarvis-attempted-inputs',JSON.stringify([...this.ids]));}
}

let browserAttempts:InputAttempts|undefined;
export async function sendBrowserChat(client:Client,params:Record<string,unknown>){
  const key=params.sessionKey,id=params.idempotencyKey,message=params.message;
  if(typeof key!=='string'||!key.startsWith('agent:main:')||typeof id!=='string'||typeof message!=='string'||!message.trim())throw new Error('Current JARVIS conversation, input ID and text required');
  if(params.attachments!==undefined&&(!Array.isArray(params.attachments)||params.attachments.length))throw new Error('Bu telefon aşaması yazılı/sesli talimat içindir; ek/kamera yetkisi açılmadı.');
  browserAttempts??=new InputAttempts(globalThis.sessionStorage);browserAttempts.consume(id);
  const status=await client.request('jarvis.work.status',{sessionKey:key,agentId:'main'});
  const rows=(status.records??[]).filter((r:any)=>r.sessionKey===key&&(!params.sessionId||r.sessionId===params.sessionId));
  if(params.queueMode==='steer'){
    const active=rows.filter((r:any)=>!['ended','failed','cancelled'].includes(r.state));
    if(active.length!==1)throw new Error('Yönlendirilecek görev belirsiz; mevcut görev kaydını seçin.');
    await client.request('jarvis.work.steer',{sessionKey:key,agentId:'main',taskId:active[0].taskId,expectedRevision:active[0].revision,inputId:id,message});return {status:'started',runId:active[0].runId};
  }
  if(params.queueMode==='interrupt'||params.intent)throw new Error('İptal/reset için mevcut native görev/sohbet kontrolünü kullanın; bu giriş tekrar gönderilmedi.');
  const root=/^çalışma klasörü:\s*([^\r\n]+)\r?\n/iu.exec(message)?.[1]?.trim();
  const projectId=rows[0]?.projectId??key;
  const binding=await bindChatTask(client,key,id,message,{projectId,root});
  if(params.sessionId&&binding.sessionId!==params.sessionId)throw new Error('Sohbet incarnation değişti; yeni talimat için güncel kaydı açın.');
  const result=await client.request('jarvis.work.start',{sessionKey:key,agentId:'main',runId:id,message});
  if(!result.record||result.record.runId!==id)throw new Error('Native input receipt unavailable; read history, no replay');
  return {status:'started',runId:id};
}
