// Shared by the graph loader and reader so every drawn edge is navigable.
// No Node APIs: this module is also bundled into the renderer.
function normalizePath(value) {
  const parts = [];
  for (const part of value.replace(/\\/g, "/").split("/")) {
    if (!part || part === ".") continue;
    if (part === "..") {
      if (!parts.length) return null;
      parts.pop();
    } else parts.push(part);
  }
  return parts.join("/").toLowerCase();
}

export function isBrainNoteLink(href) {
  const value = String(href || "").trim();
  if (!value || value.startsWith("#") || /^(?:[a-z][a-z\d+.-]*:|[/\\])/i.test(value)) return false;
  let target;
  try { target = decodeURIComponent(value.split("#")[0]); } catch { return false; }
  return !/\.[^./\\]+$/.test(target) || /\.md$/i.test(target);
}

export function createBrainLinkResolver(nodes) {
  const paths = new Map();
  const titles = new Map();
  for (const node of nodes) {
    paths.set(normalizePath(node.id), node.id);
    const title = node.title.toLowerCase();
    // Ambiguous bare names must not silently open an unrelated note.
    titles.set(title, titles.has(title) ? null : node.id);
  }
  return (sourceId, href, wiki = false) => {
    const raw = wiki ? String(href).split("|")[0].trim() : String(href).trim();
    if (!isBrainNoteLink(raw)) return null;
    let target;
    try { target = decodeURIComponent(raw.split("#")[0]); } catch { return null; }
    if (!/\.md$/i.test(target)) target += ".md";
    const source = sourceId.replace(/\\/g, "/");
    const parent = source.includes("/") ? source.slice(0, source.lastIndexOf("/") + 1) : "";
    const relative = normalizePath(parent + target);
    const absolute = normalizePath(target);
    const candidates = wiki ? [absolute, relative] : [relative, absolute];
    for (const candidate of candidates) if (candidate && paths.has(candidate)) return paths.get(candidate);
    if (wiki && !/[/\\]/.test(target)) return titles.get(target.slice(0, -3).toLowerCase()) ?? null;
    return null;
  };
}

export function extractBrainLinks(markdown) {
  // Code examples and comments are not relationships between notes.
  const text = markdown.replace(/<!--[\s\S]*?-->/g, "")
    .replace(/^\s{0,3}(`{3,}|~{3,})[^\n]*\n[\s\S]*?^\s{0,3}\1[^\n]*$/gm, "")
    .replace(/(`+)[\s\S]*?\1/g, "");
  const links = [];
  for (const match of text.matchAll(/!?\[\[([^\]]+)\]\]/g)) {
    if (isBrainNoteLink(match[1].split("|")[0])) links.push({ href: match[1], wiki: true });
  }
  const references = new Map();
  const labelKey = (label) => label.trim().replace(/\s+/g, " ").toLowerCase();
  for (const match of text.matchAll(/^\s{0,3}\[([^\]]+)\]:\s*(?:<([^>]+)>|(\S+))/gm)) {
    references.set(labelKey(match[1]), match[2] ?? match[3]);
  }
  for (const match of text.matchAll(/(?<!!)\[(?!\[)([^\]\n]+)\]\(\s*(?:<([^>]+)>|([^\s)]+))(?:\s+["'][^\n]*?["'])?\s*\)/g)) {
    const href = match[2] ?? match[3];
    if (isBrainNoteLink(href)) links.push({ href, wiki: false });
  }
  for (const match of text.matchAll(/(?<!!)\[(?!\[)([^\]\n]+)\](?:\[([^\]\n]*)\])?(?![\[(\]:])/g)) {
    const href = references.get(labelKey(match[2] || match[1]));
    if (href && isBrainNoteLink(href)) links.push({ href, wiki: false });
  }
  return links;
}
