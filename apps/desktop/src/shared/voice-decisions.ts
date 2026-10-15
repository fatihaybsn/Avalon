const randomUUID=()=>globalThis.crypto.randomUUID();
interface Rpc {request(method:string,params:object,mutation?:boolean):Promise<any>}
// Exact presentation comparison; authorization remains in the native registry.
export const decisionHash=(v:unknown)=>JSON.stringify(v);
const normalize=(v:string)=>v.toLocaleLowerCase('tr').trim().replace(/[.!?]+$/u,'').replace(/\s+/g,' ');
export function spokenDecision(text:string){const s=normalize(text);return ['evet','onaylıyorum','onayla','izin ver'].includes(s)?'allow-once':['hayır','reddet','reddediyorum','iptal','iptal et','izin verme'].includes(s)?'deny':undefined;}
type Identity={allowed:boolean;voiceId?:string;key?:string;muted:boolean};
type Request=Record<string,any>;
type Active={request:Request;hash:string;token:string;text:string;voice:string;key:string;presented:boolean;input?:string;answers:Record<string,any>;step:number};

export function requestFields(r:Request):Array<{id:string;text:string;options?:Array<{label:string;value:any}>;free?:boolean;type?:string;multi?:boolean;allowEmpty?:boolean}> {
 if(r.family==='question')return (r.raw.questions??[]).map((q:any)=>{
  if(q.isSecret||q.secretStore||q.resource)throw new Error('Bu soru güvenli manuel native formdan yanıtlanmalı');
  return {id:q.questionId,text:q.question,options:q.options.map((v:any)=>({label:v.label,value:v.value??v.label})),free:q.isOther===true,multi:q.multiSelect===true,allowEmpty:q.allowEmpty===true};
 });
 if(r.kind==='form')return (r.raw.fields??[]).map((f:any)=>{
  if(f.hidden||f.when?.length||!['string','boolean','number','integer','multiselect'].includes(f.type))throw new Error('Bu alan native manuel form gerektiriyor');
  const options=f.options?.map((v:any)=>({label:v.label??String(v.value),value:v.value}));
  return {id:f.key,text:[f.title??f.key,f.description].filter(Boolean).join('. '),options,free:!options,type:f.type,multi:f.type==='multiselect',allowEmpty:f.required!==true};
 });
 return [];
}
export function fieldAnswer(field:ReturnType<typeof requestFields>[number],text:string){
 const s=normalize(text),matches=field.options?.filter(v=>normalize(v.label)===s);
 if(matches?.length===1)return {value:matches[0].value};
 // Explicit prefixes prevent a general yes from answering an unrelated form.
 if(!field.free||!/^yanıt(?:\s*:|\s+)/iu.test(text))return undefined;
 const raw=text.replace(/^yanıt(?:\s*:\s*|\s+)/iu,'').trim();if(!raw||raw.length>4096)return undefined;
 if(field.type==='boolean'){const d=spokenDecision(raw);return d?{value:d==='allow-once'}:undefined;}
 if(field.type==='number'||field.type==='integer'){const n=Number(raw.replace(',','.'));return Number.isFinite(n)&&(field.type!=='integer'||Number.isInteger(n))?{value:n}:undefined;}
 return {value:raw};
}

