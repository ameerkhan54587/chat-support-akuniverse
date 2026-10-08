import test from 'node:test';
import assert from 'node:assert/strict';
import { brandTabForConversation, chatIdForTicket, conversationsForBrand, conversationsForChannel, getConversationBrand, getConversationChannel, groupConversationsByBrand, TELEGRAM_BRAND_TABS, ticketsForChat } from './ticketChat.js';

const linked = { id: 7, session_id: 'web-session-7' };
const unrelated = { id: 8, session_id: 'web-session-8' };

test('shows only tickets linked to the selected chat or its known session ID', () => {
  assert.deepEqual(ticketsForChat([linked, unrelated], 'chat-7', { user_session: 'web-session-7' }), [linked]);
});

test('does not show unlinked software tickets in an unrelated customer chat', () => {
  assert.deepEqual(ticketsForChat([{ id: 9, session_id: 'software_customer-9' }], 'chat-7', {}), []);
});

test('opens the matching chat for either chat ID or known user session', () => {
  const users = ['chat-7', 'chat-8'];
  const info = { 'chat-7': { user_session: 'web-session-7' }, 'chat-8': { user_session: 'web-session-8' } };
  assert.equal(chatIdForTicket(linked, users, info), 'chat-7');
  assert.equal(chatIdForTicket({ id: 10, session_id: 'chat-8' }, users, info), 'chat-8');
  assert.equal(chatIdForTicket({ id: 11, session_id: 'unknown' }, users, info), null);
});


test('classifies Telegram by trusted metadata, source, and its actual session ID form', () => {
  assert.equal(getConversationChannel('telegram:bot-1:chat-1', {}), 'telegram');
  assert.equal(getConversationChannel('web-1', { source: 'telegram' }), 'telegram');
  assert.equal(getConversationChannel('web-2', { telegram_bot_name: 'Support Bot' }), 'telegram');
  assert.deepEqual(conversationsForChannel(['telegram:bot-1:chat-1', 'web-3'], { 'web-3': { channel: 'widget' } }, 'telegram'), ['telegram:bot-1:chat-1']);
});

test('keeps email conversations out of both current views', () => {
  assert.deepEqual(conversationsForChannel(['email_a', 'tg_1', 'web_2'], {}, 'telegram'), ['tg_1']);
  assert.deepEqual(conversationsForChannel(['email_a', 'tg_1', 'web_2'], {}, 'widget'), ['web_2']);
});


test('resolves Telegram brand from explicit site IDs and configured bot names', () => {
  assert.equal(getConversationBrand('telegram:site_smsactivate:1', { site_id: 'smsactivate' }), 'SMS Activate');
  assert.equal(getConversationBrand('telegram:site_smsotps:2', { telegram_bot_name: 'SMSOTPs' }), 'SMS OTPs');
  assert.equal(getConversationBrand('telegram:site_fbverse_bot:3', { telegram_bot_name: 'FBVerse Bot' }), 'FBVerse Bot');
});

test('groups conversations by site label without losing records', () => {
  const users = ['telegram:bot-a:1', 'telegram:bot-b:2', 'telegram:bot-c:3'];
  const info = {
    [users[0]]: { telegram_bot_name: 'SMSActivate' },
    [users[1]]: { telegram_bot_name: 'SMS OTPs' },
    [users[2]]: { telegram_bot_name: 'FBVerse Bot' },
  };
  const groups = groupConversationsByBrand(users, info);
  assert.deepEqual(groups.map(group => group.label), ['FBVerse Bot', 'SMS Activate', 'SMS OTPs']);
  assert.equal(groups.reduce((count, group) => count + group.conversations.length, 0), users.length);
});

test('site grouping uses explicit site identifier even when Telegram display names are generic', () => {
  const groups = groupConversationsByBrand(
    ['telegram:site_smsactivate:100', 'telegram:site_smsotps:200', 'telegram:site_fbverse_bot:300'],
    {
      'telegram:site_smsactivate:100': { site_id: 'smsactivate', telegram_bot_name: 'Support' },
      'telegram:site_smsotps:200': { site_id: 'smsotps', telegram_bot_name: 'Support' },
      'telegram:site_fbverse_bot:300': { site_id: 'fbverse_bot', telegram_bot_name: 'Support' },
    }
  );
  assert.deepEqual(groups.map(group => group.label), ['FBVerse Bot', 'SMS Activate', 'SMS OTPs']);
});


test('exposes separate top-level brand tabs and filters each tab to its own chats', () => {
  assert.deepEqual(TELEGRAM_BRAND_TABS.map(tab => tab.label), ['FBVerse Bot', 'SMS Activate', 'SMS OTPs']);
  const users = ['telegram:fb:1', 'telegram:activate:2', 'telegram:otps:3', 'telegram:other:4', 'widget:5'];
  const info = {
    [users[0]]: { site_id: 'fbverse_bot' },
    [users[1]]: { site_id: 'smsactivate' },
    [users[2]]: { site_id: 'smsotps' },
    [users[3]]: { telegram_bot_name: 'Other Bot' },
  };
  assert.deepEqual(conversationsForBrand(users, info, 'brand:fbverse_bot'), [users[0]]);
  assert.deepEqual(conversationsForBrand(users, info, 'brand:smsactivate'), [users[1]]);
  assert.deepEqual(conversationsForBrand(users, info, 'brand:smsotps'), [users[2]]);
  assert.equal(brandTabForConversation(users[1], info[users[1]]), 'brand:smsactivate');
});
