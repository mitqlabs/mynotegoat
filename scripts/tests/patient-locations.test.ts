import assert from "node:assert/strict";
import { answerLocationQuestion, parseLocationQuestion, patientPlace, summarizeLocations, NO_ADDRESS_KEY, type LocationPatient } from "../../src/lib/patient-locations";
import { isStatsOfficeKind } from "../../src/lib/goat-briefs";

// Mock patients only (no real data).
const P = (id: string, address: string | undefined, caseStatus = "Active", deleted = false): LocationPatient => ({ id, fullName: `Test Patient ${id}`, caseStatus, address, deleted });
const pts: LocationPatient[] = [
  P("1", "1 Fake St, Glendale, CA 91205"),
  P("2", "2 Fake St,  glendale ,ca 91205"),
  P("3", "3 Fake St, GLENDALE, CA 91204", "Discharged"),
  P("4", "4 Fake St, Burbank, CA 91502"),
  P("5", "5 Fake St, Glendale, AZ 85301"),
  P("6", "", "Active"),
  P("7", undefined, "Discharged"),
  P("8", "8 Fake St", "Active"),
  P("9", "9 Fake St, Burbank, CA 91502", "Active", true),
  P("10", "10 Fake St, North   HOLLYWOOD, CA 91601-1234"),
];

assert.deepEqual(patientPlace("1 Fake St, Glendale, CA 91205"), { city: "Glendale", state: "CA", zip: "91205" });
assert.equal(patientPlace("8 Fake St").city, "");
assert.equal(patientPlace("10 Fake St, North   HOLLYWOOD, CA 91601-1234").city, "North Hollywood");
assert.equal(patientPlace("10 Fake St, North Hollywood, CA 91601-1234").zip, "91601");

// City: normalized, grouped by city+state, count desc, no "Other", deleted skipped.
const c = summarizeLocations(pts, "city");
assert.equal(c.total, 9);
assert.deepEqual(c.rows.map((r) => [r.label, r.count]), [["Glendale, CA", 3], ["Burbank, CA", 1], ["Glendale, AZ", 1], ["North Hollywood, CA", 1]]);
assert.ok(!c.rows.some((r) => /other/i.test(r.label)));
assert.equal(c.rows[0].percent, 33);
assert.equal(c.noAddress?.key, NO_ADDRESS_KEY);
assert.deepEqual(c.noAddress?.patientIds.sort(), ["6", "7", "8"]);

// ZIP: "ZIP · City" labels.
const z = summarizeLocations(pts, "zip");
assert.deepEqual(z.rows.map((r) => [r.label, r.count]), [["91205 · Glendale", 2], ["85301 · Glendale", 1], ["91204 · Glendale", 1], ["91502 · Burbank", 1], ["91601 · North Hollywood", 1]]);
assert.equal(z.noAddress?.count, 3);

// Status filter.
const d = summarizeLocations(pts, "city", "Discharged");
assert.equal(d.total, 2);
assert.deepEqual(d.rows.map((r) => r.label), ["Glendale, CA"]);
assert.deepEqual(d.noAddress?.patientIds, ["7"]);
assert.equal(summarizeLocations([], "city").noAddress, null);

// G.O.A.T. wording.
assert.deepEqual(parseLocationQuestion("how many patients from Glendale"), { kind: "place", query: "Glendale", mode: "city" });
assert.deepEqual(parseLocationQuestion("How many patients live in north hollywood?"), { kind: "place", query: "north hollywood", mode: "city" });
assert.deepEqual(parseLocationQuestion("how many pts in 91205"), { kind: "place", query: "91205", mode: "zip" });
assert.deepEqual(parseLocationQuestion("top zip codes"), { kind: "top", mode: "zip" });
assert.deepEqual(parseLocationQuestion("what cities are our patients from"), { kind: "top", mode: "city" });
assert.equal(parseLocationQuestion("how many patients this week"), null);
assert.equal(parseLocationQuestion("how many canceled appts do we have"), null);
assert.equal(parseLocationQuestion("schedule Test Patient tomorrow"), null);

assert.match(answerLocationQuestion({ kind: "place", query: "glendale", mode: "city" }, pts).text, /^4 patients live in Glendale \(3 active\)/);
assert.match(answerLocationQuestion({ kind: "place", query: "Pasadena", mode: "city" }, pts).text, /No patients/);
const top = answerLocationQuestion({ kind: "top", mode: "zip" }, pts).text;
assert.match(top, /^Top ZIP codes \(9 patients\):\n1\. 91205 · Glendale: 2 \(22%\)/);
assert.match(top, /No address: 3\./);
assert.ok(isStatsOfficeKind("locationStats"));

console.log("patient-locations tests passed");
