import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { pathToFileURL } from "node:url";
import { ResearchScheduler } from "../electron/researchScheduler.mjs";
import { acquireResearchLock } from "../electron/researchLock.mjs";
import { ResearchStore, readJson, writeJson } from "../electron/researchStore.mjs";

const python = process.platform === "win32" ? "python" : "python3", repoRoot = path.resolve(".");
const exec = promisify(execFile);
async function until(check) {
  for (let i = 0; i < 150; i++) { if (check()) return; await new Promise((resolve) => setTimeout(resolve, 20)); }
  assert.fail("Local fixture deadline exceeded");
}
function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "avalon-launcher-test-"));
  const store = new ResearchStore(path.join(root, "research"));
  const id = "schedule_abcdef", stateFile = store.file(id), lockFile = store.file(id, "supervisor.lock");
  const marker = path.join(root, "started.txt"), finish = path.join(root, "finish"), done = path.join(root, "done");
  t.after(async () => {
    fs.writeFileSync(finish, "stop");
    if (fs.existsSync(marker)) await until(() => fs.existsSync(done));
    // Yield while detached Windows supervisors close their files and pipes.
    assert.equal(path.dirname(root), os.tmpdir());
    await fs.promises.rm(root, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
  });
  const runner = path.join(root, "runner.mjs"), script = path.join(root, "scripts", `avalon-${id}.py`);
  const state = { id, nativeId: "native-preserved", paused: false, spec: { schedule: { kind: "daily", time: "09:00" }, runtime: { repoRoot, stateRoot: store.root } } };
  store.save(state);
  const launch = { executable: process.execPath, runner, env: {}, logFile: store.file(id, "runner.log"), lockFile };
  writeJson(path.join(root, "cron", "jobs.json"), { jobs: [{ job_id: state.nativeId, enabled: true, next_run_at: "2035-01-01", custom: "keep" }] });
  fs.writeFileSync(runner, `import fs from 'node:fs';
import {acquireResearchLock} from ${JSON.stringify(pathToFileURL(path.join(repoRoot, "electron/researchLock.mjs")).href)};
if(process.argv.includes('--lock-protocol')) { console.log('2'); process.exit(0); }
const lease=await acquireResearchLock(${JSON.stringify(lockFile)},{repoRoot:${JSON.stringify(repoRoot)}});
if(lease.skipped) { console.log(JSON.stringify(lease)); process.exit(0); }
fs.appendFileSync(${JSON.stringify(marker)},process.argv.at(-1)+'\\n');
while(!fs.existsSync(${JSON.stringify(finish)})) await new Promise(r=>setTimeout(r,20));
await lease.release(); fs.writeFileSync(${JSON.stringify(done)},'done');
`);
  const fakePython = path.join(root, "fake-python"); fs.mkdirSync(path.join(fakePython, "cron"), { recursive: true });
  fs.writeFileSync(path.join(fakePython, "cron", "__init__.py"), "");
  fs.writeFileSync(path.join(fakePython, "cron", "jobs.py"), "def get_job(job_id):\n    return {'next_run_at':'2035-01-01', 'fire_claim':{'by':'actual-occurrence-id'}}\n");
  const scheduler = new ResearchScheduler({ home: () => root, repoRoot });
  const install = () => scheduler.installLauncher(id, stateFile, launch);
  const run = (args = []) => exec(python, ["-B", script, ...args], { env: { ...process.env, PYTHONPATH: fakePython }, windowsHide: true, timeout: 10000 });
  const legacy = () => { fs.mkdirSync(path.dirname(script), { recursive: true }); fs.copyFileSync("test/fixtures/research-launcher-v1.py", script); writeJson(script.replace(/\.py$/, ".json"), { stateFile, ...launch }); };
  return { root, store, id, stateFile, state, script, launch, lockFile, marker, finish, done, install, run, legacy };
}

test("native cron launcher retains prompt detached dispatch, exact occurrence and shared OS exclusion", { timeout: 15000 }, async (t) => {
  const f = fixture(t);
  assert.equal(await f.install(), f.script);
  assert.equal(JSON.parse((await f.run()).stdout).queued, true);
  await until(() => fs.existsSync(f.marker));
  assert.equal((await acquireResearchLock(f.lockFile, { repoRoot })).reason, "already_running");
  await f.run();
  await until(() => fs.readFileSync(f.launch.logFile, "utf8").includes('"already_running"'));
  assert.equal(fs.readFileSync(f.marker, "utf8"), "actual-occurrence-id\n");
});

