import type {Work} from './contracts.ts';
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
