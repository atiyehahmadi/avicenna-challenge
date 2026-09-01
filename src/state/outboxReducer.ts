import type { Message } from '../types/message';

/**
 * The outbox state machine.
 *
 * This reducer is the ONLY writer of message state, and it is pure and
 * synchronous: it never calls the API and never touches an AbortController.
 * Two things follow from that, and both are the point of the design.
 *
 * 1. Every legal transition is declared in one place, so an illegal one
 *    (delivered going back to sending) is rejected once, rather than at each of
 *    the call sites that could produce it.
 *
 * 2. A reducer alone does NOT solve race conditions. It rejects transitions
 *    that are illegal, but a stale success landing on a message the user has
 *    already cancelled is a perfectly ordinary sending -> delivered. That is
 *    what Message.attempt is for: every async result carries the attempt it was
 *    launched under, and isCurrent() below rejects results belonging to a
 *    superseded request. See src/dispatch/useDispatcher.ts for the other half —
 *    cancellation must dispatch BEFORE it aborts, or the token is never bumped.
 */

/**
 * Explains why messages went back to `pending` without being sent, so the UI
 * can say so rather than leaving a silently-pending row indistinguishable from
 * one that was never dispatched. `seq` increments on every halt so that two
 * identical halts still register as distinct events.
 */
export interface HaltNotice {
  recipient: string;
  count: number;
  seq: number;
}

export interface OutboxState {
  /** Messages by id. O(1) lookup, which every async completion needs. */
  byId: Record<string, Message>;
  /** Creation order. The ordering source of truth, and how focus finds a successor. */
  order: string[];
  /** Replaced on write, never mutated, so referential equality stays meaningful. */
  selectedIds: Set<string>;
  /** Roving-tabindex focus target. A stable id, never an array index. */
  focusedId: string | null;
  /** Row whose detail view is expanded, if any. */
  expandedId: string | null;
  /** Most recent halt, for the status announcement and banner. */
  notice: HaltNotice | null;
  /**
   * Monotonic counter behind HaltNotice.seq. It lives separately from `notice`
   * precisely so that clearing the notice does not reset it: if the sequence
   * restarted, a second halt could reproduce a seq the announcer had already
   * seen and the announcement would be silently skipped.
   */
  noticeSeq: number;
}

export type OutboxAction =
  | { type: 'ADD_MESSAGE'; message: Message }
  | { type: 'DELETE_MESSAGE'; id: string }
  | { type: 'TOGGLE_SELECT'; id: string }
  | { type: 'SET_SELECTION'; ids: string[] }
  | { type: 'CLEAR_SELECTION' }
  | { type: 'SET_FOCUS'; id: string | null }
  | { type: 'TOGGLE_EXPAND'; id: string }
  | { type: 'ENQUEUED'; ids: string[] }
  | {
      type: 'DEQUEUED_TO_PENDING';
      ids: string[];
      /** 'halted' means a sibling failed; 'withdrawn' means the user removed it. */
      reason?: 'halted' | 'withdrawn';
    }
  | { type: 'SEND_STARTED'; id: string; attempt: number }
  | { type: 'SEND_SUCCEEDED'; id: string; attempt: number }
  | { type: 'SEND_FAILED'; id: string; attempt: number; error: string }
  | { type: 'SEND_CANCELLED'; id: string; attempt: number };

export const initialOutboxState: OutboxState = {
  byId: {},
  order: [],
  selectedIds: new Set(),
  focusedId: null,
  expandedId: null,
  notice: null,
  noticeSeq: 0,
};

/** Creates a message. Impure (id + clock), so it lives outside the reducer. */
export function createMessage(draft: {
  recipient: string;
  subject: string;
  body: string;
}): Message {
  return {
    id: crypto.randomUUID(),
    recipient: draft.recipient,
    subject: draft.subject,
    body: draft.body,
    status: 'pending',
    createdAt: Date.now(),
    attempt: 0,
  };
}

/**
 * Replaces one message, leaving every other object reference identical.
 *
 * This structural sharing is what lets React.memo on MessageRow actually bail
 * out: rows whose message did not change receive the very same object, so a
 * shallow prop compare succeeds and one status change re-renders one row
 * instead of all of them.
 */
function setMessage(
  state: OutboxState,
  id: string,
  patch: Partial<Message>,
): OutboxState {
  const current = state.byId[id];
  if (!current) return state;
  return { ...state, byId: { ...state.byId, [id]: { ...current, ...patch } } };
}

/**
 * The stale-result guard. An async result is applied only if the message is
 * still in flight AND the result belongs to the current attempt.
 */
function isCurrent(state: OutboxState, id: string, attempt: number): boolean {
  const m = state.byId[id];
  return !!m && m.status === 'sending' && m.attempt === attempt;
}

