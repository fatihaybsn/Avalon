import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { resolveConfigPath } from "./configStore.mjs";

export function hermesCliCandidates(repoRoot = process.cwd(), env = process.env) {
  const home = env.HERMES_HOME ? resolveConfigPath(env.HERMES_HOME, repoRoot) : path.join(os.homedir(), ".hermes");
  const candidates = [];
  if (env.HERMES_BIN?.trim()) candidates.push({ cmd: resolveConfigPath(env.HERMES_BIN, repoRoot), args: [] });
  candidates.push({ cmd: "hermes", args: [] });
  for (const bin of [process.platform === "win32" ? "Scripts" : "bin", "bin"]) {
    const python = path.join(home, "hermes-agent", "venv", bin, process.platform === "win32" ? "python.exe" : "python");
    if (fs.existsSync(python) && !candidates.some((item) => item.cmd === python)) candidates.push({ cmd: python, args: ["-m", "hermes_cli.main"] });
  }
  return candidates;
}
