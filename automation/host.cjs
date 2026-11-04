"use strict";

const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");
const crypto = require("node:crypto");
const { once } = require("node:events");
const { createRequire } = require("node:module");
const { checkEditorFlows } = require("./flows.cjs");
const { bus } = require("./nodes/avalon.js");

async function main() {
  const [mode, install, userDir] = process.argv.slice(2);
  if (mode !== "editor" && mode !== "execute") throw new Error("Invalid Node-RED host mode");
  const fromInstall = createRequire(path.join(install, "package.json"));
  const RED = fromInstall("node-red");
  const flowFile = path.join(userDir, "flows.json");
  const localFlows = JSON.parse(fs.readFileSync(flowFile, "utf8"));
  checkEditorFlows(localFlows);
  const settings = {
    userDir, flowFile, httpNodeRoot: false, coreNodesDir: path.join(__dirname, "nodes"),
    telemetry: { enabled: false, updateNotification: false },
    externalModules: { autoInstall: false, palette: { allowInstall: false, allowUpload: false } },
    logging: { console: { level: "warn", metrics: false, audit: false } },
  };

  process.once("disconnect", () => process.exit(0));
  if (mode === "execute") {
    RED.init({ ...settings, httpAdminRoot: false });
    const flowsStarted = once(RED.events, "flows:started");
    await RED.start();
    await flowsStarted;
    process.on("message", (message) => {
      if (message.kind === "start") bus.emit("start");
      if (message.kind === "stepResult") bus.emit(message.id, message.ok);
    });
    process.send({ kind: "ready" });
    return;
  }

  const express = fromInstall("express");
  const app = express();
  const server = http.createServer(app);
  const token = crypto.randomBytes(32).toString("hex");
  const json = express.json({ limit: "2mb" });
  RED.init(server, {
    ...settings, httpAdminRoot: "/",
    paletteCategories: ["Avalon"],
    editorTheme: {
      tours: false, page: { title: "Avalon | Akış Düzenleyicisi", css: path.join(__dirname, "editor.css") },
      header: { title: "Avalon | Akış Düzenleyicisi" },
    },
    adminAuth: {
      type: "credentials", users: [],
      tokens: async (value) => value === token ? { username: "avalon", permissions: "*" } : null,
    },
    httpAdminMiddleware(req, res, next) {
      if (req.method === "POST" && req.path === "/flows") {
        if (req.headers["node-red-deployment-type"] === "reload") return res.sendStatus(405);
        return json(req, res, (error) => {
          if (error) return next(error);
          try {
            checkEditorFlows(Array.isArray(req.body) ? req.body : req.body?.flows);
            const runs = path.resolve(userDir, "../runs");
            if (fs.existsSync(runs) && fs.readdirSync(runs).some((id) => {
              try {
                const state = JSON.parse(fs.readFileSync(path.join(runs, id, "run.json"), "utf8"));
                if (state.status !== "running") return false;
                process.kill(state.pid, 0);
                return true;
              } catch { return false; }
            })) return res.status(409).json({ message: "Çalışan otomasyon bitince değişiklikleri yayımlayın." });
            next();
          } catch (err) {
            res.status(400).json({ message: err.message });
          }
        });
      }
      if (["GET", "HEAD"].includes(req.method) || (req.method === "POST" && req.path.startsWith("/auth/"))) return next();
      return res.sendStatus(405);
    },
  });
  app.use(RED.httpAdmin);
  await RED.start();
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  process.send({ kind: "ready", port: server.address().port, token });
}

main().catch((error) => {
  if (process.connected) process.send({ kind: "error", error: error.message }, () => process.exit(1));
  else process.exit(1);
});
