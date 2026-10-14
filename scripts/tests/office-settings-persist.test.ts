import assert from "node:assert/strict";
import {
  cloudHasAllOffices,
  normalizeOfficeSettings,
  pickOfficeSettingsSource,
} from "../../src/lib/office-settings";

// Mock offices only.
const loc = (id: string, nickname: string, name = "") => ({ id, name, nickname, addr1: "1 Test St", doctorIds: [] });
const logo = "data:image/png;base64," + "A".repeat(200_000);

// 1. Offices added in Settings have only a nickname. They must survive a reload.
const loaded = normalizeOfficeSettings({
  officeName: "Test Clinic",
  multiLocation: true,
  locations: [loc("loc-a", "North"), loc("loc-b", "South"), loc("loc-c", "East")],
});
assert.equal(loaded.locations.length, 3, "nickname-only offices are kept");
assert.equal(loaded.locations[1].name, "South", "name falls back to nickname");
assert.equal(normalizeOfficeSettings({ locations: [{ name: "x" }] }).locations.length, 0, "rows without id still dropped");

// 2. Newer savedAt wins, regardless of size (a stale copy with a logo is bigger).
const staleBig = { logoDataUrl: logo, locations: [loc("loc-a", "North")], savedAt: 1000 };
const freshSmall = { locations: [loc("loc-a", "North"), loc("loc-b", "South")], savedAt: 2000 };
assert.equal(pickOfficeSettingsSource(staleBig, freshSmall), "cloud", "stale bigger local must not win");
assert.equal(pickOfficeSettingsSource(freshSmall, staleBig), "local", "newer local wins and is re-saved");
// A deletion (fewer offices) on another device still wins when newer.
const deleted = { locations: [loc("loc-a", "North")], savedAt: 3000 };
assert.equal(pickOfficeSettingsSource(freshSmall, deleted), "cloud", "newer deletion wins");

// 3. Legacy copies (no savedAt): the logo can't decide; offices missing from cloud keep local.
const legacyLocal3 = { locations: [loc("loc-a", "North"), loc("loc-b", "South"), loc("loc-c", "East")] };
const legacyCloud1Logo = { logoDataUrl: logo, locations: [loc("loc-z", "Main")] };
assert.equal(pickOfficeSettingsSource(legacyLocal3, legacyCloud1Logo), "local");
assert.equal(pickOfficeSettingsSource({ logoDataUrl: logo, locations: [loc("loc-a", "North")] }, legacyLocal3), "cloud", "logo size doesn't win");
assert.equal(pickOfficeSettingsSource({ locations: [], savedAt: 5 }, legacyCloud1Logo), "local", "new-code edit beats legacy cloud");
assert.equal(pickOfficeSettingsSource(null, legacyCloud1Logo), "cloud");

// 4. Save confirmation checks office ids, not just the count.
assert.equal(cloudHasAllOffices(loaded, legacyLocal3), true);
assert.equal(cloudHasAllOffices(loaded, { locations: [loc("loc-a", "N"), loc("loc-x", "X"), loc("loc-y", "Y")] }), false, "same count, different offices = not saved");

console.log("office-settings-persist: ok");
