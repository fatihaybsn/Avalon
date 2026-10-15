import fs from 'node:fs';
import path from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import type {OpenClawPluginApi} from 'openclaw/plugin-sdk/plugin-entry';
import {getMemoryCapabilityRegistration} from 'openclaw/plugin-sdk/memory-host-core';
import {previewForget} from './forget.ts';
import {readNote,noteView,markNoteForgotten} from './notes.ts';
import type {Scope} from './policy.ts';
import type {WorkLedger} from './work.ts';

type Source={relativePath:string;expectedHash:string;content:null};
type Report={dryRun:boolean;entryKeys:string[];mixedLineageEntryKeys:string[];untargetableEntryKeys:string[];refusals:string[];artifacts:Record<string,number>;selective?:{sourcePaths:string[];status:string;limitations?:string[]}};
type Purger={sourceForgetVersion:1;forgetSources(p:{cfg:OpenClawPluginApi['config'];agentId:string;sourceFiles:Source[];dryRun:boolean;assertCurrent:()=>void;signal:AbortSignal}):Promise<Report>};
type Binding={scope:Scope;assertCurrent:()=>void;signal:AbortSignal};
type Preview=ReturnType<typeof previewForget>;
type Plan={owner:string;device:string;session:string;run:string;expires:number;preview:Preview;files:Source[];display:{id:string;content:string;revisions:number[]}[]};
function supportsPurge(v:unknown):v is Purger{return !!v&&typeof v==='object'&&'sourceForgetVersion' in v&&v.sourceForgetVersion===1&&'forgetSources' in v&&typeof v.forgetSources==='function';}
const hash=(s:string)=>createHash('sha256').update(s).digest('hex');
export function createForgetService(api:OpenClawPluginApi,workspace:()=>string,busy:(runId:string)=>boolean,ledger:WorkLedger|undefined,authorize:(call:string,tool:string,p:Record<string,unknown>,scope:Scope,a:{title:string},signal?:AbortSignal)=>Promise<{block?:boolean;blockReason?:string}>){
  const plans=new Map<string,Plan>();
  const runtime=()=>{const r=getMemoryCapabilityRegistration();return r?.pluginId==='memory-core'&&supportsPurge(r.capability.runtime)?r.capability.runtime:undefined;};
  const current=(b:Binding)=>{b.assertCurrent();b.signal.throwIfAborted();};
  const prepare=(b:Binding,id:string,revision:number)=>{
    const preview=previewForget(workspace(),b.scope.userId,id,revision,()=>current(b));
    const files=new Map<string,Source>(),display=[];
    for(const related of preview.related){
      const latest=readNote(workspace(),related.id);display.push({id:related.id,content:latest.content,revisions:related.revisions});
      for(const r of related.revisions){
        const note=readNote(workspace(),related.id,r);
        const rel=`memory/records/${note.id}/r${String(r).padStart(8,'0')}.md`;
        files.set(rel,{relativePath:rel,expectedHash:hash(fs.readFileSync(path.join(workspace(),rel),'utf8')),content:null});
        const view=noteView(workspace(),{...note,content:''});
        if(view)for(const v of [view.path,view.path.replace(/-r\d{8}\.md$/,'.md')]){
          const full=path.join(workspace(),v);if(!fs.existsSync(full))continue;
          const stat=fs.lstatSync(full);if(!stat.isFile()||stat.isSymbolicLink()||stat.nlink!==1)throw new Error('Unsafe controlled view');
          const raw=fs.readFileSync(full,'utf8');
          if(raw&&!raw.startsWith(`JARVIS_NOTE_CURRENT_${note.id.replaceAll('-','_')}_R`))throw new Error('Unowned controlled view');
          files.set(v,{relativePath:v,expectedHash:hash(raw),content:null});
        }
      }
    }
    if(files.size>128)throw new Error('Forget source selection exceeds bounded batch');
    return {preview,files:[...files.values()],display};
  };
  return {
    async preview(b:Binding,id:string,revision:number,allowApply=true){
      const prepared=prepare(b,id,revision),native=runtime();
      if(!native)return prepared.preview;
      if(!prepared.preview.graphComplete||prepared.preview.related.some(n=>n.mixed))return {...prepared.preview,message:'Karma veya eksik köken var; ilgisiz bilgiyi korumak için kapsamı kullanıcıyla netleştirin. Silme yapılmadı.'};
      const report=await native.forgetSources({cfg:api.config,agentId:'main',sourceFiles:prepared.files,dryRun:true,assertCurrent:()=>current(b),signal:b.signal});
      current(b);
      if(report.refusals.length||report.mixedLineageEntryKeys.length||report.untargetableEntryKeys.length)return {...prepared.preview,native:report};
      if(!allowApply)return {...prepared.preview,native:report,message:'Bu yalnızca önizlemedir; Live çağrısında silme uygulanmaz. Çağrıyı bitirin, aynı OpenClaw sohbetini koruyarak yazılı unutma önizlemesini ve tek işlem onayını tamamlayın. Ham sohbet kopyaları ve buluta gönderilmiş veriler bu işlemle silinmez.'};
      for(const [key,p]of plans)if(p.expires<Date.now())plans.delete(key);
      if(plans.size>=32)throw new Error('Too many outstanding forget previews');
      const planId=randomUUID();plans.set(planId,{...prepared,owner:b.scope.userId,device:b.scope.deviceId,session:b.scope.sessionId,run:b.scope.runId,expires:Date.now()+120000});
      return {...prepared.preview,state:'preview',canApply:true,planId,native:report,nativeBlocked:['conversation-text-remains-until-30-day-retention','active-live-call-must-end-before-apply','untracked-independent-paraphrases'],message:'Henüz silinmedi. Kontrollü hafıza kaydı ve izlenen türevler tek işlem onayıyla temizlenebilir; sohbet dökümü 30 günlük ham kayıt kuralına göre kalır. Live çağrısı açıksa bitirip aynı JARVIS sohbetinde devam edin.'};
    },
    async apply(b:Binding,planId:string,callId:string){
      current(b);const p=plans.get(planId),native=runtime();
      if(!native||!p||p.expires<Date.now()||p.owner!==b.scope.userId||p.device!==b.scope.deviceId||p.session!==b.scope.sessionId||p.run!==b.scope.runId)throw new Error('Current original forget preview required');
      if(!ledger||!/(unut|forget)/iu.test(b.scope.userStatement??''))throw new Error('Actual user forget task and durable native record required');
      const check=()=>{current(b);if(busy(b.scope.runId))throw new Error('Active voice, Dreaming or another host task; finish/renew context before forgetting');};
      check();const fresh=prepare(b,p.preview.target.id,p.preview.target.revision);
      if(fresh.preview.snapshot!==p.preview.snapshot||JSON.stringify(fresh.files)!==JSON.stringify(p.files))throw new Error('Forget sources changed; obtain a new preview');
      // The durable approval record contains only identities and hashes. The
      // erased note text must not survive as a second copy in approval history.
      const gate=await authorize(callId,'jarvis_note_forget',{operation:'forget-controlled-records',records:p.display.map(n=>({id:n.id,revisions:n.revisions})),snapshot:p.preview.snapshot,sourceHashes:p.files.map(f=>({path:f.relativePath,sha256:f.expectedHash})),cloudDeletion:false,remaining:['conversation-text-until-30-day-retention','untracked-independent-paraphrases']},b.scope,{title:'JARVIS: seçilmiş hafıza kaydını unut'},b.signal);
      if(gate.block)throw new Error(gate.blockReason??'Exact user approval required');
      check();const recheck=prepare(b,p.preview.target.id,p.preview.target.revision);
      if(recheck.preview.snapshot!==p.preview.snapshot)throw new Error('Forget scope changed during approval');
      const audit=await ledger.change(b.scope.userId,b.scope.taskId,'forget-attempt:'+callId,'forget-attempt',{ids:p.display.map(n=>n.id),snapshot:p.preview.snapshot},()=>{},check);
      if(!audit.changed)throw new Error('Forget was already attempted; inspect its partial outcome before retry');
      plans.delete(planId);
      let marked=false;
      try{
        for(const n of p.display){markNoteForgotten(workspace(),n.id,p.preview.snapshot,'pending',check);marked=true;}
        const report=await native.forgetSources({cfg:api.config,agentId:'main',sourceFiles:p.files,dryRun:false,assertCurrent:check,signal:b.signal});
        check();
        if(report.selective?.status!=='applied'||report.refusals.length)throw new Error('Native source purge is incomplete; note remains withheld');
        for(const n of p.display)markNoteForgotten(workspace(),n.id,p.preview.snapshot,'applied',check);
        await ledger.change(b.scope.userId,b.scope.taskId,'forget-result:'+callId,'forget-result',{ids:p.display.map(n=>n.id),state:'partial',artifacts:report.artifacts},()=>{},check);
        return {state:'partial',controlledMemoryCleared:true,native:report,remaining:['conversation-text-until-30-day-retention','untracked-independent-paraphrases'],message:'Kontrollü notlar ve native izlenen hafıza türevleri temizlendi. Sohbet dökümü 30 günlük ham kayıt kuralına göre kalır; bağımsız/izlenmeyen paraphrase bulunabilir. Buluta daha önce gönderilmiş veri otomatik silinmez.'};
      }catch(e){
        await ledger.change(b.scope.userId,b.scope.taskId,'forget-partial:'+callId,'forget-partial',{ids:p.display.map(n=>n.id),state:'partial',sourceWithheld:marked,blocker:e instanceof Error?e.message:'Native forget outcome unknown'},()=>{});
        throw new Error('Unutma kısmi veya belirsiz; mevcut görev kaydındaki engeli inceleyin. Otomatik tekrar yapılmadı.');
      }
    },
    stop(){plans.clear();},
  };
}
