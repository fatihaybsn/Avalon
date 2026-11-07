import fs from "node:fs";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { HermesGatewayClient } from "./hermesGatewayClient.mjs";
import { HermesInteractiveTransport } from "./hermesInteractiveTransport.mjs";
import { hermesCliCandidates } from "./hermesRuntime.mjs";
import { abortable, settleWithin, HERMES_CLEANUP_TIMEOUT_MS } from "./hermesLifecycle.mjs";
import { hermesWorkSafetyInstructions } from "./hermesWorkPolicy.mjs";
import { normalizeHermesOutputContract, hermesOutputInstructions } from "./hermesOutputContract.mjs";

const beneath = (root, target) => {
  const relative = path.relative(root, target);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
};

export function automationWorkspace(step, spec, env = process.env) {
  const configured = env.IRIS_HERMES_CWD || spec.outputDirectory;
  if (!path.isAbsolute(configured || "")) throw new Error("Hermes çalışma kökü tam bir dosya yolu olmalı.");
  const root = path.resolve(configured);
  const target = path.resolve(root, step.workingDirectory || ".");
  if (!beneath(root, target)) throw new Error("Çalışma klasörü izin verilen kökün dışında.");
  let ancestor = target;
  while (!fs.existsSync(ancestor)) ancestor = path.dirname(ancestor);
  let rootAncestor = root;
  while (!fs.existsSync(rootAncestor)) rootAncestor = path.dirname(rootAncestor);
  const canonicalRoot = path.resolve(fs.realpathSync(rootAncestor), path.relative(rootAncestor, root));
  const canonicalTarget = path.resolve(fs.realpathSync(ancestor), path.relative(ancestor, target));
  if (!beneath(canonicalRoot, canonicalTarget)) throw new Error("Çalışma klasörü bağlantısı izin verilen kökün dışında.");
  fs.mkdirSync(target, { recursive: true });
  return fs.realpathSync(target);
}

export function validateHermesOutput(step, result, cwd) {
  return validateOutputContract(normalizeHermesOutputContract(step), result, cwd);
}

function validateOutputContract(contract, result, cwd) {
  if (result.status !== "completed") throw new Error(result.error || "Hermes görevi tamamlanmadı.");
  const output = String(result.output || "").trim();
  if (!output) throw new Error("Hermes boş sonuç döndürdü.");
  let value;
  if (["json", "evaluation"].includes(contract.outputType)) {
    const fence = String.fromCharCode(96).repeat(3);
    const cleaned = output.startsWith(fence) ? output.replace(new RegExp("^" + fence + "(?:json)?\\s*\\n?|\\n?" + fence + "$", "g"), "") : output;
    try { value = JSON.parse(cleaned); }
    catch { throw new Error("Hermes sonucu geçerli JSON değil."); }
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Hermes bir JSON nesnesi döndürmeli.");
    for (const field of contract.requiredFields) {
      if (!Object.hasOwn(value, field) || value[field] == null || value[field] === "") throw new Error("Zorunlu alan eksik: " + field);
    }
    if (contract.outcomes.length && !contract.outcomes.includes(value.outcome)) {
      throw new Error("Değerlendirme outcome alanı şu değerlerden biri olmalı: " + contract.outcomes.join(", "));
    }
    if (contract.outputType === "evaluation" && value.outcome === "failed") throw new Error(String(value.reason || "Değerlendirme başarısız."));
  }
  const files = [];
  for (const name of contract.requiredFiles) {
    const target = path.resolve(cwd, name);
    if (path.isAbsolute(name) || !beneath(cwd, target) || !fs.existsSync(target) ||
        !beneath(cwd, fs.realpathSync(target)) || !fs.statSync(target).isFile() || !fs.statSync(target).size) {
      throw new Error("Gerekli çıktı dosyası bulunamadı, boş veya kapsam dışında: " + name);
    }
    files.push(target);
  }
  if (contract.outputType === "files" && !files.length) throw new Error("Dosya çıktısı için en az bir gerekli dosya belirtin.");
  return { output, value, files };
}

