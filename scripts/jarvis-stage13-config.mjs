import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {configureManager,profileRoot} from './jarvis-opencode-profile.mjs';
export function applyDecisions(c){
 if(!c.agents?.entries?.main?.tools?.allow)throw new Error('Existing JARVIS main tool policy required');
 const tools=c.agents.entries.main.tools;
 tools.allow=[...new Set([...tools.allow,'jarvis_send'])];
 if(c.tools?.allow)c.tools.allow=[...new Set([...c.tools.allow,'jarvis_send'])];
 return c;
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const file=path.join(process.env.USERPROFILE,'.openclaw-jarvis','openclaw.json'),old=fs.readFileSync(file,'utf8');
 const result=JSON.stringify(applyDecisions(JSON.parse(old)),null,2)+'\n';
 const backup=path.join(path.dirname(file),'openclaw.before-stage13.json');if(!fs.existsSync(backup))fs.writeFileSync(backup,old,{flag:'wx'});
 fs.writeFileSync(file,result);configureManager(profileRoot());
 console.log('Stage13 native connector catalog and normal manager policy prepared. Existing Full access coding permissions retained. No service restarted.');
}
