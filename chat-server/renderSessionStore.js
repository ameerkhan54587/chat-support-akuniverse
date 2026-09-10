const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const SESSIONS_FILE = path.join(__dirname, 'data', 'admin_sessions.json');

// Ensure data directory exists
const dataDir = path.dirname(SESSIONS_FILE);
if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
}

function loadSessionsFromDisk() {
    try {
        if (fs.existsSync(SESSIONS_FILE)) {
            const raw = fs.readFileSync(SESSIONS_FILE, 'utf8');
            const data = JSON.parse(raw);
            return typeof data === 'object' && data !== null ? data : {};
        }
    } catch (err) {
        console.error('[RenderStorage] Failed to read admin_sessions.json:', err.message);
    }
    return {};
}

function saveSessionsToDisk(sessions) {
    try {
        const tempPath = `${SESSIONS_FILE}.tmp`;
        fs.writeFileSync(tempPath, JSON.stringify(sessions, null, 2), 'utf8');
        fs.renameSync(tempPath, SESSIONS_FILE);
        return true;
    } catch (err) {
        console.error('[RenderStorage] Failed to write admin_sessions.json:', err.message);
        return false;
    }
}

// In-memory cache synced with Render disk storage
let memorySessions = loadSessionsFromDisk();

/**
 * Creates and persists a new admin login session in Render disk storage
 */
function createSession(adminData = {}) {
    const token = `aksess_${Date.now()}_${crypto.randomBytes(24).toString('hex')}`;
    const session = {
        token,
        username: adminData.username || 'admin4353',
        ip: adminData.ip || '',
        userAgent: (adminData.userAgent || '').slice(0, 200),
        createdAt: new Date().toISOString(),
        lastActive: new Date().toISOString()
    };

    memorySessions = loadSessionsFromDisk();
    memorySessions[token] = session;
    saveSessionsToDisk(memorySessions);

    console.log(`[RenderStorage] Admin login session created and saved to Render storage (User: "${session.username}")`);
    return session;
}

/**
 * Validates a session token directly from Render disk storage (NO Turso needed)
 */
function validateSession(token, clientIp = null) {
    if (!token || typeof token !== 'string') return null;

    // Check in-memory cache, reload from disk if missing
    if (!memorySessions[token]) {
        memorySessions = loadSessionsFromDisk();
    }

    const session = memorySessions[token];
    if (!session) return null;

    // Check expiration (default 30 days)
    const createdAt = new Date(session.createdAt).getTime();
    const thirtyDaysMs = 30 * 24 * 60 * 60 * 1000;
    if (Date.now() - createdAt > thirtyDaysMs) {
        delete memorySessions[token];
        saveSessionsToDisk(memorySessions);
        return null;
    }

    // Update last activity timestamp
    session.lastActive = new Date().toISOString();
    if (clientIp) session.lastIp = clientIp;
    saveSessionsToDisk(memorySessions);

    return session;
}

/**
 * Destroys a session on logout from Render disk storage
 */
function destroySession(token) {
    if (!token) return false;
    memorySessions = loadSessionsFromDisk();
    if (memorySessions[token]) {
        delete memorySessions[token];
        saveSessionsToDisk(memorySessions);
        console.log(`[RenderStorage] Admin session ${token.slice(0, 16)}... destroyed on logout`);
        return true;
    }
    return false;
}

/**
 * Returns all active admin sessions stored on Render disk
 */
function listSessions() {
    memorySessions = loadSessionsFromDisk();
    return Object.values(memorySessions);
}

module.exports = {
    createSession,
    validateSession,
    destroySession,
    listSessions
};
