import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
export function applyMaintenance(c){
  const tools=c.agents?.entries?.main?.tools;
  if(!Array.isArray(tools?.allow))throw new Error('Existing JARVIS main tool policy required');
  tools.allow=[...new Set([...tools.allow,'jarvis_note_forget_preview','jarvis_note_forget'])];
  if(c.tools?.allow)c.tools.allow=[...new Set([...c.tools.allow,'jarvis_note_forget_preview','jarvis_note_forget'])];
  return c;
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const pkg=JSON.parse(fs.readFileSync(new URL('../node_modules/openclaw/package.json',import.meta.url),'utf8'));
  const required=['controlled-source-forget','hot-raw-retention','source-talk'];
  if(pkg.version!=='2026.10.2'||pkg.jarvisNative?.upstreamCommit!=='b8952d477f0c932d8ddc6da5c89cab5a169b6ff1'||required.some(x=>!pkg.jarvisNative.features?.includes(x)))throw new Error('Pinned source-built OpenClaw with stage14 features required; no silent upgrade');
  const file=path.join(process.env.USERPROFILE,'.openclaw-jarvis','openclaw.json'),old=fs.readFileSync(file,'utf8');
  const result=JSON.stringify(applyMaintenance(JSON.parse(old)),null,2)+'\n';
  const backup=path.join(path.dirname(file),'openclaw.before-stage14.json');
  if(!fs.existsSync(backup))fs.writeFileSync(backup,old,{flag:'wx'});
  if(result!==old)fs.writeFileSync(file,result);
  console.log('Stage14 selective-forget preview/apply tools configured. Existing approval and native source-build gates remain active; no records purged or service restarted.');
}
