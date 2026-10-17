import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
export function applyAutomations(c){
 if(c.plugins?.entries?.jarvis?.config?.nativeAutomations!==true)return c;
 // separateCodexTools already moved the global policy into each agent. Do not
 // recreate a global ['automations'] cap that intersects away main's file tools.
 for(const tools of [c.agents.entries.main.tools,...(Array.isArray(c.tools.allow)?[c.tools]:[])]){
  tools.allow=[...new Set([...(tools.allow??[]),'automations'])];
  // Only rewrite an existing deny list. Assigning undefined would create an own
  // key that JSON drops on write, so apply and check could never converge.
  if(Array.isArray(tools.deny))tools.deny=tools.deny.filter(t=>!['automations','cron'].includes(t));
 }
 return c;
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const file=path.join(process.env.USERPROFILE,'.openclaw-jarvis','openclaw.json'),old=fs.readFileSync(file,'utf8'),c=JSON.parse(old);
 c.plugins.entries.jarvis.config.nativeAutomations=true;
 const backup=path.join(path.dirname(file),'openclaw.before-stage15-automations.json');
 if(!fs.existsSync(backup))fs.writeFileSync(backup,old,{flag:'wx'});
 fs.writeFileSync(file,JSON.stringify(applyAutomations(c),null,2)+'\n');
 console.log('Native automations main task catalog enabled. No operator admin, new scheduler, job, model call or Gateway restart.');
}
