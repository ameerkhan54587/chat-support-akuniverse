/**
 * Automated Test for Turso/libSQL Database Adapter
 */

const { db, isTurso } = require('./db');
const { initDatabase } = require('./db/schema');

async function testDatabaseAdapter() {
    console.log('====================================================');
    console.log(`🧪 Testing Database Adapter [Mode: ${isTurso ? 'Turso Cloud' : 'libSQL Local'}]`);
    console.log('====================================================\n');

    // 1. Initialize schema
    await initDatabase(db);
    console.log('✅ PASS: Schema initialized successfully.');

    // 2. Ping test
    const ping = await db.ping();
    if (!ping.ok) throw new Error('Ping failed');
    console.log(`✅ PASS: Database ping ok (${ping.latencyMs}ms).`);

    // 3. Callback tests: run, get, all
    await new Promise((resolve, reject) => {
        db.run('INSERT INTO sites (domain, name, site_type) VALUES (?, ?, ?)',
            [`test-${Date.now()}.com`, 'Test Site', 'test'],
            function(err) {
                if (err) return reject(err);
                if (!this.lastID) return reject(new Error('lastID not returned in callback'));
                console.log(`✅ PASS: db.run callback returned lastID=${this.lastID}`);

                db.get('SELECT * FROM sites WHERE id = ?', [this.lastID], (err2, row) => {
                    if (err2 || !row) return reject(err2 || new Error('Row not found'));
                    console.log(`✅ PASS: db.get callback returned site: ${row.name}`);

                    db.all('SELECT * FROM sites LIMIT 5', [], (err3, rows) => {
                        if (err3 || !Array.isArray(rows)) return reject(err3 || new Error('Rows not array'));
                        console.log(`✅ PASS: db.all callback returned ${rows.length} sites`);
                        resolve();
                    });
                });
            }
        );
    });

    // 4. Promise tests: runAsync, getAsync, allAsync
    const res = await db.runAsync(
        'INSERT INTO sites (domain, name, site_type) VALUES (?, ?, ?)',
        [`promise-${Date.now()}.com`, 'Promise Site', 'test']
    );
    if (!res.lastID) throw new Error('runAsync did not return lastID');
    console.log(`✅ PASS: db.runAsync returned lastID=${res.lastID}`);

    const fetched = await db.getAsync('SELECT * FROM sites WHERE id = ?', [res.lastID]);
    if (!fetched || fetched.name !== 'Promise Site') throw new Error('getAsync mismatch');
    console.log(`✅ PASS: db.getAsync fetched correct site: ${fetched.name}`);

    const allSites = await db.allAsync('SELECT * FROM sites LIMIT 5');
    if (!Array.isArray(allSites) || allSites.length === 0) throw new Error('allAsync failed');
    console.log(`✅ PASS: db.allAsync returned ${allSites.length} sites`);

    console.log('\n====================================================');
    console.log('🎉 ALL DATABASE ADAPTER TESTS PASSED!');
    console.log('====================================================');
    process.exit(0);
}

testDatabaseAdapter().catch((err) => {
    console.error('❌ Test failed:', err);
    process.exit(1);
});
