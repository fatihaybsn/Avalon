import type {Work} from '../shared/contracts.ts';
export function boundedContext(records:unknown[]){
  const accepted:unknown[]=[];let omitted=0;
  for(const value of records){
    const r=value as Partial<Work>;
    const delta=value as {phase?:string;finding?:string;sources?:string[];rationale?:string;nextStep?:string;pendingDecision?:string};
    let summary:unknown={taskId:r.taskId,revision:r.revision,state:r.state,result:r.result,blocker:r.blocker,acceptedPlan:r.acceptedPlan,model:r.model??{plan:delta.phase,finding:delta.finding,sources:delta.sources,rationale:delta.rationale,nextStep:delta.nextStep,pendingDecision:delta.pendingDecision},operation:r.operation,steering:Object.fromEntries(Object.entries(r.steering??{}).map(([id,s])=>[id,{revision:s.revision,stage:s.stage}]))};
    if(JSON.stringify(summary).length>8000)summary={taskId:r.taskId,revision:r.revision,state:r.state,result:r.result,detailsOmitted:true,readOriginal:'jarvis_output'};
    if(JSON.stringify([...accepted,summary]).length>10000){omitted++;continue;}
    accepted.push(summary);
  }
  return JSON.stringify({records:accepted,omittedRecords:omitted,detailsTool:'jarvis_context/ jarvis_output',authority:'none'});
}
// A UI projection of existing host records, not a result/task database.
export class WorkUpdates {
  private seen=new Map<string,string>();
  private initialized=false;
  readonly unread=new Set<string>();
  update(records:Work[],voiceKey?:string){
    const completed:Work[]=[],context:unknown[]=[];
    for(const r of records){
      const summary={taskId:r.taskId,revision:r.revision,state:r.state,result:r.result,blocker:r.blocker,phase:r.model?.plan,finding:r.model?.finding,sources:r.model?.sources,rationale:r.model?.rationale,nextStep:r.model?.nextStep,pendingDecision:r.model?.pendingDecision,steering:Object.fromEntries(Object.entries(r.steering??{}).map(([id,s])=>[id,{revision:s.revision,stage:s.stage}]))};
      const stamp=JSON.stringify(summary),before=this.seen.get(r.taskId);this.seen.set(r.taskId,stamp);
      if(before===stamp)continue;
      if(this.initialized&&['ended','failed'].includes(r.state)&&(!before||!['ended','failed'].includes(JSON.parse(before).state))){this.unread.add(r.taskId);completed.push(r);}
      if(voiceKey&&(r.sessionKey===voiceKey||r.projectId===voiceKey))context.push(summary);
    }
    this.initialized=true;return {completed,context};
  }
  resetVoice(records:Work[],key:string){return records.filter(r=>r.sessionKey===key||r.projectId===key).map(r=>({taskId:r.taskId,revision:r.revision,state:r.state,result:r.result,blocker:r.blocker,model:r.model,steering:Object.fromEntries(Object.entries(r.steering??{}).map(([id,s])=>[id,{revision:s.revision,stage:s.stage}]))}));}
  read(id:string){this.unread.delete(id);}
}
