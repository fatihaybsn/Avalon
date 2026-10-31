import { Stretch } from "@soundtouchjs/core";

// One processor per utterance: keep overlap history across PCM packets, and
// drain it BEFORE the renderer acknowledges playback. Microphone PCM is untouched.
export class SpeechTempo {
  readonly speed: number;
  private readonly stretch: Stretch | null;
  private inputFrames = 0;
  private outputFrames = 0;
  private ended = false;

  constructor(readonly sampleRate: number, speed: number) {
    this.speed = [1, 1.15, 1.2, 1.3].includes(speed) ? speed : 1;
    this.stretch = this.speed === 1 ? null : new Stretch({ sampleRate, createBuffers: true });
    if (this.stretch) this.stretch.tempo = this.speed;
  }

  push(mono: Float32Array): Float32Array {
    if (this.ended) throw new Error("Speech tempo stream already ended.");
    this.inputFrames += mono.length;
    if (!this.stretch) { this.outputFrames += mono.length; return mono; }
    const stereo = new Float32Array(mono.length * 2);
    for (let i = 0; i < mono.length; i++) stereo[i * 2] = stereo[i * 2 + 1] = mono[i];
    this.stretch.inputBuffer!.putSamples(stereo);
    this.stretch.process();
    return this.pull(Math.floor(this.inputFrames / this.speed) - this.outputFrames);
  }

  finish(): Float32Array {
    if (this.ended) return new Float32Array(0);
    this.ended = true;
    if (!this.stretch || !this.inputFrames) return new Float32Array(0);
    const remaining = Math.round(this.inputFrames / this.speed) - this.outputFrames;
    // Supply lookahead for the last WSOLA window. Only the original signal's
    // target duration is returned; padding never becomes an extra spoken tail.
    this.stretch.inputBuffer!.putSamples(new Float32Array((this.stretch.sampleReq * 2 + this.sampleRate) * 2));
    this.stretch.process();
    const tail = this.pull(remaining);
    this.stretch.clear();
    if (tail.length !== remaining) throw new Error("Speech tempo tail could not be drained.");
    return tail;
  }

  private pull(limit: number): Float32Array {
    const output = this.stretch!.outputBuffer!;
    const frames = Math.max(0, Math.min(limit, output.frameCount));
    const stereo = new Float32Array(frames * 2);
    output.extract(stereo, 0, frames);
    output.receive(frames);
    const mono = new Float32Array(frames);
    for (let i = 0; i < frames; i++) mono[i] = stereo[i * 2];
    this.outputFrames += frames;
    return mono;
  }
}
