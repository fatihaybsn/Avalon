import test from "node:test";
import assert from "node:assert/strict";
import { SpeechTempo } from "./speechTempoFixture.mjs";

function render(input, sampleRate, speed, packet = 997) {
  const stream = new SpeechTempo(sampleRate, speed), chunks = [];
  for (let i = 0; i < input.length; i += packet) chunks.push(stream.push(input.subarray(i, i + packet)));
  chunks.push(stream.finish());
  const output = new Float32Array(chunks.reduce((n, part) => n + part.length, 0));
  let offset = 0;
  for (const chunk of chunks) { output.set(chunk, offset); offset += chunk.length; }
  return output;
}
const sine = (rate, seconds, frequency = 440) => Float32Array.from({ length: Math.round(rate * seconds) }, (_, i) => Math.sin(2 * Math.PI * frequency * i / rate) * 0.5);
function frequency(samples, rate) {
  const start = Math.floor(samples.length * 0.2), end = Math.floor(samples.length * 0.8);
  const crossings = [];
  for (let i = start + 1; i < end; i++) if (samples[i - 1] < 0 && samples[i] >= 0) crossings.push(i);
  return (crossings.length - 1) * rate / (crossings.at(-1) - crossings[0]);
}

test("supported speech speeds shorten streaming PCM to the selected duration without raising pitch", () => {
  for (const rate of [16000, 24000, 48000]) for (const speed of [1.15, 1.2, 1.3]) {
    const input = sine(rate, 2), output = render(input, rate, speed);
    assert.equal(output.length, Math.round(input.length / speed));
    assert.ok(Math.abs(frequency(output, rate) - 440) < 3, `pitch changed at ${rate}Hz / ${speed}x`);
    assert.ok(output.every(Number.isFinite));
  }
});

test("1.0x is sample-exact and output does not depend on packet boundaries", () => {
  const input = sine(24000, 1.2);
  assert.deepEqual(render(input, 24000, 1), input);
  assert.deepEqual(render(input, 24000, 1.3, 113), render(input, 24000, 1.3, 8192));
});

test("end-of-stream draining preserves the final voiced segment, even for short clips", () => {
  const input = sine(24000, 0.6, 700);
  input.fill(0, 0, 9600);
  const output = render(input, 24000, 1.3);
  const tail = output.subarray(-Math.round(24000 * 0.06));
  assert.ok(tail.reduce((sum, sample) => sum + sample * sample, 0) / tail.length > 0.02);
  for (const duration of [0, 0.01, 0.04]) assert.equal(render(sine(24000, duration), 24000, 1.3).length, Math.round(24000 * duration / 1.3));
});
