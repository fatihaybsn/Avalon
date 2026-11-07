// Bounded streaming controls audit; stores counts, final answer and usage, never reasoning text.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadEnvFiles } from "../../electron/configStore.mjs";
import { HermesBrainBridge } from "../../electron/brainModels.mjs";
import { reasoningBody } from "../../electron/brainReasoning.mjs";

const out = path.dirname(fileURLToPath(import.meta.url));
loadEnvFiles({ repoRoot: path.resolve(out, "../..") });
const info = await new HermesBrainBridge({ repoRoot: path.resolve(out, "../..") }).call({ action: "info", provider: "evren" });
if (!info.configured) throw new Error("Evren credential unavailable");
const task = process.argv.includes("--assignment") ? JSON.parse(fs.readFileSync(path.join(out, "benchmark-task.json"), "utf8")) : null;
const native = process.argv.includes("--native");
const medium = process.argv.includes("--medium");
const messages = task?.messages || [{ role: "user", content: "Compute 37*43 + 19*23. Return only the final integer." }];
const max_tokens = task ? 4096 : 512;
const outputFile = task ? "assignment-stream-results.json" : native ? "native-controls-results.json" : medium ? "medium-control.json" : "stream-results.json";
const matrix = task ? [
  ["qwen3.8-flash-next", "low"], ["qwen3.8-flash-next", "xhigh"],
] : medium ? [["qwen3.8-flash-next", "medium"]] : native ? [
  ["qwen3.8-flash-next", "disabled", { reasoning_effort: "none" }],
  ["gemma-4-31b", "disabled", { reasoning_effort: "none" }],
  ["deepseek-v4.1-flash", "enabled", { reasoning_effort: "none" }],
  ["glm-5.3", "enabled", { reasoning_effort: "none" }],
] : [
  ["qwen3.8-flash-next", "disabled"], ["qwen3.8-flash-next", "xhigh"],
  ["qwen3.8-flash-next", "enabled"], ["qwen3.8-flash-next", "enabled", { reasoning_effort: "none" }],
  ["mimo-v2.6-pro", "low"], ["mimo-v2.6-pro", "xhigh"],
  ["mimo-v2.6-pro", "enabled"], ["mimo-v2.6-pro", "enabled", { reasoning_effort: "none" }],
  ["deepseek-v4.1-flash", "low"], ["deepseek-v4.1-flash", "high"],
  ["deepseek-v4.1-flash", "disabled"], ["glm-5.3", "disabled"],
  ["glm-5.3", "low"], ["glm-5.3", "high"],
  ["gemma-4-31b", "disabled"], ["gemma-4-31b", "enabled"],
  ["gemma-4-31b", "enabled", { reasoning_effort: "none" }],
  ["qwen3.8-flash-next", "default"], ["qwen3.8-flash-next", "default", { reasoning_effort: "none" }],
  ["qwen3.8-flash-next", "low", { thinking: true, reasoning_effort: "low" }],
];
const results = [];
async function run([modelId, reasoning, extra = {}]) {
  const controls = { ...reasoningBody({ provider: "evren", modelId, reasoning }), ...extra };
  const result = { model: modelId, reasoning, controls, max_tokens, injectedHermesNone: extra.reasoning_effort === "none", reasoningChars: 0, content: "", chunks: 0 };
  const start = performance.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), task ? 180000 : 45000);
  console.log(JSON.stringify({ event: "start", ...result }));
  const elapsed = () => Math.round((performance.now() - start) / 10) / 100;
  try {
    const response = await fetch(info.baseUrl + "/chat/completions", { method: "POST", headers: { Authorization: `Bearer ${info.key}`, "Content-Type": "application/json" }, body: JSON.stringify({ model: modelId, messages, stream: true, stream_options: { include_usage: true }, temperature: 0, seed: 54231, max_tokens, ...controls }), signal: controller.signal });
    result.httpStatus = response.status;
    result.headerSeconds = elapsed();
    result.requestId = response.headers.get("x-request-id");
    if (!response.ok) { result.error = await response.json(); return result; }
    let buffer = "";
    for await (const chunk of response.body) {
      buffer += Buffer.from(chunk).toString("utf8");
      let split;
      while ((split = buffer.indexOf("\n")) !== -1) {
        const line = buffer.slice(0, split).trim(); buffer = buffer.slice(split + 1);
        if (!line.startsWith("data:") || line.slice(5).trim() === "[DONE]") continue;
        let data;
        try { data = JSON.parse(line.slice(5).trim()); } catch { continue; }
        result.chunks++;
        if (data.error) result.error = data.error;
        if (data.model) result.responseModel = data.model;
        if (data.usage) result.usage = data.usage;
        for (const choice of data.choices || []) {
          if (choice.finish_reason) result.finishReason = choice.finish_reason;
          const delta = choice.delta || {};
          if (typeof delta.content === "string") {
            if (delta.content && result.firstContentSeconds === undefined) result.firstContentSeconds = elapsed();
            result.content += delta.content;
          }
          for (const key of ["reasoning", "reasoning_content", "thinking"]) {
            if (typeof delta[key] === "string" && delta[key]) {
              if (result.firstReasoningSeconds === undefined) result.firstReasoningSeconds = elapsed();
              result.reasoningChars += delta[key].length;
            }
          }
        }
      }
    }
    result.completed = true;
  } catch (error) { result.error = String(error.message).replaceAll(info.key, "[redacted]"); result.aborted = controller.signal.aborted; }
  finally { clearTimeout(timer); result.seconds = elapsed(); }
  if (task) {
    try {
      const answer = JSON.parse(result.content.replace(/^```(?:json)?\s*/, "").replace(/\s*```$/, "").trim());
      const valid = Array.isArray(answer.jobs) && answer.jobs.length === 5 && new Set(answer.jobs).size === 5 && answer.jobs.every(n => Number.isInteger(n) && n >= 1 && n <= 5);
      const cost = valid ? answer.jobs.reduce((sum, col, row) => sum + task.costs[row][col - 1], 0) : null;
      result.correct = Boolean(valid && cost === task.optimum && answer.cost === task.optimum);
    } catch { result.correct = false; }
  } else result.correct = result.content.trim() === "2028";
  return result;
}
for (let i = 0; i < matrix.length; i += 2) {
  const batch = await Promise.allSettled(matrix.slice(i, i + 2).map(run));
  for (const value of batch) {
    const result = value.status === "fulfilled" ? value.value : { error: String(value.reason).replaceAll(info.key, "[redacted]") };
    results.push(result); console.log(JSON.stringify(result));
  }
  fs.writeFileSync(path.join(out, outputFile), JSON.stringify({ at: new Date().toISOString(), messages, max_tokens, results }, null, 2) + "\n");
  if (results.some(r => [401, 403, 429].includes(r.httpStatus))) break;
}
