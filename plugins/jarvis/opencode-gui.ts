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
 return {type:'remote' as const,url:server.url!,enabled:true,headers,timeout:70000};
}

// Scoped manager/GUI helpers use the host-bound MCP endpoint. This does not
// change native tools or Full access in explicitly selected coding sessions.
export function openCodeGuiConfig(bridge:ReturnType<typeof hostMcpConfig>) {
 return {$schema:'https://opencode.ai/config.json',mcp:{openclaw:bridge},default_agent:'jarvis-manager',agents:{'jarvis-manager':{...MANAGER_AGENT,system:WORKER_GUIDANCE}}};
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

export function buildGuiBackend(manager=false):Backend {
 return {id:manager?'jarvis-opencode-main':GUI_RUNTIME,modelProvider:'opencode',nativeToolMode:'selectable',hostOwnedTools:manager?['read','write','edit','computer','browser','jarvis_worker','jarvis_send','jarvis_work_read','jarvis_work_note','jarvis_draft','jarvis_document','jarvis_windows','jarvis_recycle','jarvis_memory_search','jarvis_memory_get','jarvis_note_read','jarvis_note_write']:['read','write','edit','computer','browser'],bundleMcp:true,bundleMcpMode:'claude-config-file',autoSelectAuthProfile:false,toolAvailabilityEnforcement:'prepare-execution',
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
     const args=['run','--format','json','--model',manager?'opencode/space-bunny-free#max':'opencode/space-bunny-free','--title','JARVIS scoped GUI'];
     const native=s?OpenCode.make({baseUrl:s.url,headers:s.headers}):undefined;
     // The connected server owns execution; CLI config alone is not proof.
     if(native){const agent=await native.agent.get({agentID:'jarvis-manager',location:{directory:scratch}});if(JSON.stringify(agent.data.permissions.slice(-MANAGER_PERMISSIONS.length))!==JSON.stringify(MANAGER_PERMISSIONS))throw new Error('Server manager agent permissions unavailable; inference blocked');}
     const managerSession=native?await native.session.create({agent:'jarvis-manager',permissions:MANAGER_PERMISSIONS,model:{providerID:'opencode',id:'space-bunny-free',variant:'max'},location:{directory:scratch},title:'JARVIS task manager'}):undefined;
     if(native&&managerSession)assertManagerSession(await native.session.get({sessionID:managerSession.id}),managerSession.id);
     if(native&&managerSession&&s)await native.session.environment({sessionID:managerSession.id,variables:shellWorkerEnv(run.env,s.root)});
     if(s&&managerSession)args.push('--server',s.url,'--agent','jarvis-manager','--session',managerSession.id);
     for(let i=0;i<run.args.length;i++)if(run.args[i]==='--file'){const file=run.args[++i];if(!file||!path.isAbsolute(file))throw new Error('Native staged image path required');args.push('--file',file);}
     const child=spawn(run.command,args,{cwd:scratch,env:environment,windowsHide:true,stdio:['pipe','pipe','pipe']});child.stderr.resume();
     const exited=new Promise<number|null>((resolve,reject)=>{child.once('error',reject);child.once('close',resolve)});
     const stop=()=>{if(native&&managerSession)void native.session.interrupt({sessionID:managerSession.id}).catch(()=>{});else child.kill();};const timer=setTimeout(stop,run.timeoutMs);run.abortSignal?.addEventListener('abort',stop,{once:true});
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
     } finally{clearTimeout(timer);run.abortSignal?.removeEventListener('abort',stop);if(child.exitCode===null)stop();await exited.catch(()=>{});}
    }
   };
  }
 };
}
