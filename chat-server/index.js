const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const url = require('url');
const path = require('path');
const fs = require('fs');
const bcrypt = require('bcryptjs');
const maxmind = require('maxmind');
const nodemailer = require('nodemailer');

// Anonymous name generator (deprecated - widget now asks for name via form)
// const ANON_ADJECTIVES = [
//     'Невідома', 'Таємнича', 'Хоробра', 'Весела', 'Мудра',
//     'Швидка', 'Тиха', 'Зоряна', 'Лісова', 'Сонячна',
//     'Грайлива', 'Спритна', 'Чарівна', 'Славна', 'Вільна',
//     'Смілива', 'Ніжна', 'Яскрава', 'Дивна', 'Казкова'
// ];
// const ANON_ANIMALS = [
//     'Черепаха', 'Панда', 'Лисиця', 'Сова', 'Бджола',
//     'Білка', 'Зірка', 'Жирафа', 'Видра', 'Коала',
//     'Чайка', 'Метелик', 'Ластівка', 'Рись', 'Зебра',
//     'Кішка', 'Хмарка', 'Перлина', 'Квітка', 'Ягідка'
// ];
//
// function generateAnonName(sessionId) {
//     let hash = 0;
//     for (let i = 0; i < sessionId.length; i++) {
//         hash = ((hash << 5) - hash) + sessionId.charCodeAt(i);
//         hash = hash & hash;
//     }
//     hash = Math.abs(hash);
//     const adj = ANON_ADJECTIVES[hash % ANON_ADJECTIVES.length];
//     const animal = ANON_ANIMALS[Math.floor(hash / ANON_ADJECTIVES.length) % ANON_ANIMALS.length];
//     return `${adj} ${animal}`;
// }

const { db, isTurso } = require('./db');
const { initDatabase, DEFAULT_API_TOKEN, DEFAULT_SAFETY_RULES, DEFAULT_GLOBAL_INSTRUCTIONS } = require('./db/schema');
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || '';
const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-2.0-flash';
const configLoader = require('./config-loader');
const renderSessionStore = require('./renderSessionStore');
const { AIEngine } = require('./ai-engine');
const aiEngine = new AIEngine(db, { apiKey: GEMINI_API_KEY, defaultModel: GEMINI_MODEL });
let webhookConfig = { url: '', enabled: 0 };
let timeConfig = { timezone: '0', dateFormat: 'd.m.Y', timeFormat: 'H:i' };
let realtimeTypingEnabled = 0;
let systemLogsConfig = {
    onlineStatus: 1,    // user_connected, user_left
    tabActivity: 1,     // tab_active, tab_inactive
    chatWidget: 1,      // chat_opened, chat_closed
    pageVisits: 1       // page_visit
};
let allowedOrigins = [];
let allowedAnonymousOrigins = [];
let rateLimitConfig = { maxMessagesPerMinute: 20, maxMessageLength: 1000 };
let messageLoadConfig = { adminMessagesLimit: 20, widgetMessagesLimit: 20 };
let adminLanguage = 'uk';
let businessHoursConfig = {};
let smtpConfig = { host: '', port: '', user: '', password: '', fromName: '', ssl: true };
let telegramConfig = { botToken: '', chatId: '', enabled: 0, lastUpdateId: 0 };
let telegramBots = [];
let telegramPollInFlight = false;
let telegramPollTimeout = null;

// Rate limiting storage: Map<sessionId, { timestamps: number[] }>
const rateLimitMap = new Map();

// GeoIP readers
let cityLookup = null;
let countryLookup = null;
(async () => {
    try {
        const geoDir = path.join(__dirname, 'geo');
        const cityPath = path.join(geoDir, 'city.mmdb');
        const countryPath = path.join(geoDir, 'country.mmdb');
        if (fs.existsSync(cityPath)) cityLookup = await maxmind.open(cityPath);
        if (fs.existsSync(countryPath)) countryLookup = await maxmind.open(countryPath);
        if (cityLookup || countryLookup) console.log('GeoIP databases loaded.');
    } catch (e) { console.error('GeoIP load error:', e.message); }
})();

function getClientIp(req) {
    const cfIp = req.headers['cf-connecting-ip'];
    if (cfIp) return cfIp;
    const xForwarded = req.headers['x-forwarded-for'];
    if (xForwarded) return xForwarded.split(',')[0].trim();
    const xRealIp = req.headers['x-real-ip'];
    if (xRealIp) return xRealIp;
    return req.socket.remoteAddress;
}

function getGeoInfo(ip) {
    if (!ip || ip === '::1' || ip === '127.0.0.1') return 'Localhost';
    try {
        const parts = [];
        if (countryLookup) {
            const country = countryLookup.get(ip);
            if (country && country.country) parts.push(country.country.names.en);
        }
        if (cityLookup) {
            const city = cityLookup.get(ip);
            if (city) {
                if (city.subdivisions && city.subdivisions.length > 0) parts.push(city.subdivisions[0].names.en);
                if (city.city) parts.push(city.city.names.en);
            }
        }
        if (parts.length > 0) return parts.join(', ') + ` (${ip})`;
    } catch (e) {}
    return ip;
}

function getPlatform(ua) {
    if (!ua) return 'Unknown';
    if (/linux/i.test(ua)) return 'Linux';
    if (/macintosh|mac os x/i.test(ua)) return 'Mac';
    if (/windows|win32/i.test(ua)) return 'Windows';
    if (/android/i.test(ua)) return 'Android';
    if (/iphone|ipad/i.test(ua)) return 'iOS';
    return 'Unknown';
}

function getBrowser(ua) {
    if (!ua) return 'Unknown';
    if (/edg/i.test(ua)) return 'Edge';
    if (/opr|opera/i.test(ua)) return 'Opera';
    if (/chrome/i.test(ua) && !/edg/i.test(ua)) return 'Chrome';
    if (/safari/i.test(ua) && !/chrome/i.test(ua)) return 'Safari';
    if (/firefox/i.test(ua)) return 'Firefox';
    if (/msie|trident/i.test(ua)) return 'Internet Explorer';
    return 'Unknown';
}

