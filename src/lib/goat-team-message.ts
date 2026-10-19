/**
 * Plain-language team messages (NoteGoat Messages, not SMS):
 *   "message Hannah about John Smith", "tell hannah john smith's MRI is in",
 *   "text hannah can you call Mock Law", "let the team know the fax is down".
 * parseTeamMessage only reads the words; the chat then resolves the team member
 * (asks when several / none), ALWAYS confirms the patient case when one is named,
 * asks for the text when missing, and shows the usual confirm card.
 */
import { joinDrTitle } from "@/lib/goat-message";

export const TEAM = "team" as const;
export interface TeamMessageRequest {
  /** A team member's name as typed ("hannah", "Dr. Abi") or "team" (General). */
  to: string;
  /** The message itself; "" = ask "What should I tell …?". */
  text: string;
  /** "about / re / for <name>" when given. */
  patientName: string | null;
}

const LEAD = /^\s*(?:(?:hey|ok|okay)\s+)?(?:goat[,:]?\s+)?(?:please\s+|pls\s+|plz\s+|can you\s+|could you\s+|would you\s+)?/i;
const TEAM_WORDS = "the\\s+(?:whole\\s+)?(?:team|office|staff|front\\s+desk\\s+team)|(?:the\\s+)?team|everyone|everybody|all|the\\s+group|general";
const WHO = `(${TEAM_WORDS}|dr-[A-Za-z][A-Za-z'-]*|[A-Za-z][A-Za-z'-]*)`;
const NOT_A_PERSON = /^(me|us|them|him|her|it|this|that|the|a|an|my|patient|pt|client|attorney|atty|lawyer)$/i;

const FORMS: RegExp[] = [
  // "send a message to hannah saying …", "send hannah a message: …", "post to the team: …"
  new RegExp(`^(?:send|write|drop|shoot|post)\\s+(?:a\\s+|an\\s+)?(?:quick\\s+)?(?:team\\s+)?(?:message|msg|note|text|chat)\\s+to\\s+${WHO}\\b\\s*(?:saying|that says|that|telling (?:her|him|them)|asking|:|,|-)?\\s*([\\s\\S]*)$`, "i"),
  new RegExp(`^(?:send|shoot|drop)\\s+${WHO}\\s+(?:a\\s+|an\\s+)?(?:quick\\s+)?(?:message|msg|note|text)\\b\\s*(?:saying|that says|that|asking|:|,|-)?\\s*([\\s\\S]*)$`, "i"),
  new RegExp(`^post\\s+(?:in|to)\\s+(general|${TEAM_WORDS})\\b\\s*(?:saying|that|:|,|-)?\\s*([\\s\\S]*)$`, "i"),
  // "let hannah know (that) …"
  new RegExp(`^let\\s+${WHO}\\s+know\\b\\s*(?:that\\s+)?([\\s\\S]*)$`, "i"),
  // "ask hannah to/if/about …" (keeps "to …" as the message)
  new RegExp(`^ask\\s+${WHO}\\s+((?:to|if|whether|about|for)\\b[\\s\\S]*)$`, "i"),
  // "message/tell/text/msg/ping/remind/chat hannah (that) …"
  new RegExp(`^(?:message|msg|messege|mesage|tell|text|txt|ping|remind|chat|dm|notify|alert)\\s+(?:to\\s+)?${WHO}\\b[,:]?\\s*(?:know\\s+)?(?:that\\s+)?([\\s\\S]*)$`, "i"),
];

/** Null = not a team message. */
export function parseTeamMessage(raw: string): TeamMessageRequest | null {
  const q0 = raw.replace(/\s+/g, " ").trim();
  if (!q0 || q0.startsWith("/") || q0.startsWith("@")) return null;
  if (/^remind\s+me\b/i.test(q0.replace(LEAD, ""))) return null;
  const q = joinDrTitle(q0.replace(LEAD, ""));
  for (const re of FORMS) {
    const m = re.exec(q);
    if (!m) continue;
    let who = m[1].trim();
    if (NOT_A_PERSON.test(who)) return null;
    const toTeam = new RegExp(`^(?:${TEAM_WORDS})$`, "i").test(who);
    who = toTeam ? TEAM : who.replace(/^dr-/i, "Dr. ");
    let text = (m[2] ?? "").trim().replace(/^[,:\-–—]\s*/, "");
    let patientName: string | null = null;
    // "about John Smith: MRI is in" / "about John Smith" (no message yet)
    const lead = /^(?:about|re:?|regarding|for|on)\s+([A-Za-z][A-Za-z'’-]*(?:\s+[A-Za-z][A-Za-z'’-]*)?)(?:'s|’s)?\s*(?:[:,\-–—]\s*([\s\S]*)|$)/i.exec(text);
    if (lead && !/^(?:the|a|an|her|his|their|my|our|this|that|it|tomorrow|today|friday|monday|tuesday|wednesday|thursday)$/i.test(lead[1].split(" ")[0])) {
      patientName = lead[1].trim();
      text = (lead[2] ?? "").trim();
    } else {
      const tail = /\b(?:for|about|re:?|regarding)\s+([A-Za-z][A-Za-z'’-]*(?:\s+[A-Za-z][A-Za-z'’-]*)?)\s*[.?!]*$/i.exec(text);
      if (tail && !/^(?:the|a|an|her|his|their|it|this|that|today|tomorrow|now|asap)$/i.test(tail[1].split(" ")[0])) patientName = tail[1].replace(/(?:'s|’s)$/i, "").replace(/\s+(today|tomorrow|asap|please|pls|now)$/i, "").trim();
    }
    // "ask/remind hannah to call kara back" → "Can you call kara back?"
    const ask = /^to\s+([\s\S]+?)[.?!]*$/i.exec(text);
    if (ask) text = `Can you ${ask[1]}?`;
    // Nothing left but filler → no message yet.
    if (/^(?:something|a message|this|that|real quick|quick)?[.?!]*$/i.test(text)) text = "";
    return { to: who, text, patientName };
  }
  return null;
}

export const isTeamMessage = (raw: string) => Boolean(parseTeamMessage(raw));

/** The case question G.O.A.T. always asks before linking: "About Smith, John (Active)?". */
export function caseQuestion(candidates: Array<{ label: string }>): string {
  if (candidates.length === 1) return `About ${candidates[0].label}?`;
  return "Which case is this about?";
}
