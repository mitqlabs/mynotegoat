/**
 * How an iPhone is asked to import a shortcut.
 * iOS 15 and later only import a shortcut Apple has signed (file starts with AEA1),
 * or an iCloud share link. An unsigned plist opens Shortcuts and then fails.
 */
import { buildNamedShortcut } from "@/lib/shortcut-plist";
import { shortcutWithToken } from "@/lib/shortcut-file";
import { openDeviceToken } from "@/lib/shortcut-ticket";

export const UNSIGNED_SHORTCUT_ERROR =
  "Apple will not import this shortcut. It is not signed. Sign it on a Mac signed into iCloud, or share an iCloud link.";

const AEA1 = [0x41, 0x45, 0x41, 0x31];

/** Signed shortcut files from `shortcuts sign` start with AEA1. A plain plist does not. */
export function isSignedShortcut(bytes: Uint8Array): boolean {
  return AEA1.every((byte, index) => bytes[index] === byte);
}

export function shortcutDownloadName(name: string): string {
  const clean = name.replace(/[^\w .–-]+/g, "").trim() || "NoteGoat";
  return clean.toLowerCase().endsWith(".shortcut") ? clean : `${clean}.shortcut`;
}

/** An iCloud share link. Anything else is ignored. */
export function icloudShortcutUrl(value: string | undefined): string {
  const raw = (value ?? "").trim();
  if (!raw) return "";
  try {
    const url = new URL(raw);
    const id = url.pathname.replace(/^\/shortcuts\/?/, "").split("/")[0] ?? "";
    if (url.protocol !== "https:" || url.hostname !== "www.icloud.com") return "";
    if (!url.pathname.startsWith("/shortcuts/") || !/^[A-Za-z0-9]{8,}$/.test(id)) return "";
    return url.toString();
  } catch {
    return "";
  }
}

export function buildShortcutLinks(input: {
  origin: string;
  ticket: string;
  name: string;
  signed: boolean;
  icloudUrl?: string;
  ruleId?: string;
}): { importUrl?: string; fileUrl: string; error?: string } {
  const origin = input.origin.replace(/\/$/, "");
  const filename = shortcutDownloadName(input.name);
  const params = new URLSearchParams({ t: input.ticket });
  if (input.ruleId) {
    params.set("rule", input.ruleId);
    params.set("name", input.name);
  }
  const fileUrl = `${origin}/api/reminders/shortcut/${encodeURIComponent(filename)}?${params.toString()}`;
  const icloud = icloudShortcutUrl(input.icloudUrl);
  if (icloud) return { importUrl: icloud, fileUrl };
  if (!input.signed) return { fileUrl, error: UNSIGNED_SHORTCUT_ERROR };
  const importUrl = `shortcuts://import-shortcut?url=${encodeURIComponent(fileUrl)}&name=${encodeURIComponent(input.name)}`;
  return { importUrl, fileUrl };
}

export function shortcutFileHeaders(filename: string): Record<string, string> {
  const safe = shortcutDownloadName(filename).replace(/"/g, "");
  return {
    "Content-Type": "application/octet-stream",
    "Cache-Control": "no-store",
    "Content-Disposition": `inline; filename="${safe}"`,
  };
}

/** The file Shortcuts would download. No database write. */
export function shortcutForTicket(input: {
  ticket: string;
  secret: string;
  ruleId: string;
  name: string;
  origin: string;
  now?: number;
}): { ok: true; body: Buffer; filename: string } | { ok: false; error: string; status: number } {
  const token = openDeviceToken(input.ticket, input.secret, input.now);
  if (!token) return { ok: false, error: "This link has expired. Use Add to this Device again.", status: 404 };
  try {
    if (input.ruleId) {
      const xml = buildNamedShortcut({ token, name: input.name, ruleId: input.ruleId, origin: input.origin });
      return { ok: true, body: Buffer.from(xml, "utf8"), filename: shortcutDownloadName(input.name) };
    }
    return { ok: true, body: shortcutWithToken(token), filename: "NoteGoat.shortcut" };
  } catch {
    return { ok: false, error: "Shortcut file is missing.", status: 500 };
  }
}
