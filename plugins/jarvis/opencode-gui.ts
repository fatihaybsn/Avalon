import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {createInterface} from 'node:readline';
import type {OpenClawPluginApi} from 'openclaw/plugin-sdk/plugin-entry';
import {nativeExecutable,workerService} from './opencode-memory.ts';
import {GUI_ROLE} from './gui-policy.ts';
import {profileConnection,cleanWorkerEnv,shellWorkerEnv} from '../../scripts/jarvis-opencode-profile.mjs';
import {WORKER_GUIDANCE} from './worker-contract.ts';
import {OpenCode} from '@opencode/client';
import {MANAGER_PERMISSIONS,MANAGER_AGENT,assertManagerSession} from '../../scripts/manager-permissions.mjs';

type Backend=Parameters<OpenClawPluginApi['registerCliBackend']>[0];
export const GUI_RUNTIME='jarvis-opencode-gui';
export const MANAGER_BRIDGE_REVISION='scoped-files-v2-direct-catalog';
const MANAGER_AGENT_ARG='--agent';

// OpenClaw's default host-owned file projection requires an execution-args
// adapter. The selected agent is also checked on the real server session below;
// its exact permissions keep native file/shell access denied.
export const managerExecutionArgs:NonNullable<Backend['resolveExecutionArgs']>=ctx=>{
 if(ctx.toolAvailability?.native.length)throw new Error('Manager task tools must use the OpenClaw bridge');
 if(ctx.baseArgs.includes(MANAGER_AGENT_ARG))throw new Error('Ambiguous manager agent selection');
 return [...ctx.baseArgs,MANAGER_AGENT_ARG,'jarvis-manager'];
};

export async function managerBridgeTools(bridge:ReturnType<typeof hostMcpConfig>,expected?:readonly string[]) {
 const response=await fetch(bridge.url,{method:'POST',headers:{...bridge.headers,'Content-Type':'application/json',Accept:'application/json, text/event-stream'},body:JSON.stringify({jsonrpc:'2.0',id:'jarvis-tools',method:'tools/list',params:{}}),redirect:'error',signal:AbortSignal.timeout(10000)});
 if(!response.ok)throw new Error('OpenClaw manager bridge catalog unavailable');
 const body=await response.json() as {result?:{tools?:{name:string;inputSchema?:unknown}[]}};
 const tools=body.result?.tools;
 const names=tools?.map(tool=>tool.name);
 if(!names||(!expected&&(!names.includes('read')||!names.includes('write')))||expected?.some(name=>!names.includes(name)))throw new Error('OpenClaw manager bridge is missing admitted tools; inference blocked');
 // A name alone can be a stub. Every admitted tool must also publish a real
 // input schema, because the manager is told to call these with the schemas
 // from the active catalog. A tool count is never accepted as proof.
 const schemaSummary:Record<string,{properties:string[];required:string[]}>=Object.fromEntries((tools??[]).filter(tool=>names.includes(tool.name)).map(tool=>[tool.name,{properties:Object.keys(((tool.inputSchema as {properties?:object}|undefined)?.properties??{}) as object).sort(),required:[...((tool.inputSchema as {required?:unknown[]}|undefined)?.required??[])].map(String).sort()}]));
 if(names.some(name=>!schemaSummary[name].properties.length&&!schemaSummary[name].required.length))throw new Error('OpenClaw manager bridge tool has no usable schema; inference blocked');
 return {names,schemaSummary};
}

