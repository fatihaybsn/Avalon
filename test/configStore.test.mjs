import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { parseEnvFile, writeEnvUpdates, speechRate } from "../electron/configStore.mjs";

test("speech rate accepts supported saved values and preserves normal speed for invalid or missing settings", () => {
  for (const rate of ["1", "1.15", "1.2", "1.3"]) assert.equal(speechRate({ IRIS_SPEECH_RATE: rate }), Number(rate));
  for (const rate of [undefined, "", "garbage", "0", "-1", "Infinity", "3"]) assert.equal(speechRate({ IRIS_SPEECH_RATE: rate }), 1);
});

test("config writes are atomic and blank secret fields preserve existing values", (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "iris-config-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, ".env");
  fs.writeFileSync(file, "# Iris\nGEMINI_API_KEY=existing\nIRIS_USER_NAME=Old\n");
  const target = { GEMINI_API_KEY: "existing", IRIS_USER_NAME: "Old" };

  writeEnvUpdates({
    file,
    target,
    rawUpdates: { GEMINI_API_KEY: "", IRIS_USER_NAME: "New User", UNKNOWN: "no" },
    allowedKeys: new Set(["GEMINI_API_KEY", "IRIS_USER_NAME"]),
    secretKeys: new Set(["GEMINI_API_KEY"]),
  });

  const text = fs.readFileSync(file, "utf8");
  assert.match(text, /GEMINI_API_KEY=existing/);
  assert.match(text, /IRIS_USER_NAME="New User"/);
  assert.doesNotMatch(text, /UNKNOWN/);
  assert.equal(target.GEMINI_API_KEY, "existing");
});

test("env parser handles quoted values without replacing existing process state", (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "iris-config-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, ".env");
  fs.writeFileSync(file, 'A="hello world"\nB=new\n');
  const target = { B: "kept" };
  parseEnvFile(file, target);
  assert.equal(target.A, "hello world");
  assert.equal(target.B, "kept");
});
