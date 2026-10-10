'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const http = require('node:http');
const { parsePhotoBody } = require('./photo-body-parser');

test('captures image/png bytes before global JSON parsers consume them', async (t) => {
    const app = express();
    app.use(parsePhotoBody);
    app.use(express.json({ limit: '256kb' }));
    app.post('/api/telegram/users/:siteId/:chatId/send-photo', (req, res) => {
        res.status(Buffer.isBuffer(req.body) && req.body.length ? 201 : 400).json({
            is_buffer: Buffer.isBuffer(req.body),
            length: Buffer.isBuffer(req.body) ? req.body.length : 0,
        });
    });
    const server = http.createServer(app);
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    t.after(() => new Promise(resolve => server.close(resolve)));
    const bytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0xff]);
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/telegram/users/smsotps/8975496349/send-photo`, {
        method: 'POST', headers: { 'Content-Type': 'image/png' }, body: bytes,
    });
    assert.equal(response.status, 201);
    assert.deepEqual(await response.json(), { is_buffer: true, length: bytes.length });
});
