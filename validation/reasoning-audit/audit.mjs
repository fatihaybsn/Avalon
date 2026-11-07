// Read-only provider audit. Sends bounded synthetic prompts; never selects/prepares a provider.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadEnvFiles } from "../../electron/configStore.mjs";
import { HermesBrainBridge } from "../../electron/brainModels.mjs";
import { reasoningBody } from "../../electron/brainReasoning.mjs";

const out = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(out, "../..");
loadEnvFiles({ repoRoot: root });
const bridge = new HermesBrainBridge({ repoRoot: root });
const info = await bridge.call({ action: "info", provider: "evren" });
if (!info.configured) throw new Error("Evren credential unavailable");

const costs = [[17, 8, 21, 14, 11], [9, 19, 7, 16, 13], [12, 6, 18, 9, 20], [15, 11, 13, 5, 8], [10, 14, 9, 18, 6]];
let optimum = Infinity, solutions = [];
function solve(p = []) {
  if (p.length === costs.length) {
    const cost = p.reduce((sum, col, row) => sum + costs[row][col], 0);
    if (cost < optimum) { optimum = cost; solutions = []; }
    if (cost === optimum) solutions.push(p.map((n) => n + 1));
    return;
  }
  for (let col = 0; col < costs.length; col++) if (!p.includes(col)) solve([...p, col]);
}
solve();
const messages = [
  { role: "system", content: "Solve the user's problem accurately. Return only the requested JSON, without an explanation. Do not use external tools." },
  { role: "user", content: `Assign five workers (rows 1..5) to five jobs (columns 1..5), each job used exactly once. Cost matrix: ${JSON.stringify(costs)}. Minimize total cost. Return only JSON with keys cost (integer minimum) and jobs (array of five 1-based column numbers, in row order).` },
];
const matrix = [
  ["qwen3.8-flash-next", ["disabled", "enabled", "high", "xhigh", "default"]],
  ["mimo-v2.6-pro", ["disabled", "low", "xhigh", "enabled", "none"]],
  ["glm-5.3", ["disabled", "low", "high"]],
  ["deepseek-v4.1-flash", ["disabled", "low", "high"]],
  ["gemma-4-31b", ["disabled", "enabled"]],
];
const results = [];
fs.writeFileSync(path.join(out, "benchmark-task.json"), JSON.stringify({ messages, costs, optimum, solutions, temperature: 0, seed: 54231, max_tokens: 2048 }, null, 2) + "\n");
const jobs = matrix.flatMap(([modelId, levels]) => levels.map((reasoning) => ({ provider: "evren", modelId, reasoning })));
for (let batch = 0; batch < jobs.length; batch += 2) {
  const settled = await Promise.allSettled(jobs.slice(batch, batch + 2).map(async (route) => {
    const body = { model: route.modelId, messages, stream: false, temperature: 0, seed: 54231, max_tokens: 2048, ...reasoningBody(route) };
    const start = performance.now();
    console.log(JSON.stringify({ event: "start", model: route.modelId, reasoning: route.reasoning }));
    try {
      const response = await fetch(info.baseUrl + "/chat/completions", { method: "POST", headers: { Authorization: `Bearer ${info.key}`, "Content-Type": "application/json" }, body: JSON.stringify(body), signal: AbortSignal.timeout(120000) });
      const data = await response.json();
      const message = data.choices?.[0]?.message || {};
      const content = typeof message.content === "string" ? message.content : message.content == null ? "" : JSON.stringify(message.content);
      const reasoningFields = Object.fromEntries(Object.entries(message).filter(([key]) => /reason|think/i.test(key)).map(([key, value]) => [key, value == null ? 0 : typeof value === "string" ? value.length : JSON.stringify(value)?.length || 0]));
      let parsed;
      try { parsed = JSON.parse(content.replace(/^```(?:json)?\s*/, "").replace(/\s*```$/, "").trim()); } catch {}
      const valid = parsed && Array.isArray(parsed.jobs) && parsed.jobs.length === 5 && new Set(parsed.jobs).size === 5 && parsed.jobs.every((n) => Number.isInteger(n) && n >= 1 && n <= 5);
      const actualCost = valid ? parsed.jobs.reduce((sum, col, row) => sum + costs[row][col - 1], 0) : null;
      const usage = data.usage ? { ...data.usage } : undefined;
      if (usage?.evren) usage.evren = { routed_model: usage.evren.routed_model, reasoning_budget_exhausted: usage.evren.reasoning_budget_exhausted };
      return { model: route.modelId, reasoning: route.reasoning, wire: reasoningBody(route), httpStatus: response.status, seconds: Math.round((performance.now() - start) / 10) / 100, responseModel: data.model, finishReason: data.choices?.[0]?.finish_reason, usage, reasoningFields, messageKeys: Object.keys(message), headers: Object.fromEntries([...response.headers].filter(([key]) => /reason|think|request-id|processing|warning/i.test(key))), content, correct: Boolean(valid && parsed.cost === optimum && actualCost === optimum), error: data.error };
    } catch (error) { return { model: route.modelId, reasoning: route.reasoning, wire: reasoningBody(route), seconds: Math.round((performance.now() - start) / 10) / 100, error: error.message.replaceAll(info.key, "[redacted]") }; }
  }));
  for (const item of settled) {
    const result = item.status === "fulfilled" ? item.value : { error: String(item.reason).replaceAll(info.key, "[redacted]") };
    results.push(result);
    console.log(JSON.stringify(result));
  }
  fs.writeFileSync(path.join(out, "live-results.json"), JSON.stringify({ at: new Date().toISOString(), optimum, max_tokens: 2048, results }, null, 2) + "\n");
  if (results.some((r) => [401, 403, 429].includes(r.httpStatus))) { console.log("Stopped on provider access/quota limit"); break; }
}
