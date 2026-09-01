export type MessageStatus = 'pending' | 'sending' | 'delivered' | 'failed';

export interface Message {
  id: string;
  recipient: string;
  subject: string;
  body: string;
  status: MessageStatus;
  createdAt: number;

  /**
   * Fencing token. Incremented every time a send is started for this message.
   *
   * Async results carry the attempt they were launched under, and the reducer
   * drops any result whose attempt no longer matches. This is what makes
   * cancellation correct: `AbortSignal` alone is not enough, because an abort
   * that arrives after the request has already settled is a silent no-op (see
   * `settle()` in src/api/messageApi.ts, which removes the abort listener when
   * the request resolves). Without the token, that stale success would land on
   * a message the user had just cancelled.
   */
  attempt: number;

  /** Failure reason, shown as the error indicator. Cleared on retry. */
  error?: string;

  /**
   * Display-only: this message is waiting behind another send to the same
   * recipient. Deliberately NOT a `MessageStatus` — the state machine in the
   * brief has no queued state, and a queued message genuinely is still pending
   * because nothing has been sent yet.
   */
  queued?: boolean;
}
