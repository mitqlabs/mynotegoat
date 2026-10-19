/**
 * Address parts — split and rejoin a single-line address string into the
 * five structured fields used by the UI:
 *
 *   Address 1, Address 2, City, State, ZIP
 *
 * Storage stays as ONE composed string (e.g.
 *   "1234 Fake St., Unit 111, Anytown, ST 12345"
 * ) so every existing record, template token, and PDF renderer keeps
 * working without a migration. The five-field inputs just parse the
 * stored value on mount and compose a fresh string on every change.
 */

export interface AddressParts {
  address1: string;
  address2: string;
  city: string;
  state: string;
  zip: string;
}

export const emptyAddressParts: AddressParts = {
  address1: "",
  address2: "",
  city: "",
  state: "",
  zip: "",
};

/**
 * Best-effort parse of a free-form address string into structured parts.
 * Handles the canonical shape we emit from `composeAddressParts`, plus
 * reasonable human variations (missing ZIP, missing state, street-only,
 * etc.). Unparseable input ends up in `address1` so no text is lost.
 */
export function parseAddressString(raw: string): AddressParts {
  const trimmed = (raw ?? "").trim();
  if (!trimmed) return { ...emptyAddressParts };

  // Split on commas, ignoring empty trailing/leading segments.
  const segments = trimmed
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  if (segments.length === 0) return { ...emptyAddressParts };

  // Extract the final "STATE ZIP" segment if present. The pattern allows:
  //   "CA 91206", "CA", "91206", "CA 91206-1234"
  const stateZipPattern =
    /^(?:([A-Za-z]{2})\s+)?(\d{5}(?:-\d{4})?)?\s*$|^([A-Za-z]{2})\s*$/;

  let state = "";
  let zip = "";
  let tail = segments[segments.length - 1];
  const match = tail.match(stateZipPattern);
  const tailLooksLikeStateZip =
    match && ((match[1] || match[2]) || match[3]);
  if (tailLooksLikeStateZip) {
    state = (match[1] || match[3] || "").toUpperCase();
    zip = match[2] ?? "";
    segments.pop();
  } else {
    // The last segment might be just a ZIP
    const zipOnly = tail.match(/^(\d{5}(?:-\d{4})?)$/);
    if (zipOnly) {
      zip = zipOnly[1];
      segments.pop();
    }
    // Or it might be "STATE ZIP" concatenated with city when no comma
    // separated city from state (e.g. "Anytown ST 12345"). Try to
    // peel STATE ZIP off the end of whatever remains at the tail.
    tail = segments[segments.length - 1] ?? "";
    const embeddedStateZip = tail.match(
      /^(.+?)\s+([A-Za-z]{2})\s+(\d{5}(?:-\d{4})?)$/,
    );
    if (embeddedStateZip && !state) {
      segments[segments.length - 1] = embeddedStateZip[1].trim();
      state = embeddedStateZip[2].toUpperCase();
      zip = embeddedStateZip[3];
    } else if (!state) {
      const embeddedState = tail.match(/^(.+?)\s+([A-Za-z]{2})$/);
      if (embeddedState) {
        segments[segments.length - 1] = embeddedState[1].trim();
        state = embeddedState[2].toUpperCase();
      }
    }
  }

  // Whatever's left: the last remaining segment is city, earlier segments
  // are address lines. Handle the "no comma between city and state" case
  // where we already peeled STATE ZIP off the last segment above.
  let city = "";
  if (segments.length > 0) {
    city = segments.pop()!;
  }

  // Remaining segments become Address 1 (+ optional Address 2). If more
  // than two pieces remain, collapse the rest into Address 2 so we don't
  // drop any text.
  const address1 = segments[0] ?? "";
  const address2 = segments.slice(1).join(", ");

  return { address1, address2, city, state, zip };
}

/**
 * Compose the five structured fields back into a single canonical
 * address string. Empty fields are skipped so we never emit weird
 * "  ,  ," strings. City / state / zip collapse into one final segment
 * since that's how humans read addresses.
 */
export function composeAddressParts(parts: AddressParts): string {
  const a1 = parts.address1.trim();
  const a2 = parts.address2.trim();
  const city = parts.city.trim();
  const state = parts.state.trim().toUpperCase();
  const zip = parts.zip.trim();

  const citySegment = [
    city,
    [state, zip].filter(Boolean).join(" ").trim(),
  ]
    .filter(Boolean)
    .join(", ");

  return [a1, a2, citySegment].filter(Boolean).join(", ");
}

/** True if every field is empty. Used to hide the composed preview. */
export function isAddressPartsEmpty(parts: AddressParts): boolean {
  return (
    !parts.address1.trim() &&
    !parts.address2.trim() &&
    !parts.city.trim() &&
    !parts.state.trim() &&
    !parts.zip.trim()
  );
}
