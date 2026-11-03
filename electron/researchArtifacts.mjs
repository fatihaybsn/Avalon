import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { getDomain } from "tldts";

export const CHECKPOINT_VERSION = 1;
export const DELIVERY_LIMIT = 256 * 1024;
export const normalizeText = (value) => String(value).normalize("NFKC").replace(/\s+/g, " ").trim();
export function canonicalUrl(value) {
  try {
    const url = new URL(value);
    if (!["https:", "http:"].includes(url.protocol) || url.username || url.password) return null;
    url.hash = "";
    for (const key of [...url.searchParams.keys()]) if (/^(utm_|fbclid$|gclid$)/i.test(key)) url.searchParams.delete(key);
    url.searchParams.sort(); return url.href.replace(/\/$/, "");
  } catch { return null; }
}
export function sourceDomain(value) {
  const url = canonicalUrl(value);
  if (!url) return null;
  const hostname = new URL(url).hostname.replace(/\.$/, "");
  return getDomain(hostname, { allowPrivateDomains: true }) || hostname;
}
export function parseObject(value) {
  if (typeof value !== "string" || Buffer.byteLength(value) > DELIVERY_LIMIT) return null;
  const object = (text) => { try { const data = JSON.parse(text); return data && typeof data === "object" && !Array.isArray(data) ? data : null; } catch { return null; } };
  const direct = object(value.trim());
  if (direct) return direct;
  const blocks = [...value.matchAll(/```(?:json)?\s*\r?\n?([\s\S]*?)```/g)];
  return blocks.length === 1 ? object(blocks[0][1].trim()) : null;
}
export function normalizeFinding(value, { runId, workerId, criterionIds, at }) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return { error: "Bulgu bir nesne olmalı." };
  const text = value.text ?? value.claim ?? value.finding, quote = value.quote ?? value.evidence;
  const url = canonicalUrl(value.url ?? value.source ?? value.source_url);
  if (typeof text !== "string" || !text.trim() || text.length > 4000 || typeof quote !== "string" || quote.trim().length < 12 || quote.length > 2500 || !url) return { error: "Bulgunun iddiası, URL'si veya alıntısı geçersiz ya da sınırı aşıyor." };
  if (value.criterionIds != null && (!Array.isArray(value.criterionIds) || value.criterionIds.some((id) => !criterionIds.includes(id)))) return { error: "Bulgunun ölçüt kimlikleri geçersiz." };
  const ids = value.criterionIds || criterionIds;
  if (!ids.length || (value.date != null && (typeof value.date !== "string" || value.date.length > 100))) return { error: "Bulgunun ölçütü veya tarihi geçersiz." };
  const id = `f-${crypto.createHash("sha256").update(JSON.stringify([normalizeText(text), url, normalizeText(quote)])).digest("hex").slice(0, 20)}`;
  return { finding: { id, text: text.trim(), url, quote: quote.trim(), criterionIds: [...new Set(ids)], runId, workerId, collectedAt: at, reviewStatus: "pending", ...(value.date ? { date: value.date } : {}) } };
}
export function evidenceFor(claims, sources) {
  const documents = new Map(sources.map((doc) => [canonicalUrl(doc.url), doc]));
  return claims.map((claim) => {
    const url = canonicalUrl(claim.url || claim.source || claim.source_url), doc = documents.get(url);
    const quote = String(claim.quote || claim.evidence || "").trim();
    // A sub-quote must not validate a larger quotation or a compound claim.
    return { ...claim, url, quote, verified: Boolean(doc && quote.length >= 12 && normalizeText(doc.text).includes(normalizeText(quote))) };
  });
}
export function accessKind(value) {
  if (Object.hasOwn(accessLabels, value.kind)) return value.kind;
  const text = `${value.url || ""} ${value.title || ""} ${value.error || ""} ${value.reason || ""}`;
  const status = Number(value.statusCode || value.metadata?.statusCode || 0);
  if (value.kind === "permission" || value.kind === "secret") return value.kind;
  if (status === 401 || /\/(?:login|signin|checkpoint)(?:[/?\s]|$)|\b(?:sign[ -]in|log[ -]in|login required|authentication required)\b/i.test(text)) return "authentication";
  if (status === 404 || /\b404\b|page not found/i.test(text)) return "not_found";
  if (status === 429 || /\b429\b/.test(text)) return "rate_limit";
  if (status === 503 || /\b503\b/.test(text)) return "unavailable";
  if (status === 403 || /forbidden|access denied|captcha|bot detection/i.test(text)) return "blocked";
  if (/failed to fetch|connection|network|timeout|timed out/i.test(text)) return "connection";
  return "unknown";
}
export const accessLabels = { authentication: "Oturum açılması gerekiyor", permission: "İşlem izni gerekiyor", secret: "Gizli bilgi gerekiyor", not_found: "Sayfa bulunamadı (404)", rate_limit: "İstek sınırı (429)", unavailable: "Hizmet kullanılamıyor (503)", blocked: "Kaynak erişimi engellendi", connection: "Bağlantı veya içerik alma hatası", unknown: "Erişim hatasının nedeni belirlenemedi" };

