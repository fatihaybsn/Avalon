import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

export function canonicalUrl(value) {
  try {
    const url = new URL(value);
    if (!["https:", "http:"].includes(url.protocol) || url.username || url.password) return null;
    url.hash = "";
    for (const key of [...url.searchParams.keys()]) if (/^(utm_|fbclid$|gclid$)/i.test(key)) url.searchParams.delete(key);
    url.searchParams.sort(); return url.href.replace(/\/$/, "");
  } catch { return null; }
}

export function atomicWrite(file, text) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temp = `${file}.${process.pid}.${crypto.randomUUID()}.tmp`;
  try {
    fs.writeFileSync(temp, text, { encoding: "utf8", mode: 0o600 });
    for (let attempt = 0; ; attempt++) {
      try { fs.renameSync(temp, file); break; }
      catch (error) {
        if (process.platform !== "win32" || !["EPERM", "EACCES", "EBUSY"].includes(error.code) || attempt >= 3) throw error;
        // Windows readers/antivirus may briefly hold the destination. Never delete it.
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, [10, 25, 50][attempt]);
      }
    }
  }
  finally { if (fs.existsSync(temp)) fs.rmSync(temp, { force: true }); }
}
