import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import { SpeechTempo } from "./speechTempoFixture.mjs";

const source = ts.transpileModule(fs.readFileSync(new URL("../src/lib/startupSounds.ts", import.meta.url), "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;

function fixture({ state = "running", broken = false } = {}) {
  let now = 0;
  const oscillators = [], gains = [], contexts = [];
  const param = () => ({ calls: [], setValueAtTime(...args) { this.calls.push(args); },
    linearRampToValueAtTime(...args) { this.calls.push(args); },
    exponentialRampToValueAtTime(...args) { this.calls.push(args); } });
  class AudioContext {
    state = state;
    destination = {};
    constructor() { contexts.push(this); }
    get currentTime() { return now / 1000; }
    resume() { return Promise.reject(new Error("Autoplay blocked")); }
    createOscillator() {
      if (broken) throw new Error("No output device");
      const oscillator = { frequency: param(), stops: [], disconnected: false,
        connect() {}, disconnect() { this.disconnected = true; },
        start(at) { this.startAt = at; }, stop(at) { this.stops.push(at); } };
      oscillators.push(oscillator);
      return oscillator;
    }
    createGain() {
      const gain = { gain: param(), connect() {}, disconnect() { this.disconnected = true; } };
      gains.push(gain); return gain;
    }
  }
  const context = vm.createContext({ exports: {}, AudioContext, performance: { now: () => now } });
  vm.runInContext(source, context);
  return { player: context.exports.startupSounds, oscillators, gains, contexts, advance: (ms) => { now += ms; } };
}

test("real checks are deduplicated and simultaneous successes form a bounded rising rhythm", () => {
  const { player, oscillators } = fixture();
  player.begin();
  for (const id of ["runtime", "output", "uplink", "input", "hermes", "uplink"]) player.check(id);
  assert.equal(oscillators.length, 10);
  const fundamentals = oscillators.filter((_, i) => i % 2 === 0);
  for (let i = 1; i < fundamentals.length; i++) {
    assert.ok(Math.abs(fundamentals[i].startAt - fundamentals[i - 1].startAt - 0.175) < 1e-8);
    assert.ok(fundamentals[i].frequency.calls[0][0] > fundamentals[i - 1].frequency.calls[0][0]);
  }
  assert.ok(Math.max(...oscillators.map((osc) => osc.stops[0])) < 0.9);
  assert.ok(fundamentals[0].frequency.calls[0][0] >= 200 && fundamentals[0].frequency.calls[0][0] < 230);
  assert.ok(fundamentals.at(-1).frequency.calls[1][0] < 450);
  assert.equal(oscillators[1].type, "triangle");
  assert.equal(oscillators[1].frequency.calls[0][0], 105);
});

test("activation retires pending ticks, runs once, and clears its echo gate within the existing fade", () => {
  const { player, oscillators, advance } = fixture();
  player.begin(); player.check("runtime"); player.check("uplink");
  const ticks = [...oscillators];
  player.activate(); player.activate(); player.check("late optional health");
  assert.ok(ticks.every((osc) => osc.stops.length === 2 && osc.disconnected));
  assert.equal(oscillators.length, 7);
  assert.ok(Math.max(...oscillators.slice(4).map((osc) => osc.stops[0])) <= 0.33);
  assert.equal(player.inputSuppressed(), true);
  advance(450);
  assert.equal(player.inputSuppressed(), false);
});

test("Gemini PCM preempts ticks and prevents every later effect in the same boot", () => {
  const { player, oscillators, advance } = fixture();
  player.begin(); player.check("runtime"); player.check("uplink");
  player.beforeSpeech(); player.check("input"); player.activate();
  assert.equal(oscillators.length, 4);
  assert.ok(oscillators.every((osc) => osc.disconnected));
  advance(121);
  assert.equal(player.inputSuppressed(), false);
  player.end(); player.begin(); player.check("new session");
  assert.equal(oscillators.length, 6);
});

test("speech arriving before React mounts the boot cannot be forgotten", () => {
  const { player, oscillators } = fixture();
  player.beforeSpeech(); player.begin(); player.check("runtime"); player.activate();
  assert.equal(oscillators.length, 0);
});

test("mute and zero volume create no context or microphone gate; settings can cancel live effects", () => {
  for (const [enabled, volume] of [[false, 0.55], [true, 0]]) {
    const { player, contexts } = fixture();
    player.configure(enabled, volume); player.unlock(); player.begin(); player.check("runtime"); player.activate();
    assert.equal(contexts.length, 0);
    assert.equal(player.inputSuppressed(), false);
  }
  const { player, oscillators, advance } = fixture();
  player.begin(); player.check("runtime"); player.configure(false, 1);
  assert.ok(oscillators.every((osc) => osc.disconnected));
  advance(121); assert.equal(player.inputSuppressed(), false);
});

test("startup gain is bounded independently of speech and respects volume", () => {
  for (const [volume, expected] of [[0.5, 0.0572], [8, 0.1144], [NaN, 0.06292]]) {
    const { player, gains } = fixture();
    player.configure(true, volume); player.begin(); player.check("runtime");
    assert.ok(Math.abs(gains[0].gain.calls[1][0] - expected) < 1e-8);
  }
});

test("blocked autoplay and unavailable output stay silent without deferred replay or rejection", async () => {
  const { player, oscillators, contexts } = fixture({ state: "suspended" });
  player.begin(); player.check("runtime");
  await Promise.resolve();
  assert.equal(player.inputSuppressed(), false);
  contexts[0].state = "running";
  player.check("runtime"); // A result skipped during suspension is never replayed.
  assert.equal(oscillators.length, 0);
  player.check("uplink"); assert.equal(oscillators.length, 2);
  const broken = fixture({ broken: true });
  assert.doesNotThrow(() => { broken.player.begin(); broken.player.check("runtime"); broken.player.activate(); });
  assert.equal(broken.player.inputSuppressed(), false);
});

test("stopping a boot cancels future sounds and bounds the tail without extending it", () => {
  const { player, oscillators, advance } = fixture();
  player.begin(); for (let i = 0; i < 5; i++) player.check(String(i));
  player.end(); advance(80); player.end(); advance(41);
  assert.equal(player.inputSuppressed(), false);
  player.check("late result"); player.activate();
  assert.equal(oscillators.length, 10);
  assert.ok(oscillators.every((osc) => osc.disconnected));
});

test("ended oscillators release their graph connections", () => {
  const { player, oscillators, gains } = fixture();
  player.begin(); player.check("runtime");
  oscillators.forEach((osc) => osc.onended());
  assert.ok(oscillators.every((osc) => osc.disconnected));
  assert.ok(gains.every((gain) => gain.disconnected));
});

test("the microphone path drops effect PCM and VAD starts, then recovers; incoming speech preempts synchronously", async () => {
  const effects = [], handlers = {}, commands = [], sent = [], worklets = [];
  let vadOptions, blocked = true, speechPreemptions = 0, ends = 0;
  const gate = { inputSuppressed: () => blocked, beforeSpeech: () => { speechPreemptions++; }, end: () => { ends++; } };
  const graphNode = () => ({ connect() {}, disconnect() {} });
  class AudioWorkletNode {
    port = { onmessage: null };
    constructor() { worklets.push(this); }
    connect() {} disconnect() {}
  }
  class AudioContext {
    sampleRate = 16000;
    audioWorklet = { addModule: async () => {} };
    createMediaStreamSource = graphNode;
    createAnalyser = graphNode;
    close = async () => {};
  }
  const track = { stop() {} }, stream = { getTracks: () => [track], getAudioTracks: () => [track] };
  const iris = {
    sendAudioChunk: (chunk) => sent.push(chunk),
    sendCommand: async (command) => { commands.push(command); },
    ...Object.fromEntries(["onAudioChunk", "onAudioInterrupt", "onSidecarEvent", "onAudioOutputEnd"]
      .map((name) => [name, (callback) => { handlers[name] = callback; return () => {}; }])),
  };
  const hookSource = ts.transpileModule(fs.readFileSync(new URL("../src/hooks/useAudioPipeline.ts", import.meta.url), "utf8")
    .replaceAll("import.meta.env.BASE_URL", '"./"'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const context = vm.createContext({ exports: {}, AudioContext, AudioWorkletNode, URL, ArrayBuffer, Float32Array, Uint8Array, Int16Array,
    requestAnimationFrame: () => 1, cancelAnimationFrame() {}, navigator: { mediaDevices: { getUserMedia: async () => stream } },
    window: { iris, location: { href: "https://iris.test/" } },
    require(name) {
      if (name === "react") return { useRef: (value) => ({ current: value }), useState: (value) => [value, () => {}], useEffect: (effect) => effects.push(effect) };
      if (name.includes("vad-web")) return { MicVAD: { new: async (options) => {
        vadOptions = options; return { start: async () => {}, destroy: async () => {} };
      } } };
      if (name.includes("startupSounds")) return { startupSounds: gate };
      if (name.endsWith("/speechTempo")) return { SpeechTempo };
      if (name.endsWith("/audio")) return { downsampleTo16k: (input) => new Int16Array(input.length), parsePcmRate: () => 24000 };
      throw new Error(`Unexpected import: ${name}`);
    },
  });
  vm.runInContext(hookSource, context);
  const pipeline = context.exports.useAudioPipeline(true, () => {});
  const cleanup = effects.map((effect) => effect());
  await pipeline.startCapture(); await Promise.resolve();
  const frame = new Float32Array(1024);
  worklets[0].port.onmessage({ data: frame }); vadOptions.onSpeechRealStart();
  assert.equal(sent.length, 0);
  assert.equal(commands.some((command) => command.type === "speech_activity" && command.active), false);
  blocked = false;
  worklets[0].port.onmessage({ data: frame }); vadOptions.onSpeechRealStart();
  assert.equal(sent.length, 1);
  assert.equal(commands.some((command) => command.type === "speech_activity" && command.active), true);
  handlers.onAudioChunk({ pcm: new ArrayBuffer(0), mimeType: "audio/pcm;rate=24000" });
  assert.equal(speechPreemptions, 1, "Cancellation must happen before the playback promise runs");
  handlers.onSidecarEvent({ type: "voice_owner", deviceId: "phone" });
  assert.equal(ends, 1);
  await pipeline.stopCapture();
  cleanup.forEach((callback) => callback?.());
});
