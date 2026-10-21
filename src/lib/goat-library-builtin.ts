/**
 * G.O.A.T. Library — Built in. The one data file for how G.O.A.T. maps wording
 * to actions (rules only, no cloud AI):
 *
 *  1. GOAT_ACTIONS: every action, its trigger words, required details, the one
 *     short question per missing detail, and example phrasings (the Handbook's
 *     "What you can say" list and the tests read these).
 *  2. GOAT_BUILTIN_PHRASES: reviewed exact wordings → action. These are
 *     templates (names = {patient}/{name}, days = {date}, times = {time},
 *     numbers = {n}, lowercase). Office-learned phrases (Settings → G.O.A.T.
 *     Library → Learned in your office) that someone reviewed get promoted
 *     here in a PR — see docs/goat-library-review.md. Never put a real name here.
 *
 * Order of use in understand(): learned in your office → built-in phrases →
 * trigger rules.
 */

export type ActionId =
  | "book"
  | "reschedule"
  | "cancel"
  | "checkIn"
  | "checkOut"
  | "noShow"
  | "note"
  | "todo"
  | "message"
  | "attorney"
  | "doi"
  | "status"
  | "open"
  | "schedule"
  | "todos"
  | "contact"
  | "lookup";

export type Slot = "patient" | "date" | "time" | "text" | "attorney" | "status" | "person";

export interface GoatAction {
  id: ActionId;
  /** Shown in the Handbook and on the "what did you mean?" chips. */
  label: string;
  /** Regex sources (whole words, after typo-fixing). */
  triggers: string[];
  required: Slot[];
  /** Messy example phrasings (tests run every one; the Handbook shows the first two). */
  examples: string[];
  /** One short question per missing slot. */
  ask?: Partial<Record<Slot, string>>;
}

