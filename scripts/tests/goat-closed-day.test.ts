/**
 * Plain-language closed days: parse only. No cloud, no texts.
 * Run: npx tsx scripts/tests/goat-closed-day.test.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { ClosedDayCard } from "../../src/components/goat-text-cards";
import { closedDayLabel, closedDayMessage, closedDayRequest, resolveClosedDate } from "../../src/lib/goat-closed-day";
import { expandTokens } from "../../src/lib/sms-render";
import { splitPatientName } from "../../src/lib/reminder-automation";

const TODAY = "2026-11-17"; // Tuesday. Thursday the 19th is Nov 19.

let pass = 0;
let fail = 0;
const check = (name: string, fn: () => void) => {
  try {
    fn();
    pass++;
  } catch (err) {
    fail++;
    console.log(`FAIL ${name}: ${(err as Error).message.split("\n")[0]}`);
  }
};

check("Thursday the 19th is Nov 19", () => {
  assert.equal(resolveClosedDate("we will be closed Thursday the 19th", TODAY), "2026-11-19");
});
check("the 19th with no weekday is the next 19th", () => {
  assert.equal(resolveClosedDate("close on the 19th", TODAY), "2026-11-19");
});
check("Thursday alone is the coming Thursday", () => {
  assert.equal(resolveClosedDate("we will be closed Thursday", TODAY), "2026-11-19");
});
check("November 19 and 11/19", () => {
  assert.equal(resolveClosedDate("closed November 19", TODAY), "2026-11-19");
  assert.equal(resolveClosedDate("closed 11/19", TODAY), "2026-11-19");
});
check("a past day-of-month rolls to next month", () => {
  assert.equal(resolveClosedDate("we will be closed on the 10th", TODAY), "2026-12-10");
});

check("closure statement, no text", () => {
  const r = closedDayRequest("we will be closed Thursday the 19th", TODAY);
  assert.deepEqual(r, { iso: "2026-11-19", broadcast: false });
});
check("we'll be closed on Thursday", () => {
  assert.deepEqual(closedDayRequest("we'll be closed on Thursday", TODAY), { iso: "2026-11-19", broadcast: false });
});
check("close and tell active patients", () => {
  const r = closedDayRequest(
    "We're going to close on the 19th, send all active patients a message that we will be closed on that day.",
    TODAY,
  );
  assert.deepEqual(r, { iso: "2026-11-19", broadcast: true });
});
check("send-first still closes when it says will be closed", () => {
  const r = closedDayRequest("send all active patients a message that we will be closed on the 19th", TODAY);
  assert.deepEqual(r, { iso: "2026-11-19", broadcast: true });
});
check("existing text shortcut does not change Key Dates", () => {
  assert.equal(closedDayRequest("text all active patients that we're closed Friday", TODAY), null);
  assert.equal(closedDayRequest('text everyone "we\'re closed tomorrow"', TODAY), null);
});
check("questions stay questions", () => {
  for (const q of [
    "what does Closed do to reminders",
    "how do I mark a day closed",
    "why is the office closed Thursday",
    "I marked the 29th closed but they still got texts",
  ]) assert.equal(closedDayRequest(q, TODAY), null, q);
});
check("no date, no guess", () => {
  assert.equal(closedDayRequest("we will be closed", TODAY), null);
});

check("default text uses the office name and the day", () => {
  const msg = closedDayMessage("Prime Spine & Wellness", "2026-11-19");
  assert.equal(
    msg,
    "Hi {first name}, Prime Spine & Wellness will be closed Thursday, Nov 19. We'll be back on our regular schedule after that. Reply STOP to opt out.",
  );
  assert.equal(closedDayLabel("2026-11-19"), "Thursday, Nov 19");
  const { firstName, lastName } = splitPatientName("Sample, Ann");
  assert.equal(
    expandTokens(msg, { patient: { firstName, lastName, fullName: "Sample, Ann" } }),
    "Hi Ann, Prime Spine & Wellness will be closed Thursday, Nov 19. We'll be back on our regular schedule after that. Reply STOP to opt out.",
  );
});
check("blank office name is not a hardcoded clinic", () => {
  assert.match(closedDayMessage("  ", "2026-11-19"), /^Hi \{first name\}, Our office will be closed/);
});

check("confirm card names the day and waits", () => {
  const html = renderToStaticMarkup(
    ClosedDayCard({
      d: { iso: "2026-11-19", label: "Thursday, Nov 19", reason: "Office closed", state: "open" },
      onConfirm: () => undefined,
      onCancel: () => undefined,
    }),
  );
  assert.match(html, /Thursday, Nov 19/);
  assert.match(html, />Confirm</);
  assert.equal(html.includes("bg-blue"), false);
  assert.equal(html.includes("#eef8fb"), false);
  assert.equal(html.includes("#72bdcf"), false);
});

const popup = readFileSync("src/components/global-goat.tsx", "utf8");
check("the popup button says Send", () => {
  assert.match(popup, />\s*Send\s*</);
  assert.doesNotMatch(popup, />\s*Ask\s*</);
});
check("a stuck lookup cannot swallow the next message", () => {
  assert.doesNotMatch(popup, /if \(!question \|\| job \|\| practiceBusy\) return/);
  assert.match(popup, /jobRef\.current = null/);
});

console.log(`goat-closed-day: ${pass}/${pass + fail} passed`);
if (fail) process.exit(1);
