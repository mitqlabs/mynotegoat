import assert from "node:assert/strict";
import { hasNoOffice, matchesOfficeFilter, NO_OFFICE_FILTER, NO_OFFICE_LABEL } from "../../src/lib/location-filter";

const offices = ["loc-hulen", "loc-saginaw"];
assert.equal(matchesOfficeFilter("loc-hulen", "", offices), true, "All shows everyone");
assert.equal(matchesOfficeFilter("loc-hulen", "loc-hulen", offices), true);
assert.equal(matchesOfficeFilter("loc-saginaw", "loc-hulen", offices), false, "other office hidden");
assert.equal(matchesOfficeFilter(undefined, "loc-hulen", offices), false, "strict: unassigned hidden under an office");
assert.equal(matchesOfficeFilter("", "loc-saginaw", offices), false);
assert.equal(matchesOfficeFilter(undefined, "", offices), true, "All shows unassigned");
assert.equal(matchesOfficeFilter(undefined, NO_OFFICE_FILTER, offices), true, "No office set shows unassigned");
assert.equal(matchesOfficeFilter("loc-hulen", NO_OFFICE_FILTER, offices), false, "No office set hides assigned");
assert.equal(matchesOfficeFilter("loc-deleted", NO_OFFICE_FILTER, offices), true, "deleted office counts as no office");
assert.equal(offices.includes(NO_OFFICE_FILTER), false);
assert.equal(matchesOfficeFilter("loc-deleted", "loc-hulen", offices), false, "deleted office not shown under another office");
assert.equal(hasNoOffice(null, offices), true);
assert.equal(hasNoOffice("loc-hulen", offices), false);
assert.equal(NO_OFFICE_LABEL, "No office set");

// Mock list: strict office filtering.
const mockPatients = [
  { id: "p1", locationId: undefined },
  { id: "p2", locationId: "loc-hulen" },
  { id: "p3", locationId: "loc-saginaw" },
];
const visible = mockPatients.filter((p) => matchesOfficeFilter(p.locationId, "loc-hulen", offices)).map((p) => p.id);
assert.deepEqual(visible, ["p2"]);
const noOffice = mockPatients.filter((p) => matchesOfficeFilter(p.locationId, NO_OFFICE_FILTER, offices)).map((p) => p.id);
assert.deepEqual(noOffice, ["p1"]);
const all = mockPatients.filter((p) => matchesOfficeFilter(p.locationId, "", offices)).map((p) => p.id);
assert.deepEqual(all, ["p1", "p2", "p3"]);
console.log("PASS location-filter (strict, mock data)");

// Location field width fits the longest office label (mock names), clamped.
import { locationFieldWidth } from "../../src/lib/location-filter";
assert.equal(locationFieldWidth([{ nickname: "Prime Spine & Wellness" }, { nickname: "Saginaw" }]), "calc(22ch + 3.5rem)");
assert.equal(locationFieldWidth([{ nickname: "A" }]), "calc(14ch + 3.5rem)", "never narrower than 'Removed office'");
assert.equal(locationFieldWidth([{ name: "X".repeat(60) }]), "calc(32ch + 3.5rem)", "clamped");
console.log("location width: ok");
