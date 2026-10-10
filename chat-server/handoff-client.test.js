'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const { HANDOFF_ENDPOINTS, REPLY_ENDPOINTS, createHandoffRequest, notifySiteHandoff, createSiteReplyRequest, sendSiteReply, createSitePhotoReplyRequest, sendSitePhotoReply, signSiteHandoffRequest, verifySiteHandoffSignature } = require('./handoff-client');

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


test('creates a fixed signed SMSOTPS reply request without bearer secrets', () => {
    const request = createSiteReplyRequest({ siteId: 'smsotps', secret: 'test-secret', chatId: '8975496349', text: 'hello', nowSeconds: 1791482400 });
    assert.equal(request.endpoint, REPLY_ENDPOINTS.smsotps);
    assert.equal(request.body, JSON.stringify({ chat_id: '8975496349', text: 'hello' }));
    assert.equal(request.headers.Authorization, undefined);
    assert.equal(request.headers['X-Handoff-Signature'], signSiteHandoffRequest(Buffer.from(request.body), '1791482400', 'test-secret'));
    assert.equal(request.headers['X-Message-Signature'], undefined);
    assert.deepEqual(createSiteReplyRequest({ siteId: 'attacker.invalid', secret: 's', chatId: '1', text: 'hi' }), { skipped: true, reason: 'site_reply_not_configured' });
    assert.equal(createSiteReplyRequest({ siteId: 'smsotps', secret: 's', chatId: 'bad', text: 'hi' }).error, 'invalid_chat_id');
    assert.equal(createSiteReplyRequest({ siteId: 'smsotps', secret: 's', chatId: '1', text: ' ' }).error, 'invalid_text');
});

test('sends signed site reply and only reports success from the site', async () => {
    let sent;
    const result = await sendSiteReply({ siteId: 'smsotps', secret: 's', chatId: '1', text: 'hi', nowSeconds: 1791482400 }, async (url, options) => { sent = { url, options }; return { ok: true, status: 200 }; });
    assert.deepEqual(result, { success: true, status: 200 });
    assert.equal(sent.url, REPLY_ENDPOINTS.smsotps);
    assert.equal(sent.options.method, 'POST');
    assert.equal(sent.options.body, JSON.stringify({ chat_id: '1', text: 'hi' }));
});


test('signs exact multipart SMSOTPS photo bytes and posts them to the photo endpoint', async () => {
    const imageBytes = Buffer.from([0xff, 0xd8, 0x00, 0xfe]);
    const request = createSitePhotoReplyRequest({ siteId: 'smsotps', secret: 'photo-secret', chatId: '8975496349', imageBytes, mimeType: 'image/jpeg', caption: 'check this', nowSeconds: 1791482400, boundary: 'unit_test_boundary' });
    assert.equal(request.endpoint, REPLY_ENDPOINTS.smsotpsPhoto);
    assert.equal(request.headers['Content-Type'], 'multipart/form-data; boundary=unit_test_boundary');
    assert.ok(request.body.includes(Buffer.from('name=\"chat_id\"')));
    assert.equal(request.headers.Authorization, undefined);
    const photoHash = crypto.createHash('sha256').update(imageBytes).digest('hex');
    const canonical = `1791482400.8975496349.check this.${photoHash}`;
    const expectedSignature = crypto.createHmac('sha256', 'photo-secret').update(canonical).digest('hex');
    assert.equal(request.headers['X-Handoff-Signature'], expectedSignature);
    assert.ok(request.body.includes(imageBytes));
    assert.ok(request.body.includes(Buffer.from('name=\"caption\"')));
    let sent;
    const result = await sendSitePhotoReply({ siteId: 'smsotps', secret: 'photo-secret', chatId: '8975496349', imageBytes, mimeType: 'image/jpeg', caption: 'check this', nowSeconds: 1791482400, boundary: 'unit_test_boundary' }, async (url, options) => { sent = { url, options }; return { ok: true, status: 201 }; });
    assert.deepEqual(result, { success: true, status: 201 });
    assert.equal(sent.url, REPLY_ENDPOINTS.smsotpsPhoto);
    assert.equal(sent.options.headers['X-Handoff-Signature'], expectedSignature);
});

test('rejects malformed SMSOTPS photo request fields', () => {
    const bytes = Buffer.from('img');
    assert.equal(createSitePhotoReplyRequest({ siteId: 'smsotps', secret: 's', chatId: 'bad', imageBytes: bytes, mimeType: 'image/jpeg' }).error, 'invalid_chat_id');
    assert.equal(createSitePhotoReplyRequest({ siteId: 'smsotps', secret: 's', chatId: '1', imageBytes: bytes, mimeType: 'image/svg+xml' }).error, 'unsupported_image_type');
    assert.equal(createSitePhotoReplyRequest({ siteId: 'smsotps', secret: 's', chatId: '1', imageBytes: bytes, mimeType: 'image/gif' }).error, 'unsupported_image_type');
    assert.equal(createSitePhotoReplyRequest({ siteId: 'smsotps', secret: 's', chatId: '1', imageBytes: Buffer.alloc(5 * 1024 * 1024 + 1), mimeType: 'image/jpeg' }).error, 'invalid_image');
});
