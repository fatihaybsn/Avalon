import {adaptTalkSource} from '../../../native/openclaw/talk-browser-adapter.mjs';
// Deliberately only the pinned browser Talk dependency graph, never a new SDK.
import { build, transform } from 'esbuild';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const commit = 'b8952d477f0c932d8ddc6da5c89cab5a169b6ff1';
const base = 'ui/src/pages/chat/talk/';
const dest = path.join(root, 'vendor/talk');
const refresh = process.argv.includes('--fetch');
const files = [];
await fs.mkdir(dest, { recursive: true });
const adapter = `export const DEFAULT_GATEWAY_REQUEST_TIMEOUT_MS=20000;
export const t=(key)=>({'chat.voice.preparing':'Görüşme hazırlanıyor','chat.composer.microphoneStopped':'Mikrofon bağlantısı kesildi','chat.composer.microphoneAccessPending':'Mikrofon izni bekleniyor','chat.composer.realtimeTalkRequiresMicrophone':'Mikrofon erişimi gerekiyor'}[key]??key);
export const formatUiError=(error)=>error instanceof Error?error.message:String(error);`;
await build({ stdin: { contents: `export {RealtimeTalkSession} from './${base}session.ts'; export {createTalkSessionController} from './src/talk/talk-session-controller.ts';`, resolveDir: '/', sourcefile: 'entry.ts' }, bundle: true, write: true, outfile: path.join(dest,'runtime.js'), format: 'esm', platform:'browser', target:'chrome144', plugins:[{name:'pinned-talk',setup(b){
  b.onResolve({filter:/.*/}, args => {
    const p=args.path;
    if(p==='@openclaw/gateway-client/browser'||p.endsWith('/i18n/index.ts')||p.endsWith('/lib/format-error.ts')) return {path:'adapter',namespace:'talk'};
    if(p==='@openclaw/retry') return {path:'packages/retry/src/index.ts',namespace:'talk'};
    if(p.startsWith('@openclaw/normalization-core/')) return {path:`packages/normalization-core/src/${p.split('/').at(-1)}.ts`,namespace:'talk'};
    if(!p.startsWith('.')) throw new Error(`Unexpected browser Talk dependency: ${p}`);
    const name=path.posix.normalize(path.posix.join(args.importer?path.posix.dirname(args.importer):'',p)).replace(/\.js$/,'.ts');
    if(!/^(ui\/src\/|src\/(talk|shared|utils)\/|packages\/(retry|normalization-core)\/)/.test(name)) throw new Error(`Unexpected source: ${name}`);
    return {path:name,namespace:'talk'};
  });
  b.onLoad({filter:/.*/,namespace:'talk'},async args=>{
    if(args.path==='adapter') return {contents:adapter,loader:'js'};
    if(args.path===base+'transport.runtime.ts') return {contents:`import {GoogleLiveRealtimeTalkTransport} from './google-live.ts';export function createRealtimeTalkTransport(session,ctx){if(session.provider!=='google'||session.transport!=='provider-websocket'||session.model!=='gemini-3.8-live')throw new Error('Seçili Google Live yolu değişti');return new GoogleLiveRealtimeTalkTransport(session,ctx)}`,loader:'js'};
    const local=path.join(dest,'sources',args.path);
    let original;
    if(refresh){ const r=await fetch(`https://raw.githubusercontent.com/openclaw/openclaw/${commit}/${args.path}`);if(!r.ok)throw new Error(`Source unavailable: ${args.path} ${r.status}`);original=await r.text();await fs.mkdir(path.dirname(local),{recursive:true});await fs.writeFile(local,original); }
    else original=await fs.readFile(local,'utf8');
    files.push({path:args.path,sha256:createHash('sha256').update(original).digest('hex')});
    // Remove type-only dependencies before resolving the strictly browser graph.
    const contents=(await transform(adaptTalkSource(args.path,original),{loader:'ts',target:'es2023',tsconfigRaw:{compilerOptions:{useDefineForClassFields:false}}})).code;
    return {contents,loader:'js'};
  });
}}]});
files.sort((a,b)=>a.path.localeCompare(b.path));
const manifest={commit,repository:'https://github.com/openclaw/openclaw',license:'MIT',files};
if(refresh)await fs.writeFile(path.join(dest,'SOURCE.json'),JSON.stringify(manifest,null,2)+'\n');
else {const expected=JSON.parse(await fs.readFile(path.join(dest,'SOURCE.json'),'utf8'));if(JSON.stringify(expected)!==JSON.stringify(manifest))throw new Error('Talk source integrity mismatch');}
console.log(`Pinned Talk browser bundle: ${files.length} source files`);
