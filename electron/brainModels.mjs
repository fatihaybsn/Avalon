import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { spawn } from "node:child_process";
import { brainExecutionKey, brainProviderSlug, reasoningBody, reasoningOptions } from "./brainReasoning.mjs";
import { nativeResourcePath } from "./resourcePaths.mjs";
import { parseEnvFile, userConfigPath } from "./configStore.mjs";

export const BRAIN_PROVIDERS = {
  evren: { label: "Evren", baseUrl: "https://evren-llmapi.ssyz.org.tr/v1", catalogUrl: "https://evren-llmapi.ssyz.org.tr/v1/models" },
  opencode: { label: "OpenCode Free", baseUrl: "https://opencode.ai/inference/openai/v1", catalogUrl: "https://opencode.ai/inference/v1/models" },
};
export const BRAIN_MODELS = [
  ["evren", "gemma-4-31b", "Gemma 4 31B"],
  ["evren", "qwen3.8-flash-next", "Qwen 3.8 Flash Next"],
  ["evren", "mimo-v2.6-pro", "MiMo V2.6 Pro"],
  ["evren", "deepseek-v4.1-flash", "DeepSeek V4.1 Flash"],
  ["evren", "glm-5.3", "GLM 5.3"],
  ["opencode", "beam-free", "Beam Free"],
  ["opencode", "big-pickle", "Big Pickle"],
  ["opencode", "deepseek-v4.1-flash-free", "DeepSeek V4.1 Flash Free"],
  ["opencode", "flint-40b-free", "Flint 40B Free"],
  ["opencode", "glm-5.3-flash-free", "GLM-5.3-Flash Free"],
  ["opencode", "mimo-v2.6-flash-free", "MiMo-V2.6-Flash Free"],
  ["opencode", "nemotron-3-ultra-free", "Nemotron 3 Ultra Free"],
  ["opencode", "nemotron-3.5-lightning-free", "Nemotron 3.5 Lightning Free"],
  ["opencode", "nemotron-3.5-super-vl-free", "Nemotron 3.5 Super VL Free"],
].map(([provider, modelId, label]) => Object.freeze({ provider, modelId, label }));
export const DEFAULT_BRAIN = Object.freeze({ provider: "evren", modelId: "qwen3.8-flash-next" });
// Read the saved selection afresh: a scheduler process can outlive Brain setting changes.
export function readSelectedBrain({ file = userConfigPath(), env = process.env } = {}) {
  const saved = Object.create(null);
  parseEnvFile(file, saved);
  const source = Object.hasOwn(saved, "IRIS_BRAIN_PROVIDER") || Object.hasOwn(saved, "IRIS_BRAIN_MODEL") ? saved : env;
  return validateBrainSelection({
    provider: source.IRIS_BRAIN_PROVIDER || DEFAULT_BRAIN.provider,
    modelId: source.IRIS_BRAIN_MODEL || DEFAULT_BRAIN.modelId,
    reasoning: source.IRIS_BRAIN_REASONING || "default",
  });
}
export const brainRouteKey = (route) => `${route.provider}/${route.modelId}`;
function cleanApiKey(value) {
  if (typeof value !== "string" || value.length > 8192 || /[\r\n\0]/.test(value)) throw new Error("API anahtarı tek satırlı, geçerli bir metin olmalıdır.");
  return value.trim();
}
export function validateBrainSelection(value) {
  const model = BRAIN_MODELS.find((m) => m.provider === value?.provider && m.modelId === value?.modelId);
  if (!model) throw new Error("Bu beyin modeli desteklenen listede değil.");
  const route = { provider: model.provider, modelId: model.modelId };
  const reasoning = value?.reasoning || "default";
  if (!reasoningOptions(route).some((option) => option.value === reasoning)) throw new Error("Bu model için desteklenmeyen düşünme ayarı.");
  return { ...route, ...(reasoning !== "default" ? { reasoning } : {}) };
}
export function brainSelectionLabel(route) {
  const model = BRAIN_MODELS.find((item) => item.provider === route.provider && item.modelId === route.modelId);
  const reasoning = reasoningOptions(route).find((option) => option.value === (route.reasoning || "default"));
  return `${BRAIN_PROVIDERS[route.provider]?.label || route.provider} / ${model?.label || route.modelId} · düşünme: ${reasoning?.label || route.reasoning || "Varsayılan"}`;
}
export function brainFailure(value) {
  const error = String(value?.error || value?.message || "Bağlantı kurulamadı.").slice(0, 900);
  const status = Number(value?.httpStatus || 0);
  const kind = value?.kind || (status === 429 || /FreeUsageLimit|usage limit|quota/i.test(error) ? "quota"
    : status === 401 ? "credentials" : status === 403 ? "access"
      : /unavailable|not found|unknown model/i.test(error) ? "model" : status >= 500 ? "service" : "network");
  const seconds = Number(value?.retryAfter);
  const retryAt = Number.isFinite(seconds) && seconds > 0 ? Date.now() + seconds * 1000
    : value?.retryAfter ? Date.parse(value.retryAfter) || undefined : undefined;
  return { ok: false, kind, error, ...(retryAt ? { retryAt } : {}) };
}

