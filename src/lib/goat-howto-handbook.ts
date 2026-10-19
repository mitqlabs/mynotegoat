/**
 * "How do I… / where is… / how to…": the built-in app answers (goat-howto) when they're
 * a direct hit, else the full Handbook search (handbook-search), else Settings / page
 * hints, else a short clarifying question.
 */
import { answerHowTo, type HowToAnswer } from "@/lib/goat-howto";
import { answerFromHandbook, searchHandbook, words, type Reader } from "@/lib/handbook-search";

export function answerHowToFull(question: string, reader: Reader): HowToAnswer {
  const how = answerHowTo(question);
  const q = new Set(words(question).map((w) => w.replace(/s$/, "")));
  const top = searchHandbook(question, reader)[0];
  const headOverlap = top ? words(top.task.heading).filter((w) => q.has(w.replace(/s$/, ""))).length : 0;
  // The built-in answer wins unless a Handbook section's title names most of what was asked.
  if (how.source === "app" && headOverlap < 2) return how;
  // A Settings page answer beats a Handbook section whose title doesn't name what was asked.
  if (how.source === "settings") {
    if (!headOverlap) return how;
  }
  const hb = answerFromHandbook(question, reader);
  if (hb.kind === "answer") return { text: hb.text, links: hb.links, found: true, source: "page" };
  if (hb.kind === "choose") return { text: hb.text, links: hb.choices, found: true, source: "page" };
  if (how.found) return how;
  return { text: hb.text, links: [{ label: "Open the Handbook", href: "/handbook" }], found: false, source: "none" };
}
