import path from "node:path";
// External interpreters cannot open files inside Electron's virtual ASAR tree.
export function nativeResourcePath(root, ...parts) {
  return path.join(root.endsWith(".asar") ? `${root}.unpacked` : root, ...parts);
}
