// End-to-end OpenCode worker proof using its ordinary MCP config path.
// The only exposed host tool is a synthetic, read-only image observation.
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import {randomInt,randomBytes} from 'node:crypto';
import assert from 'node:assert/strict';
import {execFile,spawn} from 'node:child_process';
import {promisify} from 'node:util';
import {Server} from '@modelcontextprotocol/sdk/server/index.js';
import {StreamableHTTPServerTransport} from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import {CallToolRequestSchema,ListToolsRequestSchema} from '@modelcontextprotocol/sdk/types.js';
import {nativeExecutable,workerService} from '../plugins/jarvis/opencode-memory.ts';

const execute=promisify(execFile),scratch=await fs.mkdtemp(path.join(os.tmpdir(),'jarvis-stage08-opencode-direct-'));
const code=String(randomInt(100000,999999)),image=path.join(scratch,'probe.png');
const token=randomBytes(24).toString('hex'),capture=randomBytes(24).toString('hex');
await execute('pwsh',['-NoProfile','-File',path.resolve('tests/gui-image.ps1'),'-Path',image,'-Code',code],{windowsHide:true});

const {url:serviceUrl,headers:serviceHeaders,service}=workerService();
const identity=await (await fetch(new URL('/api/info',serviceUrl),{headers:serviceHeaders,redirect:'error',signal:AbortSignal.timeout(10000)})).json();
assert.equal(identity.version,'2.0.28');assert.equal(identity.pid,service.pid);

let calls=0,authFailures=0;const connections=[];
const httpServer=http.createServer(async(req,res)=>{
 if(req.headers.authorization!=='Bearer '+token||req.headers['x-openclaw-cli-capture-key']!==capture){authFailures++;res.writeHead(403);res.end();return;}
 const mcp=new Server({name:'stage08-synthetic-host',version:'0.1.0'},{capabilities:{tools:{}}});
 mcp.setRequestHandler(ListToolsRequestSchema,async()=>({tools:[{name:'computer',description:'Read the synthetic test picture. This tool is read-only and has no desktop side effect.',inputSchema:{type:'object',properties:{},additionalProperties:false}}]}));
 mcp.setRequestHandler(CallToolRequestSchema,async(request)=>{assert.equal(request.params.name,'computer');calls++;if(calls>1)throw new Error('One synthetic observation only');return {content:[{type:'image',mimeType:'image/png',data:(await fs.readFile(image)).toString('base64')}]};});
 const transport=new StreamableHTTPServerTransport({sessionIdGenerator:undefined});connections.push({mcp,transport});await mcp.connect(transport);
 try{let body;if(req.method==='POST'){let text='';for await(const chunk of req)text+=chunk;body=JSON.parse(text);}await transport.handleRequest(req,res,body);}catch{if(!res.headersSent){res.writeHead(500);res.end();}}
});

let child;
try{
 await new Promise(r=>httpServer.listen(0,'127.0.0.1',r));
 const port=httpServer.address().port,config=path.join(scratch,'opencode.json');
 // OpenCode expects each named remote MCP server directly under `mcp`.
 // No custom plugin, blanket tool denial, `--auto`, or provider fallback.
 await fs.writeFile(config,JSON.stringify({$schema:'https://opencode.ai/config.json',mcp:{openclaw:{type:'remote',url:`http://127.0.0.1:${port}/mcp`,enabled:true,headers:{Authorization:`Bearer ${token}`,'x-openclaw-cli-capture-key':capture},timeout:70000}}}));
 const env={...process.env,OPENCODE_CONFIG:config};
 const exe=nativeExecutable();
 const raw=[],stderr=[];
 child=spawn(exe,['run','--format','json','--model','opencode/space-bunny-free','--title','JARVIS stage08 direct worker proof'],{cwd:scratch,env,windowsHide:true,stdio:['pipe','pipe','pipe']});
 child.stdout.on('data',b=>raw.push(b.toString()));child.stderr.on('data',b=>stderr.push(b.toString()));
 const exitPromise=new Promise((resolve,reject)=>{child.once('error',reject);child.once('close',resolve)});
 const timer=setTimeout(()=>child.kill(),90000);
 child.stdin.end('This is a test of the ordinary OpenCode worker path. Use the openclaw_computer tool exactly once to read the six-digit number in its synthetic picture, then reply with only that number. Do not perform any file or desktop action.');
 const exit=await exitPromise;clearTimeout(timer);
 const events=raw.join('').split(/\r?\n/).filter(Boolean).map(line=>JSON.parse(line));
 const reply=events.filter(e=>e.type==='text').map(e=>e.part?.text??'').join('').trim();
 const toolEvents=events.filter(e=>e.type==='tool_use').map(e=>String(e.part?.tool??''));
 const errors=events.filter(e=>e.type==='error').map(e=>JSON.stringify(e.error??{}).replaceAll(token,'[redacted]').replaceAll(capture,'[redacted]').replaceAll(service.password,'[redacted]').slice(0,500));
 const receipt={version:identity.version,model:'opencode/space-bunny-free',ordinaryWorkerPath:true,customPlugin:false,blanketToolDeny:false,hostToolCalled:calls===1,hostCalls:calls,hostAuthFailures:authFailures,toolEvents,exit,reply,expected:code,matched:exit===0&&calls===1&&reply===code,errors,stderr:stderr.join('').replaceAll(token,'[redacted]').replaceAll(capture,'[redacted]').replaceAll(service.password,'[redacted]').slice(0,1000)};
 await fs.mkdir('tmp',{recursive:true});await fs.writeFile('tmp/stage08-opencode-direct-proof.json',JSON.stringify(receipt,null,2)+'\n');
 console.log(JSON.stringify(receipt));
 assert.equal(exit,0,'OpenCode worker exited unsuccessfully');assert.equal(authFailures,0,'Synthetic host rejected OpenCode credentials');assert.equal(calls,1,'OpenCode did not call the synthetic host tool exactly once');assert.equal(reply,code,'Space Bunny did not read the returned synthetic image');
}finally{
 if(child&&child.exitCode===null){child.kill();await new Promise(r=>child.once('close',r));}
 for(const connection of connections)await connection.mcp.close();
 await new Promise(r=>httpServer.close(r));
 await fs.rm(scratch,{recursive:true,force:true,maxRetries:5,retryDelay:100});
}
