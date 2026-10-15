import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import type {OpenClawPluginApi} from 'openclaw/plugin-sdk/plugin-entry';
import {createNativeRawMaintenance,type RawWindow} from './native-retention.ts';

export const RAW_DAYS_MS = 30 * 24 * 60 * 60 * 1000;
export const MAINTENANCE_INTERVAL_MS = 60_000;
export const NATIVE_MAINTENANCE_BLOCKERS = [
  'unclassified-custom-control-raw-payloads',
] as const;

type Copy = {id:string; messageId:string; messageAt:number; sha256:string; taskId:string; userId:string; phase:'sealed'|'removing'};
type Row = Copy | {nextDue:number|null;blocked:number} | {id:string; state:string; reason?:string; at:number};
function openStore(api:OpenClawPluginApi){return api.runtime.state.openKeyedStore<Row>({namespace:'jarvis-stage14-maintenance',retention:'retained'});}
type Store = ReturnType<typeof openStore>;
const hash=(value:string|Buffer)=>createHash('sha256').update(value).digest('hex');
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const dueKey=(c:Copy)=>`raw:${String(c.messageAt+RAW_DAYS_MS).padStart(16,'0')}:${c.id}`;

// A fixed, plugin-owned, sealed copy area; never a workspace, native database,
// worker home, arbitrary backup directory, or an instruction-supplied path.
function checked(root:string,name:string){
  if(name!=='.maintenance.lock'&&!/^[0-9a-f-]{36}\.json$/.test(name))throw new Error('Invalid managed copy name');
  const target=path.resolve(root,name);
  let cursor=path.parse(target).root;
  for(const part of target.slice(cursor.length).split(path.sep)){
    cursor=path.join(cursor,part);
    try{const s=fs.lstatSync(cursor);if(s.isSymbolicLink()||s.isFile()&&s.nlink!==1)throw new Error('Linked managed path refused');}
    catch(e){if((e as NodeJS.ErrnoException).code!=='ENOENT')throw e;}
  }
  return target;
}

export class RawCopyMaintenance {
  constructor(readonly root:string,readonly store:Store,readonly busy:()=>boolean,readonly signal:AbortSignal,readonly continuationSafe:(copy:Copy)=>Promise<boolean>,readonly now=Date.now){}
  private current(){if(this.signal.aborted)throw new Error('Maintenance stopped');if(this.busy())throw new Error('Host busy; maintenance deferred');}
  private async locked<T>(run:()=>Promise<T>):Promise<T>{
    this.current();
    // Do not create a raw archive just to maintain it.
    checked(this.root,'.maintenance.lock');
    const fd=fs.openSync(path.join(this.root,'.maintenance.lock'),'wx');
    try{return await run();}finally{fs.closeSync(fd);fs.unlinkSync(checked(this.root,'.maintenance.lock'));}
  }
  private read(c:Copy){
    if(!uuid.test(c.id)||!Number.isSafeInteger(c.messageAt)||c.messageAt<=0||c.messageAt>this.now()||!c.taskId||!c.userId||!/^[0-9a-f]{64}$/.test(c.sha256))throw new Error('Invalid managed copy descriptor');
    const target=checked(this.root,c.id+'.json'),stat=fs.statSync(target);
    if(!stat.isFile()||stat.size>1024*1024)throw new Error('Managed copy is not a bounded file');
    const raw=fs.readFileSync(target),data=JSON.parse(raw.toString('utf8'));
    if(hash(raw)!==c.sha256||data.kind!=='jarvis-raw-message-v1'||data.messageId!==c.messageId||data.timestamp!==c.messageAt||!['user','assistant'].includes(data.role)||typeof data.content!=='string'||Object.keys(data).some(k=>!['kind','messageId','timestamp','role','content'].includes(k)))throw new Error('Copy changed, mixed, reasoning, or unsupported format; no removal');
    return {target,stat};
  }
  // Host-only integration for an ALREADY existing, sealed one-message copy.
  // No RPC/tool exposes registration or creates another transcript archive.
  async track(c:Omit<Copy,'phase'>,assertCurrent:()=>void){
    return this.locked(async()=>{
      assertCurrent();this.read({...c,phase:'sealed'});
      if(await this.store.lookup('audit:'+c.id)||await this.store.lookup('issue:'+c.id))throw new Error('Copy already settled or blocked; no automatic replay');
      const prior=await this.store.lookup('watermark') as {nextDue:number|null;blocked:number}|undefined;
      assertCurrent();this.current();
      // Arm eligibility BEFORE registering the copy. A crash must never leave
      // a committed raw row hidden behind an idle or later watermark.
      await this.store.register('watermark',{nextDue:Math.min(prior?.nextDue??Infinity,c.messageAt+RAW_DAYS_MS),blocked:prior?.blocked??0});
      assertCurrent();this.current();this.read({...c,phase:'sealed'});
      const registered=await this.store.registerIfAbsent(dueKey({...c,phase:'sealed'}),{...c,phase:'sealed'});
      if(!registered)throw new Error('Copy already tracked; no replacement');
    });
  }
  private async first(){
    if(!this.store.entriesInKeyRange)throw new Error('Native bounded state reads required');
    const rows=await this.store.entriesInKeyRange({keyStartInclusive:'raw:',keyEndExclusive:'raw;',limit:1,order:'asc'});
    return rows[0] as {key:string;value:Copy}|undefined;
  }
  async tick(){
    if(this.signal.aborted||this.busy())return {state:'deferred',removed:0};
    const water=await this.store.lookup('watermark') as {nextDue:number|null;blocked:number}|undefined;
    if(!water||water.nextDue===null||water.nextDue>this.now())return {state:water?.blocked?'partial':'idle',removed:0,blocked:water?.blocked??0};
    if(!fs.existsSync(this.root))return {state:'blocked',removed:0,reason:'Managed raw copy root missing; inventory retained'};
    try{return await this.locked(async()=>{
      if(!this.store.entriesInKeyRange)throw new Error('Native bounded state reads required');
      const prior=await this.store.lookup('watermark') as {blocked:number}|undefined;
      const rows=await this.store.entriesInKeyRange({keyStartInclusive:'raw:',keyEndExclusive:`raw:${String(this.now()).padStart(16,'0')}:\uffff`,limit:4,order:'asc'});
      let removed=0,blocked=0;
      for(const row of rows){
        this.current();const c=row.value as Copy;
        try{
          // Never derive age from file mtime, archive date, or session activity.
          if(dueKey(c)!==row.key||c.messageAt+RAW_DAYS_MS>this.now())throw new Error('Retention identity changed');
          if(!await this.continuationSafe(c))throw new Error('Durable task continuation summary unavailable; raw removal blocked');
          this.current();const filename=checked(this.root,c.id+'.json');
          if(!fs.existsSync(filename)&&c.phase==='removing'){
            await this.store.register('audit:'+c.id,{id:c.id,state:'removed-after-interrupted-bookkeeping',at:this.now()});
          }else{
            this.read(c);this.current();
            // Durable intent survives a crash between unlink and state cleanup.
            await this.store.register(row.key,{...c,phase:'removing'});
            this.current();const {target}=this.read(c);this.current();
            fs.unlinkSync(target);
            await this.store.register('audit:'+c.id,{id:c.id,state:'removed',at:this.now()});
          }
          await this.store.delete(row.key);removed++;
        }catch(e){
          // Stop/host activity defers remaining work. Unknown effects are not
          // blindly replayed; a changed/denied copy goes to an issue record.
          if(this.signal.aborted||this.busy())break;
          blocked++;
          await this.store.register('issue:'+c.id,{id:c.id,state:'blocked',reason:e instanceof Error?e.message:'Removal refused',at:this.now()});
          await this.store.delete(row.key);
        }
      }
      const earliest=await this.first();
      const totalBlocked=(prior?.blocked??0)+blocked;
      await this.store.register('watermark',{nextDue:earliest?earliest.value.messageAt+RAW_DAYS_MS:null,blocked:totalBlocked});
      return {state:totalBlocked?'partial':'managed-scope-only',removed,blocked:totalBlocked};
    });}catch(e){return {state:'deferred',removed:0,reason:e instanceof Error?e.message:'Maintenance unavailable'};}
  }
}

