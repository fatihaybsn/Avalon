// Opt-in integration check. Installs the pinned Node-RED runtime into a temporary profile.
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";
import { setTimeout as delay } from "node:timers/promises";
import { AutomationService } from "../electron/automationService.mjs";
import { runEntry } from "../electron/researchRunner.mjs";
import { ResearchStore } from "../electron/researchStore.mjs";

const repoRoot = path.resolve(".");
const directory = fs.mkdtempSync(path.join(os.tmpdir(), "avalon-automation-test-"));
const stateRoot = path.join(directory, "research");
const store = new ResearchStore(stateRoot);
const automation = new AutomationService({ root: stateRoot, repoRoot });

try {
  await automation.install();
  const editor = new URL(await automation.editor());
  const endpoint = new URL("/flows", editor);
  const token = editor.searchParams.get("access_token");
  assert.equal((await fetch(endpoint)).status, 401, "The editor API requires authentication.");
  const headers = { Authorization: `Bearer ${token}`, "Content-Type": "application/json", "Node-RED-API-Version": "v2" };
  const response = await fetch(endpoint, { headers });
  assert.ok(response.ok, `Editor API returned ${response.status}`);
  const graph = await response.json();
  assert.ok(graph.flows.some(({ type }) => type === "avalon-research"));
  assert.equal((await fetch(endpoint, { method: "POST", headers, body: JSON.stringify(graph) })).status, 200);
  const unsafe = { ...graph, flows: [...graph.flows, { id: "untrusted", type: "exec", z: "avalon-example" }] };
  assert.equal((await fetch(endpoint, { method: "POST", headers, body: JSON.stringify(unsafe) })).status, 400);

  const scheduleId = "schedule_abcdef";
  const spec = {
    automationFlowId: "avalon-example", route: { provider: "evren", modelId: "qwen3.8-flash-next" },
    language: "tr", outputDirectory: path.join(directory, "reports"),
    runtime: { repoRoot, stateRoot },
  };
  const replacementScheduleId = "schedule_012345";
  store.save({ id: scheduleId, spec });
  store.save({ id: replacementScheduleId, spec });
  const marker = "handoff from the current run";
  async function run(occurrence, partial) {
    let calls = 0;
    const args = ["--schedule", store.file(scheduleId), "--occurrence", occurrence];
    const result = runEntry(args, {
      resolveModel: async () => ({ configured: true, key: "fixture", baseUrl: "https://example.org/v1" }),
      spawnWorker() {
        const child = Object.assign(new EventEmitter(), { stdin: new PassThrough(), stdout: new PassThrough(), kill() {} });
        child.stdin.once("data", (data) => {
          const job = JSON.parse(data);
          calls++;
          if (calls === 1) assert.deepEqual(job.reports, []);
          else assert.deepEqual(job.reports, [{ name: "Kaynak keşfi", markdown: marker }]);
          child.stdout.end(JSON.stringify({ kind: partial ? "report_chunk" : "report", markdown: calls === 1 ? marker : "Second report" }) + "\n");
          queueMicrotask(() => child.emit("close", partial ? 1 : 0));
        });
        return child;
      },
    });
    assert.equal((await runEntry([...args.slice(0, -1), occurrence + "-overlap"])).reason, "already_running");
    assert.equal((await runEntry(["--schedule", store.file(replacementScheduleId), "--occurrence", occurrence])).reason, "already_running");
    const finished = await result;
    assert.equal(finished.status, partial ? "partial" : "completed", finished.error);
    assert.deepEqual(finished.steps.map((step) => step.status), partial ? ["partial", "waiting"] : ["completed", "completed"]);
    assert.equal(calls, partial ? 1 : 2);
    assert.equal((await runEntry(args)).reason, "duplicate_occurrence");
  }
  await run("complete", false);
  await run("partial", true);
  console.log("Node-RED authenticated editor, deployment, same-run report input, partial and duplicate/overlap checks passed.");
} finally {
  automation.close();
  // Give Node-RED and Windows time to release their files.
  await delay(500);
  fs.rmSync(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 150 });
}
