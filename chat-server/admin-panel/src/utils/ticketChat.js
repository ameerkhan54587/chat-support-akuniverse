export function ticketsForChat(tickets, userId, info = {}) {
  const sessionIds = new Set(
    [userId, info?.user_session]
      .filter(value => value !== null && value !== undefined && String(value).trim())
      .map(String)
  );
  if (sessionIds.size === 0) return [];
  return (Array.isArray(tickets) ? tickets : []).filter(ticket =>
    ticket.session_id !== null && ticket.session_id !== undefined && sessionIds.has(String(ticket.session_id))
  );
}

export function chatIdForTicket(ticket, users, usersInfo = {}) {
  if (!ticket?.session_id) return null;
  return (users || []).find(userId => {
    const info = usersInfo[userId] || {};
    return String(userId) === String(ticket.session_id) ||
      (info.user_session !== null && info.user_session !== undefined && String(info.user_session) === String(ticket.session_id));
  }) || null;
}

export function getConversationChannel(userId, info = {}) {
  if (info.channel === 'telegram' || info.source === 'telegram' || info.telegram_bot_name || info.telegram_bot_id || info.telegram_chat_id || String(userId).startsWith('telegram:') || String(userId).startsWith('tg_')) return 'telegram';
  if (info.channel === 'email' || info.source === 'email' || String(userId).startsWith('email_')) return 'email';
  return 'widget';
}

export function conversationsForChannel(userIds, usersInfo = {}, channel) {
  return (userIds || []).filter(userId => getConversationChannel(userId, usersInfo[userId] || {}) === channel);
}


const SITE_LABELS = {
  smsactivate: 'SMS Activate',
  smsotps: 'SMS OTPs',
  fbverse_bot: 'FBVerse Bot',
  turboproxy: 'TurboProxy',
  buypvaaccs: 'BuyPVA',
};

export function getConversationBrand(userId, info = {}) {
  const canonicalSession = String(userId || '').match(/^telegram:site_([^:]+):/i)?.[1];
  const explicitId = info.site_id || info.siteId || info.telegram_site_id || '';
  const nameText = [info.telegram_bot_name, info.bot_name, info.site_name, info.site].filter(Boolean).join(' ').toLowerCase();
  const sessionBotId = String(userId || '').match(/^telegram:([^:]+):/)?.[1] || '';
  const botText = [info.telegram_bot_id, info.telegram_bot_name, sessionBotId].filter(Boolean).join(' ').toLowerCase();
  const normalizedId = String(canonicalSession || explicitId).toLowerCase().replace(/^site_/, '');

  if (normalizedId && SITE_LABELS[normalizedId]) return SITE_LABELS[normalizedId];
  if (normalizedId && /^\d+$/.test(normalizedId)) return `Site #${normalizedId}`;
  if (/(sms\s*-?\s*activate|smsactivate|smsactivateukbot)/.test(nameText + ' ' + botText)) return SITE_LABELS.smsactivate;
  if (/(sms\s*-?\s*otps|smsotps|smsotps_officialbot)/.test(nameText + ' ' + botText)) return SITE_LABELS.smsotps;
  if (/(fbverse|fbversebot)/.test(nameText + ' ' + botText)) return SITE_LABELS.fbverse_bot;
  if (/(turboproxy)/.test(nameText + ' ' + botText)) return SITE_LABELS.turboproxy;
  if (/(buypva)/.test(nameText + ' ' + botText)) return SITE_LABELS.buypvaaccs;
  if (info.telegram_bot_name) return info.telegram_bot_name;
  if (info.site_name || info.site) return info.site_name || info.site;
  return 'Other Telegram';
}

export function groupConversationsByBrand(userIds, usersInfo = {}) {
  const groups = new Map();
  for (const userId of userIds || []) {
    const label = getConversationBrand(userId, usersInfo[userId] || {});
    if (!groups.has(label)) groups.set(label, []);
    groups.get(label).push(userId);
  }
  const ordered = [...groups.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  return ordered.map(([label, conversations]) => ({
    label,
    conversations: conversations.sort((a, b) => Number(Boolean(usersInfo[b]?.lastMessage?.timestamp)) - Number(Boolean(usersInfo[a]?.lastMessage?.timestamp))),
  }));
}


export const TELEGRAM_BRAND_TABS = [
  { id: 'brand:fbverse_bot', label: 'FBVerse Bot', siteId: 'fbverse_bot' },
  { id: 'brand:smsactivate', label: 'SMS Activate', siteId: 'smsactivate' },
  { id: 'brand:smsotps', label: 'SMS OTPs', siteId: 'smsotps' },
];

export function brandTabForConversation(userId, info = {}) {
  const brand = getConversationBrand(userId, info);
  const match = TELEGRAM_BRAND_TABS.find(tab => tab.label === brand);
  return match?.id || (getConversationChannel(userId, info) === 'widget' ? 'widget' : 'brand:other');
}

export function conversationsForBrand(userIds, usersInfo = {}, brandId) {
  const tab = TELEGRAM_BRAND_TABS.find(item => item.id === brandId);
  if (!tab) return [];
  return (userIds || []).filter(userId => {
    const info = usersInfo[userId] || {};
    return getConversationChannel(userId, info) === 'telegram' && getConversationBrand(userId, info) === tab.label;
  });
}
