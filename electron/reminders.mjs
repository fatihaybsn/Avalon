import crypto from "node:crypto";
import { readJson, writeJson } from "./researchStore.mjs";

const DAY = 86400000;
export function normalizeReminder(input, now = Date.now()) {
  const title = String(input?.title || "").trim();
  if (!title || title.length > 500) throw new Error("Hatırlatma başlığı 1–500 karakter olmalı.");
  const schedule = input?.schedule;
  if (!schedule || !["once", "daily", "weekly"].includes(schedule.kind) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(schedule.time || "")) throw new Error("Geçerli tekrar ve saat seç.");
  const day = Number(schedule.day ?? 0);
  if (!Number.isInteger(day) || day < 0 || day > 6) throw new Error("Geçerli gün seç.");
  const value = { title, description: String(input.description || "").slice(0, 4000), schedule: { kind: schedule.kind, time: schedule.time, day, timezone: "Europe/Istanbul", ...(schedule.kind === "once" ? { date: schedule.date } : {}) } };
  if (schedule.kind === "once") {
    const stamp = Date.parse(`${schedule.date}T${schedule.time}:00+03:00`);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(schedule.date || "") || !Number.isFinite(stamp) || new Date(stamp + 10800000).toISOString().slice(0, 10) !== schedule.date || stamp <= now) throw new Error("Gelecekte geçerli bir tarih ve saat seç.");
  }
  return value;
}
export function nextReminder(schedule, after) {
  if (schedule.kind === "once") { const at = Date.parse(`${schedule.date}T${schedule.time}:00+03:00`); return at > after ? at : null; }
  const local = new Date(after + 10800000), date = local.toISOString().slice(0, 10);
  let at = Date.parse(`${date}T${schedule.time}:00+03:00`);
  if (schedule.kind === "weekly") at += ((schedule.day - new Date(at + 10800000).getUTCDay() + 7) % 7) * DAY;
  if (at <= after) at += schedule.kind === "weekly" ? 7 * DAY : DAY;
  return at;
}
export class ReminderService {
  constructor({ file, now = Date.now, emit = () => {}, notify = () => {}, timers = true }) {
    Object.assign(this, { file, now, emit, notify });
    this.data = readJson(file, { version: 1, items: [] });
    if (this.data.version !== 1 || !Array.isArray(this.data.items)) throw new Error("Hatırlatma dosyası okunamadı.");
    this.lastTick = now(); this.tick(true);
    if (timers) { this.timer = setInterval(() => this.tick(), 5000); this.timer.unref(); }
  }
  list() { return this.data.items.filter((x) => !x.removed).map((x) => structuredClone(x)); }
  save() { writeJson(this.file, this.data); this.emit({ type: "reminders_changed", items: this.list() }); }
  put(input, id, revision) {
    const spec = normalizeReminder(input, this.now());
    let item = id ? this.require(id, revision) : null;
    if (item) Object.assign(item, spec, { revision: item.revision + 1, nextAt: nextReminder(spec.schedule, this.now()), pending: null, paused: false });
    else { item = { ...spec, id: `reminder_${crypto.randomUUID()}`, revision: 1, createdAt: this.now(), paused: false, nextAt: nextReminder(spec.schedule, this.now()), pending: null, history: [] }; this.data.items.push(item); }
    this.save(); return structuredClone(item);
  }
  require(id, revision) {
    const item = this.data.items.find((x) => x.id === id && !x.removed);
    if (!item || item.revision !== revision) throw new Error("Hatırlatma değişti. Güncel listeyi yenileyip tekrar dene.");
    return item;
  }
  action({ id, revision, action, occurrenceId, minutes }) {
    const item = this.require(id, revision);
    if (["complete", "snooze"].includes(action) && (!item.pending || item.pending.id !== occurrenceId)) throw new Error("Bu hatırlatma artık beklemiyor.");
    if (action === "snooze") {
      if (![10, 30, 60].includes(minutes)) throw new Error("10, 30 veya 60 dakika seç.");
      item.pending = { ...item.pending, snoozeAt: this.now() + minutes * 60000 };
    } else if (action === "complete") { item.history.unshift({ ...item.pending, completedAt: this.now() }); item.history = item.history.slice(0, 50); item.pending = null; }
    else if (action === "pause") { item.paused = true; item.pending = null; }
    else if (action === "resume") { item.paused = false; item.nextAt = nextReminder(item.schedule, this.now()); }
    else if (action === "remove") item.removed = true;
    else throw new Error("Geçersiz hatırlatma işlemi.");
    item.revision++; this.save(); return { ok: true };
  }
  tick(recover = false) {
    const now = this.now(), missed = recover || now - this.lastTick > 15000;
    const due = []; let changed = false;
    for (const item of this.data.items) {
      if (item.removed || item.paused) continue;
      let fired = false;
      if (item.pending?.snoozeAt && item.pending.snoozeAt <= now) { delete item.pending.snoozeAt; fired = true; }
      if (item.nextAt && item.nextAt <= now) {
        const at = item.nextAt;
        if (item.pending) item.history.unshift({ ...item.pending, supersededAt: now });
        item.history = item.history.slice(0, 50);
        item.pending = { id: `${item.id}:${at}`, at }; item.nextAt = nextReminder(item.schedule, now); fired = true;
      }
      if (fired) { item.revision++; due.push(item); changed = true; }
    }
    this.lastTick = now;
    if (changed) {
      this.save();
      if (missed) this.notify({ id: `reminder-summary:${crypto.randomUUID()}`, summary: true, count: due.length });
      else for (const item of due) this.notify({ id: item.pending.id + `:${item.revision}`, reminderId: item.id, title: item.title });
    }
  }
  close() { clearInterval(this.timer); }
}