export class HermesBrainBridge {
  constructor({ repoRoot, home = () => process.env.HERMES_HOME || path.join(os.homedir(), ".hermes"), env = process.env }) {
    Object.assign(this, { repoRoot, home, env });
    this.python = null;
  }
  candidates() {
    const home = this.home();
    const result = [];
    const addVenv = (dir) => {
      const exe = path.join(dir, process.platform === "win32" ? "Scripts/python.exe" : "bin/python");
      if (fs.existsSync(exe)) result.push(exe);
    };
    const dirs = (dir) => { try { return fs.readdirSync(dir, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => path.join(dir, d.name)).reverse(); } catch { return []; } };
    for (const install of dirs(path.join(home, "installs"))) for (const environment of dirs(path.join(install, "environments"))) addVenv(path.join(environment, "venv"));
    addVenv(path.join(home, "hermes-agent", ".venv"));
    addVenv(path.join(home, "hermes-agent", "venv"));
    return [...new Set([...(this.python ? [this.python] : []), ...result, process.platform === "win32" ? "python" : "python3"])];
  }
  async call(payload) {
    for (const python of this.candidates()) {
      const result = await new Promise((resolve) => {
        const child = spawn(python, ["-B", nativeResourcePath(this.repoRoot, "sidecar", "brain_provider.py")], {
          env: { ...this.env, HERMES_HOME: this.home(), PYTHONIOENCODING: "utf-8" },
          stdio: ["pipe", "pipe", "pipe"], windowsHide: true,
        });
        let output = "", settled = false;
        const finish = (value) => { if (settled) return; settled = true; clearTimeout(timer); resolve(value); };
        const timer = setTimeout(() => { child.kill(); finish({ ok: false, kind: "timeout", error: "Model bağlantısı zaman aşımına uğradı." }); }, payload.action === "probe" ? 85000 : 30000);
        child.stdout.on("data", (chunk) => { output = `${output}${chunk}`.slice(-65536); });
        child.stderr.on("data", () => {}); // No raw runtime/provider logs in UI.
        child.on("error", () => finish({ ok: false, kind: "runtime" }));
        child.on("close", () => { try { finish(JSON.parse(output.trim().split(/\r?\n/).at(-1))); } catch { finish({ ok: false, kind: "runtime" }); } });
        child.stdin.on("error", () => {});
        child.stdin.end(JSON.stringify(payload));
      });
      if (result.kind !== "runtime") { this.python = python; return result; }
    }
    return { ok: false, kind: "runtime", error: "Hermes Python ortamı bulunamadı veya beyin bağlantısı yüklenemedi." };
  }
}

