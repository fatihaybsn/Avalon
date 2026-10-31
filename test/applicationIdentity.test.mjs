import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { configureApplicationIdentity } from "../electron/applicationIdentity.mjs";

function setup(t, customProfile = false) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "avalon-identity-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const state = { name: "old-name", profile: customProfile ? path.join(root, "custom") : null };
  const app = {
    setName: (name) => { state.name = name; },
    commandLine: { hasSwitch: (name) => name === "user-data-dir" && customProfile },
    getPath: (name) => { assert.equal(name, "appData"); return root; },
    setPath: (name, value) => {
      assert.equal(name, "userData");
      assert.ok(fs.statSync(value).isDirectory(), "Electron needs an existing directory");
      state.profile = value;
    },
  };
  return { root, state, app };
}

test("Avalon preserves the existing Iris profile and its permission data", (t) => {
  const { root, state, app } = setup(t);
  const profile = path.join(root, "Iris");
  fs.mkdirSync(profile);
  fs.writeFileSync(path.join(profile, "Preferences"), "existing permissions");
  configureApplicationIdentity(app);
  assert.equal(state.name, "Avalon");
  assert.equal(state.profile, profile);
  assert.equal(fs.readFileSync(path.join(profile, "Preferences"), "utf8"), "existing permissions");
});

test("a fresh installation creates the compatible profile before configuring Electron", (t) => {
  const { root, state, app } = setup(t);
  configureApplicationIdentity(app);
  assert.equal(state.name, "Avalon");
  assert.equal(state.profile, path.join(root, "Iris"));
  assert.ok(fs.statSync(state.profile).isDirectory());
});

test("an explicit user-data-dir stays isolated from the existing Iris profile", (t) => {
  const { root, state, app } = setup(t, true);
  const originalProfile = state.profile;
  configureApplicationIdentity(app);
  assert.equal(state.name, "Avalon");
  assert.equal(state.profile, originalProfile);
  assert.equal(fs.existsSync(path.join(root, "Iris")), false);
});
