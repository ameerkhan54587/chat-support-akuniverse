import test from 'node:test';
import assert from 'node:assert/strict';
import { optimisticMessageReducer } from './optimisticMessages.js';

const base = { activeUserId: 'a', users: ['b', 'a'], usersInfo: { a: { lastMessage: { text: 'old', timestamp: '2026-10-10T15:00:00Z', sender: 'client' } } }, messages: [] };
const pending = { id: 'pending:req1', clientMessageId: 'req1', userId: 'a', sender: 'internal_team', text: 'hello', timestamp: '2026-10-10T15:01:00Z', status: 'pending' };

test('optimistic update adds pending bubble and moves list preview', () => {
 const s = optimisticMessageReducer(base, { type: 'ADD_OPTIMISTIC_MESSAGE', payload: pending });
 assert.equal(s.messages[0].status, 'pending'); assert.equal(s.users[0], 'a'); assert.equal(s.usersInfo.a.lastMessage.text, 'hello');
});
test('ack reconciles instead of duplicating optimistic bubble', () => {
 const a = optimisticMessageReducer(base, { type: 'ADD_OPTIMISTIC_MESSAGE', payload: pending });
 const b = optimisticMessageReducer(a, { type: 'CONFIRM_OPTIMISTIC_MESSAGE', payload: { ...pending, id: 23, status: 'sent' } });
 assert.equal(b.messages.length, 1); assert.equal(b.messages[0].id, 23); assert.equal(b.messages[0].status, 'sent');
});
test('failure keeps a visible unconfirmed message and preview', () => {
 const a = optimisticMessageReducer(base, { type: 'ADD_OPTIMISTIC_MESSAGE', payload: pending });
 const b = optimisticMessageReducer(a, { type: 'FAIL_OPTIMISTIC_MESSAGE', payload: { userId: 'a', clientMessageId: 'req1' } });
 assert.equal(b.messages.length, 1); assert.equal(b.messages[0].status, 'unconfirmed'); assert.equal(b.usersInfo.a.lastMessage.status, 'unconfirmed');
});
