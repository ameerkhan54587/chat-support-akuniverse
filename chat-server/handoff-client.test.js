'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const { HANDOFF_ENDPOINTS, createHandoffRequest, notifySiteHandoff, signSiteHandoffRequest, verifySiteHandoffSignature } = require('./handoff-client');

test('signs SMSOTPS handoff to its fixed URL with exact raw JSON', () => {
    const result = createHandoffRequest({ siteId: 'smsotps', secret: 'test-secret', chatId: '-100123', nowSeconds: 1791482400 });
    assert.equal(result.endpoint, 'https://api.smsotps.com/api/support/handoff');
    assert.equal(result.body, JSON.stringify({ chat_id: '-100123' }));
    assert.equal(result.headers['X-Handoff-Timestamp'], '1791482400');
    assert.equal(result.headers.Authorization, undefined);
    assert.equal(result.headers['X-Handoff-Signature'], crypto.createHmac('sha256', 'test-secret').update('1791482400').update('.').update(result.body).digest('hex'));
});

test('skips unconfigured sites and rejects malformed chat IDs', () => {
    assert.deepEqual(createHandoffRequest({ siteId: 'smsotps', secret: '', chatId: '123' }), { skipped: true, reason: 'handoff_not_configured' });
    assert.deepEqual(createHandoffRequest({ siteId: 'attacker.invalid', secret: 'secret', chatId: '123' }), { skipped: true, reason: 'handoff_not_configured' });
    assert.equal(createHandoffRequest({ siteId: 'smsotps', secret: 'secret', chatId: 'nope' }).error, 'invalid_chat_id');
});

test('posts the signed body and reports response status without secret data', async () => {
    let sent;
    const result = await notifySiteHandoff({ siteId: 'smsotps', secret: 'test-secret', apiKey: 'test-api-key', chatId: '123', nowSeconds: 1791482400 }, async (url, options) => {
        sent = { url, options }; return { ok: true, status: 200 };
    });
    assert.deepEqual(result, { success: true, status: 200 });
    assert.equal(sent.url, HANDOFF_ENDPOINTS.smsotps);
    assert.equal(sent.options.method, 'POST');
    assert.equal(sent.options.headers.Authorization, 'Bearer test-api-key');
    assert.equal(sent.options.body, JSON.stringify({ chat_id: '123' }));
});


test('verifies matching site handoff signature and rejects stale or tampered requests', () => {
    const body = Buffer.from(JSON.stringify({ chat_id: '123' }));
    const timestamp = '1791482400';
    const signature = signSiteHandoffRequest(body, timestamp, 'site-secret');
    assert.deepEqual(verifySiteHandoffSignature({ rawBody: body, timestamp, signature, secret: 'site-secret', nowSeconds: 1791482400 }), { value: { timestamp: 1791482400 } });
    assert.equal(verifySiteHandoffSignature({ rawBody: body, timestamp, signature, secret: 'site-secret', nowSeconds: 1791483001 }).error, 'stale_timestamp');
    assert.equal(verifySiteHandoffSignature({ rawBody: Buffer.from('{}'), timestamp, signature, secret: 'site-secret', nowSeconds: 1791482400 }).error, 'invalid_signature');
});
