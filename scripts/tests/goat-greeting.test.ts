/**
 * GOAT Page greeting and date line. Local clock, exact month words.
 * Run: npx tsx scripts/tests/goat-greeting.test.ts
 */
import assert from "node:assert/strict";
import { GOAT_MONTHS, goatGreeting, goatGreetingDate } from "../../src/lib/goat-greeting";

assert.deepEqual(
  [...GOAT_MONTHS],
  ["Jan.", "Feb.", "Mar.", "Apr.", "May", "June", "July", "Aug.", "Sep.", "Oct.", "Nov.", "Dec."],
);
assert.equal(goatGreeting(0), "Good Morning");
assert.equal(goatGreeting(11), "Good Morning");
assert.equal(goatGreeting(12), "Good Afternoon");
assert.equal(goatGreeting(16), "Good Afternoon");
assert.equal(goatGreeting(17), "Good Evening");
assert.equal(goatGreeting(23), "Good Evening");

const weekdays = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
for (let month = 0; month < 12; month++) {
  const date = new Date(2026, month, 5, 10, 0, 0);
  assert.equal(
    goatGreetingDate(date),
    `${weekdays[date.getDay()]}, ${GOAT_MONTHS[month]} 5, 2026`,
    GOAT_MONTHS[month],
  );
}
assert.equal(goatGreetingDate(new Date(2026, 10, 11)), "Wednesday, Nov. 11, 2026");
assert.equal(goatGreetingDate(new Date(2026, 5, 5)), "Friday, June 5, 2026");
assert.equal(goatGreeting(new Date(2026, 5, 5, 11, 59).getHours()), "Good Morning");
assert.equal(goatGreeting(new Date(2026, 5, 5, 12, 0).getHours()), "Good Afternoon");
assert.equal(goatGreeting(new Date(2026, 5, 5, 16, 59).getHours()), "Good Afternoon");
assert.equal(goatGreeting(new Date(2026, 5, 5, 17, 0).getHours()), "Good Evening");

console.log("goat-greeting ok");
