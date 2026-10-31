// Provider-declared controls checked on 2026-10-26: Evren /v1/models +
// /openapi.json, and models.opencode.ai/api.json (opencode.reasoning_options).
// Unknown controls stay hidden. No generic effort ladder is assumed.
const evren = {
  "gemma-4-31b": [],
  "qwen3.8-flash-next": ["high", "xhigh"],
  "mimo-v2.6-pro": ["none", "minimal", "low", "medium", "high", "xhigh"],
  "deepseek-v4.1-flash": ["minimal", "low", "medium", "high"],
  "glm-5.3": ["minimal", "low", "medium", "high"],
};
const opencode = {
  "beam-free": ["low", "medium", "high", "xhigh", "max"],
  "deepseek-v4.1-flash-free": ["low", "high", "max"],
  "flint-40b-free": ["low", "medium", "high", "xhigh", "max"],
  "glm-5.3-flash-free": ["low", "high", "max"],
  "nemotron-3.5-super-vl-free": ["none", "minimal", "low", "medium", "high", "xhigh"],
};
const labels = { default: "Varsayılan", enabled: "Açık — otomatik seviye", disabled: "Kapalı", none: "Yok (none)", minimal: "En az (minimal)", low: "Düşük (low)", medium: "Orta (medium)", high: "Yüksek (high)", xhigh: "Çok yüksek (xhigh)", max: "En yüksek (max)" };

export function reasoningOptions(route) {
  const levels = (route.provider === "evren" ? evren : opencode)[route.modelId] || [];
  const toggle = route.provider === "evren" && Object.hasOwn(evren, route.modelId);
  return ["default", ...(toggle ? ["enabled", "disabled"] : []), ...levels].map((value) => ({
    value, label: labels[value], wire: reasoningBody({ ...route, reasoning: value }),
  }));
}

export function reasoningBody(route) {
  const level = route.reasoning || "default";
  if (level === "default") return {};
  if (route.provider === "evren") {
    if (level === "enabled" || level === "disabled") return { thinking: level === "enabled" };
    // Resolve gateway-declared aliases explicitly so the UI shows the wire value.
    const aliases = route.modelId === "qwen3.8-flash-next" ? { high: "xhigh" }
      : ["deepseek-v4.1-flash", "glm-5.3"].includes(route.modelId) ? { minimal: "low", medium: "high" } : {};
    return { thinking: level !== "none", reasoning_effort: aliases[level] || level };
  }
  return { reasoning_effort: level };
}

export const brainExecutionKey = (route) => `${route.provider}/${route.modelId}/${route.reasoning || "default"}`;
export function brainProviderSlug(route) {
  // An immutable provider entry pins reasoning for already-running workers.
  const suffix = route.reasoning && route.reasoning !== "default"
    ? `-${route.modelId}-${route.reasoning}`.replace(/[^a-z0-9-]/g, "-") : "";
  return `iris-${route.provider}${suffix}`;
}
