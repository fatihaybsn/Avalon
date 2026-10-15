import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const EXPECTED_COMMIT='b8952d477f0c932d8ddc6da5c89cab5a169b6ff1';

export function supportsNativeTalkPackage(pkg){
  const receipt=pkg?.jarvisNative;
  return pkg?.version==='2026.10.2'&&receipt?.apiVersion===1&&receipt?.upstreamCommit===EXPECTED_COMMIT&&Array.isArray(receipt?.features)&&receipt.features.includes('source-talk');
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const pkg=JSON.parse(fs.readFileSync(path.join(root,'node_modules/openclaw/package.json'),'utf8'));
  if(!supportsNativeTalkPackage(pkg))throw new Error('JARVIS requires the pinned source-built OpenClaw package with native Talk support. Build/install it from the approved source checkout; compiled dist patching is retired.');
  console.log('Pinned source-built OpenClaw native Talk receipt verified.');
}
