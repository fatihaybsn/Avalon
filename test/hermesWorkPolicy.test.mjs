import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { EventEmitter } from "node:events";
import vm from "node:vm";
import { createAutomationHermes, validateHermesOutput } from "../electron/automationHermes.mjs";
import { hermesProtectedPaths, hermesWorkSafetyInstructions } from "../electron/hermesWorkPolicy.mjs";
import { normalizeHermesOutputContract, hermesOutputInstructions } from "../electron/hermesOutputContract.mjs";
import { HermesInteractiveTransport } from "../electron/hermesInteractiveTransport.mjs";

async function capture(t, step, output = "done", env = {}) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "avalon-work-policy-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  let submitted;
  const client = Object.assign(new EventEmitter(), { request: async () => ({}) });
  const transport = { sessions: new Map([["session", { liveId: "live" }]]),
    createSession: async () => ({ id: "session" }), submit: async (input) => { submitted = input; return { run_id: "run" }; },
    getRun: () => ({ status: "completed", output }), close() {} };
  const adapter = createAutomationHermes({ spec: { outputDirectory: directory }, env,
    clientFactory: () => client, transportFactory: () => transport });
  try {
    const result = await adapter.execute({ step: { prompt: "offline", ...step }, inputs: [], signal: new AbortController().signal, onUpdate() {} });
    return { ...submitted, result, directory };
  } finally { await adapter.close(); }
}

test("automation includes the normal workspace/protected-directory policy with configured paths", async (t) => {
  const { instructions } = await capture(t, {}, "done", { IRIS_HERMES_PROTECTED_PATHS: " /AUDIT_PRIVATE_DIRECTORY, /SECOND_PRIVATE " });
  assert.match(instructions, /\/AUDIT_PRIVATE_DIRECTORY/);
  assert.match(instructions, /\/SECOND_PRIVATE/);
  assert.match(instructions, /never recursively enumerate the home directory/);
  assert.match(instructions, /unless the user explicitly named the exact folder/);
  assert.match(instructions, /Downloads/);
});

test("JSON requirements are explicitly instructed with the same top-level names the validator enforces", async (t) => {
  const step = { outputType: "json", requiredFields: " sources , count, sources, literal.key, " };
  const output = '{"sources":[],"count":0,"literal.key":false}';
  const { instructions, result, directory } = await capture(t, step, output);
  assert.match(instructions, /\["sources","count","literal.key"\]/);
  assert.deepEqual(result.value, JSON.parse(output));
  assert.throws(() => validateHermesOutput(step, { status: "completed", output: '{"sources":[],"count":0,"literal":{"key":false}}' }, directory), /literal.key/);
  assert.doesNotMatch(instructions, /iris_contract|plain_text_once|"reply"|"proposal"|Response style/);
});

test("default and configured protected directories preserve existing normal-task semantics", () => {
  assert.deepEqual(hermesProtectedPaths({}), ["~/Documents", "~/Desktop", "~/Pictures", "~/Photos Library.photoslibrary", "~/Applications", "/Applications", "~/Library", "~/Movies", "~/Music"]);
  assert.deepEqual(hermesProtectedPaths({ IRIS_HERMES_PROTECTED_PATHS: " , , " }), hermesProtectedPaths({}));
  assert.deepEqual(hermesProtectedPaths({ IRIS_HERMES_PROTECTED_PATHS: " /Only , " }), ["/Only"]);
});