export function installMaintenance(api:OpenClawPluginApi,busy:()=>boolean,continuationSafe:(copy:Copy)=>Promise<boolean>,nativeContinuationSafe:(window:RawWindow)=>Promise<boolean>=async()=>false){
  let last:unknown={state:'not-started'},nativeLast:unknown={state:'not-started'},job:{stop:()=>Promise<void>}|undefined,stop:AbortController|undefined,native:ReturnType<typeof createNativeRawMaintenance>|undefined;
  if(typeof api.registerService!=='function'||typeof api.runtime?.state?.openKeyedStore!=='function')return {status:()=>({state:'blocked',reason:'Native service/state unavailable',nativeBlocked:NATIVE_MAINTENANCE_BLOCKERS})};
  api.registerService({apiVersion:2,id:'jarvis-raw-maintenance',start(ctx){
    stop=new AbortController();
    const store=openStore(api),engine=new RawCopyMaintenance(path.join(ctx.stateDir,'jarvis','raw-copies'),store,busy,AbortSignal.any([ctx.scheduler.signal,stop.signal]),continuationSafe,ctx.scheduler.now);
    native=createNativeRawMaintenance(api,busy,AbortSignal.any([ctx.scheduler.signal,stop.signal]),nativeContinuationSafe,ctx.scheduler.now);
    job=ctx.scheduler.schedule({id:'raw-retention',delayMs:0,everyMs:MAINTENANCE_INTERVAL_MS,async run(){try{last=await engine.tick();}catch{last={state:'blocked',reason:'Native maintenance state unavailable'};}try{nativeLast=await native!.tick();}catch(e){nativeLast={state:'blocked',reason:e instanceof Error?e.message:'Native raw maintenance failed'};}}});
  },async stop(){stop?.abort();await job?.stop();job=undefined;}});
  api.on('message_received',()=>native?.invalidate());
  api.on('agent_end',()=>native?.invalidate());
  return {status:()=>({intervalMs:MAINTENANCE_INTERVAL_MS,retentionDays:30,managed:last,native:nativeLast,nativeBlocked:NATIVE_MAINTENANCE_BLOCKERS,complete:false})};
}
