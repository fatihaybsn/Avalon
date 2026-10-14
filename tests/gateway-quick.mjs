import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
export async function runQuickGateway({reviewer,requester,limited,events,key,target}) {
 const common={sessionKey:key,agentId:'main',runId:'stage07-local',taskId:'stage07-local',projectId:'stage07',role:'project',root:target};
 const file=path.join(target,'note.txt');
 const grants=[{tool:'jarvis_windows',params:{action:'audio_status'}},{tool:'jarvis_draft',params:{path:file,content:'Stage07 native draft'}},{tool:'jarvis_recycle',params:{path:file}}];
 await requester.request('jarvis.scope.bind',{...common,quick:grants,userInput:'Yerel test notunu yaz; ses durumunu oku.'});
 const call=(tool,params,callId)=>requester.request('jarvis.quick.execute',{sessionKey:key,agentId:'main',runId:common.runId,callId,tool,params},{timeoutMs:70000});
 const audio=await call('jarvis_windows',{action:'audio_status'},'audio');assert.equal(audio.details.confirmed,true);
 const draft=await call('jarvis_draft',grants[1].params,'draft');assert.equal(draft.details.confirmed,true);assert.equal(await fs.readFile(file,'utf8'),'Stage07 native draft');
 await assert.rejects(call('jarvis_draft',grants[1].params,'draft'),/already attempted/);
 await assert.rejects(call('jarvis_draft',grants[1].params,'draft-again'),/grant|scope|operation|protected target/i);
 const before=await reviewer.request('jarvis.work.read',{sessionKey:key,agentId:'main',taskId:common.taskId});
 assert.equal(before.record.operation.tool,'jarvis_draft');
 const pending=call('jarvis_recycle',{path:file},'recycle-deny');
 const deadline=Date.now()+15000;let event;
 while(!(event=events.find(e=>e.event==='plugin.approval.requested' && e.payload?.request?.toolCallId==='recycle-deny'))){if(Date.now()>deadline)throw new Error('No local native approval');await new Promise(r=>setTimeout(r,50));}
 assert.equal(await fs.readFile(file,'utf8'),'Stage07 native draft');
 await assert.rejects(limited.request('approval.resolve',{id:event.payload.id,kind:'plugin',decision:'allow-once'}));
 await reviewer.request('approval.resolve',{id:event.payload.id,kind:'plugin',decision:'deny'});
 await assert.rejects(pending,/allow-once/);assert.equal(await fs.readFile(file,'utf8'),'Stage07 native draft');
 const allowed=call('jarvis_recycle',{path:file},'recycle-allow');
 const allowDeadline=Date.now()+15000;let allowEvent;
 while(!(allowEvent=events.find(e=>e.event==='plugin.approval.requested' && e.payload?.request?.toolCallId==='recycle-allow'))){if(Date.now()>allowDeadline)throw new Error('No exact recycle allow approval');await new Promise(r=>setTimeout(r,50));}
 assert.equal(await fs.readFile(file,'utf8'),'Stage07 native draft');
 await reviewer.request('approval.resolve',{id:allowEvent.payload.id,kind:'plugin',decision:'allow-once'});
 const recycled=await allowed;assert.equal(recycled.details.confirmed,true);assert.ok(recycled.details.recycleItem);await assert.rejects(fs.access(file));
 console.log('PASS real authenticated model-free local helper/draft, retained native work, no replay and native recycle deny/allow-once with actual bin item');
 const started=[];
 try {
  for(const profile of ['jarvis-background','jarvis-visible']) {
   const query={profile};
   await reviewer.request('browser.request',{method:'POST',path:'/start',query,timeoutMs:30000},{timeoutMs:35000});started.push(profile);
   const status=await reviewer.request('browser.request',{method:'GET',path:'/',query});
   assert.equal(status.running,true);assert.equal(status.headless,profile==='jarvis-background');
   assert.ok(status.userDataDir && !status.userDataDir.includes('User Data')); // native dedicated profile
   const blank=await reviewer.request('browser.request',{method:'POST',path:'/tabs/open',query,body:{url:'about:blank'},timeoutMs:20000},{timeoutMs:25000});
   const prime=await reviewer.request('browser.request',{method:'GET',path:'/snapshot',query:{...query,targetId:blank.targetId,format:'ai',maxChars:'1000'},timeoutMs:20000},{timeoutMs:25000});
   assert.equal(prime.format,'ai');
   await assert.rejects(reviewer.request('browser.request',{method:'POST',path:'/tabs/open',query,body:{url:'https://example.com/'},timeoutMs:25000},{timeoutMs:30000}),/DNS rebinding|IP-literal/i);
   const tab=blank;
   await reviewer.request('browser.request',{method:'POST',path:'/navigate',query,body:{url:'https://1.1.1.1/cdn-cgi/trace',targetId:tab.targetId},timeoutMs:25000},{timeoutMs:30000});
   const snapshot=await reviewer.request('browser.request',{method:'GET',path:'/snapshot',query:{...query,targetId:tab.targetId,format:'ai',maxChars:'4000'},timeoutMs:20000},{timeoutMs:25000});
   assert.match(snapshot.snapshot,/ip=|h=1\.1\.1\.1/);
   await assert.rejects(reviewer.request('browser.request',{method:'POST',path:'/tabs/open',query,body:{url:'http://127.0.0.1/'}}, {timeoutMs:15000}),/private|blocked|network|address|SSRF/i);
   console.log(`PASS native managed ${profile}: actual ${status.headless?'headless':'visible'} Chrome, dedicated profile, public-IP Playwright snapshot, private destination denial and explicit strict DNS blocker`);
  }
 } finally {for(const profile of started)await reviewer.request('browser.request',{method:'POST',path:'/stop',query:{profile},timeoutMs:15000},{timeoutMs:20000}).catch(()=>{});}
 await reviewer.request('plugins.reload',{plugins:[{pluginId:'jarvis'}]});
 const retained=await reviewer.request('jarvis.work.read',{sessionKey:key,agentId:'main',taskId:common.taskId});
 assert.equal(retained.record.taskId,common.taskId);
 await assert.rejects(call('jarvis_windows',{action:'audio_status'},'restart-audio'),/operator|scope|authority/i);
 console.log('PASS stage07 retained work after reload; executable scope not resurrected');
}
