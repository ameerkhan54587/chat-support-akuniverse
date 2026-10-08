'use strict';

const crypto = require('crypto');

const DIRECTIONS = Object.freeze({
    user: 'client',
    ai: 'support',
    admin: 'internal_team',
});

function normalizeExternalChatEvent(body = {}) {
    const siteId = typeof body.site_id === 'string' ? body.site_id.trim() : '';
    const chatId = body.chat_id === undefined || body.chat_id === null ? '' : String(body.chat_id).trim();
    const sourceEventId = typeof body.source_event_id === 'string' ? body.source_event_id.trim() : '';
    const direction = typeof body.direction === 'string' ? body.direction.trim().toLowerCase() : '';
    const text = typeof body.text === 'string' ? body.text : '';
    const timestamp = typeof body.timestamp === 'string' ? body.timestamp.trim() : '';

    if (!/^[a-z0-9_-]{1,64}$/i.test(siteId)) return { error: 'invalid_site_id' };
    if (!/^-?\d{1,32}$/.test(chatId)) return { error: 'invalid_chat_id' };
    if (!sourceEventId || sourceEventId.length > 128) return { error: 'invalid_source_event_id' };
    if (!Object.hasOwn(DIRECTIONS, direction)) return { error: 'invalid_direction' };
    if (!text.trim() || text.length > 4000) return { error: 'invalid_text' };
    if (!timestamp || !/(?:Z|[+-]\d{2}:?\d{2})$/i.test(timestamp) || Number.isNaN(Date.parse(timestamp))) {
        return { error: 'invalid_timestamp' };
    }

    const username = typeof body.username === 'string' ? body.username.trim().slice(0, 64) : '';
    const displayName = typeof body.display_name === 'string' ? body.display_name.trim().slice(0, 100) : '';
    const sessionId = `telegram:site_${siteId}:${chatId}`;
    const createdAt = new Date(timestamp).toISOString();
    return {
        value: {
            siteId,
            chatId,
            sourceEventId,
            direction,
            sender: DIRECTIONS[direction],
            text,
            timestamp: createdAt,
            sessionId,
            username,
            displayName,
            metadata: {
                user_name: displayName || username || `Telegram user ${chatId}`,
                user_id: chatId,
                user_username: username,
                source: 'telegram',
                channel: 'telegram',
                telegram_bot_id: `site_${siteId}`,
                telegram_bot_name: siteId,
                telegram_chat_id: chatId,
                telegram_site_id: siteId,
                site_id: siteId,
                user_session: sessionId,
            },
        },
    };
}

const MAX_CLOCK_SKEW_SECONDS = 300;

function safeEqualHex(left, right) {
    if (!/^[a-f0-9]{64}$/i.test(left || '') || !/^[a-f0-9]{64}$/i.test(right || '')) return false;
    const leftBytes = Buffer.from(left, 'hex');
    const rightBytes = Buffer.from(right, 'hex');
    return leftBytes.length === rightBytes.length && crypto.timingSafeEqual(leftBytes, rightBytes);
}

function signExternalChatRequest(rawBody, timestamp, nonce, secret) {
    return crypto.createHmac('sha256', secret)
        .update(String(timestamp)).update('.').update(nonce).update('.').update(rawBody)
        .digest('hex');
}

function verifyExternalChatSignature({ rawBody, timestamp, nonce, signature, secret, nowSeconds = Math.floor(Date.now() / 1000) }) {
    if (!Buffer.isBuffer(rawBody) || !secret) return { error: 'signature_not_configured' };
    if (!/^\d{10}$/.test(timestamp || '') || Math.abs(nowSeconds - Number(timestamp)) > MAX_CLOCK_SKEW_SECONDS) {
        return { error: 'stale_timestamp' };
    }
    if (!/^[A-Za-z0-9_-]{16,128}$/.test(nonce || '')) return { error: 'invalid_nonce' };
    const expected = signExternalChatRequest(rawBody, timestamp, nonce, secret);
    if (!safeEqualHex(expected, signature)) return { error: 'invalid_signature' };
    return { value: { timestamp: Number(timestamp), nonce } };
}

module.exports = { DIRECTIONS, normalizeExternalChatEvent, MAX_CLOCK_SKEW_SECONDS, signExternalChatRequest, verifyExternalChatSignature };
