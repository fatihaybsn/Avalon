import test from 'node:test';
import assert from 'node:assert/strict';
import {prepareMobile} from '../scripts/jarvis-mobile-config.mjs';
const config={gateway:{bind:'loopback',auth:{mode:'token',token:'${JARVIS_GATEWAY_TOKEN}'},controlUi:{allowedOrigins:['http://127.0.0.1:5173']},tailscale:{mode:'off'}}};
const status={BackendState:'Running',Self:{DNSName:'pc.example.ts.net.'}};
test('native Serve keeps loopback, token, device authentication and exact origin',()=>{
  const r=prepareMobile(config,status,{});
  assert.equal(r.config.gateway.auth.allowTailscale,false);
  assert.deepEqual(r.config.gateway.auth,{mode:'token',token:'${JARVIS_GATEWAY_TOKEN}',allowTailscale:false});
  assert.equal(r.config.gateway.bind,'loopback');
  assert.deepEqual(r.config.gateway.controlUi.allowedOrigins,['http://127.0.0.1:5173','https://pc.example.ts.net']);
  assert.equal(r.config.gateway.tailscale.mode,'serve');
  assert.equal(config.gateway.tailscale.mode,'off');
  assert.equal(r.config.gateway.trustedProxies,undefined);
});
test('existing routes and unreadable Serve state fail closed, including matching old target',()=>{
  for(const serve of [undefined,null,[],{TCP:{443:{HTTPS:true}}},{Web:{'pc.example.ts.net:443':{Handlers:{'/':{Proxy:'http://127.0.0.1:18789'}}}}},{AllowFunnel:{'pc.example.ts.net:443':true}}])assert.throws(()=>prepareMobile(config,status,serve));
});
test('login, hostname and weak authentication cannot be silently accepted',()=>{
  assert.throws(()=>prepareMobile(config,{...status,BackendState:'NeedsLogin'},{}));
  for(const DNSName of ['evil.test','*.example.ts.net','pc.example.ts.net/path'])assert.throws(()=>prepareMobile(config,{...status,Self:{DNSName}},{}));
  for(const patch of [{bind:'lan'},{auth:{mode:'trusted-proxy'}},{controlUi:{dangerouslyDisableDeviceAuth:true}},{controlUi:{allowedOrigins:['*']}},{tailscale:{mode:'funnel'}}])assert.throws(()=>prepareMobile({gateway:{...config.gateway,...patch}},status,{}));
});
