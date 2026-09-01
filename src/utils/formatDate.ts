/**
 * Date formatting via the Intl API — no date library.
 *
 * Intl.RelativeTimeFormat and Intl.DateTimeFormat are built into every browser
 * this targets, they are locale-aware for free, and they cost nothing in bundle
 * size. Both formatters are created once at module scope because constructing
 * an Intl formatter is comparatively expensive and these are called for every
 * row on every render.
 */

const relative = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });

const absolute = new Intl.DateTimeFormat(undefined, {
  dateStyle: 'medium',
  timeStyle: 'short',
});

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const WEEK = 7 * DAY;

/**
 * "just now", "2 minutes ago", "yesterday". `now` is injectable so this stays
 * deterministic under test.
 */
export function formatRelativeTime(timestamp: number, now = Date.now()): string {
  const elapsed = timestamp - now;
  const magnitude = Math.abs(elapsed);

  if (magnitude < MINUTE) return 'just now';
  if (magnitude < HOUR) return relative.format(Math.round(elapsed / MINUTE), 'minute');
  if (magnitude < DAY) return relative.format(Math.round(elapsed / HOUR), 'hour');
  if (magnitude < WEEK) return relative.format(Math.round(elapsed / DAY), 'day');
  return relative.format(Math.round(elapsed / WEEK), 'week');
}

/** Full timestamp, used as the tooltip behind the relative label. */
export function formatAbsoluteTime(timestamp: number): string {
  return absolute.format(timestamp);
}

/** Machine-readable value for the <time> element's dateTime attribute. */
export function toIsoString(timestamp: number): string {
  return new Date(timestamp).toISOString();
}
