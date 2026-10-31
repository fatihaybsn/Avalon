import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { ResearchScheduler } from "../electron/researchScheduler.mjs";
import { writeJson } from "../electron/researchStore.mjs";

test("native cron launcher supervises a detached local worker and excludes overlap without Hermes", { timeout: 15000 }, async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "avalon-launcher-test-"));
  const stateFile = path.join(root, "state.json"), marker = path.join(root, "started.txt"), fakeRunner = path.join(root, "runner.mjs");
  const fakePython = path.join(root, "fake-python"); fs.mkdirSync(path.join(fakePython, "cron"), { recursive: true });
  fs.writeFileSync(path.join(fakePython, "cron", "__init__.py"), "");
  fs.writeFileSync(path.join(fakePython, "cron", "jobs.py"), "def get_job(job_id):\n    return {'next_run_at':'2035-01-01T09:00:00+03:00', 'fire_claim':{'by':'actual-occurrence-id'}}\n");
  fs.writeFileSync(fakeRunner, `import fs from 'node:fs'; fs.appendFileSync(${JSON.stringify(marker)},process.argv.at(-1)+'\\n'); await new Promise(r=>setTimeout(r,4000));`);
  writeJson(stateFile, { id: "schedule_abcdef", nativeId: "fake-native" });
  const scheduler = new ResearchScheduler({ home: () => root });
  const script = scheduler.installLauncher("schedule_abcdef", stateFile, { executable: process.execPath, runner: fakeRunner, env: {}, logFile: path.join(root, "runner.log") });
  const env = { ...process.env, PYTHONPATH: fakePython };
  const run = () => promisify(execFile)(process.platform === "win32" ? "python" : "python3", [script], { env, windowsHide: true, timeout: 10000 });
  const first = await run(); assert.equal(JSON.parse(first.stdout.trim()).queued, true);
  for (let i = 0; i < 30 && !fs.existsSync(marker); i++) await new Promise((resolve) => setTimeout(resolve, 100));
  assert.ok(fs.existsSync(marker), "Detached supervisor must start the local worker");
  await run();
  for (let i = 0; i < 30 && !fs.existsSync(path.join(root, "last-skip.json")); i++) await new Promise((resolve) => setTimeout(resolve, 100));
  assert.equal(fs.readFileSync(marker, "utf8").trim(), "actual-occurrence-id", "Use the consumed claim identity, and do not start an overlapping second worker");
  assert.equal(JSON.parse(fs.readFileSync(path.join(root, "last-skip.json"), "utf8")).reason, "already_running");
  // Let this entirely local fixture finish before the test process exits.
  await new Promise((resolve) => setTimeout(resolve, 4000));
});
