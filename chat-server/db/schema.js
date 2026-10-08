/**
 * Central Database Schema & Migrations for Turso / libSQL
 * Defines tables, indexes, automatic column migrations, default admin,
 * and multi-site demonstration data.
 */

const bcrypt = require('bcryptjs');

const DEFAULT_API_TOKEN = '';


async function initDatabase(db) {
    console.log('[Database] Initializing schema and verifying tables...');

    // 1. Create Core Tables
    await db.runAsync(`CREATE TABLE IF NOT EXISTS admins (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT UNIQUE,
        password_hash TEXT,
        api_token TEXT,
        webhook_url TEXT,
        webhook_enabled INTEGER DEFAULT 0,
        timezone TEXT DEFAULT '0',
        date_format TEXT DEFAULT 'd.m.Y',
        time_format TEXT DEFAULT 'H:i',
        realtime_typing INTEGER DEFAULT 0,
        log_online_status INTEGER DEFAULT 1,
        log_tab_activity INTEGER DEFAULT 1,
        log_chat_widget INTEGER DEFAULT 1,
        log_page_visits INTEGER DEFAULT 1,
        allowed_origins TEXT DEFAULT '',
        allowed_anonymous_origins TEXT DEFAULT '',
        admin_language TEXT DEFAULT 'en',
        telegram_bot_token TEXT DEFAULT '',
        telegram_chat_id TEXT DEFAULT '',
        telegram_enabled INTEGER DEFAULT 0,
        telegram_last_update_id INTEGER DEFAULT 0,
        telegram_bots TEXT DEFAULT '[]',
        max_messages_per_minute INTEGER DEFAULT 20,
        max_message_length INTEGER DEFAULT 1000,
        admin_messages_limit INTEGER DEFAULT 20,
        widget_messages_limit INTEGER DEFAULT 20,
        business_hours TEXT DEFAULT '',
        smtp_config TEXT DEFAULT ''
    )`);

    await db.runAsync(`CREATE TABLE IF NOT EXISTS messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id TEXT,
        sender TEXT,
        text TEXT,
        timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);

    await db.runAsync(`CREATE TABLE IF NOT EXISTS sessions (
        session_id TEXT PRIMARY KEY,
        metadata TEXT,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);

    await db.runAsync(`CREATE TABLE IF NOT EXISTS telegram_threads (
        session_id TEXT PRIMARY KEY,
        thread_id INTEGER UNIQUE,
        topic_name TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);

    await db.runAsync(`CREATE TABLE IF NOT EXISTS external_messages (
        source TEXT NOT NULL,
        source_message_id TEXT NOT NULL,
        session_id TEXT NOT NULL,
        message_id INTEGER,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (source, source_message_id)
    )`);

    await db.runAsync(`CREATE TABLE IF NOT EXISTS ingest_nonces (
        source TEXT NOT NULL,
        nonce TEXT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (source, nonce)
    )`);

    // Sites and ticket records retained for the support console.
    await db.runAsync(`CREATE TABLE IF NOT EXISTS sites (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        domain TEXT UNIQUE NOT NULL,
        name TEXT,
        site_type TEXT DEFAULT 'other',
        business_type TEXT DEFAULT 'other',
        status TEXT DEFAULT 'active',
        description TEXT,
        currency TEXT DEFAULT 'USD',
        timezone TEXT DEFAULT 'UTC',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);

    await db.runAsync(`CREATE TABLE IF NOT EXISTS tickets (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        site_id INTEGER,
        session_id TEXT,
        channel_type TEXT,
        subject TEXT,
        status TEXT DEFAULT 'open',
        priority TEXT DEFAULT 'medium',
        error_log TEXT DEFAULT '',
        assigned_to INTEGER,
        resolution TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        resolved_at DATETIME,
        is_read INTEGER DEFAULT 0
    )`);

    // 3. Performance Indexes
    await db.runAsync(`CREATE INDEX IF NOT EXISTS idx_messages_session ON messages(session_id, timestamp)`);
    await db.runAsync(`CREATE INDEX IF NOT EXISTS idx_sessions_updated ON sessions(updated_at)`);
    await db.runAsync(`CREATE INDEX IF NOT EXISTS idx_sites_domain ON sites(domain)`);
    await db.runAsync(`CREATE INDEX IF NOT EXISTS idx_tickets_site_status ON tickets(site_id, status)`);

    // 4. Migrate missing columns safely
    await migrateColumns(db);

    // 5. Seed or synchronize admin account with environment variables
    const envAdminUser = (process.env.ADMIN_USERNAME || 'admin').trim().replace(/^['"]|['"]$/g, '');
    const envAdminPass = (process.env.ADMIN_PASSWORD || '').trim().replace(/^['"]|['"]$/g, '');
    const envApiToken = (process.env.ADMIN_API_TOKEN || '').trim();

    const existingAdmin = await db.getAsync('SELECT * FROM admins ORDER BY id ASC LIMIT 1');
    if (!existingAdmin) {
        if (!envAdminUser || !envAdminPass || !envApiToken) throw new Error('ADMIN_USERNAME, ADMIN_PASSWORD and ADMIN_API_TOKEN are required');
        const hash = bcrypt.hashSync(envAdminPass, 10);
        await db.runAsync(
            'INSERT INTO admins (username, password_hash, api_token) VALUES (?, ?, ?)',
            [envAdminUser, hash, envApiToken]
        );
        console.log(`[Database] Admin account initialized for user: "${envAdminUser}".`);
    } else {
        if (!envAdminUser || !envAdminPass || !envApiToken) throw new Error('ADMIN_USERNAME, ADMIN_PASSWORD and ADMIN_API_TOKEN are required');
        const newHash = bcrypt.hashSync(envAdminPass, 10);
        await db.runAsync(
            'UPDATE admins SET username = ?, password_hash = ?, api_token = ? WHERE id = ?',
            [envAdminUser, newHash, envApiToken, existingAdmin.id]
        );
        console.log(`[Database] Admin credentials synchronized from environment (User: "${envAdminUser}").`);
    }

    // Site presets are configuration; chat sessions, messages and tickets remain durable in Turso.

    console.log('[Database] Schema verification and migration complete.');
}

async function migrateColumns(db) {
    try {
        const adminCols = (await db.allAsync('PRAGMA table_info(admins)')).map(c => c.name);
        const missingAdminCols = [
            ['api_token', 'TEXT DEFAULT ""'],
            ['webhook_url', 'TEXT DEFAULT ""'],
            ['webhook_enabled', 'INTEGER DEFAULT 0'],
            ['timezone', 'TEXT DEFAULT "0"'],
            ['date_format', 'TEXT DEFAULT "d.m.Y"'],
            ['time_format', 'TEXT DEFAULT "H:i"'],
            ['realtime_typing', 'INTEGER DEFAULT 0'],
            ['log_online_status', 'INTEGER DEFAULT 1'],
            ['log_tab_activity', 'INTEGER DEFAULT 1'],
            ['log_chat_widget', 'INTEGER DEFAULT 1'],
            ['log_page_visits', 'INTEGER DEFAULT 1'],
            ['allowed_origins', 'TEXT DEFAULT ""'],
            ['allowed_anonymous_origins', 'TEXT DEFAULT ""'],
            ['max_messages_per_minute', 'INTEGER DEFAULT 20'],
            ['max_message_length', 'INTEGER DEFAULT 1000'],
            ['admin_messages_limit', 'INTEGER DEFAULT 20'],
            ['widget_messages_limit', 'INTEGER DEFAULT 20'],
            ['admin_language', 'TEXT DEFAULT "en"'],
            ['business_hours', 'TEXT DEFAULT ""'],
            ['smtp_config', 'TEXT DEFAULT ""'],
            ['telegram_bot_token', 'TEXT DEFAULT ""'],
            ['telegram_chat_id', 'TEXT DEFAULT ""'],
            ['telegram_enabled', 'INTEGER DEFAULT 0'],
            ['telegram_last_update_id', 'INTEGER DEFAULT 0'],
            ['telegram_bots', 'TEXT DEFAULT "[]"'],
        ];
        for (const [col, typeDef] of missingAdminCols) {
            if (!adminCols.includes(col)) {
                await db.runAsync(`ALTER TABLE admins ADD COLUMN ${col} ${typeDef}`);
            }
        }

        const siteCols = (await db.allAsync('PRAGMA table_info(sites)')).map(c => c.name);
        if (!siteCols.includes('currency')) await db.runAsync('ALTER TABLE sites ADD COLUMN currency TEXT DEFAULT "USD"');
        if (!siteCols.includes('timezone')) await db.runAsync('ALTER TABLE sites ADD COLUMN timezone TEXT DEFAULT "UTC"');
        if (!siteCols.includes('business_type')) await db.runAsync('ALTER TABLE sites ADD COLUMN business_type TEXT DEFAULT "other"');

        const ticketCols = (await db.allAsync('PRAGMA table_info(tickets)')).map(c => c.name);
        if (!ticketCols.includes('is_read')) await db.runAsync('ALTER TABLE tickets ADD COLUMN is_read INTEGER DEFAULT 0');
        if (!ticketCols.includes('error_log')) await db.runAsync("ALTER TABLE tickets ADD COLUMN error_log TEXT DEFAULT ''");
    } catch (e) {
        console.error('[Database] Column migration warning:', e.message);
    }
}


module.exports = {
    initDatabase,
    DEFAULT_API_TOKEN,
    };
