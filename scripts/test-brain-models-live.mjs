// Opt-in model checks. No microphone/speaker access, default changes or computer work.
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadEnvFiles } from "../electron/configStore.mjs";
import { BRAIN_MODELS, DEFAULT_BRAIN, BrainModelService, HermesBrainBridge } from "../electron/brainModels.mjs";
import { HermesGatewayClient } from "../electron/hermesGatewayClient.mjs";
import { HermesInteractiveTransport } from "../electron/hermesInteractiveTransport.mjs";
import { conversationContext, decodeBrainReply } from "../electron/voiceRelay.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
loadEnvFiles({ repoRoot: root });
const bridge = new HermesBrainBridge({ repoRoot: root });
const service = new BrainModelService({ bridge, persist() {}, isSafe: () => false, apply() {} });
const reasoningCheck = process.argv.includes("--reasoning");
const models = process.argv.includes("--hermes-only") ? [] : process.argv.includes("--all") ? BRAIN_MODELS : BRAIN_MODELS.filter((m) => m.provider === DEFAULT_BRAIN.provider && m.modelId === DEFAULT_BRAIN.modelId).map((m) => reasoningCheck ? { ...m, reasoning: "disabled" } : m);
const blocked = new Set();
for (const model of models) {
  if (blocked.has(model.provider)) {
    console.log(JSON.stringify({ provider: model.provider, modelId: model.modelId, status: "not_tested_provider_blocked" }));
    continue;
  }
  const info = await service.info(model.provider, model.provider === "opencode" ? process.env.IRIS_OPENCODE_API_KEY : "");
  if (!info.configured) {
    blocked.add(model.provider);
    console.log(JSON.stringify({ provider: model.provider, modelId: model.modelId, status: "not_tested_no_key" }));
    continue;
  }
  console.log(JSON.stringify({ provider: model.provider, modelId: model.modelId, status: "testing" }));
  const result = await service.test(model, model.provider === "opencode" ? process.env.IRIS_OPENCODE_API_KEY : "");
  console.log(JSON.stringify({ provider: model.provider, modelId: model.modelId, ...result }));
  if (["quota", "access", "credentials"].includes(result.kind)) blocked.add(model.provider);
}

if (process.argv.includes("--hermes") || process.argv.includes("--hermes-only")) {
  const client = new HermesGatewayClient({
    candidates: () => [{ cmd: process.env.HERMES_BIN || "hermes", args: [] }],
    env: { ...process.env, HERMES_TUI_TOOLSETS: "web,clarify" },
  });
  const routes = [];
  const transport = new HermesInteractiveTransport({ client, conversationOnly: true,
    prepareRoute: (route) => service.prepare(route), onRoute: (_id, route) => routes.push(route),
  });
  let session;
  let currentRun;
  async function turn(route, text) {
    const completed = new Promise((resolve, reject) => {
      const timeout = setTimeout(() => { transport.off("complete", finish); reject(new Error("Hermes model check timed out")); }, 90000);
      function finish(item) { clearTimeout(timeout); transport.off("complete", finish); resolve(item); }
      transport.on("complete", finish);
    });
    const run = await transport.submit({ sessionId: session.id, route, kind: "conversation", task: text,
      context: conversationContext("This is a harmless isolated compatibility check. Never access files or web. Return the Avalon JSON contract.") });
    currentRun = run.run_id;
    const result = await completed;
    assert.equal(result.status, "completed", result.error);
    return decodeBrainReply(result.output);
  }
  try {
    session = await transport.createSession({ hidden: true, route: DEFAULT_BRAIN });
    const first = await turn(DEFAULT_BRAIN, "Bu zararsız denemede tercih ettiğim renk turkuaz. Bunu kısa bir Türkçe cümleyle onayla. Avalon JSON biçiminde cevap ver; görev önerme.");
    assert.match(first.reply, /turkuaz/i);
    const alternate = reasoningCheck ? { ...DEFAULT_BRAIN, reasoning: "disabled" } : { provider: "evren", modelId: "glm-5.3" };
    await transport.switchModel(session.id, alternate);
    const reply = await turn(alternate, "Önceki turda verdiğim tercih ettiğim renk neydi? Yalnız önceki konuşmaya dayan; Avalon JSON biçiminde cevap ver.");
    assert.match(reply.reply, /turkuaz/i);
    assert.deepEqual(routes.at(-1), alternate);
    console.log(JSON.stringify({ nativeHermes: "passed", routeSwitch: true, conversationPreserved: true, ...(reasoningCheck ? { reasoningSwitch: true } : {}) }));
  } finally {
    if (currentRun && !["completed", "failed", "cancelled"].includes(transport.getRun(currentRun)?.status)) await transport.stop(currentRun).catch(() => {});
    if (session) await transport.deleteSession(session.id).catch(() => {});
    client.close();
  }
}