export function validOutline(value, evidence) {
  if (!value || !Array.isArray(value.sections) || !value.sections.length || value.sections.length > 12) return null;
  const allowed = new Set(evidence.filter((f) => f.verified && f.reviewStatus === "supported").map((f) => f.id));
  const used = new Set();
  for (const section of value.sections) {
    if (!section || typeof section.title !== "string" || !section.title.trim() || section.title.length > 120 || /[\r\n<>\[\]]|https?:/i.test(section.title) || !Array.isArray(section.findingIds) || !section.findingIds.length) return null;
    for (const id of section.findingIds) { if (!allowed.has(id) || used.has(id)) return null; used.add(id); }
  }
  // An outline cannot hide accepted supported findings.
  return used.size === allowed.size ? value.sections.map(({ title, findingIds }) => ({ title, findingIds })) : null;
}
export function renderReport(state, checkpoint, status = state.status) {
  const evidence = evidenceFor(checkpoint.claims || [], checkpoint.sources || []);
  const english = state.spec.language === "en";
  const heading = (tr, en) => english ? en : tr;
  const entry = (f) => `- **${f.id}**: ${f.text}\n  ${heading("Kaynak", "Source")}: [${f.url}](${f.url})\n  ${heading("Alıntı eşleşmesi", "Quote match")}: ${f.verified ? heading("var", "yes") : heading("yok", "no")}; ${heading("iddia değerlendirmesi", "claim assessment")}: ${f.reviewStatus || "pending"}${f.date ? `; ${f.date}` : ""}${f.reviewReason ? `\n  ${heading("Değerlendirme", "Assessment")}: ${f.reviewReason}` : ""}\n  > ${f.quote.replace(/\r?\n/g, "\n  > ")}`;
  const supported = evidence.filter((f) => f.verified && f.reviewStatus === "supported");
  const candidates = evidence.filter((f) => !(f.verified && f.reviewStatus === "supported") && f.reviewStatus !== "unsupported");
  const unsupported = evidence.filter((f) => f.reviewStatus === "unsupported");
  const sections = validOutline({ sections: checkpoint.outline }, evidence);
  const body = sections ? sections.map((s) => `## ${s.title}\n${s.findingIds.map((id) => entry(supported.find((f) => f.id === id))).join("\n")}`).join("\n\n") : `## ${heading("Desteklenen bulgular", "Supported findings")}\n${supported.map(entry).join("\n") || heading("Henüz içerik doğrulaması tamamlanmış bulgu yok.", "No finding has completed content review yet.")}`;
  const open = (checkpoint.criteria || []).filter((c) => !c.resolved).map((c) => `${c.id}: ${c.text}${c.gap ? ` — ${c.gap}` : ""}`);
  const limitations = [...new Set([...(checkpoint.issues || []).map((i) => i.message), ...(checkpoint.access || []).map((i) => `${i.url || ""}: ${i.reason}`), ...open])];
  const interactions = (state.interactionLog || []).map((i) => `- ${i.phase} / ${i.type}: ${JSON.stringify(i.question)} — ${i.decision}`).join("\n");
  return `# ${state.task}\n\n${heading("Durum", "Status")}: **${status}**\n\n${body}\n\n## ${heading("Denetlenmemiş adaylar — kesin bilgi olarak kullanmayın", "Unreviewed candidates — do not treat as established facts")}\n${candidates.map(entry).join("\n") || "- —"}\n\n## ${heading("Desteklenmeyen bulgular", "Unsupported findings")}\n${unsupported.map(entry).join("\n") || "- —"}\n\n## ${heading("Sınırlar ve açık kalan sorular", "Limitations and open questions")}\n${limitations.map((x) => `- ${x}`).join("\n") || "- —"}\n\n## ${heading("Gerçekte okunan kaynaklar", "Retrieved sources")}\n${(checkpoint.sources || []).map((s) => `- [${s.title || s.url}](${s.url})`).join("\n") || heading("- Kaynak içeriği alınamadı.", "- No source content retrieved.")}${!evidence.length && checkpoint.sources?.length ? `\n\n${heading("Kaynaklar korundu; yapılandırılmış bulgu henüz üretilemedi.", "Sources were preserved; structured findings have not yet been produced.")}` : ""}\n${interactions ? `\n## ${heading("Araştırma etkileşimleri", "Research interactions")}\n${interactions}\n` : ""}`;
}
export function atomicWrite(file, text) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temp = `${file}.${process.pid}.${crypto.randomUUID()}.tmp`;
  try {
    fs.writeFileSync(temp, text, { encoding: "utf8", mode: 0o600 });
    for (let attempt = 0; ; attempt++) {
      try { fs.renameSync(temp, file); break; }
      catch (error) {
        if (process.platform !== "win32" || !["EPERM", "EACCES", "EBUSY"].includes(error.code) || attempt >= 3) throw error;
        // Windows readers/antivirus may briefly hold the destination. Never delete it.
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, [10, 25, 50][attempt]);
      }
    }
  }
  finally { if (fs.existsSync(temp)) fs.rmSync(temp, { force: true }); }
}
export function projectArtifacts(state, checkpoint, writeJson, status = state.status) {
  writeJson(path.join(state.outputPath, "sources.json"), checkpoint.sources);
  writeJson(path.join(state.outputPath, "findings.json"), checkpoint.batches);
  writeJson(path.join(state.outputPath, "evidence.json"), evidenceFor(checkpoint.claims, checkpoint.sources));
  const output = renderReport(state, checkpoint, status);
  atomicWrite(path.join(state.outputPath, "report.md"), output);
  return output;
}
