// Production admission/runner with an in-memory host and a delayed mock task.
import { runEntry } from "../../electron/researchRunner.mjs";
import { DEFAULT_BRAIN } from "../../electron/brainModels.mjs";
import { simulationHost } from "./automationSimulation.mjs";
const notify = process.send.bind(process);
const controller = new AbortController();
let release;
const gate = new Promise((resolve) => { release = resolve; });
process.on("message", (message) => {
  if (message === "release") release();
  if (message === "cancel") controller.abort(Object.assign(new Error("offline cancellation"), { code: "CANCELLED" }));
});
try {
  const result = await runEntry(["--automation", process.argv[2], "--occurrence", process.argv[3]], {
    parentSignal: controller.signal, getRoute: () => DEFAULT_BRAIN, startHost: simulationHost(),
    runHermes: async ({ signal }) => {
      notify({ kind: "entered" });
      signal.addEventListener("abort", () => notify({ kind: "aborted" }), { once: true });
      await gate;
      return { status: "completed", output: "offline fixture" };
    },
  });
  notify({ kind: "result", result });
} catch (error) { notify({ kind: "error", error: error.message }); process.exitCode = 1; }
process.disconnect();
