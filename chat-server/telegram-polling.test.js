'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { pollTelegramBots } = require('./telegram-polling');

test('a polling error for one bot does not stop later bots', async () => {
    const bots = [
        { id: 'site_smsactivate', enabled: true, botToken: 'secret-a' },
        { id: 'site_smsotps', enabled: true, botToken: 'secret-b', lastUpdateId: 4 },
    ];
    const processed = [];
    const errors = [];
    let saved = 0;
    const result = await pollTelegramBots({
        bots,
        callApi: async (_method, _payload, bot) => {
            if (bot.id === 'site_smsactivate') throw new Error('Conflict while token=secret-a');
            return [{ update_id: 5, message: { text: 'hello' } }];
        },
        processUpdate: async (update, bot) => processed.push([update.update_id, bot.id]),
        saveConfig: async () => { saved += 1; },
        logError: (message) => errors.push(message),
    });

    assert.deepEqual(processed, [[5, 'site_smsotps']]);
    assert.equal(bots[1].lastUpdateId, 5);
    assert.equal(saved, 1);
    assert.deepEqual(result, { hadErrors: true });
    assert.equal(errors.length, 1);
    assert.match(errors[0], /site_smsactivate/);
    assert.match(errors[0], /Conflict/);
    assert.equal(errors[0].includes('secret-a'), false);
});

test('polls enabled bots only and reports a clean cycle', async () => {
    const bots = [
        { id: 'site_smsotps', enabled: true, botToken: 'secret' },
        { id: 'disabled', enabled: false, botToken: 'secret2' },
    ];
    const polled = [];
    const result = await pollTelegramBots({
        bots,
        callApi: async (_method, _payload, bot) => { polled.push(bot.id); return []; },
        processUpdate: async () => {},
        saveConfig: async () => {},
        logError: () => assert.fail('should not log an error'),
    });

    assert.deepEqual(polled, ['site_smsotps']);
    assert.deepEqual(result, { hadErrors: false });
});
