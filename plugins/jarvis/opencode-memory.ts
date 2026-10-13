import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { setTimeout as delay } from 'node:timers/promises';
import { createInterface } from 'node:readline';
import type { OpenClawPluginApi } from 'openclaw/plugin-sdk/plugin-entry';
type Backend = Parameters<OpenClawPluginApi['registerCliBackend']>[0];
export const MEMORY_RUNTIME = 'jarvis-opencode-memory';
export function nativeExecutable() {
  for (const dir of (process.env.PATH ?? '').split(path.delimiter)) {
    for (const relative of ['opencode.exe', 'node_modules/@opencode/cli/bin/opencode.exe']) {
      const file = path.resolve(dir, relative);
      if (fs.existsSync(file) && fs.statSync(file).isFile()) return file;
    }
  }
  throw new Error('Native Windows OpenCode client missing');
}
export function workerService() {
  const file = path.join(process.env.USERPROFILE!, '.local/state/opencode/service.json');
  const service = JSON.parse(fs.readFileSync(file, 'utf8'));
  const url = new URL(service.url);
  if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || url.username || url.password || url.pathname !== '/' || !url.port || !Number.isSafeInteger(service.pid) || typeof service.password !== 'string') throw new Error('Existing authenticated loopback OpenCode worker required');
  return { service, url, headers: { Authorization: `Basic ${Buffer.from(`opencode:${service.password}`).toString('base64')}`, 'Content-Type': 'application/json' } };
}
export function buildMemoryBackend(): Backend {
  return {
    id: MEMORY_RUNTIME, modelProvider: 'opencode', nativeToolMode: 'selectable',
    toolAvailabilityEnforcement: 'prepare-execution', isolatesInstructionsWithExactTools: true,
    autoSelectAuthProfile: false,
    config: { command: 'opencode', args: ['run', '--format', 'json', '--model', 'opencode/space-bunny-free'], input: 'stdin', output: 'jsonl', sessionMode: 'none', serialize: true, reseedFromRawTranscriptWhenUncompacted: false },
    normalizeConfig: config => ({ ...config, command: nativeExecutable() }),
    resolveModelId({ modelId }) { if (modelId !== 'space-bunny-free') throw new Error('Only Space Bunny Free is admitted'); return modelId; },
    parseJsonlEvent(line) {
      let event: any; try { event = JSON.parse(line); } catch { return null; }
      if (event.type === 'text' && typeof event.part?.text === 'string') return { kind: 'text', text: event.part.text };
      return null;
    },
    async prepareExecution(ctx) {
      if (ctx.toolAvailability?.native.length || ctx.toolAvailability?.openClaw.length) throw new Error('Memory worker has no effect authority');
      if (ctx.modelId !== 'space-bunny-free') throw new Error('Unexpected memory model');
      const { service, url, headers } = workerService();
      const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'jarvis-memory-turn-'));
      fs.mkdirSync(path.join(scratch, 'guard'));
      fs.copyFileSync(fileURLToPath(new URL('./opencode-guard.mjs', import.meta.url)), path.join(scratch, 'guard/index.js'));
      fs.writeFileSync(path.join(scratch, 'guard/package.json'), JSON.stringify({ name: 'jarvis-memory-worker-guard', type: 'module', exports: './index.js' }));
      fs.writeFileSync(path.join(scratch, 'opencode.json'), JSON.stringify({ plugins: ['./guard'], share: 'disabled', update: 'disable', snapshots: false, compaction: { auto: false } }));
      const request = async (route: string, body?: unknown) => {
        const response = await fetch(new URL(route, url), { method: body === undefined ? 'GET' : 'POST', headers, ...(body === undefined ? {} : { body: JSON.stringify(body) }), redirect: 'error', signal: AbortSignal.timeout(15000) });
        if (!response.ok) throw new Error(`OpenCode preflight ${response.status}; no fallback`);
        return await response.json() as any;
      };
      return {
        toolAvailabilityEnforced: true,
        cleanup: async () => {
          const target = path.resolve(scratch);
          if (path.dirname(target) !== path.resolve(os.tmpdir()) || !path.basename(target).startsWith('jarvis-memory-turn-')) throw new Error('Unexpected worker cleanup target');
          await fs.promises.rm(target, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
        },
        execute: async function* (run) {
          run.assertCurrent?.();
          const prompt = [run.systemPrompt, run.promptContext?.prependContext, run.prompt, run.promptContext?.appendContext].filter(Boolean).join('\n\n');
          if (prompt.length > 32000) throw new Error('Selected memory context exceeds bounded worker budget');
          const identity = await request('/api/info');
          if (identity.version !== '2.0.28' || identity.pid !== service.pid) throw new Error('Verified OpenCode worker version/identity changed');
          run.assertCurrent?.();
          // Native CLI initializes the location and awaits plugin setup. No model
          // prompt is dispatched by this read-only readiness call.
          await promisify(execFile)(run.command, ['session', 'list', '--format', 'json', '--max-count', '1'], { cwd: scratch, env: run.env, timeout: 15000, windowsHide: true, maxBuffer: 65536 });
          const ready = path.join(scratch, 'guard-ready');
          for (let attempt = 0; attempt < 100 && !fs.existsSync(ready); attempt++) { run.assertCurrent?.(); await delay(50); }
          if (fs.readFileSync(path.join(scratch, 'guard-ready'), 'utf8') !== 'jarvis.memory-worker-guard/v1') throw new Error('Worker guard not ready; prompt withheld');
          run.assertCurrent?.();
          await run.liveSession?.restart();
          const child = spawn(run.command, [...run.args, '--title', 'JARVIS Memory Core Dreaming'], { cwd: scratch, env: run.env, argv0: run.argv0, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
          child.stderr.resume();
          const exited = new Promise<number | null>((resolve, reject) => { child.once('error', reject); child.once('close', resolve); });
          const stop = () => { child.kill(); };
          const timer = setTimeout(stop, run.timeoutMs);
          run.abortSignal?.addEventListener('abort', stop, { once: true });
          try {
            if (run.abortSignal?.aborted) stop();
            child.stdin.end(prompt);
            for await (const line of createInterface({ input: child.stdout })) {
              if (line.length > 1_000_000) throw new Error('Oversized worker event');
              let event: any; try { event = JSON.parse(line); } catch { continue; }
              if (event.type === 'error' || event.type === 'tool_use') throw new Error('Memory inference failed or attempted a blocked native effect');
              yield event;
            }
            if (await exited !== 0 || run.abortSignal?.aborted) throw new Error('Memory worker interrupted or failed; no retry/fallback');
          } finally { clearTimeout(timer); run.abortSignal?.removeEventListener('abort', stop); stop(); await exited.catch(() => {}); }
        }
      };
    }
  };
}
