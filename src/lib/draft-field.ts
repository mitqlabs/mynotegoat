/**
 * Draft-field helpers: keep what the user is typing on screen while saves
 * and cloud echoes happen in the background.
 *
 * Rule: a value that arrives from outside (cloud realtime echo, another
 * tab, a refetch) only replaces the on-screen text when the user is NOT
 * editing it — i.e. the field isn't focused and has no unsaved changes.
 */

export type DraftState = { draft: string; dirty: boolean; focused: boolean };

/** What the field should show after an outside value arrives. */
export function applyExternalValue(state: DraftState, external: string): DraftState {
  if (state.focused || state.dirty) return state;
  if (state.draft === external) return state;
  return { ...state, draft: external };
}

/** Trailing-edge debouncer with flush/cancel. */
export function createDebouncer<T>(fn: (value: T) => void, waitMs = 800) {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let pending: { value: T } | null = null;
  const run = () => {
    timer = null;
    const p = pending;
    pending = null;
    if (p) fn(p.value);
  };
  return {
    push(value: T) {
      pending = { value };
      if (timer) clearTimeout(timer);
      timer = setTimeout(run, waitMs);
    },
    flush() {
      if (timer) clearTimeout(timer);
      run();
    },
    cancel() {
      if (timer) clearTimeout(timer);
      timer = null;
      pending = null;
    },
    get pending() {
      return pending !== null;
    },
  };
}
