import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {readNote, noteForgetState, type Note} from './notes.ts';
import {NATIVE_MAINTENANCE_BLOCKERS} from './maintenance.ts';

// Inspect only the controlled 05 records, never a session or a whole project.
// All semantic resolution remains a preview; missing lineage cannot authorize
// deletion, nor can a model's record selection stand in for clarification.
export function previewForget(workspace:string,userId:string,id:string,expectedRevision:number,assertCurrent:()=>void){
  assertCurrent();const target=readNote(workspace,id);
  if(target.origin.userId!==userId)throw new Error('Another note owner');
  if(!Number.isSafeInteger(expectedRevision)||expectedRevision!==target.revision)throw new Error('REVISION_CONFLICT: read the current note first');
  const root=path.join(workspace,'memory','records');
  const names=fs.readdirSync(root).filter(n=>/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(n)).sort();
  if(names.length>256)throw new Error('Controlled graph exceeds bounded preview; no removal');
  const records=new Map<string,Note[]>();let reads=0,unresolvedRecordCount=0;
  for(const name of names){
    assertCurrent();
    try{
    if(noteForgetState(workspace,name)==='applied')continue;
    const latest=readNote(workspace,name);
    if(latest.origin.userId!==userId)continue;
    if(latest.revision>64)throw new Error('Revision history exceeds bounded preview; no removal');
    const versions=[];
    for(let r=1;r<=latest.revision;r++){
      if(++reads>512)throw new Error('Controlled history exceeds bounded preview; no removal');
      const n=readNote(workspace,name,r);
      if(n.origin.userId!==userId)throw new Error('Conflicting historical owner; no removal');
      versions.push(n);
    }
    records.set(name,versions);
    }catch(e){
      assertCurrent();
      if(reads>512)throw e;
      // Preserve the known target while reporting incomplete lineage. Unsafe
      // unrelated files are neither followed nor treated as fully inspected.
      unresolvedRecordCount++;
    }
  }
  const selected=new Set([id]);let changed=true;
  while(changed){changed=false;for(const [key,versions]of records)if(!selected.has(key)&&versions.some(n=>n.derivedFrom.some(r=>selected.has(r.id)))){selected.add(key);changed=true;}}
  const related=[...selected].sort().map(key=>{
    const versions=records.get(key);if(!versions)throw new Error('Incomplete controlled provenance');
    return {id:key,revisions:versions.map(n=>n.revision),mixed:versions.some(n=>n.derivedFrom.some(r=>!selected.has(r.id))),sources:versions.map(n=>({revision:n.revision,sessionId:n.origin.sessionId,sessionKey:n.origin.sessionKey,sourceKind:n.origin.kind,sources:n.sources,derivedFrom:n.derivedFrom,artifacts:n.artifacts}))};
  });
  assertCurrent();
  // Hash the complete bounded graph, including content, without persisting the
  // forgotten content itself in the task journal or a second memory database.
  const snapshot=createHash('sha256').update(JSON.stringify([...records])).digest('hex');
  return {state:'blocked' as const,canApply:false,previewOnly:true,target:{id,revision:target.revision,content:target.content},related,snapshot,graphComplete:unresolvedRecordCount===0,unresolvedRecordCount,requiresClarification:true,
    clarification:'Bu notta unutmak istediğiniz bilgi ve korunacak başka bilgiler var mı? Karma kaydı bütün silmek için model seçimi yeterli değildir.',
    nativeBlocked:NATIVE_MAINTENANCE_BLOCKERS,sourceChanged:false,indexChanged:false,
    message:'Bilgi henüz silinmedi. Kaynak, indeks ve izlenen türevleri birlikte temizleyen native destek eksik. Bu önizleme silme onayı veya başarılı unutma değildir.',
    cloud:'Yerel unutma, daha önce buluta gönderilmiş veriyi sağlayıcıdan otomatik silmez.'};
}
