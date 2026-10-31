import fs from "node:fs";
import path from "node:path";
import { walkVaultFiles } from "./brainIndex.mjs";
import { createBrainLinkResolver, extractBrainLinks } from "./brainLinks.mjs";

export function readBrainGraph(root) {
  const files = walkVaultFiles(root);
  const nodes = files.map((file) => {
    const id = path.relative(root, file);
    return { id, title: path.basename(file, ".md"), folder: id.includes(path.sep) ? id.split(path.sep)[0] : "root", degree: 0 };
  });
  const resolve = createBrainLinkResolver(nodes);
  const links = [], missingLinks = [], seen = new Set(), missing = new Set();
  const byId = new Map(nodes.map((node) => [node.id, node]));
  files.forEach((file, index) => {
    const source = nodes[index].id;
    for (const { href, wiki } of extractBrainLinks(fs.readFileSync(file, "utf8"))) {
      const target = resolve(source, href, wiki);
      if (!target) {
        const key = JSON.stringify([source, href]);
        if (!missing.has(key)) { missing.add(key); missingLinks.push({ source, target: href }); }
        continue;
      }
      if (source === target) continue;
      const key = JSON.stringify([source, target]);
      if (seen.has(key)) continue;
      seen.add(key);
      links.push({ source, target });
      byId.get(source).degree++;
      byId.get(target).degree++;
    }
  });
  return { ok: true, root, nodes, links, missingLinks };
}
