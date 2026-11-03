// Offline model responses for the actual research delivery/review protocol.
export function reviewedDelivery(prompt, { resolved = true, gaps = [], inaccessible = [] } = {}) {
  const criteria = JSON.parse(prompt.match(/\nCriteria: ([^\n]+)/)?.[1] || "[]");
  const findings = JSON.parse(prompt.match(/\nAccepted findings \(do not duplicate\): ([^\n]+)/)?.[1] || "[]");
  return { findings: [], gaps, inaccessible,
    assessments: findings.map((f) => ({ findingId: f.id, status: f.verified ? "supported" : "pending", reason: "The supplied source supports this atomic claim." })),
    criteria: criteria.map((c) => ({ id: c.id, resolved: resolved && !gaps.length, findingIds: findings.filter((f) => f.verified && f.criterionIds.includes(c.id)).map((f) => f.id), gap: gaps[0] || (resolved ? "" : "The question remains unresolved.") })),
  };
}
export function reportOutline(prompt) {
  const evidence = JSON.parse(prompt.match(/\nEvidence: ([^\n]+)/)?.[1] || "[]");
  return { sections: [{ title: "Araştırma bulguları", findingIds: evidence.map((f) => f.id) }] };
}
import { EventEmitter } from "node:events";
import { HermesInteractiveTransport } from "../electron/hermesInteractiveTransport.mjs";


export function durablePeer(onPrompt) {
  const calls = []; let serial = 0;
  return { calls, factory: async ({ directory } = {}) => {
    const id = `offline-${++serial}`, client = new EventEmitter(); client.close = () => {};
    client.request = async (method, params) => {
      calls.push({ method, params, directory });
      if (method === "session.create") return { session_id: id, stored_session_id: id };
      if (method === "tools.show") return { sections: [{ tools: [{ name: "web_search" }, { name: "web_extract" }, { name: "write_file" }] }] };
      if (method === "prompt.submit") setImmediate(() => {
        const emit = (name, args, result) => client.emit("event", { session_id: id, type: "tool.complete", payload: { name, args, result } });
        const finish = (result, status = "complete") => client.emit("event", { session_id: id, type: "message.complete", payload: { status, text: typeof result === "string" ? result : JSON.stringify(result) } });
        const context = { id, client, params, directory, emit, finish };
        if (onPrompt?.(context)) return;
        if (params.text.includes("Plan a targeted")) finish({ questions: ["A", "B", "C"], criteria: ["Source-backed answer"] });
        else if (params.text.includes("Synthesize")) finish(reportOutline(params.text));
        else if (params.text.includes("Find independent corroboration")) finish(reviewedDelivery(params.text));
        else {
          const url = `https://${id}.example/page`, quote = "This atomic claim is documented by the original source.";
          emit("web_extract", {}, { url, content: `${quote} `.repeat(4) });
          finish({ findings: [{ text: `Fact ${id}`, url, quote }], resolved: true, gaps: [], inaccessible: [] });
        }
      });
      return { status: "ok" };
    };
    return { client, transport: new HermesInteractiveTransport({ client, defaultCwd: directory }) };
  } };
}
