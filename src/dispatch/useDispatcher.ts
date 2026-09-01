import { useMemo, type Dispatch } from 'react';
import { sendMessage } from '../api/messageApi';
import type { OutboxAction, OutboxState } from '../state/outboxReducer';

/**
 * The async layer: per-recipient serial queues over a concurrent whole.
 *
 * The brief's constraint — same recipient sequential in creation order,
 * different recipients concurrent — is a mutex keyed by recipient. It is
 * implemented as an explicit queue rather than a promise chain
 * (`chain = chain.then(...)`) because a chain is opaque: you cannot inspect
 * what is still waiting, cannot pull a message out of it, and cannot return the
 * messages behind a failure to `pending`. All three are required here.
 *
 * Nothing in this file writes state directly; it only dispatches. The queues
 * and controllers are ordinary local variables precisely because they are not
 * UI state — nothing renders from them.
 */

export type SendFn = (messageId: string, signal?: AbortSignal) => Promise<void>;

type Outcome = 'delivered' | 'failed' | 'cancelled' | 'skipped';

interface RecipientQueue {
  ids: string[];
  /** Read cursor. Dequeuing by advancing an index is O(1); Array.shift is O(n). */
  head: number;
  running: boolean;
}

export interface DispatcherApi {
  sendSelected: () => void;
  /** Aborts an in-flight send and returns that message to `pending`. */
  cancel: (id: string) => void;
  /** Pulls a still-queued message out of its recipient queue before it starts. */
  removeFromQueue: (id: string) => void;
  /** Re-sends a single failed message without disturbing any other. */
  retry: (id: string) => void;
}

/**
 * The scheduler itself, with no React in it.
 *
 * Keeping this a plain factory means the concurrency logic can be exercised
 * directly — construct one with a deterministic sender and drive it — rather
 * than only through a rendered component. `useDispatcher` below is the thin
 * React wrapper.
 */
