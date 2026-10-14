import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs/promises';
import {hostMcpConfig,openCodeGuiConfig,buildGuiBackend,safeManagerFailure} from '../plugins/jarvis/opencode-gui.ts';
const env={OPENCLAW_MCP_TOKEN:'unit-token',OPENCLAW_MCP_CLI_CAPTURE_KEY:'unit-capture'};
const input={mcpServers:{openclaw:{type:'http',alwaysLoad:true,url:'http://127.0.0.1:1234/mcp',headers:{Authorization:'Bearer ${OPENCLAW_MCP_TOKEN}','x-openclaw-cli-capture-key':'${OPENCLAW_MCP_CLI_CAPTURE_KEY}'}}}};
test('ordinary OpenCode config keeps one run-bound OpenClaw MCP tool connection',()=>{
 const actual=hostMcpConfig(input,env);assert.equal(actual.headers.Authorization,'Bearer unit-token');assert.equal(actual.enabled,true);assert.equal(actual.type,'remote');
 const config=openCodeGuiConfig(actual);assert.equal(config.mcp.openclaw.type,'remote');assert.equal(config.mcp.openclaw.url,actual.url);assert.equal(config.mcp.servers,undefined);assert.equal(config.plugins,undefined);assert.equal(config.permission,undefined);
 assert.equal(config.default_agent,'jarvis-manager');assert.deepEqual(config.agents['jarvis-manager'].permissions,[{action:'*',resource:'*',effect:'deny'},{action:'openclaw_*',resource:'*',effect:'allow'}]);
 for(const url of ['https://evil.example/mcp','http://127.0.0.1:1234/other','http://localhost:1234/mcp'])assert.throws(()=>hostMcpConfig({mcpServers:{openclaw:{...input.mcpServers.openclaw,url}}},env));
 const merged=hostMcpConfig({...input,mcpServers:{...input.mcpServers,windows_gui:{type:'stdio',command:'uvx'}}},env);
 const isolated=openCodeGuiConfig(merged);assert.deepEqual(Object.keys(isolated.mcp),['openclaw']);assert.equal(isolated.mcp.windows_gui,undefined);
 assert.throws(()=>hostMcpConfig({mcpServers:{openclaw:{...input.mcpServers.openclaw,type:'stdio'}}},env));
 assert.throws(()=>hostMcpConfig(input,{}));
 const backend=buildGuiBackend();assert.equal(backend.modelProvider,'opencode');assert.equal(backend.config.imageArg,'--file');assert.equal(backend.nativeToolMode,'selectable');assert.throws(()=>backend.resolveModelId({modelId:'paid-model'}));
});
test('the GUI worker is registered as an optional CLI backend without becoming the default model',async()=>{
 const manifest=JSON.parse(await fs.readFile('plugins/jarvis/openclaw.plugin.json','utf8'));
 assert.ok(manifest.cliBackends.includes('jarvis-opencode-gui'));
 const backend=buildGuiBackend();assert.equal(backend.id,'jarvis-opencode-gui');assert.equal(backend.config.args.at(-1),'opencode/space-bunny-free');
});
test('manager failures preserve only safe auth/status classification',()=>{
 const error=safeManagerFailure({type:'provider.auth',status:403,message:'private provider response',response:{body:'secret response'}});
 assert.match(error,/provider authorization denied \(HTTP 403\)/);
 assert.doesNotMatch(error,/private provider response|secret response/);
 assert.match(safeManagerFailure({type:'provider.rate_limit',status:429}),/provider rate limit \(HTTP 429\)/);
});
