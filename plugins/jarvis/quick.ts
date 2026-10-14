import fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { safePath, within, fingerprint, type Scope } from './policy.ts';
import { QUICK_TOOLS, quickParams, operationHash } from './quick-policy.ts';

let native = fileURLToPath(new URL('../../native/windows/', import.meta.url));
export function configureNativeRoot(root: unknown) {
  if(typeof root!=='string' || !/^[a-z]:[\\/]/i.test(root) || /[\x00-\x1f]/.test(root))throw new Error('Host-configured absolute native root required');
  native=path.resolve(root);
  python=resolveDocumentPython();
}
// Host paths are fixed; the caller never chooses interpreter/helper/config/argv.
const pwsh = path.join(process.env.ProgramFiles ?? 'C:\\Program Files', 'PowerShell/7/pwsh.exe');
function resolveDocumentPython() {
  const local=path.resolve(native,'../../.venv/Scripts/python.exe');
  return existsSync(local) ? local : path.join(process.env.USERPROFILE ?? '', '.cache/codex-runtimes/codex-primary-runtime/dependencies/python/python.exe');
}
let python = resolveDocumentPython();
export const documentPythonPath = () => python;
const windowsPowerShell = path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32/WindowsPowerShell/v1.0/powershell.exe');
export async function localCall(helper: 'actions' | 'recycle' | 'document' | 'activity', params: Record<string, unknown>, signal?: AbortSignal) {
  const ocr = helper === 'document' && params.kind === 'ocr';
  const exe = ocr ? windowsPowerShell : helper === 'document' ? python : pwsh;
  await fs.access(exe);
  const argv = helper === 'document' && !ocr ? ['-I', path.join(native, 'document.py')] : ['-NoLogo', '-NoProfile', '-NonInteractive', '-STA', '-File', path.join(native, `${ocr ? 'ocr' : helper}.ps1`)];
  return await new Promise<Record<string, unknown>>((resolve, reject) => {
    const child = spawn(exe, argv, { windowsHide: true, shell: false, stdio: ['pipe','pipe','pipe'], signal });
    let output = '', stderr = '', timedOut = false, overflow=false;
    // Timeout affects only this owned helper, never an app/window target. No replay.
    const timer = setTimeout(() => { timedOut = true; child.kill(); }, 30000);
    child.stdout.setEncoding('utf8'); child.stderr.setEncoding('utf8');
    child.stdout.on('data', chunk => { output = (output + chunk).slice(0,100001); if (output.length > 100000) {overflow=true;child.kill();} });
    child.stderr.on('data', chunk => { stderr = (stderr + chunk).slice(0,512); });
    child.on('error', e => { clearTimeout(timer); reject(e); });
    child.on('close', code => {
      clearTimeout(timer);
      if (timedOut) return reject(new Error('Helper outcome unknown after timeout; inspect, never replay automatically'));
      if(overflow)return reject(new Error('Helper output exceeded budget; effect unknown, no automatic replay'));
      let result: Record<string,unknown>;
      try { result = JSON.parse(output); }
      catch (e) { return reject(new Error(`Local ${helper} invalid response; helper=${argv.at(-1)}; exit=${code}; ${output.slice(0,180)}; ${stderr}`,{cause:e})); }
      if(code!==0 || result.error)return reject(new Error(String(result.error ?? stderr ?? 'Helper failed').slice(0,512)));
      resolve(result);
    });
    child.stdin.end(JSON.stringify(params));
  });
}
export async function treeSafe(target: string, root: string) {
  const pending = [target]; let count = 0;
  while (pending.length) {
    const current = await safePath(pending.pop());
    if (!within(root,current) || ++count > 10000) throw new Error('Recycle inspection scope/budget exceeded');
    const s = await fs.lstat(current);
    if (s.isDirectory()) for (const e of await fs.readdir(current)) pending.push(path.join(current,e));
  }
}
export async function preserveFile(target: string, scope: Scope) {
  target=await safePath(target);
  // Revisions stay with project output; runtime instruction/control paths cannot be written.
  const directory=await safePath(path.join(path.dirname(target), '.jarvis-undo'),true);
  await fs.mkdir(directory,{recursive:true});
  let content: Buffer | undefined;
  try { content=await fs.readFile(target); } catch(e) {if((e as NodeJS.ErrnoException).code!=='ENOENT')throw e;}
  if (content && content.length>25*1024*1024) throw new Error('Undo budget exceeded; write refused');
  const id=fingerprint({target,run:scope.runId,at:Date.now(),before:content?.toString('base64')});
  const backup=path.join(directory,`${id}.json`);
  await fs.writeFile(backup,JSON.stringify({target,existed:content!==undefined,before:content?.toString('base64'),taskId:scope.taskId}),{flag:'wx'});
  return {backup,existed:content!==undefined};
}
export function createQuickTools(getScope: () => {scope: Scope; assertCurrent: () => void; signal: AbortSignal}, assertCurrent: () => void) {
  const schemas: Record<string, Record<string, unknown>> = {
    jarvis_windows: {action:{type:'string',enum:['resolve','open','status','focus','minimize','restore','close','audio_status','volume','mute','media','power_status','power']},app:{type:'string',enum:['notepad','calculator','paint']},value:{},window:{type:'object',properties:{pid:{type:'integer'},started:{type:'string'},exe:{type:'string'},hwnd:{type:'string'}},required:['pid','started','exe','hwnd'],additionalProperties:false}},
    jarvis_recycle:{path:{type:'string'}},
    jarvis_document:{path:{type:'string'},kind:{type:'string',enum:['text','pdf','office','image','ocr']}},
    jarvis_draft:{path:{type:'string'},content:{type:'string',maxLength:100000},show:{type:'boolean'}}
  };
  return QUICK_TOOLS.map(name => ({name,label:name,description:'Exact operator-admitted local operation; no model call or general executable. Read windows status, select current PID/start/exe/HWND; clarify multiple windows with user. Close only requests WM_CLOSE, never save/discard. Documents use local readers; image OCR uses installed Windows languages, unsupported formats are explicit blockers. Draft is a scoped plain .txt file; show opens Notepad only on admitted request.',parameters:{type:'object' as const,properties:schemas[name],required:name==='jarvis_windows'?['action']:name==='jarvis_document'?['path','kind']:name==='jarvis_draft'?['path','content']:['path'],additionalProperties:false},async execute(_callId:string,args:Record<string,unknown>) {
    const binding=getScope(), p=quickParams(name,args), scope=binding.scope;
    const current=()=>{assertCurrent();binding.assertCurrent();if(binding.signal.aborted||scope.expiresAt<=Date.now())throw new Error('Task expired');};
    current(); let details: Record<string,unknown>;
    const repeatable=name==='jarvis_document' || name==='jarvis_windows' && ['resolve','status','audio_status','power_status'].includes(String(p.action));
    if(!scope.quick?.some(g=>g.tool===name && operationHash(g.params)===operationHash(p)))throw new Error('Exact operation grant missing/consumed');
    if(!repeatable) scope.quick=scope.quick.filter(g=>g.tool!==name || operationHash(g.params)!==operationHash(p));
    if(name==='jarvis_windows') details=await localCall('actions',p,binding.signal);
    else {
      const target=await safePath(p.path); if(!scope.root||!within(scope.root,target)||target.toLowerCase()===scope.root.toLowerCase())throw new Error('File scope required');
      current();
      if(name==='jarvis_recycle'){await treeSafe(target,scope.root);current();details=await localCall('recycle',{path:target,root:scope.root},binding.signal);}
      else if(name==='jarvis_document')details=await localCall('document',{...p,path:target},binding.signal);
      else {
        const undo=await preserveFile(target,scope); current(); await safePath(target);
        await fs.writeFile(target,String(p.content));
        const confirmed=(await fs.readFile(target,'utf8'))===p.content;
        details={path:target,confirmed,undo};
        if(p.show){current();details.notepad=await localCall('actions',{action:'open',app:'notepad',notePath:target},binding.signal);}
      }
    }
    current(); return {content:[{type:'text' as const,text:JSON.stringify(details)}],details};
  }}));
}