export function createDispatcher(
  getState: () => OutboxState,
  dispatch: Dispatch<OutboxAction>,
  // Injected rather than imported directly. The async boundary is the layer
  // that owns time, randomness and the network, which is exactly the seam you
  // want controllable.
  send: SendFn = sendMessage,
): DispatcherApi {
  const queues = new Map<string, RecipientQueue>();
  const aborters = new Map<string, AbortController>();

  function getQueue(recipient: string): RecipientQueue {
    let q = queues.get(recipient);
    if (!q) {
      q = { ids: [], head: 0, running: false };
      queues.set(recipient, q);
    }
    return q;
  }

  /** Returns everything still waiting to `pending` and empties the queue. */
  function drain(q: RecipientQueue): void {
    const remaining = q.ids.slice(q.head);
    q.ids.length = 0;
    q.head = 0;
    if (remaining.length > 0) {
      dispatch({ type: 'DEQUEUED_TO_PENDING', ids: remaining });
    }
  }

  async function runOne(id: string): Promise<Outcome> {
    const message = getState().byId[id];
    // The queue can outlive its contents: a message may have been deleted, or
    // pulled out, while it sat waiting. Re-check before sending anything.
    if (!message || message.status !== 'pending') return 'skipped';

    const attempt = message.attempt + 1;
    const controller = new AbortController();
    aborters.set(id, controller);

    // Optimistic and synchronous: the row flips to `sending` before the request
    // leaves, so the UI never waits on the network to give feedback.
    dispatch({ type: 'SEND_STARTED', id, attempt });

    try {
      await send(id, controller.signal);
      dispatch({ type: 'SEND_SUCCEEDED', id, attempt });
      return 'delivered';
    } catch (error) {
      if ((error as Error)?.name === 'AbortError') {
        // Control flow only. Whoever initiated the cancellation already
        // dispatched the state change.
        return 'cancelled';
      }
      dispatch({
        type: 'SEND_FAILED',
        id,
        attempt,
        error: (error as Error)?.message ?? 'Send failed',
      });
      return 'failed';
    } finally {
      // A controller is single-use, so it is discarded the moment its request
      // settles. A retry mints a fresh one.
      aborters.delete(id);
    }
  }

  async function pump(recipient: string): Promise<void> {
    const q = getQueue(recipient);
    // The mutex. One pump per recipient means one request in flight per
    // recipient; separate recipients pump independently, which is where the
    // concurrency comes from.
    if (q.running) return;
    q.running = true;

    try {
      while (q.head < q.ids.length) {
        const outcome = await runOne(q.ids[q.head]);
        q.head++;

        // THE FAILURE POLICY, in one line.
        //
        // Halt: everything still queued for this recipient goes back to
        // `pending`, untouched and re-selectable. The brief leaves this open,
        // and the argument is asymmetry of harm — halting costs the user a
        // click, whereas continuing would silently deliver a later message
        // after an earlier one failed, which cannot be undone. Under genuine
        // ambiguity, choose the recoverable failure.
        //
        // Cancellation is deliberately NOT treated this way. It continues,
        // because the brief specifies cancel as a per-message operation and
        // requires retry not to affect others. The unifying rule: the user may
        // do anything to their own messages, but the system may not make
        // ordering decisions on their behalf.
        if (outcome === 'failed') {
          drain(q);
          break;
        }
      }
    } finally {
      q.running = false;
      if (q.head >= q.ids.length) {
        q.ids.length = 0;
        q.head = 0;
      }
    }
  }

  function sendSelected(): void {
    const state = getState();

    const toSend = [...state.selectedIds]
      .map((id) => state.byId[id])
      .filter((m) => m && m.status === 'pending' && !m.queued)
      // Creation order, as the constraint requires. Selection order and the
      // Set's iteration order are both irrelevant.
      .sort((a, b) => a.createdAt - b.createdAt);

    if (toSend.length === 0) return;

    // One synchronous dispatch marks the whole batch before any request leaves,
    // so "Send selected" gives immediate feedback.
    dispatch({ type: 'ENQUEUED', ids: toSend.map((m) => m.id) });

    const recipients = new Set<string>();
    for (const m of toSend) {
      getQueue(m.recipient).ids.push(m.id);
      recipients.add(m.recipient);
    }

    // Started, not awaited: each recipient runs its own serial queue, and the
    // recipients run concurrently with one another.
    for (const recipient of recipients) void pump(recipient);
  }

  /**
   * Cancel an in-flight send.
   *
   * The ORDER of the two statements below is the whole point, and it is not
   * interchangeable.
   *
   * AbortSignal alone does not make cancellation correct here, because an abort
   * can lose. Look at settle() in src/api/messageApi.ts: when the request
   * resolves it clears its timer AND removes the abort listener. An abort
   * arriving after that is a silent no-op — nothing throws, no AbortError is
   * ever raised, and runOne's catch block never runs. If the state change were
   * left to that catch block, the message's attempt token would never be
   * bumped, the already-resolved SEND_SUCCEEDED would arrive carrying a token
   * the reducer still considers current, and a message the user had just
   * cancelled would be marked delivered.
   *
   * Dispatching first closes that hole. SEND_CANCELLED bumps the attempt, which
   * supersedes the in-flight request immediately, so whether or not the abort
   * lands the resolved result fails the reducer's isCurrent() guard and is
   * discarded. The abort is then best-effort cleanup: it frees the request when
   * it wins, and costs nothing when it loses.
   *
   * The rule this generalises to: whoever initiates a cancellation owns the
   * state transition. The async layer's AbortError branch is control flow only
   * — it decides whether the queue advances, not what the message becomes.
   */
  function cancel(id: string): void {
    const message = getState().byId[id];
    // The brief scopes Cancel to messages that are sending.
    if (!message || message.status !== 'sending') return;

    dispatch({ type: 'SEND_CANCELLED', id, attempt: message.attempt });
    aborters.get(id)?.abort();
  }

  /**
   * Withdraw a message that is queued but has not started.
   *
   * A queued row is not `sending`, so per the brief it is not what Cancel
   * covers; it gets its own control rather than overloading that label. The
   * rest of the chain carries on — the withdrawn message has simply left the
   * batch, so the remaining messages are still correctly ordered among
   * themselves.
   */
  function removeFromQueue(id: string): void {
    const message = getState().byId[id];
    if (!message || !message.queued) return;

    const q = queues.get(message.recipient);
    if (q) {
      // Search from the cursor: entries before it have already been consumed,
      // and splicing at or after head leaves the cursor valid.
      const index = q.ids.indexOf(id, q.head);
      if (index >= 0) q.ids.splice(index, 1);
    }

    dispatch({ type: 'DEQUEUED_TO_PENDING', ids: [id] });
  }

  /**
   * Retry one failed message.
   *
   * This deliberately goes through the same enqueue-and-pump path as a bulk
   * send rather than calling runOne directly. Two things fall out of that.
   *
   * Retrying into a busy recipient still serialises correctly: the message
   * joins that recipient's queue and waits its turn, so a retry can never
   * overtake a send already in flight to the same person. And the brief's
   * requirement that retrying one message must not affect others holds by
   * construction — nothing else is touched, and the message gets a fresh
   * AbortController and a fresh attempt token because runOne mints both.
   */
  function retry(id: string): void {
    const message = getState().byId[id];
    if (!message || message.status !== 'failed') return;

    // Clears the error and marks it queued, exactly as a bulk send would.
    dispatch({ type: 'ENQUEUED', ids: [id] });
    getQueue(message.recipient).ids.push(id);
    void pump(message.recipient);
  }

  return { sendSelected, cancel, removeFromQueue, retry };
}

/** React wrapper. Every dependency is stable, so the scheduler is built once. */
export function useDispatcher(
  latest: { current: OutboxState },
  dispatch: Dispatch<OutboxAction>,
  send: SendFn = sendMessage,
): DispatcherApi {
  return useMemo(
    () => createDispatcher(() => latest.current, dispatch, send),
    [latest, dispatch, send],
  );
}
