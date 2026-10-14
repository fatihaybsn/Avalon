import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const repo=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
export function applyQuick(config) {
  config.plugins.entries.jarvis.config={nativeRoot:path.join(repo,'native','windows')};
  for(const tools of [config.tools,config.agents.entries.main.tools]) tools.allow=[...new Set([...tools.allow,'jarvis_windows','jarvis_recycle','jarvis_document','jarvis_draft','browser'])];
  config.tools.deny=config.tools.deny.filter(t=>t!=='browser');
  config.plugins.allow=[...new Set([...config.plugins.allow,'browser'])];
  config.plugins.entries.browser={enabled:true};
  config.browser={enabled:true,evaluateEnabled:false,allowSystemProfileImport:false,defaultProfile:'jarvis-visible',headless:false,noSandbox:false,attachOnly:false,ssrfPolicy:{dangerouslyAllowPrivateNetwork:false,allowRfc2544BenchmarkRange:false,allowIpv6UniqueLocalRange:false},profiles:{'jarvis-visible':{cdpPort:18810,headless:false},'jarvis-background':{cdpPort:18811,headless:true}}};
  return config;
}
export function assertQuick(config) {
  const expected=applyQuick(structuredClone(config));
  assert.deepEqual(config.browser,expected.browser,'Managed JARVIS browser policy differs');
  assert.deepEqual(config.plugins.entries.jarvis.config,expected.plugins.entries.jarvis.config,'Fixed host native root differs');
  assert.deepEqual(config.plugins.entries.browser,{enabled:true});
  assert.equal(process.env.OPENCLAW_BROWSER_HEADLESS,undefined,'Environment must not silently override visible browser profile');
}
if(process.argv[1] && path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  const f=path.join(process.env.USERPROFILE,'.openclaw-jarvis/openclaw.json'),before=fs.readFileSync(f,'utf8');
  if(process.argv.includes('--check')){assertQuick(JSON.parse(before));console.log('Stage07 managed browser settings OK; live readiness must be tested separately.');}
  else {const backup=path.join(path.dirname(f),'openclaw.before-stage07.json');if(!fs.existsSync(backup))fs.writeFileSync(backup,before,{flag:'wx'});fs.writeFileSync(f,JSON.stringify(applyQuick(JSON.parse(before)),null,2)+'\n');console.log('Stage07 applied; providers/credentials preserved. Restart Gateway to load.');}
}
