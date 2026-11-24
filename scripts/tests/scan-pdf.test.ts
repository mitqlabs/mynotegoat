/** Mock data only.  Run:  npx tsx scripts/tests/scan-pdf.test.ts */
import assert from "node:assert/strict";
import { buildScanPdf, defaultScanName, enhanceDocument, isIphoneCamera, moveItem, pickCamera, reconcileCamera, sameCameras, scanFileName } from "../../src/lib/scan-pdf";

const d = new Date(2026, 9, 5);
assert.equal(defaultScanName(d), "Scan 10-05-2026");
assert.equal(scanFileName("", d), "Scan 10-05-2026.pdf");
assert.equal(scanFileName("  MRI Report ", d), "MRI Report.pdf");
assert.equal(scanFileName("MRI/Report.PDF", d), "MRI Report.pdf");

const cams = [
  { deviceId: "a", label: "FaceTime HD Camera" },
  { deviceId: "b", label: "Jane's iPhone Camera" },
];
assert.ok(isIphoneCamera("iPhone Camera"));
assert.equal(pickCamera(cams), "b", "prefers iPhone");
assert.equal(pickCamera(cams, "a"), "a", "remembers last");
assert.equal(pickCamera(cams, "gone"), "b", "last unplugged → iPhone");
assert.equal(pickCamera([]), null);

assert.deepEqual(moveItem([1, 2, 3], 0, 2), [2, 3, 1]);
assert.deepEqual(moveItem([1, 2, 3], 2, 5), [1, 2, 3]);

const px = new Uint8ClampedArray([100, 100, 100, 255, 200, 200, 200, 255]);
enhanceDocument(px);
assert.equal(px[0], 0);
assert.equal(px[4], 255);

const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xd9]);
const pdf = new TextDecoder("latin1").decode(buildScanPdf([{ jpeg, width: 400, height: 300 }, { jpeg, width: 300, height: 400 }]));
assert.ok(pdf.startsWith("%PDF-1.4"));
assert.match(pdf, /\/Count 2/);
assert.match(pdf, /MediaBox \[0 0 792 612\]/, "landscape page");
assert.match(pdf, /MediaBox \[0 0 612 792\]/, "portrait page");
const xref = Number(pdf.match(/startxref\n(\d+)/)![1]);
assert.equal(pdf.slice(xref, xref + 4), "xref");
assert.throws(() => buildScanPdf([]));
{
  const mac = { deviceId: "mac", label: "FaceTime HD Camera" };
  const usb = { deviceId: "usb", label: "USB Cam" };
  const phone = { deviceId: "ph", label: "Dr. Mock's iPhone Camera" };
  // iPhone newly appears -> auto-switch
  assert.equal(reconcileCamera([mac], [mac, phone], "mac", false), "ph");
  // ...unless user picked by hand
  assert.equal(reconcileCamera([mac], [mac, phone], "mac", true), "mac");
  // iPhone already listed -> keep current
  assert.equal(reconcileCamera([mac, phone], [mac, phone, usb], "mac", false), "mac");
  // current unplugged -> pickCamera fallback (last used, then iPhone, then first)
  assert.equal(reconcileCamera([mac, usb], [mac], "usb", true), "mac");
  assert.equal(reconcileCamera([usb, mac, phone], [mac, phone], "usb", true, "mac"), "mac");
  assert.equal(reconcileCamera([usb], [mac, phone], "usb", true), "ph");
  assert.equal(reconcileCamera([mac], [], "mac", false), null);
  assert.equal(reconcileCamera([], [mac], null, false), "mac");
  assert.ok(sameCameras([mac, phone], [{ ...mac }, { ...phone }]));
  assert.ok(!sameCameras([mac], [mac, phone]));
  assert.ok(!sameCameras([mac, phone], [phone, mac]));
}
console.log("scan-pdf: ok");
