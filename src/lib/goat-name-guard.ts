/**
 * One shared rule for "is this word of the question a patient's name?".
 *
 * G.O.A.T. used to have a private stop-word list and a private typo rule in every
 * place that looks for a patient (understand, global-chat, commands, slash flow,
 * om, notes). Every new everyday word that looked like a name ("call" ~ Hall,
 * "many" ~ May/Mary) needed its own one-off patch. All of them now call this.
 *
 * The rules:
 *  1. Everyday words, EHR shorthand (appt, pt, dx, rx, f/u, mri, rom…) and task
 *     verbs are NEVER a name — not exact, not close.
 *  2. A few words are real names AND real words (May, Will, Mark, Grant…). They match
 *     only exactly, and only when written like a name (Capitalized) or next to the
 *     rest of that patient's name ("shawn may").
 *  3. A typo match ("tylr" for Tyler) needs both words ≥ 4 letters, the same first
 *     letter (or a sound-alike), a small edit distance (1; 2 when both ≥ 7), and the
 *     typed word must not be a dictionary word.
 *  4. Short words (≤ 3 letters) match only exactly (or by prefix where the caller is
 *     explicitly completing a name being typed).
 *  5. A lone typo match with nothing else confirming the patient needs ≥ 5 letters
 *     or Capitalization.
 * Pure functions; no data, no network.
 */

/** EHR / office shorthand: never a name. */
export const EHR_ABBREVIATIONS = new Set(
  (
    "appt appts apt apts appnt appnts pt pts dx dxs rx rxs tx txs hx sx fx cc hpi pmh ros ie re ro fu f/u f-u fup np est reexam re-exam eval evals mri mris ct xr xray xrays x-ray cx lx rom pm am pi mva ma md dc doc docs dr drs " +
    "doi dol dob ssn ins insur atty attys att lop lops lien liens soap plan poc cpt icd pcp ortho neuro pt/ot ot cma rn lvn np pa tbd tba asap eta fyi na nsf wc wcab comp pip med meds ed er ice epi esi tens us emg ncv nerve pn pnrs rtc wnl nad nka hrs hr min mins mo mos yr yrs wk wks " +
    "no-show noshow ns cxl cxld cxl'd resched rsch rs sched schd chk chkd ci co copay copays eob era claim claims tm tmrw tmw tom tmr"
  ).split(/\s+/),
);

