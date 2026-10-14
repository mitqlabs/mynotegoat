/**
 * @mentions in the G.O.A.T. input (pure, mock-testable).
 *  - "@" opens the team roster picker (same rules as the Messages composer).
 *  - "@Leilani <text>", "@Dr. Abi <text>", "@abi <text>" = "tell Leilani <text>".
 *  - "@Hannah @Greg <text>" = one confirm card to both.
 */
import { matchRecipient, type TeamPerson } from "@/lib/goat-message";

/** The active @token up to the caret, like the Messages composer ("@Dr. A" keeps the title). */
export function mentionQueryAt(value: string, caret: number): { at: number; query: string } | null {
  const m = value.slice(0, caret).match(/(?:^|\s)@((?:dr\.?\s?)?[\w.'-]*)$/i);
  return m ? { at: caret - m[1].length - 1, query: m[1] } : null;
}

/** Roster rows for a picker query (label or email contains it; "dr. a" also matches doctors by first name). */
export function filterMentionPeople<T extends { userId: string; label: string; email: string }>(people: T[], query: string, selfId: string | null): T[] {
  const q = query.toLowerCase().trim();
  const bare = q.replace(/^dr\.?\s*/, "");
  return people
    .filter((p) => p.userId !== selfId)
    .filter((p) => !q || p.label.toLowerCase().includes(q) || p.email.toLowerCase().includes(q) || (bare && p.label.toLowerCase().replace(/^dr\.?\s*/, "").split(/\s+/).some((w) => w.startsWith(bare))));
}

/** What a picked person inserts: "@Leilani Duque " (the roster label). */
export function mentionInsert(label: string): string {
  return `@${label} `;
}

export interface MentionCommand {
  recipients: TeamPerson[];
  /** Names after @ that matched nobody. */
  unknown: string[];
  text: string;
}

/**
 * Leading @mentions → recipients + the message text. Each mention may be
 * "@Dr. Abi", "@abi", "@Leilani Duque" (full roster label) or "@leilani".
 * Null when the input doesn't start with @.
 */
export function parseMentions(input: string, team: TeamPerson[]): MentionCommand | null {
  let rest = input.trim();
  if (!rest.startsWith("@")) return null;
  const recipients: TeamPerson[] = [];
  const unknown: string[] = [];
  const labels = [...new Set(team.map((p) => p.label))].sort((a, b) => b.length - a.length);
  while (rest.startsWith("@")) {
    rest = rest.slice(1);
    // A full roster label first ("Leilani Duque", "Dr. Abi Mitchell").
    const full = labels.find((l) => rest.toLowerCase().startsWith(l.toLowerCase()) && /^($|[\s,:;.!?-])/.test(rest.slice(l.length)));
    let hit: TeamPerson[] = [];
    let used = 0;
    if (full) {
      hit = team.filter((p) => p.label === full).slice(0, 1);
      used = full.length;
    } else {
      const m = /^((?:dr\.?\s*)?[A-Za-z][A-Za-z'-]*)(?:\s+([A-Za-z][A-Za-z'-]*))?/i.exec(rest);
      if (!m) break;
      // "@abi mitchell" (first + last) before "@abi".
      if (m[2]) {
        const two = matchRecipient(`${m[1]} ${m[2]}`, team).filter((p) => (p.lastName ?? "").toLowerCase() === m[2].toLowerCase());
        if (two.length) {
          hit = two.slice(0, 1);
          used = m[0].length;
        }
      }
      if (!hit.length) {
        hit = matchRecipient(m[1], team).slice(0, 1);
        used = m[1].length;
        if (!hit.length) unknown.push(m[1].replace(/^dr\.?\s*/i, "Dr. "));
      }
    }
    for (const h of hit) if (!recipients.some((r) => r.label === h.label)) recipients.push(h);
    rest = rest.slice(used).replace(/^[\s,:;-]+/, "");
    rest = rest.replace(/^(?:and|&)\s+(?=@)/i, "");
  }
  return { recipients, unknown, text: rest.trim() };
}
