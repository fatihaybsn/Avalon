// Local Windows assembly using OpenClaw's package owner. The sealed worker is
// always produced by the native pack owner from the current source; no runtime
// dist patching and no reuse of a worker artifact from an earlier build.
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {execFileSync} from 'node:child_process';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const source=path.join(root,'tmp/openclaw-stage14-source');
const output=path.join(root,'tmp/stage15-native-windows-package');
const pkg=JSON.parse(fs.readFileSync(path.join(source,'package.json'),'utf8'));
if(process.platform!=='win32'||process.cwd()!==source||pkg.version!=='2026.10.2'||pkg.jarvisNative?.upstreamCommit!=='b8952d477f0c932d8ddc6da5c89cab5a169b6ff1')throw new Error('Exact approved native Windows source required');
const {packOpenClawPackageForDocker}=await import(pathToFileURL(path.join(source,'scripts/package-openclaw-for-docker.mts')).href);
const result=await packOpenClawPackageForDocker(source,output,{
  allowUnreleasedChangelog:true,
  // Windows does not use Unix owner/group executable bits. Keep the npm-packed
  // bytes; the ordinary native tarball integrity checker still runs below.
  normalizeTarballModes:async()=>{},
});
execFileSync(process.execPath,[path.join(source,'scripts/check-openclaw-package-tarball.mjs'),'--require-bundled-workspace-deps',result],{cwd:source,windowsHide:true,stdio:'inherit'});
console.log(result);
