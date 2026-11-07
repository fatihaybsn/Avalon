import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { openAutomationMemory, withoutRecordManifest } from "../electron/automationMemory.mjs";
import { writeJson } from "../electron/researchStore.mjs";

test("coverage accepts JSON-labelled records without changing discovered entities", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "avalon-memory-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const directory = path.join(root, "inputs", "fixture");
  const company = { key: "example.org", name: "Original", url: "https://example.org", updatedAt: 1 };
  writeJson(path.join(directory, "inputs.json"), { steps: { analysis: { coverage: { group: "companies" } } } });
  writeJson(path.join(directory, "records.json"), { records: { companies: [company] }, coverage: {} });
  const memory = openAutomationMemory(root, { id: "fixture", steps: [{ id: "analysis" }] });
  const block = (records) => "# Report\n\n" + String.fromCharCode(96).repeat(3) + "json\n" +
    JSON.stringify({ records, coverage: [{ key: company.key, status: "completed", note: "Checked." }] }) +
    "\n" + String.fromCharCode(96).repeat(3);
  const step = { id: "analysis" };
  assert.throws(() => memory.commit(step, block([{ key: "unknown.org" }])), /kuyruk dışında/);
  const report = block([{ ...company, name: "Redundant changed name" }]);
  assert.throws(() => memory.commit(step, report + "\n" + report), /kayıt bloğu bulunamadı/);
  memory.commit(step, report);
  const saved = JSON.parse(fs.readFileSync(path.join(directory, "records.json")));
  assert.deepEqual(saved.records.companies, [company]);
  assert.equal(saved.coverage.analysis[company.key].status, "completed");
  assert.equal(withoutRecordManifest(report), "# Report");
  const unrelated = String.fromCharCode(96).repeat(3) + 'json\n{"example":true}\n' + String.fromCharCode(96).repeat(3);
  assert.equal(withoutRecordManifest(unrelated), unrelated);
});

function identityFixture(t, records = [], coverage = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "avalon-identity-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const directory = path.join(root, "inputs", "fixture");
  writeJson(path.join(directory, "inputs.json"), { steps: {
    discovery: { group: "companies", identity: "domain" },
    analysis: { coverage: { group: "companies" } },
  } });
  writeJson(path.join(directory, "records.json"), { records: { companies: records }, coverage });
  const memory = openAutomationMemory(root, { id: "fixture", steps: [{ id: "discovery" }, { id: "analysis" }] });
  return { memory, read: () => JSON.parse(fs.readFileSync(path.join(directory, "records.json"))) };
}

const record = (name, url) => ({ key: name, name, url, note: "Public company profile.", status: "completed", changed: false });
const manifest = (records) => "```avalon-records\n" + JSON.stringify({ records, coverage: [] }) + "\n```";

test("different LinkedIn company profiles remain distinct and enter the analysis queue", (t) => {
  const { memory, read } = identityFixture(t);
  const rows = [record("First company", "https://tr.linkedin.com/company/first"),
    record("Second company", "https://tr.linkedin.com/company/second")];
  memory.commit({ id: "discovery" }, manifest(rows));
  const keys = ["linkedin.com/company/first", "linkedin.com/company/second"];
  assert.deepEqual(read().records.companies.map((row) => row.key), keys);
  const prepared = memory.prepare({ id: "analysis", spec: { mode: "deep" } }, []);
  assert.deepEqual(JSON.parse(prepared.reports.at(-1).markdown).requiredQueue.map((row) => row.key), keys);
  memory.commit({ id: "discovery" }, manifest([
    record("First changed display name", "https://www.linkedin.com/company/FIRST/about/?trk=example"),
  ]));
  assert.equal(read().records.companies.length, 2);
  assert.equal(read().records.companies[0].name, "First company");
});

test("a repeated LinkedIn company in one report is rejected atomically", (t) => {
  const { memory, read } = identityFixture(t);
  assert.throws(() => memory.commit({ id: "discovery" }, manifest([
    record("First", "https://tr.linkedin.com/company/first"),
    record("Alias", "https://linkedin.com/company/FIRST/about"),
  ])), /yinelenen/);
  assert.deepEqual(read().records.companies, []);
});

test("legacy LinkedIn keys keep their existing analysis completion references", (t) => {
  const prior = { ...record("First", "https://tr.linkedin.com/company/first"), key: "tr.linkedin.com", updatedAt: 1 };
  const coverage = { analysis: { "tr.linkedin.com": { status: "completed", at: 2, note: "Already checked." } } };
  const { memory, read } = identityFixture(t, [prior], coverage);
  memory.commit({ id: "discovery" }, manifest([
    record("First alias", "https://linkedin.com/company/first/about"),
    record("Second", "https://tr.linkedin.com/company/second"),
  ]));
  assert.deepEqual(read().records.companies.map((row) => row.key), ["tr.linkedin.com", "linkedin.com/company/second"]);
  assert.deepEqual(read().coverage, coverage);
  const prepared = memory.prepare({ id: "analysis", spec: { mode: "deep" } }, []);
  assert.deepEqual(JSON.parse(prepared.reports.at(-1).markdown).requiredQueue.map((row) => row.key), ["linkedin.com/company/second"]);
});

test("company websites keep domain identity and lookalike hosts are not LinkedIn", (t) => {
  const { memory, read } = identityFixture(t);
  memory.commit({ id: "discovery" }, manifest([
    record("Company", "https://www.example.org/careers"),
    record("Other site", "https://linkedin.com.example.net/company/first"),
  ]));
  assert.deepEqual(read().records.companies.map((row) => row.key), ["example.org", "linkedin.com.example.net"]);
  memory.commit({ id: "discovery" }, manifest([record("Company alias", "https://example.org/products")]));
  assert.equal(read().records.companies.length, 2);
});
