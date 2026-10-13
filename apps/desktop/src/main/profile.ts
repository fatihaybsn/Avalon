import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { parseEnv, promisify } from 'node:util';
import { execFile } from 'node:child_process';
export type Profile = { url: string; origin: string; token?: string; agentId: string };
// Fixed JARVIS profile only. No renderer-provided path, URL, token or command.
export async function loadProfile(): Promise<Profile> {
  const home = path.join(os.homedir(), '.openclaw-jarvis');
  const config = JSON.parse(await fs.readFile(path.join(home, 'openclaw.json'), 'utf8'));
  if (config.gateway?.bind !== 'loopback' || config.gateway?.auth?.mode !== 'token' || config.gateway?.controlUi?.dangerouslyDisableDeviceAuth === true) throw new Error('JARVIS loopback/token/cihaz politikası doğrulanamadı.');
  const port = config.gateway.port;
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('JARVIS port ayarı geçersiz.');
  if (!config.agents?.entries?.main) throw new Error('JARVIS main agent bulunamadı.');
  let token = process.env.JARVIS_GATEWAY_TOKEN;
  if (!token) {
    try { token = parseEnv(await fs.readFile(path.join(home, '.env'), 'utf8')).JARVIS_GATEWAY_TOKEN; }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw new Error('JARVIS sır dosyası okunamadı.'); }
  }
  if (!token && process.platform === 'win32') {
    const shell = path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
    const { stdout } = await promisify(execFile)(shell, ['-NoProfile', '-NonInteractive', '-Command', "[Console]::Write([Environment]::GetEnvironmentVariable('JARVIS_GATEWAY_TOKEN','User'))"], { windowsHide: true, timeout: 10000, maxBuffer: 8192 });
    token = stdout.trim() || undefined;
  }
  // Never silently use an unrelated provider key or generate another identity.
  if (config.gateway.auth.token !== '${JARVIS_GATEWAY_TOKEN}') throw new Error('Beklenen JARVIS kullanıcı token başvurusu bulunamadı.');
  return { url: `ws://127.0.0.1:${port}`, origin: `http://127.0.0.1:${port}`, token, agentId: 'main' };
}
