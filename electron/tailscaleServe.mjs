import { execFile } from "node:child_process";
import { promisify } from "node:util";

export async function configurePrivateServe(port, { previousPort = port, expectedOrigin } = {}) {
  const executable = process.platform === "win32" ? "C:/Program Files/Tailscale/tailscale.exe" : "tailscale";
  const call = async (args) => (await promisify(execFile)(executable, args, { encoding: "utf8", windowsHide: true, timeout: 20000 })).stdout;
  const status = JSON.parse(await call(["status", "--json"]));
  if (status.BackendState !== "Running" || !status.Self?.DNSName) throw new Error("Tailscale hesabına giriş yapıp tekrar dene.");
  const origin = `https://${status.Self.DNSName.replace(/\.$/, "")}`;
  if (expectedOrigin && new URL(expectedOrigin).origin !== origin) throw new Error(`Bu bilgisayarın Tailscale adresi: ${origin}`);
  const existing = JSON.parse(await call(["serve", "status", "--json"]));
  const handlers = Object.values(existing.Web || {}).flatMap((value) => Object.values(value.Handlers || {}));
  if (Object.values(existing.AllowFunnel || {}).some(Boolean) || handlers.some((value) => ![`http://127.0.0.1:${port}`, `http://127.0.0.1:${previousPort}`].includes(value.Proxy))) throw new Error("Tailscale başka bir yayın için kullanılıyor; ayarı değiştirilmedi.");
  await call(["serve", "--bg", "--yes", `http://127.0.0.1:${port}`]);
  return origin;
}
