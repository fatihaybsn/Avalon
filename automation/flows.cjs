"use strict";

const types = Object.freeze({ start: "avalon-start", research: "avalon-research", hermes: "avalon-hermes", finish: "avalon-finish" });
const allowed = new Set(["tab", "comment", "switch", "change", "catch", ...Object.values(types)]);
const validId = (id) => typeof id === "string" && /^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,79}$/.test(id);
const valueTypes = new Set(["str", "num", "bool", "json", "msg"]);
const safeProperty = (value) => typeof value === "string" && /^(payload|topic|feedback)(\.[a-zA-Z0-9_-]+)*$/.test(value) && !/(?:__proto__|constructor|prototype)/.test(value);
const operators = new Set(["eq", "neq", "lt", "lte", "gt", "gte", "btwn", "cont", "true", "false", "null", "nnull", "empty", "nempty", "else", "istype"]);

function checkEditorFlows(flows) {
  if (!Array.isArray(flows) || flows.length > 500 || flows.some((node) =>
    !node || !validId(node.id) || !allowed.has(node.type) || (node.env != null && (!Array.isArray(node.env) || node.env.length)) || node.credentials) ||
    new Set(flows.map((node) => node.id)).size !== flows.length || JSON.stringify(flows).length > 2_000_000) {
    throw new Error("Desteklenmeyen veya geçersiz düğüm. Avalon, switch, change, catch ve açıklamalar kullanılabilir.");
  }
  for (const node of flows) {
    if (node.type === "switch" && (node.propertyType !== "msg" || !safeProperty(node.property) ||
        ![false, "false"].includes(node.checkall) || node.repair === true || node.repair === "true" ||
        !Array.isArray(node.rules) || !node.rules.length || node.rules.length > 20 ||
        node.rules.some((rule) => !operators.has(rule.t) || (rule.vt && !valueTypes.has(rule.vt)) ||
          (rule.v2t && !valueTypes.has(rule.v2t)) || (rule.vt === "msg" && !safeProperty(rule.v)) ||
          (rule.v2t === "msg" && !safeProperty(rule.v2))))) {
      throw new Error("Koşul: msg alanı ve ilk eşleşen çıkış kullanılmalı; ifadeler ve mesaj biriktirme desteklenmiyor.");
    }
    if (node.type === "change" && (!Array.isArray(node.rules) || node.rules.length > 20 || node.rules.some((rule) =>
      !["set", "delete", "move"].includes(rule.t) || rule.pt !== "msg" || !safeProperty(rule.p) ||
      (rule.t === "move" ? !safeProperty(rule.to) || rule.tot !== "msg" : rule.t === "set" &&
        (!valueTypes.has(rule.tot) || (rule.tot === "msg" && !safeProperty(rule.to))))))) {
      throw new Error("Değişiklikler yalnızca msg.payload, msg.topic ve msg.feedback alanlarında yapılabilir.");
    }
  }
}

