import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fitWindowBounds, WindowLayout } from "../electron/windowLayout.mjs";
const displays = [{ workArea: { x: 0, y: 0, width: 1920, height: 1040 } }];
test("window recovery clamps an unplugged monitor and oversized window", () => {
  assert.deepEqual(fitWindowBounds({ x: 3000, y: -100, width: 3000, height: 1800 }, displays), { x: 0, y: 0, width: 1920, height: 1040 });
});
test("display changes recover the deck without touching an active HUD", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "avalon-display-"));
  const layout = new WindowLayout(path.join(dir, "window.json"), () => displays);
  let bounds = { x: 3000, y: 50, width: 1200, height: 800 }, maximized = true, changes = 0;
  const win = { isDestroyed: () => false, isMinimized: () => false, getNormalBounds: () => bounds, isMaximized: () => maximized,
    setBounds: (value) => { bounds = value; changes++; }, maximize: () => { maximized = true; }, unmaximize: () => { maximized = false; } };
  layout.suspended = true; layout.recoverDisplay(win); assert.equal(changes, 0);
  layout.suspended = false; layout.recoverDisplay(win); assert.equal(changes, 1); assert.equal(maximized, true); assert.equal(bounds.x, 720);
});
test("HUD bounds never replace the remembered maximized deck", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "avalon-window-"));
  const layout = new WindowLayout(path.join(dir, "window.json"), () => displays);
  const bounds = { x: 100, y: 60, width: 1180, height: 860 };
  const win = { isDestroyed: () => false, isMinimized: () => false, getNormalBounds: () => bounds, isMaximized: () => true,
    setBounds: (value) => Object.assign(bounds, value), maximize() {}, unmaximize() {} };
  assert.equal(layout.load().maximized, true);
  const state = layout.suspend(win); win.getNormalBounds = () => ({ x: 0, y: 0, width: 1920, height: 1080 });
  layout.save(win); assert.deepEqual(layout.load().bounds, bounds);
  win.getNormalBounds = () => bounds; layout.restore(win, state);
  assert.equal(layout.load().maximized, true);
  fs.rmSync(path.join(dir, "window.json")); fs.rmdirSync(dir);
});