export function outboxReducer(
  state: OutboxState,
  action: OutboxAction,
): OutboxState {
  switch (action.type) {
    case 'ADD_MESSAGE': {
      const { message } = action;
      return {
        ...state,
        byId: { ...state.byId, [message.id]: message },
        order: [...state.order, message.id],
        // Focus the first message so the list is immediately navigable;
        // otherwise leave focus wherever the user put it.
        focusedId: state.focusedId ?? message.id,
      };
    }

    case 'DELETE_MESSAGE': {
      const { id } = action;
      if (!state.byId[id]) return state;

      // The successor MUST be computed from the pre-removal order: the next
      // row, or the previous one when the deleted row was last.
      const index = state.order.indexOf(id);
      const successor = state.order[index + 1] ?? state.order[index - 1] ?? null;

      const byId = { ...state.byId };
      delete byId[id];

      const selectedIds = new Set(state.selectedIds);
      selectedIds.delete(id);

      return {
        ...state,
        byId,
        order: state.order.filter((x) => x !== id),
        selectedIds,
        focusedId: state.focusedId === id ? successor : state.focusedId,
        expandedId: state.expandedId === id ? null : state.expandedId,
      };
    }

    case 'TOGGLE_SELECT': {
      if (!state.byId[action.id]) return state;
      const selectedIds = new Set(state.selectedIds);
      if (selectedIds.has(action.id)) selectedIds.delete(action.id);
      else selectedIds.add(action.id);
      return { ...state, selectedIds };
    }

    case 'SET_SELECTION':
      return { ...state, selectedIds: new Set(action.ids) };

    case 'CLEAR_SELECTION':
      return state.selectedIds.size === 0
        ? state
        : { ...state, selectedIds: new Set() };

    case 'SET_FOCUS':
      return state.focusedId === action.id
        ? state
        : { ...state, focusedId: action.id };

    case 'TOGGLE_EXPAND':
      return {
        ...state,
        expandedId: state.expandedId === action.id ? null : action.id,
      };

    case 'ENQUEUED': {
      // Optimistic and synchronous: the click marks everything queued before a
      // single request leaves. A failed message is accepted so that Retry
      // re-enters through exactly the same path as a bulk send.
      let next = state;
      for (const id of action.ids) {
        const m = next.byId[id];
        if (!m || (m.status !== 'pending' && m.status !== 'failed')) continue;
        next = setMessage(next, id, {
          status: 'pending',
          queued: true,
          error: undefined,
        });
      }
      // A new batch supersedes any explanation left over from the previous one.
      return next === state ? state : { ...next, notice: null };
    }

    case 'DEQUEUED_TO_PENDING': {
      // Left the queue without ever being sent: either the group halted after a
      // sibling failed, or the user pulled this one out of the queue.
      let next = state;
      const dequeued: string[] = [];
      for (const id of action.ids) {
        const m = next.byId[id];
        if (!m || !m.queued) continue;
        dequeued.push(id);
        next = setMessage(next, id, { status: 'pending', queued: false });
      }

      if (action.reason === 'halted' && dequeued.length > 0) {
        const seq = state.noticeSeq + 1;
        next = {
          ...next,
          noticeSeq: seq,
          notice: {
            recipient: next.byId[dequeued[0]].recipient,
            count: dequeued.length,
            seq,
          },
        };
      }
      return next;
    }

    case 'SEND_STARTED': {
      const m = state.byId[action.id];
      // Only a pending message may start. A second pump arriving for a message
      // that is already sending is dropped here rather than double-sending.
      if (!m || m.status !== 'pending') return state;
      return setMessage(state, action.id, {
        status: 'sending',
        attempt: action.attempt,
        queued: false,
        error: undefined,
      });
    }

    case 'SEND_SUCCEEDED':
      if (!isCurrent(state, action.id, action.attempt)) return state;
      return setMessage(state, action.id, {
        status: 'delivered',
        error: undefined,
      });

    case 'SEND_FAILED':
      if (!isCurrent(state, action.id, action.attempt)) return state;
      return setMessage(state, action.id, {
        status: 'failed',
        error: action.error,
      });

    case 'SEND_CANCELLED':
      if (!isCurrent(state, action.id, action.attempt)) return state;
      // Bumping the attempt is the whole point. It supersedes the in-flight
      // request immediately, so if the abort loses the race and the request
      // resolves successfully anyway, that result fails isCurrent() and is
      // discarded instead of marking a cancelled message delivered.
      return setMessage(state, action.id, {
        status: 'pending',
        attempt: state.byId[action.id].attempt + 1,
        queued: false,
        error: undefined,
      });

    default: {
      // Exhaustiveness: adding an action without handling it fails the build.
      const _exhaustive: never = action;
      return _exhaustive;
    }
  }
}
