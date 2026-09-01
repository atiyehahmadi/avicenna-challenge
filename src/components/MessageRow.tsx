import { useCallback } from 'react';
import type { Message } from '../types/message';
import {
  formatAbsoluteTime,
  formatRelativeTime,
  toIsoString,
} from '../utils/formatDate';
import styles from './MessageRow.module.scss';

/**
 * One message row.
 *
 * The message arrives as a prop rather than being read from context, so that
 * memoising this component later actually pays off: the reducer replaces only
 * the message that changed, leaving every other Message object referentially
 * identical, so a shallow compare lets untouched rows skip re-rendering.
 *
 * Everything here renders untrusted text. There is no dangerouslySetInnerHTML
 * anywhere in this file, and there never should be — JSX escapes interpolated
 * text by construction. Subjects are clipped with CSS rather than by slicing
 * the string, and the expanded body relies on `white-space: pre-wrap` to keep
 * newlines without interpreting anything, plus `overflow-wrap: anywhere` so a
 * single enormous word cannot destroy the layout.
 */

const STATUS_LABEL: Record<string, string> = {
  pending: 'Pending',
  queued: 'Queued',
  sending: 'Sending',
  delivered: 'Delivered',
  failed: 'Failed',
};

export interface MessageRowProps {
  message: Message;
  selected: boolean;
  expanded: boolean;
  onToggleSelect: (id: string) => void;
  onToggleExpand: (id: string) => void;
  onCancel: (id: string) => void;
  onRemoveFromQueue: (id: string) => void;
  onRetry: (id: string) => void;
  onDelete: (id: string) => void;
  /** True for the single row that currently holds the roving tabindex. */
  focused: boolean;
  registerRow: (id: string, el: HTMLElement | null) => void;
  onFocusRow: (id: string) => void;
}

export function MessageRow({
  message,
  selected,
  expanded,
  onToggleSelect,
  onToggleExpand,
  onCancel,
  onRemoveFromQueue,
  onRetry,
  onDelete,
  focused,
  registerRow,
  onFocusRow,
}: MessageRowProps) {
  const { id, subject, recipient, body, createdAt, status, queued, error } =
    message;

  // `queued` is a display concern layered over `pending`, never a status of its
  // own — the state machine in the brief has four states and this is not one.
  const display = queued && status === 'pending' ? 'queued' : status;
  const detailId = `detail-${id}`;

  // A per-row stable ref callback. Passing an inline arrow instead would give
  // React a new function every render, making it detach and reattach the ref
  // each time — noisy, and it would fight the memoisation added later.
  const setRowRef = useCallback(
    (el: HTMLElement | null) => registerRow(id, el),
    [id, registerRow],
  );

  return (
    <>
      <div
        role="row"
        data-message-id={id}
        data-status={display}
        ref={setRowRef}
        // Roving tabindex: exactly one row is in the tab order, so the whole
        // list is a single Tab stop and arrow keys move within it.
        tabIndex={focused ? 0 : -1}
        // Clicking or shift-tabbing onto a row makes it the focused one, so
        // keyboard and pointer never disagree about where the cursor is.
        onFocus={() => onFocusRow(id)}
        className={`${styles.row} ${selected ? styles.rowSelected : ''}`}
      >
        <span role="gridcell" className={styles.cellSelect}>
          <input
            type="checkbox"
            className={styles.checkbox}
            checked={selected}
            onChange={() => onToggleSelect(id)}
            // A native checkbox conveys selection to assistive tech without any
            // ARIA, which is why the row is a grid rather than a listbox.
            aria-label={`Select message: ${subject}`}
          />
        </span>

        <span role="gridcell" className={styles.cellSubject}>
          <button
            type="button"
            className={styles.expandButton}
            aria-expanded={expanded}
            aria-controls={detailId}
            onClick={() => onToggleExpand(id)}
          >
            <span className={styles.subject}>{subject}</span>
          </button>
        </span>

        <span role="gridcell" className={styles.cellRecipient}>
          <span className={styles.recipient}>{recipient}</span>
        </span>

        <span role="gridcell" className={styles.cellDate}>
          <time dateTime={toIsoString(createdAt)} title={formatAbsoluteTime(createdAt)}>
            {formatRelativeTime(createdAt)}
          </time>
        </span>

        <span role="gridcell" className={styles.cellStatus}>
          <span className={`${styles.chip} ${styles[`chip-${display}`]}`}>
            {STATUS_LABEL[display]}
          </span>
          {status === 'failed' && error && (
            <span className={styles.errorText} title={error}>
              {error}
            </span>
          )}
        </span>

        <span role="gridcell" className={styles.cellActions}>
          {status === 'sending' && (
            <button
              type="button"
              className={styles.action}
              onClick={() => onCancel(id)}
              aria-label={`Cancel sending: ${subject}`}
            >
              Cancel
            </button>
          )}
          {/*
            A queued row is not `sending`, so the brief's Cancel does not apply
            to it. It gets its own label rather than overloading that one.
          */}
          {display === 'queued' && (
            <button
              type="button"
              className={styles.action}
              onClick={() => onRemoveFromQueue(id)}
              aria-label={`Remove from queue: ${subject}`}
            >
              Remove
            </button>
          )}
          {status === 'failed' && (
            <button
              type="button"
              className={`${styles.action} ${styles.actionRetry}`}
              onClick={() => onRetry(id)}
              aria-label={`Retry sending: ${subject}`}
            >
              Retry
            </button>
          )}
          {/*
            Deliberately absent while sending or queued: those rows already
            offer Cancel or Remove, and discarding a message mid-flight without
            first deciding what to do about the in-flight request would leave
            the user unsure whether it was actually sent.
          */}
          {(status === 'pending' || status === 'delivered' || status === 'failed') &&
            display !== 'queued' && (
              <button
                type="button"
                className={styles.action}
                onClick={() => onDelete(id)}
                aria-label={`Delete message: ${subject}`}
              >
                Delete
              </button>
            )}
        </span>
      </div>

      {expanded && (
        <div role="row" className={styles.detailRow}>
          <span role="gridcell" className={styles.detailCell} id={detailId}>
            <dl className={styles.detailList}>
              <dt className={styles.detailTerm}>To</dt>
              <dd className={styles.detailValue}>{recipient}</dd>
              <dt className={styles.detailTerm}>Subject</dt>
              <dd className={styles.detailValue}>{subject}</dd>
              <dt className={styles.detailTerm}>Sent</dt>
              <dd className={styles.detailValue}>
                {formatAbsoluteTime(createdAt)}
              </dd>
            </dl>
            <p className={styles.body}>{body}</p>
          </span>
        </div>
      )}
    </>
  );
}
