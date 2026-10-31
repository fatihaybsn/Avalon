// Observe real conversation tools only. This does not route prompts, dispatch
// work, or change the voice/standby lifecycle.
export function bindConversationWebSearch(transport, emit) {
  const active = new Map();
  const publish = (sessionId, detail = {}) => emit({
    type: "web_search",
    session_id: sessionId,
    state: [...active.values()].some((run) => run.sessionId === sessionId && run.tools.size) ? "searching" : "idle",
    ...detail,
  });
  transport.on("run-event", (event) => {
    if (!["web_search", "web_extract"].includes(event.tool) ||
        !["tool.started", "tool.completed"].includes(event.event)) return;
    const run = transport.getRun(event.runId);
    if (run?.kind !== "conversation" || !run.storedSessionId) return;
    const entry = active.get(event.runId) || { sessionId: run.storedSessionId, tools: new Set() };
    const key = event.toolId || event.tool;
    if (event.event === "tool.started") entry.tools.add(key);
    else entry.tools.delete(key);
    if (entry.tools.size) active.set(event.runId, entry);
    else active.delete(event.runId);
    publish(entry.sessionId, {
      run_id: event.runId, tool: event.tool, tool_id: event.toolId,
      tool_event: event.event, is_error: Boolean(event.isError),
    });
  });
  transport.on("complete", (run) => {
    const entry = active.get(run.runId);
    if (!entry) return;
    active.delete(run.runId);
    publish(entry.sessionId, { run_id: run.runId });
  });
}
