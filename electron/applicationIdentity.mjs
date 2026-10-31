import fs from "node:fs";
import path from "node:path";

export function configureApplicationIdentity(app) {
  app.setName("Avalon");
  // Preserve an explicitly selected profile, including isolated test profiles.
  if (app.commandLine.hasSwitch("user-data-dir")) return;

  // Keep existing permissions, device settings and Chromium data after renaming.
  // Electron requires a directory to exist before it can be passed to setPath.
  const profile = path.join(app.getPath("appData"), "Iris");
  fs.mkdirSync(profile, { recursive: true });
  app.setPath("userData", profile);
}
