import test from 'node:test';
import assert from 'node:assert/strict';
import {AsyncResource} from 'node:async_hooks';
import {a as issueAuthority} from '../node_modules/openclaw/dist/admitted-run-context-QJnFIxUZ.mjs';
import {c as withRequest,s as withGatewayContext,a as getRequest} from '../node_modules/openclaw/dist/gateway-request-scope-BSmCVVpP.mjs';
import {r as hasSessionControlAuthority} from '../node_modules/openclaw/dist/conversation-capability-profile-CEJrJGkH.mjs';
import {patchMcpProcessScope,originalMcpStartup,correctedMcpStartup} from '../scripts/fix-mcp-process-scope.mjs';

test('a process-owned listener does not keep its first caller, and current grant expiry still rejects',async()=>{
 let oldActive=true,newActive=true;
 const old=issueAuthority({profileId:'old',scopes:['operator.write'],assertCurrent(){if(!oldActive)throw Error('old request closed');}});
 const current=issueAuthority({profileId:'new',scopes:['operator.write'],assertCurrent(){if(!newActive)throw Error('new request closed');}});
 const resolveGatewayContext=()=>({});
 let staleListener,cleanListener;
 await withRequest({client:{internal:{operatorRunAuthority:old},connect:{scopes:['operator.write']}},resolveGatewayContext},async()=>{
  staleListener=AsyncResource.bind(()=>hasSessionControlAuthority(current));
  await Promise.resolve().then(()=>withGatewayContext(getRequest()?.resolveGatewayContext,()=>{
   assert.equal(getRequest()?.client,undefined);
   assert.equal(getRequest()?.resolveGatewayContext,resolveGatewayContext);
   cleanListener=AsyncResource.bind(()=>hasSessionControlAuthority(current));
  },{inheritRequestScope:false}));
 });
 oldActive=false;
 assert.throws(staleListener,/old request closed/);
 assert.equal(cleanListener(),true);
 newActive=false;
 assert.throws(cleanListener,/new request closed/);
});

test('the pinned correction is idempotent and refuses an unknown runtime',()=>{
 assert.equal(patchMcpProcessScope(originalMcpStartup),correctedMcpStartup);
 assert.equal(patchMcpProcessScope(correctedMcpStartup),correctedMcpStartup);
 assert.throws(()=>patchMcpProcessScope('unknown startup'),/contract changed/);
});
