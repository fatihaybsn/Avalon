// Local Windows assembly using OpenClaw's package owner. Reuse only the sealed
// worker artifact from the same already-built source; no runtime dist patching.
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {execFileSync} from 'node:child_process';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const source=path.join(root,'tmp/openclaw-stage14-source');
const archive=path.join(root,'tmp/stage15-native-package/openclaw-2026.10.2.tgz');
const output=path.join(root,'tmp/stage15-native-windows-package');
const pkg=JSON.parse(fs.readFileSync(path.join(source,'package.json'),'utf8'));
if(process.platform!=='win32'||process.cwd()!==source||pkg.version!=='2026.10.2'||pkg.jarvisNative?.upstreamCommit!=='b8952d477f0c932d8ddc6da5c89cab5a169b6ff1')throw new Error('Exact approved native Windows source required');
const bytes=fs.readFileSync(archive);
const tarArgs={input:bytes,windowsHide:true,maxBuffer:16*1024*1024};
const entries=execFileSync('tar',['-tzf','-'],tarArgs).toString().split(/\r?\n/);
const worker=entries.filter(p=>/^package\/dist\/worker-artifacts\/[a-f0-9]{64}\.tar\.gz$/.test(p));
if(worker.length!==1)throw new Error('Exactly one sealed native worker artifact required');
const archivedBuild=execFileSync('tar',['-xOzf','-','package/dist/build-info.json'],tarArgs);
if(!archivedBuild.equals(fs.readFileSync(path.join(source,'dist/build-info.json'))))throw new Error('Worker archive belongs to another native build; rebuild it with the native pack owner');
const {packOpenClawPackageForDocker}=await import(pathToFileURL(path.join(source,'scripts/package-openclaw-for-docker.mts')).href);
const result=await packOpenClawPackageForDocker(source,output,{
  allowUnreleasedChangelog:true,
  async prepareWorkerBundle(cwd){
    if(cwd!==source)throw new Error('Unexpected source target');
    fs.mkdirSync(path.join(source,'dist/worker-artifacts'),{recursive:true});
    execFileSync('tar',['-xzf','-','-C',source.replaceAll('\\','/'),'--strip-components','1',worker[0]],tarArgs);
  },
  // Windows does not use Unix owner/group executable bits. Keep the npm-packed
  // bytes; the ordinary native tarball integrity checker still runs below.
  normalizeTarballModes:async()=>{},
});
execFileSync(process.execPath,[path.join(source,'scripts/check-openclaw-package-tarball.mjs'),'--require-bundled-workspace-deps',result],{cwd:source,windowsHide:true,stdio:'inherit'});
console.log(result);
