import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import { Stretch } from "@soundtouchjs/core";

const source = ts.transpileModule(fs.readFileSync(new URL("../src/lib/speechTempo.ts", import.meta.url), "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const context = vm.createContext({ exports: {}, Float32Array, require(name) {
  if (name === "@soundtouchjs/core") return { Stretch };
  throw new Error(`Unexpected import: ${name}`);
} });
vm.runInContext(source, context);
export const SpeechTempo = context.exports.SpeechTempo;