const glob=(value:string)=>new RegExp('^'+value.replace(/[.+^${}()|[\]\\]/g,'\\$&').replace(/\*/g,'.*')+'$','i');
export function effectivePermission(permissions:{action:string;resource:string;effect:string}[]|undefined,action:string,resource='*') {
 if(!Array.isArray(permissions))return undefined;
 let effect;
 for(const entry of permissions){
  if(!entry||typeof entry.action!=='string'||typeof entry.resource!=='string'||typeof entry.effect!=='string')continue;
  if(glob(entry.action).test(action)&&glob(entry.resource).test(resource))effect=entry.effect;
 }
 return effect;
}
export const MANAGER_REGISTRY_SAMPLE_PATH='C:\\jarvis-registry-sample\\not-the-probe.txt';
// Last match wins in OpenCode, so the run's authority is only intact when the
// resolved list still denies real file/shell work and allows the host bridge.
export function managerRegistryAuthority(permissions:{action:string;resource:string;effect:string}[]|undefined) {
 return permissions!==undefined
  &&effectivePermission(permissions,'write')==='deny'
  &&effectivePermission(permissions,'edit')==='deny'
  &&effectivePermission(permissions,'shell')==='deny'
  &&effectivePermission(permissions,'read',MANAGER_REGISTRY_SAMPLE_PATH)==='deny'
  &&effectivePermission(permissions,'openclaw_write')==='allow';
}
const abortAwareSleep=(ms:number,signal?:AbortSignal)=>new Promise<void>(resolve=>{
 const done=()=>{clearTimeout(timer);signal?.removeEventListener('abort',done);resolve();};
 const timer=setTimeout(done,ms);
 signal?.addEventListener('abort',done,{once:true});
});

// Readiness for the exact directory this turn uses. The host side already proved
// the OpenClaw catalog; this proves OpenCode itself registered the run: the
// jarvis-manager agent resolves for this directory with the expected effective
// authority, and the host bridge is registered for the same directory. Measured
// on 2.0.28, a fresh run directory answers the first probe with an empty agent
// list and no MCP server, so a single "connected" reading is not readiness.
// Every wait is bounded by the deadline, ends early on cancellation and
// re-checks current task authority, so a missing registry stops the turn before
// any model request is made.
export async function managerWorkerRegistryReady(input:{
 probe:(path:string)=>Promise<unknown>;
 directory:string;
 agent:string;
 server:string;
 deadlineAt:number;
 signal?:AbortSignal;
 assertCurrent?:()=>void;
 sleep?:(ms:number,signal?:AbortSignal)=>Promise<void>;
}) {
 const sleep=input.sleep??abortAwareSleep;
 const fail=(why:string)=>{throw new Error(`OpenCode manager registry not ready (${why}); inference blocked before the model request`);};
 const query=`location%5Bdirectory%5D=${encodeURIComponent(input.directory)}`;
 let probes=0;
 for(;;){
  input.assertCurrent?.();
  if(input.signal?.aborted)fail('cancelled before the model request');
  if(Date.now()>=input.deadlineAt)fail(`deadline reached after ${probes} probes`);
  const agentBody=await input.probe(`/api/agent?${query}`) as {data?:unknown}|null;
  const serverBody=await input.probe(`/api/mcp?${query}`) as {data?:unknown}|null;
  probes++;
  const agents=agentBody&&Array.isArray(agentBody.data)?agentBody.data as {id?:string;permissions?:unknown}[]:[];
  const servers=serverBody&&Array.isArray(serverBody.data)?serverBody.data as {name?:string;status?:{status?:string}}[]:[];
  const agent=agents.find(entry=>entry?.id===input.agent);
  const server=servers.find(entry=>entry?.name===input.server);
  if(agent&&server&&managerRegistryAuthority(agent.permissions as {action:string;resource:string;effect:string}[]|undefined))
   return {agent:input.agent,server:input.server,serverStatus:server.status?.status??'unknown',probes};
  await sleep(250,input.signal);
 }
}

export function hostMcpConfig(input:unknown,env:Record<string,string>) {
 const value=input as {mcpServers?:Record<string,{type?:string;alwaysLoad?:boolean;url?:string;headers?:Record<string,string>}>};
 if(!value?.mcpServers||!value.mcpServers.openclaw)throw new Error('Existing OpenClaw host-owned MCP bridge required');
 const server=value.mcpServers.openclaw;
 if(server.type!=='http'||server.alwaysLoad!==true)throw new Error('OpenClaw loopback MCP server schema changed');
 if(!/^http:\/\/127\.0\.0\.1:\d+\/mcp$/.test(server.url??''))throw new Error('Exact loopback OpenClaw MCP endpoint required');
 const headers=Object.fromEntries(Object.entries(server.headers??{}).map(([key,value])=>{
  if(!['Authorization','x-openclaw-cli-capture-key'].includes(key))throw new Error('Unknown bridge header');
  const expanded=value.replace(/\$\{(OPENCLAW_MCP_TOKEN|OPENCLAW_MCP_CLI_CAPTURE_KEY)\}/g,(_,name)=>env[name]??'');
  if(expanded.includes('${')||!expanded.trim())throw new Error('Run-bound OpenClaw MCP credentials unavailable');
  return [key,expanded];
 }));
 if(!headers.Authorization?.startsWith('Bearer ')||!headers['x-openclaw-cli-capture-key'])throw new Error('Run-bound MCP grant and capture required');
 // OpenCode 2 defaults MCP tools to Code Mode's `execute`, which the manager
 // correctly denies. Expose the existing host tools under openclaw_* instead.
 return {type:'remote' as const,url:server.url!,disabled:false,codemode:false,headers,timeout:{catalog:70000,execution:70000}};
}

