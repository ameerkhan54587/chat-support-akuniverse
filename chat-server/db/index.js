/**
 * Turso / libSQL Database Client Adapter
 * Supports remote Turso cloud database (production on Render)
 * with graceful fallback to local SQLite for offline development.
 */

const { createClient } = require('@libsql/client');
const path = require('path');
const fs = require('fs');

// Auto-load .env file if present in chat-server directory
const envPath = path.resolve(__dirname, '..', '.env');
if (fs.existsSync(envPath)) {
    const envContent = fs.readFileSync(envPath, 'utf8');
    for (const line of envContent.split(/\r?\n/)) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) continue;
        const eqIdx = trimmed.indexOf('=');
        if (eqIdx > 0) {
            const key = trimmed.slice(0, eqIdx).trim();
            const val = trimmed.slice(eqIdx + 1).trim().replace(/^['"]|['"]$/g, '');
            process.env[key] = val;
        }
    }
}

const tursoUrl = process.env.TURSO_DATABASE_URL ? process.env.TURSO_DATABASE_URL.trim() : '';
const tursoAuthToken = process.env.TURSO_AUTH_TOKEN ? process.env.TURSO_AUTH_TOKEN.trim() : '';

const isTurso = !!(tursoUrl && tursoUrl.startsWith('libsql://'));

let client;
if (isTurso) {
    console.log(`[Database] Connecting to Turso Cloud Database: ${tursoUrl.replace(/\/\/[^:]+@/, '//***@')}`);
    client = createClient({
        url: tursoUrl,
        authToken: tursoAuthToken,
    });
} else {
    console.warn('\n===============================================================');
    console.warn('⚠️  [TURSO REQUIRED] TURSO_DATABASE_URL is not configured!');
    console.warn('   To connect your permanent Turso cloud database:');
    console.warn('   1. Create a free database at https://turso.tech');
    console.warn('   2. Set TURSO_DATABASE_URL and TURSO_AUTH_TOKEN in your .env');
    console.warn('   Running in temporary in-memory mode (:memory:). No local files saved.');
    console.warn('===============================================================\n');
    client = createClient({
        url: ':memory:',
    });
}

/**
 * Normalizes parameters for @libsql/client.
 * Replaces undefined values with null to prevent parameter binding errors.
 */
function normalizeArgs(params) {
    if (!params) return [];
    if (Array.isArray(params)) {
        return params.map(val => (val === undefined ? null : val));
    }
    if (typeof params === 'object') {
        const normalized = {};
        for (const [k, v] of Object.entries(params)) {
            normalized[k] = v === undefined ? null : v;
        }
        return normalized;
    }
    return [params];
}

/**
 * Converts a libSQL row to a plain JavaScript object
 */
function rowToObject(row) {
    if (!row) return null;
    if (typeof row === 'object' && !Array.isArray(row)) {
        const obj = {};
        for (const [k, v] of Object.entries(row)) {
            // Convert BigInt to Number if safe
            if (typeof v === 'bigint') {
                obj[k] = Number(v);
            } else {
                obj[k] = v;
            }
        }
        return obj;
    }
    return row;
}

/**
 * Database client wrapper providing 100% backward-compatibility
 * with sqlite3 callback interface, plus modern Promise methods.
 */
class DatabaseAdapter {
    constructor(client, isTurso) {
        this.client = client;
        this.isTurso = isTurso;
    }

    /**
     * Executes a statement with callback signature: callback(err) with `this.lastID` and `this.changes`
     */
    run(sql, params, callback) {
        if (typeof params === 'function') {
            callback = params;
            params = [];
        }
        callback = callback || (() => {});
        const args = normalizeArgs(params);

        this.client.execute({ sql, args })
            .then((result) => {
                const context = {
                    lastID: result.lastInsertRowid !== undefined ? Number(result.lastInsertRowid) : 0,
                    changes: result.rowsAffected !== undefined ? Number(result.rowsAffected) : 0,
                };
                callback.call(context, null);
            })
            .catch((err) => {
                const context = { lastID: 0, changes: 0 };
                callback.call(context, err);
            });
    }

    /**
     * Fetches a single row with callback signature: callback(err, row)
     */
    get(sql, params, callback) {
        if (typeof params === 'function') {
            callback = params;
            params = [];
        }
        callback = callback || (() => {});
        const args = normalizeArgs(params);

        this.client.execute({ sql, args })
            .then((result) => {
                const firstRow = result.rows && result.rows.length > 0 ? rowToObject(result.rows[0]) : null;
                callback(null, firstRow);
            })
            .catch((err) => {
                callback(err, null);
            });
    }

    /**
     * Fetches all matching rows with callback signature: callback(err, rows)
     */
    all(sql, params, callback) {
        if (typeof params === 'function') {
            callback = params;
            params = [];
        }
        callback = callback || (() => {});
        const args = normalizeArgs(params);

        this.client.execute({ sql, args })
            .then((result) => {
                const rows = (result.rows || []).map(rowToObject);
                callback(null, rows);
            })
            .catch((err) => {
                callback(err, []);
            });
    }

    /**
     * Sequentially runs callbacks (sqlite3 compatibility)
     */
    serialize(fn) {
        if (typeof fn === 'function') {
            fn();
        }
    }

    /**
     * Closes the client connection
     */
    close(callback) {
        try {
            if (this.client && typeof this.client.close === 'function') {
                this.client.close();
            }
            if (callback) callback(null);
        } catch (err) {
            if (callback) callback(err);
        }
    }

    // Promise-based async helpers
    async runAsync(sql, params = []) {
        const args = normalizeArgs(params);
        const result = await this.client.execute({ sql, args });
        return {
            lastID: result.lastInsertRowid !== undefined ? Number(result.lastInsertRowid) : 0,
            changes: result.rowsAffected !== undefined ? Number(result.rowsAffected) : 0,
        };
    }

    async getAsync(sql, params = []) {
        const args = normalizeArgs(params);
        const result = await this.client.execute({ sql, args });
        return result.rows && result.rows.length > 0 ? rowToObject(result.rows[0]) : null;
    }

    async allAsync(sql, params = []) {
        const args = normalizeArgs(params);
        const result = await this.client.execute({ sql, args });
        return (result.rows || []).map(rowToObject);
    }

    async batchAsync(statements) {
        return this.client.batch(statements);
    }

    /**
     * Fast health check ping
     */
    async ping() {
        const start = Date.now();
        await this.client.execute('SELECT 1');
        return { ok: true, latencyMs: Date.now() - start };
    }
}

const db = new DatabaseAdapter(client, isTurso);

module.exports = {
    db,
    client,
    isTurso,
};
