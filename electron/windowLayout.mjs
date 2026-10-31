import fs from "node:fs";
import path from "node:path";

export function fitWindowBounds(bounds, displays) {
  const fallback = displays[0]?.workArea || { x: 0, y: 0, width: 1180, height: 860 };
  const valid = bounds && [bounds.x, bounds.y, bounds.width, bounds.height].every(Number.isFinite);
  const area = valid && displays.find(({ workArea: a }) => bounds.x < a.x + a.width && bounds.x + bounds.width > a.x && bounds.y < a.y + a.height && bounds.y + bounds.height > a.y)?.workArea || fallback;
  const width = Math.min(area.width, Math.max(800, valid ? bounds.width : 1180));
  const height = Math.min(area.height, Math.max(600, valid ? bounds.height : 860));
  return { x: Math.max(area.x, Math.min(valid ? bounds.x : area.x + (area.width - width) / 2, area.x + area.width - width)), y: Math.max(area.y, Math.min(valid ? bounds.y : area.y + (area.height - height) / 2, area.y + area.height - height)), width, height };
}

export class WindowLayout {
  constructor(file, displays) { this.file = file; this.displays = displays; this.suspended = false; this.timer = null; }
  load() {
    let saved; try { saved = JSON.parse(fs.readFileSync(this.file, "utf8")); } catch { /* First launch. */ }
    return { bounds: fitWindowBounds(saved?.bounds, this.displays()), maximized: saved?.maximized !== false };
  }
  snapshot(win) { return { bounds: win.getNormalBounds(), maximized: win.isMaximized() }; }
  save(win) {
    if (this.suspended || win.isDestroyed() || win.isMinimized()) return;
    const state = this.snapshot(win);
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const temp = `${this.file}.tmp`; fs.writeFileSync(temp, JSON.stringify(state)); fs.renameSync(temp, this.file);
  }
  observe(win) {
    const changed = () => {
      if (this.suspended) return;
      clearTimeout(this.timer); this.timer = setTimeout(() => { try { this.save(win); } catch { /* Never interrupt audio. */ } }, 250);
    };
    for (const event of ["move", "resize", "maximize", "unmaximize"]) win.on(event, changed);
    win.on("close", () => { try { this.save(win); } catch { /* Best effort. */ } });
    win.on("closed", () => clearTimeout(this.timer));
  }
  suspend(win) { this.save(win); clearTimeout(this.timer); this.suspended = true; return this.snapshot(win); }
  recoverDisplay(win) {
    if (this.suspended || win.isDestroyed()) return;
    const state = this.snapshot(win), fitted = fitWindowBounds(state.bounds, this.displays());
    if (["x", "y", "width", "height"].every((key) => fitted[key] === state.bounds[key])) return;
    if (state.maximized) win.unmaximize();
    this.restore(win, { ...state, bounds: fitted });
  }
  restore(win, state) {
    const bounds = fitWindowBounds(state.bounds, this.displays());
    win.setMinimumSize?.(Math.min(800, bounds.width), Math.min(600, bounds.height));
    win.setBounds(bounds);
    if (state.maximized) win.maximize();
    else if (win.isMaximized()) win.unmaximize();
    // Window resize events caused by HUD restoration must never save HUD bounds.
    this.suspended = false;
    this.save(win);
  }
}
