import { describe, expect, it } from 'vitest';
import { createDispatcher, type SendFn } from './useDispatcher';
import {
  initialOutboxState,
  outboxReducer,
  type OutboxAction,
  type OutboxState,
} from '../state/outboxReducer';
import type { Message } from '../types/message';

/**
 * Three tests, chosen deliberately.
 *
 * The rule for what gets a test here: the claims that cannot be verified by
 * clicking. Serialisation you can watch happen in the UI. A cancel whose abort
 * loses the race you cannot — it depends on the relative timing of a 1–3 second
 * request and a random 30% failure, which is exactly what a hand-driven sender
 * removes.
 *
 * This is why `createDispatcher` takes its send function as a parameter: the
 * async boundary is the layer that owns time, randomness and the network, and
 * that is precisely the seam you need to control to reason about the code.
 */

/** Lets awaited continuations run. */
const flush = () => new Promise<void>((resolve) => setImmediate(resolve));

/**
 * A sender nothing settles until the test says so.
 *
 * It replicates the guard in the real messageApi: once a request has settled,
 * its abort listener is gone and abort() does nothing. That detail is the whole
 * subject of the third test.
 */
function createSender() {
  const calls: string[] = [];
  const open = new Map<
    string,
    { resolve: () => void; reject: (reason: unknown) => void; settled: boolean }
  >();

  const send: SendFn = (id, signal) =>
    new Promise<void>((resolve, reject) => {
      calls.push(id);
      const entry = { resolve, reject, settled: false };
      open.set(id, entry);
      signal?.addEventListener(
        'abort',
        () => {
          if (entry.settled) return; // first settle wins, as in messageApi
          entry.settled = true;
          reject(new DOMException('The operation was aborted', 'AbortError'));
        },
        { once: true },
      );
    });

  return {
    send,
    calls,
    succeed(id: string) {
      const entry = open.get(id);
      if (!entry || entry.settled) return;
      entry.settled = true;
      entry.resolve();
    },
    fail(id: string, reason: string) {
      const entry = open.get(id);
      if (!entry || entry.settled) return;
      entry.settled = true;
      entry.reject(new Error(reason));
    },
  };
}

/** The real reducer, applied synchronously — no React involved. */
function createStore(seed: Array<{ id: string; recipient: string }>) {
  let state: OutboxState = initialOutboxState;
  const dispatch = (action: OutboxAction) => {
    state = outboxReducer(state, action);
  };

  seed.forEach((entry, index) =>
    dispatch({
      type: 'ADD_MESSAGE',
      message: {
        id: entry.id,
        recipient: entry.recipient,
        subject: `subject ${entry.id}`,
        body: 'body',
        status: 'pending',
        createdAt: 1_000 + index,
        attempt: 0,
      } satisfies Message,
    }),
  );

  return {
    dispatch,
    getState: () => state,
    statusOf: (id: string) => state.byId[id].status,
    attemptOf: (id: string) => state.byId[id].attempt,
    isQueued: (id: string) => state.byId[id].queued === true,
    selectAll: () => dispatch({ type: 'SET_SELECTION', ids: state.order }),
  };
}

describe('dispatch scheduler', () => {
  it('serialises one recipient while running recipients concurrently', async () => {
    // Insertion order deliberately scrambles creation order, so the scheduler
    // has to sort rather than luck into the right sequence.
    const store = createStore([
      { id: 'alice-1', recipient: 'alice' },
      { id: 'bob-1', recipient: 'bob' },
      { id: 'alice-2', recipient: 'alice' },
      { id: 'alice-3', recipient: 'alice' },
    ]);
    const sender = createSender();
    const dispatcher = createDispatcher(
      store.getState,
      store.dispatch,
      sender.send,
    );

    store.selectAll();
    dispatcher.sendSelected();
    await flush();

    // One in flight per recipient, both recipients at once.
    expect(sender.calls).toEqual(['alice-1', 'bob-1']);
    expect(store.statusOf('alice-1')).toBe('sending');
    expect(store.statusOf('bob-1')).toBe('sending');

    // Optimistic feedback without inventing a fifth state: the waiting
    // messages are flagged queued while their status stays pending.
    expect(store.statusOf('alice-2')).toBe('pending');
    expect(store.isQueued('alice-2')).toBe(true);

    sender.succeed('alice-1');
    await flush();
    expect(store.statusOf('alice-1')).toBe('delivered');
    expect(sender.calls).toContain('alice-2');
    expect(sender.calls).not.toContain('alice-3');

    sender.succeed('alice-2');
    sender.succeed('bob-1');
    await flush();
    sender.succeed('alice-3');
    await flush();

    // Alice's messages were issued strictly in creation order.
    expect(sender.calls.filter((id) => id.startsWith('alice'))).toEqual([
      'alice-1',
      'alice-2',
      'alice-3',
    ]);
  });

  it('halts the rest of a recipient chain when one message fails', async () => {
    const store = createStore([
      { id: 'alice-1', recipient: 'alice' },
      { id: 'alice-2', recipient: 'alice' },
      { id: 'alice-3', recipient: 'alice' },
      { id: 'bob-1', recipient: 'bob' },
    ]);
    const sender = createSender();
    const dispatcher = createDispatcher(
      store.getState,
      store.dispatch,
      sender.send,
    );

    store.selectAll();
    dispatcher.sendSelected();
    await flush();

    sender.fail('alice-1', 'Network error');
    await flush();

    expect(store.statusOf('alice-1')).toBe('failed');

    // The queued siblings return to pending rather than being marked failed:
    // they were never attempted, and the user re-decides.
    expect(store.statusOf('alice-2')).toBe('pending');
    expect(store.statusOf('alice-3')).toBe('pending');
    expect(store.isQueued('alice-2')).toBe(false);
    expect(sender.calls).not.toContain('alice-2');
    expect(sender.calls).not.toContain('alice-3');

    // ...and the explanation is recorded, so the UI can say why.
    expect(store.getState().notice).toMatchObject({
      recipient: 'alice',
      count: 2,
    });

    // A different recipient is untouched by any of it.
    expect(store.statusOf('bob-1')).toBe('sending');
    sender.succeed('bob-1');
    await flush();
    expect(store.statusOf('bob-1')).toBe('delivered');
  });

  it('keeps a cancelled message pending even when the abort loses the race', async () => {
    const store = createStore([{ id: 'alice-1', recipient: 'alice' }]);
    const sender = createSender();
    const dispatcher = createDispatcher(
      store.getState,
      store.dispatch,
      sender.send,
    );

    store.selectAll();
    dispatcher.sendSelected();
    await flush();
    expect(store.statusOf('alice-1')).toBe('sending');
    expect(store.attemptOf('alice-1')).toBe(1);

    // The request settles FIRST, exactly as the real timer does when it wins.
    // From here the abort listener is gone and abort() is a silent no-op.
    sender.succeed('alice-1');
    // ...and only now does the user press Cancel.
    dispatcher.cancel('alice-1');
    await flush();

    // Without the fencing token this reads 'delivered': the resolved request
    // would land on a message the user had already cancelled. cancel()
    // dispatches before it aborts, which bumps the attempt and makes the
    // in-flight result stale, so the reducer discards it.
    expect(store.statusOf('alice-1')).toBe('pending');
    expect(store.attemptOf('alice-1')).toBe(2);
  });
});
