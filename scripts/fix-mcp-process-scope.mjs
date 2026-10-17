import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

// Pinned OpenClaw 2026.10.2 runtime correction. No authority is retained,
// extended or bypassed: the process-owned listener must not inherit its first
// caller's request frame. Each HTTP request still uses its own minted grant.
export const originalMcpStartup='activeMcpLoopbackServerPromise = runOutsideOperatorToolGatewayAuthority(() => runOutsidePluginRuntimeGenerationScope(() => runOutsideGatewayRootWorkAdmission(() => work.run(() => startMcpLoopbackServer(port, work))))).then((close) => {';
export const correctedMcpStartup=`activeMcpLoopbackServerPromise = import("./gateway-request-scope-BSmCVVpP.mjs").then(({ a: getRequestScope, s: withGatewayContext }) =>
\t\t\twithGatewayContext(getRequestScope()?.resolveGatewayContext, () =>
\t\t\t\trunOutsideOperatorToolGatewayAuthority(() => runOutsidePluginRuntimeGenerationScope(() => runOutsideGatewayRootWorkAdmission(() => work.run(() => startMcpLoopbackServer(port, work))))),
\t\t\t{ inheritRequestScope: false })
\t\t).then((close) => {`;

export function patchMcpProcessScope(source){
 if(source.includes(correctedMcpStartup))return source;
 if(source.split(originalMcpStartup).length!==2)throw new Error('Pinned MCP startup contract changed; no patch applied');
 return source.replace(originalMcpStartup,correctedMcpStartup);
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
 const pkg=JSON.parse(await fs.readFile(path.join(root,'node_modules/openclaw/package.json'),'utf8'));
 if(pkg.version!=='2026.10.2')throw new Error('Pinned OpenClaw 2026.10.2 required');
 const target=path.join(root,'node_modules/openclaw/dist/mcp-http-DFNvcaPa.mjs');
 const source=await fs.readFile(target,'utf8');const patched=patchMcpProcessScope(source);
 if(patched!==source){
  await fs.writeFile(path.join(root,'tmp/mcp-http-before-process-scope.mjs'),source);
  await fs.writeFile(target,patched);
 }
 console.log('Pinned MCP process-scope correction present. A running module still needs explicit reload verification.');
}
