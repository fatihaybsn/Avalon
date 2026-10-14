// Live provider proof against a temporary synthetic host transport. No real GUI effects.
import fs from 'node:fs/promises';import path from 'node:path';import os from 'node:os';import http from 'node:http';import {randomInt,randomBytes} from 'node:crypto';import assert from 'node:assert/strict';import {execFile} from 'node:child_process';import {promisify} from 'node:util';
import {Server} from '@modelcontextprotocol/sdk/server/index.js';import {StreamableHTTPServerTransport} from '@modelcontextprotocol/sdk/server/streamableHttp.js';import {CallToolRequestSchema,ListToolsRequestSchema} from '@modelcontextprotocol/sdk/types.js';
import {buildGuiBackend} from '../plugins/jarvis/opencode-gui.ts';import {nativeExecutable} from '../plugins/jarvis/opencode-memory.ts';
const scratch=await fs.mkdtemp(path.join(os.tmpdir(),'jarvis-stage08-bridge-')),code=String(randomInt(100000,999999)),image=path.join(scratch,'probe.png');
await promisify(execFile)('pwsh',['-NoProfile','-File',path.resolve('tests/gui-image.ps1'),'-Path',image,'-Code',code],{windowsHide:true});
const data=(await fs.readFile(image)).toString('base64'),token=randomBytes(24).toString('hex'),capture=randomBytes(24).toString('hex');let calls=0,authFailures=0;const connections=[];
const httpServer=http.createServer(async(req,res)=>{
 if(req.headers.authorization!=='Bearer '+token||req.headers['x-openclaw-cli-capture-key']!==capture){authFailures++;res.writeHead(403);res.end();return;}
 const mcp=new Server({name:'stage08-synthetic-host',version:'0.1.0'},{capabilities:{tools:{}}});
 mcp.setRequestHandler(ListToolsRequestSchema,async()=>({tools:[{name:'computer',description:'Return the synthetic test picture. Use this tool once to inspect its six-digit number.',inputSchema:{type:'object',properties:{},additionalProperties:false}}]}));
 mcp.setRequestHandler(CallToolRequestSchema,async(request)=>{assert.equal(request.params.name,'computer');calls++;if(calls>1)throw new Error('One synthetic observation only');return {content:[{type:'image',mimeType:'image/png',data}]};});
 const transport=new StreamableHTTPServerTransport({sessionIdGenerator:undefined});connections.push({mcp,transport});await mcp.connect(transport);
 try{let body;if(req.method==='POST'){let text='';for await(const chunk of req)text+=chunk;body=JSON.parse(text);}await transport.handleRequest(req,res,body);}catch{if(!res.headersSent){res.writeHead(500);res.end();}}
});
await new Promise(r=>httpServer.listen(0,'127.0.0.1',r));const port=httpServer.address().port;
const config=path.join(scratch,'host.json');await fs.writeFile(config,JSON.stringify({mcpServers:{openclaw:{url:`http://127.0.0.1:${port}/mcp`,headers:{Authorization:'Bearer ${OPENCLAW_MCP_TOKEN}','x-openclaw-cli-capture-key':'${OPENCLAW_MCP_CLI_CAPTURE_KEY}'}}}}));
const backend=buildGuiBackend(),prepared=await backend.prepareExecution({workspaceDir:scratch,provider:'opencode',modelId:'space-bunny-free',toolAvailability:{native:[],openClaw:['computer']}});
let raw=[];
try{
 for await(const event of prepared.execute({command:nativeExecutable(),args:['run','--mcp-config',config],cwd:scratch,env:{...process.env,OPENCLAW_MCP_TOKEN:token,OPENCLAW_MCP_CLI_CAPTURE_KEY:capture},prompt:'Use the openclaw_computer tool exactly once to get the synthetic test picture. Read its six-digit number and answer only that number.',modelId:'space-bunny-free',systemPrompt:'Synthetic image transport test. Do not perform file or desktop actions.',useResume:false,timeoutMs:90000,toolAvailability:{native:[],openClaw:['computer']},assertCurrent:()=>{},requestToolPermission:async()=>({behavior:'deny',message:'No native tools'}),requestUserInput:async()=>({status:'cancelled',message:'No questions during this test'})}))raw.push(event);
 const reply=raw.filter(e=>e.type==='text').map(e=>e.part?.text??'').join('').trim();
 const lastSixDigitCode=(reply.match(/\b\d{6}\b/g)??[]).at(-1);
 const receipt={model:'opencode/space-bunny-free',syntheticOnly:true,ordinaryWorkerPath:true,customPlugin:false,blanketToolDeny:false,hostCalls:calls,hostAuthFailures:authFailures,imageAsMcpContent:true,expected:code,reply,lastSixDigitCode,matched:lastSixDigitCode===code};
 await fs.writeFile('tmp/stage08-bridge-proof.json',JSON.stringify(receipt,null,2)+'\n');console.log(JSON.stringify(receipt));assert.equal(calls,1);assert.equal(lastSixDigitCode,code);
}finally{await prepared.cleanup();for(const connection of connections)await connection.mcp.close();await new Promise(r=>httpServer.close(r));}