// Ephemeral presentation state, never an alternative approval registry.
export class VoiceDecisions {
 active?:Active; private busy=false;private deciding=false;private attempted=new Set<string>();
 private lastNotice='';
 constructor(private rpc:Rpc,private identity:()=>Identity,private speak:(token:string,text:string)=>void,private publishNotice:(text:string)=>void){}
 private notice(text:string){if(text!==this.lastNotice){this.lastNotice=text;this.publishNotice(text);}}
 clear(){this.active=undefined;}
 private current(a:Active){const i=this.identity();if(!i.allowed||i.muted||i.voiceId!==a.voice||i.key!==a.key||a.request.expiresAtMs<=Date.now())throw new Error('Eski/susturulmuş görüşme veya süresi dolmuş soru');}
 private async list(key:string){
  const base={sessionKey:key,agentId:'main'},rows:Request[]=(await this.rpc.request('jarvis.decisions.pending',base)).requests??[];
  const grants=(await this.rpc.request('jarvis.decisions.grants',base)).grants??[];
  for(const g of grants){if(!g.worker)continue;try{const q=await this.rpc.request('jarvis.worker.requests',{...base,sessionKey:g.sessionKey??key,runId:g.runId});for(const r of q.requests??[])rows.push({...r,sessionKey:g.sessionKey??key,revision:g.revision});}catch{this.notice('İşçinin native soru/kimlik kaydı okunamadı; o işçi için karar gönderilmeyecek.');}}
  return rows.filter(r=>r.status==='pending'&&r.expiresAtMs>Date.now()).sort((a,b)=>(a.createdAtMs??0)-(b.createdAtMs??0)||a.id.localeCompare(b.id));
 }
 async refresh(){
  const i=this.identity();if(!i.allowed||!i.voiceId||!i.key||i.muted){this.clear();return;}
  if(this.busy||this.deciding)return;this.busy=true;
  try{const rows=await this.list(i.key);if(this.identity().voiceId!==i.voiceId||!this.identity().allowed)return;
   if(this.active&&rows.some(r=>r.id===this.active!.request.id&&decisionHash(r)===this.active!.hash))return;
   this.clear();const r=rows.find(r=>!this.attempted.has(decisionHash(r)));if(!r)return;
   const hash=decisionHash(r);this.active={request:structuredClone(r),hash,token:randomUUID(),text:'',voice:i.voiceId,key:i.key,presented:false,answers:{},step:0};this.present();
  }catch{this.clear();this.notice('Onay/soru kaydı okunamadı; karar gönderilmedi.');}finally{this.busy=false;}
 }
 private present(){const a=this.active!;const r=a.request;a.presented=false;a.input=undefined;a.token=randomUUID();
  let detail:string;
  try{const fields=requestFields(r),field=fields[a.step];
   detail=field?`${field.text} ${field.options?.map(v=>v.label).join('; ')??'Yanıt diyerek cevabınızı söyleyin.'}${field.multi?' Seçenekleri tek tek söyleyin, seçiminiz tamamlanınca bitti deyin.':''}`:
    r.family==='opencode'?`${r.raw.action}: ${JSON.stringify(r.raw.resources)} ${r.raw.message??''}. İzin verilsin mi? Reddetme bu işçinin diğer bekleyen izinlerini de reddedebilir.`:
    `${r.presentation?.title??'İşlem'} ${r.params?JSON.stringify(r.params):JSON.stringify(r.presentation)}. ${r.manual?'Olumlu karar için mevcut manuel OpenClaw kontrolünü kullanın. Sesle reddedebilirsiniz.':'Bu tek işleme onay veriyor musunuz?'}`;
  }catch(e){detail=(e as Error).message+'. Sesle iptal edebilirsiniz.';}
  a.text=`Görev ${r.taskId}. Revizyon ${r.revision}. İstek ${r.id}. Geçerlilik ${Math.max(0,Math.ceil((r.expiresAtMs-Date.now())/1000))} saniye. ${detail}`;
  if(a.text.length>11000){a.text=`İstek ${r.id} önizlemesi ses sınırını aşıyor; native manuel kontrolü kullanın. Sesle iptal edebilirsiniz.`;a.request.manual=true;}
  this.speak(a.token,a.text);
 }
 presented(token:string){const a=this.active;if(!a||a.token!==token)return;this.current(a);a.presented=true;a.input=undefined;}
 input(token:string,id:string){const a=this.active;if(!a||a.token!==token||!a.presented)return;this.current(a);a.input=id;}
 async final(token:string,id:string,text:string){
  const a=this.active;if(!a||a.token!==token||!a.presented||a.input!==id||this.deciding)return;
  this.current(a);a.input=undefined;
  const decision=spokenDecision(text),fields=requestFieldsSafe(a.request),field=fields?.[a.step];
  if(a.request.manual&&decision!=='deny'){this.notice('Bu işlemin olumlu kararı manuel kontrolden verilmeli.');return;}
  if(field){const answer=fieldAnswer(field,text),values=a.answers[field.id]??[];
    if(field.multi&&normalize(text)==='bitti'&&(values.length||field.allowEmpty)){a.answers[field.id]=values;a.step++;if(a.step<fields!.length){this.present();return;}return this.resolve(a,'allow-once');}
    if(answer){if(field.multi){a.answers[field.id]=[...new Set([...values,answer.value])];this.notice('Seçim alındı; sonraki seçeneği veya bitti deyin.');return;}a.answers[field.id]=answer.value;a.step++;if(a.step<fields!.length){this.present();return;}return this.resolve(a,'allow-once');}}
  if(decision==='deny')return this.resolve(a,'deny');
  if(field){this.notice('Seçeneği tam söyleyin veya Yanıt: diyerek netleştirin.');this.present();return;}
  if(!fields||!decision){this.notice('Karar belirsiz. Açıkça evet, hayır veya iptal deyin.');this.present();return;}
  return this.resolve(a,decision);
 }
 private async resolve(a:Active,decision:'allow-once'|'deny'){
  this.deciding=true;try{
   this.current(a);const fresh=(await this.list(a.key)).find(r=>r.id===a.request.id&&decisionHash(r)===a.hash);this.current(a);
   if(!fresh)throw new Error('İşlem değişti, çözüldü veya iptal edildi; karar gönderilmedi');
   // Consume before mutation. Lost responses cannot cause a repeated decision.
   this.attempted.add(a.hash);this.clear();const r=a.request;
   if(r.family==='approval')await this.rpc.request('approval.resolve',{id:r.id,kind:r.kind,decision},true);
   else if(r.family==='question')await this.rpc.request('question.resolve',decision==='deny'?{id:r.id,cancel:true}:{id:r.id,answers:{answers:Object.fromEntries(Object.entries(a.answers).map(([k,v])=>[k,Array.isArray(v)?v.map(String):[String(v)]]))}},true);
   else if(r.family==='opencode'){
    if(r.kind==='form'&&decision==='deny'){
     await this.rpc.request('jarvis.worker.answer',{sessionKey:r.sessionKey,agentId:'main',runId:r.runId,expectedRevision:r.revision,requestId:r.id,requestHash:r.requestHash,kind:'cancel-form'},true);
    }else await this.rpc.request('jarvis.worker.answer',{sessionKey:r.sessionKey,agentId:'main',runId:r.runId,expectedRevision:r.revision,requestId:r.id,requestHash:r.requestHash,kind:r.kind,...r.kind==='permission'?{decision:decision==='deny'?'reject':'once'}:{answer:a.answers}},true);
   }else throw new Error('Unknown native decision family');
   this.notice('Karar native isteğe iletildi; yürütme sonucu ayrıca kaydedilecek.');
  }catch(e){this.clear();this.notice(e instanceof Error?e.message:'Karar sonucu belirsiz; tekrar gönderilmedi.');}finally{this.deciding=false;}
 }
}
function requestFieldsSafe(r:Request){try{return requestFields(r);}catch{return undefined;}}