export const GOAT_ACTIONS: GoatAction[] = [
  {
    id: "reschedule",
    label: "Reschedule a visit",
    triggers: ["re-?schedul\\w*", "resched\\w*", "move (?:his|her|their|the|my)?\\s*(?:appt|appointment|visit)", "(?:move|push|bump|shift|change|switch) \\S+(?: \\S+)?(?:'s)? (?:appt|appointment|visit|time)", "(?:push|bump|move|shift) (?:\\S+ )?(?:\\S+ )?(?:to|back|up|from)\\b", "shift", "mov (?:\\S+ )?(?:\\S+ )?(?:\\S+ )?(?:appointment|visit|to)"],
    required: ["patient", "date"],
    examples: ["reschedule john smith to friday at 10", "move jon smiths appt to tmrw 2pm", "push smith to next tuesday"],
    ask: { patient: "Whose visit should I move?", date: "Move it to when?" },
  },
  {
    id: "cancel",
    label: "Cancel a visit",
    triggers: ["cancel\\w*", "cancl\\w*", "cxl", "call off", "scratch", "delete (?:the |his |her )?(?:appt|appointment|visit)", "(?:can'?t|cannot|not|won'?t|will not) (?:make it|be coming|coming|come in|be in)", "take (?:\\S+ )?(?:\\S+ )?off (?:the )?(?:schedule|books|calendar)"],
    required: ["patient"],
    examples: ["cancel john smiths appt tmrw", "cxl smith friday", "john smith cant make it tomorrow"],
    ask: { patient: "Whose visit should I cancel?" },
  },
  {
    id: "noShow",
    label: "Mark a no-show",
    triggers: ["no[- ]?show\\w*", "didn'?t show", "never showed"],
    required: ["patient"],
    examples: ["mark john smith no show", "smith didnt show today"],
    ask: { patient: "Who didn't show?" },
  },
  {
    id: "checkIn",
    label: "Check in",
    triggers: ["check(?:ed|ing)?[- ]?in", "checkin", "check \\S+(?: \\S+)? in", "(?:is|just) (?:here|in)", "arrived", "showed up", "walked in", "(?:'s|is) here", "in the lobby", "here now", "here$"],
    required: ["patient"],
    examples: ["check in john smith", "smith is here", "jon smith arrived"],
    ask: { patient: "Who should I check in?" },
  },
  {
    id: "checkOut",
    label: "Check out",
    triggers: ["check(?:ed|ing)?[- ]?out", "checkout", "check \\S+(?: \\S+)? out", "(?:is )?(?:all )?done(?: for today)?$", "finished", "leaving", "left", "done with", "gone"],
    required: ["patient"],
    examples: ["check out john smith", "smith is done"],
    ask: { patient: "Who should I check out?" },
  },
  {
    id: "book",
    label: "Book a visit",
    triggers: ["book\\w*", "boo?k", "bk", "schedul\\w*", "sched", "set (?:up|him up|her up)", "make (?:an? )?(?:appt|appointment)", "(?:appt|appointment) for", "bring (?:\\S+ )?in", "put (?:\\S+ )?(?:\\S+ )?(?:in|on the schedule)", "get (?:\\S+ )?(?:\\S+ )?in", "squeeze", "pencil", "fit (?:\\S+ )?(?:\\S+ )?in", "on the books", "(?:wants|needs|like) to come in", "come in"],
    required: ["patient"],
    examples: ["book john smith tmrw at 3", "schedual jon smth wensday 2pm", "can u get smith in next tues morning", "set him up for friday", "appt for john smith 10/24 9:30"],
    ask: { patient: "Who should I book?" },
  },
  {
    id: "note",
    label: "Add a note",
    triggers: ["note", "notes", "jot", "chart (?:for|on|that)", "chart that", "log that", "write (?:down|that)", "add to (?:his|her|the) (?:file|chart)"],
    required: ["patient", "text"],
    examples: ["note for john smith: pain down to 4/10", "add a note to smith that he missed work", "jot down for jon smith mri scheduled"],
    ask: { patient: "Which patient is the note for?", text: "What should the note say?" },
  },
  {
    id: "todo",
    label: "Add a to-do",
    triggers: ["remind(?:er)?", "to[- ]?do", "task", "don'?t (?:let me )?forget", "need to remember"],
    required: ["text"],
    examples: ["remind me to call john smiths lawyer tmrw", "todo call mock law re records friday", "dont forget to fax smiths records"],
    ask: { text: "What's the to-do?" },
  },
  {
    id: "attorney",
    label: "Change the attorney",
    triggers: ["attorney", "atty", "lawyer", "law firm", "firm", "lawer"],
    required: ["patient", "attorney"],
    examples: ["change john smiths attorney to mock injury lawyers", "smith switched to test legal", "jon smith has a new lawyer sample law group"],
    ask: { patient: "Whose attorney changed?", attorney: "Which attorney?" },
  },
  {
    id: "doi",
    label: "Set the date of injury",
    triggers: ["doi", "dol", "date of (?:injury|loss|accident)", "accident (?:date|was)", "injury date", "got hurt on", "accident on"],
    required: ["patient", "date"],
    examples: ["set john smith doi to 9/1/2026", "smiths accident was 8/30", "date of injury for jon smith 09/01/26"],
    ask: { patient: "Whose date of injury?", date: "What's the date of injury?" },
  },
  {
    id: "status",
    label: "Change case status",
    triggers: ["status", "discharg\\w*", "d/c", "dc'?d", "drop(?:ped)?", "ready (?:to|2) (?:submit|bill)", "rts", "submitted", "submit", "re-?open\\w*", "back to active"],
    required: ["patient", "status"],
    examples: ["discharge john smith", "mark smith ready to submit", "jon smith dropped", "reopen smiths case"],
    ask: { patient: "Whose case?", status: "Which status?" },
  },
  {
    id: "message",
    label: "Message the team",
    triggers: ["tell", "let \\S+ know", "message", "msg", "ping", "dm"],
    required: ["person", "text"],
    examples: ["tell greg john smith is running late", "let abi know smith called"],
  },
  {
    id: "open",
    label: "Open a patient's case",
    triggers: ["open", "pull up", "pull", "go to", "bring up", "take me to", "show me", "load", "jump to", "opn"],
    required: ["patient"],
    examples: ["open john smiths case", "pull up smith", "take me to jon smith file", "opn smith chart"],
    ask: { patient: "Whose case should I open?" },
  },
  {
    id: "schedule",
    label: "See the schedule",
    triggers: ["who'?s? (?:is )?(?:coming|on the schedule|in)", "who (?:do we have|have we got|is booked)", "schedule (?:for )?(?:today|tomorrow)", "(?:appts|appointments|visits) (?:today|tomorrow|this week)", "what'?s? (?:on )?(?:the )?(?:schedule|calendar)"],
    required: [],
    examples: ["whos coming in today", "schedule for tmrw", "appointments this week"],
  },
  {
    id: "todos",
    label: "See your to-dos",
    triggers: ["(?:my|the|open) (?:to[- ]?dos?|tasks|list)", "what'?s? on my (?:list|plate)", "to[- ]?do list"],
    required: [],
    examples: ["whats on my to do list", "show my tasks"],
  },
  {
    id: "contact",
    label: "Look up a contact",
    triggers: ["(?:phone|fax|number|email|address)(?: number)? (?:for|of)", "(?:'s|s) (?:phone|fax|number|email)", "(?:phone|fax|email)(?: number)?$"],
    required: [],
    examples: ["fax for mock imaging", "mock injury lawyers phone number"],
  },
];

export interface BuiltinPhrase {
  /** Template, same format as office-learned phrases. */
  template: string;
  action: ActionId;
  /** Where it came from (e.g. "reviewed from office learning, PR #115"). */
  source?: string;
}

/** Reviewed wordings → action. Add promoted office phrases at the end. */
export const GOAT_BUILTIN_PHRASES: BuiltinPhrase[] = [
  { template: "{patient} the usual {date} {time}", action: "book", source: "starter" },
  { template: "{patient} same time {date}", action: "book", source: "starter" },
  { template: "{patient} is all done", action: "checkOut", source: "starter" },
  { template: "{patient} called out {date}", action: "cancel", source: "starter" },
  { template: "{patient} called out", action: "cancel", source: "starter" },
  { template: "{patient} ghosted", action: "noShow", source: "starter" },
  { template: "{patient} ghosted us", action: "noShow", source: "starter" },
  { template: "pull {patient}", action: "open", source: "starter" },
  { template: "{patient} file", action: "open", source: "starter" },
];

/** Template → action for the built-in phrases. */
export function builtinMap(): Record<string, ActionId> {
  const out: Record<string, ActionId> = {};
  for (const p of GOAT_BUILTIN_PHRASES) out[p.template] = p.action;
  return out;
}
