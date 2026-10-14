// Explicit live proof; only the generated image leaves this machine.
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import assert from 'node:assert/strict';
import {randomInt} from 'node:crypto';
import {execFile,spawn} from 'node:child_process';
import {promisify} from 'node:util';
import {nativeExecutable,workerService} from '../plugins/jarvis/opencode-memory.ts';
const execute=promisify(execFile),exe=nativeExecutable();
const {url,headers,service}=workerService();
const identity=await (await fetch(new URL('/api/info',url),{headers,signal:AbortSignal.timeout(10000)})).json();
assert.equal(identity.version,'2.0.28');assert.equal(identity.pid,service.pid);
const scratch=await fs.mkdtemp(path.join(os.tmpdir(),'jarvis-stage08-image-'));
await fs.mkdir(path.join(scratch,'guard'));
await fs.copyFile('plugins/jarvis/opencode-guard.mjs',path.join(scratch,'guard/index.js'));
await fs.writeFile(path.join(scratch,'guard/package.json'),JSON.stringify({type:'module',exports:'./index.js'}));
await fs.writeFile(path.join(scratch,'opencode.json'),JSON.stringify({plugins:['./guard'],share:'disabled',update:'disable',snapshots:false,compaction:{auto:false}}));
const code=String(randomInt(100000,999999)),image=path.join(scratch,'probe.png');
await execute('pwsh',['-NoProfile','-File',path.resolve('tests/gui-image.ps1'),'-Path',image,'-Code',code],{windowsHide:true});
await execute(exe,['session','list','--format','json','--max-count','1'],{cwd:scratch,windowsHide:true,timeout:20000,maxBuffer:65536});
const guardDeadline=Date.now()+15000;
while(true){try {assert.equal(await fs.readFile(path.join(scratch,'guard-ready'),'utf8'),'jarvis.memory-worker-guard/v1');break;}catch(error){if(Date.now()>guardDeadline)throw error;await new Promise(r=>setTimeout(r,100));}}
const child=spawn(exe,['run','--format','json','--model','opencode/space-bunny-free','--file',image,'--title','JARVIS stage08 synthetic vision proof'],{cwd:scratch,windowsHide:true,stdio:['pipe','pipe','pipe']});
let raw='',errors='';child.stdout.on('data',b=>raw+=b);child.stderr.on('data',b=>errors+=b);
child.stdin.end('Read the six-digit number printed in the attached image. Reply only with that number. Do not call any tools.');
const timer=setTimeout(()=>child.kill(),90000);
try {
 const exit=await new Promise((resolve,reject)=>{child.once('error',reject);child.once('close',resolve)});
 const events=raw.split(/\r?\n/).filter(Boolean).map(line=>JSON.parse(line));
 assert.equal(exit,0,'Live image call interrupted; inspect its own session before retry');
 assert.equal(events.some(e=>e.type==='error'||e.type==='tool_use'),false,'Provider error/native tool attempt; no fallback');
 const reply=events.filter(e=>e.type==='text').map(e=>e.part?.text??'').join('').trim();
 const receipt={version:identity.version,model:'opencode/space-bunny-free',syntheticOnly:true,expected:code,reply,matched:reply===code,sessionIds:[...new Set(events.map(e=>e.sessionID).filter(Boolean))]};
 await fs.mkdir('tmp',{recursive:true});await fs.writeFile('tmp/stage08-image-proof.json',JSON.stringify(receipt,null,2)+'\n');
 console.log(JSON.stringify(receipt));assert.equal(reply,code,'Image was not correctly read; multimodal catalog is not live evidence');
} finally {clearTimeout(timer);}
