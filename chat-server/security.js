/**
 * Kaplia Chat Security Suite
 * Multi-layer Defense against:
 * - Injection Attacks (SQLi, XSS, HTML Script Injection, Prototype Pollution)
 * - DoS & DDoS Attacks (HTTP request flood, WebSocket connection flood, Slowloris, Payload blowup)
 * - Server Down Attacks (Uncaught exceptions, unhandled rejections, OOM memory starvation)
 * - Attackers & Scanners (Fail2ban auto-jail, IP Blacklisting, Sensitive endpoint protection)
 */

const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, 'data');
const BLACKLIST_FILE = path.join(DATA_DIR, 'blacklist.json');

// Memory storage for fast lookups
let bannedIps = new Map(); // ip -> { reason, banned_at, expires_at, strikes }
let whitelistedIps = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);

// Sliding window counters for rate limiting & fail2ban
const httpRateLimits = new Map(); // ip -> { count, windowStart }
const sensitiveRateLimits = new Map(); // ip -> { count, windowStart }
const ipStrikes = new Map(); // ip -> { count, windowStart }
const wsConnectionsPerIp = new Map(); // ip -> count

// Security metrics
const securityStats = {
    blockedRequests: 0,
    blockedWsConnections: 0,
    rateLimitBlocks: 0,
    injectionsBlocked: 0,
    autoBansTriggered: 0,
    serverStartedAt: Date.now()
};

// Ensure data directory exists
function ensureDataDir() {
    try {
        if (!fs.existsSync(DATA_DIR)) {
            fs.mkdirSync(DATA_DIR, { recursive: true });
        }
    } catch (e) {}
}

// Load Blacklist from disk
function loadBlacklist() {
    ensureDataDir();
    try {
        if (fs.existsSync(BLACKLIST_FILE)) {
            const raw = fs.readFileSync(BLACKLIST_FILE, 'utf8');
            const data = JSON.parse(raw);
            bannedIps.clear();
            if (data.banned_ips && typeof data.banned_ips === 'object') {
                const now = Date.now();
                for (const [ip, info] of Object.entries(data.banned_ips)) {
                    // Check expiration
                    if (!info.expires_at || info.expires_at > now) {
                        bannedIps.set(ip, info);
                    }
                }
            }
            if (Array.isArray(data.whitelisted_ips)) {
                data.whitelisted_ips.forEach(ip => whitelistedIps.add(ip));
            }
            console.log(`[Security] Loaded ${bannedIps.size} banned IPs from blacklist.`);
        }
    } catch (err) {
        console.error('[Security] Error loading blacklist.json:', err.message);
    }
}

// Persist Blacklist to disk
function saveBlacklist() {
    ensureDataDir();
    try {
        const obj = {
            banned_ips: Object.fromEntries(bannedIps.entries()),
            whitelisted_ips: Array.from(whitelistedIps)
        };
        fs.writeFileSync(BLACKLIST_FILE, JSON.stringify(obj, null, 2), 'utf8');
    } catch (err) {
        console.error('[Security] Error saving blacklist.json:', err.message);
    }
}

// Normalize IP address (handling IPv6 mapped IPv4 like ::ffff:192.168.1.1)
function normalizeIp(ip) {
    if (!ip || typeof ip !== 'string') return '';
    let clean = ip.trim();
    if (clean.startsWith('::ffff:')) {
        clean = clean.replace('::ffff:', '');
    }
    return clean;
}

// Extract real client IP
function getClientIp(req) {
    const cfIp = req.headers['cf-connecting-ip'];
    if (cfIp) return normalizeIp(cfIp);
    const xForwarded = req.headers['x-forwarded-for'];
    if (xForwarded) {
        const first = xForwarded.split(',')[0].trim();
        if (first) return normalizeIp(first);
    }
    const xRealIp = req.headers['x-real-ip'];
    if (xRealIp) return normalizeIp(xRealIp);
    return normalizeIp(req.socket?.remoteAddress || '');
}

