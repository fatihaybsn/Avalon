// Boot-only synthesis. Existing wake/sleep/task sounds keep their own tuning.
// No downloads, timers, or awaited playback on the critical startup path.
type Voice = { oscillator: OscillatorNode; gain: GainNode };
type Tone = {
  frequency: number; at: number; duration: number; peak: number;
  to?: number; glide?: number; attack?: number; type?: OscillatorType;
};

export class StartupSoundPlayer {
  private context: AudioContext | null = null;
  private voices = new Set<Voice>();
  private seen = new Set<string>();
  private enabled = true;
  private volume = 0.55;
  private active = false;
  private acceptingChecks = false;
  private speechStarted = false;
  private nextCheckAt = 0;
  private suppressUntil = 0;

  configure(enabled: boolean, volume: number) {
    this.enabled = enabled;
    this.volume = Number.isFinite(volume) ? Math.max(0, Math.min(1, volume)) : 0.55;
    if (!enabled || this.volume === 0) this.cancel();
  }

  // Call from the wake gesture. A blocked/suspended context simply stays silent;
  // never queue an autoplay retry that could sound over a later conversation.
  unlock() {
    if (!this.enabled || !this.volume) return;
    try {
      this.context ??= new AudioContext();
      if (this.context.state === "suspended") void this.context.resume().catch(() => undefined);
    } catch { /* Optional decoration. */ }
  }

  begin() {
    this.cancel();
    this.seen.clear();
    this.active = true;
    this.acceptingChecks = true;
    this.nextCheckAt = 0;
    this.unlock();
  }

  check(id: string) {
    if (!this.active || !this.acceptingChecks || this.seen.has(id)) return;
    this.seen.add(id);
    if (!this.canPlay()) return;
    const ac = this.context!;
    // Space simultaneous real results without delaying the results themselves.
    const at = Math.max(ac.currentTime + 0.02, this.nextCheckAt);
    this.nextCheckAt = at + 0.175;
    // Reference: ~175 ms impacts rising by ~1.2x, starting around 210 Hz.
    // Keep the short low-mid "tok" body instead of a bright musical chime.
    const frequency = 210 * 1.2 ** Math.min(this.seen.size - 1, 4);
    this.play(at, [
      { frequency: frequency * 1.04, to: frequency, glide: 0.024, at: 0, duration: 0.12, peak: 0.52, attack: 0.003 },
      { frequency: frequency * 0.5, at: 0, duration: 0.075, peak: 0.18, attack: 0.004, type: "triangle" },
    ]);
  }

  activate() {
    if (!this.active || !this.acceptingChecks) return;
    this.acceptingChecks = false;
    this.cancel(); // Retire pending ticks; the activation owns the fade window.
    if (!this.canPlay()) return;
    this.play(this.context!.currentTime + 0.02, [
      { frequency: 95, to: 132, at: 0, duration: 0.29, peak: 0.3, attack: 0.005 },
      { frequency: 252, to: 315, at: 0.035, duration: 0.23, peak: 0.5, attack: 0.004 },
      { frequency: 378, to: 420, at: 0.11, duration: 0.19, peak: 0.16, attack: 0.004, type: "triangle" },
    ]);
  }

  // Invoked synchronously on incoming Gemini PCM, before its playback promise.
  // Fallback greetings and priority announcements always preempt decoration.
  beforeSpeech() {
    this.speechStarted = true;
    this.cancel();
  }

  end() {
    this.active = false;
    this.acceptingChecks = false;
    this.cancel();
    this.speechStarted = false;
  }

  inputSuppressed() {
    return performance.now() < this.suppressUntil;
  }

  private canPlay() {
    return this.enabled && this.volume > 0 && !this.speechStarted && this.context?.state === "running";
  }

  private cancel() {
    // Keep only a short acoustic tail after stopping; cancellation never extends
    // the gate. In particular, pending future ticks cannot mute a later session.
    this.suppressUntil = Math.min(this.suppressUntil, performance.now() + 120);
    for (const voice of this.voices) {
      try { voice.oscillator.stop(); } catch { /* Already ended. */ }
      voice.oscillator.disconnect();
      voice.gain.disconnect();
    }
    this.voices.clear();
  }

  private play(start: number, tones: Tone[]) {
    try {
      const ac = this.context!;
      for (const tone of tones) {
        const oscillator = ac.createOscillator();
        const gain = ac.createGain();
        const at = start + tone.at;
        oscillator.type = tone.type ?? "sine";
        oscillator.frequency.setValueAtTime(tone.frequency, at);
        if (tone.to) oscillator.frequency.exponentialRampToValueAtTime(tone.to, at + (tone.glide ?? tone.duration * 0.7));
        gain.gain.setValueAtTime(0.0001, at);
        gain.gain.linearRampToValueAtTime(tone.peak * 0.22 * this.volume, at + (tone.attack ?? 0.012));
        gain.gain.exponentialRampToValueAtTime(0.0001, at + tone.duration);
        oscillator.connect(gain);
        gain.connect(ac.destination);
        const voice = { oscillator, gain };
        this.voices.add(voice);
        oscillator.onended = () => {
          oscillator.disconnect();
          gain.disconnect();
          this.voices.delete(voice);
        };
        oscillator.start(at);
        oscillator.stop(at + tone.duration);
        this.suppressUntil = Math.max(this.suppressUntil,
          performance.now() + (at + tone.duration - ac.currentTime) * 1000 + 120);
      }
    } catch {
      this.cancel(); // Audio failures must not affect connection or greeting.
    }
  }
}

export const startupSounds = new StartupSoundPlayer();
