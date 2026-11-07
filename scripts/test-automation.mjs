// Offline automation checks only: no runtime installation, server, browser or real agents.
import { spawnSync } from "node:child_process";
const result = spawnSync(process.execPath, ["--test", "test/automation.test.mjs", "test/automationRunner.test.mjs", "test/automationHermes.test.mjs", "test/automationMemory.test.mjs", "test/automationAdmission.test.mjs"], {
  stdio: "inherit", windowsHide: true,
});
process.exitCode = result.status ?? 1;
