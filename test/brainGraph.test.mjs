import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createBrainLinkResolver, extractBrainLinks } from "../electron/brainLinks.mjs";
import { readBrainGraph } from "../electron/brainGraph.mjs";
import { mergeBrainGraphData } from "../electron/brainGraphLayout.mjs";
import { watchBrainFiles } from "../electron/brainVaultWatcher.mjs";

test("reader and graph resolve Markdown, encoded Turkish paths, headings and qualified wikilinks consistently", () => {
  const nodes = [
    { id: "Home.md", title: "Home" },
    { id: "Projeler\\Karar Notları.md", title: "Karar Notları" },
    { id: "Projeler\\Duplicate.md", title: "Duplicate" },
    { id: "Other\\Duplicate.md", title: "Duplicate" },
  ];
  const resolve = createBrainLinkResolver(nodes);
  assert.equal(resolve("Home.md", "Projeler/Karar%20Notlar%C4%B1.md#Sonuç"), nodes[1].id);
  assert.equal(resolve(nodes[1].id, "../Home.md"), "Home.md");
  assert.equal(resolve("Home.md", "Karar Notları#Sonuç|Karar", true), nodes[1].id);
  assert.equal(resolve("Home.md", "Other/Duplicate.md", true), nodes[3].id);
  assert.equal(resolve("Home.md", "Duplicate", true), null);
  assert.equal(resolve("Home.md", "../../Home.md"), null);
  assert.equal(resolve("Home.md", "https://example.test/Home.md"), null);
  assert.equal(resolve("Home.md", "file:///Home.md"), null);
  assert.equal(resolve("Home.md", "#Section"), null);
  assert.equal(resolve("Home.md", "%zz.md"), null);
});

test("extracts real links, including references, while ignoring code, comments, images and web URLs", () => {
  const text = [
    "[A](A.md) [[B|alias]] [C](<Projeler/C%20Note.md> \"title\")",
    "[reference][ref] [shortcut]",
    "[ref]: D.md", "[shortcut]: E.md",
    "`[[Inline]] [hidden](Hidden.md)`", "```md", "[[Example]]", "```",
    "<!-- [[Comment]] --> ![picture](Image.png) ![[Diagram.png]] [web](https://example.test/Remote.md)",
  ].join("\n");
  assert.deepEqual(extractBrainLinks(text).map((link) => link.href).sort(), ["A.md", "B|alias", "D.md", "E.md", "Projeler/C%20Note.md"].sort());
});

test("graph counts actual edges and missing destinations without modifying notes", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "iris-graph-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, "Projeler"));
  const home = "# Home\n[A](Projeler/A.md) [[Projeler/A]] [missing](Absent.md)";
  fs.writeFileSync(path.join(root, "Home.md"), home);
  fs.writeFileSync(path.join(root, "Projeler", "A.md"), "[Home](../Home.md) [[Absent]]");
  const result = readBrainGraph(root);
  assert.equal(result.nodes.length, 2);
  assert.equal(result.links.length, 2);
  assert.equal(result.missingLinks.length, 2);
  assert.ok(result.nodes.every((node) => node.degree === 2));
  assert.equal(fs.readFileSync(path.join(root, "Home.md"), "utf8"), home);
});

test("graph updates preserve node positions and pins; unchanged topology does not restart the graph", () => {
  const a = { id: "A", title: "A", folder: "root", degree: 1, x: 50, y: -20, fx: 50, fy: -20 };
  const b = { id: "B", title: "B", folder: "root", degree: 1, x: -40, y: 30 };
  const current = { nodes: [a, b], links: [{ source: a, target: b }] };
  const unchanged = mergeBrainGraphData(current, { nodes: [a, b].map(({ id, title, folder, degree }) => ({ id, title, folder, degree })), links: [{ source: "A", target: "B" }] });
  assert.equal(unchanged.changed, false);
  assert.equal(unchanged.nodes, current.nodes);
  const added = mergeBrainGraphData(current, { nodes: [{ ...a, degree: 2 }, b, { id: "C", title: "C", folder: "root", degree: 1 }], links: [{ source: "A", target: "B" }, { source: "A", target: "C" }] });
  assert.equal(added.changed, true);
  assert.equal(added.nodes[0], a);
  assert.equal(added.nodes[1], b);
  assert.deepEqual([a.x, a.y, a.fx, a.fy], [50, -20, 50, -20]);
  const removed = mergeBrainGraphData(added, { nodes: [{ ...a, degree: 0 }], links: [] });
  assert.equal(removed.nodes[0], a);
  assert.equal(removed.nodes.length, 1);
});

test("index commits refresh only search; note edits refresh the map once; close cancels pending events", async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "iris-watcher-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const handlers = new Map(); let closed = 0, vaultChanges = 0, indexChanges = 0;
  const indexDir = path.join(root, "index");
  const close = watchBrainFiles({ root, indexDir, debounceMs: 5,
    watch: (dir, _options, listener) => { handlers.set(dir, listener); return { close: () => { closed++; } }; },
    onVaultChanged: () => { vaultChanges++; }, onIndexChanged: () => { indexChanges++; },
  });
  t.after(close);
  for (const name of ["manifest.json.tmp", "vectors.f32", "vectors-v2.f32", ".sync.lock"]) handlers.get(indexDir)("change", name);
  for (let i = 0; i < 3; i++) handlers.get(indexDir)("rename", "manifest.json");
  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.equal(indexChanges, 1);
  assert.equal(vaultChanges, 0);
  for (const name of [".obsidian/settings.md", "Picture.png", "Note.md", "Note.md"]) handlers.get(root)("change", name);
  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.equal(vaultChanges, 1);
  handlers.get(root)("change", "Late.md");
  close();
  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.equal(vaultChanges, 1);
  assert.equal(closed, 2);
});
