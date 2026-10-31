// Opt-in real-service smoke test. Creates and removes its own Hermes session;
// never submits computer work, edits global tool settings, or prints API keys.
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadEnvFiles } from "../electron/configStore.mjs";
import { HermesGatewayClient } from "../electron/hermesGatewayClient.mjs";
import { HermesInteractiveTransport } from "../electron/hermesInteractiveTransport.mjs";
import { conversationContext, decodeBrainReply, assertConversationTools, VoiceRelay, relayInstructions } from "../electron/voiceRelay.mjs";
import { GoogleGenAI } from "@google/genai";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
loadEnvFiles({ repoRoot: root });
const client = new HermesGatewayClient({
  candidates: () => [{ cmd: process.env.HERMES_BIN || "hermes", args: [] }],
  env: { ...process.env, HERMES_TUI_TOOLSETS: "web,clarify" },
});
const transport = new HermesInteractiveTransport({ client, conversationOnly: true });
let session;
try {
  session = await transport.createSession();
  assertConversationTools(await client.request("tools.show", { session_id: session.liveSessionId }));
  console.log("Restricted Hermes session verified.");
  const completed = new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("Hermes conversation timed out")), 90000);
    transport.once("complete", (item) => { clearTimeout(timeout); item.status === "completed" ? resolve(item) : reject(new Error(item.error)); });
  });
  await transport.submit({ task: "Bu bir bağlantı testidir. Yalnızca 'Merhaba, bağlantı hazır.' diyerek yanıtla. Hiçbir araç kullanma.", sessionId: session.id, kind: "conversation", context: conversationContext() });
  const answer = decodeBrainReply((await completed).output);
  if (!answer.reply || answer.proposal) throw new Error("Unexpected brain response");
  console.log(JSON.stringify({ brainReply: answer.reply, brainModel: session.info?.model || "reported in Hermes session" }));
  if (process.argv.includes("--with-gemini")) {
    if (!process.env.GEMINI_API_KEY) throw new Error("No Gemini API key configured");
    let live;
    let audioBytes = 0;
    let resolveRead, rejectRead;
    const read = new Promise((resolve, reject) => { resolveRead = resolve; rejectRead = reject; });
    const relay = new VoiceRelay({
      send: (text) => live.sendRealtimeInput({ text }),
      audio: (chunk) => { audioBytes += Buffer.from(chunk.data, "base64").byteLength; },
      interrupt() {},
      event: (event) => {
        if (event.type === "voice_fidelity") console.log(JSON.stringify(event));
        if (event.type === "voice_relay_error") rejectRead(new Error(event.error));
        if (event.type === "voice_output_end") resolveRead();
      },
    });
    const model = process.env.GEMINI_LIVE_MODEL || "models/gemini-3.1-flash-live-preview";
    const timeout = setTimeout(() => rejectRead(new Error("Gemini read-back timed out")), 45000);
    try {
      live = await new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY }).live.connect({
        model,
        config: { responseModalities: ["AUDIO"], outputAudioTranscription: {}, systemInstruction: relayInstructions(), speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: process.env.GEMINI_LIVE_VOICE || "Zephyr" } } } },
        callbacks: {
          onmessage: ({ serverContent: c }) => {
            if (!c) return;
            if (c.outputTranscription?.text) relay.transcript(c.outputTranscription.text);
            for (const part of c.modelTurn?.parts || []) if (part.inlineData?.data) relay.chunk(part.inlineData);
            if (c.turnComplete) relay.turnComplete();
          },
          onerror: (error) => rejectRead(new Error(error.message || "Gemini connection failed")),
        },
      });
      relay.connect();
      relay.enqueue(answer.reply, { critical: true });
      await read;
      if (!audioBytes) throw new Error("Gemini returned no verified audio");
      console.log(JSON.stringify({ geminiModel: model, verifiedAudioBytes: audioBytes }));
    } finally { clearTimeout(timeout); live?.close(); }
  }
} finally {
  if (session) await transport.deleteSession(session.id).catch(() => undefined);
  transport.close({ force: true });
}
