import type {OpenClawPluginApi} from 'openclaw/plugin-sdk/plugin-entry';

export type RawWindow={sessionKey:string;sessionId:string;targetKind:'active'|'cold'|'lifecycle'|'cleanup';generation:string;archiveName?:string};
type Cursor=Pick<RawWindow,'targetKind'|'sessionId'|'generation'|'archiveName'>;
type Result={removedMessages:number;eligibleMessages:number;removedDerivedSummaries?:number;eligibleDerivedSummaries?:number;nextAfterSeq:number;hasMore:boolean;previewHash:string;nextDueAtMs?:number;blockedScopes:string[]};
type NativeRaw={
  listRawRetentionWindows(p:{agentId:string;storePath?:string;afterCursor?:Cursor;signal:AbortSignal;assertIdle:()=>void}):Promise<{windows:RawWindow[];nextCursor?:Cursor}>;
  maintainSessionRawRetention(p:{scope:RawWindow&{agentId:string;storePath?:string};request:{nowMs:number;afterSeq:number;mode:'preview'|'apply';expectedPreviewHash?:string};signal:AbortSignal;assertIdle:()=>void}):Promise<Result>;
};
type Progress={queue:RawWindow[];afterCursor?:Cursor;pageCursor?:Cursor;afterSeq:number;nextDue:number;minimumDue?:number;blocked:string[];held:string[]};
function openStore(api:OpenClawPluginApi){return api.runtime.state.openKeyedStore<Progress>({namespace:'jarvis-native-raw-maintenance',retention:'retained'});}
function hasNativeRaw(v:unknown):v is NativeRaw{return !!v&&typeof v==='object'&&'listRawRetentionWindows' in v&&typeof v.listRawRetentionWindows==='function'&&'maintainSessionRawRetention' in v&&typeof v.maintainSessionRawRetention==='function';}
const base=(held:string[]=[]):Progress=>({queue:[],afterSeq:-1,nextDue:0,blocked:[],held});
const key=(w:RawWindow)=>JSON.stringify([w.targetKind,w.sessionId,w.generation,w.archiveName??'']);
export class NativeRawMaintenance {
  private dirty=true;
  constructor(readonly api:OpenClawPluginApi,readonly store:ReturnType<typeof openStore>,readonly busy:()=>boolean,readonly signal:AbortSignal,readonly continuationSafe:(window:RawWindow)=>Promise<boolean>,readonly now=Date.now,readonly load:()=>Promise<unknown>=()=>import('openclaw/plugin-sdk/session-store-runtime')){}
  invalidate(){this.dirty=true;}
  private current(){this.signal.throwIfAborted();if(this.busy())throw new Error('Native raw maintenance deferred: host voice/write/work busy');}
  async tick(){
    if(this.signal.aborted||this.busy())return {state:'deferred'};
    let p=await this.store.lookup('cursor')??base();
    // Earlier stage-14 cursors used only session IDs. Re-scan from the beginning once.
    if(this.dirty||('afterPage' in p)||('afterWindow' in p)) { p=base(p.held??[]);this.dirty=false; }
    if(p.nextDue>this.now())return {state:'idle',nextDue:p.nextDue,blocked:p.blocked,held:p.held.length};
    if(!p.queue.length&&!p.afterCursor){p.minimumDue=undefined;p.blocked=[];}
    this.current();const native=await this.load();this.current();
    if(!hasNativeRaw(native))return {state:'blocked',reason:'Native source-built raw maintenance SDK unavailable'};
    const common={agentId:'main',...this.api.config.session?.store?{storePath:this.api.config.session.store}:{},signal:this.signal,assertIdle:()=>this.current()};
    if(!p.queue.length){
      const page=await native.listRawRetentionWindows({...common,...p.afterCursor?{afterCursor:p.afterCursor}:{}});this.current();
      p.queue=page.windows;p.pageCursor=page.nextCursor;p.afterSeq=-1;
      if(!p.queue.length){p.nextDue=p.minimumDue??this.now()+86400000;p.minimumDue=undefined;p.afterCursor=undefined;p.pageCursor=undefined;await this.save(p);return {state:'partial',removed:0,nextDue:p.nextDue,blocked:p.blocked,held:p.held.length};}
    }
    const window=p.queue[0]!;
    const advance=()=>{p.queue.shift();p.afterSeq=-1;if(!p.queue.length){p.afterCursor=p.pageCursor;p.pageCursor=undefined;if(!p.afterCursor){p.nextDue=p.minimumDue??this.now()+86400000;p.minimumDue=undefined;}}};
    const holdKey=key(window);
    if(p.held.includes(holdKey)){p.blocked=[...new Set([...p.blocked,'unknown-prior-maintenance-outcome'])];advance();await this.save(p);return {state:'partial',removed:0,held:p.held.length,blocked:p.blocked};}
    if(!await this.continuationSafe(window)){
      this.current();p.blocked=[...new Set([...p.blocked,'pending-work-continuation-summary-unavailable'])];
      p.minimumDue=Math.min(p.minimumDue??Infinity,this.now()+60000);advance();await this.save(p);return {state:'blocked',removed:0,blocked:p.blocked};
    }
    this.current();const nowMs=this.now();
    const scope={...window,agentId:'main',...common.storePath?{storePath:common.storePath}:{}};
    const request={nowMs,afterSeq:p.afterSeq,mode:'preview' as const};
    const preview=await native.maintainSessionRawRetention({scope,request,signal:this.signal,assertIdle:()=>this.current()});
    this.current();let result=preview;
    if(preview.eligibleMessages||preview.eligibleDerivedSummaries){
      if(p.held.length>=256)throw new Error('Native maintenance recovery inventory is full');
      p.held.push(holdKey);await this.save(p);this.current();
      result=await native.maintainSessionRawRetention({scope,request:{...request,mode:'apply',expectedPreviewHash:preview.previewHash},signal:this.signal,assertIdle:()=>this.current()});
      p.held=p.held.filter(id=>id!==holdKey);
    }
    this.current();p.blocked=[...new Set([...p.blocked,...result.blockedScopes])];
    if(result.nextDueAtMs!==undefined)p.minimumDue=Math.min(p.minimumDue??Infinity,result.nextDueAtMs);
    if(result.generation!==undefined&&window.targetKind==='active')window.generation=result.generation;
    if(result.hasMore)p.afterSeq=result.nextAfterSeq;else advance();
    await this.save(p);
    return {state:'partial',removedMessages:result.removedMessages,removedDerivedSummaries:result.removedDerivedSummaries??0,blocked:p.blocked,held:p.held.length,nextDue:p.nextDue};
  }
  private async save(p:Progress){this.current();await this.store.register('cursor',JSON.parse(JSON.stringify(p)),{assertCurrent:()=>this.current()});}
}
export function createNativeRawMaintenance(api:OpenClawPluginApi,busy:()=>boolean,signal:AbortSignal,continuationSafe:(window:RawWindow)=>Promise<boolean>,now:()=>number){return new NativeRawMaintenance(api,openStore(api),busy,signal,continuationSafe,now);}
