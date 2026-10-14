import fs from 'node:fs';
import path from 'node:path';
import {spawn,execFileSync} from 'node:child_process';
import {randomBytes} from 'node:crypto';
import {fileURLToPath} from 'node:url';
export const profileRoot=()=>path.join(process.env.USERPROFILE,'.openclaw-jarvis','opencode');
export function cleanWorkerEnv(source,root) {
 const env={};
 for(const name of ['SystemRoot','WINDIR','ComSpec','PATH','PATHEXT','TEMP','TMP','NUMBER_OF_PROCESSORS','PROCESSOR_ARCHITECTURE','PROCESSOR_IDENTIFIER']) {const value=Object.entries(source).find(([key])=>key.toLowerCase()===name.toLowerCase())?.[1];if(value)env[name]=value;}
 Object.assign(env,{USERPROFILE:path.join(root,'home'),HOME:path.join(root,'home'),APPDATA:path.join(root,'appdata'),LOCALAPPDATA:path.join(root,'localappdata'),XDG_CONFIG_HOME:path.join(root,'config'),XDG_DATA_HOME:path.join(root,'data'),XDG_CACHE_HOME:path.join(root,'cache'),XDG_STATE_HOME:path.join(root,'state'),OPENCODE_CONFIG:path.join(root,'config','opencode','opencode.json'),OPENCODE_DB:path.join(root,'data','opencode','opencode.db')});
 if(source.OPENCODE_API_KEY)env.OPENCODE_API_KEY=source.OPENCODE_API_KEY;
 return env;
}
export function shellWorkerEnv(source,root){return {...cleanWorkerEnv(source,root),OPENCODE_API_KEY:'',OPENCODE_SERVER_PASSWORD:'',OPENCODE_SERVER_USERNAME:''};}
export function workerConfig() {
 return {$schema:'https://opencode.ai/config.json',model:'opencode/space-bunny-free',update:'disable',share:'disabled',snapshots:true,formatter:false,lsp:false,
 permissions:[...['read','edit','shell','glob','grep','external_directory','webfetch','question'].map(action=>({action,resource:'*',effect:'allow'})),{action:'subagent',resource:'*',effect:'deny'}],
 policies:[{action:'provider.use',resource:'*',effect:'deny'},{action:'provider.use',resource:'opencode',effect:'allow'},{action:'plugin.use',resource:'*',effect:'deny'}]};
}
export function profileConnection(root=profileRoot()) {
 const s=JSON.parse(fs.readFileSync(path.join(root,'server.json'),'utf8'));
 if(s.version!=='2.0.28'||s.fullAccess!==true||!path.isAbsolute(s.binary)||typeof s.password!=='string'||s.password.length<24||s.url!=='http://127.0.0.1:18791/')throw new Error('Verified private OpenCode profile required');
 return {...s,root,headers:{Authorization:'Basic '+Buffer.from('opencode:'+s.password).toString('base64')}};
}
export function prepareProfile(binary,root=profileRoot()) {
 if(execFileSync(binary,['--version'],{encoding:'utf8',windowsHide:true}).trim()!=='opencode v2.0.28')throw new Error('Pinned native OpenCode 2.0.28 required');
 const env=cleanWorkerEnv(process.env,root);
 for(const p of Object.values(env).filter(v=>v.startsWith(root)&&!path.extname(v)))fs.mkdirSync(p,{recursive:true});
 fs.mkdirSync(path.dirname(env.OPENCODE_CONFIG),{recursive:true}); fs.mkdirSync(path.dirname(env.OPENCODE_DB),{recursive:true});
 const file=path.join(root,'server.json');
 const old=fs.existsSync(file)?profileConnection(root):undefined;
 const s={version:'2.0.28',binary:path.resolve(binary),url:'http://127.0.0.1:18791/',password:old?.password??randomBytes(32).toString('base64'),fullAccess:true};
 fs.writeFileSync(file,JSON.stringify(s,null,2)+'\n',{mode:0o600});
 fs.writeFileSync(env.OPENCODE_CONFIG,JSON.stringify(workerConfig(),null,2)+'\n');
 return s;
}
async function main() {
 const action=process.argv[2],root=profileRoot();
 if(action==='prepare') {if(!process.argv.includes('--full-access'))throw new Error('Explicit Full access selection required');prepareProfile(process.argv[3]);console.log('Private OpenCode 2.0.28 profile prepared. No credentials copied; full access is not OS isolation.');}
 else if(action==='serve') {
 const s=profileConnection(root),env=cleanWorkerEnv(process.env,root);env.OPENCODE_SERVER_PASSWORD=s.password;
 if(!env.OPENCODE_API_KEY)throw new Error('OPENCODE_API_KEY unavailable; no credential fallback');
 const child=spawn(s.binary,['serve','--hostname','127.0.0.1','--port','18791'],{cwd:root,env,stdio:'inherit',windowsHide:true});
 fs.writeFileSync(path.join(root,'server.json'),JSON.stringify({...s,headers:undefined,root:undefined,pid:child.pid},null,2)+'\n',{mode:0o600});
 child.on('error',e=>{console.error('Private OpenCode server failed: '+e.message);process.exitCode=1;}); child.on('close',code=>{process.exitCode=code??1;});
 } else if(action==='status') {
 const {OpenCode}=await import('@opencode/client'),s=profileConnection(root),c=OpenCode.make({baseUrl:s.url,headers:s.headers});
 const info=await c.server.info({signal:AbortSignal.timeout(10000)});
 if(info.version!==s.version||info.pid!==s.pid)throw new Error('Private server identity changed');
 console.log(JSON.stringify({version:info.version,pid:info.pid,authenticated:true,loopback:true,fullAccess:true,profile:root}));
 } else throw new Error('Use prepare <binary> --full-access, serve or status');
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))void main().catch(e=>{console.error(e.message);process.exitCode=1;});
