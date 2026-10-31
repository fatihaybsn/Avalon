import fs from "node:fs";
import path from "node:path";

// Metadata only: never persist spoken text, prompts, audio or credentials.
export function appendVoiceRelayLog(file, event, state) {
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
    if (fs.existsSync(file) && fs.statSync(file).size > 2 * 1024 * 1024) {
      fs.rmSync(`${file}.1`, { force: true });
      fs.renameSync(file, `${file}.1`);
    }
    const record = {
      at: new Date().toISOString(), type: event.type, utterance_id: event.utterance_id,
      run_id: event.run_id, reason: event.reason, matches: event.matches,
      delivery_id: event.delivery_id, audioChunks: event.audioChunks,
      critical: event.critical, error: Boolean(event.error),
      expectedLength: event.expected?.length, actualLength: event.actual?.length,
      connected: state.connected, modelBusy: state.modelBusy, inputOpen: state.inputOpen,
      brainPending: Boolean(state.brainPending), queued: state.queue.length,
      playbackPending: state.pendingPlayback.size, active: state.active?.id,
    };
    fs.appendFileSync(file, `${JSON.stringify(record)}\n`, { mode: 0o600 });
  } catch { /* Diagnostics must never prevent delivery. */ }
}