function escapeHtml(str) {
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function escapeTelegramHtml(str) {
    return String(str || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
}

function getWidgetBusinessHours() {
    const hours = {
        enabled: businessHoursConfig.enabled !== undefined ? !!businessHoursConfig.enabled : Object.keys(businessHoursConfig).length > 0
    };
    const DAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
    DAYS.forEach(day => {
        if (businessHoursConfig[day]) {
            hours[day] = {
                enabled: businessHoursConfig[day].enabled,
                from: businessHoursConfig[day].from,
                to: businessHoursConfig[day].to
            };
        }
    });
    return hours;
}

function getSessionInfo(req) {
    const ip = getClientIp(req);
    const ua = req.headers['user-agent'] || '';
    const geo = getGeoInfo(ip);
    const platform = getPlatform(ua);
    const browser = getBrowser(ua);
    return { ip, geo, platform, browser, user_session: `${geo}, ${platform}, ${browser}` };
}

function isAnonymousOrigin(origin) {
    if (allowedAnonymousOrigins.length === 0) return false;
    const normalizedOrigin = origin.replace(/\/+$/, '');
    return allowedAnonymousOrigins.some(allowed => {
        const normalizedAllowed = allowed.trim().replace(/\/+$/, '');
        const pattern = normalizedAllowed.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
        return new RegExp(`^${pattern}$`, 'i').test(normalizedOrigin);
    });
}

function loadAdminConfigFromDb(callback = () => {}) {
    db.get("SELECT * FROM admins ORDER BY id ASC LIMIT 1", [], (err, row) => {
        if (!err && row) {
            webhookConfig.url = row.webhook_url || '';
            webhookConfig.enabled = row.webhook_enabled || 0;
            timeConfig.timezone = row.timezone || '0';
            timeConfig.dateFormat = row.date_format || 'd.m.Y';
            timeConfig.timeFormat = row.time_format || 'H:i';
            realtimeTypingEnabled = row.realtime_typing || 0;
            systemLogsConfig.onlineStatus = row.log_online_status !== undefined ? row.log_online_status : 1;
            systemLogsConfig.tabActivity = row.log_tab_activity !== undefined ? row.log_tab_activity : 1;
            systemLogsConfig.chatWidget = row.log_chat_widget !== undefined ? row.log_chat_widget : 1;
            systemLogsConfig.pageVisits = row.log_page_visits !== undefined ? row.log_page_visits : 1;
            allowedOrigins = (row.allowed_origins || '').split('\n').filter(o => o.trim());
            allowedAnonymousOrigins = (row.allowed_anonymous_origins || '').split('\n').filter(o => o.trim());
            rateLimitConfig.maxMessagesPerMinute = row.max_messages_per_minute || 20;
            rateLimitConfig.maxMessageLength = row.max_message_length || 1000;
            messageLoadConfig.adminMessagesLimit = row.admin_messages_limit || 20;
            messageLoadConfig.widgetMessagesLimit = row.widget_messages_limit || 20;
            adminLanguage = row.admin_language || 'en';
            try { businessHoursConfig = row.business_hours ? JSON.parse(row.business_hours) : {}; } catch { businessHoursConfig = {}; }
            try { smtpConfig = row.smtp_config ? JSON.parse(row.smtp_config) : smtpConfig; } catch { /* keep default */ }
            telegramConfig.botToken = row.telegram_bot_token || '';
            telegramConfig.chatId = row.telegram_chat_id || '';
            telegramConfig.enabled = row.telegram_enabled || 0;
            telegramConfig.lastUpdateId = row.telegram_last_update_id || 0;
            try {
                telegramBots = row.telegram_bots ? JSON.parse(row.telegram_bots) : [];
            } catch {
                telegramBots = [];
            }
            if (telegramBots.length === 0 && telegramConfig.botToken) {
                telegramBots = [{
                    id: 'legacy',
                    name: 'Telegram',
                    botToken: telegramConfig.botToken,
                    enabled: !!telegramConfig.enabled,
                    lastUpdateId: telegramConfig.lastUpdateId,
                }];
            }
        }
        callback();
    });
}

function syncSiteTelegramBots() {
    const allSites = configLoader.getAllSites();
    const siteBots = allSites
        .filter(s => s.telegram && s.telegram.enabled && s.telegram.bot_token)
        .map(s => ({
            id: `site_${s.id}`,
            name: s.telegram.name || s.name || s.id,
            username: s.telegram.username || '',
            botToken: s.telegram.bot_token,
            chatId: s.telegram.chat_id || '',
            siteId: s.id,
            enabled: true,
            lastUpdateId: 0,
        }));

    if (siteBots.length > 0) {
        for (const sBot of siteBots) {
            const existingIdx = telegramBots.findIndex(b => b.siteId === sBot.siteId || b.id === sBot.id || b.botToken === sBot.botToken);
            if (existingIdx >= 0) {
                telegramBots[existingIdx] = {
                    ...telegramBots[existingIdx],
                    botToken: sBot.botToken,
                    username: sBot.username || telegramBots[existingIdx].username,
                    name: sBot.name,
                    siteId: sBot.siteId,
                    enabled: true,
                };
            } else {
                telegramBots.push(sBot);
            }
        }
        console.log(`[Telegram] Synced ${telegramBots.length} active bot(s):`, telegramBots.map(b => `${b.name || b.id} (@${b.username || 'unknown'})`).join(', '));

        if (!telegramConfig.enabled) {
            telegramConfig.enabled = 1;
            telegramConfig.botToken = telegramConfig.botToken || siteBots[0].botToken;
        }
        if (!telegramPollTimeout) {
            setTimeout(() => {
                scheduleTelegramPoll(0);
            }, 2000);
        }
    }
}

// Initialize Turso/SQLite Database schema and load admin settings
initDatabase(db).then(() => {
    loadAdminConfigFromDb(() => {
        refreshSiteDbMap();
        syncSiteTelegramBots();
        if (telegramConfig.enabled && telegramConfig.botToken && typeof startTelegramBot === 'function' && !telegramPollTimeout) {
            setTimeout(() => {
                startTelegramBot(false).catch((error) => {
                    console.error('Telegram startup error:', error.message);
                });
            }, 0);
        }
    });
}).catch(err => {
    console.error('[Database] Failed to initialize schema:', err);
});

const security = require('./security');

const app = express();
const server = http.createServer(app);

// Slowloris & Socket Exhaustion Hardening (DoS defense)
server.headersTimeout = 20000;
server.requestTimeout = 30000;
server.keepAliveTimeout = 15000;

// WebSocket Server with Payload Size Limit (128 KB max to prevent OOM crash)
const wss = new WebSocket.Server({ server, maxPayload: 128 * 1024 });

// HTTP Security Middlewares
app.use(security.securityHeadersMiddleware);
app.use(security.httpRateLimiter({ maxRequests: 200, windowMs: 60000 }));
app.use(express.json({ limit: '256kb' }));
app.use(express.urlencoded({ extended: false, limit: '256kb' }));

// Serve React admin panel static files (excluding index.html which is handled by app.get('/'))
const adminBuildPath = path.join(__dirname, 'admin-panel', 'dist');
app.use(express.static(adminBuildPath, { index: false }));

const clients = new Map();
const clientInfo = new Map();
function broadcastToAdmins(data, excludeWs = null) {
    const msg = JSON.stringify(data);
    wss.clients.forEach(client => {
        if (client.isAdmin && client.readyState === WebSocket.OPEN && client !== excludeWs) {
            client.send(msg);
        }
    });
}

// Track pending disconnects for page navigation detection
const pendingDisconnects = new Map(); // userId -> timeoutId
const recentPageVisits = new Map(); // userId -> timestamp of last page_visit
const pendingTabVisibility = new Map(); // userId -> { timeoutId, isActive }
const NAVIGATION_GRACE_PERIOD = 3000; // 3 seconds to detect page navigation
const TAB_VISIBILITY_DELAY = 500; // delay before logging tab visibility

// Track last system event per user for deduplication
const lastSystemEvent = new Map(); // userId -> { eventType, timestamp }
const SYSTEM_EVENT_DEDUP_PERIOD = 60000; // 60 seconds - don't log same event twice within this period

function checkApiToken(token, callback) {
    if (!token) return callback(false);
    db.get("SELECT api_token FROM admins ORDER BY id ASC LIMIT 1", [], (err, row) => {
        if (row && row.api_token === token) callback(true); else callback(false);
    });
}

function checkOriginAllowed(origin) {
    if (!origin) return true;
    const normalizedOrigin = origin.replace(/\/+$/, '');

    // 1. Check site-specific allowed origins from data/sites/*.json
    try {
        const sites = configLoader.getAllSites ? configLoader.getAllSites() : [];
        for (const site of sites) {
            if (Array.isArray(site.allowed_origins)) {
                const matched = site.allowed_origins.some(allowed => {
                    const normalizedAllowed = allowed.trim().replace(/\/+$/, '');
                    const pattern = normalizedAllowed.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
                    return new RegExp(`^${pattern}$`, 'i').test(normalizedOrigin);
                });
                if (matched) return true;
            }
        }
    } catch (e) {}

    // 2. Check admin global allowed origins
    if (allowedOrigins.length === 0 && allowedAnonymousOrigins.length === 0) return true;
    const allOrigins = [...allowedOrigins, ...allowedAnonymousOrigins];
    return allOrigins.some(allowed => {
        const normalizedAllowed = allowed.trim().replace(/\/+$/, '');
        const pattern = normalizedAllowed.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
        return new RegExp(`^${pattern}$`, 'i').test(normalizedOrigin);
    });
}

function checkRateLimit(sessionId) {
    const now = Date.now();
    const oneMinuteAgo = now - 60000;

    if (!rateLimitMap.has(sessionId)) {
        rateLimitMap.set(sessionId, { timestamps: [] });
    }

    const userData = rateLimitMap.get(sessionId);
    // Remove timestamps older than 1 minute
    userData.timestamps = userData.timestamps.filter(ts => ts > oneMinuteAgo);

    if (userData.timestamps.length >= rateLimitConfig.maxMessagesPerMinute) {
        return false; // Rate limit exceeded
    }

    userData.timestamps.push(now);
    return true;
}

function validateMessage(text) {
    if (!text || typeof text !== 'string') {
        return { valid: false, error: 'empty_message' };
    }
    if (text.length > rateLimitConfig.maxMessageLength) {
        return { valid: false, error: 'message_too_long', maxLength: rateLimitConfig.maxMessageLength };
    }
    return { valid: true };
}

function saveMessage(sessionId, sender, text, timestamp, callback) {
    db.run("INSERT INTO messages (session_id, sender, text, timestamp) VALUES (?, ?, ?, ?)",
        [sessionId, sender, text, timestamp],
        function(err) {
            if (!err && callback) callback(this.lastID);
        }
    );
}

function saveTelegramConfig(callback = () => {}) {
    db.run(
        `UPDATE admins
         SET telegram_bot_token = ?, telegram_chat_id = ?, telegram_enabled = ?, telegram_last_update_id = ?, telegram_bots = ?
         WHERE username = ?`,
        [telegramConfig.botToken, telegramConfig.chatId, telegramConfig.enabled, telegramConfig.lastUpdateId, JSON.stringify(telegramBots), 'admin'],
        callback
    );
}

function getMaskedTelegramConfig() {
    return {
        botToken: telegramConfig.botToken || '',
        chatId: telegramConfig.chatId || '',
        enabled: !!telegramConfig.enabled,
        lastUpdateId: telegramConfig.lastUpdateId || 0,
        bots: telegramBots.map(bot => ({
            id: bot.id,
            name: bot.name || bot.username || 'Telegram bot',
            username: bot.username || '',
            botToken: bot.botToken || '',
            enabled: !!bot.enabled,
        }))
    };
}

function getTelegramBot(botId) {
    if (!botId) return telegramBots.find(bot => bot.enabled) || telegramBots[0] || null;
    return telegramBots.find(bot => bot.id === botId || bot.siteId === botId || bot.botToken === botId || bot.username === botId)
        || telegramBots.find(bot => bot.enabled)
        || telegramBots[0]
        || null;
}

function getTelegramTopicName(sessionId, metadata = {}) {
    const rawName = metadata.user_name || metadata.name || metadata.user_email || metadata.user_id || sessionId;
    return String(rawName).trim().slice(0, 120) || sessionId;
}

function getTelegramMessageBody(sessionId, message, metadata = {}) {
    const details = [];
    if (metadata.user_session) details.push(`Session: ${escapeTelegramHtml(metadata.user_session)}`);
    if (metadata.user_id) details.push(`ID: ${escapeTelegramHtml(metadata.user_id)}`);
    if (metadata.user_email) details.push(`Email: ${escapeTelegramHtml(metadata.user_email)}`);
    if (metadata.current_url) details.push(`Page: ${escapeTelegramHtml(metadata.current_url)}`);

    const lines = [escapeTelegramHtml(message)];
    if (details.length > 0) {
        lines.push('', '---', ...details);
    }
    return lines.join('\n');
}

function callTelegramApi(method, payload = {}, bot = telegramConfig) {
    if (!bot || !bot.botToken) {
        throw new Error('Telegram bot token is not configured');
    }

    return fetch(`https://api.telegram.org/bot${bot.botToken}/${method}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
    }).then(async (response) => {
        const data = await response.json().catch(() => ({}));
        if (!response.ok || !data.ok) {
            throw new Error(data.description || `Telegram API error (${response.status})`);
        }
        return data.result;
    });
}

function getTelegramThreadBySession(sessionId) {
    return new Promise((resolve, reject) => {
        db.get("SELECT thread_id FROM telegram_threads WHERE session_id = ?", [sessionId], (err, row) => {
            if (err) reject(err);
            else resolve(row ? row.thread_id : null);
        });
    });
}

function getSessionIdByTelegramThread(threadId) {
    return new Promise((resolve, reject) => {
        db.get("SELECT session_id FROM telegram_threads WHERE thread_id = ?", [threadId], (err, row) => {
            if (err) reject(err);
            else resolve(row ? row.session_id : null);
        });
    });
}

function saveTelegramThreadMapping(sessionId, threadId, topicName) {
    return new Promise((resolve, reject) => {
        db.run(
            `INSERT INTO telegram_threads (session_id, thread_id, topic_name, created_at)
             VALUES (?, ?, ?, CURRENT_TIMESTAMP)
             ON CONFLICT(session_id) DO UPDATE SET thread_id = excluded.thread_id, topic_name = excluded.topic_name`,
            [sessionId, threadId, topicName],
            (err) => {
                if (err) reject(err);
                else resolve();
            }
        );
    });
}

async function createTelegramThread(sessionId, metadata = {}) {
    const topicName = getTelegramTopicName(sessionId, metadata);
    const result = await callTelegramApi('createForumTopic', {
        chat_id: telegramConfig.chatId,
        name: topicName
    });
    await saveTelegramThreadMapping(sessionId, result.message_thread_id, topicName);
    return result.message_thread_id;
}

async function getOrCreateTelegramThread(sessionId, metadata = {}) {
    const existingThreadId = await getTelegramThreadBySession(sessionId);
    if (existingThreadId) {
        return existingThreadId;
    }
    return createTelegramThread(sessionId, metadata);
}

async function sendTelegramMessage(sessionId, message, metadata = {}) {
    if (!telegramConfig.enabled || !telegramConfig.botToken || !telegramConfig.chatId || !message) {
        return;
    }

    let threadId = await getOrCreateTelegramThread(sessionId, metadata);
    const payload = {
        chat_id: telegramConfig.chatId,
        message_thread_id: threadId,
        text: getTelegramMessageBody(sessionId, message, metadata),
        parse_mode: 'HTML'
    };

    try {
        await callTelegramApi('sendMessage', payload);
    } catch (error) {
        if (String(error.message || '').includes('message thread not found')) {
            await saveTelegramThreadMapping(sessionId, null, getTelegramTopicName(sessionId, metadata)).catch(() => {});
            threadId = await createTelegramThread(sessionId, metadata);
            await callTelegramApi('sendMessage', { ...payload, message_thread_id: threadId });
            return;
        }
        broadcastToAdmins({ type: 'system', text: `Telegram error: ${error.message}` });
        throw error;
    }
}

function scheduleTelegramPoll(delayMs = 1000) {
    if (!telegramConfig.enabled || !telegramConfig.botToken) {
        return;
    }
    if (telegramPollTimeout) {
        clearTimeout(telegramPollTimeout);
    }
        telegramPollTimeout = setTimeout(() => {
        telegramPollTimeout = null;
        pollTelegramUpdates().catch((error) => {
            console.error('Telegram poll error:', error.message);
            scheduleTelegramPoll(5000);
        });
    }, delayMs);
}

async function syncTelegramCursor() {
    if (!telegramConfig.botToken) return;
    const result = await callTelegramApi('getUpdates', {
        timeout: 0,
        limit: 100,
        allowed_updates: ['message']
    });
    if (Array.isArray(result) && result.length > 0) {
        telegramConfig.lastUpdateId = result[result.length - 1].update_id;
        await new Promise((resolve) => saveTelegramConfig(resolve));
    }
}

function stopTelegramBot() {
    telegramConfig.enabled = 0;
    telegramPollInFlight = false;
    if (telegramPollTimeout) {
        clearTimeout(telegramPollTimeout);
        telegramPollTimeout = null;
    }
    return new Promise((resolve) => saveTelegramConfig(resolve));
}

async function processTelegramUpdate(update, bot) {
    const message = update && update.message;
    if (!message || !message.chat || !message.text) {
        return;
    }
    if (message.from && message.from.is_bot) {
        return;
    }

    const text = String(message.text || '').trim();
    if (!text) {
        return;
    }

    const timestamp = new Date((message.date || Math.floor(Date.now() / 1000)) * 1000).toISOString();

    // Private bot messages become client chats and are mirrored into a new forum topic.
    if (message.chat.type === 'private') {
        const targetId = `telegram:${bot.id}:${message.chat.id}`;
        const metadata = {
            user_name: message.chat.first_name || message.from?.first_name || message.chat.username || 'Telegram user',
            user_id: String(message.chat.id),
            user_username: message.chat.username || message.from?.username || '',
            source: 'telegram',
            channel: 'telegram',
            telegram_bot_id: bot.id,
            telegram_bot_name: bot.name || bot.username || 'Telegram bot',
            user_session: targetId,
            site_id: bot.siteId || (bot.id && bot.id.startsWith('site_') ? bot.id.replace('site_', '') : ''),
        };

        updateSessionInfo(targetId, metadata);

        saveMessage(targetId, 'client', text, timestamp, (newId) => {
            broadcastToAdmins({ type: 'client_msg', from: targetId, text, info: metadata, timestamp, id: newId });

            // Trigger AI Chat Pipeline for Telegram client message
            handleAIChatPipeline(targetId, text, metadata, '').catch((error) => {
                console.error('Telegram AI pipeline error:', error.message);
            });
        });
        return;
    }

    return;
}

async function pollTelegramUpdates() {
    const activeBots = telegramBots.filter(item => item.enabled && item.botToken);
    if ((!telegramConfig.enabled && activeBots.length === 0) || telegramPollInFlight) {
        return;
    }

    telegramPollInFlight = true;
    try {
        for (const bot of telegramBots.filter(item => item.enabled && item.botToken)) {
            const updates = await callTelegramApi('getUpdates', {
                offset: (bot.lastUpdateId || 0) + 1,
                timeout: 0,
                allowed_updates: ['message']
            }, bot);

            if (Array.isArray(updates) && updates.length > 0) {
                for (const update of updates) {
                    bot.lastUpdateId = update.update_id;
                    await processTelegramUpdate(update, bot);
                }
            }
        }
        await new Promise((resolve) => saveTelegramConfig(resolve));
    } finally {
        telegramPollInFlight = false;
    }

    scheduleTelegramPoll(0);
}

async function startTelegramBot(skipBacklog = false) {
    if (!telegramConfig.botToken) {
        throw new Error('Enter the Telegram bot token');
    }

    const botsToStart = telegramBots.some(bot => bot.enabled)
        ? telegramBots.filter(bot => bot.enabled)
        : [{
        id: 'legacy',
        name: 'Telegram',
        botToken: telegramConfig.botToken,
        enabled: true,
        lastUpdateId: telegramConfig.lastUpdateId,
    }];
    for (const bot of botsToStart) {
        if (!bot.botToken) continue;
        const me = await callTelegramApi('getMe', {}, bot);
        bot.username = me.username || '';
        bot.name = bot.name || me.first_name || me.username || 'Telegram bot';
        bot.enabled = true;
    }
    telegramBots = botsToStart;

    await callTelegramApi('deleteWebhook', { drop_pending_updates: false });
    if (skipBacklog) {
        await syncTelegramCursor();
    }

    telegramConfig.enabled = 1;
    await new Promise((resolve) => saveTelegramConfig(resolve));
    scheduleTelegramPoll(0);
}

// Check if this event should be deduplicated (same event too recently)
function shouldDeduplicateEvent(userId, eventType) {
    const lastEvent = lastSystemEvent.get(userId);
    const now = Date.now();

    if (lastEvent && lastEvent.eventType === eventType && (now - lastEvent.timestamp) < SYSTEM_EVENT_DEDUP_PERIOD) {
        return true; // Skip this event
    }

    // Update last event
    lastSystemEvent.set(userId, { eventType, timestamp: now });
    return false;
}

function saveSystemEvent(sessionId, eventType, callback) {
    // Check if this event type should be logged based on settings
    const eventTypeToSetting = {
        'user_connected': 'onlineStatus',
        'user_left': 'onlineStatus',
        'tab_active': 'tabActivity',
        'tab_inactive': 'tabActivity',
        'chat_opened': 'chatWidget',
        'chat_closed': 'chatWidget'
    };

    // page_visit events start with "page_visit:"
    const setting = eventType.startsWith('page_visit:') ? 'pageVisits' : eventTypeToSetting[eventType];

    if (setting && !systemLogsConfig[setting]) {
        return; // Skip saving if this log type is disabled
    }

    const timestamp = new Date().toISOString();
    // sender = 'system', text contains the event type (user_connected, user_left, tab_active, tab_inactive)
    db.run("INSERT INTO messages (session_id, sender, text, timestamp) VALUES (?, ?, ?, ?)",
        [sessionId, 'system', eventType, timestamp],
        function(err) {
            if (!err && callback) callback(this.lastID, timestamp);
        }
    );
}

function updateSessionInfo(sessionId, metadata) {
    const jsonMeta = JSON.stringify(metadata);
    db.run(`INSERT INTO sessions (session_id, metadata, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP)
            ON CONFLICT(session_id) DO UPDATE SET metadata=excluded.metadata, updated_at=CURRENT_TIMESTAMP`, [sessionId, jsonMeta]);
}

function getHistory(sessionId, callback, limit = null, beforeId = null, excludeSystem = false) {
    let query, params;
    const senderFilter = excludeSystem ? " AND sender != 'system'" : "";

    if (beforeId) {
        // Load older messages (before given ID)
        query = `SELECT id, sender, text, timestamp FROM messages WHERE session_id = ? AND id < ?${senderFilter} ORDER BY id DESC LIMIT ?`;
        params = [sessionId, beforeId, limit || 20];
    } else if (limit) {
        // Load latest messages with limit
        query = `SELECT * FROM (SELECT id, sender, text, timestamp FROM messages WHERE session_id = ?${senderFilter} ORDER BY id DESC LIMIT ?) ORDER BY id ASC`;
        params = [sessionId, limit];
    } else {
        // Load all (fallback)
        query = `SELECT id, sender, text, timestamp FROM messages WHERE session_id = ?${senderFilter} ORDER BY id ASC`;
        params = [sessionId];
    }
    db.all(query, params, (err, rows) => {
        if (!err) {
            // If we loaded older messages, reverse to get correct order
            if (beforeId) rows = rows.reverse();
            callback(rows);
        }
    });
}

function getAllSessions(callback) {
    db.all(`SELECT s.session_id, s.metadata, s.updated_at,
                   lm.text AS last_message_text, lm.timestamp AS last_message_time, lm.sender AS last_message_sender
            FROM sessions s
            LEFT JOIN (
                SELECT m1.session_id, m1.text, m1.timestamp, m1.sender
                FROM messages m1
                INNER JOIN (
                    SELECT session_id, MAX(id) AS max_id
                    FROM messages WHERE sender != 'system'
                    GROUP BY session_id
                ) m2 ON m1.id = m2.max_id
            ) lm ON s.session_id = lm.session_id
            ORDER BY s.updated_at DESC`, [], (err, rows) => { if (!err) callback(rows); });
}

function sendToUserTabs(userId, data) {
    wss.clients.forEach(client => {
        if (client.userId === userId && client.readyState === WebSocket.OPEN) client.send(JSON.stringify(data));
    });
}

async function sendWebhook(userId, message, metadata, timestamp) {
    if (!webhookConfig.enabled || !webhookConfig.url) return;
    const payload = { session_data: [{ session_id: userId, metadata: metadata || {}, updated_at: timestamp }], message_text: message };
    try { await fetch(webhookConfig.url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) }); } catch (error) { console.error("Webhook Error:", error.message); }
}

async function handleAIChatPipeline(userId, message, metadata = {}, origin = '') {
    try {
        const history = await new Promise((resolve) => {
            getHistory(userId, (rows) => resolve(rows.slice(-15)), 15, null, true);
        });

        let channelType = 'widget';
        if (metadata.channel) {
            channelType = metadata.channel;
        } else if (metadata.source) {
            channelType = metadata.source;
        } else if (userId.startsWith('telegram:')) {
            channelType = 'telegram';
        } else if (userId.startsWith('email:')) {
            channelType = 'email';
        } else if (userId.startsWith('software:') || userId.startsWith('soft_')) {
            channelType = 'software';
        }

        const aiResult = await aiEngine.processIncomingMessage({
            sessionId: userId,
            userMessage: message,
            metadata,
            origin,
            conversationHistory: history,
            channelType
        });

        if (!aiResult || !aiResult.handled) {
            return;
        }

        const timestamp = new Date().toISOString();

        // Helper to deliver AI response to Telegram or Email channels
        const deliverToExternalChannels = (responseText) => {
            // Telegram delivery
            if (userId.startsWith('telegram:')) {
                const clientMeta = clientInfo.get(userId) || metadata || {};
                const bot = getTelegramBot(clientMeta.telegram_bot_id);
                const privateChatId = userId.split(':').slice(-1)[0];
                callTelegramApi('sendMessage', {
                    chat_id: privateChatId,
                    text: responseText,
                }, bot).catch((error) => {
                    console.error('Telegram AI reply error:', error.message);
                });
            }

            // Email delivery
            if (userId.startsWith('email:') || metadata.source === 'email' || metadata.channel === 'email') {
                const recipientEmail = metadata.user_email || metadata.email;
                if (recipientEmail && smtpConfig.host && smtpConfig.user && smtpConfig.password) {
                    try {
                        const transport = nodemailer.createTransport({
                            host: smtpConfig.host,
                            port: parseInt(smtpConfig.port) || 587,
                            secure: smtpConfig.ssl,
                            auth: { user: smtpConfig.user, pass: smtpConfig.password }
                        });
                        const fromAddress = smtpConfig.fromName ? `"${smtpConfig.fromName}" <${smtpConfig.user}>` : smtpConfig.user;
                        transport.sendMail({
                            from: fromAddress,
                            to: recipientEmail,
                            subject: metadata.subject ? `Re: ${metadata.subject}` : 'Chat Support AI Response',
                            text: responseText
                        }).catch(err => console.error('Email AI reply error:', err.message));
                    } catch (mailErr) {
                        console.error('Email AI transport error:', mailErr.message);
                    }
                }
            }
        };

        // 1. Suggest Reply Mode: Broadcast suggestion to admin panel, do NOT send to user directly
        if (aiResult.aiMode === 'suggest_reply') {
            broadcastToAdmins({
                type: 'ai_suggestion',
                targetId: userId,
                suggestion: aiResult.message,
                confidence: aiResult.confidence,
                siteId: aiResult.site?.id,
                siteName: aiResult.site?.name,
                action: aiResult.action,
                reason: aiResult.escalationReason,
                summary: aiResult.summary,
                timestamp
            });
            return;
        }

        // 2. Escalation Triggered
        if (aiResult.shouldEscalate) {
            saveMessage(userId, 'support', aiResult.message, timestamp, (id) => {
                sendToUserTabs(userId, { text: aiResult.message, sender: 'support', timestamp, id });
                broadcastToAdmins({
                    type: 'admin_msg_sent',
                    targetId: userId,
                    text: aiResult.message,
                    timestamp,
                    id,
                    ai: true,
                    escalated: true
                });
                broadcastToAdmins({
                    type: 'session_escalated',
                    targetId: userId,
                    ticketId: aiResult.ticketId,
                    reason: aiResult.escalationReason,
                    summary: aiResult.summary,
                    siteName: aiResult.site?.name,
                    timestamp
                });
                broadcastToAdmins({
                    type: 'session_ai_status_update',
                    targetId: userId,
                    status: 'escalated'
                });

                deliverToExternalChannels(aiResult.message);
            });
            return;
        }

        // 3. Normal Automatic Reply
        if (aiResult.action === 'reply') {
            saveMessage(userId, 'support', aiResult.message, timestamp, (id) => {
                sendToUserTabs(userId, { text: aiResult.message, sender: 'support', timestamp, id });
                broadcastToAdmins({
                    type: 'admin_msg_sent',
                    targetId: userId,
                    text: aiResult.message,
                    timestamp,
                    id,
                    ai: true
                });

                deliverToExternalChannels(aiResult.message);
            });
        }
    } catch (err) {
        console.error('Error in handleAIChatPipeline:', err.message);
    }
}

const handleApiMessageSend = (targetId, message, res) => {
    const timestamp = new Date().toISOString();
    saveMessage(targetId, 'support', message, timestamp, (newId) => {
        sendToUserTabs(targetId, { text: message, sender: 'support', timestamp: timestamp, id: newId });
        broadcastToAdmins({ type: 'api_msg_sent', targetId: targetId, text: message, timestamp: timestamp, id: newId });
        res.json({ status: 'success', sent_to: targetId, message: message, id: newId });
    });
};

// Lightweight Health Check endpoint for Render and external uptime monitoring (e.g. ping every ~10 minutes)
app.get('/health', async (req, res) => {
    try {
        const pingResult = await db.ping().catch(() => ({ ok: false, latencyMs: -1 }));
        res.json({
            status: 'ok',
            timestamp: Date.now(),
            service: 'chat-support-by-akuniverse',
            database: {
                status: pingResult.ok ? 'connected' : 'degraded',
                type: isTurso ? 'turso' : 'sqlite_local',
                latencyMs: pingResult.latencyMs
            }
        });
    } catch (e) {
        res.status(200).json({ status: 'ok', timestamp: Date.now(), service: 'chat-support-by-akuniverse' });
    }
});

app.get('/', (req, res) => {
    if (req.query['get-all-chats-api'] === 'true') {
        const token = req.query.token;
        checkApiToken(token, (isValid) => {
            if (!isValid) return res.status(403).json({ error: 'Invalid Token' });
            getAllSessions((rows) => {
                const result = rows.map(r => ({ session_id: r.session_id, metadata: JSON.parse(r.metadata || '{}'), updated_at: r.updated_at }));
                res.json(result);
            });
        });
        return;
    }

    if (req.query['send-message-to-chat-api'] === 'true') {
        const token = req.query.token;
        const targetId = req.query.targetId;
        const message = req.query.message;
        checkApiToken(token, (isValid) => {
            if (!isValid) return res.status(403).json({ error: 'Invalid Token' });
            if (!targetId || !message) return res.status(400).json({ error: 'Missing targetId or message' });
            handleApiMessageSend(targetId, message, res);
        });
        return;
    }
    // Serve React admin panel
    const indexPath = path.join(adminBuildPath, 'index.html');
    if (fs.existsSync(indexPath)) {
        res.sendFile(indexPath);
    } else {
        // Fallback to old admin.html if React build doesn't exist
        res.sendFile(path.join(__dirname, 'admin.html'));
    }
});

app.post('/', (req, res) => {
    if (req.query['send-message-to-chat-api'] === 'true') {
        const token = req.query.token || req.body.token;
        const targetId = req.body.targetId || req.query.targetId;
        const message = req.body.message || req.query.message;
        checkApiToken(token, (isValid) => {
            if (!isValid) return res.status(403).json({ error: 'Invalid Token' });
            if (!targetId || !message) return res.status(400).json({ error: 'Missing targetId or message' });
            handleApiMessageSend(targetId, message, res);
        });
        return;
    }
    res.status(404).send('Not Found');
});

app.get('/widget.js', (req, res) => res.sendFile(path.join(__dirname, 'widget.js')));
app.get('/favicon.ico', (req, res) => res.sendFile(path.join(__dirname, 'favicon.ico')));

// Public endpoint: business hours for widget
app.get('/api/business-hours', (req, res) => {
    const origin = req.headers.origin || '';
    if (origin && checkOriginAllowed(origin)) {
        res.header('Access-Control-Allow-Origin', origin);
    }
    res.json({ businessHours: getWidgetBusinessHours(), timezone: timeConfig.timezone });
});

// Contact form: CORS preflight
app.options('/api/contact-form', (req, res) => {
    const origin = req.headers.origin || '';
    if (origin && checkOriginAllowed(origin)) {
        res.header('Access-Control-Allow-Origin', origin);
        res.header('Access-Control-Allow-Methods', 'POST, OPTIONS');
        res.header('Access-Control-Allow-Headers', 'Content-Type');
    }
    res.sendStatus(204);
});

// Contact form: submit offline message
app.post('/api/contact-form', security.sensitiveRateLimiter(15), (req, res) => {
    const origin = req.headers.origin || '';
    if (origin && checkOriginAllowed(origin)) {
        res.header('Access-Control-Allow-Origin', origin);
        res.header('Access-Control-Allow-Headers', 'Content-Type');
    }

    const name = security.stripScripts(req.body.name || '').trim();
    const email = (req.body.email || '').trim();
    const phone = (req.body.phone || '').trim().replace(/[^\d\s\+\-\(\)]/g, '');
    const message = security.stripScripts(req.body.message || '').trim();
    const pageUrl = (req.body.pageUrl || '').trim();
    const sessionInfo = getSessionInfo(req);

    // Validation
    if (!name || name.length < 2 || name.length > 60) {
        return res.status(400).json({ error: 'invalid_name' });
    }
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        return res.status(400).json({ error: 'invalid_email' });
    }
    if (phone && phone.length > 25) {
        return res.status(400).json({ error: 'invalid_phone' });
    }
    if (!message || message.length > 2000) {
        return res.status(400).json({ error: 'invalid_message' });
    }

    // Check SMTP
    if (!smtpConfig.host || !smtpConfig.user || !smtpConfig.password) {
        console.error('Contact form: SMTP not configured');
        return res.status(500).json({ error: 'smtp_not_configured' });
    }

    // Check notification emails
    const notificationEmails = (businessHoursConfig.notificationEmails || '')
        .split('\n').map(e => e.trim()).filter(e => e && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e));

    if (notificationEmails.length === 0) {
        console.error('Contact form: No notification emails configured');
        return res.status(500).json({ error: 'no_notification_emails' });
    }

    const transport = nodemailer.createTransport({
        host: smtpConfig.host,
        port: parseInt(smtpConfig.port) || 587,
        secure: smtpConfig.ssl,
        auth: { user: smtpConfig.user, pass: smtpConfig.password }
    });

    const htmlBody = `
        <h2>New contact form message</h2>
        <table style="border-collapse:collapse;width:100%;max-width:600px;">
            <tr><td style="padding:8px;border:1px solid #ddd;font-weight:bold;">Name</td><td style="padding:8px;border:1px solid #ddd;">${escapeHtml(name.trim())}</td></tr>
            <tr><td style="padding:8px;border:1px solid #ddd;font-weight:bold;">Email</td><td style="padding:8px;border:1px solid #ddd;"><a href="mailto:${escapeHtml(email.trim())}">${escapeHtml(email.trim())}</a></td></tr>
            <tr><td style="padding:8px;border:1px solid #ddd;font-weight:bold;">Phone</td><td style="padding:8px;border:1px solid #ddd;">${escapeHtml((phone || '').trim()) || '—'}</td></tr>
            <tr><td style="padding:8px;border:1px solid #ddd;font-weight:bold;">Message</td><td style="padding:8px;border:1px solid #ddd;">${escapeHtml(message.trim()).replace(/\n/g, '<br>')}</td></tr>
            <tr><td style="padding:8px;border:1px solid #ddd;font-weight:bold;">Location</td><td style="padding:8px;border:1px solid #ddd;">${escapeHtml(sessionInfo.geo)}</td></tr>
            <tr><td style="padding:8px;border:1px solid #ddd;font-weight:bold;">Device</td><td style="padding:8px;border:1px solid #ddd;">${escapeHtml(sessionInfo.platform)}, ${escapeHtml(sessionInfo.browser)}</td></tr>
            ${pageUrl ? `<tr><td style="padding:8px;border:1px solid #ddd;font-weight:bold;">Page</td><td style="padding:8px;border:1px solid #ddd;"><a href="${escapeHtml(pageUrl)}">${escapeHtml(pageUrl)}</a></td></tr>` : ''}
        </table>
        <p style="color:#999;font-size:12px;margin-top:20px;">Sent from Chat Support by AKUniverse contact form</p>
    `;

    const fromAddress = smtpConfig.fromName ? `"${smtpConfig.fromName}" <${smtpConfig.user}>` : smtpConfig.user;

    transport.sendMail({
        from: fromAddress,
        to: notificationEmails.join(', '),
        replyTo: email.trim(),
        subject: `Contact form: ${name.trim()}`,
        html: htmlBody,
    }).then(() => {
        res.json({ status: 'success' });
    }).catch((err) => {
        console.error('Contact form email error:', err.message);
        res.status(500).json({ error: 'send_failed' });
    });
});

// ============================================================
// ADMIN AUTH & RENDER STORAGE SESSION MANAGEMENT
// ============================================================

// Helper: Require admin authentication (checks Render storage first, zero Turso load)
function requireAdminAuth(req, res, next) {
    const rawToken = req.headers.authorization?.replace(/^Bearer\s+/i, '') || req.headers['x-session-token'] || req.query?.sessionToken;
    const token = typeof rawToken === 'string' ? rawToken.trim() : '';
    const clientIp = security.getClientIp(req);

    // 1. Fast check against Render disk session storage (zero Turso load!)
    if (token && token.startsWith('aksess_')) {
        const session = renderSessionStore.validateSession(token, clientIp);
        if (session) {
            req.adminSession = session;
            return next();
        }
    }

    // 2. Direct env / default API tokens
    if (token && (token === DEFAULT_API_TOKEN || (process.env.ADMIN_API_TOKEN && token === process.env.ADMIN_API_TOKEN.trim()))) {
        return next();
    }

    // 3. Fallback check against DB
    checkApiToken(token, (isValid) => {
        if (isValid) return next();
        security.recordSuspiciousActivity(clientIp, 'Unauthorized Admin API access attempt', 1);
        res.status(401).json({ error: 'unauthorized' });
    });
}

// REST API: Admin login -> saves session to Render disk storage (data/admin_sessions.json)
app.post('/api/auth/login', (req, res) => {
    const { username, password } = req.body || {};
    const clientIp = security.getClientIp(req);
    const cleanAuthPass = (password || '').trim().replace(/^['"]|['"]$/g, '');
    const rawEnvPass = process.env.ADMIN_PASSWORD ? process.env.ADMIN_PASSWORD.trim() : '';
    const cleanEnvPass = rawEnvPass.replace(/^['"]|['"]$/g, '');

    db.get("SELECT * FROM admins ORDER BY id ASC LIMIT 1", [], (err, row) => {
        const passwordMatches = (cleanEnvPass && cleanAuthPass === cleanEnvPass) ||
                                (rawEnvPass && password === rawEnvPass) ||
                                (row && row.password_hash && (bcrypt.compareSync(cleanAuthPass, row.password_hash) || bcrypt.compareSync(password, row.password_hash)));
        if (passwordMatches) {
            // Save session into Render local disk storage - NOT Turso
            const session = renderSessionStore.createSession({
                username: username || row?.username || process.env.ADMIN_USERNAME || 'admin4353',
                ip: clientIp,
                userAgent: req.headers['user-agent'] || ''
            });
            console.log(`[Auth API] Admin logged in. Session saved to Render storage: ${session.token.slice(0, 18)}...`);
            return res.json({
                success: true,
                sessionToken: session.token,
                session,
                apiToken: row?.api_token || process.env.ADMIN_API_TOKEN || DEFAULT_API_TOKEN
            });
        }
        security.recordSuspiciousActivity(clientIp, 'Failed admin login attempt', 1);
        return res.status(401).json({ error: 'invalid_credentials' });
    });
});

// REST API: Admin logout -> deletes session from Render disk storage
app.post('/api/auth/logout', (req, res) => {
    const rawToken = req.headers.authorization?.replace(/^Bearer\s+/i, '') || req.body?.sessionToken;
    const token = typeof rawToken === 'string' ? rawToken.trim() : '';
    if (token) {
        renderSessionStore.destroySession(token);
    }
    res.json({ success: true, message: 'Logged out successfully from Render storage' });
});

// REST API: Verify session from Render disk storage (zero Turso load)
app.get('/api/auth/session', (req, res) => {
    const rawToken = req.headers.authorization?.replace(/^Bearer\s+/i, '') || req.query?.sessionToken || req.query?.token;
    const token = typeof rawToken === 'string' ? rawToken.trim() : '';
    const clientIp = security.getClientIp(req);
    const session = renderSessionStore.validateSession(token, clientIp);
    if (session) {
        return res.json({ valid: true, session });
    }
    return res.status(401).json({ valid: false, error: 'invalid_or_expired_session' });
});

// REST API: List active Render storage sessions (admin only)
app.get('/api/auth/sessions', requireAdminAuth, (req, res) => {
    res.json({
        storage: 'render_disk',
        filePath: 'data/admin_sessions.json',
        sessions: renderSessionStore.listSessions()
    });
});

// Helper: Cache mapping of site slug / domain / name to DB numeric ID
const siteSlugToDbId = new Map();

function refreshSiteDbMap(callback = () => {}) {
    db.all("SELECT id, domain, name FROM sites", [], (err, rows) => {
        if (!err && Array.isArray(rows)) {
            siteSlugToDbId.clear();
            const allSites = configLoader.getAllSites ? configLoader.getAllSites() : [];

            for (const row of rows) {
                siteSlugToDbId.set(String(row.id), row.id);
                siteSlugToDbId.set(row.id, row.id);
                if (row.domain) siteSlugToDbId.set(row.domain.toLowerCase(), row.id);
                if (row.name) siteSlugToDbId.set(row.name.toLowerCase(), row.id);
            }

            for (const s of allSites) {
                const foundRow = rows.find(r => 
                    (r.domain && s.domain && r.domain.toLowerCase() === s.domain.toLowerCase()) ||
                    (r.name && s.name && r.name.toLowerCase() === s.name.toLowerCase()) ||
                    s.id.toLowerCase() === r.name?.toLowerCase() ||
                    s.id.toLowerCase().includes(r.name?.toLowerCase()) ||
                    (r.name && s.id.toLowerCase().includes(r.name.toLowerCase().replace(/\s+/g, '')))
                );
                if (foundRow) {
                    siteSlugToDbId.set(s.id.toLowerCase(), foundRow.id);
                }
            }
        }
        callback();
    });
}

function resolveSiteId(input) {
    if (!input) return 3; // Default to FBVerse Bot (id 3)
    if (typeof input === 'number') return input;
    const clean = String(input).toLowerCase().trim();
    if (siteSlugToDbId.has(clean)) {
        return siteSlugToDbId.get(clean);
    }
    const num = parseInt(clean, 10);
    if (!isNaN(num) && num > 0) return num;

    // Direct slug lookups
    if (clean.includes('fbverse')) return siteSlugToDbId.get('fbverse_bot') || 3;
    if (clean.includes('turboproxy')) return siteSlugToDbId.get('turboproxy') || 1;
    if (clean.includes('smsotps')) return siteSlugToDbId.get('smsotps') || 2;
    if (clean.includes('buypva')) return siteSlugToDbId.get('buypvaaccs') || 12;
    if (clean.includes('smsactivate')) return siteSlugToDbId.get('smsactivate') || 13;

    return 3;
}

// Helper: Authorize tickets creation via Admin API token OR Site api_key (for software/bots)
function requireTicketAuth(req, res, next) {
    const rawAuth = req.headers.authorization || '';
    const token = rawAuth.replace(/^Bearer\s+/i, '').trim();
    const apiKey = req.headers['x-api-key'] || req.query.api_key || token;

    const checkSite = () => {
        if (apiKey) {
            const sites = configLoader.getAllSites ? configLoader.getAllSites() : [];
            const siteIdParam = req.body?.site_id || req.params?.site_id || req.query?.site_id;

            let matchedSite = null;
            if (siteIdParam) {
                const candidate = configLoader.getSiteById ? configLoader.getSiteById(siteIdParam) : null;
                if (candidate && candidate.api_key && candidate.api_key === apiKey) {
                    matchedSite = candidate;
                }
            }

            if (!matchedSite) {
                matchedSite = sites.find(s => s.api_key && s.api_key === apiKey);
            }

            if (matchedSite) {
                req.site = matchedSite;
                if (req.body && !req.body.site_id) req.body.site_id = matchedSite.id;
                return next();
            }
        }
        const clientIp = security.getClientIp(req);
        security.recordSuspiciousActivity(clientIp, 'Unauthorized Ticket/Bug API attempt', 1);
        return res.status(401).json({
            error: 'unauthorized',
            message: 'Valid Admin API token or Site API Key required'
        });
    };

    if (token && (token === DEFAULT_API_TOKEN || (process.env.ADMIN_API_TOKEN && token === process.env.ADMIN_API_TOKEN.trim()))) {
        req.isAdmin = true;
        return next();
    }

    if (token) {
        checkApiToken(token, (isValid) => {
            if (isValid) {
                req.isAdmin = true;
                return next();
            }
            checkSite();
        });
    } else {
        checkSite();
    }
}

// Sites Management (Powered by data/sites.json preset repository)
app.post('/api/sites', requireAdminAuth, (req, res) => {
    const { domain, name, site_type, description, currency, timezone, ai_prompt, ai_reply } = req.body;
    
    if (!domain || !domain.trim()) {
        return res.status(400).json({ error: 'missing_domain' });
    }

    const cleanDomain = domain.trim().toLowerCase().replace(/^https?:\/\//, '').split('/')[0];
    const newSite = {
        id: cleanDomain.replace(/[^a-z0-9]/g, '_'),
        name: name || domain,
        domain: cleanDomain,
        site_type: site_type || 'saas',
        status: 'active',
        ai_reply: ai_reply !== false,
        description: description || '',
        currency: currency || 'USD',
        timezone: timezone || 'UTC',
        allowed_origins: [`https://${cleanDomain}`, `https://*.${cleanDomain}`],
        ai_prompt: ai_prompt || `SITE: ${name || domain}\nYou are the customer support assistant for ${name || domain}.`,
        escalation_keywords: ['human', 'agent', 'refund', 'chargeback'],
        confidence_threshold: 0.7,
        tone: 'professional',
        telegram: { bot_token: '', chat_id: '', enabled: false },
        tickets: { auto_create: true, notify_telegram: false },
        knowledge_base: []
    };

    configLoader.addSite(newSite);
    res.json({ id: newSite.id, domain: newSite.domain, name: newSite.name, ai_reply: newSite.ai_reply });
});

app.get('/api/sites', requireAdminAuth, (req, res) => {
    const sites = configLoader.getAllSites();
    const formatted = sites.map((s, idx) => ({
        id: s.id || (idx + 1),
        domain: s.domain,
        name: s.name || s.domain,
        site_type: s.site_type || 'saas',
        status: s.status || 'active',
        ai_reply: s.ai_reply !== false && s.ai_replies !== false && s.ai_enabled !== false,
        description: s.description || '',
        currency: s.currency || 'USD',
        timezone: s.timezone || 'UTC',
        article_count: Array.isArray(s.knowledge_base) ? s.knowledge_base.length : 0,
        open_tickets_count: 0
    }));
    res.json(formatted);
});

app.get('/api/sites/:id', requireAdminAuth, (req, res) => {
    const site = configLoader.getSiteById(req.params.id);
    if (!site) return res.status(404).json({ error: 'not_found' });
    res.json({
        ...site,
        article_count: Array.isArray(site.knowledge_base) ? site.knowledge_base.length : 0,
        open_tickets_count: 0
    });
});

app.put('/api/sites/:id', requireAdminAuth, (req, res) => {
    const ok = configLoader.updateSite(req.params.id, req.body);
    if (!ok) return res.status(404).json({ error: 'not_found' });
    res.json({ success: true });
});

app.delete('/api/sites/:id', requireAdminAuth, (req, res) => {
    configLoader.deleteSite(req.params.id);
    res.json({ success: true });
});

// Global AI Configuration
app.get('/api/ai/global', requireAdminAuth, (req, res) => {
    res.json({
        system_safety_rules: configLoader.getGlobalAiRules() || DEFAULT_SAFETY_RULES,
        global_instructions: DEFAULT_GLOBAL_INSTRUCTIONS,
        default_model: GEMINI_MODEL
    });
});

app.post('/api/ai/global', requireAdminAuth, (req, res) => {
    const { system_safety_rules, default_model } = req.body;
    const config = configLoader.loadConfig();
    if (system_safety_rules) config.global_ai_rules = system_safety_rules;
    configLoader.saveConfig(config);
    if (default_model) aiEngine.setDefaultModel(default_model);
    res.json({ success: true });
});

// Site Channels
app.post('/api/sites/:site_id/channels', requireAdminAuth, (req, res) => {
    res.json({ success: true });
});

app.get('/api/sites/:site_id/channels', requireAdminAuth, (req, res) => {
    const site = configLoader.getSiteById(req.params.site_id);
    const channels = [
        { channel_type: 'widget', is_enabled: 1, ai_enabled: 1, ai_model: GEMINI_MODEL, ai_mode: 'automatic' },
        { channel_type: 'telegram', is_enabled: site?.telegram?.enabled ? 1 : 0, ai_enabled: 1, ai_model: GEMINI_MODEL, ai_mode: 'automatic' },
        { channel_type: 'email', is_enabled: 0, ai_enabled: 0, ai_model: GEMINI_MODEL, ai_mode: 'suggest_reply' }
    ];
    res.json(channels);
});

// AI Instructions with Versioning
app.post('/api/sites/:site_id/ai-instructions', requireAdminAuth, (req, res) => {
    const { instructions, escalation_keywords, confidence_threshold, tone, max_response_length } = req.body;
    const site = configLoader.getSiteById(req.params.site_id);
    if (!site) return res.status(404).json({ error: 'not_found' });

    configLoader.updateSite(req.params.site_id, {
        ai_prompt: instructions !== undefined ? instructions : site.ai_prompt,
        escalation_keywords: Array.isArray(escalation_keywords) ? escalation_keywords : (typeof escalation_keywords === 'string' ? JSON.parse(escalation_keywords || '[]') : site.escalation_keywords),
        confidence_threshold: confidence_threshold !== undefined ? confidence_threshold : site.confidence_threshold,
        tone: tone || site.tone,
        max_response_length: max_response_length || site.max_response_length
    });
    res.json({ success: true, version: 1 });
});

app.get('/api/sites/:site_id/ai-instructions', requireAdminAuth, (req, res) => {
    const site = configLoader.getSiteById(req.params.site_id);
    if (!site) return res.status(404).json({ error: 'not_found' });
    res.json([
        {
            id: 1,
            site_id: site.id,
            channel_type: null,
            instructions: site.ai_prompt || '',
            escalation_keywords: site.escalation_keywords || [],
            confidence_threshold: site.confidence_threshold ?? 0.7,
            tone: site.tone || 'professional',
            max_response_length: site.max_response_length || 500,
            version: 1,
            is_active: 1
        }
    ]);
});

app.post('/api/sites/:site_id/ai-instructions/:id/restore', requireAdminAuth, (req, res) => {
    res.json({ success: true, restored_version: 1 });
});

// Site Knowledge Base (RAG)
app.get('/api/sites/:site_id/knowledge', requireAdminAuth, (req, res) => {
    const kb = configLoader.getSiteKnowledge(req.params.site_id);
    res.json(kb.map(item => ({
        id: item.id,
        site_id: req.params.site_id,
        title: item.title,
        category: item.category || 'General',
        content: item.content,
        tags: item.tags || '',
        is_active: 1
    })));
});

app.post('/api/sites/:site_id/knowledge', requireAdminAuth, (req, res) => {
    const { title, category, content, tags } = req.body;
    const site = configLoader.getSiteById(req.params.site_id);
    if (!site) return res.status(404).json({ error: 'not_found' });
    if (!title || !content) {
        return res.status(400).json({ error: 'missing_title_or_content' });
    }

    if (!Array.isArray(site.knowledge_base)) site.knowledge_base = [];
    const newArticle = {
        id: 'kb_' + Date.now().toString(36),
        title: title.trim(),
        category: category || 'General',
        content: content.trim(),
        tags: tags || ''
    };
    site.knowledge_base.push(newArticle);
    configLoader.updateSite(site.id, { knowledge_base: site.knowledge_base });
    res.json({ id: newArticle.id, success: true });
});

app.put('/api/sites/:site_id/knowledge/:id', requireAdminAuth, (req, res) => {
    const site = configLoader.getSiteById(req.params.site_id);
    if (!site) return res.status(404).json({ error: 'not_found' });

    const kb = site.knowledge_base || [];
    const item = kb.find(k => String(k.id) === String(req.params.id));
    if (!item) return res.status(404).json({ error: 'not_found' });

    const { title, category, content, tags } = req.body;
    if (title !== undefined) item.title = title;
    if (category !== undefined) item.category = category;
    if (content !== undefined) item.content = content;
    if (tags !== undefined) item.tags = tags;

    configLoader.updateSite(site.id, { knowledge_base: kb });
    res.json({ success: true });
});

app.delete('/api/sites/:site_id/knowledge/:id', requireAdminAuth, (req, res) => {
    const site = configLoader.getSiteById(req.params.site_id);
    if (!site) return res.status(404).json({ error: 'not_found' });

    site.knowledge_base = (site.knowledge_base || []).filter(k => String(k.id) !== String(req.params.id));
    configLoader.updateSite(site.id, { knowledge_base: site.knowledge_base });
    res.json({ success: true });
});

// Tickets Management
app.post('/api/sites/:site_id/tickets', requireAdminAuth, (req, res) => {
    const { session_id, channel_type, subject, priority, ai_attempted, ai_confidence, ai_response, ai_summary } = req.body;
    const site_id = req.params.site_id;

    db.run(
        `INSERT INTO tickets 
        (site_id, session_id, channel_type, subject, priority, ai_attempted, ai_confidence, ai_response, ai_summary) 
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
            site_id,
            session_id || null,
            channel_type || 'widget',
            subject || 'Support Ticket',
            priority || 'medium',
            ai_attempted ? 1 : 0,
            ai_confidence || 0,
            ai_response || null,
            typeof ai_summary === 'object' ? JSON.stringify(ai_summary) : (ai_summary || '{}')
        ],
        function(err) {
            if (err) return res.status(500).json({ error: 'db_error' });
            res.json({ id: this.lastID, success: true });
        }
    );
});

app.get('/api/sites/:site_id/tickets', requireAdminAuth, (req, res) => {
    const status = req.query.status || null;
    let query = 'SELECT * FROM tickets WHERE site_id = ?';
    let params = [req.params.site_id];

    if (status) {
        query += ' AND status = ?';
        params.push(status);
    }

    query += ' ORDER BY created_at DESC';

    db.all(query, params, (err, tickets) => {
        if (err) return res.status(500).json({ error: 'db_error' });
        const parsed = (tickets || []).map(t => {
            let summary = {};
            try { summary = JSON.parse(t.ai_summary || '{}'); } catch (e) {}
            return { ...t, ai_summary: summary };
        });
        res.json(parsed);
    });
});

app.put('/api/tickets/:id', requireAdminAuth, (req, res) => {
    const { status, priority, assigned_to, resolution } = req.body;
    
    db.run(
        'UPDATE tickets SET status = ?, priority = ?, assigned_to = ?, resolution = ?, resolved_at = ? WHERE id = ?',
        [status || 'open', priority || 'medium', assigned_to || null, resolution || null, status === 'resolved' ? new Date().toISOString() : null, req.params.id],
        function(err) {
            if (err) return res.status(500).json({ error: 'db_error' });
            res.json({ success: true });
        }
    );
});

app.get('/api/tickets', requireAdminAuth, (req, res) => {
    const status = req.query.status || null;
    const site_id = req.query.site_id || null;
    const channel_type = req.query.channel_type || null;
    let query = 'SELECT t.*, s.name as site_name, s.domain as site_domain FROM tickets t LEFT JOIN sites s ON t.site_id = s.id WHERE 1=1';
    let params = [];

    if (status && status !== 'all') {
        query += ' AND t.status = ?';
        params.push(status);
    }
    if (site_id && site_id !== 'all') {
        query += ' AND t.site_id = ?';
        params.push(site_id);
    }
    if (channel_type && channel_type !== 'all') {
        query += ' AND t.channel_type = ?';
        params.push(channel_type);
    }

    query += ' ORDER BY t.created_at DESC LIMIT 100';

    db.all(query, params, (err, tickets) => {
        if (err) return res.status(500).json({ error: 'db_error' });
        const allSites = configLoader.getAllSites ? configLoader.getAllSites() : [];
        const parsed = (tickets || []).map(t => {
            let summary = {};
            try { summary = JSON.parse(t.ai_summary || '{}'); } catch (e) {}

            const siteJson = allSites.find(s => 
                siteSlugToDbId.get(s.id) === t.site_id || 
                (t.site_domain && s.domain && s.domain.toLowerCase() === t.site_domain.toLowerCase()) ||
                (t.site_name && s.name && s.name.toLowerCase() === t.site_name.toLowerCase()) ||
                String(t.site_id).toLowerCase() === s.id.toLowerCase()
            );

            return {
                ...t,
                site_name: siteJson ? siteJson.name : (t.site_name || `Site #${t.site_id}`),
                site_domain: siteJson ? siteJson.domain : (t.site_domain || ''),
                ai_summary: summary
            };
        });
        res.json(parsed);
    });
});

