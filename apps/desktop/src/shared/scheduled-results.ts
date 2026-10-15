// Transient notification projection. Durable output remains in native cron/chat history.
export class ScheduledResults {
  private seen=new Set<string>();
  private waiting=new Map<string,{key:string;text:string}>();
  private started=new Map<string,Record<string,any>>();
  receive(value:unknown,knownKeys:string[]){
    if(!value||typeof value!=='object')return;
    const e=value as Record<string,any>;
    if(typeof e.jobId!=='string'||!Number.isFinite(e.runAtMs))return;
    const run=JSON.stringify([e.jobId,e.runAtMs]);
    if(e.action==='started'){if(e.job&&this.started.size<128)this.started.set(run,structuredClone(e.job));return;}
    if(e.action!=='finished')return;
    const j=this.started.get(run);this.started.delete(run);
    // Without the admission snapshot, keep the native result in history rather
    // than assigning it to the job's possibly newer current definition.
    if(!j)return;
    const key=j.sessionKey;
    if(j.sessionTarget!=='current'||!knownKeys.includes(key)||j.owner?.sessionKey!==key||j.agentId!=='main')return;
    const revision=j.configRevision??j.updatedAtMs;
    const id=JSON.stringify([e.jobId,e.runAtMs,revision]);
    if(this.seen.has(id)||this.seen.size>=4096)return;
    this.seen.add(id);
    // Never fetch "last result" from a job definition that may already have changed.
    const text=`Zamanlanmış iş: ${String(j.name??e.jobId).slice(0,80)}. Çalışma ${e.runId??run}. Başlangıçtaki tanım ${revision??'native admission'}. ${e.completionStatus==='succeeded'?'Tamamlandı':e.status==='error'?'Hata':'Yürütme/teslim sonucu kesinleşmedi'}. ${String(e.summary??e.error??'Sonuç ilgili sohbetin native kaydındadır.').slice(0,1400)}`;
    const result={id,key,text};this.waiting.set(id,{key,text});return result;
  }
  drain(key:string){const rows=[...this.waiting].filter(([,r])=>r.key===key);for(const [id]of rows)this.waiting.delete(id);return rows.map(([,r])=>r.text);}
  read(id:string){this.waiting.delete(id);}
}
