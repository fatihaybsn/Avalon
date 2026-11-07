"use strict";

const crypto = require("node:crypto");
const { EventEmitter } = require("node:events");
const bus = new EventEmitter();

// Only the custom boundary nodes cross IPC. All routing remains in Node-RED.
module.exports = function register(RED) {
  RED.nodes.registerType("avalon-start", function Start(config) {
    RED.nodes.createNode(this, config);
    const start = (context) => this.send({ payload: null, avalon: { runId: context.runId, outputs: {}, lastResult: null } });
    bus.on("start", start);
    this.on("close", () => bus.off("start", start));
  });
  for (const type of ["avalon-research", "avalon-hermes"]) RED.nodes.registerType(type, function Task(config) {
    RED.nodes.createNode(this, config);
    const pending = new Map();
    this.on("input", (msg, send, done) => {
      // Editor deployments never execute work.
      if (!process.send || !msg.avalon?.runId) return done();
      const requestId = crypto.randomUUID();
      const event = "result:" + requestId;
      const receive = (result) => {
        pending.delete(event);
        msg.payload = result;
        msg.avalon.lastResult = result;
        if (result.status === "completed") {
          msg.avalon.outputs[this.id] = result.ref;
          send(msg);
          done();
        } else {
          delete msg.avalon.outputs[this.id];
          if (config.onError === "route") { send([null, msg]); done(); }
          else if (config.onError === "catch") done(new Error(result.error || "Görev başarısız."));
          else {
            process.send({ kind: "halted", runId: msg.avalon.runId, requestId });
            done();
          }
        }
      };
      pending.set(event, receive);
      bus.once(event, receive);
      process.send({ kind: "task", id: this.id, requestId, runId: msg.avalon.runId,
        outputs: msg.avalon.outputs, feedback: msg.feedback });
    });
    this.on("close", () => {
      for (const [event, listener] of pending) bus.off(event, listener);
      pending.clear();
    });
  });
  RED.nodes.registerType("avalon-finish", function Finish(config) {
    RED.nodes.createNode(this, config);
    this.on("input", (msg, _send, done) => {
      if (process.send && msg.avalon?.runId) process.send({ kind: "finish", runId: msg.avalon.runId,
        result: msg.avalon.lastResult, outputs: msg.avalon.outputs });
      done();
    });
  });
};
module.exports.bus = bus;