for (const interactive of [true, false]) {
  test(`normal work uses shared safety without losing its style or routing (${interactive ? "interactive" : "runs_api"})`, async (t) => {
    const main = fs.readFileSync("electron/main.mjs", "utf8");
    const source = main.slice(main.indexOf("async function submitHermesTask("), main.indexOf("// Stage a Hermes task"));
    const policy = hermesWorkSafetyInstructions({ IRIS_HERMES_PROTECTED_PATHS: "/SHARED_PRIVATE" });
    const route = { provider: "fixture", modelId: "fixture-model" };
    let submitted;
    // Evaluate the production function body with all Electron/backend effects
    // replaced by doubles. No application, native gateway or HTTP is started.
    const submit = vm.runInNewContext(`(${source})`, {
      hermesWorkSafetyInstructions: () => policy, IRIS_STYLE: "STYLE_SENTINEL", languageInstructions: () => "LANG_SENTINEL",
      hermesSessionId: () => "stored", emitEvent() {}, interactiveTransportEnabled: () => interactive,
      brainModels: { route: async () => route, prepare: async () => {} }, brainRelayEnabled: () => false,
      getInteractiveHermes: () => ({ submit: async (input) => { submitted = input; return { run_id: "run", session_id: "stored" }; } }),
      checkHermesStatus: async () => ({ reachable: true }), crypto: { randomUUID: () => "dispatch" },
      brainProviderSlug: () => "fixture", hermesRequest: async (_method, _url, input) => { submitted = input; return { run_id: "run" }; },
      runRegistry: { start() {} }, watchHermesRun() {},
    });
    await submit({ task: "  exact task  ", urgency: "high" });
    assert.ok(submitted.instructions.includes(policy));
    assert.match(submitted.instructions, /STYLE_SENTINEL.*LANG_SENTINEL/s);
    assert.equal(submitted.task || submitted.input, "exact task");
    const automated = await capture(t, {}, "done", { IRIS_HERMES_PROTECTED_PATHS: "/SHARED_PRIVATE" });
    assert.ok(automated.instructions.includes(policy));
    assert.doesNotMatch(automated.instructions, /STYLE_SENTINEL|LANG_SENTINEL/);
  });
}

test("output normalization is immutable and keeps literal fields, optional fields and existing evaluation outcomes", () => {
  const step = { outputType: "evaluation", requiredFields: " reason, reason, count ", requiredFiles: " a.md\r\na.md\n b.md " };
  const contract = normalizeHermesOutputContract(step);
  step.requiredFields = "other";
  assert.deepEqual(contract.requiredFields, ["reason", "count"]);
  assert.deepEqual(contract.requiredFiles, ["a.md", "b.md"]);
  assert.throws(() => contract.requiredFields.push("other"), TypeError);
  const instructions = hermesOutputInstructions(contract);
  for (const outcome of contract.outcomes) assert.ok(instructions.includes(outcome));
  const valid = (value, fields = "") => validateHermesOutput({ outputType: "evaluation", requiredFields: fields }, { status: "completed", output: JSON.stringify(value) }, ".");
  for (const outcome of ["approved", "revision_required", "needs_review"]) assert.equal(valid({ outcome }).value.outcome, outcome);
  assert.throws(() => valid({ outcome: "failed", reason: "fixture failure" }), /fixture failure/);
  assert.throws(() => valid({ outcome: "unknown" }), /outcome/);
  for (const value of [null, ""]) assert.throws(() => valid({ outcome: "approved", required: value }, "required"), /alan eksik/);
  assert.equal(valid({ outcome: "approved", required: false }, "required").value.required, false);
  assert.deepEqual(normalizeHermesOutputContract({}).requiredFields, []);
});

for (const version of [1, 2]) {
  test(`read-only voice v${version} receives no work policy or automation output instructions`, async () => {
    const calls = [];
    const client = Object.assign(new EventEmitter(), { irisContractVersions: [version], close() {},
      async request(method, params, options) {
        options?.onDispatch?.(); calls.push({ method, params });
        if (method === "session.create") return { session_id: "live", stored_session_id: "stored" };
        if (method === "tools.show") return { sections: [{ tools: [] }] };
        return {};
      } });
    const transport = new HermesInteractiveTransport({ client, conversationOnly: true });
    try {
      await transport.submit({ task: "literal speech", kind: "conversation" });
      await new Promise(setImmediate);
      const prompt = calls.find((item) => item.method === "prompt.submit").params;
      assert.equal(prompt.text, "literal speech");
      assert.equal(prompt.iris_contract.version, version);
      assert.doesNotMatch(JSON.stringify(prompt), /Local filesystem safety|Gerekli göreli dosyalar|Zorunlu üst seviye JSON|Kullanıcının Hermes izinlerini koru/);
      assert.equal(calls.some((call) => call.method === "config.set"), false);
    } finally { transport.close(); }
  });
}