app.post('/api/tickets', requireTicketAuth, security.sensitiveRateLimiter(30), (req, res) => {
    const {
        site_id,
        session_id,
        channel_type,
        subject,
        title,
        priority,
        error_log,
        traceback,
        user_id,
        version,
        ai_summary
    } = req.body;

    const targetSiteSlug = site_id || req.site?.id || 'fbverse_bot';
    const resolvedSiteId = resolveSiteId(targetSiteSlug);

    let summaryObj = {};
    if (typeof ai_summary === 'object' && ai_summary !== null) {
        summaryObj = { ...ai_summary };
    } else if (typeof ai_summary === 'string') {
        try { summaryObj = JSON.parse(ai_summary); } catch { summaryObj = { summary: ai_summary }; }
    }
    if (error_log || traceback) summaryObj.error_log = security.stripScripts(String(error_log || traceback)).slice(0, 4000);
    if (user_id) summaryObj.user_id = String(user_id).slice(0, 100);
    if (version) summaryObj.version = String(version).slice(0, 50);

    const rawSubject = subject || title || (error_log ? `Bug: ${String(error_log).slice(0, 50)}...` : 'Support Ticket');
    const finalSubject = security.stripScripts(String(rawSubject)).slice(0, 200);
    const finalChannel = channel_type || (req.site ? 'software' : 'widget');
    const finalPriority = priority || 'high';
    const finalSession = session_id || (user_id ? `software_${user_id}` : `soft_${Math.random().toString(36).substr(2, 7)}`);

    db.run(
        `INSERT INTO tickets 
        (site_id, session_id, channel_type, subject, priority, ai_attempted, ai_confidence, ai_response, ai_summary) 
        VALUES (?, ?, ?, ?, ?, 0, 0, null, ?)`,
        [
            resolvedSiteId,
            finalSession,
            finalChannel,
            finalSubject,
            finalPriority,
            JSON.stringify(summaryObj)
        ],
        function(err) {
            if (err) {
                console.error('[Tickets] Creation error:', err);
                return res.status(500).json({ error: 'db_error', message: err.message });
            }

            const ticketId = this.lastID;

            const allSites = configLoader.getAllSites ? configLoader.getAllSites() : [];
            const siteObj = allSites.find(s => s.id === targetSiteSlug || siteSlugToDbId.get(s.id) === resolvedSiteId);
            const siteName = siteObj?.name || req.site?.name || targetSiteSlug;

            broadcastToAdmins({
                type: 'new_ticket',
                ticket: {
                    id: ticketId,
                    site_id: resolvedSiteId,
                    site_name: siteName,
                    site_domain: siteObj?.domain || '',
                    channel_type: finalChannel,
                    subject: finalSubject,
                    priority: finalPriority,
                    ai_summary: summaryObj,
                    status: 'open',
                    is_read: 0,
                    created_at: new Date().toISOString()
                }
            });

            res.json({
                success: true,
                id: ticketId,
                ticket_id: ticketId,
                message: 'Ticket recorded successfully'
            });
        }
    );
});

