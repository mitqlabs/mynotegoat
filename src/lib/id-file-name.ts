/**
 * Files a person can pick as their photo: the name has to read as an ID,
 * and the file has to be an image or a PDF.
 *
 * "ID" and "DL" match only as their own token, so "Video" and "Handle" do not.
 * "License" and "Identification" match anywhere in the name.
 */
export function isIdDocumentName(name: string): boolean {
  const lower = name.toLowerCase();
  if (lower.includes("license") || lower.includes("identification")) return true;
  const tokens = lower.split(/[^a-z0-9]+/).filter(Boolean);
  return tokens.includes("id") || tokens.includes("dl");
}

export function isChoosableIdFile(file: { name: string; mimeType?: string }): boolean {
  if (!isIdDocumentName(file.name)) return false;
  const mime = (file.mimeType ?? "").toLowerCase();
  if (mime.startsWith("image/") || mime === "application/pdf") return true;
  return /\.(png|jpe?g|gif|webp|heic|bmp|pdf)$/i.test(file.name);
}
