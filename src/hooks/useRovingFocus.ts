import { useCallback, useEffect, useRef } from 'react';

/**
 * Roving tabindex for the message grid.
 *
 * Exactly one row is tabbable at a time, so the whole list is a single Tab
 * stop: Tab reaches the list, arrow keys move within it. That is the expected
 * behaviour for a collection, and it is why every row is not individually in
 * the tab order.
 *
 * The registry is keyed by message id, never by array index. Index-based focus
 * breaks the moment anything is inserted above the cursor; a stable id survives
 * insertion, removal and reordering, and the DOM node is looked up from it.
 *
 * The `wantFocus` flag is the important part. Rows change status constantly
 * during a dispatch, so an effect that re-focused on every render would yank
 * focus back into the list while the user was typing in the compose form. Focus
 * is therefore only restored when something explicitly asked for it — a key
 * press, or a mutation that destroyed the focused row.
 */
export function useRovingFocus(focusedId: string | null) {
  const rowRefs = useRef(new Map<string, HTMLElement>());
  const wantFocus = useRef(false);

  const registerRow = useCallback((id: string, el: HTMLElement | null) => {
    if (el) rowRefs.current.set(id, el);
    else rowRefs.current.delete(id);
  }, []);

  /** Ask for DOM focus to follow `focusedId` after the next render commits. */
  const requestFocus = useCallback(() => {
    wantFocus.current = true;
  }, []);

  // Intentionally no dependency array: this must run after every commit,
  // because the render that removes a row is also the one that must move focus.
  // The flag, not the dependencies, decides whether anything happens.
  useEffect(() => {
    if (!wantFocus.current) return;
    wantFocus.current = false;
    if (focusedId === null) return;
    rowRefs.current.get(focusedId)?.focus();
  });

  return { registerRow, requestFocus };
}