// Dedicated Bug Report Alias Endpoint for Software / Bots
app.post('/api/bugs', requireTicketAuth, security.sensitiveRateLimiter(30), (req, res, next) => {
    req.body.channel_type = req.body.channel_type || 'software';
    if (!req.body.subject && req.body.title) req.body.subject = req.body.title;
    // Dispatch to /api/tickets handler logic
    const { site_id, subject, priority, error_log, traceback, user_id, version, ai_summary } = req.body;
    const targetSiteSlug = site_id || req.site?.id || 'fbverse_bot';
    const resolvedSiteId = resolveSiteId(targetSiteSlug);

    let summaryObj = typeof ai_summary === 'object' && ai_summary !== null ? { ...ai_summary } : {};
    if (error_log || traceback) summaryObj.error_log = security.stripScripts(String(error_log || traceback)).slice(0, 4000);
    if (user_id) summaryObj.user_id = String(user_id).slice(0, 100);
    if (version) summaryObj.version = String(version).slice(0, 50);

    const rawSubject = subject || `Software Bug: ${error_log ? String(error_log).slice(0, 45) : 'Reported issue'}`;
    const finalSubject = security.stripScripts(String(rawSubject)).slice(0, 200);

    db.run(
        `INSERT INTO tickets 
        (site_id, session_id, channel_type, subject, priority, ai_attempted, ai_confidence, ai_response, ai_summary) 
        VALUES (?, ?, 'software', ?, ?, 0, 0, null, ?)`,
        [
            resolvedSiteId,
            user_id ? `software_${user_id}` : `soft_${Math.random().toString(36).substr(2, 7)}`,
            finalSubject,
            priority || 'high',
            JSON.stringify(summaryObj)
        ],
        function(err) {
            if (err) {
                console.error('[Bugs] Creation error:', err);
                return res.status(500).json({ error: 'db_error', message: err.message });
            }

            const allSites = configLoader.getAllSites ? configLoader.getAllSites() : [];
            const siteObj = allSites.find(s => s.id === targetSiteSlug || siteSlugToDbId.get(s.id) === resolvedSiteId);
            const siteName = siteObj?.name || req.site?.name || targetSiteSlug;

            broadcastToAdmins({
                type: 'new_ticket',
                ticket: {
                    id: this.lastID,
                    site_id: resolvedSiteId,
                    site_name: siteName,
                    site_domain: siteObj?.domain || '',
                    channel_type: 'software',
                    subject: finalSubject,
                    priority: priority || 'high',
                    ai_summary: summaryObj,
                    status: 'open',
                    is_read: 0,
                    created_at: new Date().toISOString()
                }
            });
            res.json({ success: true, id: this.lastID, message: 'Bug report received and ticket logged.' });
        }
    );
});

