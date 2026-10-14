import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {createInterface} from 'node:readline';
import type {OpenClawPluginApi} from 'openclaw/plugin-sdk/plugin-entry';
import {nativeExecutable,workerService} from './opencode-memory.ts';
import {GUI_ROLE} from './gui-policy.ts';

type Backend=Parameters<OpenClawPluginApi['registerCliBackend']>[0];
export const GUI_RUNTIME='jarvis-opencode-gui';

export function hostMcpConfig(input:unknown,env:Record<string,string>) {
 const value=input as {mcpServers?:Record<string,{url?:string;headers?:Record<string,string>}>};
 if(!value?.mcpServers||Object.keys(value.mcpServers).length!==1||!value.mcpServers.openclaw)throw new Error('Only the existing OpenClaw host-owned MCP bridge is admitted');
 const server=value.mcpServers.openclaw;
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

// Use OpenCode's normal config and tool behavior. The selected OpenClaw MCP
// endpoint is the only bridge added for this run; OpenClaw checks every call.
export function openCodeGuiConfig(bridge:ReturnType<typeof hostMcpConfig>) {
 return {$schema:'https://opencode.ai/config.json',mcp:{openclaw:bridge}};
}

export function parseGuiEvent(line:string) {
 let event:any;try{event=JSON.parse(line)}catch{return null;}
 if(event.type==='text'&&typeof event.part?.text==='string')return {kind:'text' as const,text:event.part.text};
 if(event.type==='error')return {kind:'result' as const,errorText:'OpenCode GUI inference failed; inspect before retry'};
 return null;
}

export function buildGuiBackend():Backend {
 return {id:GUI_RUNTIME,modelProvider:'opencode',nativeToolMode:'selectable',hostOwnedTools:['read','write','edit','computer','browser'],bundleMcp:true,bundleMcpMode:'claude-config-file',autoSelectAuthProfile:false,toolAvailabilityEnforcement:'prepare-execution',
  config:{command:'opencode',args:['run','--format','json','--model','opencode/space-bunny-free'],input:'stdin',output:'jsonl',sessionMode:'none',imageArg:'--file',imageMode:'repeat',serialize:true,reseedFromRawTranscriptWhenUncompacted:false},
  normalizeConfig:config=>({...config,command:nativeExecutable()}),resolveModelId:({modelId})=>{if(modelId!=='space-bunny-free')throw new Error('GUI worker only admits Space Bunny Free');return modelId;},parseJsonlEvent:parseGuiEvent,
  async prepareExecution(ctx) {
   if(ctx.modelId!=='space-bunny-free'||!ctx.toolAvailability?.openClaw?.length)throw new Error('Space Bunny Free and an existing OpenClaw host tool are required');
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
     const {url,headers,service}=workerService();
     const response=await fetch(new URL('/api/info',url),{headers,redirect:'error',signal:AbortSignal.timeout(10000)});
     if(!response.ok)throw new Error('Existing OpenCode service unavailable; no fallback');
     const identity=await response.json() as {version:string;pid:number};
     if(identity.version!=='2.0.28'||identity.pid!==service.pid)throw new Error('OpenCode worker version/identity changed');
     const index=run.args.indexOf('--mcp-config');
     if(index<0||!run.args[index+1]||run.args.lastIndexOf('--mcp-config')!==index)throw new Error('Native OpenClaw MCP configuration unavailable');
     const bridge=hostMcpConfig(JSON.parse(await fs.readFile(run.args[index+1],'utf8')),run.env);
     if(!run.toolAvailability?.openClaw?.length)throw new Error('OpenClaw host tool selection unavailable');
     await fs.writeFile(configPath,JSON.stringify(openCodeGuiConfig(bridge)));
     const environment:NodeJS.ProcessEnv={...run.env,OPENCODE_CONFIG:configPath};
     delete environment.OPENCLAW_MCP_TOKEN;delete environment.OPENCLAW_MCP_CLI_CAPTURE_KEY;
     const prompt=[GUI_ROLE,run.promptContext?.prependContext,run.promptContext?.appendContext,`Current authorized request:\n${run.prompt}`].filter(Boolean).join('\n\n');
     await run.liveSession?.restart();run.assertCurrent?.();run.abortSignal?.throwIfAborted();
     const args=['run','--format','json','--model','opencode/space-bunny-free','--title','JARVIS scoped GUI'];
     for(let i=0;i<run.args.length;i++)if(run.args[i]==='--file'){const file=run.args[++i];if(!file||!path.isAbsolute(file))throw new Error('Native staged image path required');args.push('--file',file);}
     const child=spawn(run.command,args,{cwd:scratch,env:environment,windowsHide:true,stdio:['pipe','pipe','pipe']});child.stderr.resume();
     const exited=new Promise<number|null>((resolve,reject)=>{child.once('error',reject);child.once('close',resolve)});
     const stop=()=>child.kill();const timer=setTimeout(stop,run.timeoutMs);run.abortSignal?.addEventListener('abort',stop,{once:true});
     try {
      child.stdin.end(prompt);
      for await(const line of createInterface({input:child.stdout})){
       if(line.length>2000000)throw new Error('Oversized OpenCode event');
       const event=JSON.parse(line);
       if(event.type==='error'){
        const diagnostic=JSON.stringify(event.error??{message:'no provider diagnostic'}).replaceAll(run.env.OPENCLAW_MCP_TOKEN??'\u0000','[redacted]').replaceAll(run.env.OPENCLAW_MCP_CLI_CAPTURE_KEY??'\u0000','[redacted]').replaceAll(service.password,'[redacted]').slice(0,800);
        throw new Error('OpenCode GUI inference failed; inspect before retry: '+diagnostic);
       }
       yield event;
      }
      if(await exited!==0||run.abortSignal?.aborted)throw new Error('GUI worker interrupted; effects may be uncertain, no blind retry');
     } finally{clearTimeout(timer);run.abortSignal?.removeEventListener('abort',stop);if(child.exitCode===null)stop();await exited.catch(()=>{});}
    }
   };
  }
 };
}
