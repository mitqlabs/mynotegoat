/**
 * G.O.A.T. home-screen app (/goat PWA): manifest, icons, iOS tags, install tip,
 * ?q= prefill, login return path. Fictional data only.
 * Run: npx tsx scripts/tests/goat-eval/goat-app.test.ts
 */
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { GOAT_INSTALL_TIP_KEY, goatQueryPrefill, installTipKind, isGoatAppPath, safeNextPath } from "../../../src/lib/goat-app";
import { CLOUD_KEY_REGISTRY } from "../../../src/lib/cloud-key-registry";

let pass = 0, fail = 0;
const check = (name: string, fn: () => void) => { try { fn(); pass++; } catch (e) { fail++; console.log(`FAIL ${name}: ${(e as Error).message.split("\n")[0]}`); } };
const read = (f: string) => readFileSync(f, "utf8");

const IPHONE_SAFARI = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1";
const IPHONE_CHROME = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/129.0 Mobile/15E148 Safari/604.1";
const IPAD_DESKTOP_UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15";
const ANDROID_CHROME = "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Mobile Safari/537.36";
const MAC_SAFARI = IPAD_DESKTOP_UA;

// ── Install tip ──
check("iPhone Safari → iOS tip", () => assert.equal(installTipKind({ ua: IPHONE_SAFARI, standalone: false, hasPrompt: false, dismissed: false }), "ios"));
check("iPhone already installed → none", () => assert.equal(installTipKind({ ua: IPHONE_SAFARI, standalone: true, hasPrompt: false, dismissed: false }), null));
check("iPhone dismissed → none", () => assert.equal(installTipKind({ ua: IPHONE_SAFARI, standalone: false, hasPrompt: false, dismissed: true }), null));
check("iPhone Chrome → none (Safari only)", () => assert.equal(installTipKind({ ua: IPHONE_CHROME, standalone: false, hasPrompt: false, dismissed: false }), null));
check("iPadOS (desktop UA + touch) → iOS tip", () => assert.equal(installTipKind({ ua: IPAD_DESKTOP_UA, standalone: false, hasPrompt: false, dismissed: false, maxTouchPoints: 5 }), "ios"));
check("Mac Safari → none", () => assert.equal(installTipKind({ ua: MAC_SAFARI, standalone: false, hasPrompt: false, dismissed: false, maxTouchPoints: 0 }), null));
check("Android with beforeinstallprompt → Install button", () => assert.equal(installTipKind({ ua: ANDROID_CHROME, standalone: false, hasPrompt: true, dismissed: false }), "android"));
check("Android without the event → none", () => assert.equal(installTipKind({ ua: ANDROID_CHROME, standalone: false, hasPrompt: false, dismissed: false }), null));
check("dismissal is cloud-backed (user key)", () => assert.equal((CLOUD_KEY_REGISTRY as Record<string, string>)[GOAT_INSTALL_TIP_KEY], "user"));

// ── Paths ──
check("isGoatAppPath", () => { assert.ok(isGoatAppPath("/goat")); assert.ok(!isGoatAppPath("/goats")); assert.ok(!isGoatAppPath("/patients")); assert.ok(!isGoatAppPath(null)); });
check("safeNextPath allows /goat", () => { assert.equal(safeNextPath("/goat"), "/goat"); assert.equal(safeNextPath("/goat?q=add%20to-do%20"), "/goat?q=add%20to-do%20"); });
for (const bad of ["https://evil.example/goat", "//evil.example", "/goat/../admin", "/admin", "/goat?x=1", "javascript:alert(1)", "", null]) check(`safeNextPath rejects ${String(bad)}`, () => assert.equal(safeNextPath(bad as string | null), null));
check("?q= prefill", () => { assert.equal(goatQueryPrefill("?q=add%20to-do%20call%20Mock%20Law"), "add to-do call Mock Law"); assert.equal(goatQueryPrefill(""), ""); assert.equal(goatQueryPrefill(`?q=${"x".repeat(900)}`).length, 500); });