// Scoped manager/GUI helpers use the host-bound MCP endpoint. This does not
// change native tools or Full access in explicitly selected coding sessions.
export function openCodeGuiConfig(bridge:ReturnType<typeof hostMcpConfig>) {
 // The legacy flat MCP config silently drops `codemode`; use the 2.x contract.
 return {$schema:'https://opencode.ai/config.json',mcp:{servers:{openclaw:bridge}},default_agent:'jarvis-manager',agents:{'jarvis-manager':{...MANAGER_AGENT,system:WORKER_GUIDANCE}}};
}

export function parseGuiEvent(line:string) {
 let event:any;try{event=JSON.parse(line)}catch{return null;}
 if(event.type==='text'&&typeof event.part?.text==='string')return {kind:'text' as const,text:event.part.text};
 if(event.type==='error')return {kind:'result' as const,errorText:'OpenCode GUI inference failed; inspect before retry'};
 return null;
}

// Keep actionable provider classification while discarding opaque provider
// messages, response bodies, credentials, and model reasoning from host logs.
export function safeManagerFailure(input:unknown) {
 const root=input&&typeof input==='object'?input as Record<string,any>:{};
 const data=root.data&&typeof root.data==='object'?root.data as Record<string,any>:{};
 const nested=data.error&&typeof data.error==='object'?data.error as Record<string,any>:{};
 const response=root.response&&typeof root.response==='object'?root.response as Record<string,any>:{};
 const nestedResponse=data.response&&typeof data.response==='object'?data.response as Record<string,any>:{};
 const type=[root.type,root.name,root.code,data.type,data.name,nested.type,nested.name].find(v=>typeof v==='string') as string|undefined;
 const status=[root.status,root.statusCode,data.status,data.statusCode,response.status,nestedResponse.status].find(v=>Number.isInteger(v)) as number|undefined;
 const normalized=type?.toLowerCase()??'';
 const category=normalized.includes('auth')||normalized.includes('unauthor')||status===401||status===403?'provider authorization denied'
  :normalized.includes('rate')||status===429?'provider rate limit'
  :status!==undefined&&status>=500?'provider service unavailable'
  :normalized.startsWith('provider.')?'provider request rejected':'manager worker execution failed';
 return `Space Bunny manager failed: ${category}${status===undefined?'':` (HTTP ${status})`}; no fallback or opaque provider dump`;
}

// A finish reason that means the model never completed its answer.
const ABNORMAL_FINISH=/abort|error|cancel|interrupt/i;
export type ManagerTurnProof={
  exitCode:number|null;
  interrupted:boolean;
  aborted:boolean;
  finalMessage:{error?:unknown;finish?:unknown;completedAt?:unknown;text:string}|null;
};

