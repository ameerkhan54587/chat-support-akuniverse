/**
 * Format date according to PHP-style format string
 * Supports: d, m, Y, H, i, s, g, A
 */
export function formatDate(date, format = 'd.m.Y H:i', timezoneOffset = 0) {
  if (!date) return '';
  const d = new Date(date);
  if (isNaN(d.getTime())) return '';

  const safeFormat = typeof format === 'string' && format ? format : 'd.m.Y H:i';

  // Apply timezone offset (hours)
  const offsetMs = (parseFloat(timezoneOffset) || 0) * 60 * 60 * 1000;
  const adjustedDate = new Date(d.getTime() + offsetMs);

  const pad = (n) => String(n).padStart(2, '0');

  const day = adjustedDate.getUTCDate();
  const month = adjustedDate.getUTCMonth() + 1;
  const year = adjustedDate.getUTCFullYear();
  const hours24 = adjustedDate.getUTCHours();
  const hours12 = hours24 % 12 || 12;
  const minutes = adjustedDate.getUTCMinutes();
  const seconds = adjustedDate.getUTCSeconds();
  const ampm = hours24 >= 12 ? 'PM' : 'AM';

  return safeFormat
    .replace(/d/g, pad(day))
    .replace(/m/g, pad(month))
    .replace(/Y/g, String(year))
    .replace(/H/g, pad(hours24))
    .replace(/i/g, pad(minutes))
    .replace(/s/g, pad(seconds))
    .replace(/g/g, String(hours12))
    .replace(/A/g, ampm);
}

/**
 * Get date string for divider (only date part)
 */
export function getDateDivider(date, dateFormat = 'd.m.Y', timezoneOffset = 0) {
  return formatDate(date, dateFormat || 'd.m.Y', timezoneOffset);
}

/**
 * Get time string for message
 */
export function getTimeString(date, timeFormat = 'H:i', timezoneOffset = 0) {
  return formatDate(date, timeFormat || 'H:i', timezoneOffset);
}

/**
 * Check if two dates are on different days
 */
export function isDifferentDay(date1, date2, timezoneOffset = 0) {
  const d1 = formatDate(date1, 'd.m.Y', timezoneOffset);
  const d2 = formatDate(date2, 'd.m.Y', timezoneOffset);
  return d1 !== d2;
}
