import { useOutboxActions, useOutboxState } from '../state/OutboxContext';
import { MessageRow } from './MessageRow';
import styles from './MessageList.module.scss';

/**
 * The message list.
 *
 * role="grid" rather than role="listbox". A listbox looks like the natural fit
 * for a multi-select list, but role="option" may not contain interactive
 * children, and these rows carry a checkbox, an expand toggle, and — once the
 * dispatcher lands — Cancel and Retry buttons. Under a listbox those controls
 * are simply not exposed to assistive technology. A grid legitimises both the
 * arrow-key navigation and the interactive cell content.
 *
 * Selection is conveyed by a real <input type="checkbox"> in the first cell
 * rather than aria-selected, so screen readers announce it natively.
 *
 * This component reads state and passes each message down as a prop. That is
 * deliberate: it keeps rows out of the state context so that memoising them
 * later actually prevents re-renders.
 */

export function MessageList() {
  const { byId, order, selectedIds, expandedId } = useOutboxState();
  const { toggleSelect, toggleExpand, cancel, removeFromQueue, retry } =
    useOutboxActions();

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
            onToggleSelect={toggleSelect}
            onToggleExpand={toggleExpand}
            onCancel={cancel}
            onRemoveFromQueue={removeFromQueue}
            onRetry={retry}
          />
        ))}
      </div>
    </div>
  );
}
