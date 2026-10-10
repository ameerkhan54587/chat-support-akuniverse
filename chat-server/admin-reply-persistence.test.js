'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createClient } = require('@libsql/client');
const { persistTelegramAdminReply } = require('./admin-reply-persistence');

async function makeDb() {
    const client = createClient({ url: ':memory:' });
    await client.execute('CREATE TABLE external_messages (source TEXT NOT NULL, source_message_id TEXT NOT NULL, session_id TEXT NOT NULL, message_id INTEGER, PRIMARY KEY (source, source_message_id))');
    await client.execute('CREATE TABLE messages (id INTEGER PRIMARY KEY AUTOINCREMENT, session_id TEXT, sender TEXT, text TEXT, timestamp TEXT)');
    await client.execute('CREATE TABLE sessions (session_id TEXT PRIMARY KEY, updated_at TEXT)');
    await client.execute({ sql: 'INSERT INTO sessions (session_id) VALUES (?)', args: ['telegram:site_smsotps:123'] });
    return { client, close: () => client.close() };
}

const input = {
    sessionId: 'telegram:site_smsotps:123', text: 'reply', timestamp: '2026-10-10T01:20:00.000Z',
    source: 'laravel:smsotps', sourceMessageId: 'telegram:123:456',
};

test('does not persist a second console row when Laravel mirror already reserved Telegram message', async () => {
    const db = await makeDb();
    try {
        await db.client.execute({ sql: 'INSERT INTO external_messages (source, source_message_id, session_id) VALUES (?, ?, ?)', args: ['laravel:smsotps', input.sourceMessageId, input.sessionId] });
        const result = await persistTelegramAdminReply({ db, ...input });
        assert.deepEqual(result, { persisted: false, duplicate: true });
        const rows = await db.client.execute('SELECT * FROM messages');
        assert.equal(rows.rows.length, 0);
    } finally { db.close(); }
});

test('uses a dedupe reservation and local fallback when the Laravel mirror has not arrived', async () => {
    const db = await makeDb();
    try {
        const result = await persistTelegramAdminReply({ db, ...input });
        assert.equal(result.persisted, true);
        assert.equal(result.duplicate, false);
        const rows = await db.client.execute('SELECT session_id, sender, text FROM messages');
        assert.equal(rows.rows.length, 1);
        assert.equal(rows.rows[0].sender, 'internal_team');
        assert.equal(rows.rows[0].text, input.text);
        const lateMirrorReservation = await db.client.execute({ sql: 'INSERT OR IGNORE INTO external_messages (source, source_message_id, session_id) VALUES (?, ?, ?)', args: ['laravel:smsotps', input.sourceMessageId, input.sessionId] });
        assert.equal(lateMirrorReservation.rowsAffected, 0);
    } finally { db.close(); }
});
