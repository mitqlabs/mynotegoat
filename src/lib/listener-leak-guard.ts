"use client";

/**
 * Listener Leak Guard
 *
 * Root cause of the worst production incident we've had so far: a
 * useEffect with an unstable dep list stacked hundreds of
 * focus/visibilitychange listeners onto window/document. Every one of
 * them fired on every tab focus, spawning a cloud-retry chain, pegging
 * the CPU fan and eventually OOM-ing Chrome. By the time the user
 * noticed, their in-memory React state had been lost to the crash.
 *
 * This module intercepts `addEventListener` / `removeEventListener` on
 * window and document at module init, counts live listeners per event
 * type, and fires a loud visible alarm the moment any event crosses
 * the leak threshold. The goal isn't to prevent leaks after they start
 * — the goal is to make them instantly obvious to us in development
 * AND to the user in production so a runaway leak is NEVER again a
 * silent background process.
 *
 * The alarm dispatches a `casemate:listener-leak-detected` CustomEvent
 * that the portal layout catches and renders as a red sticky banner
 * with the offending event type and count. Users seeing it should
 * hard-refresh AND report the incident. We log a stack trace too so
 * we can trace the offending addEventListener call.
 */

const LEAK_THRESHOLDS: Record<string, number> = {
  // Events React's synthetic system attaches once per app — a few
  // legit mounts is normal. Above 25 is the leak pattern.
  focus: 25,
  blur: 25,
  visibilitychange: 25,
  resize: 25,
  scroll: 50, // scroll handlers are common; looser threshold
  keydown: 50,
  keyup: 50,
  mousemove: 50,
  // Custom internal events — way fewer legitimate registrations.
  "casemate:cloud-sync-blocked": 5,
};

// Anything not in the map above uses this fallback.
const DEFAULT_THRESHOLD = 100;

// Loose type for the overload-heavy addEventListener signature — we only
// care that the call is proxied through, not about typing full overloads.
type AddFn = (type: string, listener: unknown, options?: unknown) => void;

/**
 * Live registrations per event type, keyed like the browser keys them:
 * ONE copy per listener + capture pair.
 *
 * The old guard bumped a plain number on every add and dropped it on every
 * remove. That over-counted three ways that are NOT leaks, and the banner
 * fired on healthy tabs (2026-10-10: "keydown on window, 50 handlers" while
 * typing G.O.A.T. questions, with only a handful of real listeners):
 *   • `{ once: true }` listeners the browser removes itself after they fire
 *     (no removeEventListener call ever reaches us),
 *   • listeners removed by aborting their `{ signal }`,
 *   • the same listener added again (the browser ignores the duplicate).
 * Third-party page scripts (browser extensions, the Vercel preview toolbar)
 * use all three patterns on window keydown/keyup.
 */
/** event type → listener → capture flag → registered by NoteGoat's own code? */
type Registry = Map<string, Map<unknown, Map<boolean, boolean>>>;

let installed = false;
let firedAlarms = new Set<string>();

const captureOf = (options: unknown): boolean =>
  typeof options === "boolean" ? options : !!(options && typeof options === "object" && (options as { capture?: unknown }).capture);

const onceOf = (options: unknown): boolean =>
  !!(options && typeof options === "object" && (options as { once?: unknown }).once);

const signalOf = (options: unknown): AbortSignal | null => {
  const s = options && typeof options === "object" ? (options as { signal?: unknown }).signal : null;
  return s && typeof s === "object" && "aborted" in s ? (s as AbortSignal) : null;
};

/** Script URLs on the current call stack, innermost first. */
function stackUrls(): string[] {
  const stack = new Error().stack ?? "";
  return stack
    .split("\n")
    .map((line) => /((?:https?|chrome-extension|moz-extension|safari-web-extension):\/\/[^\s)]+?)(?::\d+){0,2}\)?$/.exec(line.trim())?.[1])
    .filter((u): u is string => !!u);
}

/** The bundle this guard ships in (set at install). */
let guardUrl = "";

/**
 * Who called addEventListener: NoteGoat's own code when any frame below the
 * guard is one of its bundles (/_next/), otherwise the first foreign script
 * (chrome-extension://…, https://vercel.live/…). Unknown stacks count as
 * NoteGoat so a real NoteGoat leak is never hidden.
 */
function callerOf(): { own: boolean; source: string } {
  const urls = stackUrls();
  let i = 0;
  while (i < urls.length && urls[i] === guardUrl) i++;
  const below = urls.slice(i);
  if (!guardUrl || !below.length) return { own: true, source: "NoteGoat" };
  const origin = location.origin;
  const own = below.some((u) => u.startsWith(`${origin}/_next/`));
  return { own, source: own ? "NoteGoat" : below[0] };
}