/** Model selection owns no audio. Changes commit only at a safe voice boundary. */
export class BrainModelService {
  constructor({ bridge, selected = DEFAULT_BRAIN, current = selected, preferences = {}, persist, persistActive = () => {}, emit = () => {}, isSafe, apply, fetchImpl = fetch }) {
    Object.assign(this, { bridge, persist, persistActive, emit, isSafe, apply, fetchImpl });
    this.selected = validateBrainSelection(selected);
    this.current = validateBrainSelection(current);
    this.effective = new Map();
    this.preferences = {};
    for (const model of BRAIN_MODELS) {
      const value = preferences?.[brainRouteKey(model)];
      try { if (value) this.preferences[brainRouteKey(model)] = validateBrainSelection({ ...model, reasoning: value }).reasoning || "default"; } catch { /* Ignore stale or malformed preferences. */ }
    }
    this.preferences[brainRouteKey(this.selected)] = this.selected.reasoning || "default";
    this.pending = brainExecutionKey(this.current) !== brainExecutionKey(this.selected);
    this.applying = null;
    this.reports = new Map();
    this.inventory = new Map();
    this.configured = { evren: false, opencode: false };
    this.error = null;
    this.confirmation = null;
    this.prepared = new Set();
    this.cooldowns = new Map();
  }
  status(sessionId) {
    const effective = this.effective.get(sessionId) || null;
    return { selected: this.selected, effective, preferences: { ...this.preferences },
      pending: this.pending || Boolean(effective && brainExecutionKey(effective) !== brainExecutionKey(this.selected)), applying: Boolean(this.applying), error: this.error, confirmation: this.confirmation };
  }
  changed() { this.emit(); }
  async info(provider, apiKey = "") {
    return this.bridge.call({ action: "info", provider, apiKey: provider === "opencode" ? cleanApiKey(apiKey) : "" });
  }
  async prepare(route, apiKey = "") {
    route = validateBrainSelection(route);
    apiKey = route.provider === "opencode" ? cleanApiKey(apiKey) : "";
    const slug = brainProviderSlug(route);
    if (!apiKey && this.prepared.has(slug)) return { ok: true };
    const result = await this.bridge.call({ action: "prepare", ...route, providerSlug: slug, extraBody: reasoningBody(route), apiKey });
    if (!result.ok) throw Object.assign(new Error(result.error || "Sağlayıcı hazırlanamadı."), { kind: result.kind });
    this.configured[route.provider] = true;
    this.prepared.add(slug);
    return result;
  }
  async catalog({ refresh = false, apiKey = "" } = {}) {
    for (const provider of Object.keys(BRAIN_PROVIDERS)) {
      const saved = await this.info(provider);
      this.configured[provider] = Boolean(saved.configured);
      if (!refresh) continue;
      const info = provider === "opencode" && apiKey ? await this.info(provider, apiKey) : saved;
      try {
        if (!info.configured) throw new Error("API anahtarı kaydedilmemiş.");
        const response = await this.fetchImpl(BRAIN_PROVIDERS[provider].catalogUrl, {
          headers: { Authorization: `Bearer ${info.key}` }, signal: AbortSignal.timeout(12000), redirect: "error",
        });
        if (!response.ok) throw new Error(`Katalog HTTP ${response.status}`);
        const data = await response.json();
        if (!Array.isArray(data.data)) throw new Error("Katalog yanıtı geçersiz.");
        this.inventory.set(provider, { ids: new Set(data.data.map((m) => m.id)), at: Date.now(), error: null });
      } catch { this.inventory.set(provider, { ...this.inventory.get(provider), error: "Katalog yenilenemedi; son bilinen liste korunuyor." }); }
    }
    return { configured: this.configured, models: BRAIN_MODELS.map((model) => {
      const inventory = this.inventory.get(model.provider);
      return { ...model, listed: inventory?.ids ? inventory.ids.has(model.modelId) : null,
        reasoningOptions: reasoningOptions(model),
        catalogError: inventory?.error || null, report: this.reports.get(brainExecutionKey({ ...model, reasoning: this.preferences[brainRouteKey(model)] })) || null };
    }) };
  }
  async test(value, apiKey = "") {
    const route = validateBrainSelection(value), key = brainExecutionKey(route);
    apiKey = route.provider === "opencode" ? cleanApiKey(apiKey) : "";
    const previous = this.reports.get(key);
    if (previous?.retryAt > Date.now()) return previous;
    const cooldown = this.cooldowns.get(route.provider);
    if (cooldown?.retryAt > Date.now()) return { ...cooldown, error: "Sağlayıcının ortak kota süresi dolmadı. " + cooldown.error };
    const result = await this.bridge.call({ action: "probe", ...route, extraBody: reasoningBody(route), apiKey, sessionId: `iris-probe-${crypto.randomUUID()}` });
    const report = { ...(result.ok ? result : brainFailure(result)), reasoning: route.reasoning || "default", testedAt: Date.now() };
    this.reports.set(key, report);
    if (!report.ok && report.kind === "quota") {
      report.retryAt ||= Date.now() + 60000;
      this.cooldowns.set(route.provider, report);
    }
    this.changed();
    return report;
  }
  async select(value, apiKey = "") {
    const route = validateBrainSelection(value);
    apiKey = route.provider === "opencode" ? cleanApiKey(apiKey) : "";
    // Configure the explicit endpoint first, so a failure never changes selection.
    await this.prepare(route, apiKey);
    const preferences = { ...this.preferences, [brainRouteKey(route)]: route.reasoning || "default" };
    this.persist(route, apiKey, preferences);
    this.preferences = preferences;
    this.selected = route;
    this.pending = true;
    this.error = null;
    this.confirmation = null;
    this.changed();
    await this.flush();
  }
  async confirm() {
    if (!this.confirmation?.confirm) throw new Error("Bekleyen model değişimi onayı yok.");
    if (!this.isSafe()) throw new Error("Model değişimi için konuşmanın tamamlanmasını bekle.");
    const confirm = this.confirmation.confirm;
    this.error = null; this.confirmation = null;
    await this.flush(confirm);
  }
  async flush(confirm) {
    if (!this.pending || this.applying || this.error || this.confirmation || !this.isSafe()) return;
    const target = { ...this.selected };
    this.applying = (async () => {
      try {
        await this.apply(target, confirm);
        this.current = target;
        this.pending = brainExecutionKey(target) !== brainExecutionKey(this.selected);
        this.persistActive(target);
      } catch (error) {
        this.error = String(error.message || "Model değiştirilemedi.").slice(0, 900);
        this.confirmation = error.confirmation || null;
      }
    })();
    this.changed();
    try { await this.applying; } finally { this.applying = null; this.changed(); }
  }
  async route() { if (this.applying) await this.applying; return { ...this.current }; }
  markEffective(sessionId, route) { this.effective.set(sessionId, { ...route }); this.changed(); }
}
