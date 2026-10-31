import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import { SpeechTempo } from "./speechTempoFixture.mjs";

const source = ts.transpileModule(fs.readFileSync(new URL("../src/hooks/useAudioPipeline.ts", import.meta.url), "utf8").replaceAll("import.meta.env.BASE_URL", '"./"'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const settle = () => new Promise(setImmediate);

function fixture() {
  const handlers = {}, commands = [], sources = [], refs = [], effects = [], logs = [];
  let cursor = 0, mounted = false;
  class AudioContext {
    state = "running"; currentTime = 0;
    createBuffer(_channels, frames, rate) {
      const samples = new Float32Array(frames);
      return { duration: frames / rate, getChannelData: () => samples };
    }
    createAnalyser() { return { context: this, connect() {}, disconnect() {} }; }
    createBufferSource() {
      const node = { connect() {}, disconnect() {}, start(at) { this.at = at; },
        stop() { this.stopped = true; this.onended?.(); }, end() { this.onended?.(); } };
      sources.push(node); return node;
    }
    async close() {}
  }
  const iris = { sendCommand: async (command) => commands.push(JSON.parse(JSON.stringify(command))),
    ...Object.fromEntries(["onAudioChunk", "onAudioInterrupt", "onSidecarEvent", "onAudioOutputEnd"].map((name) => [name, (callback) => { handlers[name] = callback; return () => {}; }])) };
  const context = vm.createContext({ exports: {}, AudioContext, ArrayBuffer, DataView, Uint8Array, Float32Array,
    requestAnimationFrame: () => 1, cancelAnimationFrame() {}, window: { iris },
    require(name) {
      if (name === "react") return { useRef(value) { const i = cursor++; return refs[i] ||= { current: value }; }, useState: (value) => [value, () => {}], useEffect: (effect) => { if (!mounted) effects.push(effect); } };
      if (name.includes("vad-web")) return {};
      if (name.endsWith("/speechTempo")) return { SpeechTempo };
      if (name.endsWith("/startupSounds")) return { startupSounds: { beforeSpeech() {}, end() {} } };
      if (name.endsWith("/audio")) return { parsePcmRate: () => 24000 };
      throw new Error(`Unexpected import: ${name}`);
    },
  });
  vm.runInContext(source, context);
  function render(rate) { cursor = 0; const pipeline = context.exports.useAudioPipeline(true, (...args) => logs.push(args), "", rate); if (!mounted) { mounted = true; effects.forEach((effect) => effect()); } return pipeline; }
  const pipeline = render(1.3);
  const chunk = (id, frames = 2400) => {
    const pcm = new ArrayBuffer(frames * 2), view = new DataView(pcm);
    for (let i = 0; i < frames; i++) view.setInt16(i * 2, Math.sin(i * 2 * Math.PI * 440 / 24000) * 16000, true);
    handlers.onAudioChunk({ utteranceId: id, pcm, mimeType: "audio/pcm;rate=24000" });
  };
  return { handlers, commands, sources, logs, pipeline, render, chunk };
}

test("approval playback acknowledgement waits for the time-stretched tail, then fires exactly once", async () => {
  const f = fixture();
  for (let i = 0; i < 10; i++) f.chunk("approval");
  await settle();
  f.sources.forEach((source) => source.end());
  assert.equal(f.commands.length, 0, "server end has not arrived yet");
  const beforeTail = f.sources.length;
  f.handlers.onAudioOutputEnd({ utteranceId: "approval" }); await settle();
  assert.ok(f.sources.length > beforeTail);
  assert.equal(f.commands.length, 0, "tail is still audible");
  assert.ok(Math.abs(f.sources.reduce((n, source) => n + source.buffer.duration, 0) - Math.round(24000 / 1.3) / 24000) < 1e-9);
  f.sources.slice(beforeTail).forEach((source) => source.end());
  assert.deepEqual(f.commands, [{ type: "playback_ended", utteranceId: "approval" }]);
  f.handlers.onAudioOutputEnd({ utteranceId: "approval" }); await settle();
  assert.equal(f.commands.length, 1);
  assert.equal(f.logs.length, 0);
});

test("barge-in drops queued DSP and audible sources; late end cannot acknowledge cancelled speech", async () => {
  const f = fixture();
  f.chunk("cancelled"); await settle();
  f.chunk("cancelled"); f.handlers.onAudioInterrupt();
  f.handlers.onAudioOutputEnd({ utteranceId: "cancelled" }); await settle();
  assert.ok(f.sources.every((source) => source.stopped));
  assert.equal(f.commands.length, 0);
  const before = f.sources.length;
  f.chunk("fresh"); f.handlers.onAudioOutputEnd({ utteranceId: "fresh" }); await settle();
  assert.ok(f.sources.length > before);
  f.sources.slice(before).forEach((source) => source.end());
  assert.equal(f.commands.length, 1);
  assert.equal(f.commands[0].utteranceId, "fresh");
});

test("saving 1.0x changes the next utterance without changing speed midway through the current one", async () => {
  const f = fixture();
  f.chunk("first", 12000); await settle();
  f.render(1);
  f.chunk("first", 12000); f.handlers.onAudioOutputEnd({ utteranceId: "first" }); await settle();
  const duration = () => f.sources.reduce((n, source) => n + source.buffer.duration, 0);
  const first = duration();
  assert.ok(Math.abs(first - Math.round(24000 / 1.3) / 24000) < 1e-9);
  f.chunk("second", 24000); f.handlers.onAudioOutputEnd({ utteranceId: "second" }); await settle();
  assert.ok(Math.abs(duration() - first - 1) < 1e-9);
  for (let i = 1; i < f.sources.length; i++) assert.ok(Math.abs(f.sources[i].at - f.sources[i - 1].at - f.sources[i - 1].buffer.duration) < 1e-9, "scheduled buffers must meet without gaps");
});
