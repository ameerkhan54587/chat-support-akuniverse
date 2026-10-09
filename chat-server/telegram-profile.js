'use strict';

// Telegram has no public profile-photo URL in Update objects. Use its bot API
// getUserProfilePhotos/getFile and serve the result through our own image proxy.
function telegramProfilePhotoUrl(bot, userId) {
  if (!bot?.siteId || !userId) return '';
  return `/api/telegram/users/${encodeURIComponent(bot.siteId)}/${encodeURIComponent(userId)}/photo`;
}
module.exports = { telegramProfilePhotoUrl };