function compileFlow(flows, id) {
  checkEditorFlows(flows);
  const tab = flows.find((node) => node.type === "tab" && node.id === id && !node.disabled);
  if (!tab) throw new Error("Etkin akış bulunamadı.");
  const nodes = flows.filter((node) => node.z === id && node.type !== "comment");
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const starts = nodes.filter((node) => node.type === types.start);
  if (starts.length !== 1) throw new Error("Akışta bir Avalon Başlangıç adımı olmalı.");
  const tasks = nodes.filter((node) => [types.research, types.hermes].includes(node.type));
  if (!tasks.length || !nodes.some((node) => node.type === types.finish)) throw new Error("En az bir görev ve Avalon Bitiş gerekli.");
  for (const node of nodes) {
    const wires = node.wires || [];
    const outputs = node.type === "switch" ? node.rules.length : [types.research, types.hermes].includes(node.type) ? 2 : node.type === types.finish ? 0 : 1;
    if (node.d || !Array.isArray(wires) || wires.length > outputs || wires.some((wire) =>
      !Array.isArray(wire) || wire.length > 1 || wire.some((target) => !byId.has(target) || [types.start, "catch"].includes(byId.get(target).type)))) {
      throw new Error("Geçersiz bağlantı veya devre dışı adım. Her çıkış tek hedefe bağlanmalı; paralel kollar desteklenmiyor.");
    }
    if (node.type !== types.finish && !wires.flat().length) throw new Error("Adımı bir hedefe bağlayın: " + (node.name || node.id));
    if (node.type === "catch" && node.scope != null && (!Array.isArray(node.scope) || !node.scope.length ||
      node.scope.some((target) => !tasks.some((task) => task.id === target)))) throw new Error("Catch kapsamı görev düğümlerini seçmeli.");
    if (node.onError === "route" && !wires[1]?.length) throw new Error("Hata sonucu için ikinci çıkışı bağlayın.");
  }
  for (const task of tasks.filter((task) => task.onError === "catch")) {
    if (nodes.filter((node) => node.type === "catch" && (node.scope == null || node.scope.includes(task.id))).length !== 1) {
      throw new Error("Catch hata davranışı seçilen görev tam bir catch düğümüne bağlı olmalı.");
    }
  }
  const reachable = new Set();
  const visit = (nodeId) => {
    if (reachable.has(nodeId)) return;
    reachable.add(nodeId);
    for (const target of byId.get(nodeId).wires?.flat() || []) visit(target);
  };
  visit(starts[0].id);
  for (const node of nodes.filter((node) => node.type === "catch")) visit(node.id);
  if (nodes.some((node) => !reachable.has(node.id))) throw new Error("Bütün adımlar Başlangıç veya hata akışına bağlı olmalı.");
  const exits = new Set(nodes.filter((node) => node.type === types.finish).map((node) => node.id));
  for (let changed = true; changed;) {
    changed = false;
    for (const node of nodes) if (!exits.has(node.id) && node.wires?.flat().some((target) => exits.has(target))) {
      exits.add(node.id); changed = true;
    }
  }
  if (nodes.some((node) => !exits.has(node.id))) throw new Error("Her adımın Bitiş'e ulaşabilen bir çıkışı olmalı.");
  const steps = tasks.map((node) => {
    const inputs = node.reportInputs ?? [];
    if (!Array.isArray(inputs) || new Set(inputs).size !== inputs.length || inputs.some((input) => input === node.id ||
      !tasks.some((prior) => prior.id === input && (node.type === types.hermes || prior.type === types.research)))) throw new Error("Geçersiz önceki çıktı seçimi.");
    const kind = node.type === types.hermes ? "hermes" : "research";
    const topic = typeof node.topic === "string" ? node.topic.trim() : "";
    const prompt = typeof node.prompt === "string" ? node.prompt.trim() : "";
    if (!(kind === "hermes" ? prompt : topic) || (kind === "hermes" ? prompt : topic).length > 12000) throw new Error("Her görev için 1–12000 karakter talimat/konu girin.");
    const maxAttempts = Number(node.maxAttempts ?? 3), timeoutMs = Number(node.timeoutMs ?? 7_200_000);
    if (node.requireApproval != null && typeof node.requireApproval !== "boolean") throw new Error("Başlatma onayı true veya false olmalı.");
    if (!Number.isInteger(maxAttempts) || maxAttempts < 1 || maxAttempts > 100 || !Number.isInteger(timeoutMs) || timeoutMs < 1000 || timeoutMs > 7_200_000 ||
      !["stop", "route", "catch"].includes(node.onError || "stop")) throw new Error("Geçersiz deneme sınırı, zaman aşımı veya hata davranışı.");
    if (kind === "hermes" && (!["text", "json", "evaluation", "files"].includes(node.outputType || "text") ||
      (node.requiredFields && (typeof node.requiredFields !== "string" || node.requiredFields.length > 2000)) ||
      (node.requiredFiles && (typeof node.requiredFiles !== "string" || node.requiredFiles.length > 4000)) ||
      (node.workingDirectory && (typeof node.workingDirectory !== "string" || node.workingDirectory.length > 1000 || /[\0\r\n]/.test(node.workingDirectory))))) throw new Error("Geçersiz Hermes çıktı/klasör ayarı.");
    const requiredFiles = String(node.requiredFiles || "").split(/\r?\n/).map((file) => file.trim()).filter(Boolean);
    if (kind === "hermes" && ((node.outputType === "files" && !requiredFiles.length) || requiredFiles.some((file) =>
      /^[\\/]/.test(file) || /[:\0]/.test(file) || file.split(/[\\/]/).includes("..")))) throw new Error("Gerekli dosyalar çalışma klasörüne göre güvenli, göreli yollar olmalı.");
    return { id: node.id, kind, name: String(node.name || topic || "Hermes Görevi").slice(0, 140), topic, prompt,
      purpose: node.purpose ?? "", sites: node.sites ?? "", mode: node.mode ?? "deep", breadth: Number(node.breadth ?? 3), depth: Number(node.depth ?? 2),
      inputs, maxAttempts, timeoutMs, onError: node.onError || "stop", workingDirectory: node.workingDirectory || "",
      outputType: node.outputType || "text", requiredFields: node.requiredFields || "", requiredFiles: node.requiredFiles || "", requireApproval: node.requireApproval === true };
  });
  const graph = structuredClone([tab, ...nodes]);
  for (const node of graph) if (node.type === "switch") { node.checkall = "false"; node.repair = false; }
  return { id, name: String(tab.label || "Avalon").slice(0, 140), graph, steps };
}

