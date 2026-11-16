/**
 * Blocking script for the root layout. It runs the same theme math as the
 * app, from the workspace-settings cache, before the first paint.
 * Server-only: it reads the math file off disk.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { MY_VARS } from "@/lib/brand";

const math = readFileSync(join(process.cwd(), "src/lib/brand-math.js"), "utf8").replace(/^export /gm, "");

const apply = `
try {
  var raw = null;
  try { raw = JSON.parse(localStorage.getItem("casemate.brand.v1") || "null"); } catch (e) { raw = null; }
  var userId = null;
  try {
    for (var i = 0; i < localStorage.length; i++) {
      var key = localStorage.key(i);
      if (!key || key.indexOf("-auth-token") < 0) continue;
      var session = JSON.parse(localStorage.getItem(key) || "null");
      var id = session && session.user && session.user.id;
      if (typeof id === "string" && id) { userId = id; break; }
    }
  } catch (e2) {}
  var settings = brandFrom(raw);
  var mode = modeOf(settings, userId, "light");
  var look = lookOf(settings, mode);
  var root = document.documentElement;
  root.setAttribute("data-brand", look.id);
  root.setAttribute("data-tone", look.dark ? "dark" : "light");
  var stale = ${JSON.stringify(MY_VARS)};
  for (var s = 0; s < stale.length; s++) root.style.removeProperty(stale[s]);
  var vars = look.vars || {};
  for (var name in vars) if (Object.prototype.hasOwnProperty.call(vars, name)) root.style.setProperty(name, vars[name]);
} catch (err) {
  var fallback = document.documentElement;
  fallback.setAttribute("data-brand", "blue");
  fallback.setAttribute("data-tone", "light");
}
`;

export const BRAND_BOOT_SCRIPT = `(function(){\n${math}\n${apply}\n})();`;
