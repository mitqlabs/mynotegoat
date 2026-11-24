/**
 * Activity Log "Person" filter. The list used to be built only from people who had entries in the selected
 * period, so a team member with no recent activity (or none yet) could not be picked. Now it is the whole team
 * roster plus anyone who appears in the log, and picking a person also matches entries ABOUT them
 * ("Hannah Mitchell: changed main location"), not only entries they performed.
 */
import type { ActivityEntry } from "@/lib/activity-log";

export interface RosterPerson {
  userId: string;
  label: string;
  email: string;
}

export interface PersonOption {
  /** Stable key: the user id for roster people, else "actor:<email or label>". */
  key: string;
  label: string;
  email: string;
}

const norm = (v: string) => v.trim().toLowerCase();

export function buildPersonOptions(entries: ActivityEntry[], roster: RosterPerson[]): PersonOption[] {
  const options: PersonOption[] = [];
  const byUserId = new Set<string>();
  const byEmail = new Set<string>();
  for (const p of roster) {
    if (!p.userId || byUserId.has(p.userId)) continue;
    byUserId.add(p.userId);
    const email = p.email.includes("@") ? norm(p.email) : "";
    if (email) byEmail.add(email);
    options.push({ key: p.userId, label: p.label.trim() || email || "Team Member", email });
  }
  // People in the log who are not on the roster (removed members, older entries).
  for (const e of entries) {
    if (e.actorUserId && byUserId.has(e.actorUserId)) continue;
    const email = norm(e.actorEmail);
    if (email && byEmail.has(email)) continue;
    const key = `actor:${email || norm(e.actorLabel)}`;
    if (options.some((o) => o.key === key)) continue;
    options.push({ key, label: e.actorLabel, email });
  }
  return options.sort((a, b) => a.label.localeCompare(b.label));
}

/** True when the entry was done BY the person, or is ABOUT them (their name appears in the summary). */
export function entryMatchesPerson(entry: ActivityEntry, person: PersonOption): boolean {
  if (person.key.startsWith("actor:")) {
    if (entry.actorLabel === person.label) return true;
  } else if (entry.actorUserId === person.key) {
    return true;
  }
  if (person.email && norm(entry.actorEmail) === person.email) return true;
  const name = norm(person.label);
  if (name.length >= 3 && norm(entry.summary).includes(name)) return true;
  if (person.email && norm(entry.summary).includes(person.email)) return true;
  return false;
}
