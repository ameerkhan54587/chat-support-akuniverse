'use strict';

/**
 * Persist an SMSOTPS admin reply only if the matching Telegram mirror event
 * has not already claimed the source message ID. Reserving the same key used
 * by /api/telegram/ingest also closes the race where ConsoleForwarder arrives
 * just after the signed reply request returns.
 */
async function persistTelegramAdminReply({ db, sessionId, text, timestamp, source, sourceMessageId }) {
    if (!db?.client || !sessionId || !text || !timestamp || !source || !sourceMessageId) {
        throw new TypeError('Missing admin reply persistence input');
    }
    let transaction;
    try {
        transaction = await db.client.transaction('write');
        const reservation = await transaction.execute({
            sql: 'INSERT OR IGNORE INTO external_messages (source, source_message_id, session_id) VALUES (?, ?, ?)',
            args: [source, sourceMessageId, sessionId],
        });
        if (!reservation.rowsAffected) {
            await transaction.commit();
            return { persisted: false, duplicate: true };
        }

        const inserted = await transaction.execute({
            sql: 'INSERT INTO messages (session_id, sender, text, timestamp) VALUES (?, ?, ?, ?)',
            args: [sessionId, 'internal_team', text, timestamp],
        });
        const messageId = Number(inserted.lastInsertRowid);
        await transaction.execute({
            sql: 'UPDATE external_messages SET message_id = ? WHERE source = ? AND source_message_id = ?',
            args: [messageId, source, sourceMessageId],
        });
        await transaction.execute({
            sql: 'UPDATE sessions SET updated_at = ? WHERE session_id = ?',
            args: [timestamp, sessionId],
        });
        await transaction.commit();
        return { persisted: true, duplicate: false, id: messageId };
    } catch (error) {
        if (transaction) await transaction.rollback().catch(() => {});
        throw error;
    } finally {
        if (transaction) transaction.close();
    }
}

module.exports = { persistTelegramAdminReply };
