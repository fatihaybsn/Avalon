import type {Work} from '../shared/contracts.ts';
export {boundedContext} from '../shared/host-context.ts';
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