/** Everyday English the office types all day (function words, verbs, calendar, clinic nouns). Never a name. */
const EVERYDAY = (
  "a an and are as at be been being but by can could did do does doing done for from had has have having how i if in into is it its me my of on or our ours so than that the their theirs them then there these they this those to too up us was we were what when where which who whom whose why will with would you your yours " +
  "about above after again against all also always among any anyone anything around away back because before behind below between both bring brought call called calling calls came come comes coming cost costs couldn did didn does doesn don down during each either else enough even ever every everyone everything few find finds first following found get gets getting give given gives go goes going gone got great had has hasn haven hello help her here hers herself hey hi him himself his hold home however if into isn it's just keep keeps kind know known knows last later least leave left less let lets like likes list lists little long look looks lot lots made make makes making many may maybe mean means might mine more most much must myself need needs never new next no nobody none nor not nothing now number numbers off often oh ok okay old once one ones only onto open other others ought out over own part pass past pay people per pick place plan please pls plz pull push put quick quite rather really right same say says see seem seems send sent set shall she should show shows since some someone something soon still such sure take takes taken tell tells than thanks thank thx their thing things think thinks though through til till together told took toward towards try tries turn under until upon use used uses using very want wants way ways well went whats where whether while within without work works worth yeah yes yet " +
  "today tonight tomorrow yesterday tmrw morning afternoon evening noon night week weeks weekend month months year years day days daily weekly monthly hour hours minute minutes second seconds time times date dates monday tuesday wednesday thursday friday saturday sunday january february march april june july august september october november december feb mar apr jun jul aug sep sept oct nov dec " +
  "appointment appointments visit visits visited book booked booking cancel canceled cancelled cancels cancellation cancellations reschedule rescheduled rescheduling schedule scheduled schedules scheduling show shown shows missed miss misses attend attended attending check checked checks checking checkin checkout waiting wait waits pending upcoming recent recently latest previous total totals count counts counted average overall summary summarize summarise overview recap brief report reports status statuses stats stat statistic statistics " +
  "patient patients client clients case cases file files chart charts note notes noted encounter encounters record records document documents form forms paper papers letter letters pdf scan scans fax faxes email emails text texts message messages phone phones cell number address addresses contact contacts " +
  "doctor doctors nurse staff office front desk team provider providers attorney attorneys lawyer lawyers firm law insurance insurer adjuster carrier lien bill bills billing billed paid pays payment payments balance balances owed owe owes charge charges fee fees price prices amount amounts money cash check cheque deposit deposits reduction reductions reduce reduced settle settled settlement settlements submit submitted submission ready active inactive open closed close discharge discharged dropped drop " +
  "treatment treatments therapy therapies exam exams examination initial follow followup follow-up reexamination evaluation evaluations visit diagnosis diagnoses diagnostic diagnostics recommend recommended recommendation recommendations referral referrals referred refer injection injections epidural procedure procedures surgery surgical consult consultation consultations consults imaging film films scan results result finding findings impression impressions history medical medication medications prescription prescriptions " +
  "cervical thoracic lumbar sacral spine spinal neck back shoulder shoulders knee knees hip hips wrist wrists hand hands elbow elbows ankle ankles foot feet head headache headaches pain muscle muscles joint joints range motion left right bilateral lower upper mid mild moderate severe chronic acute " +
  "accident injury injuries auto car vehicle crash collision driver passenger liability claim claims " +
  "add added adding append assign assigned attach attached change changed changes changing clear cleared complete completed create created delete deleted edit edited enter entered export fill filled finish finished fix fixed forward forwarded generate generated hide link linked load log logged mark marked merge merged move moved name named names note opened pin pinned print printed read remind reminder reminders remove removed rename reply replied report request requested reset resend resent review reviewed save saved search searched select send sending sign signed sort start started stop stopped submit sync tag tagged type update updated upload uploaded view viewed write wrote " +
  "give gave help helps helped tell told ask asked asks want wanted wants need needed needs know knew think thought thinks look looked looks looking seem seemed " +
  "good bad best better worst worse big small high low full empty free busy late early soon fast slow easy hard true false real fine sure ready same different other another next previous " +
  "thing stuff something anything everything nothing today again always never sometimes usually often really actually maybe probably please sorry thanks welcome hello goodbye bye " +
  "week's what's who's how's that's it's there's here's let's don't doesn't didn't can't won't isn't aren't wasn't weren't"
)
  .split(/\s+/)
  .filter(Boolean);

/** Words that are real names too (May, Will, Mark…): exact match only, and only written like a name. */
const SOFT = new Set(
  "may pat will can bill mark grant rose hope page long young white brown green black gray grey king fox wolf lane hall hill wall wells ward lee love joy faith grace summer winter dawn april june august sunny sky rain stone rock banks bell ball bird bond case cash cook cross day dean diamond english ford frank free french gold good hart hunt jack ivory lamb lord major miles moore morgan nash noble park penny price rich rivers rush sage sands sharp short small snow strong sweet swift tate taylor thomas todd wade west wise wood wright".split(/\s+/),
);

/** Dictionary words that are never fuzzy-matched to a name (kept apart from the hard list so exact name matches stay possible). */
const DICTIONARY = new Set([...EVERYDAY, ...EHR_ABBREVIATIONS].map((w) => w.toLowerCase()));

const norm = (w: string) => w.toLowerCase().replace(/['’]s$/, "").replace(/[^a-z0-9/'-]/g, "");

/** An EHR abbreviation, a common English word, or a task verb. */
export function isEverydayWord(word: string): boolean {
  const w = norm(word);
  if (!w) return false;
  return DICTIONARY.has(w) || (w.length >= 5 && DICTIONARY.has(w.replace(/s$/, ""))) || (w.length >= 6 && DICTIONARY.has(w.replace(/(ed|ing)$/, ""))) || /^\d+$/.test(w);
}

/** Never a patient name, not even exactly (everyday words not also commonly used as names). */
export function isNeverName(word: string): boolean {
  const w = norm(word);
  if (!w) return true;
  if (w.length < 2) return true;
  if (SOFT.has(w)) return false; // may be a real name; handled by exact-only + capitalization rules
  return isEverydayWord(w);
}

