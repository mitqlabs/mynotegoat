import assert from "node:assert/strict";
import {
  desktopOwns,
  desktopStatus,
  looksLikePdf,
  PHONE_SCAN_PICKUP_MS,
  PHONE_SCAN_TTL_MS,
  phoneCanUpload,
  phoneScanLabel,
  phoneScanPath,
  phoneView,
  type PhoneScanRow,
} from "../../src/lib/phone-scan";
import { hashScanToken, isScanTokenShape, newScanToken } from "../../src/lib/phone-scan-server";

const now = Date.parse("2026-10-21T20:00:00Z");
const row = (p: Partial<PhoneScanRow> = {}): PhoneScanRow => ({
  status: "waiting",
  expires_at: new Date(now + PHONE_SCAN_TTL_MS).toISOString(),
  created_by: "user-a",
  workspace_id: "owner-a:office-1",
  ...p,
});

// Tokens: unguessable, well-formed, hash is stable and not the token.
const tokens = new Set(Array.from({ length: 200 }, () => newScanToken()));
assert.equal(tokens.size, 200);
for (const t of tokens) assert.ok(isScanTokenShape(t));
const t = newScanToken();
assert.equal(hashScanToken(t), hashScanToken(t));
assert.notEqual(hashScanToken(t), t);
assert.ok(!hashScanToken(t).includes(t));
for (const bad of ["", "abc", `${t}x`, `${t.slice(0, 42)}!`, null, 42, "../../etc/passwd"]) assert.equal(isScanTokenShape(bad), false);

// TTL is ~10 minutes.
assert.equal(PHONE_SCAN_TTL_MS, 600_000);

// Phone may upload only while waiting and unexpired (single use).
assert.equal(phoneCanUpload(row(), now), true);
assert.equal(phoneCanUpload(row(), now + PHONE_SCAN_TTL_MS + 1), false);
for (const status of ["uploaded", "saved", "revoked"] as const) assert.equal(phoneCanUpload(row({ status }), now), false);

// Phone view: unknown / expired / revoked all look the same.
assert.equal(phoneView(null, now), "inactive");
assert.equal(phoneView(row(), now), "ready");
assert.equal(phoneView(row({ status: "uploaded" }), now), "sent");
assert.equal(phoneView(row({ status: "revoked" }), now), "inactive");
assert.equal(phoneView(row(), now + PHONE_SCAN_TTL_MS), "inactive");
assert.equal(phoneView(row({ status: "saved" }), now + PHONE_SCAN_TTL_MS + 5), "inactive");

// Only the creator, in the same office, sees/collects it.
assert.equal(desktopOwns(row(), "user-a", "owner-a:office-1"), true);
assert.equal(desktopOwns(row(), "user-b", "owner-a:office-1"), false);
assert.equal(desktopOwns(row(), "user-a", "owner-a:office-2"), false);
assert.equal(desktopOwns(row(), "", "owner-a:office-1"), false);

// Desktop status with timeouts.
assert.equal(desktopStatus(row(), now), "waiting");
assert.equal(desktopStatus(row(), now + PHONE_SCAN_TTL_MS), "expired");
const up = row({ status: "uploaded", uploaded_at: new Date(now).toISOString() });
assert.equal(desktopStatus(up, now + 1000), "uploaded");
assert.equal(desktopStatus(up, now + PHONE_SCAN_PICKUP_MS + 1), "expired");
assert.equal(desktopStatus(row({ status: "saved" }), now), "saved");

// Upload check: must be a PDF of sane size.
const pdfHead = new TextEncoder().encode("%PDF-1.4");
assert.equal(looksLikePdf(pdfHead, 5000), true);
assert.equal(looksLikePdf(new TextEncoder().encode("<html>.."), 5000), false);
assert.equal(looksLikePdf(pdfHead, 10), false);
assert.equal(looksLikePdf(pdfHead, 500 * 1024 * 1024), false);

// Paths carry no user or patient info; labels are cleaned.
assert.equal(phoneScanPath("1234"), "phone-scan/1234.pdf");
assert.equal(phoneScanLabel("<script>Case 1</script>"), "scriptCase 1/script");
assert.equal(phoneScanLabel(5), "");
assert.ok(phoneScanLabel("x".repeat(200)).length <= 60);

console.log("phone-scan tests passed");
