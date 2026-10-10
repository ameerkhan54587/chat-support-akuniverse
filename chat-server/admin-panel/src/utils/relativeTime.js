import { formatDate } from './dateUtils.js';

const minute = 60_000;
const hour = 60 * minute;
const day = 24 * hour;

function localDayStart(value, timezoneOffset) {
  const offsetMs = (parseFloat(timezoneOffset) || 0) * hour;
  const local = new Date(value + offsetMs);
  return Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate());
}

export function formatRelativeTime(timestamp, now = Date.now(), timezoneOffset = 0, dateFormat = 'd.m.Y') {
  if (!timestamp) return '';
  const messageTime = new Date(timestamp).getTime();
  if (!Number.isFinite(messageTime)) return '';

  const elapsed = Math.max(0, now - messageTime);
  if (elapsed < 1_000) return 'just now';
  if (elapsed < minute) {
    const seconds = Math.floor(elapsed / 1_000);
    return `${seconds} sec${seconds === 1 ? '' : 's'} ago`;
  }
  if (elapsed < hour) {
    const minutes = Math.floor(elapsed / minute);
    return `${minutes} min${minutes === 1 ? '' : 's'} ago`;
  }
  if (elapsed < day) {
    const hours = Math.floor(elapsed / hour);
    return `${hours} hour${hours === 1 ? '' : 's'} ago`;
  }

  if (localDayStart(messageTime, timezoneOffset) === localDayStart(now, timezoneOffset) - day) return 'Yesterday';
  return formatDate(timestamp, dateFormat || 'd.m.Y', timezoneOffset);
}
