/**
 * Smart mode (beta) is a preview-only prototype. Even if this code ever
 * reached production by mistake, it stays hidden there: it only shows on
 * Vercel preview deployments and local development.
 */
export const GOAT_SMART_AVAILABLE = process.env.NEXT_PUBLIC_VERCEL_ENV !== "production";

/** Per-browser on/off (the model download is per computer, so this isn't synced).
 * Not a casemate.* key on purpose: those are pushed to the cloud. */
export const GOAT_SMART_LOCAL_KEY = "notegoat.goat-smart-mode.v1";
