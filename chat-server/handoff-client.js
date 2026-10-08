'use strict';

const crypto = require('crypto');

// Destinations are fixed in code, never read from customer- or admin-controlled metadata.
const HANDOFF_ENDPOINTS = Object.freeze({
    smsotps: 'https://api.smsotps.com/api/support/handoff',
    smsactivate: 'https://api.smsactivate.uk/api/support/handoff',
});

const REPLY_ENDPOINTS = Object.freeze({
    smsotps: 'https://api.smsotps.com/api/support/reply',
});

function createHandoffRequest({ siteId, secret, apiKey, chatId, nowSeconds = Math.floor(Date.now() / 1000) }) {
    const endpoint = HANDOFF_ENDPOINTS[String(siteId || '').toLowerCase()];
    if (!endpoint || !secret) return { skipped: true, reason: 'handoff_not_configured' };
    const normalizedChatId = String(chatId || '').trim();
    if (!/^-?\d{1,32}$/.test(normalizedChatId)) return { error: 'invalid_chat_id' };
    const timestamp = String(nowSeconds);
    const body = JSON.stringify({ chat_id: normalizedChatId });
    const signature = crypto.createHmac('sha256', secret).update(timestamp).update('.').update(body).digest('hex');
    return {
        endpoint,
        body,
        headers: {
            'Content-Type': 'application/json',
            ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
            'X-Handoff-Timestamp': timestamp,
            'X-Handoff-Signature': signature,
        },
    };
}

async function notifySiteHandoff(options, fetchImpl = globalThis.fetch) {
    const request = createHandoffRequest(options);
    if (request.skipped || request.error) return request;
    try {
        const response = await fetchImpl(request.endpoint, {
            method: 'POST', headers: request.headers, body: request.body,
            signal: AbortSignal.timeout(5000),
        });
        return response.ok ? { success: true, status: response.status } : { error: 'site_rejected', status: response.status };
    } catch (error) {
        return { error: 'site_unavailable', message: String(error?.message || 'unknown').slice(0, 160) };
    }
}


function createSiteReplyRequest({ siteId, secret, chatId, text, nowSeconds = Math.floor(Date.now() / 1000) }) {
    const endpoint = REPLY_ENDPOINTS[String(siteId || '').toLowerCase()];
    if (!endpoint || !secret) return { skipped: true, reason: 'site_reply_not_configured' };
    const normalizedChatId = String(chatId || '').trim();
    if (!/^-?\d{1,32}$/.test(normalizedChatId)) return { error: 'invalid_chat_id' };
    if (typeof text !== 'string' || !text.trim() || text.length > 4000) return { error: 'invalid_text' };
    const timestamp = String(nowSeconds);
    const body = JSON.stringify({ chat_id: normalizedChatId, text });
    const signature = crypto.createHmac('sha256', secret).update(timestamp).update('.').update(body).digest('hex');
    return { endpoint, body, headers: { 'Content-Type': 'application/json', 'X-Handoff-Timestamp': timestamp, 'X-Handoff-Signature': signature } };
}

async function sendSiteReply(options, fetchImpl = globalThis.fetch) {
    const request = createSiteReplyRequest(options);
    if (request.skipped || request.error) return request;
    try {
        const response = await fetchImpl(request.endpoint, { method: 'POST', headers: request.headers, body: request.body, signal: AbortSignal.timeout(10000) });
        return response.ok ? { success: true, status: response.status } : { error: 'site_rejected', status: response.status };
    } catch (error) {
        return { error: 'site_unavailable', message: String(error?.message || 'unknown').slice(0, 160) };
    }
}

function signSiteHandoffRequest(rawBody, timestamp, secret) {
    return crypto.createHmac('sha256', secret).update(String(timestamp)).update('.').update(rawBody).digest('hex');
}

function verifySiteHandoffSignature({ rawBody, timestamp, signature, secret, nowSeconds = Math.floor(Date.now() / 1000) }) {
    if (!Buffer.isBuffer(rawBody) || !secret) return { error: 'signature_not_configured' };
    if (!/^\d{10}$/.test(timestamp || '') || Math.abs(nowSeconds - Number(timestamp)) > 300) return { error: 'stale_timestamp' };
    if (!/^[a-f0-9]{64}$/i.test(signature || '')) return { error: 'invalid_signature' };
    const expected = Buffer.from(signSiteHandoffRequest(rawBody, timestamp, secret), 'hex');
    const supplied = Buffer.from(signature, 'hex');
    return crypto.timingSafeEqual(expected, supplied) ? { value: { timestamp: Number(timestamp) } } : { error: 'invalid_signature' };
}

module.exports = { HANDOFF_ENDPOINTS, REPLY_ENDPOINTS, createHandoffRequest, notifySiteHandoff, createSiteReplyRequest, sendSiteReply, signSiteHandoffRequest, verifySiteHandoffSignature };
