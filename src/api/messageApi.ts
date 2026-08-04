/**
 * Mock message-sending API.
 *
 * - Takes 1–3 seconds
 * - Fails ~30% of the time
 * - Respects AbortSignal
 * - Responses can complete in any order
 */

const FAILURE_RATE = 0.3;
const MIN_DELAY_MS = 1000;
const MAX_DELAY_MS = 3000;

function randomDelay(): number {
  return (
    Math.floor(Math.random() * (MAX_DELAY_MS - MIN_DELAY_MS + 1)) + MIN_DELAY_MS
  );
}

export async function sendMessage(
  messageId: string,
  signal?: AbortSignal,
): Promise<void> {
  // Respect an already-aborted signal
  if (signal?.aborted) {
    throw new DOMException('The operation was aborted', 'AbortError');
  }

  const delay = randomDelay();

  let timeoutId: ReturnType<typeof setTimeout> | null = null;
  let settled = false;

  return new Promise<void>((resolve, reject) => {
    function settle(fn: () => void) {
      if (settled) return; // Prevent double-settling (race between timeout and abort)
      settled = true;
      if (timeoutId !== null) clearTimeout(timeoutId);
      signal?.removeEventListener('abort', onAbort);
      fn();
    }

    function onAbort() {
      settle(() =>
        reject(new DOMException('The operation was aborted', 'AbortError')),
      );
    }

    timeoutId = setTimeout(() => {
      settle(() => {
        if (Math.random() < FAILURE_RATE) {
          reject(
            new Error(`Failed to send message ${messageId}: Network error`),
          );
        } else {
          resolve();
        }
      });
    }, delay);

    signal?.addEventListener('abort', onAbort, { once: true });
  });
}
