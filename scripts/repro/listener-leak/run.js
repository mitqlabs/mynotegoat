const { chromium } = require("playwright");
(async () => {
  const b = await chromium.launch(); const p = await b.newPage(); p.on("pageerror", (e) => console.log("ERR", e.message)); p.on("console", (m) => console.log("LOG", m.text()));
  await p.addInitScript(() => { const c = (window.__c = {}); const o = EventTarget.prototype.addEventListener, r = EventTarget.prototype.removeEventListener;
    EventTarget.prototype.addEventListener = function (t, f, x) { if (this === document) c[t] = (c[t] || 0) + 1; return o.call(this, t, f, x); };
    EventTarget.prototype.removeEventListener = function (t, f, x) { if (this === document) c[t] = (c[t] || 0) - 1; return r.call(this, t, f, x); }; });
  await p.goto("file://" + __dirname + "/index.html");
  await p.waitForTimeout(500);
  const idle = await p.evaluate(() => ({ ...window.__c }));
  await p.click("button[aria-haspopup=menu]"); const open = await p.evaluate(() => ({ ...window.__c }));
  await p.mouse.click(5, 5); await p.waitForTimeout(100); const closed = await p.evaluate(() => ({ ...window.__c }));
  console.log(JSON.stringify({ rows: 400, idle: idle.mousedown || 0, idleKeydown: idle.keydown || 0, whileOpen: open.mousedown || 0, afterClose: closed.mousedown || 0, menusOpen: await p.locator("[role=menu]").count() }));
  await b.close();
})();
