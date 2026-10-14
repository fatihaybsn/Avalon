import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { separateCodexTools } from './codex-worker-policy.mjs';

// Preparation only: cannot enable a worker or widen the stage 03 host policy.
export function prepareCodex(config, binary, envNames = Object.keys(process.env)) {
  if (!path.win32.isAbsolute(binary) || !binary.endsWith('codex.exe')) throw new Error('Explicit native Windows binary required');
  const next = structuredClone(config);
  next.plugins ??= {}; next.plugins.entries ??= {};
  next.plugins.entries.codex = {
    enabled: false,
    config: {
      sessionCatalog: { enabled: false },
      supervision: { enabled: false, allowRawTranscripts: false, allowWriteControls: false },
      appServer: {
        transport: 'stdio', homeScope: 'agent', command: binary,
        args: ['-c', 'windows.sandbox="unelevated"', '-c', 'sandbox_workspace_write.network_access=false', '-c', 'sandbox_workspace_write.exclude_tmpdir_env_var=true', '-c', 'sandbox_workspace_write.exclude_slash_tmp=true', 'app-server', '--listen', 'stdio://'],
        mode: 'guardian', approvalPolicy: 'on-request', approvalsReviewer: 'user', sandbox: 'read-only',
        loopDetectionPreToolUseRelay: true, enableUltrafast: false, cyberFailover: { mode: 'off' },
        clearEnv: [...new Set([...envNames.filter(n => /(?:KEY|TOKEN|PASSWORD|SECRET|AUTHORIZATION)|^(?:JARVIS|GEMINI|GOOGLE|OPENCLAW|AWS|AZURE)_/i.test(n)), 'OPENAI_API_KEY', 'CODEX_API_KEY', 'OPENAI_BASE_URL', 'OPENAI_API_BASE', 'JARVIS_GATEWAY_TOKEN', 'OPENCLAW_GATEWAY_TOKEN', 'GEMINI_API_KEY', 'GOOGLE_API_KEY', 'JARVIS_DREAMING_GEMINI_API_KEY', 'TAVILY_API_KEY', 'OPENCODE_API_KEY', 'NODE_OPTIONS', 'RUST_LOG', 'OTEL_EXPORTER_OTLP_HEADERS'])].sort(),
      },
    },
  };
  return next;
}

export function enableCodex(config, binary, profileDir, envNames = Object.keys(process.env)) {
  const next = prepareCodex(config, binary, envNames);
  const entry = next.plugins.entries.codex;
  entry.enabled = true;
  entry.config.appServer.mode = 'yolo';
  entry.config.appServer.approvalPolicy = 'never';
  entry.config.appServer.sandbox = 'danger-full-access';
  entry.config.appServer.args = ['-c', 'features.multi_agent=false', '-c', 'features.memories=false', '-c', 'features.apps=false', 'app-server', '--listen', 'stdio://'];
  next.plugins.allow = [...new Set([...(next.plugins.allow ?? []), 'codex'])];
  next.auth ??= {}; next.auth.profiles ??= {}; next.auth.order ??= {};
  next.auth.profiles['openai:jarvis-codex'] = { provider: 'openai', mode: 'oauth' };
  next.auth.order.openai = ['openai:jarvis-codex'];
  return separateCodexTools(next, profileDir);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const binary = process.argv[2];
  if (!binary || execFileSync(binary, ['--version'], { encoding: 'utf8', windowsHide: true }).trim() !== 'codex-cli 0.160.0') throw new Error('Installed stable Codex 0.160.0 required; no PATH or alpha fallback');
  const profile = path.join(process.env.USERPROFILE, '.openclaw-jarvis');
  const filename = path.join(profile, 'openclaw.json');
  const old = fs.readFileSync(filename, 'utf8');
  const backup = path.join(profile, 'openclaw.before-codex-preparation.json');
  if (!fs.existsSync(backup)) fs.writeFileSync(backup, old, { flag: 'wx' });
  const next = process.argv.includes('--enable-selected-worker') ? enableCodex(JSON.parse(old), binary, profile) : prepareCodex(JSON.parse(old), binary);
  fs.mkdirSync(path.join(profile, 'codex-worker'), { recursive: true });
  fs.writeFileSync(filename, JSON.stringify(next, null, 2) + '\n');
  console.log(`Stable native Codex pinned; private leaf profile prepared without credentials. Selected worker enabled: ${next.plugins.entries.codex.enabled}. Main model and exec policy preserved.`);
}
