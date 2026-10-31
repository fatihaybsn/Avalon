import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { ReminderService, nextReminder, normalizeReminder } from "../electron/reminders.mjs";
import { MessageReceipts } from "../electron/messageReceipts.mjs";

function setup(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "avalon-reminder-")); t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  let time = Date.parse("2026-10-29T08:59:59+03:00"); const notices = [];
  const options = { file: path.join(dir, "reminders.json"), timers: false, now: () => time, notify: (x) => notices.push(x) };
  return { dir, options, service: new ReminderService(options), notices, advance: (ms) => { time += ms; } };
}
const daily = { title: "İlaç saati", description: "", schedule: { kind: "daily", time: "09:00", day: 1 } };
test("reminders persist, fire once, reject stale revisions and snooze only the occurrence", (t) => {
  const { service, options, advance, notices } = setup(t);
  const item = service.put(daily); advance(1000); service.tick(); service.tick(); assert.equal(notices.length, 1);
  let current = service.list()[0]; const next = current.nextAt;
  assert.throws(() => service.action({ id: item.id, revision: item.revision, action: "pause" }), /değişti/);
  service.action({ id: current.id, revision: current.revision, action: "snooze", minutes: 10, occurrenceId: current.pending.id });
  advance(600000); service.tick(); assert.equal(notices.length, 2); assert.equal(service.list()[0].nextAt, next);
  current = service.list()[0]; service.action({ id: current.id, revision: current.revision, occurrenceId: current.pending.id, action: "complete" });
  assert.equal(new ReminderService(options).list()[0].history.length, 1); assert.equal(service.list()[0].pending, null);
});
test("restart and sleep catch-up issue a single summary rather than a storm", (t) => {
  const { service, options, advance, notices } = setup(t);
  service.put(daily); service.put({ ...daily, title: "Diğer" }); advance(4 * 86400000);
  const restored = new ReminderService(options); assert.equal(notices.length, 1); assert.equal(notices[0].count, 2); assert.equal(notices[0].summary, true);
  restored.tick(); assert.equal(notices.length, 1); assert.ok(restored.list().every((x) => x.nextAt > options.now()));
});
test("date validation, Istanbul weekly boundaries, pause/resume and removal", (t) => {
  const { service, advance } = setup(t);
  assert.throws(() => normalizeReminder({ ...daily, schedule: { kind: "once", date: "2026-02-30", time: "09:00" } }), /tarih/);
  const stamp = Date.parse("2026-10-31T23:59:00+03:00");
  assert.equal(nextReminder({ kind: "weekly", day: 0, time: "00:01" }, stamp), Date.parse("2026-11-01T00:01:00+03:00"));
  let item = service.put(daily); service.action({ ...item, action: "pause" }); advance(86400000); service.tick(); assert.equal(service.list()[0].pending, null);
  item = service.list()[0]; service.action({ ...item, action: "resume" }); item = service.list()[0]; service.action({ ...item, action: "remove" }); assert.equal(service.list().length, 0);
});
test("text message IDs deduplicate in flight and after restart without any voice dependency", async (t) => {
  const { dir } = setup(t); const file = path.join(dir, "messages.json"), receipts = new MessageReceipts(file);
  const input = { id: "message-1", sessionId: "chat-1", text: "Notlarımda ara" }; let calls = 0;
  const operation = async () => { calls++; return { ok: true }; };
  await Promise.all([receipts.send(input, "phone", operation), receipts.send(input, "phone", operation)]);
  await new MessageReceipts(file).send(input, "phone", operation); assert.equal(calls, 1);
  await assert.rejects(receipts.send({ ...input, text: "Başka mesaj" }, "phone", operation), /farklı/);
});