app.delete('/api/tickets/:id', requireAdminAuth, (req, res) => {
    const id = security.validateNumericId(req.params.id);
    if (!id) return res.status(400).json({ error: 'invalid_id' });
    db.run('DELETE FROM tickets WHERE id = ?', [id], function(err) {
        if (err) return res.status(500).json({ error: 'db_error' });
        broadcastToAdmins({ type: 'ticket_deleted', id });
        res.json({ success: true, id });
    });
});

// Clear all tickets from Turso / SQLite database
app.delete('/api/tickets', requireAdminAuth, (req, res) => {
    db.run('DELETE FROM tickets', [], function(err) {
        if (err) {
            console.error('[Tickets] Clear all error:', err);
            return res.status(500).json({ error: 'db_error', message: err.message });
        }
        broadcastToAdmins({ type: 'tickets_cleared' });
        res.json({ success: true, count: this.changes || 0, message: 'All tickets cleared successfully' });
    });
});

// Mark single ticket as read
app.put('/api/tickets/:id/read', requireAdminAuth, (req, res) => {
    const id = security.validateNumericId(req.params.id);
    if (!id) return res.status(400).json({ error: 'invalid_id' });
    db.run('UPDATE tickets SET is_read = 1 WHERE id = ?', [id], function(err) {
        if (err) return res.status(500).json({ error: 'db_error' });
        broadcastToAdmins({ type: 'ticket_read', id });
        res.json({ success: true, id });
    });
});

// ============================================================
// SECURITY SUITE - ADMIN API ENDPOINTS (Blacklist & Stats)
// ============================================================
app.get('/api/security/stats', requireAdminAuth, (req, res) => {
    const banned = security.getBannedIps();
    res.json({
        ...security.securityStats,
        uptimeSeconds: Math.round((Date.now() - security.securityStats.serverStartedAt) / 1000),
        bannedIpsCount: banned.length,
        bannedIps: banned
    });
});

app.get('/api/security/blacklist', requireAdminAuth, (req, res) => {
    res.json(security.getBannedIps());
});

