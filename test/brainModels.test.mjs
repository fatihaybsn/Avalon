import test from "node:test";
import assert from "node:assert/strict";
import { BRAIN_MODELS, BRAIN_PROVIDERS, DEFAULT_BRAIN, BrainModelService, brainFailure, validateBrainSelection } from "../electron/brainModels.mjs";
import { brainExecutionKey, brainProviderSlug, reasoningBody, reasoningOptions } from "../electron/brainReasoning.mjs";

test("reasoning uses model-specific controls and preserves the default wire", () => {
  for (const route of BRAIN_MODELS) {
    assert.deepEqual(reasoningBody(route), {});
    assert.equal(brainProviderSlug(route), `iris-${route.provider}`);
    for (const option of reasoningOptions(route)) {
      assert.doesNotThrow(() => validateBrainSelection({ ...route, reasoning: option.value }));
    }
    assert.throws(() => validateBrainSelection({ ...route, reasoning: "ultra" }), /düşünme/);
  }
  assert.deepEqual(reasoningOptions({ provider: "opencode", modelId: "big-pickle" }).map((o) => o.value), ["default"]);
  assert.throws(() => validateBrainSelection({ provider: "evren", modelId: "gemma-4-31b", reasoning: "high" }));
  assert.deepEqual(reasoningBody({ ...DEFAULT_BRAIN, reasoning: "high" }), { thinking: true, reasoning_effort: "xhigh" });
  assert.deepEqual(reasoningBody({ provider: "evren", modelId: "glm-5.3", reasoning: "medium" }), { thinking: true, reasoning_effort: "high" });
  assert.deepEqual(reasoningBody({ ...DEFAULT_BRAIN, reasoning: "disabled" }), { thinking: false });
  assert.deepEqual(reasoningBody({ provider: "opencode", modelId: "beam-free", reasoning: "high" }), { reasoning_effort: "high" });
});

test("changing reasoning on the same model waits safely and pins independent worker providers", async () => {
  const { service, applied, setSafe, calls } = setup();
  const captured = await service.route();
  const high = { ...DEFAULT_BRAIN, reasoning: "high" };
  await service.select(high);
  assert.equal(service.status("chat").pending, true);
  assert.deepEqual(await service.route(), captured);
  assert.notEqual(brainExecutionKey(captured), brainExecutionKey(high));
  assert.notEqual(brainProviderSlug(captured), brainProviderSlug(high));
  setSafe(true); await service.flush();
  assert.deepEqual(applied, [high]);
  assert.deepEqual(calls.find((c) => c.action === "prepare").extraBody, { thinking: true, reasoning_effort: "xhigh" });
  service.markEffective("chat", captured);
  assert.equal(service.status("chat").pending, true);
  service.markEffective("chat", high);
  assert.equal(service.status("chat").pending, false);
  await service.prepare({ ...DEFAULT_BRAIN, reasoning: "disabled" });
  assert.equal(calls.filter((c) => c.action === "prepare").length, 2);
});

test("reasoning preferences survive reconstruction separately for each provider and model", async () => {
  let saved;
  const { service } = setup({ persist: (route, _key, preferences) => { saved = { route, preferences }; } });
  await service.select({ ...DEFAULT_BRAIN, reasoning: "disabled" });
  await service.select({ provider: "opencode", modelId: "beam-free", reasoning: "low" });
  const restored = setup({ selected: saved.route, preferences: saved.preferences }).service.status("chat");
  assert.equal(restored.preferences["evren/qwen3.8-flash-next"], "disabled");
  assert.equal(restored.preferences["opencode/beam-free"], "low");
  assert.equal(restored.selected.reasoning, "low");
});

test("probe results and prepared providers are isolated by reasoning, not just model", async () => {
  const { service, calls } = setup();
  await service.test({ ...DEFAULT_BRAIN, reasoning: "disabled" });
  const catalog = await service.catalog();
  assert.equal(catalog.models.find((m) => m.modelId === DEFAULT_BRAIN.modelId).report, null);
  assert.deepEqual(calls.find((c) => c.action === "probe").extraBody, { thinking: false });
  await assert.rejects(service.select({ provider: "opencode", modelId: "big-pickle", reasoning: "high" }));
});

const alternate = { provider: "evren", modelId: "glm-5.3" };
function setup(options = {}) {
  let safe = false;
  const applied = [], persisted = [], calls = [];
  const bridge = { async call(value) {
    calls.push(value);
    return value.action === "info" ? { configured: true, key: `${value.provider}-secret` } : { ok: true, toolsVerified: true };
  } };
  const service = new BrainModelService({ bridge, isSafe: () => safe,
    apply: async (route) => applied.push(route), persist: (route) => persisted.push(route), ...options });
  return { service, applied, persisted, calls, setSafe: (value) => { safe = value; } };
}

test("only the fourteen requested brain identities are accepted", () => {
  assert.equal(BRAIN_MODELS.length, 14);
  assert.equal(BRAIN_MODELS.filter((m) => m.provider === "opencode").length, 9);
  assert.equal(new Set(BRAIN_MODELS.map((m) => `${m.provider}/${m.modelId}`)).size, 14);
  for (const model of BRAIN_MODELS) assert.deepEqual(validateBrainSelection(model), { provider: model.provider, modelId: model.modelId });
  assert.throws(() => validateBrainSelection({ provider: "opencode", modelId: "glm-5.3" }));
  assert.throws(() => validateBrainSelection({ provider: "evren", modelId: "qwen3-embedding-8b" }));
});