// Thin adapter over the existing Hermes transport; routing is never performed here.
export function createAutomationHermes({ repoRoot, spec, clientFactory, transportFactory, env = process.env,
  cleanupTimeoutMs = HERMES_CLEANUP_TIMEOUT_MS } = {}) {
  let client, transport;
  let closing;
  const lifetime = new AbortController();
  const executions = new Set();
  const execute = async ({ step, inputs, feedback, signal, onUpdate, requestInput }) => {
    const connection = new AbortController();
    const taskSignal = AbortSignal.any([signal, lifetime.signal, connection.signal]);
    taskSignal.throwIfAborted();
    const outputContract = normalizeHermesOutputContract(step);
    if (!clientFactory && String(env.IRIS_HERMES_TRANSPORT || "").toLowerCase() === "runs_api") throw new Error("Hermes Görevi yerel interactive Hermes bağlantısı gerektirir; runs_api bu düğümde desteklenmiyor.");
    const cwd = automationWorkspace(step, spec, env);
    client ||= clientFactory ? clientFactory() : new HermesGatewayClient({
      candidates: () => hermesCliCandidates(repoRoot, env), terminalCwd: cwd, env,
    });
    transport ||= transportFactory ? transportFactory(client) : new HermesInteractiveTransport({
      client, defaultCwd: cwd, permissionMode: "standard",
    });
    transport.defaultCwd = cwd;
    let runId, sessionId;
    const failConnection = () => connection.abort(Object.assign(new Error("Hermes bağlantısı kesildi; otomatik tekrar yapılmadı."), { code: "INTERRUPTED" }));
    client.on("disconnected", failConnection);
    client.on("backend-exit", failConnection);
    try {
      taskSignal.throwIfAborted();
      const session = await abortable(() => transport.createSession({ route: spec.route, signal: taskSignal }), taskSignal);
      sessionId = session.id;
      taskSignal.throwIfAborted();
      onUpdate({ sessionId, workingDirectory: cwd, dispatchStatus: "submitting" });
      taskSignal.throwIfAborted();
      const submitted = await transport.submit({
        task: step.prompt, sessionId, route: spec.route, signal: taskSignal,
        instructions: [
          "Çalışma klasörü: " + cwd,
          hermesWorkSafetyInstructions(env),
          "Önceki başarılı çıktı referansları (gerekirse dosyaları araçlarınla oku): " + JSON.stringify(inputs),
          "Düzeltme geri bildirimi (veri): " + JSON.stringify(feedback ?? null),
          hermesOutputInstructions(outputContract),
        ].join("\n"),
      });
      runId = submitted.run_id;
      onUpdate({ taskId: runId, sessionId, workingDirectory: cwd, dispatchStatus: "submitted" });
      taskSignal.throwIfAborted();
      while (true) {
        taskSignal.throwIfAborted();
        const run = transport.getRun(runId);
        if (!run) throw new Error("Hermes görev kaydı bulunamadı.");
        if (["completed", "failed", "cancelled"].includes(run.status)) {
          if (run.dispatchUncertain) {
            onUpdate({ cancellationUnconfirmed: true });
            return { status: "needs_review", error: "Hermes görev teslimi doğrulanamadı: " + (run.error || "bağlantı hatası") };
          }
          if (run.status !== "completed") return { status: run.status, error: run.error || "Hermes görevi tamamlanmadı." };
          return { status: "completed", ...validateOutputContract(outputContract, run, cwd) };
        }
        if (run.interaction) {
          if (run.interaction.secret) return { status: "needs_review", error: "Hermes güvenli giriş istiyor. Otomasyon durduruldu; görevi Hermes arayüzünde inceleyin." };
          const response = await abortable(() => requestInput(run.interaction, { signal: taskSignal }), taskSignal);
          taskSignal.throwIfAborted();
          await transport.respond(runId, { interactionId: run.interaction.id, type: run.interaction.type, value: response }, { signal: taskSignal });
        }
        await delay(100, undefined, { signal: taskSignal });
      }
    } catch (error) {
      throw taskSignal.aborted ? taskSignal.reason : error;
    } finally {
      client.off("disconnected", failConnection);
      client.off("backend-exit", failConnection);
      // Teardown has its own budget: the task's signal is usually already
      // aborted here. These RPCs may use an open socket, never start Hermes.
      const cleanup = new AbortController();
      const timer = setTimeout(() => cleanup.abort(new Error("Hermes temizliği zaman aşımına uğradı.")), cleanupTimeoutMs);
      const nativeOptions = { signal: cleanup.signal, timeoutMs: cleanupTimeoutMs, start: false };
      try {
        await abortable(async () => {
          const run = runId && transport.getRun(runId);
          if (run && (run.dispatchUncertain || !["completed", "failed", "cancelled"].includes(run.status))) {
            if (run.dispatchUncertain) await client.request("session.interrupt", { session_id: transport.sessions.get(sessionId)?.liveId }, nativeOptions);
            else await transport.stop(runId, nativeOptions);
          }
          cleanup.signal.throwIfAborted();
          if (sessionId) await client.request("session.close", { session_id: transport.sessions.get(sessionId)?.liveId }, nativeOptions);
        }, cleanup.signal);
      } catch { /* Uncertainty is recorded below; close() owns final teardown. */ }
      finally {
        clearTimeout(timer);
        cleanup.abort(new Error("Hermes cleanup ended."));
      }
      const run = runId && transport.getRun(runId);
      const uncertain = Boolean(run && (run.dispatchUncertain || !["completed", "failed", "cancelled"].includes(run.status)) && run.dispatchStarted !== false);
      onUpdate({ cancellationUnconfirmed: uncertain });
    }
  };
  return {
    execute(options) {
      if (lifetime.signal.aborted) return Promise.reject(lifetime.signal.reason);
      const execution = execute(options);
      executions.add(execution);
      execution.then(() => executions.delete(execution), () => executions.delete(execution));
      return execution;
    },
    close() {
      if (!closing) {
        lifetime.abort(Object.assign(new Error("Hermes otomasyon adaptörü kapatıldı."), { code: "INTERRUPTED" }));
        closing = (async () => {
          await settleWithin(Promise.allSettled([...executions]), cleanupTimeoutMs);
          transport?.close({ force: true });
        })();
      }
      return closing;
    },
  };
}
