// Live benchmark of the existing MCP executor. No UI actions are implemented
// here: all app input stays in the user's selected Jev Windows agent.
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const output = process.argv[2] || 'C:\\Users\\Fatih\\Desktop\\jev-speed-01.txt';
const expected = 'Hermes hız testi 01.';
if (fs.existsSync(output)) throw Error('Benchmark refuses to overwrite an existing file.');
const client = new Client({ name: 'jarvis-live-pc-speed', version: '1' });
const transport = new StdioClientTransport({ command: process.execPath, args: [path.join(root, 'mcp.mjs')], stderr: 'pipe' });
const decode = result => { if(result.isError) throw Error(result.content[0].text); return JSON.parse(result.content[0].text); };
const clock = () => performance.now();
let hostMs=0, hostCalls=0, runId=null, folder=null, savedMs=null, start;
const exact = () => fs.existsSync(output) && fs.readFileSync(output).equals(Buffer.from(expected, 'utf8'));
const record = { output, expected, baselineReplayed:false, qwenCalls:0, host:'bounded deterministic supplied-text/file verification host; not Qwen', stages:[] };
try {
  await client.connect(transport);
  const windows = decode(await client.callTool({ name:'typesafe_windows', arguments:{} }));
  const candidates=windows.filter(w=>/^Adsız\b/u.test(w.title) && /Not Defteri|Notepad/i.test(w.title));
  if(candidates.length!==1) throw Error('Expected one newly prepared untitled Notepad window.');
  const title=candidates[0].title;
  record.windowTitle=title;
  console.log(JSON.stringify({event:'started',title,output}));
  start=clock();
  const monitor=setInterval(()=>{if(savedMs===null && exact())savedMs=clock()-start;},50);
  try {
    let state=decode(await client.callTool({name:'typesafe_run',arguments:{
      goal:`In this new Notepad window, type exactly ${JSON.stringify(expected)} with no newline. Then use Save (Ctrl+S) and the Save As dialog to save it as ${JSON.stringify(output)}. Save only this new file. Do not open any browser. Stop when the file is saved.`,
      windowTitle:title,act:true,steps:20,timeoutSeconds:120,waitForEvent:true,
    }},undefined,{timeout:130000}));
    runId=state.runId; folder=state.runFolder;
    while(state.status==='needs_host') {
      const begun=clock(); hostCalls++;
      const req=state.request, props=req.properties, field=req.packet?.focused_field;
      record.stages.push({elapsed_ms:clock()-start,properties:Object.keys(props),field});
      let reply;
      if('fill' in props) {
        if(field?.role==='AXTextArea') reply={fill:true,text:expected,reason:'Exact supplied benchmark text.'};
        else if(/dosya.*adı|file.?name|filename/i.test((field?.label||'')+' '+(field?.placeholder||''))) reply={fill:true,text:output,reason:'Exact new benchmark output path.'};
        else throw Error('Unrecognized host text target: '+JSON.stringify(field));
      } else if('achieved' in props) {
        reply={achieved:exact(),answer:exact()?'The new file matches the exact requested UTF-8 bytes.':'The requested exact file is not present.'};
      } else throw Error('Unexpected host schema; no guessing.');
      hostMs+=clock()-begun;
      console.log(JSON.stringify({event:'host_reply',elapsed_ms:clock()-start,field,properties:Object.keys(props),verified:reply.achieved}));
      state=decode(await client.callTool({name:'typesafe_respond',arguments:{runId,requestId:req.id,reply,waitForEvent:true}},undefined,{timeout:130000}));
    }
    record.status=state.status;record.report=state.report;
    record.total_ms=clock()-start;record.saved_ms=savedMs ?? (exact()?record.total_ms:null);
    record.host_ms=hostMs;record.host_calls=hostCalls;record.exact_file_match=exact();record.runFolder=folder;
    console.log(JSON.stringify({event:'finished',...record}));
  } finally { clearInterval(monitor); }
} catch(error) {
  record.error=error.message;
  if(start)record.total_ms=clock()-start;
  if(runId)await client.callTool({name:'typesafe_stop',arguments:{runId}},undefined,{timeout:10000}).catch(()=>{});
  console.log(JSON.stringify({event:'failed',...record}));
} finally {
  await client.close();
  fs.writeFileSync(path.join(root,'..','jev-pc-speed-'+path.basename(output,'.txt')+'.json'),JSON.stringify(record,null,2));
}
