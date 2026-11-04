import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { on } from "node:events";
import { automationRoot, automationResearchSpec, getAutomationFlows, startAutomationHost } from "./automationRuntime.mjs";
import { openAutomationMemory, withoutRecordManifest } from "./automationMemory.mjs";
import { processAlive, readJson, writeJson } from "./researchStore.mjs";

export function listAutomationRuns(root, flowId) {
  const directory = path.join(root, "runs");
  if (!fs.existsSync(directory)) return [];
  return fs.readdirSync(directory).map((id) => readJson(path.join(directory, id, "run.json")))
    .filter((run) => run?.flowId === flowId).sort((a, b) => b.startedAt - a.startedAt).map((run) =>
      run.status === "running" && !processAlive(run.pid)
        ? { ...run, status: "interrupted", steps: run.steps.map((step) => step.status === "running"
          ? { ...step, status: "interrupted" } : step), error: "Otomasyon çalıştırıcısı kesildi." }
        : run);
}

function inputReports(store, run, step, completed, memory) {
  let size = 0;
  return step.inputs.map((id) => {
    const prior = completed.get(id);
    const report = prior && store.get(prior.researchId);
    if (report?.automationRunId !== run.id || report.status !== "completed" || !report.reportReady) {
      throw new Error(`Tamamlanmış rapor bulunamadı: ${prior?.name || id}`);
    }
    const content = fs.readFileSync(path.join(report.outputPath, "report.md"), "utf8").trim();
    const markdown = memory ? withoutRecordManifest(content) : content;
    if (!markdown) throw new Error(`Rapor boş: ${prior.name}`);
    size += markdown.length;
    if (step.spec.mode !== "synthesis" && size > 48000) {
      throw new Error(`Rapor girdileri 48.000 karakteri aşıyor: ${prior.name}`);
    }
    return { name: prior.name, markdown };
  });
}

export async function runAutomation({ schedule, occurrence, store, runResearch, startHost = startAutomationHost }) {
  const { spec } = schedule;
  const { stateRoot, repoRoot } = spec.runtime;
  const root = automationRoot(stateRoot);
  const id = crypto.createHash("sha256").update(JSON.stringify([schedule.id, occurrence])).digest("hex");
  const directory = path.join(root, "runs", id);
  const file = path.join(directory, "run.json");
  const run = { id, flowId: spec.automationFlowId, startedAt: Date.now(), pid: process.pid, status: "running", steps: [] };
  const save = () => writeJson(file, run);
  const aborted = new AbortController();
  const checkCancellation = () => {
    if (fs.existsSync(path.join(directory, "cancel.json"))) {
      aborted.abort(Object.assign(new Error("Otomasyon turu kullanıcı tarafından iptal edildi."), { code: "CANCELLED" }));
    }
  };
  const cancellation = setInterval(checkCancellation, 250);
  let child, deadline, current;
  const resetDeadline = () => {
    clearTimeout(deadline);
    deadline = setTimeout(() => aborted.abort(new Error("Node-RED sıradaki adımı başlatmadı.")), 30000);
  };
  try {
    save();
    const flow = getAutomationFlows(root, repoRoot).find((item) => item.id === run.flowId);
    if (!flow || flow.error) throw new Error(flow?.error || "Kayıtlı otomasyon akışı bulunamadı.");
    const steps = flow.steps.map((step) => ({ ...step, spec: automationResearchSpec(step, spec) }));
    run.steps = steps.map(({ id, name }) => ({ id, name, status: "waiting" }));
    run.revision = crypto.createHash("sha256").update(JSON.stringify(flow)).digest("hex");
    writeJson(path.join(directory, "revision.json"), flow);
    writeJson(path.join(directory, "flows.json"), flow.graph);
    save();
    const memory = openAutomationMemory(root, flow);

    child = startHost({ root, repoRoot, mode: "execute", userDir: directory, log: path.join(directory, "node-red.log") });
    child.once("error", (error) => aborted.abort(error));
    child.once("disconnect", () => {
      const error = new Error("Node-RED çalıştırıcısının bağlantısı kesildi.");
      error.code = "INTERRUPTED";
      aborted.abort(error);
    });
    const completed = new Map();
    resetDeadline();
    for await (const [message] of on(child, "message", { signal: aborted.signal })) {
      clearTimeout(deadline);
      checkCancellation();
      aborted.signal.throwIfAborted();
      if (message.kind === "error") throw new Error(message.error);
      if (message.kind === "finish" && completed.size === steps.length) {
        run.status = "completed";
        break;
      }
      if (message.kind === "ready") child.send({ kind: "start" });
      else if (message.kind === "step" && steps[completed.size]?.id === message.id) {
        const step = steps[completed.size];
        current = run.steps[completed.size];
        const reports = inputReports(store, run, step, completed, memory);
        const context = memory?.prepare(step, reports) || { reports, instruction: "" };
        const research = store.create({ ...step.spec, ...(context.synthesize ? { mode: "synthesis" } : {}),
          purpose: step.spec.purpose + context.instruction, runtime: spec.runtime }, { automationRunId: id });
        Object.assign(current, { status: "running", researchId: research.id });
        save();
        const result = await runResearch(research.id, context.reports, aborted.signal);
        current.status = result.status;
        checkCancellation();
        aborted.signal.throwIfAborted();
        if (result.status !== "completed" || !result.reportReady) {
          if (current.status === "completed") current.status = "partial";
          run.status = completed.size || result.output ? "partial" : "failed";
          run.error = result.error || result.limitations?.at(-1) || `${step.name} tamamlanmadı. Bağımlı adımlar bekliyor.`;
          break;
        }
        try {
          memory?.commit(step, result.output);
        } catch (error) {
          current.status = "partial";
          throw new Error(`${step.name}: ${error.message}`, { cause: error });
        }
        completed.set(step.id, current);
        save();
        child.send({ kind: "stepResult", id: step.id, ok: true });
      } else throw new Error("Node-RED beklenmeyen bir aşama bildirdi.");
      resetDeadline();
    }
    if (run.status === "running") throw new Error("Node-RED akışı sonuç vermeden kapandı.");
  } catch (error) {
    const reason = aborted.signal.reason || error;
    const interrupted = reason.code === "INTERRUPTED";
    const cancelled = reason.code === "CANCELLED";
    if (current && ["waiting", "running"].includes(current.status)) {
      current.status = cancelled ? "cancelled" : interrupted ? "interrupted" : "failed";
    }
    run.status = cancelled ? "cancelled" : interrupted ? "interrupted" : run.steps.some((step) => step.status === "completed") ? "partial" : "failed";
    run.error = reason.message.slice(0, 1000);
  } finally {
    clearTimeout(deadline);
    clearInterval(cancellation);
    if (child?.connected) child.disconnect();
    run.finishedAt = Date.now();
    save();
  }
  return run;
}
