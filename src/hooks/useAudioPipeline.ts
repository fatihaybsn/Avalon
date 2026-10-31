import { useEffect, useRef, useState } from "react";
import { MicVAD } from "@ricky0123/vad-web";
import { base64ToBytes, downsampleTo16k, parsePcmRate } from "../lib/audio";
import { startupSounds } from "../lib/startupSounds";
import { SpeechTempo } from "../lib/speechTempo";

/**
 * Owns the whole browser audio path:
 * - WebRTC mic capture (echo-cancelled) downsampled to 16 kHz PCM -> Electron main
 * - Gemini 24 kHz PCM playback through AudioContext (with barge-in flush)
 * - passive RMS meters (mic in vs Gemini out, separately) for the orb's
 *   voice signatures and the "thinking" detector
 */
export function useAudioPipeline(
  hasBridge: boolean,
  onLog: (level: string, message: string) => void,
  micDeviceId = "",
  speechRate = 1,
) {
  const [muted, setMuted] = useState(false);
  const [captureReady, setCaptureReady] = useState(false);
  const [playbackReady, setPlaybackReady] = useState(false);

  const inputContextRef = useRef<AudioContext | null>(null);
  const inputStreamRef = useRef<MediaStream | null>(null);
  const inputSourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const inputProcessorRef = useRef<AudioWorkletNode | ScriptProcessorNode | null>(null);
  const speechVadRef = useRef<MicVAD | null>(null);
  const speechActiveRef = useRef(false);
  const capturePromiseRef = useRef<Promise<void> | null>(null);
  const captureGenerationRef = useRef(0);
  const outputContextRef = useRef<AudioContext | null>(null);
  const playbackTimeRef = useRef(0);
  const playbackSourcesRef = useRef<AudioBufferSourceNode[]>([]);
  const playbackIdsRef = useRef(new Map<AudioBufferSourceNode, string>());
  const playbackEndsRef = useRef(new Set<string>());
  const playbackGenerationRef = useRef(0);
  const playbackChainRef = useRef<Promise<void>>(Promise.resolve());
  const speechRateRef = useRef(speechRate);
  speechRateRef.current = speechRate;
  const tempoStreamsRef = useRef(new Map<string, SpeechTempo>());
  const failedPlaybackRef = useRef(new Set<string>());
  const inputAnalyserRef = useRef<AnalyserNode | null>(null);
  const outputAnalyserRef = useRef<AnalyserNode | null>(null);
  // Separate meters so the orb can tell WHO is talking: your mic drives the
  // radial-bar signature, Iris's playback drives the smooth wave.
  const inputLevelRef = useRef(0);
  const outputLevelRef = useRef(0);

  useEffect(() => {
    if (!hasBridge) return;
    const offAudio = window.iris.onAudioChunk((chunk) => {
      startupSounds.beforeSpeech();
      const generation = playbackGenerationRef.current;
      playbackChainRef.current = playbackChainRef.current.then(async () => {
        if (generation === playbackGenerationRef.current) await playChunk(chunk, generation);
      }).catch((error) => {
        if (generation !== playbackGenerationRef.current) return;
        failedPlaybackRef.current.add(chunk.utteranceId || "");
        onLog("warn", `Audio playback failed: ${String(error)}`);
      });
    });
    const offInterrupt = window.iris.onAudioInterrupt(() => flushPlayback());
    const offOwner = window.iris.onSidecarEvent((event) => {
      if (event.type === "voice_owner" && event.deviceId !== "desktop" && window.iris.transport !== "mobile") {
        startupSounds.end();
        void stopCapture(); flushPlayback();
      }
    });
    const offEnd = window.iris.onAudioOutputEnd(({ utteranceId }) => {
      const generation = playbackGenerationRef.current;
      playbackChainRef.current = playbackChainRef.current.then(async () => {
        if (generation !== playbackGenerationRef.current) return;
        const stream = tempoStreamsRef.current.get(utteranceId);
        if (!stream) return; // duplicate end, silent turn, or late end after barge-in
        tempoStreamsRef.current.delete(utteranceId);
        await schedulePcm(stream.finish(), stream.sampleRate, utteranceId, generation);
        if (generation !== playbackGenerationRef.current) return;
        playbackEndsRef.current.add(utteranceId);
        acknowledgePlayback(utteranceId);
      }).catch((error) => {
        if (generation !== playbackGenerationRef.current) return;
        failedPlaybackRef.current.add(utteranceId);
        onLog("warn", `Audio playback failed: ${String(error)}`);
      });
    });
    return () => {
      offAudio();
      offInterrupt();
      offOwner();
      offEnd();
    };
  }, [hasBridge]);

  useEffect(
    () => () => {
      captureGenerationRef.current += 1;
      void stopCapture();
      flushPlayback();
      outputAnalyserRef.current?.disconnect();
      outputAnalyserRef.current = null;
      const output = outputContextRef.current;
      outputContextRef.current = null;
      if (output) void output.close().catch(() => undefined);
    },
    [],
  );

  // Passive audio level meter (mic in / Gemini out) for the reactive HUD.
  useEffect(() => {
    let raf = 0;
    const buf = new Uint8Array(256);
    const rms = (analyser: AnalyserNode | null) => {
      if (!analyser) return 0;
      analyser.getByteTimeDomainData(buf);
      let sum = 0;
      for (let i = 0; i < buf.length; i++) {
        const v = (buf[i] - 128) / 128;
        sum += v * v;
      }
      return Math.sqrt(sum / buf.length);
    };
    const tick = () => {
      const input = startupSounds.inputSuppressed() ? 0 : Math.min(1, rms(inputAnalyserRef.current) * 2.6);
      const output = Math.min(1, rms(outputAnalyserRef.current) * 2.6);
      inputLevelRef.current += (input - inputLevelRef.current) * 0.4;
      outputLevelRef.current += (output - outputLevelRef.current) * 0.4;
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  // "exact" first so the chosen mic genuinely wins (soft "ideal" hints let the
  // browser keep whatever it prefers); explicit fallback to the system default
  // if that device is unplugged so the wake never fails.
  async function openMicStream(deviceId: string) {
    const base = { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 };
    if (deviceId) {
      try {
        return await navigator.mediaDevices.getUserMedia({
          audio: { ...base, deviceId: { exact: deviceId } },
          video: false,
        });
      } catch {
        onLog("warn", "Selected microphone unavailable — using the system default.");
      }
    }
    return navigator.mediaDevices.getUserMedia({ audio: base, video: false });
  }

  async function startCapture(deviceOverride?: string) {
    if (!hasBridge || inputContextRef.current) return;
    if (capturePromiseRef.current) return capturePromiseRef.current;
    const generation = ++captureGenerationRef.current;
    const operation = (async () => {
      const stream = await openMicStream(deviceOverride ?? micDeviceId);
      if (generation !== captureGenerationRef.current) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }

      const context = new AudioContext();
      const source = context.createMediaStreamSource(stream);
      const send = (input: Float32Array) => {
        if (startupSounds.inputSuppressed()) return;
        const pcm = downsampleTo16k(input, context.sampleRate);
        if (pcm.byteLength <= 0) return;
        const chunk = new ArrayBuffer(pcm.byteLength);
        new Uint8Array(chunk).set(new Uint8Array(pcm.buffer, pcm.byteOffset, pcm.byteLength));
        window.iris.sendAudioChunk(chunk);
      };

      let processor: AudioWorkletNode | ScriptProcessorNode;
      try {
        await context.audioWorklet.addModule(
          `${import.meta.env.BASE_URL}audio/iris-pcm-capture-worklet.js`,
        );
        const worklet = new AudioWorkletNode(context, "iris-pcm-capture");
        worklet.port.onmessage = (event: MessageEvent<Float32Array>) => send(event.data);
        processor = worklet;
      } catch {
        const fallback = context.createScriptProcessor(1024, 1, 1);
        fallback.onaudioprocess = (event) => {
          event.outputBuffer.getChannelData(0).fill(0);
          send(event.inputBuffer.getChannelData(0));
        };
        processor = fallback;
        onLog("warn", "AudioWorklet unavailable — using compatibility microphone processing.");
      }

      if (generation !== captureGenerationRef.current) {
        processor.disconnect();
        source.disconnect();
        stream.getTracks().forEach((track) => track.stop());
        await context.close().catch(() => undefined);
        return;
      }

      // Passive meter tap for the reactive HUD (does not affect what is sent).
      const analyser = context.createAnalyser();
      analyser.fftSize = 256;
      source.connect(analyser);
      source.connect(processor);
      processor.connect(context.destination);

      inputContextRef.current = context;
      inputStreamRef.current = stream;
      inputSourceRef.current = source;
      inputProcessorRef.current = processor;
      inputAnalyserRef.current = analyser;
      setCaptureReady(true);
      onLog("info", "WebRTC echo cancellation enabled for microphone.");

      const vadAssetPath = new URL(
        `${import.meta.env.BASE_URL}vad-assets/`,
        window.location.href,
      ).href;
      void MicVAD.new({
        model: "v5",
        startOnLoad: false,
        audioContext: context,
        getStream: async () => stream,
        pauseStream: async () => undefined,
        resumeStream: async () => stream,
        baseAssetPath: vadAssetPath,
        onnxWASMBasePath: vadAssetPath,
        onSpeechRealStart: () => {
          if (generation !== captureGenerationRef.current) return;
          if (startupSounds.inputSuppressed()) return;
          speechActiveRef.current = true;
          flushPlayback();
          void window.iris.sendCommand({
            type: "speech_activity",
            source: "silero",
            active: true,
          }).catch(() => undefined);
        },
        onSpeechEnd: () => {
          if (generation !== captureGenerationRef.current) return;
          speechActiveRef.current = false;
          void window.iris.sendCommand({
            type: "speech_activity",
            source: "silero",
            active: false,
          }).catch(() => undefined);
        },
        onVADMisfire: () => {
          if (!speechActiveRef.current) return;
          speechActiveRef.current = false;
          void window.iris.sendCommand({
            type: "speech_activity",
            source: "silero",
            active: false,
          }).catch(() => undefined);
        },
      })
        .then(async (vad) => {
          if (generation !== captureGenerationRef.current) {
            await vad.destroy();
            return;
          }
          speechVadRef.current = vad;
          await vad.start();
          onLog("info", "Local Silero speech detection enabled for standby.");
          await window.iris
            .sendCommand({ type: "speech_vad_status", ready: true })
            .catch(() => undefined);
        })
        .catch((error) => {
          void window.iris
            .sendCommand({
              type: "speech_vad_status",
              ready: false,
              error: error instanceof Error ? error.message : String(error),
            })
            .catch(() => undefined);
          onLog(
            "warn",
            `Speech detection unavailable; standby will use Live transcripts: ${
              error instanceof Error ? error.message : String(error)
            }`,
          );
        });
    })();
    capturePromiseRef.current = operation;
    try {
      await operation;
    } finally {
      if (capturePromiseRef.current === operation) capturePromiseRef.current = null;
    }
  }

  async function stopCapture() {
    setCaptureReady(false);
    captureGenerationRef.current += 1;
    const pending = capturePromiseRef.current;
    if (pending) await pending.catch(() => undefined);
    if (hasBridge && inputContextRef.current) {
      await window.iris
        .sendCommand({ type: "audio_stream_end" })
        .catch(() => undefined);
    }
    const speechVad = speechVadRef.current;
    speechVadRef.current = null;
    if (speechActiveRef.current) {
      speechActiveRef.current = false;
      await window.iris
        .sendCommand({
          type: "speech_activity",
          source: "silero",
          active: false,
        })
        .catch(() => undefined);
    }
    await speechVad?.destroy().catch(() => undefined);
    if (inputProcessorRef.current instanceof AudioWorkletNode) {
      inputProcessorRef.current.port.onmessage = null;
    } else if (inputProcessorRef.current) {
      inputProcessorRef.current.onaudioprocess = null;
    }
    inputProcessorRef.current?.disconnect();
    inputSourceRef.current?.disconnect();
    inputAnalyserRef.current?.disconnect();
    inputStreamRef.current?.getTracks().forEach((track) => track.stop());
    await inputContextRef.current?.close().catch(() => undefined);

    inputProcessorRef.current = null;
    inputSourceRef.current = null;
    inputStreamRef.current = null;
    inputContextRef.current = null;
    inputAnalyserRef.current = null;
    setMuted(false);
  }

  function flushPlayback() {
    playbackGenerationRef.current += 1;
    playbackIdsRef.current.clear();
    playbackEndsRef.current.clear();
    tempoStreamsRef.current.clear();
    failedPlaybackRef.current.clear();
    for (const source of playbackSourcesRef.current) {
      try {
        source.stop();
      } catch {
        // Already stopped.
      }
    }
    playbackSourcesRef.current = [];
    if (outputContextRef.current) {
      playbackTimeRef.current = outputContextRef.current.currentTime;
    }
  }

  function acknowledgePlayback(id: string) {
    if (!id || failedPlaybackRef.current.has(id) || !playbackEndsRef.current.has(id) || [...playbackIdsRef.current.values()].includes(id)) return;
    playbackEndsRef.current.delete(id);
    void window.iris.sendCommand({ type: "playback_ended", utteranceId: id }).catch(() => undefined);
  }

  async function playChunk(chunk: LiveAudioChunk, generation: number) {
    const rate = parsePcmRate(chunk.mimeType);
    const bytes = chunk.pcm ? new Uint8Array(chunk.pcm) : base64ToBytes(chunk.data);
    const sampleCount = Math.floor(bytes.byteLength / 2);
    if (!sampleCount) return;

    if (generation !== playbackGenerationRef.current) return;
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const channel = new Float32Array(sampleCount);
    for (let i = 0; i < sampleCount; i++) {
      channel[i] = view.getInt16(i * 2, true) / 32768;
    }
    const id = chunk.utteranceId || "";
    let stream = tempoStreamsRef.current.get(id);
    if (!stream) {
      stream = new SpeechTempo(rate, speechRateRef.current);
      tempoStreamsRef.current.set(id, stream);
    }
    if (stream.sampleRate !== rate) throw new Error("Speech sample rate changed within an utterance.");
    await schedulePcm(stream.push(channel), rate, id, generation);
  }

  async function schedulePcm(samples: Float32Array, rate: number, utteranceId: string, generation: number) {
    if (!samples.length || generation !== playbackGenerationRef.current) return;
    const context = outputContextRef.current ?? new AudioContext();
    outputContextRef.current = context;
    if (context.state === "suspended") await context.resume();
    if (generation !== playbackGenerationRef.current) return;
    const buffer = context.createBuffer(1, samples.length, rate);
    buffer.getChannelData(0).set(samples);

    let analyser = outputAnalyserRef.current;
    if (!analyser || analyser.context !== context) {
      analyser = context.createAnalyser();
      analyser.fftSize = 256;
      analyser.connect(context.destination);
      outputAnalyserRef.current = analyser;
    }

    const source = context.createBufferSource();
    source.buffer = buffer;
    source.connect(analyser);
    source.onended = () => {
      playbackSourcesRef.current = playbackSourcesRef.current.filter((item) => item !== source);
      playbackIdsRef.current.delete(source);
      source.disconnect();
      acknowledgePlayback(utteranceId);
    };

    const startAt = Math.max(context.currentTime + 0.03, playbackTimeRef.current || 0);
    source.start(startAt);
    playbackTimeRef.current = startAt + buffer.duration;
    playbackSourcesRef.current.push(source);
    if (utteranceId) playbackIdsRef.current.set(source, utteranceId);
  }

  function toggleMute() {
    const stream = inputStreamRef.current;
    setMuted((current) => {
      const next = !current;
      stream?.getAudioTracks().forEach((track) => (track.enabled = !next));
      return next;
    });
  }

  async function unlockPlayback() {
    const context = outputContextRef.current ?? new AudioContext();
    outputContextRef.current = context;
    if (context.state === "suspended") await context.resume();
    setPlaybackReady(context.state === "running");
  }
  return { muted, captureReady, playbackReady, toggleMute, inputLevelRef, outputLevelRef, startCapture, stopCapture, flushPlayback, unlockPlayback };
}