// ── Manifest + icons ──
const m = JSON.parse(read("public/goat.webmanifest"));
check("manifest basics", () => { assert.equal(m.name, "G.O.A.T."); assert.equal(m.start_url, "/goat"); assert.equal(m.display, "standalone"); assert.ok(m.theme_color); assert.equal(m.scope, "/"); });
check("manifest icons 192/512 + maskable", () => {
  const sizes = m.icons.map((i: { sizes: string }) => i.sizes);
  assert.ok(sizes.includes("192x192") && sizes.includes("512x512"));
  assert.ok(m.icons.some((i: { purpose?: string }) => i.purpose === "maskable"));
  for (const i of m.icons) assert.ok(existsSync(`public${i.src}`), i.src);
});
check("manifest shortcuts", () => {
  assert.deepEqual(m.shortcuts.map((s: { name: string }) => s.name), ["Ask G.O.A.T.", "New to-do", "Schedule"]);
  for (const s of m.shortcuts) { assert.ok(s.url.startsWith("/goat")); for (const i of s.icons) assert.ok(existsSync(`public${i.src}`), i.src); }
  assert.equal(goatQueryPrefill(m.shortcuts[1].url.slice(5)), "add to-do");
  assert.equal(goatQueryPrefill(m.shortcuts[2].url.slice(5)), "/schedule");
});
check("apple-touch-icon 180 exists", () => assert.ok(existsSync("public/goat-app/apple-touch-icon.png")));
const pngSize = (f: string) => { const b = readFileSync(f); return [b.readUInt32BE(16), b.readUInt32BE(20)]; };
check("icon pixel sizes", () => { assert.deepEqual(pngSize("public/goat-app/icon-192.png"), [192, 192]); assert.deepEqual(pngSize("public/goat-app/icon-512.png"), [512, 512]); assert.deepEqual(pngSize("public/goat-app/apple-touch-icon.png"), [180, 180]); });

// ── Wiring ──
const layout = read("src/app/(portal)/goat/layout.tsx");
check("goat layout: manifest + iOS standalone tags + theme", () => { assert.match(layout, /manifest: GOAT_MANIFEST_PATH/); assert.match(layout, /appleWebApp: \{ capable: true, title: "G\.O\.A\.T\."/); assert.match(layout, /apple-touch-icon\.png/); assert.match(layout, /themeColor/); });
check("goat page renders only the popup, full screen", () => assert.match(read("src/app/(portal)/goat/page.tsx"), /<GlobalGoatPopup fullScreen \/>/));
check("app shell: no nav on /goat", () => assert.match(read("src/components/app-shell.tsx"), /if \(isGoatAppPath\(pathname\)\)/));
const goat = read("src/components/global-goat.tsx");
check("popup: install tip + beforeinstallprompt", () => { assert.ok(goat.includes('"beforeinstallprompt"')); assert.ok(goat.includes("Add G.O.A.T. to your Home Screen:")); assert.ok(goat.includes("data-goat-install")); assert.ok(goat.includes("GOAT_INSTALL_TIP_KEY")); });
check("popup: ?q= prefill and full-screen mode", () => { assert.ok(goat.includes("goatQueryPrefill(window.location.search)")); assert.ok(goat.includes("const open = popupOpen || fullScreen;")); });
check("login returns to /goat", () => { assert.match(read("src/app/(portal)/layout.tsx"), /\/auth\/login\?next=/); assert.match(read("src/app/auth/login/login-client.tsx"), /router\.replace\(next \?\? "\/patients"\)/); assert.match(read("src/app/auth/login/page.tsx"), /safeNextPath\(nextRaw\)/); });
check("handbook: home-screen app", () => { const hb = read("src/lib/handbook-goat.ts"); for (const t of ["home-screen app", "Add to Home Screen", "Install", "APK"]) assert.ok(hb.includes(t), t); });

console.log(`goat-app: ${pass}/${pass + fail} passed`);
if (fail) process.exit(1);
