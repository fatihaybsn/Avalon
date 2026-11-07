import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { createRequire } from "node:module";
const { portableFlows, compileFlow, checkEditorFlows } = createRequire(import.meta.url)("../automation/flows.cjs");
const graph = () => [
  { id: "flow", type: "tab" },
  { id: "start", z: "flow", type: "avalon-start", wires: [["task"]] },
  { id: "task", z: "flow", type: "avalon-hermes", prompt: "private task", wires: [["finish"]] },
  { id: "finish", z: "flow", type: "avalon-finish", wires: [] },
];

test("whitelisted but irrelevant nested configuration cannot leak into a shared Hermes task", () => {
  const input = graph();
  Object.assign(input[2], { outputs: { apiKey: "SECRET_MARKER" }, mode: { token: "SECRET_MARKER" }, breadth: { secret: "SECRET_MARKER" },
    scope: ["SECRET_MARKER"], disabled: { password: "SECRET_MARKER" }, unknown: "SECRET_MARKER" });
  compileFlow(input, "flow"); // Original bug: execution validation accepts this.
  const output = portableFlows(input);
  assert.doesNotMatch(JSON.stringify(output), /SECRET_MARKER/);
  assert.equal(output[2].outputs, 2);
  assert.equal(output[2].mode, undefined);
  assert.ok(compileFlow(output, output[0].id));
});

test("retained numeric/boolean fields reject nested objects instead of copying or coercing them", () => {
  for (const [index, key] of [[0, "disabled"], [2, "x"], [2, "maxAttempts"], [2, "timeoutMs"], [2, "requireApproval"]]) {
    const input = graph(); input[index][key] = { token: "SECRET_MARKER" };
    assert.throws(() => portableFlows(input), undefined, key);
  }
});

test("legacy numeric strings and omitted Node-RED defaults export as canonical primitives", () => {
  const input = graph(); Object.assign(input[2], { x: "120", y: "240.5", maxAttempts: "3", timeoutMs: "7200000" });
  const output = portableFlows(input), task = output[2];
  assert.equal(task.x, 120); assert.equal(task.y, 240.5);
  assert.equal(task.maxAttempts, 3); assert.equal(task.timeoutMs, 7200000);
  assert.equal(task.onError, "stop"); assert.equal(task.requireApproval, false);
  assert.deepEqual(portableFlows(output), output);
});

test("all shipped and legacy linear examples round-trip without mutating source or sharing private values", () => {
  for (const filename of fs.readdirSync("automation/nodes/examples")) {
    const input = JSON.parse(fs.readFileSync("automation/nodes/examples/" + filename, "utf8"));
    const before = JSON.stringify(input);
    const output = portableFlows(input);
    checkEditorFlows(output);
    for (const tab of output.filter((node) => node.type === "tab")) assert.ok(compileFlow(output, tab.id));
    assert.deepEqual(portableFlows(JSON.parse(JSON.stringify(output))), output);
    assert.equal(JSON.stringify(input), before);
  }
});

test("invalid JSON shapes, bad references and out-of-range numeric configuration are rejected", () => {
  for (const input of [null, {}, [], [null], [{ id: "bad", type: "exec" }]]) assert.throws(() => portableFlows(input));
  for (const [field, value] of [["maxAttempts", true], ["maxAttempts", []], ["maxAttempts", ""], ["maxAttempts", "101"],
    ["timeoutMs", "999"], ["x", Infinity], ["x", "NaN"], ["requireApproval", "false"],
    ["reportInputs", [{}]], ["reportInputs", ["missing"]], ["wires", [[{}]]], ["wires", [["missing"]]]]) {
    const input = graph(); input[2][field] = value;
    assert.throws(() => portableFlows(input), undefined, field);
  }
  const credentials = graph(); credentials[2].credentials = { apiKey: "SECRET_MARKER" };
  assert.throws(() => portableFlows(credentials));
});

test("switch/change templates remove nested constants and keep safe msg references and operations", () => {
  const input = graph(); input[2].wires = [["choose"]];
  input.push({ id: "choose", type: "switch", z: "flow", property: "payload.value.outcome", propertyType: "msg", checkall: false,
    rules: [{ t: "eq", v: { apiKey: "SECRET_MARKER" }, vt: "json", arbitrary: "SECRET_MARKER" }, { t: "else" }],
    outputs: { password: "SECRET_MARKER" }, wires: [["change"], ["finish"]] });
  input.push({ id: "change", type: "change", z: "flow", wires: [["finish"]], rules: [
    { t: "set", p: "payload", pt: "msg", to: { token: "SECRET_MARKER" }, tot: "json" },
    { t: "set", p: "feedback", pt: "msg", to: "payload.value", tot: "msg" },
    { t: "delete", p: "topic", pt: "msg" }, { t: "move", p: "payload", pt: "msg", to: "feedback", tot: "msg" },
  ] });
  const output = portableFlows(input);
  assert.doesNotMatch(JSON.stringify(output), /SECRET_MARKER/);
  const choose = output.find((node) => node.type === "switch"), change = output.find((node) => node.type === "change");
  assert.equal(choose.outputs, 2); assert.equal(choose.checkall, "false"); assert.equal(choose.repair, false);
  assert.deepEqual(change.rules.map((rule) => rule.t), ["set", "set", "delete", "move"]);
  assert.equal(change.rules[1].to, "payload.value");
  assert.ok(compileFlow(output, output[0].id));
  assert.deepEqual(portableFlows(output), output);
});

test("catch scopes/report inputs are remapped as IDs and core defaults are typed", () => {
  const input = graph(); input[2].onError = "catch";
  input.push({ id: "caught", z: "flow", type: "catch", scope: ["task"], uncaught: "false", wires: [["finish"]] });
  const output = portableFlows(input), caught = output.find((node) => node.type === "catch");
  assert.deepEqual(caught.scope, [output[2].id]); assert.equal(caught.uncaught, false);
  assert.ok(compileFlow(output, output[0].id));
  input.at(-1).scope = [{ apiKey: "SECRET_MARKER" }];
  assert.throws(() => portableFlows(input));
});

test("unknown nested data on every allowed key is either omitted or rejected, never shared", () => {
  const fields = ["x", "y", "wires", "mode", "breadth", "depth", "reportInputs", "maxAttempts", "timeoutMs", "onError",
    "outputType", "requireApproval", "property", "propertyType", "checkall", "repair", "outputs", "scope", "uncaught", "disabled"];
  for (const type of ["avalon-hermes", "avalon-research"]) for (const field of fields) {
    const input = graph(); Object.assign(input[2], { type, topic: "private topic", [field]: { token: "SECRET_MARKER" } });
    let output;
    try { output = portableFlows(input); } catch { continue; }
    assert.doesNotMatch(JSON.stringify(output), /SECRET_MARKER/, type + ": " + field);
  }
});
