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
import { ResearchStore, writeJson } from "../electron/researchStore.mjs";

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

  const secondStarted = Promise.withResolvers();
  let calls = 0;
  const cancelling = runEntry(["--schedule", store.file(scheduleId), "--occurrence", "cancel-test"], {
    resolveModel: async () => ({ configured: true, key: "fixture", baseUrl: "https://example.org/v1" }),
    spawnWorker() {
      const child = Object.assign(new EventEmitter(), {
        stdin: new PassThrough(), stdout: new PassThrough(),
        kill() { child.stdout.end(); queueMicrotask(() => child.emit("close", 1)); },
      });
      child.stdin.once("data", () => {
        if (++calls === 2) return secondStarted.resolve();
        child.stdout.end(JSON.stringify({ kind: "report", markdown: marker }) + "\n");
        queueMicrotask(() => child.emit("close", 0));
      });
      return child;
    },
  });
  await Promise.race([secondStarted.promise, cancelling.then(() => assert.fail("Run ended before cancellation"))]);
  automation.research.store = store;
  automation.research.scheduleSnapshot = () => ({ jobs: [{ id: scheduleId, spec }], scheduler: { available: true } });
  const [active] = automation.snapshot(true).flows[0].history;
  assert.equal(active.status, "running");
  automation.cancelRun(spec.automationFlowId, active.id);
  const cancelled = await cancelling;
  assert.equal(cancelled.status, "cancelled");
  assert.equal(store.get(cancelled.steps[0].researchId).output, marker);
  assert.equal(cancelled.steps[1].status, "cancelled");
  assert.ok(automation.snapshot(true).flows[0].schedule);

  const careerId = "record-tracking-fixture", careerSchedule = "schedule_cafe";
  const inputs = path.join(directory, "automation", "inputs", careerId);
  fs.mkdirSync(inputs, { recursive: true });
  fs.writeFileSync(path.join(inputs, "profile.md"), "Fixture profile.");
  fs.writeFileSync(path.join(inputs, "activities.md"), "Fixture activity.");
  const ids = ["discovery", "analysis", "contacts", "opportunities", "strategy"];
  writeJson(path.join(directory, "automation", "editor", "flows.json"), [...graph.flows,
    { id: careerId, type: "tab", label: "Record tracking fixture" },
    { id: "fixture-start", z: careerId, type: "avalon-start", wires: [[ids[0]]] },
    ...ids.map((id, index) => ({ id, z: careerId, type: "avalon-research", topic: id,
      mode: index === 4 ? "synthesis" : "deep", reportInputs: ids.slice(0, index),
      wires: [[ids[index + 1] || "fixture-finish"]] })),
    { id: "fixture-finish", z: careerId, type: "avalon-finish", wires: [] },
  ]);
  writeJson(path.join(inputs, "inputs.json"), { steps: {
    discovery: { documents: ["profile.md"], group: "companies", identity: "domain" },
    analysis: { documents: ["profile.md"], coverage: { group: "companies", changesFrom: "opportunities" } },
    contacts: { documents: ["profile.md"], group: "contacts", coverage: { group: "companies", after: "analysis" } },
    opportunities: { documents: ["profile.md"], group: "opportunities", coverage: { group: "companies", refresh: true } },
    strategy: { documents: ["profile.md", "activities.md"], group: "actions" },
  } });
  assert.deepEqual(automation.snapshot(true).flows.map(({ id }) => id), [spec.automationFlowId]);
  assert.ok(automation.flows().some((flow) => flow.id === careerId && flow.steps.length === 5));
  store.save({ id: careerSchedule, spec: { ...spec, automationFlowId: careerId } });
  const fixtureMarkdown = "# Fixture report\n\n" + "r".repeat(13_000);
  const report = (records = [], coverage = []) => fixtureMarkdown + "\n\n" + String.fromCharCode(96).repeat(3) +
    "avalon-records\n" + JSON.stringify({ records, coverage }) + "\n" + String.fromCharCode(96).repeat(3);
  const company = (key, url) => ({ key, name: key, url, status: "completed", note: "Fixture finding." });
  const checked = (key) => ({ key, status: "completed", note: "Checked with fixture evidence." });
  async function careerRound(number) {
    let calls = 0;
    const args = ["--schedule", store.file(careerSchedule), "--occurrence", `career-${number}`];
    const result = await runEntry(args, {
      resolveModel: async () => ({ configured: true, key: "fixture", baseUrl: "https://example.org/v1" }),
      spawnWorker() {
        const child = Object.assign(new EventEmitter(), { stdin: new PassThrough(), stdout: new PassThrough(), kill() {} });
        child.stdin.once("data", (data) => {
          const job = JSON.parse(data);
          const history = JSON.parse(job.reports.at(-1).markdown);
          const queue = history.requiredQueue?.map((entry) => entry.key);
          assert.ok(job.reports.some(({ markdown }) => markdown === "Fixture profile."));
          assert.ok(job.purpose.includes("avalon-records"));
          let markdown;
          switch (++calls) {
            case 1:
              assert.equal(history.records.companies?.length ?? 0, number === 1 ? 0 : 2);
              markdown = number === 1
                ? report([company("Original company name", "https://www.example.org/company"), company("Waiting", "https://example.net")])
                : report([company("Alternative name", "https://example.org")]);
              break;
            case 2:
              assert.deepEqual(queue, number === 1 ? ["example.org", "example.net"] : ["example.net"]);
              assert.equal(job.reports[0].markdown, fixtureMarkdown);
              markdown = report([], [checked(number === 1 ? "example.org" : "example.net")]);
              break;
            case 3:
              assert.deepEqual(queue, [number === 1 ? "example.org" : "example.net"]);
              markdown = report([], queue.map(checked));
              break;
            case 4:
              assert.deepEqual(queue, ["example.org", "example.net"]);
              markdown = report(number === 2 ? [company("github.com/org/repo/issues/7", "https://github.com/org/repo/issues/7")] : [], queue.map(checked));
              break;
            case 5:
              assert.equal(job.mode, "synthesis");
              assert.equal(job.reports.filter(({ markdown }) => markdown === fixtureMarkdown).length, 4);
              assert.ok(job.reports.some(({ name }) => name === "activities.md"));
              assert.equal(history.records.opportunities.length, number === 2 ? 1 : 0);
              markdown = report();
              break;
            default: assert.fail("Unexpected career stage");
          }
          child.stdout.end(JSON.stringify({ kind: "report", markdown }) + "\n");
          queueMicrotask(() => child.emit("close", 0));
        });
        return child;
      },
    });
    assert.equal(result.status, "completed", result.error);
    assert.equal(calls, 5);
  }
  await careerRound(1);
  await careerRound(2);
  console.log("Career workflow passed both rounds, including profile, all four report inputs, duplicate identity, pending work and a new opportunity.");
} finally {
  automation.close();
  // Give Node-RED and Windows time to release their files.
  await delay(500);
  fs.rmSync(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 150 });
}
