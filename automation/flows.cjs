"use strict";

const types = Object.freeze({ start: "avalon-start", research: "avalon-research", finish: "avalon-finish" });
const allowed = new Set(["tab", "comment", ...Object.values(types)]);
const validId = (id) => typeof id === "string" && /^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,79}$/.test(id);

function checkEditorFlows(flows) {
  if (!Array.isArray(flows) || flows.length > 500 || flows.some((node) =>
    !node || !validId(node.id) || !allowed.has(node.type) || (node.env && node.env.length)) ||
    new Set(flows.map((node) => node.id)).size !== flows.length) {
    throw new Error("Bu düzenleyici Avalon adımlarını ve açıklama düğümlerini destekler.");
  }
}

function compileFlow(flows, id) {
  checkEditorFlows(flows);
  const tab = flows.find((node) => node.type === "tab" && node.id === id && !node.disabled);
  if (!tab) throw new Error("Etkin akış bulunamadı.");
  const nodes = flows.filter((node) => node.z === id && node.type !== "comment");
  const starts = nodes.filter((node) => node.type === types.start);
  if (starts.length !== 1) throw new Error("Akışta bir Avalon Başlangıç adımı olmalı.");
  const ordered = [];
  let current = starts[0];
  while (current) {
    if (current.d || ordered.some((node) => node.id === current.id)) throw new Error("Akışta döngü veya devre dışı adım var.");
    ordered.push(current);
    const wires = Array.isArray(current.wires) ? current.wires.flat() : [];
    if (current.type === types.finish && !wires.length) break;
    if (wires.length !== 1) throw new Error("Her adımı sıradaki tek adıma bağlayın.");
    current = nodes.find((node) => node.id === wires[0]);
  }
  const middle = ordered.slice(1, -1);
  if (ordered.length !== nodes.length || !middle.length || ordered.at(-1)?.type !== types.finish ||
    middle.some((node) => node.type !== types.research)) {
    throw new Error("Başlangıç ile Bitiş arasına bütün araştırma adımlarını sırayla bağlayın.");
  }
  const steps = middle.map((node, index) => {
    const inputs = node.reportInputs ?? [];
    if (!Array.isArray(inputs) || new Set(inputs).size !== inputs.length ||
      inputs.some((input) => !middle.slice(0, index).some((prior) => prior.id === input))) {
      throw new Error("Bir araştırma yalnızca önceki adımların raporlarını seçebilir.");
    }
    const topic = typeof node.topic === "string" ? node.topic.trim() : "";
    if (!topic || topic.length > 12000) throw new Error("Her araştırma adımı için bir konu girin.");
    return { id: node.id, name: String(node.name || topic).slice(0, 140), topic, purpose: node.purpose ?? "",
      sites: node.sites ?? "", mode: node.mode ?? "deep", breadth: Number(node.breadth ?? 3),
      depth: Number(node.depth ?? 2), inputs };
  });
  const graph = [{ id, type: "tab", label: String(tab.label || "Avalon").slice(0, 140) }, ...ordered.map((node, index) => ({
    id: node.id, type: node.type, z: id, wires: index + 1 < ordered.length ? [[ordered[index + 1].id]] : [],
  }))];
  return { id, name: graph[0].label, graph, steps };
}

module.exports = { types, checkEditorFlows, compileFlow };
