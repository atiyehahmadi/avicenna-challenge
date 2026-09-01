import { describe, expect, it } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import userEvent, { type UserEvent } from '@testing-library/user-event';
import { OutboxProvider } from '../state/OutboxContext';
import type { SendFn } from '../dispatch/useDispatcher';
import { ComposeForm } from './ComposeForm';
import { Toolbar } from './Toolbar';
import { MessageList } from './MessageList';

/**
 * Focus behaviour, which is the part of requirement 7 that a written
 * description cannot really evidence.
 *
 * Both tests assert on document.activeElement rather than on a class or an
 * attribute, because "focus survived" is a statement about the browser's focus,
 * not about how the row happens to be styled.
 */

function createSender() {
  const open = new Map<string, () => void>();
  const send: SendFn = (id) =>
    new Promise<void>((resolve) => {
      open.set(id, resolve);
    });
  return {
    send,
    async settle(id: string) {
      await act(async () => {
        open.get(id)?.();
        open.delete(id);
        await Promise.resolve();
      });
    },
  };
}

function renderOutbox(send?: SendFn) {
  render(
    <OutboxProvider send={send}>
      <ComposeForm />
      <Toolbar />
      <MessageList />
    </OutboxProvider>,
  );
}

async function compose(user: UserEvent, recipient: string, subject: string) {
  await user.type(screen.getByLabelText('Recipient'), recipient);
  await user.type(screen.getByLabelText('Subject'), subject);
  await user.type(screen.getByLabelText('Message'), 'body text');
  await user.click(screen.getByRole('button', { name: /add to outbox/i }));
}

const rows = () =>
  Array.from(document.querySelectorAll<HTMLElement>('[data-message-id]'));

describe('message list focus', () => {
  it('keeps focus on a row while its status changes, and never steals it', async () => {
    const user = userEvent.setup();
    const sender = createSender();
    renderOutbox(sender.send);

    // Distinct recipients so all three dispatch concurrently.
    await compose(user, 'alice', 'first');
    await compose(user, 'bob', 'second');
    await compose(user, 'carol', 'third');

    await user.click(screen.getByRole('checkbox', { name: /select all pending/i }));
    await user.click(screen.getByRole('button', { name: /send selected/i }));

    // Focus a row only after the dispatch is under way. Clicking the Send
    // button moves focus to the button, as any button does — the requirement is
    // that the app never steals focus once the user has placed it, so that is
    // what gets tested.
    const [, secondRow] = rows();
    const secondId = secondRow.dataset.messageId!;
    expect(secondRow.dataset.status).toBe('sending');

    act(() => secondRow.focus());
    expect(secondRow).toHaveFocus();

    await sender.settle(secondId);

    // pending -> sending -> delivered, all without disturbing focus. The row
    // element is the same node throughout because rows are keyed by message id.
    expect(secondRow.dataset.status).toBe('delivered');
    expect(secondRow).toHaveFocus();

    // Now the harder half: while other rows are still changing status, the user
    // starts typing in the compose form. Focus must not be dragged back into
    // the list. This is what the wantFocus guard in useRovingFocus exists for —
    // an effect that refocused on every render would fail here.
    const textarea = screen.getByLabelText('Message');
    await user.click(textarea);
    expect(textarea).toHaveFocus();

    await sender.settle(rows()[0].dataset.messageId!);
    await sender.settle(rows()[2].dataset.messageId!);

    expect(rows()[0].dataset.status).toBe('delivered');
    expect(textarea).toHaveFocus();
  });

  it('moves focus to the next row on removal, or the previous one for the last', async () => {
    const user = userEvent.setup();
    renderOutbox();

    await compose(user, 'alice', 'first');
    await compose(user, 'alice', 'second');
    await compose(user, 'alice', 'third');

    const initial = rows();
    const [firstId, secondId, thirdId] = initial.map(
      (row) => row.dataset.messageId!,
    );

    // Delete a middle row: focus should land on the row that followed it.
    act(() => initial[1].focus());
    expect(initial[1]).toHaveFocus();
    await user.keyboard('{Delete}');

    expect(rows().map((row) => row.dataset.messageId)).toEqual([
      firstId,
      thirdId,
    ]);
    expect(document.activeElement).toBe(
      document.querySelector(`[data-message-id="${thirdId}"]`),
    );
    expect(secondId).not.toBe(thirdId);

    // Delete the last row: with no successor, focus falls back to the previous.
    const last = rows()[1];
    act(() => last.focus());
    await user.keyboard('{Delete}');

    expect(rows()).toHaveLength(1);
    expect(document.activeElement).toBe(
      document.querySelector(`[data-message-id="${firstId}"]`),
    );

    // Focus is a real DOM concern here, not just a rendered attribute.
    expect(document.activeElement).not.toBe(document.body);
  });
});
