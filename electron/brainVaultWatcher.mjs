import fs from "node:fs";

// Vault changes update notes + search; an index commit only reloads search.
// Never feed our own index output back into embedding or map reconstruction.
export function watchBrainFiles({ root, indexDir, onVaultChanged, onIndexChanged, onError = () => {}, watch = fs.watch, debounceMs = 1200 }) {
  const watchers = [], timers = new Map();
  let closed = false;
  const subscribe = (dir, kind, accept, callback) => {
    try {
      watchers.push(watch(dir, { recursive: true }, (_event, filename) => {
        if (closed) return;
        if (filename && !accept(String(filename))) return;
        clearTimeout(timers.get(kind));
        timers.set(kind, setTimeout(() => { timers.delete(kind); callback(); }, debounceMs));
      }));
    } catch (error) { onError(dir, error); }
  };
  subscribe(root, "vault", (name) => /\.md$/i.test(name) && !name.split(/[/\\]/).some((part) => part.startsWith(".")), onVaultChanged);
  // Subscribe before the first sync too, when no index exists yet.
  fs.mkdirSync(indexDir, { recursive: true });
  subscribe(indexDir, "index", (name) => name === "manifest.json", onIndexChanged);
  return () => {
    if (closed) return;
    closed = true;
    for (const timer of timers.values()) clearTimeout(timer);
    for (const watcher of watchers) watcher.close();
    timers.clear();
  };
}
