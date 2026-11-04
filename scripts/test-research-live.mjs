// Opt-in: real Hermes/web services. All state/output and jobs belong to this test.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { loadEnvFiles } from "../electron/configStore.mjs";
import { BrainModelService, HermesBrainBridge, DEFAULT_BRAIN, validateBrainSelection } from "../electron/brainModels.mjs";
import { ResearchScheduler } from "../electron/researchScheduler.mjs";
import { ResearchService } from "../electron/researchService.mjs";
import { RESEARCH_TERMINAL, readJson } from "../electron/researchStore.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
loadEnvFiles({ repoRoot: root });
const temp = fs.mkdtempSync(path.join(os.tmpdir(), "avalon-research-live-"));
fs.writeFileSync(path.join(temp, ".env"), "");
const durable = process.argv.includes("--durable");
const bridge = new HermesBrainBridge({ repoRoot: root });
const route = validateBrainSelection(durable ? { provider: "evren", modelId: "qwen3.8-flash-next", reasoning: "disabled" } : { provider: process.env.IRIS_BRAIN_PROVIDER || DEFAULT_BRAIN.provider, modelId: process.env.IRIS_BRAIN_MODEL || DEFAULT_BRAIN.modelId, reasoning: process.env.IRIS_BRAIN_REASONING || "default" });
const models = new BrainModelService({ bridge, selected: route, current: route });
const scheduler = new ResearchScheduler({ bridge, repoRoot: root, home: () => process.env.HERMES_HOME || path.join(os.homedir(), ".hermes") });
const service = new ResearchService({ root: path.join(temp, "research"), outputRoot: path.join(temp, "output"), repoRoot: root,
  scheduler, getRoute: async () => route, prepareRoute: (value) => models.prepare(value), sessionId: () => "isolated-research-live-test", configPath: path.join(temp, ".env") });
// Preserve the headless test's isolated settings even when Electron is the runner.
const runtime = service.runtime.bind(service); service.runtime = () => { const value = runtime(); value.env.IRIS_TEST_HOOKS = "1"; value.env.IRIS_TEST_CONFIG_PATH = path.join(temp, ".env"); return value; };
let schedule, run;
const scheduled = process.argv.includes("--schedule");
try {
  const spec = await service.specification({
    topic: durable ? "Python, Node.js ve TypeScript nedir? Her biri için resmî sitesinden tek bir kısa tanım bul, sayfayı gerçekten oku ve tanımı birebir alıntıyla destekle. Üç tanım yeterli; sürüm, tarihçe, paket veya kurulum araştırma." : scheduled ? "Python resmî indirme sayfasından güncel kararlı sürümü bul ve kaynakla doğrula." : "Python, Node.js ve TypeScript'in resmî sitelerindeki kararlı sürüm bilgilerini kısa ve kaynaklı biçimde karşılaştır. Üç projenin resmî sayfalarını gerçekten aç; sürüm ve yayın tarihini doğrulayabildiğin ölçüde yaz.",
    purpose: "Avalon gerçek araştırma hattı kontrolü. Yalnız resmî kaynaklar; kod çalıştırma veya kurulum yapma.",
    sites: scheduled && !durable ? ["python.org"] : ["python.org", "nodejs.org", "typescriptlang.org"], breadth: 3, depth: 1, mode: durable || !scheduled ? "deep" : "normal",
    outputDirectory: path.join(temp, "output"), ...(scheduled ? { schedule: { kind: "once", date: new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Istanbul", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(Date.now() + 86400000)), time: "23:59", day: 6, timezone: "Europe/Istanbul" } } : {}),
  });
  if (scheduled) {
    schedule = await service.createSchedule(spec);
    await service.scheduleAction(schedule.id, "pause"); await service.scheduleAction(schedule.id, "resume");
    await service.scheduleAction(schedule.id, "run");
    service.close(); // No Avalon service or UI remains to do the work.
    console.log("Native scheduler dispatched; Avalon service stopped. Waiting for the independent runner.");
  } else { run = await service.start(spec); service.close(); console.log("Detached deep research launched; observing durable run state."); }
  const end = Date.now() + (durable ? 30 : 5) * 60000; let last, acceptedCount = 0;
  while (Date.now() < end) {
    const state = scheduled ? service.store.list().find((state) => state.scheduleId === schedule.id) : service.store.get(run.id);
    if (state) {
      run = state;
      const checkpoint = readJson(service.store.file(state.id, "checkpoint.json"));
      const count = checkpoint?.findings?.length ?? acceptedCount;
      assert.ok(count >= acceptedCount, "Accepted findings cannot disappear between checkpoints"); acceptedCount = count;
      const progress = `${state.phase}:${state.sourceCount}:${count}:${state.status}`;
      if (progress !== last) { last = progress; console.log(JSON.stringify({ phase: state.phase, sources: state.sourceCount, findings: count, status: state.status })); }
      if (RESEARCH_TERMINAL.has(state.status)) break;
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  assert.ok(run && RESEARCH_TERMINAL.has(run.status), "The independent runner must reach a terminal state");
  assert.ok(run.sourceCount > 0, "At least one real page must be extracted");
  assert.ok(["completed", "partial"].includes(run.status), `Unexpected research state: ${run.status}: ${run.error}`);
  const checkpoint = readJson(service.store.file(run.id, "checkpoint.json"));
  const sources = readJson(path.join(run.outputPath, "sources.json"));
  assert.equal(checkpoint.engine, "gpt-researcher");
  assert.ok(sources.some((source) => source.url && source.text), "At least one actual retrieved source must be archived");
  assert.equal(sources.length, checkpoint.sources.length);
  assert.ok(fs.existsSync(path.join(run.outputPath, "report.md")));
  console.log(JSON.stringify({ ok: true, scheduled, status: run.status, sourceCount: run.sourceCount,
    searchCounts: run.searchCounts, outputPath: run.outputPath }));
} finally {
  service.close();
  if (run && !RESEARCH_TERMINAL.has(run.status)) service.stop(run.id);
  if (schedule) await service.scheduleAction(schedule.id, "remove").catch((error) => console.error("Test schedule cleanup:", error.message));
  console.log(`Research test diagnostics: ${temp}`);
}