app.post('/api/security/blacklist', requireAdminAuth, (req, res) => {
    const { ip, reason, durationMinutes } = req.body;
    if (!ip || typeof ip !== 'string') {
        return res.status(400).json({ error: 'invalid_ip', message: 'Valid IP address string is required' });
    }
    const cleanIp = security.normalizeIp(ip);
    const durationMs = (parseInt(durationMinutes, 10) || 1440) * 60 * 1000;
    const banned = security.banIp(cleanIp, reason || 'Manually banned by administrator', durationMs);
    res.json({ success: banned, ip: cleanIp, message: banned ? 'IP blacklisted successfully' : 'Could not ban IP (whitelisted or invalid)' });
});

app.delete('/api/security/blacklist/:ip', requireAdminAuth, (req, res) => {
    const cleanIp = security.normalizeIp(req.params.ip);
    const unbanned = security.unbanIp(cleanIp);
    res.json({ success: unbanned, ip: cleanIp });
});

// AI Simulation Sandbox (Section 25 Testing)
app.post('/api/ai/simulate', requireAdminAuth, async (req, res) => {
    const { site_id, message, channel_type, customer_context } = req.body;

    if (!site_id || !message) {
        return res.status(400).json({ error: 'missing_site_id_or_message' });
    }

    try {
        db.get('SELECT * FROM sites WHERE id = ?', [site_id], async (err, site) => {
            if (err || !site) return res.status(404).json({ error: 'site_not_found' });

            const instructions = await aiEngine.getInstructions(site_id, channel_type || 'widget');
            const knowledge = await aiEngine.retrieveKnowledge(site_id, message);
            const customer = customer_context || {
                user_id: 'sim_user_1',
                user_name: 'Test Customer',
                user_email: 'customer@example.com',
                order_id: 'ORD-98765'
            };

            const promptObj = aiEngine.buildPrompt({
                site,
                customer,
                conversation: [],
                instructions,
                knowledge,
                userMessage: message,
                ticketId: 'SIM-TKT-1001'
            });

            const keywordCheck = aiEngine.checkEscalationKeywords(message, instructions.escalationKeywords);
            const aiOutput = await aiEngine.callGemini(promptObj.systemPrompt, '', message, instructions.model);

            let shouldEscalate = keywordCheck.triggered || aiOutput.requires_human || aiOutput.action === 'escalate' || (aiOutput.confidence < instructions.confidenceThreshold);
            let escalationReason = keywordCheck.triggered 
                ? `Triggered escalation keyword: "${keywordCheck.keyword}"`
                : (aiOutput.reason || (aiOutput.confidence < instructions.confidenceThreshold ? `Confidence below threshold ${instructions.confidenceThreshold}` : null));

            const resolvedMessage = aiEngine.resolveVariables(aiOutput.message, { site, customer, ticketId: 'SIM-TKT-1001' });

            res.json({
                site: { id: site.id, name: site.name, domain: site.domain },
                instructions: {
                    version: instructions.version,
                    tone: instructions.tone,
                    confidenceThreshold: instructions.confidenceThreshold,
                    model: instructions.model,
                    aiMode: instructions.aiMode
                },
                knowledge_retrieved: knowledge,
                escalation_keyword_triggered: keywordCheck,
                ai_output: {
                    action: shouldEscalate ? 'escalate' : aiOutput.action,
                    message: resolvedMessage,
                    requires_human: shouldEscalate,
                    ticket_required: shouldEscalate,
                    confidence: aiOutput.confidence,
                    reason: escalationReason,
                    ticket_summary: aiOutput.ticket_summary,
                    latency: aiOutput.latency
                },
                validation: {
                    should_escalate: shouldEscalate,
                    escalation_reason: escalationReason,
                    confidence_passed: aiOutput.confidence >= instructions.confidenceThreshold
                }
            });
        });
    } catch (e) {
        console.error('Simulation error:', e);
        res.status(500).json({ error: e.message });
    }
});

// AI Audit Logs
app.get('/api/ai/logs', requireAdminAuth, (req, res) => {
    const siteId = req.query.site_id || null;
    const limit = parseInt(req.query.limit) || 50;

    let query = 'SELECT * FROM ai_runs';
    let params = [];
    if (siteId) {
        query += ' WHERE site_id = ?';
        params.push(siteId);
    }
    query += ' ORDER BY created_at DESC LIMIT ?';
    params.push(limit);

    db.all(query, params, (err, runs) => {
        if (err) return res.status(500).json({ error: 'db_error' });
        res.json(runs || []);
    });
});

// Session AI Status & Handoff Controls
app.get('/api/sessions/:id/ai-status', requireAdminAuth, (req, res) => {
    const status = aiEngine.getSessionStatus(req.params.id);
    res.json({ status });
});

app.post('/api/sessions/:id/resume-ai', requireAdminAuth, (req, res) => {
    const sessionId = req.params.id;
    aiEngine.resumeAI(sessionId);
    broadcastToAdmins({ type: 'session_ai_status_update', targetId: sessionId, status: 'active' });
    res.json({ success: true, status: 'active' });
});

app.post('/api/sessions/:id/pause-ai', requireAdminAuth, (req, res) => {
    const sessionId = req.params.id;
    aiEngine.pauseAI(sessionId);
    broadcastToAdmins({ type: 'session_ai_status_update', targetId: sessionId, status: 'human_active' });
    res.json({ success: true, status: 'human_active' });
});

