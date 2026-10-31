// Configure only the private Tailscale Serve route; never enable Funnel.
import fs from "node:fs";
import path from "node:path";
import { loadEnvFiles, writeEnvUpdates } from "../electron/configStore.mjs";
import { fileURLToPath } from "node:url";
import { configurePrivateServe } from "../electron/tailscaleServe.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
loadEnvFiles({ repoRoot: root });
const port = Number(process.env.IRIS_REMOTE_PORT || 8765);
if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error("Geçersiz yerel port.");
const origin = await configurePrivateServe(port);
writeEnvUpdates({ rawUpdates: { IRIS_REMOTE_ENABLED: "true", IRIS_REMOTE_ORIGIN: origin, IRIS_REMOTE_PORT: String(port) }, allowedKeys: new Set(["IRIS_REMOTE_ENABLED", "IRIS_REMOTE_ORIGIN", "IRIS_REMOTE_PORT"]) });
console.log(`Avalon adresi: ${origin}\nAvalon'u yeniden aç; Ayarlar > Telefon bağlantısı bölümünden eşleştirme kodu oluştur.`);
if (!fs.existsSync(path.join(root, "dist-mobile", "index.html"))) console.log("Önce npm run build çalıştır.");
