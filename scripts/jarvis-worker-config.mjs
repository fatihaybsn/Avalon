import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
export function applyWorkers(c) {
 c.plugins.entries.jarvis.config.openCodeFullAccess=true;
 c.agents.defaults.models??={};
 c.agents.defaults.models['opencode/space-bunny-free']={...c.agents.defaults.models['opencode/space-bunny-free'],agentRuntime:{id:'jarvis-opencode-main'}};
 for(const tools of [c.agents.entries.main.tools,...(c.tools.allow?[c.tools]:[])])tools.allow=[...new Set([...tools.allow,'jarvis_worker'])];
 return c;
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 if(!process.argv.includes('--full-access'))throw new Error('Explicit OpenCode Full access selection required');
 const file=path.join(process.env.USERPROFILE,'.openclaw-jarvis','openclaw.json'),old=fs.readFileSync(file,'utf8');
 const backup=path.join(path.dirname(file),'openclaw.before-stage10.json');if(!fs.existsSync(backup))fs.writeFileSync(backup,old,{flag:'wx'});
 fs.writeFileSync(file,JSON.stringify(applyWorkers(JSON.parse(old)),null,2)+'\n');console.log('Stage10 selected native worker tool and Space Bunny CLI route configured. No model/provider fallback.');
}