wss.on('connection', (ws, req) => {
    // 1. WebSocket IP Flood & Blacklist Check
    const wsSecurityCheck = security.checkWsConnectionAllowed(req);
    if (!wsSecurityCheck.allowed) {
        if (wsSecurityCheck.reason === 'ip_banned') {
            console.warn(`[Security] Blocked connection from banned IP: ${wsSecurityCheck.ip}`);
            ws.close(4003, 'IP address is banned');
        } else {
            console.warn(`[Security] Blocked connection - limit exceeded for IP: ${wsSecurityCheck.ip}`);
            ws.close(4029, 'Connection limit exceeded');
        }
        return;
    }
    const clientIp = wsSecurityCheck.ip;
    ws.on('close', () => {
        security.releaseWsConnection(clientIp);
    });

    const parameters = url.parse(req.url, true);
    const sessionId = parameters.query.session;
    const authPass = parameters.query.auth;
    const sessionToken = parameters.query.sessionToken;
    const origin = req.headers.origin || '';

    // Check Render disk storage session first (zero Turso load!)
    const candidateSessionToken = sessionToken || (authPass && authPass.startsWith('aksess_') ? authPass : null);
    const validRenderSession = candidateSessionToken ? renderSessionStore.validateSession(candidateSessionToken, clientIp) : null;

    if (authPass || validRenderSession) {
        const proceedAdmin = (row, sessionObj) => {
            const currentSession = sessionObj || renderSessionStore.createSession({
                username: row?.username || process.env.ADMIN_USERNAME || 'admin4353',
                ip: clientIp,
                userAgent: req.headers['user-agent'] || ''
            });
            console.log(`Admin connected (${currentSession.username}) [Render Session: ${currentSession.token.slice(0, 16)}...]`);
            ws.isAdmin = true;
            ws.adminSessionToken = currentSession.token;

            ws.send(JSON.stringify({
                type: 'auth_success',
                sessionToken: currentSession.token,
                webhookConfig: webhookConfig,
                apiToken: row?.api_token || process.env.ADMIN_API_TOKEN || DEFAULT_API_TOKEN,
                timezone: timeConfig.timezone,
                dateFormat: timeConfig.dateFormat,
                timeFormat: timeConfig.timeFormat,
                realtimeTyping: realtimeTypingEnabled,
                systemLogs: systemLogsConfig,
                allowedOrigins: row?.allowed_origins || '',
                allowedAnonymousOrigins: row?.allowed_anonymous_origins || '',
                maxMessagesPerMinute: rateLimitConfig.maxMessagesPerMinute,
                maxMessageLength: rateLimitConfig.maxMessageLength,
                adminMessagesLimit: messageLoadConfig.adminMessagesLimit,
                widgetMessagesLimit: messageLoadConfig.widgetMessagesLimit,
                language: adminLanguage,
                businessHours: businessHoursConfig,
                smtpConfig: smtpConfig,
                telegramConfig: getMaskedTelegramConfig()
            }));

                getAllSessions((rows) => {
                    const usersList = rows.map(r => ({
                        id: r.session_id,
                        info: JSON.parse(r.metadata || '{}'),
                        lastMessage: r.last_message_text ? {
                            text: r.last_message_text,
                            timestamp: r.last_message_time,
                            sender: r.last_message_sender
                        } : null
                    }));
                    ws.send(JSON.stringify({ type: 'user_list', users: usersList }));

                    // Send current online status for all connected users
                    const onlineUserIds = new Set();
                    const tabActiveUserIds = new Set();
                    wss.clients.forEach(client => {
                        if (client.userId && client.readyState === WebSocket.OPEN) {
                            onlineUserIds.add(client.userId);
                            if (client.tabActive) {
                                tabActiveUserIds.add(client.userId);
                            }
                        }
                    });
                    // Send online status for each user
                    onlineUserIds.forEach(userId => {
                        ws.send(JSON.stringify({ type: 'user_connected', id: userId }));
                        if (tabActiveUserIds.has(userId)) {
                            ws.send(JSON.stringify({ type: 'tab_visibility', userId: userId, isActive: true }));
                        }
                    });
                });

                ws.on('message', (message) => {
                    try {
                        const data = JSON.parse(message);
                        if (data.type === 'logout') {
                            if (ws.adminSessionToken) {
                                renderSessionStore.destroySession(ws.adminSessionToken);
                            }
                            ws.close(1000, 'Admin logged out');
                            return;
                        }
                        if (data.type === 'change_password') {
                            const newHash = bcrypt.hashSync(data.newPassword, 10);
                            db.run("UPDATE admins SET password_hash = ? WHERE username = ?", [newHash, 'admin'], () => ws.send(JSON.stringify({ type: 'system', text: 'Password changed successfully!' })));
                        }
                        if (data.type === 'change_api_token') {
                            db.run("UPDATE admins SET api_token = ? WHERE username = ?", [data.newToken, 'admin'], () => ws.send(JSON.stringify({ type: 'system', text: 'Token updated!' })));
                        }
                        if (data.type === 'update_webhook') {
                            const enabled = data.enabled ? 1 : 0;
                            db.run("UPDATE admins SET webhook_url = ?, webhook_enabled = ? WHERE username = ?", [data.url, enabled, 'admin'], () => {
                                webhookConfig.url = data.url; webhookConfig.enabled = enabled;
                                ws.send(JSON.stringify({ type: 'system', text: 'Webhook saved!' }));
                            });
                        }
                        if (data.type === 'update_time_settings') {
                            db.run("UPDATE admins SET timezone = ?, date_format = ?, time_format = ? WHERE username = ?",
                                [data.timezone, data.dateFormat, data.timeFormat, 'admin'], () => {
                                    timeConfig.timezone = data.timezone;
                                    timeConfig.dateFormat = data.dateFormat;
                                    timeConfig.timeFormat = data.timeFormat;
                                    ws.send(JSON.stringify({ type: 'system', text: 'Time settings saved!' }));
                                });
                        }
                        if (data.type === 'update_realtime_typing') {
                            const enabled = data.enabled ? 1 : 0;
                            db.run("UPDATE admins SET realtime_typing = ? WHERE username = ?", [enabled, 'admin'], () => {
                                realtimeTypingEnabled = enabled;
                                ws.send(JSON.stringify({ type: 'system', text: `Typing preview: ${enabled ? 'ENABLED' : 'DISABLED'}` }));
                            });
                        }
                        if (data.type === 'update_system_logs') {
                            const { setting, enabled } = data;
                            const value = enabled ? 1 : 0;
                            const columnMap = {
                                onlineStatus: 'log_online_status',
                                tabActivity: 'log_tab_activity',
                                chatWidget: 'log_chat_widget',
                                pageVisits: 'log_page_visits'
                            };
                            const column = columnMap[setting];
                            if (column) {
                                db.run(`UPDATE admins SET ${column} = ? WHERE username = ?`, [value, 'admin'], () => {
                                    systemLogsConfig[setting] = value;
                                    ws.send(JSON.stringify({ type: 'system_logs_updated', setting, enabled: value }));
                                });
                            }
                        }
                        if (data.type === 'update_allowed_origins') {
                            db.run("UPDATE admins SET allowed_origins = ? WHERE username = ?", [data.origins, 'admin'], () => {
                                allowedOrigins = data.origins.split('\n').filter(o => o.trim());
                                ws.send(JSON.stringify({ type: 'system', text: 'Allowed origins saved!' }));
                            });
                        }
                        if (data.type === 'update_anonymous_origins') {
                            db.run("UPDATE admins SET allowed_anonymous_origins = ? WHERE username = ?", [data.origins, 'admin'], () => {
                                allowedAnonymousOrigins = data.origins.split('\n').filter(o => o.trim());
                                ws.send(JSON.stringify({ type: 'system', text: 'Anonymous origins saved!' }));
                            });
                        }
                        if (data.type === 'update_language') {
                            db.run("UPDATE admins SET admin_language = ? WHERE username = ?", [data.language, 'admin'], () => {
                                adminLanguage = data.language;
                                ws.send(JSON.stringify({ type: 'language_updated', language: data.language }));
                            });
                        }
                        if (data.type === 'update_rate_limit') {
                            db.run("UPDATE admins SET max_messages_per_minute = ?, max_message_length = ? WHERE username = ?",
                                [data.maxMessagesPerMinute, data.maxMessageLength, 'admin'], () => {
                                    rateLimitConfig.maxMessagesPerMinute = data.maxMessagesPerMinute;
                                    rateLimitConfig.maxMessageLength = data.maxMessageLength;
                                    ws.send(JSON.stringify({ type: 'system', text: 'Message limits saved!' }));
                                });
                        }

                        if (data.type === 'get_history') {
                            const limit = data.limit || messageLoadConfig.adminMessagesLimit;
                            const beforeId = data.beforeId || null;
                            getHistory(data.targetId, (rows) => {
                                if (beforeId) {
                                    // Loading older messages
                                    const hasMore = rows.length === limit;
                                    ws.send(JSON.stringify({
                                        type: 'more_history',
                                        targetId: data.targetId,
                                        messages: rows,
                                        hasMore: hasMore
                                    }));
                                } else {
                                    // Initial load - check if there are older messages
                                    if (rows.length > 0) {
                                        const oldestId = rows[0].id;
                                        db.get("SELECT COUNT(*) as count FROM messages WHERE session_id = ? AND id < ?", [data.targetId, oldestId], (err, result) => {
                                            ws.send(JSON.stringify({
                                                type: 'history_data',
                                                targetId: data.targetId,
                                                messages: rows,
                                                hasMore: result ? result.count > 0 : false
                                            }));
                                        });
                                    } else {
                                        ws.send(JSON.stringify({
                                            type: 'history_data',
                                            targetId: data.targetId,
                                            messages: rows,
                                            hasMore: false
                                        }));
                                    }
                                }
                            }, limit, beforeId);
                        }

                        if (data.type === 'update_message_limits') {
                            db.run("UPDATE admins SET admin_messages_limit = ?, widget_messages_limit = ? WHERE username = ?",
                                [data.adminMessagesLimit, data.widgetMessagesLimit, 'admin'], () => {
                                    messageLoadConfig.adminMessagesLimit = data.adminMessagesLimit;
                                    messageLoadConfig.widgetMessagesLimit = data.widgetMessagesLimit;
                                    ws.send(JSON.stringify({ type: 'system', text: 'Message settings saved!' }));
                                });
                        }

                        if (data.type === 'update_business_hours') {
                            const json = JSON.stringify(data.businessHours || {});
                            db.run("UPDATE admins SET business_hours = ? WHERE username = ?", [json, 'admin'], () => {
                                businessHoursConfig = data.businessHours || {};
                                    ws.send(JSON.stringify({ type: 'system', text: 'Business hours saved!' }));
                            });
                        }

                        if (data.type === 'update_smtp') {
                            const cfg = data.smtpConfig || {};
                            const json = JSON.stringify(cfg);
                            db.run("UPDATE admins SET smtp_config = ? WHERE username = ?", [json, 'admin'], () => {
                                smtpConfig = cfg;
                                    ws.send(JSON.stringify({ type: 'system', text: 'SMTP settings saved!' }));
                            });
                        }

                        if (data.type === 'update_telegram_settings') {
                            telegramConfig.botToken = (data.telegramConfig?.botToken || '').trim();
                            telegramConfig.chatId = String(data.telegramConfig?.chatId || '').trim();
                            saveTelegramConfig(() => {
                                broadcastToAdmins({ type: 'telegram_updated', telegramConfig: getMaskedTelegramConfig() });
                                ws.send(JSON.stringify({ type: 'system', text: 'Telegram settings saved!' }));
                            });
                        }

                        if (data.type === 'update_telegram_bots') {
                            telegramBots = Array.isArray(data.bots) ? data.bots.map((bot, index) => ({
                                id: bot.id || `bot-${Date.now()}-${index}`,
                                name: String(bot.name || '').trim() || 'Telegram bot',
                                botToken: String(bot.botToken || '').trim(),
                                username: bot.username || '',
                                enabled: !!bot.enabled,
                                lastUpdateId: Number(bot.lastUpdateId || 0),
                            })).filter(bot => bot.botToken) : [];
                            telegramConfig.botToken = telegramBots[0]?.botToken || '';
                            telegramConfig.enabled = telegramBots.some(bot => bot.enabled) ? 1 : 0;
                            saveTelegramConfig(() => {
                                broadcastToAdmins({ type: 'telegram_updated', telegramConfig: getMaskedTelegramConfig() });
                                ws.send(JSON.stringify({ type: 'system', text: 'Telegram bots saved!' }));
                            });
                        }

                        if (data.type === 'toggle_telegram_bot') {
                            const shouldEnable = !!data.enabled;
                            const finalize = (messageText) => {
                                broadcastToAdmins({ type: 'telegram_updated', telegramConfig: getMaskedTelegramConfig() });
                                ws.send(JSON.stringify({ type: 'system', text: messageText }));
                            };

                            if (shouldEnable) {
                                startTelegramBot(true)
                                    .then(() => finalize('Telegram bot enabled!'))
                                    .catch((error) => {
                                        console.error('Telegram start error:', error.message);
                                        ws.send(JSON.stringify({ type: 'system', text: `Telegram error: ${error.message}` }));
                                    });
                            } else {
                                stopTelegramBot()
                                    .then(() => finalize('Telegram bot disabled!'))
                                    .catch((error) => {
                                        console.error('Telegram stop error:', error.message);
                                        ws.send(JSON.stringify({ type: 'system', text: `Telegram error: ${error.message}` }));
                                    });
                            }
                        }

                        if (data.type === 'test_smtp') {
                            const cfg = data.smtpConfig || smtpConfig;
                            const transport = nodemailer.createTransport({
                                host: cfg.host,
                                port: parseInt(cfg.port) || 587,
                                secure: cfg.ssl,
                                auth: { user: cfg.user, pass: cfg.password }
                            });
                            transport.sendMail({
                                from: cfg.fromName ? `"${cfg.fromName}" <${cfg.user}>` : cfg.user,
                                to: cfg.testEmail || cfg.user,
                                subject: 'Chat Support by AKUniverse — Test Email',
                                text: 'SMTP is configured correctly!'
                            }).then(() => {
                                ws.send(JSON.stringify({ type: 'system', text: 'Test email sent!' }));
                            }).catch((err) => {
                                ws.send(JSON.stringify({ type: 'system', text: `SMTP error: ${err.message}` }));
                            });
                        }

                        if (data.type === 'admin_typing') {
                            sendToUserTabs(data.targetId, { type: 'admin_typing', isTyping: data.isTyping });
                        }

                        if (data.type === 'admin_update_user') {
                            const existing = clientInfo.get(data.targetId) || {};
                            const merged = { ...existing, user_name: data.userName, admin_notes: data.adminNotes };
                            clientInfo.set(data.targetId, merged);
                            updateSessionInfo(data.targetId, merged);
                            ws.send(JSON.stringify({ type: 'system', text: 'Saved!' }));
                            broadcastToAdmins({ type: 'user_info_update', id: data.targetId, info: { user_name: data.userName, admin_notes: data.adminNotes } }, ws);
                        }

                        if (data.type === 'admin_reply') {
                            aiEngine.pauseAI(data.targetId);
                            broadcastToAdmins({ type: 'session_ai_status_update', targetId: data.targetId, status: 'human_active' });

                            const timestamp = new Date().toISOString();
                            saveMessage(data.targetId, 'support', data.text, timestamp, (newId) => {
                                sendToUserTabs(data.targetId, { text: data.text, sender: 'support', timestamp: timestamp, id: newId });
                                broadcastToAdmins({ type: 'admin_msg_sent', targetId: data.targetId, text: data.text, timestamp: timestamp, id: newId });

                                if (data.targetId.startsWith('telegram:')) {
                                    const metadata = clientInfo.get(data.targetId) || {};
                                    const bot = getTelegramBot(metadata.telegram_bot_id);
                                    const privateChatId = data.targetId.split(':').slice(-1)[0];
                                    callTelegramApi('sendMessage', {
                                        chat_id: privateChatId,
                                        text: data.text,
                                    }, bot)
                                        .catch((error) => {
                                            broadcastToAdmins({ type: 'system', text: `Telegram error: ${error.message}` });
                                        });
                                }
                            });
                        }

                        if (data.type === 'resume_ai') {
                            aiEngine.resumeAI(data.targetId);
                            broadcastToAdmins({ type: 'session_ai_status_update', targetId: data.targetId, status: 'active' });
                            ws.send(JSON.stringify({ type: 'system', text: 'AI resumed for this conversation' }));
                        }

                        if (data.type === 'pause_ai') {
                            aiEngine.pauseAI(data.targetId);
                            broadcastToAdmins({ type: 'session_ai_status_update', targetId: data.targetId, status: 'human_active' });
                            ws.send(JSON.stringify({ type: 'system', text: 'AI paused (human active)' }));
                        }

                        if (data.type === 'delete_message') {
                            db.run("DELETE FROM messages WHERE id = ?", [data.msgId], (err) => {
                                if (!err) {
                                    broadcastToAdmins({ type: 'message_deleted', msgId: data.msgId });
                                    sendToUserTabs(data.targetId, { type: 'message_deleted', msgId: data.msgId });
                                }
                            });
                        }

                        if (data.type === 'delete_system_messages') {
                            const targetId = data.targetId;
                            db.run("DELETE FROM messages WHERE session_id = ? AND sender = 'system'", [targetId], function(err) {
                                if (!err) {
                                    broadcastToAdmins({ type: 'system_messages_deleted', targetId: targetId, count: this.changes });
                                    ws.send(JSON.stringify({ type: 'system', text: `Deleted ${this.changes} system messages` }));
                                }
                            });
                        }

                        if (data.type === 'delete_session') {
                            const targetId = data.targetId;
                            db.serialize(() => {
                                db.run("DELETE FROM messages WHERE session_id = ?", [targetId]);
                                db.run("DELETE FROM sessions WHERE session_id = ?", [targetId], (err) => {
                                    if (!err) {
                                        broadcastToAdmins({ type: 'session_deleted', id: targetId });
                                        wss.clients.forEach(client => {
                                            if (client.userId === targetId) {
                                                if (client.readyState === WebSocket.OPEN) client.send(JSON.stringify({ type: 'reset_chat' }));
                                                client.close();
                                            }
                                        });
                                    }
                                });
                            });
                        }

                        if (data.type === 'search_chats') {
                            const query = (data.query || '').trim();
                            if (query.length < 2 || query.length > 100) {
                                ws.send(JSON.stringify({ type: 'search_results', results: [], query: data.query }));
                                return;
                            }
                            const escapedQuery = query.replace(/%/g, '\\%').replace(/_/g, '\\_');
                            const likePattern = '%' + escapedQuery + '%';

                            db.all(
                                `SELECT s.session_id, s.metadata, s.updated_at FROM sessions s
                                 WHERE json_extract(s.metadata, '$.user_name') LIKE ? ESCAPE '\\'
                                    OR json_extract(s.metadata, '$.name') LIKE ? ESCAPE '\\'
                                    OR json_extract(s.metadata, '$.user_email') LIKE ? ESCAPE '\\'
                                 ORDER BY s.updated_at DESC`,
                                [likePattern, likePattern, likePattern],
                                (err, nameRows) => {
                                    if (err) nameRows = [];
                                    db.all(
                                        `SELECT DISTINCT m.session_id, s.metadata, s.updated_at,
                                                m.text as matched_text
                                         FROM messages m
                                         JOIN sessions s ON s.session_id = m.session_id
                                         WHERE m.sender != 'system' AND m.text LIKE ? ESCAPE '\\'
                                         ORDER BY m.timestamp DESC LIMIT 50`,
                                        [likePattern],
                                        (err2, msgRows) => {
                                            if (err2) msgRows = [];
                                            const resultsMap = new Map();
                                            for (const row of nameRows) {
                                                resultsMap.set(row.session_id, {
                                                    id: row.session_id,
                                                    info: JSON.parse(row.metadata || '{}'),
                                                    matchType: 'name',
                                                    matchedText: null
                                                });
                                            }
                                            for (const row of msgRows) {
                                                if (resultsMap.has(row.session_id)) {
                                                    const existing = resultsMap.get(row.session_id);
                                                    if (!existing.matchedText) {
                                                        existing.matchType = 'both';
                                                        existing.matchedText = row.matched_text.substring(0, 150);
                                                    }
                                                } else {
                                                    resultsMap.set(row.session_id, {
                                                        id: row.session_id,
                                                        info: JSON.parse(row.metadata || '{}'),
                                                        matchType: 'message',
                                                        matchedText: row.matched_text.substring(0, 150)
                                                    });
                                                }
                                            }
                                            ws.send(JSON.stringify({
                                                type: 'search_results',
                                                results: Array.from(resultsMap.values()).slice(0, 30),
                                                query: data.query
                                            }));
                                        }
                                    );
                                }
                            );
                        }
                    } catch (e) { console.error(e); }
                });
                ws.on('close', () => { console.log('Admin disconnected'); });
            };

            if (validRenderSession) {
                // Immediate authentication from Render disk storage (zero Turso queries!)
                proceedAdmin(null, validRenderSession);
            } else {
                // Authenticate with password against admins table or environment
                db.get("SELECT * FROM admins ORDER BY id ASC LIMIT 1", [], (err, row) => {
                    const rawEnvPass = process.env.ADMIN_PASSWORD ? process.env.ADMIN_PASSWORD.trim() : '';
                    const cleanEnvPass = rawEnvPass.replace(/^['"]|['"]$/g, '');
                    const cleanAuthPass = (authPass || '').trim().replace(/^['"]|['"]$/g, '');
                    const passwordMatches = (cleanEnvPass && cleanAuthPass === cleanEnvPass) ||
                                            (rawEnvPass && authPass === rawEnvPass) ||
                                            (row && row.password_hash && (bcrypt.compareSync(cleanAuthPass, row.password_hash) || bcrypt.compareSync(authPass, row.password_hash)));
                    if (passwordMatches) {
                        proceedAdmin(row, null);
                    } else {
                        console.warn(`[Security] Failed admin WebSocket password attempt from IP: ${clientIp}`);
                        security.recordSuspiciousActivity(clientIp, 'Failed admin WebSocket password attempt', 2);
                        ws.close(4001, 'Authentication failed');
                    }
                });
            }
            return;
        }

    if (!checkOriginAllowed(origin)) {
        console.log(`Origin blocked: ${origin}`);
        ws.close(4003, 'Origin not allowed');
        return;
    }

    const userId = sessionId || 'anon_' + Math.random().toString(36).substr(2, 5);
    ws.userId = userId;
    const anonymous = isAnonymousOrigin(origin);
    ws.isAnonymous = anonymous;

    // For anonymous users, auto-collect session info (GeoIP + UA)
    // user_name will be set by client_info message from widget (name form)
    if (anonymous) {
        const sessionInfo = getSessionInfo(req);
        // Build clean user_session without IP in parentheses (avoids HTML parse errors in Telegram)
        const geoClean = sessionInfo.geo ? sessionInfo.geo.replace(/\s*\([^)]*\)/, '') : '';
        const sessionParts = [geoClean, sessionInfo.platform, sessionInfo.browser].filter(Boolean);
        const meta = {
            user_session: sessionParts.join(', '),
            user_name: 'anonymous',
            user_id: userId.replace(/_/g, '-'),
            user_email: 'anonymous',
            geo: sessionInfo.geo,
            platform: sessionInfo.platform,
            browser: sessionInfo.browser,
            ip: sessionInfo.ip
        };
        clientInfo.set(userId, meta);
        updateSessionInfo(userId, meta);
        broadcastToAdmins({ type: 'user_info_update', id: userId, info: meta });
    }

    // Check if this is a reconnect after page navigation
    const pendingDisconnect = pendingDisconnects.get(userId);
    if (pendingDisconnect) {
        // Cancel the pending disconnect - user just navigated to another page
        clearTimeout(pendingDisconnect);
        pendingDisconnects.delete(userId);
        // Don't log user_connected since they were never really "disconnected"
        // Just notify admin that user is still online (for UI state)
        broadcastToAdmins({ type: 'user_connected', id: userId });
    } else {
        // This is a fresh connection - save and notify (with deduplication)
        if (!shouldDeduplicateEvent(userId, 'user_connected')) {
            saveSystemEvent(userId, 'user_connected', (msgId, timestamp) => {
                broadcastToAdmins({ type: 'user_connected', id: userId, msgId, timestamp });
            });
        } else {
            // Still notify admin for UI, but don't save to DB
            broadcastToAdmins({ type: 'user_connected', id: userId });
        }
    }

    ws.send(JSON.stringify({
        type: 'config',
        dateFormat: timeConfig.dateFormat,
        timeFormat: timeConfig.timeFormat,
        timezone: timeConfig.timezone,
        messagesLimit: messageLoadConfig.widgetMessagesLimit,
        anonymous: anonymous,
        businessHours: getWidgetBusinessHours()
    }));

    getHistory(userId, (rows) => {
        if (rows.length > 0) {
            const oldestId = rows[0].id;
            // Count older non-system messages
            db.get("SELECT COUNT(*) as count FROM messages WHERE session_id = ? AND id < ? AND sender != 'system'", [userId, oldestId], (err, result) => {
                ws.send(JSON.stringify({
                    type: 'history',
                    messages: rows,
                    hasMore: result ? result.count > 0 : false
                }));
            });
        } else {
            // Send empty history so client knows there's no history
            ws.send(JSON.stringify({
                type: 'history',
                messages: [],
                hasMore: false
            }));
        }
    }, messageLoadConfig.widgetMessagesLimit, null, true);

    let wsMsgCount = 0;
    let wsWindowStart = Date.now();

    ws.on('message', (message) => {
        try {
            const now = Date.now();
            if (now - wsWindowStart > 10000) {
                wsMsgCount = 0;
                wsWindowStart = now;
            }
            wsMsgCount++;
            // Max 35 messages per 10 seconds per connection (prevents flooding)
            if (wsMsgCount > 35) {
                security.recordSuspiciousActivity(clientIp, 'WebSocket message flooding DoS', 1);
                try { ws.send(JSON.stringify({ type: 'error', error: 'rate_limit_exceeded', message: 'Message rate limit exceeded.' })); } catch(e) {}
                return;
            }

            const parsed = JSON.parse(message);

            // Heartbeat ping - just respond with pong to keep connection alive
            if (parsed.type === 'ping') {
                ws.send(JSON.stringify({ type: 'pong' }));
                return;
            }

            // Load older messages for widget (excluding system messages)
            if (parsed.type === 'load_more') {
                const beforeId = parsed.beforeId;
                const limit = messageLoadConfig.widgetMessagesLimit;
                getHistory(userId, (rows) => {
                    const hasMore = rows.length === limit;
                    ws.send(JSON.stringify({
                        type: 'more_history',
                        messages: rows,
                        hasMore: hasMore
                    }));
                }, limit, beforeId, true);
                return;
            }

            if (parsed.type === 'typing_update') {
                if (realtimeTypingEnabled) {
                    broadcastToAdmins({ type: 'client_typing', userId: userId, text: parsed.text });
                }
                return;
            }

            if (parsed.type === 'tab_visibility') {
                // Store tab active state on websocket object
                ws.tabActive = parsed.isActive;

                // Always update UI state immediately
                broadcastToAdmins({ type: 'tab_visibility', userId: userId, isActive: parsed.isActive });

                // Skip logging if this is part of page navigation
                const recentVisit = recentPageVisits.get(userId);
                if (pendingDisconnects.has(userId) || (recentVisit && Date.now() - recentVisit < NAVIGATION_GRACE_PERIOD)) {
                    return;
                }

                // Cancel previous pending tab visibility for this user
                const prevPending = pendingTabVisibility.get(userId);
                if (prevPending) {
                    clearTimeout(prevPending.timeoutId);
                }

                // Delay logging to check if page_visit comes soon (navigation detection)
                const timeoutId = setTimeout(() => {
                    pendingTabVisibility.delete(userId);
                    // Check again if page_visit happened
                    const recentVisitNow = recentPageVisits.get(userId);
                    if (recentVisitNow && Date.now() - recentVisitNow < NAVIGATION_GRACE_PERIOD) {
                        return; // Skip, was navigation
                    }
                    const eventType = parsed.isActive ? 'tab_active' : 'tab_inactive';
                    // Skip if same event was logged recently
                    if (shouldDeduplicateEvent(userId, eventType)) {
                        return;
                    }
                    saveSystemEvent(userId, eventType, (msgId, timestamp) => {
                        broadcastToAdmins({ type: 'system_event', userId: userId, eventType, msgId, timestamp });
                    });
                }, TAB_VISIBILITY_DELAY);

                pendingTabVisibility.set(userId, { timeoutId, isActive: parsed.isActive });
                return;
            }

            if (parsed.type === 'chat_opened' || parsed.type === 'chat_closed') {
                saveSystemEvent(userId, parsed.type, (msgId, timestamp) => {
                    broadcastToAdmins({ type: parsed.type, userId: userId, msgId, timestamp });
                });
                return;
            }

            if (parsed.type === 'page_visit') {
                const url = parsed.url;
                // Cancel any pending tab_visibility log (this was navigation, not real tab switch)
                const pendingTab = pendingTabVisibility.get(userId);
                if (pendingTab) {
                    clearTimeout(pendingTab.timeoutId);
                    pendingTabVisibility.delete(userId);
                }

                // Mark this user as having recent page visit (to suppress tab_visibility logs)
                recentPageVisits.set(userId, Date.now());
                setTimeout(() => {
                    const lastVisit = recentPageVisits.get(userId);
                    if (lastVisit && Date.now() - lastVisit >= NAVIGATION_GRACE_PERIOD) {
                        recentPageVisits.delete(userId);
                    }
                }, NAVIGATION_GRACE_PERIOD + 100);

                // Update current_url in session metadata
                const currentMeta = clientInfo.get(userId) || {};
                currentMeta.current_url = url;
                clientInfo.set(userId, currentMeta);
                updateSessionInfo(userId, currentMeta);

                // Always notify admin about URL change (for sidebar display)
                broadcastToAdmins({ type: 'user_info_update', id: userId, info: { current_url: url } });

                // Save as system event with URL in text (respects systemLogs settings)
                saveSystemEvent(userId, `page_visit:${url}`, (msgId, timestamp) => {
                    broadcastToAdmins({ type: 'page_visit', userId: userId, url: url, msgId, timestamp });
                });
                return;
            }

            if (parsed.type === 'client_info') {
                // Merge with existing metadata (preserves geo/platform/browser for anonymous users)
                const existing = clientInfo.get(userId) || {};
                const merged = { ...existing, ...parsed.metadata };
                if (merged.telegram_bot_id) {
                    const assignedBot = getTelegramBot(merged.telegram_bot_id);
                    if (assignedBot) {
                        merged.telegram_bot_name = assignedBot.name || assignedBot.username || 'Telegram bot';
                    }
                }
                const isNewAnonymous = ws.isAnonymous && existing.user_name === 'anonymous' && parsed.metadata.user_name && parsed.metadata.user_name !== 'anonymous';
                clientInfo.set(userId, merged);
                updateSessionInfo(userId, merged);
                broadcastToAdmins({ type: 'user_info_update', id: userId, info: merged });

                // Send welcome messages for new anonymous users who just submitted their name
                // Only if no messages exist yet (truly new chat, not a reconnect)
                if (isNewAnonymous) {
                    db.get("SELECT COUNT(*) as count FROM messages WHERE session_id = ? AND sender != 'system'", [userId], (err, row) => {
                        if (err || (row && row.count > 0)) return; // Already has messages — not a new chat

                        const clientLang = parsed.metadata.lang || 'ua';
                        const welcomeTexts = { ua: 'Вітаємо', en: 'Hello', ru: 'Здравствуйте' };
                        const welcomeText = `${welcomeTexts[clientLang] || welcomeTexts['ua']}, ${parsed.metadata.user_name}!`;
                        const timestamp = new Date().toISOString();

                        // 1. Welcome message for client (shown as support bubble in widget)
                        saveMessage(userId, 'support', welcomeText, timestamp, (msgId) => {
                            sendToUserTabs(userId, { text: welcomeText, sender: 'support', timestamp, id: msgId });
                        });

                        // 2. "New chat" message for admin (shown as client message + webhook)
                        const adminText = `New chat created: ${parsed.metadata.user_name}`;
                        saveMessage(userId, 'client', adminText, timestamp, (msgId) => {
                            const meta = clientInfo.get(userId);
                            sendWebhook(userId, adminText, meta, timestamp);
                            broadcastToAdmins({ type: 'client_msg', from: userId, text: adminText, info: meta, timestamp, id: msgId });
                            sendTelegramMessage(userId, adminText, meta).catch((error) => {
                                console.error('Telegram send error:', error.message);
                            });
                        });
                    });
                }
            }
            if (parsed.text) {
                // Strip scripts and dangerous active HTML tags to prevent XSS injection
                parsed.text = security.stripScripts(String(parsed.text));
                if (parsed.pageUrl) {
                    const existingMeta = clientInfo.get(userId) || {};
                    const updatedMeta = { ...existingMeta, current_url: String(parsed.pageUrl).slice(0, 2000) };
                    clientInfo.set(userId, updatedMeta);
                    updateSessionInfo(userId, updatedMeta);
                    broadcastToAdmins({ type: 'user_info_update', id: userId, info: { current_url: updatedMeta.current_url } });
                }

                // Validate message
                const validation = validateMessage(parsed.text);
                if (!validation.valid) {
                    ws.send(JSON.stringify({ type: 'error', error: validation.error, maxLength: validation.maxLength }));
                    return;
                }

                // Check rate limit
                if (!checkRateLimit(userId)) {
                    ws.send(JSON.stringify({ type: 'error', error: 'rate_limit_exceeded', maxPerMinute: rateLimitConfig.maxMessagesPerMinute }));
                    return;
                }

                const timestamp = new Date().toISOString();
                saveMessage(userId, 'client', parsed.text, timestamp, (newId) => {
                    const meta = clientInfo.get(userId);
                    sendWebhook(userId, parsed.text, meta, timestamp);
                    handleAIChatPipeline(userId, parsed.text, meta, origin).catch((error) => {
                        console.error('AI Chat Pipeline error:', error.message);
                    });
                    sendTelegramMessage(userId, parsed.text, meta).catch((error) => {
                        console.error('Telegram send error:', error.message);
                    });

                    broadcastToAdmins({ type: 'client_msg', from: userId, text: parsed.text, info: meta, timestamp: timestamp, id: newId });

                    // Send msg_saved back to the sender so widget can set data-id for deletion
                    ws.send(JSON.stringify({ type: 'msg_saved', id: newId }));

                    wss.clients.forEach(client => {
                        if (client.userId === userId && client !== ws && client.readyState === WebSocket.OPEN) {
                            client.send(JSON.stringify({
                                type: 'sync_message',
                                text: parsed.text,
                                sender: 'me',
                                timestamp: timestamp,
                                id: newId
                            }));
                        }
                    });
                });
            }
        } catch (e) { console.error(e); }
    });

    ws.on('close', () => {
        let hasActive = false;
        for (const c of wss.clients) { if (c.userId === userId && c.readyState === WebSocket.OPEN) { hasActive = true; break; } }
        if (!hasActive) {
            // Delay the disconnect to detect page navigation
            const timeoutId = setTimeout(() => {
                pendingDisconnects.delete(userId);
                // Check again if user reconnected
                let stillActive = false;
                for (const c of wss.clients) { if (c.userId === userId && c.readyState === WebSocket.OPEN) { stillActive = true; break; } }
                if (!stillActive) {
                    // Skip if same event was logged recently
                    if (!shouldDeduplicateEvent(userId, 'user_left')) {
                        saveSystemEvent(userId, 'user_left', (msgId, timestamp) => {
                            broadcastToAdmins({ type: 'user_left', id: userId, msgId, timestamp });
                        });
                    }
                }
            }, NAVIGATION_GRACE_PERIOD);
            pendingDisconnects.set(userId, timeoutId);

            // Notify admin immediately about offline status (for UI), but don't save to DB yet
            broadcastToAdmins({ type: 'user_left', id: userId });
        }
    });
});

// SPA Fallback for React Admin Panel routes (e.g. /admin, /dashboard, /sites, /tickets)
app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api/') || req.path === '/widget.js' || req.path === '/favicon.ico' || req.path === '/health') {
        return next();
    }
    const indexPath = path.join(adminBuildPath, 'index.html');
    if (fs.existsSync(indexPath)) {
        res.sendFile(indexPath);
    } else {
        res.sendFile(path.join(__dirname, 'admin.html'));
    }
});

