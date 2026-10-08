'use strict';

async function pollTelegramBots({ bots, callApi, processUpdate, saveConfig, logError }) {
    let hadErrors = false;

    for (const bot of bots.filter((item) => item.enabled && item.botToken)) {
        try {
            const updates = await callApi('getUpdates', {
                offset: (bot.lastUpdateId || 0) + 1,
                timeout: 0,
                allowed_updates: ['message'],
            }, bot);

            if (Array.isArray(updates)) {
                for (const update of updates) {
                    bot.lastUpdateId = update.update_id;
                    await processUpdate(update, bot);
                }
            }
        } catch (error) {
            hadErrors = true;
            const botId = String(bot.id || bot.siteId || 'unknown');
            const message = String(error?.message || 'unknown error');
            const safeMessage = bot.botToken ? message.split(bot.botToken).join('[redacted]') : message;
            logError(`[Telegram bot ${botId}] poll error: ${safeMessage}`);
        }
    }

    await saveConfig();
    return { hadErrors };
}

module.exports = { pollTelegramBots };
