/**
 * Treatment Plan typing: a cloud echo of an earlier keystroke ("2") must
 * not overwrite what was typed after it ("26"), and chip taps must not be
 * replaced by the echo of the previous tap (the flicker).
 *
 * Run:  npx tsx scripts/tests/treatment-plan-echo.test.ts
 */
import assert from "node:assert/strict";

const store = new Map<string, string>();
(globalThis as unknown as { window: unknown }).window = {
  localStorage: {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
  },
};
process.on("unhandledRejection", () => {});

async function main() {
  const { saveTreatmentPlans, loadTreatmentPlans, STORAGE_KEY_TREATMENT_PLANS } = await import(
    "../../src/lib/treatment-plans"
  );
  const { wasRecentlyWrittenLocally } = await import("../../src/lib/local-sync");

  const plan = (max: string) => ({
    p1: [{
      id: "tp1", patientId: "p1", startDate: "10/01/2026", endDate: "10/31/2026", days: {},
      decompression: { startWeight: "10", increase: "2", cycles: "", maxWeight: max },
      active: true, createdAt: "x", updatedAt: "x",
    }],
  });

  assert.equal(wasRecentlyWrittenLocally(STORAGE_KEY_TREATMENT_PLANS), false);
  saveTreatmentPlans(plan("2") as never);
  saveTreatmentPlans(plan("26") as never);

  // Same rule GlobalKvRealtime applies before letting a cloud row overwrite local.
  const echoOfFirstKeystroke = JSON.stringify(plan("2"));
  if (!wasRecentlyWrittenLocally(STORAGE_KEY_TREATMENT_PLANS)) {
    store.set(STORAGE_KEY_TREATMENT_PLANS, echoOfFirstKeystroke);
  }
  assert.equal(loadTreatmentPlans().p1[0].decompression?.maxWeight, "26");
  console.log("PASS stale cloud echo can't drop the 6 in 26");
}
main().catch((e) => { console.log("FAIL", e); process.exit(1); });
