/**
 * G.O.A.T. as a home-screen app (PWA): the /goat route shows only the chat,
 * full screen. Pure helpers here so the eval can test them.
 */
export const GOAT_APP_PATH = "/goat";
export const GOAT_MANIFEST_PATH = "/goat.webmanifest";
export const GOAT_THEME_COLOR = "#72bdcf";
/** "user" key (cloud-mirrored via user-prefs-cloud): "dismissed" once the install tip is closed. */
export const GOAT_INSTALL_TIP_KEY = "casemate.goat-install-tip.v1";

export function isGoatAppPath(pathname: string | null | undefined): boolean {
  return pathname === GOAT_APP_PATH || Boolean(pathname?.startsWith(`${GOAT_APP_PATH}/`)) || Boolean(pathname?.startsWith(`${GOAT_APP_PATH}?`));
}

/** Where to go after login: only the G.O.A.T. app path (with an optional ?q=) is accepted; anything else → null. */
export function safeNextPath(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const v = raw.trim();
  if (!/^\/goat(?:\?q=[^#\s]*)?$/.test(v)) return null;
  return v;
}

/** ?q= → the text to prefill in the G.O.A.T. box (not sent until the user hits Send). */
export function goatQueryPrefill(search: string): string {
  try {
    const q = new URLSearchParams(search).get("q") ?? "";
    return q.replace(/\s+/g, " ").trim().slice(0, 500);
  } catch {
    return "";
  }
}

/**
 * Which install hint to show inside the G.O.A.T. popup:
 * "ios" = iPhone/iPad Safari, not already installed → Share → Add to Home Screen tip;
 * "android" = the browser fired beforeinstallprompt → a real Install button; else null.
 */
export function installTipKind(o: { ua: string; standalone: boolean; hasPrompt: boolean; dismissed: boolean; maxTouchPoints?: number }): "ios" | "android" | null {
  if (o.standalone || o.dismissed) return null;
  if (o.hasPrompt) return "android";
  const iPadOS = /Macintosh/.test(o.ua) && (o.maxTouchPoints ?? 0) > 1;
  const ios = /iPhone|iPad|iPod/.test(o.ua) || iPadOS;
  const otherBrowser = /CriOS|FxiOS|EdgiOS|OPiOS|GSA\//.test(o.ua);
  if (ios && !otherBrowser && /Safari/.test(o.ua)) return "ios";
  return null;
}

/** Running as the installed app (iOS navigator.standalone or display-mode: standalone). */
export function isStandalone(): boolean {
  if (typeof window === "undefined") return false;
  const nav = window.navigator as Navigator & { standalone?: boolean };
  return nav.standalone === true || window.matchMedia?.("(display-mode: standalone)").matches === true;
}
