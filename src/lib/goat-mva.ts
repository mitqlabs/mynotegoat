/**
 * G.O.A.T. — "was the patient the driver or passenger?" (pure, no I/O).
 *
 * Scans what the user is allowed to see (case notes, alerts, prior care, SOAP
 * notes and macro answers, specialist text, uploaded files such as intake
 * forms and reports) for how the patient was involved in the collision:
 * driver, front/rear passenger, pedestrian, bicyclist, motorcyclist, plus
 * seat belt and airbag wording. Every line quotes the sentence it came from
 * and names where it was found. Impact wording ("passenger side",
 * "driver's door") and other people ("her husband was the driver") don't count.
 */

import type { GoatAnswer, GoatContext, GoatSection } from "@/lib/goat";
import { plainText } from "@/lib/goat";

export function asksMvaRole(question: string): boolean {
  return /\b(driv(?:er|ing)|passengers?|pedestrian|seat ?-?belts?|belted|unbelted|restrained|unrestrained|front seat|back seat|rear seat|air ?bags?|bicycl\w*|cyclist|motorcycl\w*|where (?:was|were) (?:the )?(?:patient|pt|she|he|they) (?:seated|sitting))\b/i.test(question);
}

type Role = "Driver" | "Passenger" | "Pedestrian" | "Bicyclist" | "Motorcyclist";

interface Hit {
  label: string;
  quote: string;
  source: string;
  section: GoatSection;
}

interface Text {
  text: string;
  source: string;
  section: GoatSection;
}

/** Someone other than the patient right before the verb ("her husband was the driver", "the other driver"). */
const OTHER_PERSON =
  /\b(?:husband|wife|spouse|son|daughter|mother|mom|father|dad|friend|boyfriend|girlfriend|fianc[eé]e?|partner|brother|sister|cousin|aunt|uncle|grandmother|grandfather|co-?worker|coworker|boss|uber|lyft|taxi|other|another|at-?fault|opposing|third|tortfeasor|defendant)\b[^.;]{0,25}$/i;

const POSITION = "(?:(?:front|rear|back|middle|center|centre|right|left|rr|rl|fr|fl)[\\s-]*){0,3}(?:seat(?:ed)?\\s+)?";

