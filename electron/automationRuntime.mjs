import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fork, spawn } from "node:child_process";
import { createRequire } from "node:module";
import { nativeResourcePath } from "./resourcePaths.mjs";
import { normalizeResearch, readJson, writeJson } from "./researchStore.mjs";

const require = createRequire(import.meta.url);
export const automationRoot = (stateRoot) => path.join(path.dirname(stateRoot), "automation");
export const editorDirectory = (root) => path.join(root, "editor");
export const flowLockDirectory = (stateRoot, flowId) => path.join(automationRoot(stateRoot), "locks",
  crypto.createHash("sha256").update(flowId).digest("hex"));
const resource = (repoRoot, ...parts) => nativeResourcePath(repoRoot, "automation", ...parts);

function installation(root, repoRoot) {
  const version = readJson(resource(repoRoot, "package.json"))?.dependencies?.["node-red"];
  const saved = readJson(path.join(root, "install.json"));
  const directory = path.join(root, `node-red-${version}`);
  if (!saved?.node || saved.version !== version || !fs.existsSync(saved.node) ||
    readJson(path.join(directory, "node_modules/node-red/package.json"))?.version !== version) return null;
  return { ...saved, directory };
}

export function automationInstalled(root, repoRoot) { return Boolean(installation(root, repoRoot)); }

export async function installAutomation(root, repoRoot) {
  if (process.platform !== "win32" || process.arch !== "x64") throw new Error("Otomasyon kurulumu Windows x64 gerektirir.");
  const editorFile = path.join(editorDirectory(root), "flows.json");
  if (!fs.existsSync(editorFile)) {
    const example = readJson(resource(repoRoot, "nodes", "examples", "avalon-example.json"));
    if (!example) throw new Error("Örnek otomasyon akışı bulunamadı.");
    writeJson(editorFile, example);
  }
  if (!automationInstalled(root, repoRoot)) {
    const result = await new Promise((resolve, reject) => {
      const powershell = path.join(process.env.SystemRoot || "C:/Windows", "System32/WindowsPowerShell/v1.0/powershell.exe");
      const child = spawn(powershell, ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File",
        resource(repoRoot, "setup.ps1"), "-Root", root], { windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
      let output = "", error = "";
      child.stdout.setEncoding("utf8").on("data", (chunk) => { output = (output + chunk).slice(-8192); });
      child.stderr.setEncoding("utf8").on("data", (chunk) => { error = (error + chunk).slice(-4096); });
      child.once("error", reject);
      child.once("close", (code) => {
        if (code !== 0) return reject(new Error(error.trim() || "Node-RED kurulamadı."));
        try { resolve(JSON.parse(output.trim().split(/\r?\n/).at(-1))); }
        catch { reject(new Error("Node-RED kurulum sonucu okunamadı.")); }
      });
    });
    writeJson(path.join(root, "install.json"), result);
    if (!automationInstalled(root, repoRoot)) throw new Error("Node-RED kurulumu doğrulanamadı.");
  }
}

export function getAutomationFlows(root, repoRoot) {
  const { compileFlow, checkEditorFlows } = require(resource(repoRoot, "flows.cjs"));
  const flows = readJson(path.join(editorDirectory(root), "flows.json"), []);
  checkEditorFlows(flows);
  return flows.filter((node) => node.type === "tab" && !node.disabled).map((tab) => {
    try { return compileFlow(flows, tab.id); }
    catch (error) { return { id: tab.id, name: tab.label || tab.id, error: error.message }; }
  });
}

export function automationResearchSpec(step, spec) {
  return normalizeResearch({ ...step, language: spec.language, outputDirectory: spec.outputDirectory }, {
    sessionId: spec.sessionId, route: spec.route,
  });
}

export function startAutomationHost({ root, repoRoot, mode, userDir, log }) {
  const installed = installation(root, repoRoot);
  if (!installed) throw new Error("Önce Planlama ekranından Node-RED’i kurun.");
  const env = Object.fromEntries(Object.entries(process.env).filter(([name]) =>
    /^(?:SYSTEMROOT|WINDIR|PATH|TEMP|TMP|USERPROFILE|HOME|LOCALAPPDATA|APPDATA|PROGRAMDATA)$/i.test(name)));
  const fd = log ? fs.openSync(log, "a", 0o600) : "ignore";
  try {
    return fork(resource(repoRoot, "host.cjs"), [mode, installed.directory, userDir], {
      execPath: installed.node, execArgv: [], cwd: userDir, windowsHide: true, env,
      stdio: ["ignore", fd, fd, "ipc"],
    });
  } finally {
    if (typeof fd === "number") fs.closeSync(fd);
  }
}
