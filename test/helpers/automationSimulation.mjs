import fs from "node:fs";
import path from "node:path";
import { EventEmitter } from "node:events";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const register = require("../../automation/nodes/avalon.js");
const { bus } = register;
const get = (msg, key) => key.split(".").reduce((value, part) => value?.[part], msg);

// In-memory Node-RED boundary simulation. Custom Avalon nodes are the production nodes;
// switch/change/catch are controlled doubles. No Node-RED server or external agent is started.
export function simulationHost(options = {}) {
  return ({ userDir }) => {
    const graph = JSON.parse(fs.readFileSync(path.join(userDir, "flows.json"), "utf8"));
    const definitions = new Map(), nodes = new Map();
    const previousSend = process.send;
    const child = Object.assign(new EventEmitter(), {
      connected: true, graph,
      send(message) {
        options.onReply?.(message, child);
        if (message.kind === "start") bus.emit("start", message);
        if (message.kind === "taskResult") {
          bus.emit("result:" + message.requestId, message.result);
        }
      },
      disconnect() {
        if (!child.connected) return;
        child.connected = false;
        for (const node of nodes.values()) node.emit("close");
        process.send = previousSend;
      },
    });
    process.send = (message) => {
      if (!child.connected) return;
      options.onMessage?.(message, child);
      queueMicrotask(() => { if (child.connected) child.emit("message", message); });
      if (options.duplicate && message.kind === "task") queueMicrotask(() => { if (child.connected) child.emit("message", structuredClone(message)); });
    };
    const deliver = (id, msg) => queueMicrotask(() => {
      if (!child.connected) return;
      const node = nodes.get(id), config = graph.find((item) => item.id === id);
      const send = (messages) => {
        const outputs = Array.isArray(messages) ? messages : [messages];
        outputs.forEach((output, index) => {
          if (output) for (const target of config.wires?.[index] || []) deliver(target, structuredClone(output));
        });
      };
      const done = (error) => {
        if (!error) return;
        const caught = graph.filter((item) => item.type === "catch" && (item.scope == null || item.scope.includes(id)));
        if (!caught.length) return process.send({ kind: "error", error: error.message });
        msg.error = { message: error.message, source: { id } };
        for (const target of caught) deliver(target.id, msg);
      };
      if (node) node.emit("input", msg, send, done);
      else if (config.type === "switch") {
        const value = get(msg, config.property);
        const index = config.rules.findIndex((rule) => rule.t === "else" || (rule.t === "eq" && value === rule.v) ||
          (rule.t === "empty" && !value) || (rule.t === "nempty" && !!value));
        if (index >= 0) send(config.rules.map((_, slot) => slot === index ? msg : null));
        else done();
      } else if (config.type === "change") {
        for (const rule of config.rules) {
          const parts = rule.p.split("."), leaf = parts.pop();
          let target = msg;
          for (const part of parts) target = target[part] ||= {};
          if (rule.t === "delete") delete target[leaf];
          else target[leaf] = rule.tot === "msg" ? get(msg, rule.to) : rule.tot === "json" ? JSON.parse(rule.to) : rule.to;
        }
        send(msg); done();
      } else if (config.type === "catch") { send(msg); done(); }
    });
    const red = { settings: {}, _: (key) => key, nodes: {
      registerType(type, constructor) { definitions.set(type, constructor); },
      createNode(node, config) {
        const emitter = new EventEmitter();
        node.id = config.id;
        node.on = emitter.on.bind(emitter); node.emit = emitter.emit.bind(emitter);
        node.send = (messages) => {
          (Array.isArray(messages) ? messages : [messages]).forEach((msg, index) => {
            if (msg) for (const target of config.wires?.[index] || []) deliver(target, structuredClone(msg));
          });
        };
        node.warn = () => {};
        node.error = (error) => process.send({ kind: "error", error: String(error.message || error) });
      },
    } };
    register(red);
    if (options.coreDirectory) {
      const fromInstall = createRequire(path.join(options.coreDirectory, "package.json"));
      red.util = fromInstall("@node-red/util").util;
      const core = path.dirname(fromInstall.resolve("@node-red/nodes/package.json"));
      require(path.join(core, "core/function/10-switch.js"))(red);
      require(path.join(core, "core/function/15-change.js"))(red);
    }
    for (const config of graph) if (definitions.has(config.type)) nodes.set(config.id, new (definitions.get(config.type))(config));
    queueMicrotask(() => { options.onReady?.(child); if (child.connected) child.emit("message", { kind: "ready" }); });
    return child;
  };
}
