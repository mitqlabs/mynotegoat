/**
 * Height math for the note editor / previous-note divider (pure, no React).
 *
 * The divider is ONE grip: the editor above it and the row of four previous-note
 * boxes below it trade height, so the pair's total never changes. Dragging the
 * grip up gives all four previous-note boxes more height together (and the
 * editor less); dragging it down does the reverse. Neither side can go below
 * its minimum.
 */

export type PaneHeights = { top: number; bottom: number };

/** Move the grip by `delta` px (positive = down). The total stays the same. */
export function movePaneDivider(start: PaneHeights, delta: number, minTop: number, minBottom: number): PaneHeights {
  const total = start.top + start.bottom;
  // If the pair is already smaller than both minimums, there is nothing to trade.
  const maxTop = Math.max(minTop, total - minBottom);
  const top = Math.min(maxTop, Math.max(minTop, start.top + delta));
  return { top, bottom: total - top };
}

/** A saved height is only used when it is a sane positive number; otherwise the default. */
export function parseSavedHeight(raw: string | null, fallback: number): number {
  const parsed = raw ? Number(raw) : NaN;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}
