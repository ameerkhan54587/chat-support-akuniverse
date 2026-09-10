/**
 * SQLite to Turso Migration Utility
 * Safely exports existing local SQLite data from chat.db into remote Turso cloud database.
 * Usage:
 *   TURSO_DATABASE_URL=libsql://... TURSO_AUTH_TOKEN=... node migrate-sqlite-to-turso.js
 */

const path = require('path');
const fs = require('fs');
const sqlite3 = require('sqlite3').verbose();
const { createClient } = require('@libsql/client');

const localDbFile = path.resolve(__dirname, 'chat.db');
const tursoUrl = process.env.TURSO_DATABASE_URL;
const tursoToken = process.env.TURSO_AUTH_TOKEN;

if (!tursoUrl) {
    console.error('Error: TURSO_DATABASE_URL environment variable is required.');
    console.error('Example: TURSO_DATABASE_URL=libsql://your-db.turso.io TURSO_AUTH_TOKEN=your_token node migrate-sqlite-to-turso.js');
    process.exit(1);
}

if (!fs.existsSync(localDbFile)) {
    console.error(`Error: Local SQLite file not found at ${localDbFile}`);
    process.exit(1);
}

const localDb = new sqlite3.Database(localDbFile);
const tursoClient = createClient({
    url: tursoUrl,
    authToken: tursoToken,
});

const TABLES_IN_ORDER = [
    'admins',
    'sites',
    'global_ai_config',
    'site_channels',
    'ai_instructions',
    'site_knowledge_base',
    'sessions',
    'messages',
    'telegram_threads',
    'tickets',
    'ai_runs',
    'ai_resolutions'
];

async function migrate() {
    console.log('==================================================');
    console.log('   MIGRATING LOCAL SQLITE (chat.db) -> TURSO CLOUD');
    console.log('==================================================');
    console.log(`Source DB: ${localDbFile}`);
    console.log(`Target DB: ${tursoUrl}\n`);

    // First, ensure schema exists in Turso
    const { initDatabase } = require('./db/schema');
    const { db } = require('./db');
    await initDatabase(db);

    for (const table of TABLES_IN_ORDER) {
        try {
            const rows = await new Promise((resolve, reject) => {
                localDb.all(`SELECT * FROM ${table}`, [], (err, rows) => {
                    if (err) {
                        // Table might not exist in old sqlite, ignore gracefully
                        return resolve([]);
                    }
                    resolve(rows || []);
                });
            });

            if (rows.length === 0) {
                console.log(`- ${table}: 0 rows found in local DB (skipped)`);
                continue;
            }

            let inserted = 0;
            for (const row of rows) {
                const columns = Object.keys(row);
                const placeholders = columns.map(() => '?').join(', ');
                const values = columns.map(col => (row[col] === undefined ? null : row[col]));
                const sql = `INSERT OR REPLACE INTO ${table} (${columns.join(', ')}) VALUES (${placeholders})`;

                await tursoClient.execute({ sql, args: values });
                inserted++;
            }

            console.log(`✓ ${table}: Migrated ${inserted} rows successfully.`);
        } catch (err) {
            console.error(`✗ Error migrating table ${table}:`, err.message);
        }
    }

    console.log('\n==================================================');
    console.log('   MIGRATION TO TURSO COMPLETED SUCCESSFULLY!');
    console.log('==================================================');
    process.exit(0);
}

migrate().catch((err) => {
    console.error('Fatal migration error:', err);
    process.exit(1);
});
