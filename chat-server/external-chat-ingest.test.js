'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeExternalChatEvent, signExternalChatRequest, verifyExternalChatSignature } = require('./external-chat-ingest');

const event = {
    site_id: 'smsotps',
    chat_id: '8975496349',
    source_event_id: 'support_messages:42',
    direction: 'user',
    text: 'Help please',
    timestamp: '2026-10-08 16:03:20+00:00',
    username: 'ameer_khan07',
    display_name: 'Ameer',
    first_name: 'Ameer',
    last_name: 'Khan',
};

test('normalizes an external user message into the shared Telegram chat format', () => {
    const result = normalizeExternalChatEvent(event);
    assert.equal(result.error, undefined);
    assert.equal(result.value.sessionId, 'telegram:site_smsotps:8975496349');
    assert.equal(result.value.sender, 'client');
    assert.equal(result.value.timestamp, '2026-10-08T16:03:20.000Z');
    assert.equal(result.value.metadata.site_id, 'smsotps');
    assert.equal(result.value.metadata.user_username, 'ameer_khan07');
    assert.equal(result.value.metadata.user_name, 'Ameer Khan');
    assert.equal(result.value.metadata.user_first_name, 'Ameer');
    assert.equal(result.value.metadata.user_last_name, 'Khan');
});

test('maps AI and admin messages to console senders', () => {
    assert.equal(normalizeExternalChatEvent({ ...event, direction: 'ai' }).value.sender, 'support');
    assert.equal(normalizeExternalChatEvent({ ...event, direction: 'admin' }).value.sender, 'internal_team');
    assert.equal(normalizeExternalChatEvent({ ...event, direction: 'ai' }).value.sender, 'support');
});

test('rejects notice and invalid input', () => {
    assert.equal(normalizeExternalChatEvent({ ...event, direction: 'notice' }).error, 'invalid_direction');
    assert.equal(normalizeExternalChatEvent({ ...event, source_event_id: '' }).error, 'invalid_source_event_id');
    assert.equal(normalizeExternalChatEvent({ ...event, chat_id: 'not-numeric' }).error, 'invalid_chat_id');
    assert.equal(normalizeExternalChatEvent({ ...event, timestamp: 'yesterday' }).error, 'invalid_timestamp');
    assert.equal(normalizeExternalChatEvent({ ...event, text: '   ' }).error, 'invalid_text');
});


test('verifies HMAC over exact raw bytes, timestamp, and nonce', () => {
    const rawBody = Buffer.from('{"x":1}\n');
    const timestamp = '1791500000';
    const nonce = 'nonce_0123456789abcdef';
    const secret = 'test-secret';
    const signature = signExternalChatRequest(rawBody, timestamp, nonce, secret);
    const verified = verifyExternalChatSignature({ rawBody, timestamp, nonce, signature, secret, nowSeconds: 1791500000 });
    assert.deepEqual(verified.value, { timestamp: 1791500000, nonce });
    assert.equal(verifyExternalChatSignature({ rawBody: Buffer.from('{"x":1}'), timestamp, nonce, signature, secret, nowSeconds: 1791500000 }).error, 'invalid_signature');
    assert.equal(verifyExternalChatSignature({ rawBody, timestamp, nonce, signature: '0'.repeat(64), secret, nowSeconds: 1791500000 }).error, 'invalid_signature');
});

test('rejects stale timestamps, malformed nonces, and missing secrets', () => {
    const rawBody = Buffer.from('{}');
    const timestamp = '1791500000';
    const nonce = 'nonce_0123456789abcdef';
    const secret = 'test-secret';
    const signature = signExternalChatRequest(rawBody, timestamp, nonce, secret);
    assert.equal(verifyExternalChatSignature({ rawBody, timestamp, nonce, signature, secret, nowSeconds: 1791500301 }).error, 'stale_timestamp');
    assert.equal(verifyExternalChatSignature({ rawBody, timestamp, nonce: 'bad', signature, secret, nowSeconds: 1791500000 }).error, 'invalid_nonce');
    assert.equal(verifyExternalChatSignature({ rawBody, timestamp, nonce, signature, secret: '', nowSeconds: 1791500000 }).error, 'signature_not_configured');
});


test('composes Telegram first and last name when only profile fields arrive', () => {
    const { display_name: _displayName, ...withoutDisplayName } = event;
    const result = normalizeExternalChatEvent({ ...withoutDisplayName, first_name: 'Ameer', last_name: 'Khan' });
    assert.equal(result.value.displayName, 'Ameer Khan');
    assert.equal(result.value.metadata.user_name, 'Ameer Khan');
});

test('falls back from Telegram profile name to username and strips leading at sign', () => {
    const result = normalizeExternalChatEvent({ ...event, display_name: '', first_name: '', last_name: '', username: '@ameer_khan07' });
    assert.equal(result.value.metadata.user_name, 'ameer_khan07');
    assert.equal(result.value.username, 'ameer_khan07');
});


test('normalizes a bounded inbound image with caption into a small photo row text', () => {
    const image = Buffer.from([0xff, 0xd8, 0xff, 0xd9]);
    const result = normalizeExternalChatEvent({ ...event, text: '', caption: 'Receipt', media_mime: 'image/jpeg', media_base64: image.toString('base64') });
    assert.equal(result.error, undefined);
    assert.equal(result.value.text, '[photo] Receipt');
    assert.deepEqual(result.value.mediaBytes, image);
    assert.equal(result.value.mediaMime, 'image/jpeg');
    const unicodeCaption = normalizeExternalChatEvent({ ...event, text: '', caption: 'رسید ✓', media_mime: 'image/jpeg', media_base64: image.toString('base64') });
    assert.equal(unicodeCaption.value.text, '[photo] رسید ✓');
});

test('rejects invalid or oversized inbound media', () => {
    assert.equal(normalizeExternalChatEvent({ ...event, text: '', media_mime: 'image/svg+xml', media_base64: Buffer.from('x').toString('base64') }).error, 'invalid_media');
    assert.equal(normalizeExternalChatEvent({ ...event, text: '', media_mime: 'image/jpeg', media_base64: '!!!' }).error, 'invalid_media');
    assert.equal(normalizeExternalChatEvent({ ...event, text: '', media_mime: 'image/jpeg', media_base64: Buffer.alloc(5 * 1024 * 1024 + 1).toString('base64') }).error, 'invalid_media');
});
