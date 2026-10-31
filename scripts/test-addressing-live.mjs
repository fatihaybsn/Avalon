// Opt-in: two real Hermes turns in a disposable restricted conversation.
import assert from "node:assert/strict";
import { loadEnvFiles } from "../electron/configStore.mjs";
import { HermesGatewayClient } from "../electron/hermesGatewayClient.mjs";
import { HermesInteractiveTransport } from "../electron/hermesInteractiveTransport.mjs";
import { conversationContext, decodeBrainReply } from "../electron/voiceRelay.mjs";
import { BrainModelService, HermesBrainBridge, DEFAULT_BRAIN } from "../electron/brainModels.mjs";

loadEnvFiles({ repoRoot: process.cwd() });
const route = { provider: process.env.IRIS_BRAIN_APPLIED_PROVIDER || DEFAULT_BRAIN.provider,
  modelId: process.env.IRIS_BRAIN_APPLIED_MODEL || DEFAULT_BRAIN.modelId, reasoning: process.env.IRIS_BRAIN_APPLIED_REASONING || "default" };
const models = new BrainModelService({ bridge: new HermesBrainBridge({ repoRoot: process.cwd() }), selected: route, persist() {}, isSafe: () => false, apply() {} });
const client = new HermesGatewayClient({ candidates: () => [{ cmd: process.env.HERMES_BIN || "hermes", args: [] }],
  env: { ...process.env, HERMES_TUI_TOOLSETS: "web,clarify" }, startupTimeoutMs: 60000 });
const transport = new HermesInteractiveTransport({ client, conversationOnly: true, getRoute: () => route, prepareRoute: (route) => models.prepare(route) });
let session;
try {
  session = await transport.createSession({ hidden: true });
  for (const [task, address] of [
    ["Türkçe konuşalım. Yalnızca hazır olduğunu kısa bir cümleyle söyle ve bana bir kez hitap et. Hiçbir görev başlatma.", /\befendim\b/i],
    ["Let's speak English now. In one short sentence, repeat the literal filename Fatih.txt and address me once. This is only a language check; do not operate on any file or propose work.", /\bsir\b/i],
  ]) {
    const done = new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("Addressing test timed out")), 90000);
      transport.once("complete", (item) => { clearTimeout(timer); item.status === "completed" ? resolve(item) : reject(new Error(item.error)); });
    });
    await transport.submit({ sessionId: session.id, task: task + ' Preserve the Avalon JSON response format with reply and proposal:null.', kind: "conversation", context: conversationContext("User's real name: Fatih. This is an isolated language test.") });
    const output = (await done).output;
    console.log("Isolated conversation output:", output.slice(0, 1500));
    const answer = decodeBrainReply(output);
    assert.equal(answer.proposal, null);
    assert.match(answer.reply, address);
    if (address.source.includes("sir")) assert.ok(answer.reply.includes("Fatih.txt"), "forms of address must not rewrite file names");
    console.log(answer.reply);
  }
  console.log("LIVE ADDRESSING CHECK PASSED: Turkish efendim, English sir, literal file name preserved.");
} finally {
  if (session) await transport.deleteSession(session.id).catch(() => undefined);
  transport.close({ force: true });
}
