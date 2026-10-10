import test from 'node:test';
import assert from 'node:assert/strict';
import { formatRelativeTime } from './relativeTime.js';

const now = Date.parse('2026-10-10T12:00:00.000Z');
const ago = milliseconds => new Date(now - milliseconds).toISOString();

test('formats recent message ages in seconds, minutes, and hours', () => {
  assert.equal(formatRelativeTime(ago(0), now), 'just now');
  assert.equal(formatRelativeTime(ago(1_000), now), '1 sec ago');
  assert.equal(formatRelativeTime(ago(59_000), now), '59 secs ago');
  assert.equal(formatRelativeTime(ago(60_000), now), '1 min ago');
  assert.equal(formatRelativeTime(ago(3_600_000), now), '1 hour ago');
  assert.equal(formatRelativeTime(ago(23 * 3_600_000), now), '23 hours ago');
});

test('uses Yesterday for the preceding local calendar day, then the configured date', () => {
  assert.equal(formatRelativeTime('2026-10-09T10:00:00.000Z', now), 'Yesterday');
  assert.equal(formatRelativeTime('2026-10-08T10:00:00.000Z', now), '08.10.2026');
  assert.equal(formatRelativeTime('2026-10-09T15:00:00.000Z', now, 5), '21 hours ago');
  assert.equal(formatRelativeTime('2026-10-08T10:00:00.000Z', now, 5, 'Y-m-d'), '2026-10-08');
});

test('handles invalid and future timestamps without negative durations', () => {
  assert.equal(formatRelativeTime('not-a-date', now), '');
  assert.equal(formatRelativeTime('2026-10-10T12:01:00.000Z', now), 'just now');
});
