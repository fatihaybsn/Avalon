import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';
import {adaptTalkSource} from '../native/openclaw/talk-browser-adapter.mjs';
const repo=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const source=path.join(repo,'tmp/openclaw-stage14-source');
const lf=s=>s.replace(/\r\n/g,'\n');
const read=p=>lf(fs.readFileSync(p,'utf8'));
const write=(p,s)=>{fs.mkdirSync(path.dirname(p),{recursive:true});fs.writeFileSync(p,s);};
const replace=(s,a,b)=>{if(!s.includes(a))throw new Error('Pinned native UI contract changed: '+a.slice(0,70));return s.replace(a,b);};
for(const name of ['session.ts','shared.ts','google-live.ts','google-live-tools.ts']){
  const relative='ui/src/pages/chat/talk/'+name,p=path.join(source,relative);
  const original=read(path.join(repo,'apps/desktop/vendor/talk/sources',relative));
  const prepared=adaptTalkSource(relative,original,true),current=read(p);
  if(current!==original&&current!==prepared)throw new Error('Unrecognized native browser edit: '+relative);
  write(p,prepared);
}
for(const name of ['voice-decisions.ts','browser-talk-owner.ts','host-context.ts','chat-task.ts','contracts.ts','voice.ts'])write(path.join(source,'ui/src/lib/jarvis',name),read(path.join(repo,'apps/desktop/src/shared',name)));
const realtime=path.join(source,'ui/src/pages/chat/chat-realtime.ts');let live=read(realtime);
if(!live.includes('jarvisLocalVoiceAction')){
 live=replace(live,'    state.realtimeTalkUseSystemDefault = null;\n    if (!canStart()) {','    const jarvisLocalVoiceAction=globalThis.isSecureContext&&navigator.userActivation?.isActive===true;\n    state.realtimeTalkUseSystemDefault = null;\n    if (!canStart()) {');
 live=replace(live,'      { inputDeviceId, videoDeviceId },','      { inputDeviceId, videoDeviceId, localStartGesture:jarvisLocalVoiceAction },');
 write(realtime,live);
}
const gateway=path.join(source,'ui/src/api/gateway.ts');let g=read(gateway);
if(!g.includes('sendBrowserChat')){
 g='import {sendBrowserChat} from "../lib/jarvis/chat-task.ts";\n'+g;
 g=replace(g,'    return this.chatEvents.request<T>(this.client, method, params, options);',`    if(method==="chat.send" && params && typeof params==="object" && "sessionKey" in params && typeof params.sessionKey==="string" && params.sessionKey.startsWith("agent:main:"))return sendBrowserChat(this,params as Record<string,unknown>) as Promise<T>;
    return this.chatEvents.request<T>(this.client, method, params, options);`);
 write(gateway,g);
}
// Native history/receipt reconciliation remains; automatic JARVIS outbox sends do not.
const drain=path.join(source,'ui/src/pages/chat/chat-outbox-drain.ts');let d=read(drain);
const needle=') {\n  const client = host.client;\n  if (!host.connected || !client) {';
const method=d.indexOf('export async function resumeStoredChatOutboxes(');
if(method<0)throw new Error('Missing native reconnect outbox owner');
if(!d.slice(method,method+550).includes('JARVIS reconnect'))d=d.slice(0,method)+replace(d.slice(method),needle,') {\n  // JARVIS reconnect reads native receipts/history; it never resends prior inputs.\n  if(host.sessionKey.startsWith("agent:main:"))return;\n  const client = host.client;\n  if (!host.connected || !client) {');
write(drain,d);
const retry=path.join(source,'ui/src/pages/chat/chat-outbox-retry.ts');let r=read(retry);
if(!r.includes('JARVIS ambiguous writes'))r=replace(r,'): void {\n  const client = host.client;','): void {\n  // JARVIS ambiguous writes require a fresh user request, not a timer retry.\n  if(host.sessionKey.startsWith("agent:main:"))return;\n  const client = host.client;');
write(retry,r);
const request=path.join(source,'ui/src/pages/chat/chat-send-request.ts');let q=read(request);
if(!q.includes('!sessionKey.startsWith("agent:main:")'))q=replace(q,'const controlUiReconnectResume = Boolean(','const controlUiReconnectResume = !sessionKey.startsWith("agent:main:") && Boolean(');
write(request,q);
console.log('Stage15 native browser uses shared Talk adaptation, decisions and task binding. Automatic JARVIS outbox replay disabled; no service/model/route started.');
if(process.argv.includes('--export-patch')){
 const files=['src/gateway/server-methods/cron-caller-scope.ts','src/gateway/server-methods/cron.ts','src/plugin-sdk/gateway-method-runtime.ts','src/plugin-sdk/session-automation-runtime.ts','src/plugin-sdk/session-automation-runtime.test.ts','ui/src/api/gateway.ts','ui/src/pages/chat/chat-realtime.ts','ui/src/pages/chat/chat-outbox-drain.ts','ui/src/pages/chat/chat-outbox-retry.ts','ui/src/pages/chat/chat-send-request.ts',...['session.ts','shared.ts','google-live.ts','google-live-tools.ts'].map(n=>'ui/src/pages/chat/talk/'+n),...['voice-decisions.ts','browser-talk-owner.ts','host-context.ts','chat-task.ts','contracts.ts','voice.ts'].map(n=>'ui/src/lib/jarvis/'+n)];
 files.push('src/infra/agent-run-registry.types.ts','src/cron/isolated-agent/run.ts');
 const tracked=new Set(execFileSync('git',['ls-files','--',...files],{cwd:source,encoding:'utf8'}).trim().split('\n'));
 let patch=execFileSync('git',['diff','--binary','--',...files.filter(f=>tracked.has(f))],{cwd:source,encoding:'utf8',maxBuffer:4*1024*1024});
 for(const file of files.filter(f=>!tracked.has(f))){const content=read(path.join(source,file));const lines=content.replace(/\n$/,'').split('\n');patch+=`diff --git a/${file} b/${file}\nnew file mode 100644\n--- /dev/null\n+++ b/${file}\n@@ -0,0 +1,${lines.length} @@\n`+lines.map(l=>'+'+l+'\n').join('');}
 write(path.join(repo,'native/openclaw-v2026.10.2-stage15.patch'),patch);
 console.log('Versioned stage15 overlay patch exported; apply after the stage14 source patch.');
}