/** A real name that is also an everyday word (May, Will, Mark): needs a name-like context. */
export function isAmbiguousNameWord(word: string): boolean {
  return SOFT.has(norm(word));
}

/** Damerau-Levenshtein (adjacent swap = 1). */
export function editDist(a: string, b: string): number {
  const al = a.length;
  const bl = b.length;
  if (!al) return bl;
  if (!bl) return al;
  const dp: number[][] = Array.from({ length: al + 1 }, (_, i) => [i, ...Array<number>(bl).fill(0)]);
  for (let j = 0; j <= bl; j++) dp[0][j] = j;
  for (let i = 1; i <= al; i++) {
    for (let j = 1; j <= bl; j++) {
      const c = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + c);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) dp[i][j] = Math.min(dp[i][j], dp[i - 2][j - 2] + 1);
    }
  }
  return dp[al][bl];
}

const sound = (w: string) => w.replace(/^c(?=[aou])/, "k").replace(/^ph/, "f");

export type NameMatch = "exact" | "prefix" | "fuzzy" | null;

export interface MatchOpts {
  /** The word may be the start of a name still being typed ("arm" → Armen). */
  allowPrefix?: boolean;
}

/**
 * How well one typed word matches one part of a patient's name.
 * "exact" and "prefix" are strong; "fuzzy" is a typo match (see the rules above).
 * Context rules (ambiguous words, lone fuzzy hits) are applied by `acceptHits`.
 */
export function matchNameToken(typedRaw: string, partRaw: string, opts: MatchOpts = {}): NameMatch {
  const t = norm(typedRaw);
  const p = norm(partRaw);
  if (t.length < 2 || p.length < 2) return null;
  if (t === p) return isNeverName(t) ? null : "exact";
  if (t === `${p}s` && t.length >= 4 && !isNeverName(t) && !isNeverName(p)) return "exact";
  // A real word (even one that is also a name) is only ever an exact match, never a typo of another name.
  if (isEverydayWord(t) || SOFT.has(t)) return null;
  if (opts.allowPrefix && t.length >= 3 && p.startsWith(t)) return "prefix";
  if (t.length < 4 || p.length < 4) return null;
  let a = t;
  let b = p;
  if (a[0] !== b[0]) {
    if (sound(a)[0] !== sound(b)[0]) return null;
    a = sound(a);
    b = sound(b);
  }
  const d = editDist(a, b);
  if (d <= (Math.min(a.length, b.length) >= 7 ? 2 : 1)) return "fuzzy";
  return null;
}

/** A 3-letter typo of a 4–5 letter name ("jon" ~ John): only counts when the rest of that name is also present. */
export function isShortTypo(typedRaw: string, partRaw: string): boolean {
  const t = norm(typedRaw);
  const p = norm(partRaw);
  return t.length === 3 && p.length >= 4 && p.length <= 5 && !isEverydayWord(t) && !isNeverName(t) && t.slice(0, 2) === p.slice(0, 2) && editDist(t, p) === 1;
}

export interface TokenHit {
  /** Index of the token in the question. */
  index: number;
  /** Raw text of the token. */
  raw: string;
  kind: "exact" | "prefix" | "fuzzy" | "short";
  /** Which name part it matched (any label; only the number of distinct parts matters). */
  part: string;
}

/**
 * Apply the context rules to the hits one patient got:
 *  - ambiguous real words (may, will, mark) need Capitalization or the other name part;
 *  - a lone fuzzy / short typo hit needs ≥ 5 letters or Capitalization (and a short typo
 *    needs the other name part);
 * Returns the hits that survive (empty = this patient is not named).
 */
export function acceptHits(hits: TokenHit[]): TokenHit[] {
  const parts = new Set(hits.map((h) => h.part));
  const both = parts.size > 1;
  const cap = (raw: string) => /^[A-Z]/.test(raw);
  const kept = hits.filter((h) => {
    if (h.kind === "short") return both;
    if (h.kind === "exact" && isAmbiguousNameWord(h.raw)) return both || (cap(h.raw) && h.index > 0);
    if (h.kind === "fuzzy" && !both) return norm(h.raw).length >= 5 || (cap(h.raw) && h.index > 0);
    return true;
  });
  return kept;
}
