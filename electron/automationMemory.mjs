import fs from "node:fs";
import path from "node:path";
import { canonicalUrl, writeJson } from "./researchStore.mjs";

const localName = /^[a-zA-Z0-9_-]+\.md$/;
const groupName = /^[a-z][a-z0-9_-]{0,39}$/;
const outcomes = new Set(["completed", "pending"]);
const manifest = /^\x60{3}avalon-records[ \t]*\r?\n([\s\S]*?)^\x60{3}[ \t]*\r?$/gm;

function load(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); }
  catch (error) {
    if (error.code === "ENOENT") return fallback;
    throw new Error(`Otomasyon kaydı okunamadı (${path.basename(file)}): ${error.message}`);
  }
}

export function withoutRecordManifest(markdown) {
  return markdown.replace(manifest, "").trim();
}

export function openAutomationMemory(root, flow) {
  const directory = path.join(root, "inputs", flow.id);
  const settings = load(path.join(directory, "inputs.json"), null);
  if (!settings) return null;
  const file = path.join(directory, "records.json");
  const state = load(file, { records: {}, coverage: {} });
  const byStep = settings.steps || {};
  const documents = new Map();
  for (const [id, step] of Object.entries(byStep)) {
    if (!flow.steps.some((item) => item.id === id) ||
        (step.group && !groupName.test(step.group)) ||
        (step.coverage && !groupName.test(step.coverage.group)) ||
        (step.coverage?.changesFrom && !groupName.test(step.coverage.changesFrom)) ||
        (step.revisitGroup && !groupName.test(step.revisitGroup)) ||
        (step.coverage?.after && !flow.steps.some((item) => item.id === step.coverage.after)) ||
        !Array.isArray(step.documents || [])) throw new Error("Otomasyon girdi ayarları geçersiz.");
    for (const name of step.documents || []) {
      if (!localName.test(name)) throw new Error("Otomasyon belgeleri yerel Markdown dosyaları olmalı.");
      if (!documents.has(name)) {
        try { documents.set(name, fs.readFileSync(path.join(directory, name), "utf8").trim()); }
        catch { throw new Error(`Otomasyon belgesi okunamadı: ${name}`); }
      }
    }
  }
  const group = (name) => Object.hasOwn(state.records, name) ? state.records[name] : [];
  const coverage = (id) => Object.hasOwn(state.coverage, id) ? state.coverage[id] : {};
  const keyFor = (value) => {
    if (typeof value !== "string" || !value.trim() || value.length > 350) throw new Error("Geçersiz kayıt kimliği.");
    return value.trim().toLowerCase();
  };
  const queueFor = (id, rule) => {
    if (!rule) return [];
    const changed = new Map();
    if (rule.changesFrom) {
      for (const item of group(rule.changesFrom)) {
        if (item.revisit) changed.set(item.revisit, Math.max(item.updatedAt, changed.get(item.revisit) || 0));
      }
    }
    return group(rule.group).filter((item) => {
      const prior = coverage(id)[item.key];
      return (!rule.after || coverage(rule.after)[item.key]?.status === "completed") &&
        (rule.refresh || prior?.status !== "completed" || item.updatedAt > prior.at || changed.get(item.key) > prior.at);
    });
  };

  return {
    prepare(step, reports) {
      const settings = Object.hasOwn(byStep, step.id) && byStep[step.id];
      if (!settings) return { reports, instruction: "" };
      const queue = queueFor(step.id, settings.coverage);
      const supporting = [...new Set(settings.documents || [])].map((name) => ({ name, kind: "document", markdown: documents.get(name) }));
      supporting.push({ name: "Avalon · Turlar arası kayıtlar", kind: "document", markdown: JSON.stringify({
        records: state.records, coverage: state.coverage,
        ...(settings.coverage ? { requiredQueue: queue.map(({ key, name, url }) => ({ key, name, url })) } : {}),
      }) });
      const inputs = [...reports, ...supporting];
      // Synthesis condenses oversized report inputs before it joins them with local documents.
      const reportSize = reports.reduce((total, input) => total + input.markdown.length, 0);
      const supportingSize = supporting.reduce((total, input) => total + input.markdown.length, 0);
      if (step.spec.mode === "synthesis" && reportSize > 48000) {
        if (supportingSize > 48000) throw new Error("Yerel belgeler ve geçmiş kayıtları 48.000 karakteri aşıyor.");
      } else if (reportSize + supportingSize > 96000) {
        throw new Error("Otomasyon belgeleri ve kayıtları 96.000 karakteri aşıyor.");
      }
      const instruction = settings.group || settings.coverage
        ? "\n\nRaporun sonuna tek bir `avalon-records` kod bloğu ekle. Bloğun içi geçerli JSON olmalı: " +
          '{"records":[{"key":"sabit-kimlik","name":"ad","url":"https://kaynak","note":"kısa kanıt veya sonraki adım","status":"completed","changed":false}],"coverage":[{"key":"kuyruktaki-kimlik","status":"completed","note":"kısa sonuç veya bekleme nedeni"}]}. ' +
          `Kayıt grubu: ${settings.group || "yok; records boş"}. ` +
          "Durum completed veya pending. Yalnızca yeni, bekleyen veya kanıtla önemli ölçüde değişmiş kayıtları yaz. " +
          "İsim benzerliğiyle eleme yapma. Mevcut kaydın kimliğini koru. Değişiklik doğrulanmadıysa changed false. " +
          "note alanı en çok 300 karakter. İki liste boş olabilir. " +
          (settings.coverage ? "requiredQueue içindeki her kimliği coverage listesinde ayrı göster. İncelemen bitmediyse pending yaz. " : "coverage boş olmalı. ") +
          (settings.revisitGroup ? "Bir bulgu bilinen bir şirketin yeniden analizini gerçekten gerektiriyorsa records girdisinde revisit alanına o şirketin kayıt kimliğini ekle." : "")
        : "";
      return { reports: inputs, instruction,
        synthesize: settings.synthesizeWhenQueueEmpty && settings.coverage && queue.length === 0 };
    },
    commit(step, markdown) {
      const settings = Object.hasOwn(byStep, step.id) && byStep[step.id];
      if (!settings?.group && !settings?.coverage) return;
      const blocks = [...markdown.matchAll(manifest)];
      if (blocks.length !== 1) throw new Error("Raporda doğrulanabilir Avalon kayıt bloğu bulunamadı.");
      const { records, coverage: updates } = JSON.parse(blocks[0][1]);
      if (!Array.isArray(records) || !Array.isArray(updates) || records.length > 1000 || updates.length > 1000 ||
          (!settings.group && records.length) || (!settings.coverage && updates.length)) throw new Error("Avalon kayıt bloğu geçersiz.");
      const now = Date.now();
      const existing = new Map(group(settings.group).map((item) => [item.key, item]));
      const queue = queueFor(step.id, settings.coverage);
      const allowed = new Set(queue.map(({ key }) => key));
      const nextCoverage = { ...coverage(step.id) };
      for (const key of allowed) nextCoverage[key] = { status: "pending", at: now };
      const accounted = new Set();
      for (const item of updates) {
        const key = keyFor(item?.key);
        if (!allowed.has(key) || accounted.has(key) || !outcomes.has(item.status) ||
            typeof item.note !== "string" || !item.note.trim() || item.note.length > 300) throw new Error("Geçersiz işleme durumu veya kuyruk kimliği.");
        accounted.add(key);
        nextCoverage[key] = { status: item.status, at: now, note: item.note.trim() };
      }
      const seen = new Set();
      for (const item of records) {
        const url = canonicalUrl(item?.url);
        const key = settings.identity === "domain" && url ? new URL(url).hostname.replace(/^www\./, "") : keyFor(item?.key);
        if (seen.has(key) || !url || !outcomes.has(item.status) ||
            typeof item.name !== "string" || !item.name.trim() || item.name.length > 240 ||
            typeof item.note !== "string" || !item.note.trim() || item.note.length > 300) {
          throw new Error(`Geçersiz veya yinelenen araştırma kaydı: ${key}`);
        }
        seen.add(key);
        const prior = existing.get(key);
        if (prior?.status === "completed" && item.changed !== true) continue;
        const revisit = item.revisit ? keyFor(item.revisit) : undefined;
        if (revisit && !group(settings.revisitGroup).some((record) => record.key === revisit)) {
          throw new Error(`Yeniden incelenecek kayıt bulunamadı: ${revisit}`);
        }
        if (prior && prior.note === item.note && prior.url === url && prior.status === item.status && prior.revisit === revisit) continue;
        existing.set(key, { key, name: item.name.trim(), url, note: item.note.trim(), status: item.status, revisit, updatedAt: now });
      }
      const next = {
        records: settings.group ? { ...state.records, [settings.group]: [...existing.values()] } : state.records,
        coverage: settings.coverage ? { ...state.coverage, [step.id]: nextCoverage } : state.coverage,
      };
      writeJson(file, next);
      Object.assign(state, next);
    },
  };
}
