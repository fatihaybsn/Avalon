// Read-only provider review. Saves counts/final answers; never saves credentials or reasoning text.
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { loadEnvFiles } from "../../electron/configStore.mjs";
import { BRAIN_MODELS, BRAIN_PROVIDERS, HermesBrainBridge, readSelectedBrain } from "../../electron/brainModels.mjs";
import { reasoningOptions } from "../../electron/brainReasoning.mjs";

const out = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(out, "../..");
loadEnvFiles({ repoRoot: root });
const bridge = new HermesBrainBridge({ repoRoot: root });
const save = (name, data) => fs.writeFileSync(path.join(out, name), JSON.stringify(data, null, 2) + "\n");
const controls = BRAIN_MODELS.flatMap(model => reasoningOptions(model).map(option => ({
  provider: model.provider, model: model.modelId, selection: option.value,
  body: option.wire, baseUrl: BRAIN_PROVIDERS[model.provider].baseUrl,
})));
save("ui-controls.json", controls);
const python = bridge.candidates().find(p => fs.existsSync(p));
if (!python) throw new Error("Installed Hermes Python not found");
const capture = spawnSync(python, ["-B", path.join(out, "capture.py")], {
  env: { ...process.env, HERMES_HOME: bridge.home(), PYTHONIOENCODING: "utf-8" },
  input: JSON.stringify(controls), encoding: "utf8", windowsHide: true, timeout: 30000,
});
if (capture.status !== 0) throw new Error("Offline capture failed: " + capture.stderr.slice(-1000));
const wire = JSON.parse(capture.stdout.trim());
save("hermes-wire.json", { at: new Date().toISOString(), selected: readSelectedBrain(), ...wire });
console.log(JSON.stringify({ event: "offline", global: wire.current_global, captured: wire.results.length }));
if (!process.argv.includes("--live")) process.exit(0);
const info = await bridge.call({ action: "info", provider: "evren" });
if (!info.configured) throw new Error("Evren credential unavailable");
const metadata = await Promise.allSettled(["/models", "/../openapi.json"].map(async endpoint => {
  const url = endpoint === "/models" ? info.baseUrl + endpoint : new URL("../openapi.json", info.baseUrl + "/").href;
  const response = await fetch(url, { headers: { Authorization: `Bearer ${info.key}` }, signal: AbortSignal.timeout(15000), redirect: "error" });
  const data = await response.json();
  return endpoint === "/models" ? { source: url, status: response.status, models: data.data?.map(m => ({ id: m.id, capabilities: m.capabilities, default_max_output_tokens: m.default_max_output_tokens })) }
    : { source: url, status: response.status, schema: data.components?.schemas?.ChatCompletionRequest };
}));
save("provider-metadata.json", metadata.map(r => r.status === "fulfilled" ? r.value : { error: String(r.reason).replaceAll(info.key, "[redacted]") }));
const costs = [[17,8,21,14],[9,19,7,16],[12,6,18,9],[15,11,13,5]];
function permutations(xs) { return xs.length ? xs.flatMap((x, i) => permutations(xs.filter((_, j) => j !== i)).map(rest => [x, ...rest])) : [[]]; }
const optimum = Math.min(...permutations([1,2,3,4]).map(cols => cols.reduce((s,c,r) => s + costs[r][c-1],0)));
const tasks = [
  { id: "easy", prompt: "Compute 37*43 + 19*23. Return only the final integer.", expected: 2028 },
  { id: "assignment", prompt: `Assign four workers (rows 1..4) to four jobs (columns 1..4), using each job once. Cost matrix: ${JSON.stringify(costs)}. Minimize total cost. Return only JSON with keys cost (integer minimum) and jobs (array of four 1-based column numbers, in row order).`, costs, optimum },
];
save("tasks.json", tasks);
const jobs = tasks.flatMap(task => [54231, 54232].flatMap((seed, i) => (i ? ["xhigh", "low"] : ["low", "xhigh"]).map(level => ({ task, seed, level }))));
const results = [];
async function run({ task, seed, level }) {
  const result = { task: task.id, seed, level, controls: { thinking: true, reasoning_effort: level }, max_tokens: 8192, timeout_ms: 60000, reasoningChars: 0, content: "" };
  const started = performance.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 60000);
  const elapsed = () => Math.round(performance.now() - started) / 1000;
  try {
    const response = await fetch(info.baseUrl + "/chat/completions", { method: "POST", headers: { Authorization: `Bearer ${info.key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model: "qwen3.8-flash-next", messages: [{ role: "user", content: task.prompt }], stream: true, stream_options: { include_usage: true }, temperature: 0, seed, max_tokens: 8192, ...result.controls }), signal: controller.signal, redirect: "error" });
    result.status = response.status;
    result.requestId = response.headers.get("x-request-id");
    if (!response.ok) { result.error = await response.json(); return result; }
    let buffer = "";
    const decoder = new TextDecoder();
    function consume(line) {
      if (!line.startsWith("data:")) return;
      const raw = line.slice(5).trim();
      if (raw === "[DONE]") { result.done = true; return; }
      let data; try { data = JSON.parse(raw); } catch { return; }
      if (data.error) result.error = data.error;
      if (data.usage) result.usage = data.usage;
      if (data.model) result.responseModel = data.model;
      for (const choice of data.choices || []) {
        if (choice.finish_reason) result.finishReason = choice.finish_reason;
        const delta = choice.delta || {};
        if (typeof delta.content === "string" && delta.content) { result.firstContentSeconds ??= elapsed(); result.content += delta.content; }
        for (const field of ["reasoning", "reasoning_content", "thinking"]) if (typeof delta[field] === "string" && delta[field]) { result.firstReasoningSeconds ??= elapsed(); result.reasoningChars += delta[field].length; }
      }
    }
    for await (const chunk of response.body) {
      buffer += decoder.decode(chunk, { stream: true });
      let split; while ((split = buffer.indexOf("\n")) !== -1) { consume(buffer.slice(0, split).trim()); buffer = buffer.slice(split + 1); }
    }
    buffer += decoder.decode(); if (buffer.trim()) consume(buffer.trim());
    result.completed = true;
    if (task.id === "easy") result.correct = result.content.trim() === String(task.expected);
    else {
      try {
        const answer = JSON.parse(result.content.replace(/^```(?:json)?\s*/, "").replace(/\s*```$/, "").trim());
        const valid = Array.isArray(answer.jobs) && answer.jobs.length === 4 && new Set(answer.jobs).size === 4 && answer.jobs.every(n => Number.isInteger(n) && n >= 1 && n <= 4);
        const cost = valid ? answer.jobs.reduce((s,c,r) => s + costs[r][c-1],0) : null;
        result.correct = valid && answer.cost === optimum && cost === optimum;
      } catch { result.correct = false; }
    }
  } catch (error) { result.error = String(error.message).replaceAll(info.key, "[redacted]"); result.aborted = controller.signal.aborted; }
  finally { clearTimeout(timer); result.seconds = elapsed(); }
  return result;
}
// Sequential paired controls avoid adding concurrent load; two seeds, reverse order on repeat.
for (const job of jobs) {
  console.log(JSON.stringify({ event: "start", task: job.task.id, seed: job.seed, level: job.level }));
  const result = await run(job);
  results.push(result); save("live-results.json", { at: new Date().toISOString(), results });
  console.log(JSON.stringify(result));
  if ([401,403,429].includes(result.status)) break;
}
