/**
 * Automated Test Suite for AI Instructions System
 * Tests all core requirements from AI_Instructions_README.md
 */

const { db } = require('./db');
const { initDatabase } = require('./db/schema');
const { AIEngine } = require('./ai-engine');

async function runTests() {
    console.log('====================================================');
    console.log('🚀 Running AI Instructions System Automated Test Suite');
    console.log('====================================================\n');

    await initDatabase(db);

    // Ensure test knowledge base articles and channel modes match test expectations
    await db.runAsync(`INSERT OR REPLACE INTO site_knowledge_base (id, site_id, title, category, content, tags, is_active) VALUES (?, ?, ?, ?, ?, ?, 1)`,
        [101, 1, 'SOCKS5 Setup', 'Setup', 'To configure SOCKS5 on TurboProxy, use port 1080 with your credentials.', 'socks5, port, proxy']);
    await db.runAsync(`INSERT OR REPLACE INTO site_knowledge_base (id, site_id, title, category, content, tags, is_active) VALUES (?, ?, ?, ?, ?, ?, 1)`,
        [102, 2, 'SMS Delivery Times', 'Usage', 'SMS codes arrive in 30-60 seconds. Unreceived codes are auto-refunded.', 'sms, code, otp']);
    await db.runAsync(`UPDATE site_channels SET ai_mode = 'suggest_reply' WHERE site_id = 2 AND channel_type = 'widget'`);

    const engine = new AIEngine(db);
    let passed = 0;
    let failed = 0;

    function assert(condition, testName) {
        if (condition) {
            console.log(`  ✅ PASS: ${testName}`);
            passed++;
        } else {
            console.error(`  ❌ FAIL: ${testName}`);
            failed++;
        }
    }

    // -------------------------------------------------------------
    // Test 1: Dynamic Variables Resolution
    // -------------------------------------------------------------
    console.log('Test 1: Dynamic Variables Resolution');
    const template = 'Hello {{customer_name}}, welcome to {{site_name}}! Your ticket #{{ticket_id}} for order {{order_id}} is received.';
    const resolved = engine.resolveVariables(template, {
        site: { name: 'TurboProxy' },
        customer: { user_name: 'Alice', order_id: 'ORD-1234' },
        ticketId: 'TKT-999'
    });
    assert(resolved.includes('Alice') && resolved.includes('TurboProxy') && resolved.includes('TKT-999') && resolved.includes('ORD-1234'), 'All dynamic variables correctly replaced');

    // -------------------------------------------------------------
    // Test 2: Multi-Site Knowledge Base Isolation
    // -------------------------------------------------------------
    console.log('\nTest 2: Multi-Site Knowledge Base Isolation');
    const turboKB = await engine.retrieveKnowledge(1, 'how do I configure socks5 proxy');
    assert(turboKB.length > 0 && turboKB[0].title.includes('SOCKS5'), 'TurboProxy retrieves its own SOCKS5 article');

    const smsKBforProxy = await engine.retrieveKnowledge(2, 'how do I configure socks5 proxy');
    assert(smsKBforProxy.length === 0, 'SMSOTPs does NOT retrieve TurboProxy SOCKS5 article (strict isolation)');

    const smsKB = await engine.retrieveKnowledge(2, 'when will my sms code arrive');
    assert(smsKB.length > 0 && smsKB[0].title === 'SMS Delivery Times', 'SMSOTPs retrieves its own SMS article');

    // -------------------------------------------------------------
    // Test 3: Normal In-Scope Query Processing (Automatic Mode)
    // -------------------------------------------------------------
    console.log('\nTest 3: Normal In-Scope Query Processing');
    const turboResult = await engine.processIncomingMessage({
        sessionId: 'test_session_1',
        userMessage: 'How do I set up SOCKS5 proxy?',
        metadata: { site_id: 1, user_name: 'Bob' },
        channelType: 'widget'
    });
    assert(turboResult.handled === true, 'Message was handled by AI engine');
    assert(turboResult.site.name === 'TurboProxy', 'Correct site resolved');
    assert(turboResult.shouldEscalate === false, 'Normal proxy query does not trigger escalation');
    assert(turboResult.action === 'reply', 'Action is reply');

    // -------------------------------------------------------------
    // Test 4: Escalation Keyword Trigger & Ticket Generation
    // -------------------------------------------------------------
    console.log('\nTest 4: Escalation & Ticket Generation');
    const escalationResult = await engine.processIncomingMessage({
        sessionId: 'test_session_2',
        userMessage: 'I need to speak to a human agent right now!',
        metadata: { site_id: 1, user_name: 'Charlie' },
        channelType: 'widget'
    });
    assert(escalationResult.shouldEscalate === true, 'Escalation triggered by human request');
    assert(escalationResult.action === 'escalate', 'Action set to escalate');
    assert(escalationResult.ticketId !== null, 'Escalation ticket was created');
    assert(engine.getSessionStatus('test_session_2') === 'escalated', 'Session handoff status set to escalated');

    // Verify ticket in DB
    const ticketRow = await new Promise((res) => {
        db.get('SELECT * FROM tickets WHERE id = ?', [escalationResult.ticketId], (e, r) => res(r));
    });
    assert(ticketRow && ticketRow.site_id === 1 && ticketRow.status === 'open', 'Ticket stored correctly in SQLite');
    const summary = JSON.parse(ticketRow.ai_summary || '{}');
    assert(summary.problem && summary.suggested_next_step, 'Structured AI Ticket Summary generated and stored');

    // -------------------------------------------------------------
    // Test 5: Suggest Reply Mode (SMSOTPs Channel)
    // -------------------------------------------------------------
    console.log('\nTest 5: Suggest Reply Mode');
    const suggestResult = await engine.processIncomingMessage({
        sessionId: 'test_session_3',
        userMessage: 'What is the delivery time for SMS codes?',
        metadata: { site_id: 2, user_name: 'Diana' },
        channelType: 'widget'
    });
    assert(suggestResult.handled === true, 'Message handled');
    assert(suggestResult.aiMode === 'suggest_reply', 'Recognized suggest_reply mode for channel');

    // -------------------------------------------------------------
    // Test 6: Human Handoff (AI_ACTIVE <-> HUMAN_ACTIVE)
    // -------------------------------------------------------------
    console.log('\nTest 6: Human Handoff');
    engine.pauseAI('test_session_4');
    assert(engine.getSessionStatus('test_session_4') === 'human_active', 'Session paused for human active');

    const pausedResult = await engine.processIncomingMessage({
        sessionId: 'test_session_4',
        userMessage: 'Hello is anyone there?',
        metadata: { site_id: 1 },
        channelType: 'widget'
    });
    assert(pausedResult.handled === false && pausedResult.reason === 'human_active', 'AI automatic reply suppressed while human active');

    engine.resumeAI('test_session_4');
    assert(engine.getSessionStatus('test_session_4') === 'active', 'Session resumed to active');

    const resumedResult = await engine.processIncomingMessage({
        sessionId: 'test_session_4',
        userMessage: 'Hello is anyone there?',
        metadata: { site_id: 1 },
        channelType: 'widget'
    });
    assert(resumedResult.handled === true, 'AI resumes replying once unpaused');

    // -------------------------------------------------------------
    // Test 7: AI Audit Logging
    // -------------------------------------------------------------
    console.log('\nTest 7: AI Audit Logging');
    const logs = await new Promise((res) => {
        db.all('SELECT * FROM ai_runs ORDER BY id DESC', (e, r) => res(r));
    });
    assert(logs && logs.length >= 3, `AI runs recorded in audit table (found ${logs.length} runs)`);
    assert(logs[0].site_id !== undefined && logs[0].latency_ms !== undefined, 'Audit log records site_id and latency');

    // -------------------------------------------------------------
    // Summary
    // -------------------------------------------------------------
    console.log('\n====================================================');
    console.log(`📊 Test Results: ${passed} PASSED, ${failed} FAILED`);
    console.log('====================================================\n');

    db.close();
    process.exit(failed > 0 ? 1 : 0);
}

runTests().catch(err => {
    console.error('Fatal test error:', err);
    process.exit(1);
});
