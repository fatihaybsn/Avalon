import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
export const MCP_GUI_TOOLS=['ControlStatus','Snapshot','Screenshot','Click','Type','Scroll','Move','Shortcut','WaitFor','MultiEdit','MultiSelect'];
export function applyGui(config,nodeId=config.plugins?.entries?.jarvis?.config?.guiNode) {
 if(!nodeId)return config;
 if(!/^[a-f0-9]{64}$/.test(nodeId))throw new Error('Exact native node ID required');
 config.plugins.entries.jarvis.config={...config.plugins.entries.jarvis.config,guiNode:nodeId};
 config.plugins.allow=[...new Set([...config.plugins.allow,'cua-computer'])];
 // Leave cua-computer without explicit enablement on the Gateway: node-only fulfiller.
 delete config.plugins.entries['cua-computer'];
 for(const tools of [config.tools,config.agents.entries.main.tools])tools.allow=[...new Set([...tools.allow,'computer',...MCP_GUI_TOOLS.map(name=>'windows_gui__'+name)])];
 config.tools.deny=config.tools.deny.filter(name=>name!=='computer');
 config.gateway.nodes??={};config.gateway.nodes.pairing={...config.gateway.nodes.pairing,autoApproveLocal:false,sshVerify:false};
 config.gateway.nodes.commands??={};config.gateway.nodes.commands.deny=[...new Set([...(config.gateway.nodes.commands.deny??[]),...CLOSED_NODE_COMMANDS])];
 config.gateway.nodes.browser={mode:'manual',node:nodeId};
 config.mcp={...config.mcp,sessionIdleTtlMs:0,servers:{...config.mcp?.servers,windows_gui:{command:path.join(process.env.USERPROFILE,'.local/bin/uvx.exe'),args:['--offline','--from','windows-mcp==0.8.8','windows-mcp','serve','--transport','stdio','--tools',MCP_GUI_TOOLS.join(',')],env:{ANONYMIZED_TELEMETRY:'false'},toolFilter:{include:MCP_GUI_TOOLS},supportsParallelToolCalls:false,connectionTimeoutMs:15000,requestTimeoutMs:20000}}};
 return config;
}
export const CLOSED_NODE_COMMANDS=['system.run','system.run.prepare','system.which','system.execApprovals.get','system.execApprovals.set','codex.exec-server.stdio.v1','fs.listDir','terminal.upload','browser.proxy.upload.v1','mcp.tools.call.v1','desktop.stream'];
export function desktopNodeConfig(main) {
 return {gateway:{mode:'local',auth:{mode:'token',token:'${OPENCLAW_GATEWAY_TOKEN}'},nodes:{commands:{deny:CLOSED_NODE_COMMANDS}}},plugins:{allow:['cua-computer','browser'],entries:{'cua-computer':{enabled:true},browser:{enabled:true}}},update:{checkOnStart:false},tools:{exec:{security:'deny',ask:'always'},elevated:{enabled:false}},browser:structuredClone(main.browser),nodeHost:{autoUpdate:{enabled:false},browserProxy:{enabled:true,allowProfiles:['jarvis-visible','jarvis-background']}}};
}
if(process.argv[1] && path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
 if(process.argv.includes('--apply')){
  const mainPath=path.join(process.env.USERPROFILE,'.openclaw-jarvis/openclaw.json');
  const main=JSON.parse(fs.readFileSync(mainPath,'utf8'));const nodeId=process.argv[process.argv.indexOf('--apply')+1];
  const applied=applyGui(main,nodeId);
  fs.writeFileSync(mainPath,JSON.stringify(applied,null,2)+'\n');
  console.log('Stage08 node and pinned filtered MCP configured. GUI input and unverified OpenCode bridge stay closed; no model/runtime default changed.');
  process.exit(0);
 }
 if(!process.argv.includes('--prepare-node')&&!process.argv.includes('--pin-node'))throw new Error('Use --prepare-node, --pin-node or --apply <verified-node-id>');
 const dir=path.join(process.env.USERPROFILE,'.openclaw-jarvis-desktop');
 const main=JSON.parse(fs.readFileSync(path.join(process.env.USERPROFILE,'.openclaw-jarvis/openclaw.json'),'utf8'));
 const target=path.join(dir,'openclaw.json');fs.mkdirSync(dir,{recursive:true});
 if(process.argv.includes('--prepare-node')) {
  if(fs.existsSync(target))throw new Error('Existing native node configuration must be reviewed before replacing it');
  fs.writeFileSync(target,JSON.stringify(desktopNodeConfig(main),null,2)+'\n',{flag:'wx'});
 } else {
  const current=JSON.parse(fs.readFileSync(target,'utf8'));
  current.nodeHost.autoUpdate={enabled:false};current.update={checkOnStart:false};
  fs.writeFileSync(target,JSON.stringify(current,null,2)+'\n');
  const mainPath=path.join(process.env.USERPROFILE,'.openclaw-jarvis/openclaw.json');
  const backup=path.join(path.dirname(mainPath),'openclaw.before-stage08.json');
  if(!fs.existsSync(backup))fs.copyFileSync(mainPath,backup,fs.constants.COPYFILE_EXCL);
  main.gateway.nodes??={};main.gateway.nodes.pairing={...main.gateway.nodes.pairing,autoApproveLocal:false,sshVerify:false};
  main.gateway.nodes.commands??={};main.gateway.nodes.commands.deny=[...new Set([...(main.gateway.nodes.commands.deny??[]),...CLOSED_NODE_COMMANDS])];
  main.plugins.allow=[...new Set([...main.plugins.allow,'cua-computer'])]; // policy only; Gateway desktop remains off
  fs.writeFileSync(mainPath,JSON.stringify(main,null,2)+'\n');
 }
 console.log('Native node configuration prepared; no token copied, no service/WSL installed. Device and command surface pairing still required.');
}
