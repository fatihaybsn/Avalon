import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs/promises';import {existsSync} from 'node:fs';
import {hostMcpConfig,openCodeGuiConfig,buildGuiBackend,safeManagerFailure,managerTerminalResult,managerExecutionArgs,managerBridgeTools,readFinalAssistantMessage,managerWorkerRegistryReady,managerRegistryAuthority,effectivePermission,MANAGER_REGISTRY_SAMPLE_PATH} from '../plugins/jarvis/opencode-gui.ts';
import {createServer} from 'node:http';
import {MANAGER_PERMISSIONS,MANAGER_READ_PROBE_PATH,assertManagerSession} from '../scripts/manager-permissions.mjs';
const env={OPENCLAW_MCP_TOKEN:'unit-token',OPENCLAW_MCP_CLI_CAPTURE_KEY:'unit-capture'};
const input={mcpServers:{openclaw:{type:'http',alwaysLoad:true,url:'http://127.0.0.1:1234/mcp',headers:{Authorization:'Bearer ${OPENCLAW_MCP_TOKEN}','x-openclaw-cli-capture-key':'${OPENCLAW_MCP_CLI_CAPTURE_KEY}'}}}};
test('ordinary OpenCode config keeps one run-bound OpenClaw MCP tool connection',()=>{
 const actual=hostMcpConfig(input,env);assert.equal(actual.headers.Authorization,'Bearer unit-token');assert.equal(actual.disabled,false);assert.equal(actual.type,'remote');
 const config=openCodeGuiConfig(actual);assert.equal(config.mcp.servers.openclaw.type,'remote');assert.equal(config.mcp.servers.openclaw.url,actual.url);assert.equal(config.mcp.openclaw,undefined);assert.equal(config.plugins,undefined);assert.equal(config.permission,undefined);
 assert.equal(config.mcp.servers.openclaw.codemode,false,'host tools must remain directly visible while execute stays denied');
 assert.deepEqual(actual.timeout,{catalog:70000,execution:70000});
 assert.match(config.agents['jarvis-manager'].system,/openclaw_read, openclaw_write and openclaw_edit/);
 assert.match(config.agents['jarvis-manager'].system,/never use it for real work/);
 assert.equal(config.default_agent,'jarvis-manager');assert.deepEqual(config.agents['jarvis-manager'].permissions,MANAGER_PERMISSIONS);
 for(const url of ['https://evil.example/mcp','http://127.0.0.1:1234/other','http://localhost:1234/mcp'])assert.throws(()=>hostMcpConfig({mcpServers:{openclaw:{...input.mcpServers.openclaw,url}}},env));
 const merged=hostMcpConfig({...input,mcpServers:{...input.mcpServers,windows_gui:{type:'stdio',command:'uvx'}}},env);
 const isolated=openCodeGuiConfig(merged);assert.deepEqual(Object.keys(isolated.mcp.servers),['openclaw']);assert.equal(isolated.mcp.servers.windows_gui,undefined);
 assert.throws(()=>hostMcpConfig({mcpServers:{openclaw:{...input.mcpServers.openclaw,type:'stdio'}}},env));
 assert.throws(()=>hostMcpConfig(input,{}));
 const backend=buildGuiBackend();assert.equal(backend.modelProvider,'opencode');assert.equal(backend.config.imageArg,'--file');assert.equal(backend.nativeToolMode,'selectable');assert.throws(()=>backend.resolveModelId({modelId:'paid-model'}));
});
test('the GUI worker is registered as an optional CLI backend without becoming the default model',async()=>{
 const manifest=JSON.parse(await fs.readFile('plugins/jarvis/openclaw.plugin.json','utf8'));
 assert.ok(manifest.cliBackends.includes('jarvis-opencode-gui'));
 const backend=buildGuiBackend();assert.equal(backend.id,'jarvis-opencode-gui');assert.equal(backend.config.args.at(-1),'opencode/space-bunny-free');
});
test('manager failures preserve only safe auth/status classification',()=>{
 const error=safeManagerFailure({type:'provider.auth',status:403,message:'private provider response',response:{body:'secret response'}});
 assert.match(error,/provider authorization denied \(HTTP 403\)/);
 assert.doesNotMatch(error,/private provider response|secret response/);
 assert.match(safeManagerFailure({type:'provider.rate_limit',status:429}),/provider rate limit \(HTTP 429\)/);
});
// Live acceptance 16 Ekim: this manager turn path had no coverage at all, and the
// first real run failed on a server call that can never succeed. OpenCode 2.0.28
// resolves a custom agent only for its own root directory, never for a run's
// scratch path, so native.agent.get must not appear here again.
test('the manager backend proves authority on the run session and never looks the agent up by scratch path',async()=>{
  const source=await fs.readFile('plugins/jarvis/opencode-gui.ts','utf8');
  assert.doesNotMatch(source,/native\.agent\.get\(/,'agent-level lookup cannot resolve at the scratch path');
  assert.match(source,/assertManagerSession\(await native\.session\.get/,'authority must be proven per run on the running session');
});
test('manager prepareExecution writes an isolated scratch config and cleans it up',async()=>{
  const backend=buildGuiBackend(true);
  assert.equal(backend.isolatesInstructionsWithExactTools,true);
  const prepared=await backend.prepareExecution({modelId:'space-bunny-free',toolAvailability:{openClaw:['read']}});
  assert.equal(prepared.toolAvailabilityEnforced,true);
  assert.equal(typeof prepared.execute,'function');
  await prepared.cleanup();
});
test('assertManagerSession accepts only the exact manager session',async()=>{
  const {MANAGER_PERMISSIONS,assertManagerSession}=await import('../scripts/manager-permissions.mjs');
  const good={id:'s1',agent:'jarvis-manager',permissions:MANAGER_PERMISSIONS};
  assert.doesNotThrow(()=>assertManagerSession(good,'s1'));
  assert.throws(()=>assertManagerSession(good,'other'),/permissions not proven/);
  assert.throws(()=>assertManagerSession({...good,agent:'build'},'s1'),/permissions not proven/);
  assert.throws(()=>assertManagerSession({...good,permissions:[{action:'*',resource:'*',effect:'allow'}]},'s1'),/permissions not proven/);
  assert.throws(()=>assertManagerSession({...good,permissions:[...MANAGER_PERMISSIONS,{action:'shell',resource:'*',effect:'allow'}]},'s1'),/permissions not proven/);
});
// Measured 16 Ekim: the manager turn returned HTTP 403 FreeTierError on every run.
// Same 2.0.28 binary, same private profile, same --server path, same account and
// same space-bunny-free#max; deny-all failed 2/2 and one narrow `read` allow
// succeeded 2/2 (anomalyco/opencode#51241). The narrow allow must stay narrow:
// the manager still reads nothing, and dropping it must fail closed.
test('the free-tier read allow is one unreachable literal and grants no other capability',()=>{
  assert.deepEqual(MANAGER_PERMISSIONS.slice(0,2),[{action:'*',resource:'*',effect:'deny'},{action:'openclaw_*',resource:'*',effect:'allow'}]);
  const read=MANAGER_PERMISSIONS.filter(p=>p.action==='read');
  assert.deepEqual(read,[{action:'read',resource:MANAGER_READ_PROBE_PATH,effect:'allow'}]);
  assert.equal(MANAGER_READ_PROBE_PATH,'C:\\jarvis-unreachable-allowlist\\readable.txt');
  assert.ok(!/[*?[\]]/.test(MANAGER_READ_PROBE_PATH),'must be a literal path, not a glob');
  assert.ok(!MANAGER_READ_PROBE_PATH.endsWith('\\'),'must not allow a whole directory');
  assert.ok(!existsSync(MANAGER_READ_PROBE_PATH),'allowed path must not exist on disk');
  for(const action of ['edit','write','shell','glob','grep','external_directory','webfetch'])
    assert.ok(!MANAGER_PERMISSIONS.some(p=>p.action===action&&p.effect==='allow'),action+' must stay denied');
  assert.throws(()=>assertManagerSession({id:'s1',agent:'jarvis-manager',permissions:MANAGER_PERMISSIONS.slice(0,2)},'s1'),/permissions not proven/);
});
// Measured 16 Ekim: OpenClaw ended every real manager turn with "CLI plugin
// runtime completed without a terminal result". OpenCode 2.0.28 `run --format
// json` emits only `step_start` and `text` and then exits 0, so no terminal
// event ever reaches OpenClaw. These checks pin that only proven completion
// produces a result, and that aborted, interrupted, errored, truncated and empty
// turns can never be recorded as a successful reply.
test('a manager result event is produced only from a proven completed turn',()=>{
  const done={error:undefined,finish:'stop',completedAt:1792180879869,text:'OK'};
  assert.deepEqual(managerTerminalResult({exitCode:0,interrupted:false,aborted:false,finalMessage:done}),
   {type:'result',subtype:'success',is_error:false,result:'OK'});
  assert.deepEqual(managerTerminalResult({exitCode:0,interrupted:false,aborted:false,finalMessage:{...done,text:'  OK  '}}).result,'OK');
  // Cancellation and interruption never look successful, even with a clean exit.
  assert.throws(()=>managerTerminalResult({exitCode:0,interrupted:true,aborted:false,finalMessage:done}),/interrupted/);
  assert.throws(()=>managerTerminalResult({exitCode:0,interrupted:false,aborted:true,finalMessage:done}),/interrupted/);
  assert.throws(()=>managerTerminalResult({exitCode:1,interrupted:false,aborted:false,finalMessage:done}),/interrupted/);
  assert.throws(()=>managerTerminalResult({exitCode:null,interrupted:false,aborted:false,finalMessage:done}),/interrupted/);
  // No assistant message, an unfinished message, or a normal stop that said
  // nothing: text alone is never success.
  assert.throws(()=>managerTerminalResult({exitCode:0,interrupted:false,aborted:false,finalMessage:null}),/no assistant message/);
  assert.throws(()=>managerTerminalResult({exitCode:0,interrupted:false,aborted:false,finalMessage:{...done,completedAt:undefined}}),/never completed/);
  assert.throws(()=>managerTerminalResult({exitCode:0,interrupted:false,aborted:false,finalMessage:{...done,text:'   '}}),/without a reply/);
  for(const finish of ['abort','aborted','error','error_max_turns','cancelled','interrupted','max_tokens_error'])
    assert.throws(()=>managerTerminalResult({exitCode:0,interrupted:false,aborted:false,finalMessage:{...done,finish}}),/stopped abnormally/);
  assert.throws(()=>managerTerminalResult({exitCode:0,interrupted:false,aborted:false,finalMessage:{...done,finish:undefined}}),/stopped abnormally/);
  // A provider failure keeps the safe classification and leaks no provider body.
  assert.throws(()=>managerTerminalResult({exitCode:0,interrupted:false,aborted:false,finalMessage:{...done,error:{type:'provider.auth',status:403,message:'secret',response:{body:'secret'}}}}),/provider authorization denied \(HTTP 403\)/);
  try{managerTerminalResult({exitCode:0,interrupted:false,aborted:false,finalMessage:{...done,error:{message:'secret'}}});assert.fail('expected throw');}
  catch(e){assert.doesNotMatch(e.message,/secret/);}
});
test('the manager flow emits exactly one terminal result and only after the exit check',async()=>{
  const source=await fs.readFile('plugins/jarvis/opencode-gui.ts','utf8');
  assert.match(source,/if\(manager\)yield managerTerminalResult\(/,'the manager path must report a terminal result');
  assert.match(source,/interrupted,aborted:run\.abortSignal\?\.aborted===true/,'abort and timeout state must reach the terminal proof');
  assert.ok(source.indexOf('if(await exited!==0')<source.indexOf('yield managerTerminalResult('),'the terminal result must come after the exit-code check');
  assert.doesNotMatch(source,/yield\s*\{[^}]*subtype:'success'[^}]*\}\s*;?\s*$/m,'success must be derived, never constructed inline');
});

test('default manager files are host mediated and cannot select a native task tool',()=>{
 const backend=buildGuiBackend(true);
 assert.equal(backend.toolAvailabilityEnforcement,'execution-args');
 assert.deepEqual(backend.hostOwnedTools,['read','write','edit']);
 assert.deepEqual(managerExecutionArgs({baseArgs:['run'],toolAvailability:{native:[],openClaw:['read']}}),['run','--agent','jarvis-manager']);
 assert.throws(()=>managerExecutionArgs({baseArgs:['run'],toolAvailability:{native:['read'],openClaw:[]}}),/OpenClaw bridge/);
 assert.throws(()=>managerExecutionArgs({baseArgs:['run','--agent','build']}),/Ambiguous/);
});

test('bridge catalog fails closed before inference and newest-first API preserves the final reply',async()=>{
 let tools=[];
 const withSchema=name=>({name,inputSchema:{type:'object',properties:{path:{type:'string'}},required:['path']}});
 const messages=[{type:'idle'},{type:'assistant',time:{created:20,completed:21},finish:'stop',content:[{type:'text',text:'readback'}]},{type:'assistant',time:{created:10,completed:11},finish:'tool-calls',content:[{type:'tool',name:'read'}]}];
 const server=createServer((req,res)=>{res.setHeader('content-type','application/json');res.end(JSON.stringify(req.method==='POST'?{result:{tools:tools.map(withSchema)}}:{data:messages}));});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const url=`http://127.0.0.1:${server.address().port}/mcp`,bridge={url,headers:{},type:'remote',enabled:true};
 try{
  await assert.rejects(()=>managerBridgeTools(bridge),/missing admitted tools/);
  tools=['read','write'];
  const catalog=await managerBridgeTools(bridge);
  assert.deepEqual(catalog.names,tools);
  // Names alone are not proof; the schema summary is reported for every tool.
  assert.deepEqual(catalog.schemaSummary.read,{properties:['path'],required:['path']});
  await assert.rejects(()=>managerBridgeTools(bridge,['edit']),/missing admitted tools/);
  assert.deepEqual((await managerBridgeTools(bridge,['read'])).names,tools);
  const final=await readFinalAssistantMessage({url,headers:{}},'session');
  assert.equal(managerTerminalResult({exitCode:0,interrupted:false,aborted:false,finalMessage:final}).result,'readback');
 }finally{await new Promise(resolve=>server.close(resolve));}
});

// Measured 16 Ekim on OpenCode 2.0.28: a run directory is registered lazily. The
// first probe of a fresh scratch directory answers with an empty agent list and
// no MCP server, and only a later probe shows jarvis-manager plus the bridge.
// `managerBridgeTools` only proves the OpenClaw catalog, so this check proves the
// OpenCode side too. "connected", an empty list and a tool count are all refused.
test('the manager waits for the OpenCode registry and never asks the model without it',async()=>{
 const goodPermissions=[{action:'*',resource:'*',effect:'allow'},{action:'write',resource:'*',effect:'allow'},{action:'shell',resource:'*',effect:'allow'},{action:'*',resource:'*',effect:'deny'},{action:'openclaw_*',resource:'*',effect:'allow'},{action:'read',resource:MANAGER_READ_PROBE_PATH,effect:'allow'}];
 const ready={agents:{data:[{id:'build'},{id:'jarvis-manager',permissions:goodPermissions}]},servers:{data:[{name:'openclaw',status:{status:'connected'}}]}};
 // Authority is read as last-match-wins, exactly like OpenCode resolves it.
 assert.equal(effectivePermission(goodPermissions,'write'),'deny');
 assert.equal(effectivePermission(goodPermissions,'shell'),'deny');
 assert.equal(effectivePermission(goodPermissions,'openclaw_write'),'allow');
 assert.equal(effectivePermission(goodPermissions,'read',MANAGER_READ_PROBE_PATH),'allow');
 assert.equal(effectivePermission(goodPermissions,'read',MANAGER_REGISTRY_SAMPLE_PATH),'deny');
 assert.ok(managerRegistryAuthority(goodPermissions));
 assert.ok(!managerRegistryAuthority(undefined));
 assert.ok(!managerRegistryAuthority([{action:'*',resource:'*',effect:'allow'}]),'an allow-all registry is not this run authority');
 assert.ok(!managerRegistryAuthority([{action:'*',resource:'*',effect:'deny'}]),'a deny-all registry does not allow the host bridge');

 // Registration is delayed: the turn waits instead of starting, and the model
 // request is only reached after the registry is proven.
 let modelRequested=false;
 let probes=0;
 const delayed=async p=>p.startsWith('/api/agent')?{data:probes++===0?[]:[{id:'jarvis-manager',permissions:goodPermissions}]}:{data:probes<2?[]:[{name:'openclaw',status:{status:'pending'}}]};
 const ready0=await managerWorkerRegistryReady({probe:delayed,directory:'C:\\scratch',agent:'jarvis-manager',server:'openclaw',deadlineAt:Date.now()+5000,sleep:async()=>{assert.equal(modelRequested,false,'the model request must not start while the registry is pending');}});
 assert.equal(ready0.agent,'jarvis-manager');
 assert.equal(ready0.server,'openclaw');
 assert.ok(ready0.probes>=2,'an empty first list must be waited out, not accepted');
 modelRequested=true;

 // A deadline stops the turn before any model request instead of a fixed wait.
 let clock=Date.now();
 await assert.rejects(()=>managerWorkerRegistryReady({
  probe:async()=>({data:[]}),directory:'C:\\scratch',agent:'jarvis-manager',server:'openclaw',
  deadlineAt:clock+3,sleep:async()=>{clock+=1000;}}),
 /registry not ready \(deadline reached after \d+ probes\); inference blocked before the model request/);

 // Cancellation stops it the same way.
 const controller=new AbortController();
 const cancelled=managerWorkerRegistryReady({
  probe:async()=>({data:[]}),directory:'C:\\scratch',agent:'jarvis-manager',server:'openclaw',
  deadlineAt:Date.now()+60000,signal:controller.signal,sleep:async()=>{controller.abort();}});
 await assert.rejects(()=>cancelled,/cancelled before the model request/);

 // Losing current task authority also stops the probe loop.
 await assert.rejects(()=>managerWorkerRegistryReady({
  probe:async()=>{throw new Error('superseded');},directory:'C:\\scratch',agent:'jarvis-manager',server:'openclaw',
  deadlineAt:Date.now()+60000,assertCurrent:()=>{throw new Error('run superseded');}}),/run superseded/);

 // An empty list, a missing server, or a registry whose authority is wrong are
 // all refused even though a "connected" status is present.
 for(const body of [{agents:{data:[]},servers:{data:[{name:'openclaw',status:{status:'connected'}}]}},{agents:ready.agents,servers:{data:[]}},{agents:{data:[{id:'jarvis-manager',permissions:[{action:'*',resource:'*',effect:'allow'}]}]},servers:{data:[{name:'openclaw',status:{status:'connected'}}]}}]){
  clock=Date.now();
  await assert.rejects(()=>managerWorkerRegistryReady({
   probe:async p=>p.startsWith('/api/agent')?body.agents:body.servers,directory:'C:\\scratch',agent:'jarvis-manager',server:'openclaw',
   deadlineAt:clock+2,sleep:async()=>{clock+=1000;}}),/registry not ready/);
 }

 // The real execute path runs this before the worker process is spawned.
 const source=await fs.readFile('plugins/jarvis/opencode-gui.ts','utf8');
 assert.ok(source.indexOf('await managerWorkerRegistryReady(')<source.indexOf('const child=spawn('),'registry readiness must precede the model request');
 assert.match(source,/deadlineAt:Date\.now\(\)\+Math\.max\(1000,Math\.min\(20000,run\.timeoutMs-1000\)\)/,'the wait must be bounded by the turn budget, not a fixed sleep');
 assert.match(source,/signal:run\.abortSignal,assertCurrent:run\.assertCurrent/,'the wait must follow cancellation and current task authority');
});