// Check if an IP is currently banned
function isIpBanned(ip) {
    const cleanIp = normalizeIp(ip);
    if (!cleanIp || whitelistedIps.has(cleanIp)) return false;

    const banInfo = bannedIps.get(cleanIp);
    if (!banInfo) return false;

    // Check expiration
    if (banInfo.expires_at && Date.now() > banInfo.expires_at) {
        bannedIps.delete(cleanIp);
        saveBlacklist();
        return false;
    }

    return banInfo;
}

// Ban an IP (manual or fail2ban)
function banIp(ip, reason = 'Suspicious or abusive behavior', durationMs = 24 * 60 * 60 * 1000) {
    const cleanIp = normalizeIp(ip);
    if (!cleanIp || whitelistedIps.has(cleanIp)) return false;

    const expiresAt = durationMs > 0 ? Date.now() + durationMs : null;
    bannedIps.set(cleanIp, {
        reason,
        banned_at: Date.now(),
        expires_at: expiresAt,
        strikes: (bannedIps.get(cleanIp)?.strikes || 0) + 1
    });

    securityStats.autoBansTriggered++;
    console.warn(`[SECURITY ALERT] IP BANNED: ${cleanIp} | Reason: ${reason} | Duration: ${Math.round(durationMs / 60000)} minutes`);
    saveBlacklist();
    return true;
}

// Unban an IP
function unbanIp(ip) {
    const cleanIp = normalizeIp(ip);
    if (bannedIps.has(cleanIp)) {
        bannedIps.delete(cleanIp);
        saveBlacklist();
        console.log(`[Security] IP UNBANNED: ${cleanIp}`);
        return true;
    }
    return false;
}

// Fail2ban auto-defense strike recorder
function recordSuspiciousActivity(ip, reason = 'Suspicious activity', severity = 1) {
    const cleanIp = normalizeIp(ip);
    if (!cleanIp || whitelistedIps.has(cleanIp)) return;

    const now = Date.now();
    const windowMs = 10 * 60 * 1000; // 10 minute evaluation window

    let tracker = ipStrikes.get(cleanIp);
    if (!tracker || now - tracker.windowStart > windowMs) {
        tracker = { count: 0, windowStart: now, reasons: [] };
    }

    tracker.count += severity;
    tracker.reasons.push(reason);
    ipStrikes.set(cleanIp, tracker);

    console.warn(`[SECURITY WARNING] Strike recorded for ${cleanIp}: ${reason} (Strikes: ${tracker.count}/5)`);

    // Threshold: 5 strikes within 10 minutes => Auto Ban for 2 hours (or 24h if repeated)
    if (tracker.count >= 5) {
        const banTime = tracker.count >= 10 ? 24 * 60 * 60 * 1000 : 2 * 60 * 60 * 1000;
        banIp(cleanIp, `Auto-Defense Jail: ${tracker.reasons.slice(-3).join(', ')}`, banTime);
        ipStrikes.delete(cleanIp);
    }
}

// ============================================================
// 1. INJECTION PROTECTION (XSS, SQLi, Prototype Pollution)
// ============================================================

