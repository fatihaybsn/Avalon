import fs from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import type {OpenClawPluginApi} from 'openclaw/plugin-sdk/plugin-entry';
// Deterministic invocation of the same installed native reader tool. It gets
// only the explicit public query and stage-03 web policy, never a conversation.
export async function shortResearch(api:OpenClawPluginApi,query:string,signal:AbortSignal){
  signal.throwIfAborted();
  if(!/^tvly-\S+$/.test(process.env.TAVILY_API_KEY??''))throw new Error('Tavily unavailable; no provider fallback');
  const dir=path.join(process.env.USERPROFILE??'','.openclaw-jarvis/npm/projects');
  const matches=fs.readdirSync(dir,{withFileTypes:true}).filter(e=>e.isDirectory()&&e.name.startsWith('openclaw-tavily-plugin-')).map(e=>path.join(dir,e.name,'node_modules/@openclaw/tavily-plugin')).filter(d=>fs.existsSync(path.join(d,'package.json')));
  const selected=matches.filter(d=>{const p=JSON.parse(fs.readFileSync(path.join(d,'package.json'),'utf8'));return p.name==='@openclaw/tavily-plugin'&&p.version==='2026.10.2';});
  if(selected.length!==1)throw new Error('Exactly one pinned native Tavily required');
  const pkg=JSON.parse(fs.readFileSync(path.join(selected[0],'package.json'),'utf8'));
  const vendor=(await import(pathToFileURL(path.join(selected[0],pkg.openclaw.runtimeExtensions[0])).href)).default;
  const reader=api.config.agents?.entries?.research;
  if(!reader||reader.contextInjection!=='never'||reader.skills?.length||reader.subagents?.allowAgents?.length)throw new Error('Stage-03 isolated reader profile required');
  const config={agents:{entries:{research:reader}},tools:{web:api.config.tools?.web},plugins:{entries:{tavily:api.config.plugins?.entries?.tavily}}};
  let factory:any;
  vendor.register({config,registerTool(fn:any,opts:any){if(opts.name==='tavily_search')factory=fn;},registerWebSearchProvider(){}});
  if(!factory)throw new Error('Native Advanced search unavailable');
  signal.throwIfAborted();
  const result=await factory({config}).execute('live-reader',{query,search_depth:'advanced',max_results:5,topic:'general',include_answer:false},signal);
  signal.throwIfAborted();return result;
}
