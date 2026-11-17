/**
 * Fills the office's device code into the NoteGoat shortcut file.
 * The slot and the real code are the same length, so the file stays valid.
 */
import { readFileSync } from "fs";
import { join } from "path";

export const SHORTCUT_TOKEN_SLOT = "NG" + "0".repeat(66);

export function shortcutWithToken(token: string): Buffer {
  if (token.length !== SHORTCUT_TOKEN_SLOT.length) throw new Error("Code length.");
  const file = readFileSync(join(process.cwd(), "src/lib/shortcuts/NoteGoat.template.shortcut"));
  const slot = Buffer.from(SHORTCUT_TOKEN_SLOT, "utf8");
  const found = file.indexOf(slot);
  if (found < 0 || file.indexOf(slot, found + 1) !== -1) throw new Error("Shortcut template.");
  const out = Buffer.from(file);
  Buffer.from(token, "utf8").copy(out, found);
  return out;
}
