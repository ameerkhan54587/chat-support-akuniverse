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
    const mediaBase64 = typeof body.media_base64 === 'string' ? body.media_base64 : '';
    const mediaMime = typeof body.media_mime === 'string' ? body.media_mime.trim().toLowerCase() : '';
    const caption = typeof body.caption === 'string' ? body.caption : '';
    const timestamp = typeof body.timestamp === 'string' ? body.timestamp.trim() : '';

    if (!/^[a-z0-9_-]{1,64}$/i.test(siteId)) return { error: 'invalid_site_id' };
    if (!/^-?\d{1,32}$/.test(chatId)) return { error: 'invalid_chat_id' };
    if (!sourceEventId || sourceEventId.length > 128) return { error: 'invalid_source_event_id' };
    if (!Object.hasOwn(DIRECTIONS, direction)) return { error: 'invalid_direction' };
    const hasImage = !!mediaBase64 || !!mediaMime;
    if (!text.trim() && !hasImage) return { error: 'invalid_text' };
    if (text.length > 4000) return { error: 'invalid_text' };
    let mediaBytes = null;
    if (hasImage) {
        if (!/^image\/(jpeg|png|gif|webp)$/.test(mediaMime) || !mediaBase64 || mediaBase64.length > Math.ceil(5 * 1024 * 1024 / 3) * 4) return { error: 'invalid_media' };
        if (/[^A-Za-z0-9+/=]/.test(mediaBase64) || mediaBase64.length % 4 !== 0) return { error: 'invalid_media' };
        mediaBytes = Buffer.from(mediaBase64, 'base64');
        if (!mediaBytes.length || mediaBytes.length > 5 * 1024 * 1024 || mediaBytes.toString('base64') !== mediaBase64) return { error: 'invalid_media' };
        const jpeg = mediaBytes.length >= 4 && mediaBytes.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff])) && mediaBytes.subarray(-2).equals(Buffer.from([0xff, 0xd9]));
        const png = mediaBytes.length >= 20 && mediaBytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) && mediaBytes.subarray(-8).equals(Buffer.from([0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82]));
        const gif = mediaBytes.length >= 14 && /^GIF8[79]a$/.test(mediaBytes.subarray(0, 6).toString('ascii')) && mediaBytes.subarray(-1).equals(Buffer.from([0x3b]));
        const webp = mediaBytes.length >= 12 && mediaBytes.subarray(0, 4).toString('ascii') === 'RIFF' && mediaBytes.subarray(8, 12).toString('ascii') === 'WEBP' && mediaBytes.readUInt32LE(4) + 8 <= mediaBytes.length;
        if ((mediaMime === 'image/jpeg' && !jpeg) || (mediaMime === 'image/png' && !png) || (mediaMime === 'image/gif' && !gif) || (mediaMime === 'image/webp' && !webp)) return { error: 'invalid_media' };
        if (caption.length > 1024) return { error: 'invalid_caption' };
    } else if (caption) return { error: 'invalid_caption' };
    if (!timestamp || !/(?:Z|[+-]\d{2}:?\d{2})$/i.test(timestamp) || Number.isNaN(Date.parse(timestamp))) {
        return { error: 'invalid_timestamp' };
    }

    const username = typeof body.username === 'string' ? body.username.trim().replace(/^@/, '').slice(0, 64) : '';
    const firstName = typeof body.first_name === 'string' ? body.first_name.trim().slice(0, 100) : '';
    const lastName = typeof body.last_name === 'string' ? body.last_name.trim().slice(0, 100) : '';
    const displayName = typeof body.display_name === 'string' ? body.display_name.trim().slice(0, 100) : '';
    const fullName = [firstName, lastName].filter(Boolean).join(' ').trim().slice(0, 100);
    const bestName = fullName || displayName || username || `Telegram user ${chatId}`;
    const sessionId = `telegram:site_${siteId}:${chatId}`;
    const createdAt = new Date(timestamp).toISOString();
    return {
        value: {
            siteId,
            chatId,
            sourceEventId,
            direction,
            sender: DIRECTIONS[direction],
            text: mediaBytes ? `[photo]${caption.trim() ? ` ${caption.trim()}` : ''}` : text,
            mediaBytes,
            mediaMime: mediaBytes ? mediaMime : '',
            timestamp: createdAt,
            sessionId,
            username,
            displayName: bestName,
            firstName,
            lastName,
            metadata: {
                user_name: bestName,
                user_first_name: firstName,
                user_last_name: lastName,
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