// OpenCode 2.0.28 `run --format json` emits no terminal event of its own.
// Measured on a real manager turn: the whole stream was `step_start`, one `text`
// part and exit 0 - no `step_finish`, no result. So this adapter is the only
// place that can tell OpenClaw how the turn really ended, and OpenClaw counts a
// turn without a `type:"result"` event as failed.
//
// Receiving text is therefore never success on its own. The result is built from
// proven completion only: the process exited cleanly, nothing interrupted it, and
// the worker's own session record shows a completed assistant message that
// stopped normally and actually said something. Aborted, timed out, interrupted,
// errored, truncated and empty turns throw instead, so an unfinished run can
// never be recorded as a successful reply.
export function managerTerminalResult(proof:ManagerTurnProof) {
  const interrupted='GUI worker interrupted; effects may be uncertain, no blind retry';
  if(proof.interrupted||proof.aborted)throw new Error(interrupted);
  if(proof.exitCode!==0)throw new Error(interrupted);
  const final=proof.finalMessage;
  if(!final)throw new Error('OpenCode worker left no assistant message; inference not proven');
  if(final.error)throw new Error(safeManagerFailure(final.error));
  if(typeof final.completedAt!=='number')throw new Error('OpenCode worker message never completed; inference not proven');
  if(typeof final.finish!=='string'||ABNORMAL_FINISH.test(final.finish))throw new Error(`OpenCode worker stopped abnormally (finish: ${String(final.finish??'none')}); inference not proven`);
  const result=final.text.trim();
  if(!result)throw new Error('OpenCode worker completed without a reply; inference not proven');
  return {type:'result' as const,subtype:'success',is_error:false,result};
}

// The worker session is the authority on whether a turn actually finished. Only
// the last assistant message counts, and only its plain text parts are answers;
// reasoning and provider payloads are never forwarded to host records.
export async function readFinalAssistantMessage(service:{url:string;headers:Record<string,string>},sessionID:string) {
  const response=await fetch(new URL(`/api/session/${encodeURIComponent(sessionID)}/message`,service.url),{headers:service.headers,redirect:'error',signal:AbortSignal.timeout(10000)});
  if(!response.ok)throw new Error('OpenCode worker session record unavailable; inference not proven');
  const body=await response.json() as {data?:unknown}|unknown[];
  const messages=Array.isArray(body)?body:(body as {data?:unknown}).data;
  if(!Array.isArray(messages))throw new Error('OpenCode worker session record schema changed; inference not proven');
  // The real 2.0.28 API returns newest first. Choose by creation time so an
  // earlier tool-call message cannot replace the final completed answer.
  const assistants=messages.filter(entry=>(entry as {type?:string}).type==='assistant').sort((a:any,b:any)=>(a.time?.created??0)-(b.time?.created??0));
  const last=assistants.at(-1) as {error?:unknown;finish?:unknown;time?:{completed?:unknown};content?:unknown}|undefined;
  if(!last)return null;
  const text=Array.isArray(last.content)?last.content.filter(part=>(part as {type?:string})?.type==='text').map(part=>String((part as {text?:unknown}).text??'')).join(''):'';
  return {error:last.error,finish:last.finish,completedAt:last.time?.completed,text};
}

