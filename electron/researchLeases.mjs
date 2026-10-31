// Used only by headless workers: the voice/UI process never opens this DB.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { processAlive } from "./researchStore.mjs";

export class ResearchLeases {
  constructor(root) {
    fs.mkdirSync(root, { recursive: true });
    this.db = new DatabaseSync(path.join(root, "worker-leases.sqlite"));
    this.db.exec("PRAGMA busy_timeout=1000; CREATE TABLE IF NOT EXISTS leases(slot INTEGER PRIMARY KEY, token TEXT NOT NULL, pid INTEGER NOT NULL, deadline INTEGER NOT NULL)");
  }
  tryAcquire(deadline) {
    try {
      this.db.exec("BEGIN IMMEDIATE");
      const rows = this.db.prepare("SELECT * FROM leases").all();
      for (const row of rows) if (!processAlive(Number(row.pid))) this.db.prepare("DELETE FROM leases WHERE slot=? AND token=?").run(row.slot, row.token);
      const used = new Set(this.db.prepare("SELECT slot FROM leases").all().map((row) => Number(row.slot)));
      const slot = [0, 1, 2].find((n) => !used.has(n));
      if (slot === undefined) { this.db.exec("COMMIT"); return null; }
      const token = crypto.randomUUID();
      this.db.prepare("INSERT INTO leases(slot,token,pid,deadline) VALUES(?,?,?,?)").run(slot, token, process.pid, deadline);
      this.db.exec("COMMIT");
      return () => this.db.prepare("DELETE FROM leases WHERE slot=? AND token=?").run(slot, token);
    } catch (error) {
      try { this.db.exec("ROLLBACK"); } catch { /* Transaction may not have started. */ }
      if (/locked|busy/i.test(error.message)) return null;
      throw error;
    }
  }
  async acquire(deadline, cancelled, now = () => Date.now()) {
    while (!cancelled() && now() < deadline) {
      const release = this.tryAcquire(deadline); if (release) return release;
      await new Promise((resolve) => setTimeout(resolve, 150));
    }
    throw new Error(cancelled() ? "Araştırma durduruldu." : "Araştırma işçisi beklenirken süre doldu.");
  }
  close() { this.db.close(); }
}
