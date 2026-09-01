import { useMemo } from 'react';
import { useOutboxActions, useOutboxState } from '../state/OutboxContext';
import styles from './Toolbar.module.scss';

/**
 * Selection summary and the bulk-dispatch trigger.
 *
 * Every count here is derived with useMemo rather than stored in state. Storing
 * them would mean keeping them in sync with additions, deletions and status
 * changes, and the classic bug is a counter that drifts after a delete.
 */
export function Toolbar() {
  const { byId, order, selectedIds } = useOutboxState();
  const { setSelection, clearSelection, sendSelected } = useOutboxActions();

  const { pendingIds, selectedCount, dispatchableCount } = useMemo(() => {
    const pending = order.filter((id) => {
      const m = byId[id];
      return m.status === 'pending' && !m.queued;
    });
    return {
      pendingIds: pending,
      selectedCount: selectedIds.size,
      dispatchableCount: pending.filter((id) => selectedIds.has(id)).length,
    };
  }, [byId, order, selectedIds]);

  const allPendingSelected =
    pendingIds.length > 0 && pendingIds.every((id) => selectedIds.has(id));

  if (order.length === 0) return null;

  return (
    <div className={styles.toolbar}>
      <label className={styles.selectAll}>
        <input
          type="checkbox"
          className={styles.checkbox}
          checked={allPendingSelected}
          disabled={pendingIds.length === 0}
          onChange={() =>
            allPendingSelected ? clearSelection() : setSelection(pendingIds)
          }
        />
        Select all pending
      </label>

      <p className={styles.summary}>
        {selectedCount} selected
        {selectedCount > dispatchableCount && (
          <span className={styles.note}>
            {' '}
            ({dispatchableCount} can be sent)
          </span>
        )}
      </p>

      <button
        type="button"
        className={styles.send}
        onClick={sendSelected}
        disabled={dispatchableCount === 0}
      >
        Send selected
      </button>
    </div>
  );
}
