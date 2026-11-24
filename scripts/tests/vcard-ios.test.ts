import assert from "node:assert/strict";
import { buildVCard, isIOSDevice, VCARD_MIME } from "../../src/lib/vcard";

assert.equal(isIOSDevice({ userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) Safari" }), true);
assert.equal(isIOSDevice({ userAgent: "Mozilla/5.0 (iPhone) CriOS/130" }), true);
assert.equal(isIOSDevice({ userAgent: "Mozilla/5.0 (Macintosh)", platform: "MacIntel", maxTouchPoints: 5 }), true);
assert.equal(isIOSDevice({ userAgent: "Mozilla/5.0 (Macintosh)", platform: "MacIntel", maxTouchPoints: 0 }), false);
assert.equal(isIOSDevice({ userAgent: "Mozilla/5.0 (Windows NT 10.0)" }), false);
assert.equal(VCARD_MIME, "text/vcard;charset=utf-8");

const v = buildVCard({ firstName: "Jane", lastName: "Doe", phone: "555-123-4567" });
assert.ok(v.startsWith("BEGIN:VCARD\r\nVERSION:3.0\r\n"), v);
assert.ok(v.endsWith("END:VCARD\r\n"));
assert.ok(!/[^\r]\n/.test(v), "CRLF only");
console.log("vcard-ios tests passed");
