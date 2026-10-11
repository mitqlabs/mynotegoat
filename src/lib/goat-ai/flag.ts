/**
 * + mode (G.O.A.T.+): the private in-browser model that fills gaps in
 * G.O.A.T.'s rule-based answers. Available everywhere, but OFF until a user
 * turns it on on their computer (the one-time card, or Settings → G.O.A.T.).
 * While it's off nothing of it loads: no model download, no WebLLM code.
 *
 * Emergency switch: set NEXT_PUBLIC_GOAT_PLUS_DISABLED=1 in Vercel to hide it
 * everywhere (regular G.O.A.T. is unaffected).
 */
export const GOAT_SMART_AVAILABLE = process.env.NEXT_PUBLIC_GOAT_PLUS_DISABLED !== "1";

/** Per-browser on/off (the model download is per computer, so this isn't synced).
 * Not a casemate.* key on purpose: those are pushed to the cloud. */
export const GOAT_SMART_LOCAL_KEY = "notegoat.goat-smart-mode.v1";

/** The one-time "turn on + mode?" card was answered on this computer ("on" / "later"). Never shown again. */
export const GOAT_PLUS_INTRO_KEY = "notegoat.goat-plus-intro.v1";
