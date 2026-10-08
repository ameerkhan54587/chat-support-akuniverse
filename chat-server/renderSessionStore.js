const crypto = require('crypto');

// Sessions are intentionally process-local and disposable. Permanent support data
// belongs in Turso; Render's filesystem is never used for session state.
const memorySessions = new Map();
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

function createSession(adminData = {}) {
  const now = new Date().toISOString();
  const token = `aksess_${Date.now()}_${crypto.randomBytes(24).toString('hex')}`;
  const session = {
    token,
    username: adminData.username || 'admin',
    ip: adminData.ip || '',
    userAgent: (adminData.userAgent || '').slice(0, 200),
    createdAt: now,
    lastActive: now,
  };
  memorySessions.set(token, session);
  return session;
}

function validateSession(token, clientIp = null) {
  if (typeof token !== 'string' || !token) return null;
  const session = memorySessions.get(token);
  if (!session) return null;
  if (Date.now() - Date.parse(session.createdAt) > SESSION_TTL_MS) {
    memorySessions.delete(token);
    return null;
  }
  session.lastActive = new Date().toISOString();
  if (clientIp) session.lastIp = clientIp;
  return session;
}

function destroySession(token) {
  return memorySessions.delete(token);
}

function listSessions() {
  return [...memorySessions.values()];
}

module.exports = { createSession, validateSession, destroySession, listSessions };
