// Install the freshly packaged Avalon.app into /Applications so it launches
// from Finder/Launchpad like any normal macOS app.
//
// Usage:
//   npm run install:mac                (build + package + install + launch)
//   node scripts/install-mac.mjs       (install the last packaged build)
//   node scripts/install-mac.mjs --no-launch
import { execSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const releaseDir = path.join(root, "release");
const DEST = "/Applications/Avalon.app";
const IRIS_EXECUTABLE_RE = "^/Applications/(Iris|Avalon)\\.app/Contents/MacOS/(Iris|Avalon)$";

function isInstalledIrisRunning() {
  const probe = spawnSync("pgrep", ["-f", IRIS_EXECUTABLE_RE], {
    stdio: "ignore",
  });
  return probe.status === 0;
}

async function waitFor(check, expected, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (check() === expected) return true;
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  return check() === expected;
}

if (process.platform !== "darwin") {
  console.error("install:mac only works on macOS.");
  process.exit(1);
}

// electron-builder outputs per-arch folders; take whichever exists.
const appCandidates = ["mac-arm64", "mac", "mac-x64"].map((dir) =>
  path.join(releaseDir, dir, "Avalon.app"),
);
const appPath = appCandidates.find((candidate) => fs.existsSync(candidate));

if (!appPath) {
  console.error("No packaged Avalon.app found in release/. Run: npm run package:mac");
  process.exit(1);
}

// Both names share the preserved user profile and single-instance lock.
// Stop the legacy installed app too, so it cannot intercept the new launch.
for (const name of ["Iris", "Avalon"]) {
  spawnSync("osascript", ["-e", `if application "${name}" is running then tell application "${name}" to quit`], { stdio: "ignore" });
}
if (!(await waitFor(isInstalledIrisRunning, false, 10000))) {
  throw new Error("The running Iris/Avalon instance did not quit in time; installation was cancelled.");
}

if (fs.existsSync(DEST)) {
  fs.rmSync(DEST, { recursive: true, force: true });
}

// ditto preserves the bundle structure, symlinks, and permissions.
execSync(`ditto "${appPath}" "${DEST}"`, { stdio: "inherit" });
// Clear any quarantine/extended attributes so Gatekeeper never nags.
execSync(`xattr -cr "${DEST}"`);

console.log(`✓ Installed ${DEST}`);

// The packaged bundle is only a staging artifact. Keeping it makes Spotlight /
// Finder show both this copy and /Applications/Avalon.app.
for (const candidate of appCandidates) {
  if (!fs.existsSync(candidate)) continue;
  fs.rmSync(candidate, { recursive: true, force: true });
  const parent = path.dirname(candidate);
  if (fs.existsSync(parent) && fs.readdirSync(parent).length === 0) {
    fs.rmdirSync(parent);
  }
}
console.log("✓ Removed packaged Avalon.app staging bundle");

if (!process.argv.includes("--no-launch")) {
  // Cursor/CI shells may export ELECTRON_RUN_AS_NODE=1. Passing that through
  // LaunchServices starts Avalon as a headless Node process with no window.
  const launchEnv = { ...process.env };
  delete launchEnv.ELECTRON_RUN_AS_NODE;
  const launched = spawnSync("open", [DEST], {
    env: launchEnv,
    stdio: "inherit",
  });
  if (launched.status !== 0) {
    throw new Error(`Could not launch Avalon (open exited ${launched.status}).`);
  }
  if (!(await waitFor(isInstalledIrisRunning, true, 10000))) {
    throw new Error("LaunchServices returned success, but the Avalon process did not start.");
  }
  console.log("✓ Launched Avalon");
}