export function buildGuiBackend(manager=false):Backend {
 // Manager rooted runs are instruction-isolated: every turn writes a fresh
// scratch opencode.json, runs with that config and a scratch cwd under
// cleanWorkerEnv, and receives only the host MCP bridge plus explicit session
// permissions. Ambient instruction files, skills, hooks, and plugins therefore
// never reach the run, so the host-prepared snapshot stays authoritative.
// Without this declaration rooted/cron runs stay unavailable.
return {id:manager?'jarvis-opencode-main':GUI_RUNTIME,modelProvider:'opencode',nativeToolMode:'selectable',...(manager?{isolatesInstructionsWithExactTools:true as const,resolveExecutionArgs:managerExecutionArgs}:{}),hostOwnedTools:manager?['read','write','edit']:['read','write','edit','computer','browser'],bundleMcp:true,bundleMcpMode:'claude-config-file',autoSelectAuthProfile:false,toolAvailabilityEnforcement:manager?'execution-args':'prepare-execution',
  config:{command:'opencode',args:['run','--format','json','--model','opencode/space-bunny-free'],input:'stdin',output:'jsonl',sessionMode:'none',imageArg:'--file',imageMode:'repeat',serialize:true,reseedFromRawTranscriptWhenUncompacted:false},
  normalizeConfig:config=>({...config,command:manager?profileConnection().binary:nativeExecutable()}),resolveModelId:({modelId})=>{if(modelId!=='space-bunny-free')throw new Error('GUI worker only admits Space Bunny Free');return modelId;},parseJsonlEvent:parseGuiEvent,
  async prepareExecution(ctx) {
   // The manager backend receives the existing, run-bound OpenClaw MCP
   // configuration from bundleMcp. OpenClaw may omit toolAvailability for
   // this CLI path, so requiring that optional metadata here blocks the
   // manager before the authenticated bridge can be validated. Keep the
   // stricter availability check for the standalone GUI worker.
   if(ctx.modelId!=='space-bunny-free'||(!manager&&!ctx.toolAvailability?.openClaw?.length))throw new Error('Space Bunny Free and an existing OpenClaw host tool are required');
   const scratch=await fs.mkdtemp(path.join(os.tmpdir(),'jarvis-gui-turn-'));
   const configPath=path.join(scratch,'opencode.json');
   return {toolAvailabilityEnforced:true,
    cleanup:async()=>{
     const target=path.resolve(scratch);
     if(path.dirname(target)!==path.resolve(os.tmpdir())||!path.basename(target).startsWith('jarvis-gui-turn-'))throw new Error('Unexpected GUI worker cleanup target');
     await fs.rm(target,{recursive:true,force:true,maxRetries:5,retryDelay:100});
    },
    execute:async function*(run) {
     run.assertCurrent?.();run.abortSignal?.throwIfAborted();
     if(manager&&(run.args.indexOf(MANAGER_AGENT_ARG)<0||run.args.indexOf(MANAGER_AGENT_ARG)!==run.args.lastIndexOf(MANAGER_AGENT_ARG)||run.args[run.args.indexOf(MANAGER_AGENT_ARG)+1]!=='jarvis-manager'))throw new Error('Host-owned manager agent argument unavailable');
     const s=manager?profileConnection():undefined;
     const {url,headers,service}=s?{url:new URL(s.url),headers:s.headers,service:s}:workerService();
     const response=await fetch(new URL('/api/info',url),{headers,redirect:'error',signal:AbortSignal.timeout(10000)});
     if(!response.ok)throw new Error('Existing OpenCode service unavailable; no fallback');
     const identity=await response.json() as {version:string;pid:number};
     if(identity.version!=='2.0.28'||identity.pid!==service.pid)throw new Error('OpenCode worker version/identity changed');
     const index=run.args.indexOf('--mcp-config');
     if(index<0||!run.args[index+1]||run.args.lastIndexOf('--mcp-config')!==index)throw new Error('Native OpenClaw MCP configuration unavailable');
     const bridge=hostMcpConfig(JSON.parse(await fs.readFile(run.args[index+1],'utf8')),run.env);
     if(!manager&&!run.toolAvailability?.openClaw?.length)throw new Error('OpenClaw host tool selection unavailable');
     const conf:any=openCodeGuiConfig(bridge);
     await fs.writeFile(configPath,JSON.stringify(conf));
     const environment:NodeJS.ProcessEnv={...(s?cleanWorkerEnv(run.env,s.root):run.env),OPENCODE_CONFIG:configPath};
     if(s)environment.OPENCODE_SERVER_PASSWORD=s.password;
     delete environment.OPENCLAW_MCP_TOKEN;delete environment.OPENCLAW_MCP_CLI_CAPTURE_KEY;
     const prompt=[manager?WORKER_GUIDANCE:GUI_ROLE,run.promptContext?.prependContext,run.promptContext?.appendContext,`Current authorized request:\n${run.prompt}`].filter(Boolean).join('\n\n');
     await run.liveSession?.restart();run.assertCurrent?.();run.abortSignal?.throwIfAborted();
     if(manager){const bridgeTools=await managerBridgeTools(bridge,run.toolAvailability?.openClaw);
     // Prove OpenCode registered this run before asking the model anything. The
     // wait is bounded by the remaining turn budget, ends early on cancellation
     // and rechecks current task authority on every probe.
     const registry=await managerWorkerRegistryReady({
      probe:async p=>{const r=await fetch(new URL(p,url),{headers,redirect:'error',signal:AbortSignal.timeout(10000)});if(!r.ok)return null;return r.json();},
      directory:scratch,agent:'jarvis-manager',server:'openclaw',
      deadlineAt:Date.now()+Math.max(1000,Math.min(20000,run.timeoutMs-1000)),
      signal:run.abortSignal,assertCurrent:run.assertCurrent});
     console.info(`[jarvis] manager bridge ${MANAGER_BRIDGE_REVISION}: tools=${bridgeTools.names.join(',')} registry=${registry.agent}/${registry.server}:${registry.serverStatus} probes=${registry.probes} schemas=${Object.entries(bridgeTools.schemaSummary).map(([n,s])=>`${n}(${s.properties.join('+')})`).join(' ')}`);}
     const args=['run','--format','json','--model',manager?'opencode/space-bunny-free#max':'opencode/space-bunny-free','--title','JARVIS scoped GUI'];
     const native=s?OpenCode.make({baseUrl:s.url,headers:s.headers}):undefined;
     // The connected server owns execution; CLI config alone is not proof.
      // Removed: an agent-level lookup here can never succeed. OpenCode 2.0.28 resolves a custom agent only for its own root directory, so it failed on every manager turn and blocked the backend before any inference. Authority is proven per run by assertManagerSession below. See tests/opencode-gui.test.mjs.
     const managerSession=native?await native.session.create({agent:'jarvis-manager',permissions:MANAGER_PERMISSIONS,model:{providerID:'opencode',id:'space-bunny-free',variant:'max'},location:{directory:scratch},title:'JARVIS task manager'}):undefined;
     if(native&&managerSession)assertManagerSession(await native.session.get({sessionID:managerSession.id}),managerSession.id);
     if(native&&managerSession&&s)await native.session.environment({sessionID:managerSession.id,variables:shellWorkerEnv(run.env,s.root)});
     if(s&&managerSession)args.push('--server',s.url,MANAGER_AGENT_ARG,run.args[run.args.indexOf(MANAGER_AGENT_ARG)+1],'--session',managerSession.id);
     for(let i=0;i<run.args.length;i++)if(run.args[i]==='--file'){const file=run.args[++i];if(!file||!path.isAbsolute(file))throw new Error('Native staged image path required');args.push('--file',file);}
     const child=spawn(run.command,args,{cwd:scratch,env:environment,windowsHide:true,stdio:['pipe','pipe','pipe']});child.stderr.resume();
     const exited=new Promise<number|null>((resolve,reject)=>{child.once('error',reject);child.once('close',resolve)});
      // Tracks abort and the run timeout. The timeout path interrupts the worker
      // but never sets abortSignal, so a stopped run can still exit 0; without
      // this flag that half-finished turn would look like a clean one.
      let interrupted=false;
     const stop=()=>{interrupted=true;if(native&&managerSession)void native.session.interrupt({sessionID:managerSession.id}).catch(()=>{});else child.kill();};const timer=setTimeout(stop,run.timeoutMs);run.abortSignal?.addEventListener('abort',stop,{once:true});
     try {
      child.stdin.end(prompt);
      for await(const line of createInterface({input:child.stdout})){
       if(line.length>2000000)throw new Error('Oversized OpenCode event');
       const event=JSON.parse(line);
       if(event.type==='error'){
        if(manager)throw new Error(safeManagerFailure(event.error));
        const diagnostic=JSON.stringify(event.error??{message:'no provider diagnostic'}).replaceAll(run.env.OPENCLAW_MCP_TOKEN??'\u0000','[redacted]').replaceAll(run.env.OPENCLAW_MCP_CLI_CAPTURE_KEY??'\u0000','[redacted]').replaceAll(service.password,'[redacted]').slice(0,800);
        throw new Error('OpenCode GUI inference failed; inspect before retry: '+diagnostic);
       }
       if(!manager||event.type==='text')yield event;
      }
      if(await exited!==0||run.abortSignal?.aborted)throw new Error('GUI worker interrupted; effects may be uncertain, no blind retry');
       // OpenClaw counts a turn as failed unless this stream carries one
       // `type:"result"` event, and OpenCode never emits one. Emit it only from
       // proven completion, never from the text alone.
       if(manager)yield managerTerminalResult({exitCode:await exited,interrupted,aborted:run.abortSignal?.aborted===true,finalMessage:s&&managerSession?await readFinalAssistantMessage(s,managerSession.id):null});
     } finally{clearTimeout(timer);run.abortSignal?.removeEventListener('abort',stop);if(child.exitCode===null)stop();await exited.catch(()=>{});}
    }
   };
  }
 };
}