const port = process.env.PORT || 8080;
const host = '0.0.0.0';

server.listen(port, host, () => {
    console.log(`Chat Server running on http://${host}:${port} [Database: ${isTurso ? 'Turso Cloud' : 'Local SQLite'}]`);
});

// Graceful Shutdown for Render container termination (SIGTERM / SIGINT)
let isShuttingDown = false;

function gracefulShutdown(signal) {
    if (isShuttingDown) return;
    isShuttingDown = true;
    console.log(`\n[Server] Received ${signal}. Starting graceful shutdown...`);

    // 1. Stop HTTP & WebSocket listener
    server.close(() => {
        console.log('[Server] HTTP and WebSocket listener stopped.');
    });

    // 2. Safely notify and close connected WebSocket clients
    wss.clients.forEach((client) => {
        if (client.readyState === WebSocket.OPEN) {
            try {
                client.send(JSON.stringify({ type: 'server_shutdown', message: 'Server is restarting' }));
                client.close(1001, 'Server Shutting Down');
            } catch (e) {}
        }
    });

    // 3. Close database connection cleanly
    db.close((err) => {
        if (err) console.error('[Database] Error closing database:', err.message);
        else console.log('[Database] Database connection closed cleanly.');
        process.exit(0);
    });

    // Force exit safeguard after 5 seconds
    setTimeout(() => {
        console.error('[Server] Graceful shutdown timeout (5s). Force exiting.');
        process.exit(0);
    }, 5000);
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

// Process-Level Crash Protection (Prevents Server Down Attacks from unexpected errors)
process.on('uncaughtException', (err) => {
    console.error('[SECURITY PROCESS GUARD] Caught unexpected exception, prevented server crash:', err.stack || err.message || err);
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('[SECURITY PROCESS GUARD] Caught unhandled promise rejection, prevented server crash:', reason);
});