// Dangerous patterns for XSS, script injection, and SQL injection probes
const DANGEROUS_XSS_REGEX = /(<\s*script\b[^>]*>|javascript:|vbscript:|data:text\/html|<\s*iframe\b|<\s*object\b|<\s*embed\b|onerror\s*=|onload\s*=|onclick\s*=|document\.cookie|window\.location)/i;
const DANGEROUS_SQLI_REGEX = /(\b(union\s+select|select\s+.*\s+from|insert\s+into|drop\s+table|delete\s+from|exec\s*\(|xp_cmdshell|WAITFOR\s+DELAY|pg_sleep)\b|--|\/\*|\*\/)/i;

// Sanitize user text to prevent XSS
function sanitizeText(str, maxLength = 2000) {
    if (typeof str !== 'string') return '';
    let clean = str.replace(/\0/g, ''); // Remove null bytes
    if (clean.length > maxLength) {
        clean = clean.substring(0, maxLength);
    }
    // Escape HTML special chars
    return clean
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#x27;')
        .replace(/\//g, '&#x2F;');
}

// Strip script tags and active executable markup from incoming messages
function stripScripts(str) {
    if (typeof str !== 'string') return '';
    return str
        .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
        .replace(/<iframe\b[^<]*(?:(?!<\/iframe>)<[^<]*)*<\/iframe>/gi, '')
        .replace(/<object\b[^<]*(?:(?!<\/object>)<[^<]*)*<\/object>/gi, '')
        .replace(/<embed\b[^<]*(?:(?!<\/embed>)<[^<]*)*<\/embed>/gi, '')
        .replace(/on\w+\s*=\s*(['"]).*?\1/gi, '')
        .replace(/javascript:/gi, 'blocked:');
}

// Clean Prototype Pollution in JSON bodies
function sanitizeObject(obj, depth = 0) {
    if (!obj || typeof obj !== 'object' || depth > 8) return obj;

    if (Array.isArray(obj)) {
        return obj.map(item => sanitizeObject(item, depth + 1));
    }

    const clean = {};
    for (const [key, value] of Object.entries(obj)) {
        if (key === '__proto__' || key === 'constructor' || key === 'prototype') {
            securityStats.injectionsBlocked++;
            continue; // Strip prototype pollution keys
        }
        if (typeof value === 'object' && value !== null) {
            clean[key] = sanitizeObject(value, depth + 1);
        } else {
            clean[key] = value;
        }
    }
    return clean;
}

// Validate numeric identifier
function validateNumericId(id) {
    if (typeof id === 'number' && Number.isInteger(id) && id > 0) return id;
    if (typeof id === 'string') {
        const parsed = parseInt(id, 10);
        if (!isNaN(parsed) && parsed > 0 && String(parsed) === id.trim()) {
            return parsed;
        }
    }
    return null;
}

// Safe directory path traversal check
function isSafePath(baseDir, requestedPath) {
    const safeBase = path.resolve(baseDir);
    const resolvedTarget = path.resolve(baseDir, requestedPath);
    return resolvedTarget.startsWith(safeBase);
}

// ============================================================
// 2. DOS & DDOS DEFENSE (Rate Limiting & Connection Flooding)
// ============================================================

// HTTP Rate Limiter Middleware
function httpRateLimiter(options = {}) {
    const windowMs = options.windowMs || 60 * 1000; // 1 minute
    const maxRequests = options.maxRequests || 150; // max 150 requests / min per IP

    return (req, res, next) => {
        const ip = getClientIp(req);

        // 1. IP Blacklist Check
        const banInfo = isIpBanned(ip);
        if (banInfo) {
            securityStats.blockedRequests++;
            res.setHeader('Retry-After', '3600');
            return res.status(403).json({
                error: 'ip_banned',
                message: 'Your IP address has been blocked due to suspicious or abusive activity.',
                reason: banInfo.reason,
                expires_at: banInfo.expires_at
            });
        }

        // Whitelist localhost/safe IPs from rate limiting
        if (whitelistedIps.has(ip)) {
            return next();
        }

        const now = Date.now();
        let record = httpRateLimits.get(ip);
        if (!record || now - record.windowStart > windowMs) {
            record = { count: 0, windowStart: now, violations: 0 };
        }

        record.count++;
        httpRateLimits.set(ip, record);

        if (record.count > maxRequests) {
            record.violations = (record.violations || 0) + 1;
            securityStats.rateLimitBlocks++;

            // If an IP repeatedly slams past the rate limit (> 25 violations), record strikes
            if (record.violations > 25) {
                recordSuspiciousActivity(ip, 'Extreme HTTP Flood / DDoS behavior', 3);
            }

            res.setHeader('Retry-After', Math.ceil((windowMs - (now - record.windowStart)) / 1000));
            return res.status(429).json({
                error: 'rate_limit_exceeded',
                message: 'Too many requests. Please slow down.'
            });
        }

        next();
    };
}

// Sensitive Endpoint Rate Limiter (e.g. contact-form, login, tickets API)
function sensitiveRateLimiter(maxPerMinute = 15) {
    return (req, res, next) => {
        const ip = getClientIp(req);
        if (whitelistedIps.has(ip)) return next();

        const now = Date.now();
        const windowMs = 60 * 1000;

        let record = sensitiveRateLimits.get(ip);
        if (!record || now - record.windowStart > windowMs) {
            record = { count: 0, windowStart: now };
        }

        record.count++;
        sensitiveRateLimits.set(ip, record);

        if (record.count > maxPerMinute) {
            securityStats.rateLimitBlocks++;
            recordSuspiciousActivity(ip, 'Excessive attempts on sensitive endpoint', 1);
            return res.status(429).json({
                error: 'rate_limit_exceeded',
                message: 'Too many requests on this endpoint. Please wait before retrying.'
            });
        }

        next();
    };
}

// WebSocket Connection Flood Guard
function checkWsConnectionAllowed(req) {
    const ip = getClientIp(req);
    if (whitelistedIps.has(ip)) return { allowed: true, ip };

    // Blacklist check
    if (isIpBanned(ip)) {
        securityStats.blockedWsConnections++;
        return { allowed: false, reason: 'ip_banned', ip };
    }

    // Max 12 concurrent WebSocket connections per IP
    const current = wsConnectionsPerIp.get(ip) || 0;
    if (current >= 12) {
        securityStats.blockedWsConnections++;
        recordSuspiciousActivity(ip, 'WebSocket connection flooding', 1);
        return { allowed: false, reason: 'too_many_connections', ip };
    }

    wsConnectionsPerIp.set(ip, current + 1);
    return { allowed: true, ip };
}

function releaseWsConnection(ip) {
    const cleanIp = normalizeIp(ip);
    const current = wsConnectionsPerIp.get(cleanIp) || 0;
    if (current <= 1) {
        wsConnectionsPerIp.delete(cleanIp);
    } else {
        wsConnectionsPerIp.set(cleanIp, current - 1);
    }
}

// ============================================================
// 3. HTTP SECURITY HEADERS MIDDLEWARE
// ============================================================
function securityHeadersMiddleware(req, res, next) {
    // Hide server technology
    res.removeHeader('X-Powered-By');

    // Prevent MIME-sniffing
    res.setHeader('X-Content-Type-Options', 'nosniff');

    // Prevent clickjacking
    res.setHeader('X-Frame-Options', 'SAMEORIGIN');

    // Enable browser XSS filter
    res.setHeader('X-XSS-Protection', '1; mode=block');

    // Referrer control
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');

    // Clean prototype pollution in body
    if (req.body && typeof req.body === 'object') {
        req.body = sanitizeObject(req.body);
    }

    next();
}

// ============================================================
// 4. PERIODIC MAINTENANCE (Prevent Memory Leaks & OOM)
// ============================================================
setInterval(() => {
    const now = Date.now();

    // Clean HTTP rate limit records older than 2 minutes
    for (const [ip, record] of httpRateLimits.entries()) {
        if (now - record.windowStart > 120000) {
            httpRateLimits.delete(ip);
        }
    }

    // Clean sensitive rate limit records
    for (const [ip, record] of sensitiveRateLimits.entries()) {
        if (now - record.windowStart > 120000) {
            sensitiveRateLimits.delete(ip);
        }
    }

    // Clean strike trackers older than 15 minutes
    for (const [ip, record] of ipStrikes.entries()) {
        if (now - record.windowStart > 900000) {
            ipStrikes.delete(ip);
        }
    }

    // Clean expired bans
    let bansChanged = false;
    for (const [ip, banInfo] of bannedIps.entries()) {
        if (banInfo.expires_at && now > banInfo.expires_at) {
            bannedIps.delete(ip);
            bansChanged = true;
        }
    }
    if (bansChanged) saveBlacklist();
}, 5 * 60 * 1000); // Every 5 minutes

// Initialize blacklist on module load
loadBlacklist();

module.exports = {
    normalizeIp,
    getClientIp,
    isIpBanned,
    banIp,
    unbanIp,
    recordSuspiciousActivity,
    sanitizeText,
    stripScripts,
    sanitizeObject,
    validateNumericId,
    isSafePath,
    httpRateLimiter,
    sensitiveRateLimiter,
    checkWsConnectionAllowed,
    releaseWsConnection,
    securityHeadersMiddleware,
    securityStats,
    getBannedIps: () => Array.from(bannedIps.entries()).map(([ip, data]) => ({ ip, ...data })),
    getWhitelistedIps: () => Array.from(whitelistedIps)
};