test("v1 to v2 migration backs up launcher, state and native definitions; identity/settings remain byte-identical", async (t) => {
  const f = fixture(t); f.legacy();
  const scriptBefore = fs.readFileSync(f.script, "utf8"), configBefore = fs.readFileSync(f.script.replace(/\.py$/, ".json"), "utf8");
  const stateBefore = fs.readFileSync(f.stateFile, "utf8"), jobsBefore = fs.readFileSync(path.join(f.root, "cron/jobs.json"), "utf8");
  await f.install();
  const backups = path.join(f.root, "scripts", "avalon-backups", f.id);
  const backup = path.join(backups, fs.readdirSync(backups)[0]);
  assert.equal(fs.readFileSync(path.join(backup, "launcher.py"), "utf8"), scriptBefore);
  assert.equal(fs.readFileSync(path.join(backup, "launcher.json"), "utf8"), configBefore);
  assert.equal(fs.readFileSync(path.join(backup, "state.json"), "utf8"), stateBefore);
  assert.equal(fs.readFileSync(path.join(backup, "native-jobs.json"), "utf8"), jobsBefore);
  assert.equal(fs.readFileSync(f.stateFile, "utf8"), stateBefore);
  assert.equal(fs.readFileSync(path.join(f.root, "cron/jobs.json"), "utf8"), jobsBefore);
  await f.install();
  assert.equal(fs.readdirSync(backups).length, 1);
  fs.writeFileSync(f.finish, "done");
  await f.run(["--avalon-worker", "after-migration"]);
  assert.equal(fs.readFileSync(f.marker, "utf8"), "after-migration\n");
});

test("active legacy OS supervisor defers migration", async (t) => {
  const f = fixture(t); f.legacy();
  const original = fs.readFileSync(f.script, "utf8");
  const lease = await acquireResearchLock(f.lockFile, { repoRoot });
  try {
    await assert.rejects(f.install(), { code: "LAUNCHER_BUSY" });
    assert.equal(fs.readFileSync(f.script, "utf8"), original);
    assert.equal(fs.existsSync(path.join(f.root, "scripts", "avalon-backups")), false);
  } finally { await lease.release(); }
  await f.install();
  assert.match(fs.readFileSync(f.script, "utf8"), /Avalon launcher protocol: 2/);
});

test("failed atomic script commit restores the previous launcher pair and preserves schedules", async (t) => {
  const f = fixture(t); f.legacy();
  const before = fs.readFileSync(f.script, "utf8"), configFile = f.script.replace(/\.py$/, ".json"), config = fs.readFileSync(configFile, "utf8");
  const rename = fs.renameSync; let failed = 0;
  t.mock.method(fs, "renameSync", (from, to) => {
    if (to === f.script && failed++ < (process.platform === "win32" ? 4 : 1)) throw Object.assign(new Error("commit fixture failure"), { code: "EPERM" });
    return rename(from, to);
  });
  await assert.rejects(f.install(), /commit fixture/);
  assert.equal(fs.readFileSync(f.script, "utf8"), before);
  assert.equal(fs.readFileSync(configFile, "utf8"), config);
  assert.equal(readJson(f.stateFile).nativeId, f.state.nativeId);
});

test("embedded configuration makes an interrupted companion JSON update harmless", async (t) => {
  const f = fixture(t); await f.install();
  writeJson(f.script.replace(/\.py$/, ".json"), { runner: "invalid companion, runtime must ignore it" });
  fs.writeFileSync(f.finish, "done");
  await f.run(["--avalon-worker", "immutable-config"]);
  assert.equal(fs.readFileSync(f.marker, "utf8"), "immutable-config\n");
  f.launch.env.EXTRA_OFFLINE_FIELD = "new";
  await f.install();
});

test("mixed versions fail closed: old OS launcher/new worker returns busy, new launcher/old worker never dispatches", async (t) => {
  const f = fixture(t); f.legacy();
  await f.run(["--avalon-worker", "old-launcher"]);
  assert.equal(fs.existsSync(f.marker), false);
  assert.match(fs.readFileSync(f.launch.logFile, "utf8"), /already_running/);
  await f.install();
  fs.writeFileSync(f.launch.runner, "if(process.argv.includes('--lock-protocol')){console.log('1');process.exit(0)}; throw new Error('worker must not start');");
  await assert.rejects(f.run(["--avalon-worker", "old-worker"]));
  assert.match(readJson(f.store.file(f.id, "dispatch-error.json")).error, /protocol mismatch/);
  assert.equal(fs.existsSync(f.marker), false);
});

test("unknown/customized launchers are preserved without overwriting their source", async (t) => {
  const f = fixture(t); f.legacy();
  fs.appendFileSync(f.script, "\n# user customization\n");
  const original = fs.readFileSync(f.script, "utf8");
  await assert.rejects(f.install(), /eşleşmiyor/);
  assert.equal(fs.readFileSync(f.script, "utf8"), original);
});
