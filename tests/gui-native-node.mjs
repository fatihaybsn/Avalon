import fs from 'node:fs/promises';import path from 'node:path';import {execFile,spawn} from 'node:child_process';import {promisify} from 'node:util';import {randomUUID} from 'node:crypto';import assert from 'node:assert/strict';
import {configureGuiPolicy,guiDecision,GuiObservations} from '../plugins/jarvis/gui-policy.ts';import {makeScope} from '../plugins/jarvis/policy.ts';
const execute=promisify(execFile),nodeId=process.argv[2];if(!/^[a-f0-9]{64}$/.test(nodeId??''))throw new Error('Exact paired node ID required');if(!process.argv.includes('--confirm-fixture-background-write'))throw new Error('Read-only by default; confirm the single write to the owned fixture explicitly');
const gatewayToken=process.env.OPENCLAW_GATEWAY_TOKEN??process.env.JARVIS_GATEWAY_TOKEN;if(!gatewayToken)throw new Error('Existing Gateway token unavailable; node pairing is not bypassed');const invokeEnv={...process.env,OPENCLAW_GATEWAY_TOKEN:gatewayToken};
const executionId=randomUUID();await fs.mkdir('tmp',{recursive:true});const scratch=await fs.mkdtemp(path.resolve('tmp/stage08-native-'));
configureGuiPolicy(nodeId,path.resolve('native/windows'));
const scope=await makeScope({runId:executionId,projectId:'stage08-fixture',taskId:executionId,role:'project',root:process.cwd(),userInput:'In the owned JARVIS stage08 fixture, set the observed edit field to the specified test phrase and verify it.'},{userId:'stage08-operator',deviceId:'stage08-device',agentId:'main',sessionId:'stage08-session',sessionKey:'agent:main:stage08-test'});
const guiGuard=new GuiObservations();
const fixture=spawn('pwsh',['-NoProfile','-File',path.resolve('tests/windows-gui-fixture.ps1'),'-ControlDirectory',scratch],{windowsHide:true,stdio:['ignore','ignore','pipe']});let errors='';fixture.stderr.on('data',b=>errors+=b);
const invokeNode=async(command,params)=>{
 const {stdout}=await execute(process.execPath,['--max-semi-space-size=4','node_modules/openclaw/openclaw.mjs','--profile','jarvis','nodes','invoke','--node',nodeId,'--command',command,'--params',JSON.stringify(params),'--json'],{timeout:30000,maxBuffer:2000000,windowsHide:true,env:invokeEnv});
 const result=JSON.parse(stdout);if(!result.ok||result.payload?.ok===false)throw new Error(JSON.stringify(result.payload??result.error));return result.payload;
};
const invokeGui=async(params)=>{
 const decision=await guiDecision('computer',params,scope);guiGuard.before(scope.runId,'computer',decision.params);
 const {target:_,node:__,...wire}=decision.params;const result=await invokeNode('computer.act',{...wire,executionId});
 guiGuard.after(scope.runId,'computer',decision.params,result);return result;
};
try{
 const deadline=Date.now()+10000;while(true){try{await fs.access(path.join(scratch,'ready.json'));break;}catch{if(fixture.exitCode!==null||Date.now()>deadline)throw new Error('Fixture unavailable: '+errors);await new Promise(r=>setTimeout(r,100));}}
 const ready=JSON.parse(await fs.readFile(path.join(scratch,'ready.json'),'utf8'));
 const list=await invokeGui({action:'list_windows',target:'node',node:nodeId});const window=list.details.windows.find(w=>w.title==='JARVIS stage08 owned fixture');
 if(!window){const osState=await execute('pwsh',['-NoProfile','-Command',`Add-Type -Path '${path.resolve('native/windows/Windows.cs')}'; [JarvisWindows]::Windows() | Where-Object { $_.pid -eq ${ready.pid} } | ConvertTo-Json -Compress`],{windowsHide:true,timeout:10000});console.log('OWN_FIXTURE_OS',osState.stdout.trim(),'CUA_COUNT',list.details.windows.length);}
 assert.ok(window);
 const observation=await invokeGui({action:'get_window_state',target:'node',node:nodeId,windowRef:window.windowRef,includeScreenshot:false});
 await fs.writeFile(path.join(scratch,'observation.json'),JSON.stringify(observation,null,2));
 const edit=observation.observation.elements.find(e=>e.role==='Edit');assert.ok(edit);
 const expected='JARVIS stage08 background confirmed';
 const outcome=await invokeGui({action:'set_value',target:'node',node:nodeId,windowRef:window.windowRef,elementRef:edit.elementRef,observationId:observation.observation.observationId,value:expected,deliveryMode:'background'});
 const verification=await invokeGui({action:'get_window_state',target:'node',node:nodeId,windowRef:window.windowRef,includeScreenshot:false});
 const matches=verification.observation.elements.filter(e=>e.role===edit.role&&JSON.stringify(e.bounds)===JSON.stringify(edit.bounds));
 assert.equal(matches.length,1,'JARVIS host guard could not uniquely identify the target by role and exact bounds');const verifiedElement=matches[0];assert.equal(verifiedElement.value,expected,'JARVIS host guard could not verify the observed element value');
 await new Promise(r=>setTimeout(r,200));const readback=JSON.parse(await fs.readFile(path.join(scratch,'state.json'),'utf8'));
 const receipt={fixture:ready.pid,nodeId,executionId,windowRef:window.windowRef,hostGuard:'guiDecision + GuiObservations',structuredWithoutImage:!observation.images?.length,outcome,verification:{observationId:verification.observation.observationId,value:verifiedElement?.value},readback,foregroundChanged:readback.foreground!==ready.foreground,deliveryMode:outcome.details?.deliveryMode??'unknown',readbackVerified:readback.text===expected,deliveryVerified:outcome.details?.deliveryMode==='background'};
 await fs.writeFile('tmp/stage08-cua-proof.json',JSON.stringify(receipt,null,2)+'\n');console.log(JSON.stringify(receipt));
 assert.equal(readback.text,expected,'The owned fixture did not contain the requested text after the CUA action');
 assert.equal(readback.foreground,ready.foreground,'The owned fixture was brought to the foreground');
}finally{
 try{await invokeNode('computer.act',{action:'__close_execution',executionId,reason:'stage08-fixture-complete'});}catch(e){console.error('CUA execution cleanup:',e instanceof Error?e.message:'unknown');}
 guiGuard.release(scope.runId);
 await fs.writeFile(path.join(scratch,'stop'),'stop');await new Promise(resolve=>{if(fixture.exitCode!==null)resolve();else fixture.once('close',resolve)});
}
