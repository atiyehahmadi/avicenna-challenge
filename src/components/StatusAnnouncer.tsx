import { useEffect, useRef, useState } from 'react';
import { useOutboxState } from '../state/OutboxContext';
import type { MessageStatus } from '../types/message';
import styles from './StatusAnnouncer.module.scss';

/**
 * Screen-reader announcements for state the UI only shows visually.
 *
 * A status chip changing colour is silent to a screen reader, and this app's
 * whole point is state that changes on its own after the user walks away from
 * the button. Without a live region, a keyboard user hears nothing at all
 * between pressing Send and discovering the outcome by arrowing through rows.
 *
 * Discrete events are announced rather than a running summary. Re-rendering a
 * live count on every transition would make a bulk dispatch produce a stream of
 * chatter that is worse than silence, so only failures, halts, and the end of a
 * batch are spoken.
 */

export function StatusAnnouncer() {
  const { byId, order, notice } = useOutboxState();
  const [announcement, setAnnouncement] = useState('');

  const previousStatuses = useRef(new Map<string, MessageStatus>());
  const previousNoticeSeq = useRef(0);
  const wasBusy = useRef(false);

  useEffect(() => {
    const messages = order.map((id) => byId[id]);
    const previous = previousStatuses.current;
    const lines: string[] = [];

    // A halt is the least self-evident thing that happens, so it is announced
    // first: those rows went back to pending without ever being sent, and
    // nothing else in the UI would explain why.
    if (notice && notice.seq !== previousNoticeSeq.current) {
      previousNoticeSeq.current = notice.seq;
      lines.push(
        `${notice.count} further ${notice.count === 1 ? 'message' : 'messages'} to ${notice.recipient} were not sent, because an earlier message to them failed. They are pending again.`,
      );
    }

    for (const message of messages) {
      const before = previous.get(message.id);
      if (before !== 'failed' && message.status === 'failed') {
        lines.push(`Failed to send ${message.subject} to ${message.recipient}.`);
      }
    }

    // End-of-batch summary, announced on the edge from busy to idle.
    const busy = messages.some((m) => m.status === 'sending' || m.queued);
    if (wasBusy.current && !busy) {
      const delivered = messages.filter((m) => m.status === 'delivered').length;
      const failed = messages.filter((m) => m.status === 'failed').length;
      lines.push(`Dispatch finished. ${delivered} delivered, ${failed} failed.`);
    }
    wasBusy.current = busy;

    previousStatuses.current = new Map(
      messages.map((m) => [m.id, m.status] as const),
    );

    if (lines.length > 0) setAnnouncement(lines.join(' '));
  }, [byId, order, notice]);

  return (
    <>
      {/*
        polite, not assertive: these are progress reports, and interrupting
        whatever the user is reading would be hostile.
      */}
      <div className={styles.srOnly} role="status" aria-live="polite">
        {announcement}
      </div>

      {notice && (
        // The visible counterpart. Without it a halted row is simply "Pending",
        // indistinguishable from one that was never dispatched at all.
        <p className={styles.banner}>
          <strong>{notice.count}</strong>{' '}
          {notice.count === 1 ? 'message' : 'messages'} to{' '}
          <strong>{notice.recipient}</strong> stopped before sending, because an
          earlier message to them failed. They are pending again — retry the
          failed one, or send them separately.
        </p>
      )}
    </>
  );
}