// Templates deliberately omit free text, local paths and unknown configuration.
// A secret cannot be reliably detected inside arbitrary user prompts.
function portableFlows(flows) {
  checkEditorFlows(flows);
  const ids = new Map(flows.map((node, index) => [node.id, "shared-" + index]));
  const invalid = (field) => { throw new Error("Geçersiz paylaşım alanı: " + field); };
  const number = (value, fallback, min, max, integer = true) => {
    if (value == null) return fallback;
    if (!["number", "string"].includes(typeof value) || (typeof value === "string" && !value.trim())) return invalid("sayı");
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || (integer && !Number.isInteger(parsed)) || parsed < min || parsed > max) return invalid("sayı");
    return parsed;
  };
  const boolean = (value, fallback = false, legacy = false) => {
    if (value == null) return fallback;
    if (typeof value === "boolean") return value;
    if (legacy && ["true", "false"].includes(value)) return value === "true";
    return invalid("boolean");
  };
  const choice = (value, fallback, choices) => {
    const resolved = value == null || value === "" ? fallback : value;
    return typeof resolved === "string" && choices.includes(resolved) ? resolved : invalid("seçenek");
  };
  const reference = (id) => validId(id) && ids.has(id) ? ids.get(id) : invalid("düğüm referansı");
  const references = (value = []) => Array.isArray(value) ? value.map(reference) : invalid("referans listesi");
  const output = flows.map((node) => {
    // No raw value is copied merely because its key is known. Irrelevant
    // configuration is omitted, and retained data is parsed per node type.
    const result = { id: ids.get(node.id), type: node.type };
    if (node.type === "tab") {
      result.label = "Paylaşılan otomasyon";
      result.disabled = boolean(node.disabled, false, true);
      return result;
    }
    result.z = reference(node.z);
    if (!flows.some((tab) => tab.id === node.z && tab.type === "tab")) return invalid("akış referansı");
    for (const axis of ["x", "y"]) if (node[axis] != null) result[axis] = number(node[axis], 0, -Number.MAX_VALUE, Number.MAX_VALUE, false);
    if (node.type === "comment") return result;
    if (node.wires != null && !Array.isArray(node.wires)) return invalid("bağlantılar");
    result.wires = (node.wires || []).map(references);
    if ([types.research, types.hermes].includes(node.type)) {
      result.reportInputs = references(node.reportInputs ?? []);
      result.maxAttempts = number(node.maxAttempts, 3, 1, 100);
      result.timeoutMs = number(node.timeoutMs, 7200000, 1000, 7200000);
      result.onError = choice(node.onError, "stop", ["stop", "route", "catch"]);
      result.requireApproval = boolean(node.requireApproval);
      result.outputs = 2;
      if (node.type === types.research) {
        result.topic = "Kendi araştırma konunuzu yazın";
        result.mode = choice(node.mode, "deep", ["normal", "deep", "synthesis"]);
        result.breadth = number(node.breadth, 3, 3, 5);
        result.depth = number(node.depth, 2, 1, 3);
      } else {
        result.prompt = "Kendi görev talimatınızı yazın";
        const type = choice(node.outputType, "text", ["text", "json", "evaluation", "files"]);
        result.outputType = type === "files" ? "text" : type;
      }
    } else if (node.type === "switch") {
      result.property = node.property;
      result.propertyType = "msg";
      result.checkall = "false";
      result.repair = false;
      result.outputs = node.rules.length;
      result.rules = node.rules.map((rule) => ({ t: rule.t,
        ...(rule.v !== undefined ? { v: "", vt: "str" } : {}), ...(rule.v2 !== undefined ? { v2: "", v2t: "str" } : {}) }));
    } else if (node.type === "change") {
      result.outputs = 1;
      result.rules = node.rules.map((rule) => rule.t === "delete" ? { t: "delete", p: rule.p, pt: "msg" }
        : rule.t === "move" ? { t: "move", p: rule.p, pt: "msg", to: rule.to, tot: "msg" }
        : { t: "set", p: rule.p, pt: "msg", to: rule.tot === "msg" ? rule.to : "", tot: rule.tot === "msg" ? "msg" : "str" });
    } else if (node.type === "catch") {
      result.scope = node.scope == null ? null : references(node.scope);
      result.uncaught = boolean(node.uncaught, false, true);
      result.outputs = 1;
    } else result.outputs = node.type === types.finish ? 0 : 1;
    return result;
  });
  // Reuse the execution validator for wiring, references and task/error rules.
  // A disabled tab is checked as enabled without altering its exported state.
  const tabs = output.filter((node) => node.type === "tab");
  if (!tabs.length) return invalid("akış");
  for (const tab of tabs) compileFlow(output.map((node) => node === tab ? { ...tab, disabled: false } : node), tab.id);
  return output;
}

module.exports = { types, checkEditorFlows, compileFlow, portableFlows };
