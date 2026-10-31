import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  VERSION,
  buildChunkRecords,
  buildLexicon,
  hybridSearch,
  lexicalFilter,
  readVaultRecords,
  brainIndexIsCurrent,
  indexDirFor,
  loadIndexFromDisk,
  syncBrainIndex,
  EMBED_DIMS,
} from "../electron/brainIndex.mjs";

function makeVault(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "iris-brain-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

test("brain index v2 chunks long notes while lexical records remain note-level", (t) => {
  const root = makeVault(t);
  const longBody = Array.from(
    { length: 80 },
    (_, index) => `Paragraph ${index}: Project Aurora decision and supporting detail ${"x".repeat(55)}.`,
  ).join("\n\n");
  fs.writeFileSync(
    path.join(root, "Aurora.md"),
    `---\ntags: project decision\naliases: Northern Lights\n---\n# Aurora\n\n${longBody}`,
  );

  const records = readVaultRecords(root);
  const chunks = buildChunkRecords(records);
  assert.equal(VERSION, 2);
  assert.equal(records.length, 1);
  assert.ok(chunks.length > 2);
  assert.equal(new Set(chunks.map((chunk) => chunk.id)).size, chunks.length);
  assert.ok(chunks.every((chunk) => chunk.embedText.includes("Title: Aurora")));

  const matches = lexicalFilter(buildLexicon(records), "aurora decision");
  assert.equal(matches.length, 1);
  assert.equal(matches[0].rel, "Aurora.md");
});

test("semantic-only hits return the matching chunk snippet", (t) => {
  const root = makeVault(t);
  fs.writeFileSync(path.join(root, "Alpha.md"), "# Alpha\n\nThe launch checklist is stored here.");
  const records = readVaultRecords(root);
  const lexicon = buildLexicon(records);
  const index = {
    manifest: {
      version: 2,
      dims: 2,
      notes: [
        {
          path: "Alpha.md",
          title: "Alpha",
          folder: "root",
          snippet: "Semantic chunk containing the launch checklist.",
          mtimeMs: Date.now(),
        },
      ],
    },
    vectors: new Float32Array([1, 0]),
  };
  const [hit] = hybridSearch({
    lexicon,
    index,
    queryVector: new Float32Array([1, 0]),
    query: "orbital readiness phrase",
    topK: 1,
  });
  assert.equal(hit.rel, "Alpha.md");
  assert.equal(hit.cosScore, 1);
  assert.match(hit.snippet, /Semantic chunk/);
});

function cachedVault(t) {
  const root = makeVault(t);
  fs.writeFileSync(path.join(root, "Alpha.md"), "# Alpha\n\nAn unchanged project decision.");
  fs.writeFileSync(path.join(root, "Beta.md"), "# Beta\n\nA separate project note.");
  const chunks = buildChunkRecords(readVaultRecords(root));
  const dir = indexDirFor(root);
  assert.ok(path.resolve(dir).startsWith(path.join(os.homedir(), ".iris", "brain-index") + path.sep));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.mkdirSync(dir, { recursive: true });
  const vectors = new Float32Array(chunks.length * EMBED_DIMS);
  chunks.forEach((_, row) => { vectors[row * EMBED_DIMS] = 1; });
  const manifest = {
    version: VERSION, model: "fixture-embedding", dims: EMBED_DIMS,
    vault: root, updatedAt: new Date(0).toISOString(),
    notes: chunks.map((chunk) => ({
      path: chunk.rel, title: chunk.title, folder: chunk.folder,
      chunkIndex: chunk.chunkIndex, hash: chunk.hash,
      snippet: chunk.snippet, mtimeMs: chunk.mtimeMs,
    })),
  };
  fs.writeFileSync(path.join(dir, "manifest.json"), JSON.stringify(manifest));
  fs.writeFileSync(path.join(dir, "vectors.f32"), Buffer.from(vectors.buffer));
  return { root, dir };
}

test("unchanged syncs do not write the manifest or vectors, even after an mtime-only change", async (t) => {
  const { root, dir } = cachedVault(t);
  const manifestPath = path.join(dir, "manifest.json");
  const before = fs.readFileSync(manifestPath);
  const mtime = fs.statSync(manifestPath).mtimeMs;
  t.mock.method(globalThis, "fetch", () => { throw new Error("No-op sync must never call an API"); });
  fs.utimesSync(path.join(root, "Alpha.md"), new Date(), new Date());
  for (let cycle = 0; cycle < 3; cycle++) {
    const result = await syncBrainIndex({ vaultRoot: root, apiKey: "" });
    assert.equal(result.changed, false);
    assert.equal(result.embedded, 0);
    assert.equal(result.reused, 2);
    assert.equal(result.index.manifest.updatedAt, new Date(0).toISOString());
  }
  assert.deepEqual(fs.readFileSync(manifestPath), before);
  assert.equal(fs.statSync(manifestPath).mtimeMs, mtime);
  assert.deepEqual(fs.readdirSync(dir).sort(), ["manifest.json", "vectors.f32"]);
});

test("freshness detects content edits with old mtimes, deleted notes and renamed notes", (t) => {
  const { root } = cachedVault(t);
  const saved = loadIndexFromDisk(root);
  assert.equal(brainIndexIsCurrent(readVaultRecords(root), saved), true);
  fs.writeFileSync(path.join(root, "Alpha.md"), "# Alpha\n\nChanged decision.");
  fs.utimesSync(path.join(root, "Alpha.md"), new Date(0), new Date(0));
  assert.equal(brainIndexIsCurrent(readVaultRecords(root), saved), false);
  fs.unlinkSync(path.join(root, "Alpha.md"));
  assert.equal(brainIndexIsCurrent(readVaultRecords(root), saved), false);
  fs.renameSync(path.join(root, "Beta.md"), path.join(root, "Renamed.md"));
  assert.equal(brainIndexIsCurrent(readVaultRecords(root), saved), false);
});

test("changed notes embed only the delta, deletion prunes without API and the next sync is a no-op", async (t) => {
  const { root } = cachedVault(t);
  const calls = [];
  t.mock.method(globalThis, "fetch", async (url, options) => {
    assert.match(url, /fixture-embedding:batchEmbedContents$/);
    const body = JSON.parse(options.body);
    calls.push(body.requests);
    return new Response(JSON.stringify({ embeddings: body.requests.map(() => ({ values: Array.from({ length: EMBED_DIMS }, (_, i) => i === 0 ? 1 : 0) })) }), { status: 200 });
  });
  fs.appendFileSync(path.join(root, "Alpha.md"), "\nAn updated conclusion.");
  const changed = await syncBrainIndex({ vaultRoot: root, apiKey: "offline-fixture" });
  assert.equal(changed.changed, true);
  assert.equal(changed.embedded, 1);
  assert.equal(changed.reused, 1);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].length, 1);
  assert.equal(brainIndexIsCurrent(readVaultRecords(root), loadIndexFromDisk(root)), true);
  fs.unlinkSync(path.join(root, "Beta.md"));
  const pruned = await syncBrainIndex({ vaultRoot: root, apiKey: "" });
  assert.equal(pruned.pruned, 1);
  assert.equal(pruned.embedded, 0);
  assert.equal(calls.length, 1);
  assert.equal((await syncBrainIndex({ vaultRoot: root, apiKey: "" })).changed, false);
});
