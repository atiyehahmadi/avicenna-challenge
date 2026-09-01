import type { KeyboardEvent } from 'react';
import { useOutboxActions, useOutboxState } from '../state/OutboxContext';
import { useRovingFocus } from '../hooks/useRovingFocus';
import { MessageRow } from './MessageRow';
import styles from './MessageList.module.scss';

/**
 * The message list.
 *
 * role="grid" rather than role="listbox". A listbox looks like the natural fit
 * for a multi-select list, but role="option" may not contain interactive
 * children, and these rows carry a checkbox, an expand toggle, and Cancel,
 * Remove and Retry buttons. Under a listbox those controls are simply not
 * exposed to assistive technology. A grid legitimises both the arrow-key
 * navigation and the interactive cell content.
 *
 * Selection is conveyed by a real <input type="checkbox"> in the first cell
 * rather than aria-selected, so screen readers announce it natively.
 *
 * This component reads state and passes each message down as a prop. That is
 * deliberate: it keeps rows out of the state context so that memoising them
 * later actually prevents re-renders.
 */

export function MessageList() {
  const { byId, order, selectedIds, expandedId, focusedId } = useOutboxState();
  const {
    toggleSelect,
    toggleExpand,
    cancel,
    removeFromQueue,
    retry,
    setFocus,
    deleteMessage,
  } = useOutboxActions();

  const { registerRow, requestFocus } = useRovingFocus(focusedId);

  // Exactly one row must be tabbable, or the list drops out of the tab order
  // entirely. Falling back to the first row covers both "nothing focused yet"
  // and the defensive case of focusedId somehow pointing at a row that is no
  // longer present.
  const activeId =
    focusedId !== null && byId[focusedId] ? focusedId : (order[0] ?? null);

  function moveFocus(toId: string | undefined) {
    if (!toId) return;
    setFocus(toId);
    requestFocus();
  }

  /**
   * Deleting destroys the focused DOM node, so focus would otherwise fall back
   * to <body> and keyboard navigation would be lost. The reducer picks the
   * successor from the pre-removal order — the next row, or the previous one
   * when the deleted row was last — and requestFocus moves the browser to it
   * once the new list has committed.
   */
  function handleDelete(id: string) {
    requestFocus();
    deleteMessage(id);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const target = event.target as HTMLElement;
    const row = target.closest<HTMLElement>('[data-message-id]');

    // Only act when the ROW itself holds focus. If the user has tabbed into a
    // checkbox or a button inside the row, those controls own their own keys —
    // hijacking Space there would break the checkbox.
    if (!row || row !== target) return;

    const id = row.dataset.messageId;
    if (!id) return;
    const index = order.indexOf(id);
    if (index === -1) return;

    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault(); // otherwise the page scrolls as well
        moveFocus(order[Math.min(index + 1, order.length - 1)]);
        break;
      case 'ArrowUp':
        event.preventDefault();
        moveFocus(order[Math.max(index - 1, 0)]);
        break;
      case 'Home':
        event.preventDefault();
        moveFocus(order[0]);
        break;
      case 'End':
        event.preventDefault();
        moveFocus(order[order.length - 1]);
        break;
      case ' ':
        event.preventDefault(); // Space scrolls the page by default
        toggleSelect(id);
        break;
      case 'Enter':
        event.preventDefault();
        toggleExpand(id);
        break;
      case 'Delete':
        event.preventDefault();
        handleDelete(id);
        break;
      default:
        break;
    }
  }

  if (order.length === 0) {
    return (
      <p className={styles.empty}>
        No messages yet. Compose one above to get started.
      </p>
    );
  }

  return (
    <div className={styles.scroller}>
      <div
        role="grid"
        aria-label="Outbox messages"
        aria-multiselectable="true"
        aria-rowcount={order.length}
        className={styles.grid}
        onKeyDown={handleKeyDown}
      >
        <div role="row" className={styles.headerRow}>
          <span role="columnheader" className={styles.headerCell}>
            <span className={styles.srOnly}>Select</span>
          </span>
          <span role="columnheader" className={styles.headerCell}>
            Subject
          </span>
          <span role="columnheader" className={styles.headerCell}>
            Recipient
          </span>
          <span role="columnheader" className={styles.headerCell}>
            Created
          </span>
          <span role="columnheader" className={styles.headerCell}>
            Status
          </span>
          <span role="columnheader" className={styles.headerCell}>
            <span className={styles.srOnly}>Actions</span>
          </span>
        </div>

        {order.map((id) => (
          <MessageRow
            key={id}
            message={byId[id]}
            selected={selectedIds.has(id)}
            expanded={expandedId === id}
            focused={id === activeId}
            registerRow={registerRow}
            onFocusRow={setFocus}
            onToggleSelect={toggleSelect}
            onToggleExpand={toggleExpand}
            onCancel={cancel}
            onRemoveFromQueue={removeFromQueue}
            onRetry={retry}
            onDelete={handleDelete}
          />
        ))}
      </div>
    </div>
  );
}
