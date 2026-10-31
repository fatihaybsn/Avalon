// Retain live node objects (positions, drag pins and velocity) on graph updates.
// Content-only changes must not restart physics or reset the camera.
export function mergeBrainGraphData(current, incoming) {
  const oldNodes = new Map(current.nodes.map((node) => [node.id, node]));
  const endpoint = (node) => typeof node === "object" ? node.id : node;
  const linkKeys = (links) => links.map((link) => JSON.stringify([endpoint(link.source), endpoint(link.target)])).sort().join("\n");
  const changed = current.nodes.length !== incoming.nodes.length || incoming.nodes.some((node) => {
    const old = oldNodes.get(node.id);
    return !old || old.title !== node.title || old.folder !== node.folder || old.degree !== node.degree;
  }) || linkKeys(current.links) !== linkKeys(incoming.links);
  return {
    changed,
    nodes: changed ? incoming.nodes.map((node) => {
      const old = oldNodes.get(node.id);
      return old ? Object.assign(old, node) : { ...node };
    }) : current.nodes,
    links: changed ? incoming.links.map((link) => ({ ...link })) : current.links,
  };
}
