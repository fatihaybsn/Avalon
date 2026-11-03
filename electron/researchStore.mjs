import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { validateBrainSelection } from "./brainModels.mjs";
import { RESEARCH_PURPOSE_MAX_LENGTH } from "./researchLimits.mjs";

export const RESEARCH_TERMINAL = new Set(["completed", "partial", "failed", "cancelled", "interrupted", "needs_access"]);
export function readJson(file, fallback = null) { try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch { return fallback; } }
export function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temp = `${file}.${process.pid}.${crypto.randomUUID()}.tmp`;
  fs.writeFileSync(temp, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 }); fs.renameSync(temp, file);
}
export function processAlive(pid) { try { if (!Number.isInteger(pid) || pid < 1) return false; process.kill(pid, 0); return true; } catch { return false; } }
export function canonicalUrl(value) {
  try {
    const url = new URL(value);
    if (!["https:", "http:"].includes(url.protocol) || url.username || url.password) return null;
    url.hash = "";
    for (const key of [...url.searchParams.keys()]) if (/^(utm_|fbclid$|gclid$)/i.test(key)) url.searchParams.delete(key);
    url.searchParams.sort(); return url.href.replace(/\/$/, "");
  } catch { return null; }
}
export function normalizeResearch(input, { outputRoot, sessionId, route } = {}) {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("Araştırma bilgileri gerekli.");
  const topic = String(input.topic || input.goal || "").trim();
  if (!topic || topic.length > 12000) throw new Error("Araştırma konusu 1–12000 karakter olmalı.");
  const purpose = String(input.purpose || "");
  if (purpose.length > RESEARCH_PURPOSE_MAX_LENGTH) throw new Error(`Amaç / beklenen sonuç en fazla ${RESEARCH_PURPOSE_MAX_LENGTH} karakter olmalı.`);
  const minutes = Number(input.minutes ?? 30);
  if (!Number.isInteger(minutes) || minutes < 1 || minutes > 120) throw new Error("Süre 1–120 dakika arasında olmalı.");
  const sites = (Array.isArray(input.sites) ? input.sites : String(input.sites || "").split(/[\n,]/)).map((x) => String(x).trim()).filter(Boolean);
  if (sites.length > 30 || sites.some((x) => x.length > 500 || /[\r\n\0]/.test(x))) throw new Error("En fazla 30 geçerli kaynak/site belirt.");
  const outputDirectory = String(input.outputDirectory || outputRoot || "").trim();
  if (!path.isAbsolute(outputDirectory) || outputDirectory.includes("\0")) throw new Error("Çıktı klasörü tam bir dosya yolu olmalı.");
  return { topic, purpose, sites, minutes,
    mode: input.mode === "normal" ? "normal" : "deep", language: input.language === "en" ? "en" : "tr", outputDirectory,
    sessionId: String(sessionId || input.sessionId || ""), route: validateBrainSelection(route ?? input.route),
    ...(input.schedule ? { schedule: normalizeSchedule(input.schedule) } : {}) };
}
export function normalizeSchedule(value) {
  if (!value || !["daily", "weekly", "once"].includes(value.kind)) throw new Error("Günlük, haftalık veya tek seferlik zamanlama seç.");
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(value.time || "")) throw new Error("Geçerli çalışma saati gerekli (SS:DD).");
  if (value.kind === "once" && !/^\d{4}-\d{2}-\d{2}$/.test(value.date || "")) throw new Error("Tek seferlik görev için tarih gerekli.");
  const day = Number(value.day ?? 6);
  if (!Number.isInteger(day) || day < 0 || day > 6) throw new Error("Geçerli haftanın günü gerekli.");
  return { kind: value.kind, time: value.time, day, ...(value.kind === "once" ? { date: value.date } : {}), timezone: "Europe/Istanbul" };
}
export function scheduleLabel(schedule) {
  const days = ["Pazar", "Pazartesi", "Salı", "Çarşamba", "Perşembe", "Cuma", "Cumartesi"];
  return `${schedule.kind === "daily" ? "Her gün" : schedule.kind === "weekly" ? `Her ${days[schedule.day]}` : schedule.date} ${schedule.time} (${schedule.timezone})`;
}
export class ResearchStore {
  constructor(root) { this.root = root; this.cache = new Map(); }
  file(id, name = "state.json") {
    if (!/^(research|schedule)_[a-f0-9-]+$/.test(id)) throw new Error("Geçersiz araştırma kimliği.");
    return path.join(this.root, id, name);
  }
  get(id) {
    const file = this.file(id);
    const cached = this.cache.get(id);
    if (cached?.value && RESEARCH_TERMINAL.has(cached.value.status)) return cached.value;
    try {
      const stat = fs.statSync(file), key = `${stat.mtimeMs}:${stat.size}`;
      if (cached?.key === key) return cached.value;
      const value = readJson(file); this.cache.set(id, { key, value }); return value;
    } catch { return null; }
  }
  save(state) { writeJson(this.file(state.id), { ...state, updatedAt: Date.now() }); this.cache.delete(state.id); }
  list(prefix = "research_") {
    let names; try { names = fs.readdirSync(this.root); } catch { return []; }
    return names.filter((id) => id.startsWith(prefix)).map((id) => { try { return this.get(id); } catch { return null; } }).filter(Boolean).sort((a, b) => b.createdAt - a.createdAt);
  }
  create(spec, extras = {}) {
    spec = { ...spec, route: { ...spec.route } };
    const id = `research_${crypto.randomUUID()}`;
    const slug = spec.topic.normalize("NFKD").replace(/[^\p{L}\p{N}]+/gu, "-").slice(0, 48) || "arastirma";
    const outputPath = path.join(spec.outputDirectory, slug, `${new Date().toISOString().replace(/[:.]/g, "-")}-${id.slice(-8)}`);
    const state = { id, spec, ...extras, kind: spec.mode === "deep" ? "deep_research" : "research", sessionId: spec.sessionId,
      task: spec.topic, status: "starting", phase: "planning", sourceCount: 0, newCount: 0, changedCount: 0,
      createdAt: Date.now(), updatedAt: Date.now(), outputPath, lastActivity: "Araştırma hazırlanıyor." };
    fs.mkdirSync(outputPath, { recursive: true }); this.save(state); return state;
  }
  reconcile() {
    for (const state of this.list()) {
      if (!RESEARCH_TERMINAL.has(state.status) && Date.now() - state.updatedAt > 20000 && !processAlive(state.pid)) {
        this.save({ ...state, status: "interrupted", error: "Araştırma çalıştırıcısı kesildi. Toplanan sonuçlar korundu.", finishedAt: Date.now() });
      }
    }
  }
}
export function researchCard(state) {
  return { id: state.id, kind: state.kind, sessionId: state.sessionId, task: state.task, status: state.status,
    updatedAt: state.updatedAt, output: state.output || "", error: state.error || "", phase: state.phase,
    startedAt: state.startedAt || state.createdAt, deadline: state.deadline || state.createdAt + state.spec.minutes * 60000,
    sourceCount: state.sourceCount, activeWorkers: state.activeWorkers || 0, newCount: state.newCount, changedCount: state.changedCount,
    lastActivity: state.lastActivity, outputPath: state.outputPath, scheduleId: state.scheduleId, steps: state.steps || [] };
}