test("selection waits for a safe boundary and leaves old tasks on their captured route", async () => {
  const { service, setSafe, applied, persisted } = setup();
  const taskRoute = await service.route();
  await service.select(alternate);
  assert.equal(service.status("chat").pending, true);
  assert.deepEqual(await service.route(), DEFAULT_BRAIN);
  assert.equal(applied.length, 0);
  setSafe(true);
  await service.flush();
  assert.deepEqual(await service.route(), alternate);
  assert.deepEqual(taskRoute, DEFAULT_BRAIN);
  assert.deepEqual(persisted, [alternate]);
  assert.equal(service.status("chat").pending, false);
});

test("requests arriving during a switch await its outcome", async () => {
  let release;
  const done = new Promise((resolve) => { release = resolve; });
  const { service, setSafe } = setup({ apply: () => done });
  setSafe(true);
  const selecting = service.select(alternate);
  await new Promise((resolve) => setImmediate(resolve));
  let finished = false;
  const route = service.route().then((value) => { finished = true; return value; });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(finished, false);
  release(); await selecting;
  assert.deepEqual(await route, alternate);
});

test("a refused switch never claims the new route is effective or auto retries", async () => {
  let attempts = 0;
  const { service, setSafe } = setup({ apply: async () => { attempts++; throw new Error("session_busy"); } });
  service.markEffective("chat", DEFAULT_BRAIN);
  setSafe(true); await service.select(alternate); await service.flush();
  assert.deepEqual(service.status("chat").effective, DEFAULT_BRAIN);
  assert.deepEqual(await service.route(), DEFAULT_BRAIN);
  assert.equal(attempts, 1);
  assert.match(service.status("chat").error, /session_busy/);
});

test("Hermes selection guards require a separate explicit confirmation", async () => {
  const seen = [];
  const { service, setSafe } = setup({ apply: async (_route, token) => {
    seen.push(token);
    if (!token) throw Object.assign(new Error("Context warning"), { confirmation: { confirm: "bound-token", message: "Context warning" } });
  } });
  setSafe(true); await service.select(alternate); await service.flush();
  assert.deepEqual(seen, [undefined]);
  await service.confirm();
  assert.deepEqual(seen, [undefined, "bound-token"]);
  assert.deepEqual(await service.route(), alternate);
});

test("provider discovery keeps absent models and never exposes or swaps credentials", async () => {
  const requests = [];
  const { service } = setup({ fetchImpl: async (url, options) => {
    requests.push({ url, headers: options.headers });
    return { ok: true, json: async () => ({ data: [{ id: url.includes("evren") ? "glm-5.3" : "big-pickle" }] }) };
  } });
  const catalog = await service.catalog({ refresh: true });
  assert.equal(catalog.models.length, 14);
  assert.equal(catalog.models.find((m) => m.modelId === "nemotron-3-ultra-free").listed, false);
  assert.equal(requests[0].url, BRAIN_PROVIDERS.evren.catalogUrl);
  assert.equal(requests[0].headers.Authorization, "Bearer evren-secret");
  assert.equal(requests[1].headers.Authorization, "Bearer opencode-secret");
  assert.doesNotMatch(JSON.stringify(catalog), /-secret|Authorization/);
});

test("a shared provider quota stops repeated tests without marking other models verified", async () => {
  let probes = 0;
  const { service } = setup({ bridge: { call: async () => {
    probes++; return { ok: false, httpStatus: 429, error: "Free usage limit reached", retryAfter: "120" };
  } } });
  const first = await service.test({ provider: "opencode", modelId: "big-pickle" });
  const second = await service.test({ provider: "opencode", modelId: "beam-free" });
  assert.equal(first.kind, "quota"); assert.equal(second.kind, "quota");
  assert.equal(probes, 1);
  assert.equal(service.reports.has("opencode/beam-free"), false);
});

test("invalid targets cannot reach the bridge or persistence", async () => {
  const { service, calls, persisted } = setup();
  await assert.rejects(service.select({ provider: "opencode", modelId: "paid-model" }));
  assert.equal(calls.length, 0); assert.equal(persisted.length, 0);
});

test("credentials, access, removed models and quota have distinct statuses", () => {
  assert.equal(brainFailure({ httpStatus: 401 }).kind, "credentials");
  assert.equal(brainFailure({ httpStatus: 403 }).kind, "access");
  assert.equal(brainFailure({ httpStatus: 400, error: "Model is unavailable" }).kind, "model");
  assert.equal(brainFailure({ httpStatus: 429 }).kind, "quota");
});

test("a supplied OpenCode key cannot be persisted or sent as an Evren credential", async () => {
  const persisted = [];
  const { service, calls } = setup({ persist: (_route, key) => persisted.push(key) });
  await service.select(alternate, "opencode-candidate");
  assert.equal(calls[0].apiKey, "");
  assert.deepEqual(persisted, [""]);
  await assert.rejects(service.select({ provider: "opencode", modelId: "beam-free" }, "key\nIRIS_BRAIN_MODEL=other"));
});