function logLeak(target: "window" | "document", type: string, count: number, own: boolean, source: string) {
  const key = `${target}:${type}:${own ? "app" : "external"}`;
  // Only fire once per (target,type) pair per page life so we don't
  // spam the console with the same alarm every keystroke.
  if (firedAlarms.has(key)) return;
  firedAlarms.add(key);

  if (!own) {
    // Not NoteGoat's code (an extension or the Vercel toolbar): nothing the
    // user can fix by reloading NoteGoat, so log it instead of the red banner.
    console.warn(
      `[listener-leak-guard] ${count} live ${target} "${type}" listeners, ` +
        `mostly from outside NoteGoat (${source}). Not showing the banner.`,
    );
    return;
  }

  const message =
    `[listener-leak-guard] ${target}.addEventListener("${type}", …) ` +
    `count reached ${count} — LEAK SUSPECTED. ` +
    `Hard-refresh the tab and check the useEffect that registers "${type}" ` +
    `for an unstable dep list or a mismatched remove-reference.`;

  // Loud and stacky so we can find the offending call site.
  console.error(message);
  console.trace("[listener-leak-guard] trace");

  // Let the portal layout render a visible banner. The banner is a
  // last-chance user warning — saves their work before the browser
  // tab starts to struggle.
  if (typeof window !== "undefined") {
    window.dispatchEvent(
      new CustomEvent("casemate:listener-leak-detected", {
        detail: { target, type, count },
      }),
    );
  }
}

function thresholdFor(type: string): number {
  return LEAK_THRESHOLDS[type] ?? DEFAULT_THRESHOLD;
}

/** Reset for tests / forced checks. Not called in production. */
export function __resetLeakGuardForTests() {
  firedAlarms = new Set<string>();
}

/** Live listener counts per target and type (debugging / tests). */
let snapshot: () => { window: Record<string, number>; document: Record<string, number> } = () => ({
  window: {},
  document: {},
});
export function __leakGuardCounts() {
  return snapshot();
}

/**
 * Install the global interceptor. Idempotent — calling twice is a
 * no-op. Safe to call from the portal layout mount.
 */
export function installListenerLeakGuard() {
  if (installed || typeof window === "undefined") return;
  installed = true;
  guardUrl = stackUrls()[0] ?? "";

  const windowReg: Registry = new Map();
  const documentReg: Registry = new Map();

  const originalWindowAdd = window.addEventListener.bind(window) as AddFn;
  const originalWindowRemove = window.removeEventListener.bind(window) as AddFn;
  const originalDocAdd = document.addEventListener.bind(document) as AddFn;
  const originalDocRemove = document.removeEventListener.bind(document) as AddFn;

  /** Live listeners of one type: all of them, and NoteGoat's own. */
  const countOf = (reg: Registry, type: string) => {
    let all = 0;
    let own = 0;
    for (const caps of reg.get(type)?.values() ?? []) {
      for (const isOwn of caps.values()) {
        all++;
        if (isOwn) own++;
      }
    }
    return { all, own };
  };

  const wrap = (
    reg: Registry,
    originalAdd: AddFn,
    originalRemove: AddFn,
    targetName: "window" | "document",
  ) => {
    const forget = (type: string, listener: unknown, capture: boolean) => {
      const byListener = reg.get(type);
      const caps = byListener?.get(listener);
      if (caps?.delete(capture) && caps.size === 0) byListener?.delete(listener);
    };

    const add: AddFn = (type, listener, options) => {
      originalAdd(type, listener, options);
      // Nothing that can pile up: no listener, an already-aborted signal,
      // or a one-shot the browser removes itself after the next event.
      const signal = signalOf(options);
      if (!listener || signal?.aborted || onceOf(options)) return;
      const capture = captureOf(options);
      let byListener = reg.get(type);
      if (!byListener) reg.set(type, (byListener = new Map()));
      let caps = byListener.get(listener);
      if (!caps) byListener.set(listener, (caps = new Map()));
      if (caps.has(capture)) return; // duplicate: the browser ignored it too
      const caller = callerOf();
      caps.set(capture, caller.own);
      signal?.addEventListener("abort", () => forget(type, listener, capture), { once: true });

      const { all, own } = countOf(reg, type);
      const threshold = thresholdFor(type);
      if (all >= threshold) {
        // The red banner is for NoteGoat's own listeners only.
        const ours = own >= threshold;
        logLeak(targetName, type, ours ? own : all, ours, caller.source);
      }
    };

    const remove: AddFn = (type, listener, options) => {
      forget(type, listener, captureOf(options));
      originalRemove(type, listener, options);
    };

    return { add, remove };
  };

  const win = wrap(windowReg, originalWindowAdd, originalWindowRemove, "window");
  const doc = wrap(documentReg, originalDocAdd, originalDocRemove, "document");

  const toObj = (reg: Registry) =>
    Object.fromEntries([...reg.keys()].map((t) => [t, countOf(reg, t).all]));
  snapshot = () => ({ window: toObj(windowReg), document: toObj(documentReg) });

  // Reassign DOM methods — types are loose on purpose to avoid fighting
  // the browser's overload-heavy signatures.
  (window as unknown as { addEventListener: AddFn }).addEventListener = win.add;
  (window as unknown as { removeEventListener: AddFn }).removeEventListener = win.remove;
  (document as unknown as { addEventListener: AddFn }).addEventListener = doc.add;
  (document as unknown as { removeEventListener: AddFn }).removeEventListener = doc.remove;
}