const ROLE_PATTERNS: Array<{ role: Role; re: RegExp }> = [
  // "was the driver", "were the driver", "as the driver", "restrained driver"
  { role: "Driver", re: /\b(?:was|were|is|as|being|restrained|unrestrained|belted)\s+(?:the\s+|a\s+)?driver\b(?!['’]?s?\s+(?:side|door|window|seat\s+(?:was|got)))/gi },
  { role: "Driver", re: /\b(?:was|were)\s+driving\b|\bwhile\s+(?:she|he|they|patient|pt|the patient)\s+(?:was|were)\s+driving\b/gi },
  { role: "Driver", re: /\b(?:seated|sitting|sat)\s+(?:in\s+)?(?:the\s+)?driver['’]?s?\s+seat\b/gi },
  // Forms and macro answers: "Where were you seated? driver", "Position in vehicle: Driver", "[X] Driver", "Driver: Yes"
  { role: "Driver", re: /\b(?:seated|seat(?:ing)? position|position(?: in (?:the )?vehicle)?|driver or passenger|role)\s*\??\s*[:\-–]?\s*driver\b(?!['’]?s?\s+side)/gi },
  { role: "Driver", re: /(?:\[\s*[x✓✔]\s*\]|\(\s*[x✓✔]\s*\)|[☒☑✓✔])\s*driver\b|\bdriver\s*[:\-–]\s*(?:yes|y|x|self|patient|pt)\b/gi },
  { role: "Passenger", re: new RegExp(`\\b(?:was|were|is|as|being|restrained|unrestrained|belted)\\s+(?:the\\s+|a\\s+)?(${POSITION})passenger\\b(?!['’]?s?\\s+(?:side|door|window))`, "gi") },
  { role: "Passenger", re: new RegExp(`\\b(?:seated|sitting|sat)\\s+(?:in\\s+)?(?:the\\s+)?(${POSITION})(?:passenger\\s+seat|seat)\\b`, "gi") },
  { role: "Passenger", re: new RegExp(`\\b(?:seated|seat(?:ing)? position|position(?: in (?:the )?vehicle)?|driver or passenger|role)\\s*\\??\\s*[:\\-–]?\\s*(${POSITION})passenger\\b(?!['’]?s?\\s+side)`, "gi") },
  { role: "Passenger", re: new RegExp(`(?:\\[\\s*[x✓✔]\\s*\\]|\\(\\s*[x✓✔]\\s*\\)|[☒☑✓✔])\\s*(${POSITION})passenger\\b|\\bpassenger\\s*[:\\-–]\\s*(?:yes|y|x)\\b`, "gi") },
  { role: "Pedestrian", re: /\b(?:was|were|as)\s+(?:a\s+|the\s+)?pedestrian\b|\bpedestrian\s+(?:vs\.?|versus|struck|hit)\b|\b(?:struck|hit)\s+by\s+(?:a\s+)?(?:car|vehicle|truck|suv|van)\s+while\s+(?:walking|crossing|jogging|running)\b/gi },
  { role: "Bicyclist", re: /\b(?:was|were)\s+(?:riding|on)\s+(?:a|his|her|their)\s+(?:bicycle|bike)\b|\b(?:was|were|as)\s+(?:a\s+|the\s+)?(?:bicyclist|cyclist)\b/gi },
  { role: "Motorcyclist", re: /\b(?:was|were)\s+(?:riding|operating|on)\s+(?:a|his|her|their)\s+motorcycle\b|\b(?:was|were|as)\s+(?:a\s+|the\s+)?motorcyclist\b/gi },
];

const BELT_ON = /\b(?:wearing|wore|had on|using|used)\s+(?:a\s+|his\s+|her\s+|their\s+|the\s+)?seat\s?-?belts?\b|\b(?:was|were)\s+(?:wearing\s+)?(?:restrained|belted)\b|\brestrained\s+(?:driver|passenger)\b|\bseat\s?-?belt(?:ed)?\s*(?:use)?\s*[:\-–]\s*(?:yes|y|on|worn)\b/gi;
const BELT_OFF = /\bnot\s+(?:wearing|using)\s+(?:a\s+|his\s+|her\s+|their\s+|the\s+)?seat\s?-?belts?\b|\bunrestrained\b|\bunbelted\b|\bwithout\s+(?:a\s+)?seat\s?-?belts?\b|\bno\s+seat\s?-?belts?\b|\bseat\s?-?belt(?:ed)?\s*(?:use)?\s*[:\-–]\s*(?:no|n|none)\b/gi;
const BAG_YES = /\bair\s?bags?\s+(?:did\s+)?(?:deployed|deploy(?:ed)?\b(?!\s*[:\-–]?\s*(?:no|did not|didn't)))|\bair\s?bags?\s+(?:were|was)\s+deployed\b|\bair\s?bags?\s*[:\-–]\s*(?:yes|deployed)\b/gi;
const BAG_NO = /\bair\s?bags?\s+(?:did\s+not|didn['’]?t|were\s+not|was\s+not|not|never)\s+deploy(?:ed)?\b|\bno\s+air\s?bags?\b|\bair\s?bags?\s*[:\-–]\s*(?:no|none|did not deploy)\b/gi;

/** The sentence around a match, for quoting. */
function sentenceAt(text: string, index: number, length: number): string {
  const start = Math.max(text.lastIndexOf(".", index - 1), text.lastIndexOf("\n", index - 1), text.lastIndexOf(";", index - 1)) + 1;
  const endCandidates = [text.indexOf(".", index + length), text.indexOf("\n", index + length), text.indexOf(";", index + length)].filter((i) => i >= 0);
  const end = endCandidates.length ? Math.min(...endCandidates) + 1 : text.length;
  let s = text.slice(start, end).replace(/\s+/g, " ").trim();
  if (s.length > 220) {
    const rel = index - start;
    const from = Math.max(0, rel - 90);
    s = `${from > 0 ? "…" : ""}${s.slice(from, from + 200).trim()}…`;
  }
  return s;
}

function positionLabel(position: string | undefined): string {
  const p = (position ?? "").toLowerCase().replace(/\bseat(?:ed)?\b/g, " ").replace(/\s+/g, " ").trim();
  if (!p) return "Passenger";
  if (/front/.test(p) || p === "fr" || p === "fl") return "Front seat passenger";
  if (/rear|back|middle|center|centre/.test(p) || p === "rr" || p === "rl") {
    const side = /right|rr/.test(p) ? "right " : /left|rl/.test(p) ? "left " : /middle|center|centre/.test(p) ? "middle " : "";
    return `Rear ${side}seat passenger`;
  }
  return "Passenger";
}

function textsFrom(ctx: GoatContext): { texts: Text[]; looked: string[]; hidden: string[] } {
  const texts: Text[] = [];
  const looked: string[] = [];
  const hidden: string[] = [];
  if (ctx.notes === null) hidden.push("case notes");
  else {
    looked.push("case notes");
    if (ctx.notes.trim()) texts.push({ text: ctx.notes, source: "Case notes", section: "notes" });
  }
  for (const a of ctx.alerts) texts.push({ text: a, source: "Patient alert", section: "info" });
  if (ctx.priorCare.trim()) texts.push({ text: ctx.priorCare, source: "Prior care", section: "info" });
  if (ctx.encounters === null) hidden.push("SOAP notes");
  else {
    looked.push("SOAP notes");
    for (const e of ctx.encounters) {
      const parts: Array<[string, string]> = [
        ["S", e.soap.subjective],
        ["O", e.soap.objective],
        ["A", e.soap.assessment],
        ["P", e.soap.plan],
      ];
      for (const [letter, t] of parts) if (t?.trim()) texts.push({ text: plainText(t), source: `SOAP ${e.date} · ${letter}${e.type ? ` · ${e.type}` : ""}`, section: "appointments" });
      // Macro answers (e.g. MVC HX "Where were you seated?" → "front seat passenger").
      for (const run of e.treatments) {
        for (const ans of run.answers) {
          if (/^(?:driver|(?:front|rear|back)?[\w\s-]*passenger|pedestrian)$/i.test(ans.trim())) {
            texts.push({ text: `Seated: ${ans.trim()}`, source: `${run.name || "Macro"} answer · SOAP ${e.date}`, section: "appointments" });
          }
        }
      }
    }
  }
  for (const s of ctx.specialists) if (s.recommendations.trim()) texts.push({ text: s.recommendations, source: s.name || "Specialist", section: "specialist" });
  if (ctx.specialistRecommendations.trim()) texts.push({ text: ctx.specialistRecommendations, source: "Specialist recommendations", section: "specialist" });
  if (ctx.files === null) hidden.push("Patient Files");
  else if (ctx.files) {
    looked.push("uploaded Patient Files");
    for (const f of ctx.files) (f.pages ?? []).forEach((p, i) => texts.push({ text: p, source: `${f.name} (p. ${i + 1})`, section: "notes" }));
  }
  return { texts, looked, hidden };
}

function scan(texts: Text[], re: RegExp, label: (m: RegExpMatchArray) => string, skipOther = true): Hit[] {
  const hits: Hit[] = [];
  for (const t of texts) {
    re.lastIndex = 0;
    for (const m of t.text.matchAll(re)) {
      const at = m.index ?? 0;
      const lineStart = Math.max(t.text.lastIndexOf(".", at - 1), t.text.lastIndexOf("\n", at - 1)) + 1;
      const before = t.text.slice(lineStart, at);
      // Only the words since the last "and" / "but" / comma belong to this subject.
      const subject = before.split(/\b(?:and|but|while|whereas|although)\b|,/i).pop() ?? before;
      if (skipOther && OTHER_PERSON.test(subject)) continue;
      // "was not the driver" / "denies being the driver"
      if (/\b(?:not|never|denies|denied)\s*(?:being\s+)?$/i.test(before) || /\bnot\s+(?:the\s+)?$/i.test(before)) continue;
      const quote = sentenceAt(t.text, at, m[0].length);
      if (!hits.some((h) => h.quote === quote && h.source === t.source)) hits.push({ label: label(m), quote, source: t.source, section: t.section });
    }
  }
  return hits;
}

const cite = (h: Hit) => `“${h.quote}” — ${h.source}`;

/** The answer card, or null when the question isn't about how the patient was involved. */
export function mvaRoleAnswer(ctx: GoatContext, question: string): GoatAnswer | null {
  if (!asksMvaRole(question)) return null;
  const { texts, looked, hidden } = textsFrom(ctx);
  const roleHits: Hit[] = [];
  for (const { role, re } of ROLE_PATTERNS) {
    roleHits.push(...scan(texts, re, (m) => (role === "Passenger" ? positionLabel(m[1]) : role)));
  }
  const beltHits = [...scan(texts, BELT_OFF, () => "Not wearing a seat belt", false), ...scan(texts, BELT_ON, () => "Wearing a seat belt", false)];
  // "not wearing a seatbelt" also contains "wearing a seatbelt": keep the negative for that quote.
  const belt = beltHits.filter((h, i) => !(h.label === "Wearing a seat belt" && beltHits.slice(0, i).some((x) => x.quote === h.quote && x.source === h.source)));
  const bagHits = [...scan(texts, BAG_NO, () => "Airbags did not deploy", false), ...scan(texts, BAG_YES, () => "Airbags deployed", false)];
  const bags = bagHits.filter((h, i) => !(h.label === "Airbags deployed" && bagHits.slice(0, i).some((x) => x.quote === h.quote && x.source === h.source)));

  const lines: string[] = [];
  const labels = [...new Set(roleHits.map((h) => h.label))];
  // A specific passenger seat beats a plain "Passenger" from the same set of notes.
  const shownLabels = labels.filter((l) => !(l === "Passenger" && labels.some((x) => x.endsWith("passenger") && x !== "Passenger")));
  for (const label of shownLabels) {
    const hs = roleHits.filter((h) => h.label === label || (label.endsWith("passenger") && h.label === "Passenger"));
    lines.push(`${label}:\n${hs.slice(0, 3).map((h) => `• ${cite(h)}`).join("\n")}${hs.length > 3 ? `\n…and ${hs.length - 3} more` : ""}`);
  }
  if (!shownLabels.length) {
    lines.push(
      `I couldn't find driver / passenger wording in the ${looked.join(", ") || "notes"}.` +
        (texts.length ? "" : " There's no note text to read yet."),
    );
  }
  const beltLabels = [...new Set(belt.map((h) => h.label))];
  for (const label of beltLabels) {
    const hs = belt.filter((h) => h.label === label);
    lines.push(`${label}:\n${hs.slice(0, 2).map((h) => `• ${cite(h)}`).join("\n")}`);
  }
  if (!beltLabels.length && /belt|restrain/i.test(question)) lines.push("No seat belt wording found.");
  const bagLabels = [...new Set(bags.map((h) => h.label))];
  for (const label of bagLabels) {
    const hs = bags.filter((h) => h.label === label);
    lines.push(`${label}:\n${hs.slice(0, 2).map((h) => `• ${cite(h)}`).join("\n")}`);
  }
  if (hidden.length) lines.push(`Not checked (hidden for your account): ${hidden.join(", ")}.`);

  const roles = new Set(shownLabels.map((l) => (l.endsWith("passenger") ? "Passenger" : l)));
  const flags: string[] = [];
  if (roles.size > 1) flags.push(`The notes disagree (${[...roles].join(" vs ")}); check the sources.`);
  if (beltLabels.length > 1) flags.push("Seat belt wording disagrees between notes.");
  const first = roleHits[0] ?? belt[0];
  return {
    title: roles.size === 1 ? `Driver or passenger: ${shownLabels[0]}` : "Driver or passenger",
    lines,
    source: [...new Set([...roleHits, ...belt, ...bags].map((h) => h.source.replace(/ \(p\. \d+\)$/, "").replace(/^SOAP .*/, "SOAP notes")))].join(", ") || "Case notes, SOAP notes, Patient Files",
    section: first?.section ?? "notes",
    flag: flags.join(" ") || undefined,
  };
}
