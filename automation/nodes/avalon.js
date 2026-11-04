"use strict";

const { EventEmitter } = require("node:events");
const bus = new EventEmitter();
module.exports = function register(RED) {
  RED.nodes.registerType("avalon-start", function Start(config) {
    RED.nodes.createNode(this, config);
    if (!process.send) return;
    const start = () => this.send({ payload: null });
    bus.on("start", start);
    this.on("close", () => bus.off("start", start));
  });
  RED.nodes.registerType("avalon-research", function Research(config) {
    RED.nodes.createNode(this, config);
    this.on("input", (msg, send, done) => {
      if (!process.send) return done();
      bus.once(this.id, (ok) => {
        if (ok) send(msg);
        done();
      });
      process.send({ kind: "step", id: this.id });
    });
  });
  RED.nodes.registerType("avalon-finish", function Finish(config) {
    RED.nodes.createNode(this, config);
    this.on("input", (_msg, _send, done) => {
      if (process.send) process.send({ kind: "finish" });
      done();
    });
  });
};
module.exports.bus = bus;
