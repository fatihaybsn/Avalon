// Two independent OS processes exercise the production lock. Temp state only.
import { ResearchStore } from "../../electron/researchStore.mjs";
import { claimSchedule } from "../../electron/researchRunner.mjs";
const store = new ResearchStore(process.argv[2]);
let claim;
process.on("message", async ({ kind, id, occurrence }) => {
  try {
    if (kind === "claim") {
      claim = await claimSchedule(store, store.get(id), occurrence);
      process.send({ kind: "claim", skipped: claim.skipped, reason: claim.reason });
    } else if (kind === "release") {
      await claim?.release?.();
      process.send({ kind: "released" });
    } else if (kind === "exit") process.exit(0);
  } catch (error) { process.send({ kind: "error", error: error.message }); }
});
process.send({ kind: "ready" });
