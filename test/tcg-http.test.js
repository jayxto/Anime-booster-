'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { mkdtemp, rm } = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { once } = require('node:events');
const C = require('../lib/tcg-catalog');
test('real HTTP: accounts, solo, multi, CSRF, privacy, collection isolation and disk reload', { timeout: 25000 }, async t => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'anime-tcg-test-'));
    let child, base;
    async function start() {
        child = spawn(process.execPath, ['server.js'], { cwd: path.join(__dirname, '..'), env: { ...process.env, PORT: '0', DATABASE_URL: '', DATA_FILE: path.join(dir, 'db.json'), ADMIN_EMAILS: 'nobody@example.test' }, stdio: ['ignore', 'pipe', 'pipe'] });
        base = await new Promise((resolve, reject) => {
            let output = ''; const timeout = setTimeout(() => reject(new Error('Server startup timed out: ' + output)), 8000);
            child.once('error', e => { clearTimeout(timeout); reject(e); });
            child.stdout.on('data', b => { output += b; const match = output.match(/sur le port (\d+)/); if (match) { clearTimeout(timeout); resolve('http://127.0.0.1:' + match[1]); } });
            child.stderr.on('data', b => { output += b; });
        });
    }
    async function stop() { if (child && child.exitCode === null) { const exited = once(child, 'exit'); child.kill(); await exited; } }
    t.after(async () => { await stop(); await rm(dir, { recursive: true, force: true }); });
    await start();
    async function req(route, body, cookie, origin) {
        const res = await fetch(base + route, { method: body === undefined ? 'GET' : 'POST', headers: { ...(cookie ? { cookie } : {}), ...(origin ? { origin } : {}), 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
        return { status: res.status, cookie: res.headers.get('set-cookie')?.split(';')[0], value: await res.json() };
    }
    assert.equal((await fetch(base + '/tcg.html')).status, 200);
    assert.equal((await fetch(base + '/tcg.js')).status, 200);
    assert.equal((await req('/api/tcg')).status, 401);
    const empty = await req('/api/register', { email: 'empty@example.test', pseudo: 'Empty', password: 'test-password' });
    assert.deepEqual((await req('/api/tcg', undefined, empty.cookie)).value.deck, []);
    assert.equal((await req('/api/tcg/catalog', undefined, empty.cookie)).value.total, 0);
    assert.equal((await req('/api/tcg/deck', { deck: C.starter, owned: 999 }, empty.cookie)).status, 400);
    assert.equal((await req('/api/open', { id: 'infinite' }, empty.cookie)).status, 200);
    const pulled = (await req('/api/tcg/catalog', undefined, empty.cookie)).value;
    assert.ok(pulled.total > 0); assert.ok(pulled.cards.every(c => c.owned > 0));
    // Existing guest import provides the deterministic collection fixture; no production test hooks.
    const guest = { cards: Object.fromEntries([...C.starter, 'sasuke'].map(id => { const c = C.byId[id]; return [c.anime + '|' + c.name, { n: 2 }]; })) };
    const a = await req('/api/register', { email: 'alice@example.test', pseudo: 'Alice', password: 'test-password', importGuest: true, guest });
    const b = await req('/api/register', { email: 'bob@example.test', pseudo: 'Bob', password: 'test-password', importGuest: true, guest });
    assert.equal(a.status, 200); assert.equal(b.status, 200);
    for (const account of [a, b]) assert.equal((await req('/api/tcg/deck', { deck: C.starter }, account.cookie)).status, 200);
    const baseline = (await req('/api/me', undefined, a.cookie)).value.state;
    assert.equal((await req('/api/tcg/create', { mode: 'solo' }, a.cookie, 'https://evil.example')).status, 403);
    const solo = (await req('/api/tcg/create', { mode: 'solo' }, a.cookie)).value.room;
    const next = await req('/api/tcg/action', { code: solo.code, action: { type: 'end', revision: 0 } }, a.cookie);
    assert.equal(next.status, 200); assert.equal(next.value.room.game.active, 0); assert.ok(next.value.room.game.revision > 1);
    await req('/api/tcg/leave', { code: solo.code }, a.cookie);
    const multi = (await req('/api/tcg/create', { mode: 'multi' }, a.cookie)).value.room;
    assert.equal((await req('/api/tcg/join', { code: multi.code }, b.cookie)).status, 200);
    const g = (await req('/api/tcg', undefined, a.cookie)).value.room.game;
    assert.equal(g.players[1].hand.length, 0); assert.equal(g.players[0].deck, undefined);
    const results = await Promise.all([1, 2].map(() => req('/api/tcg/action', { code: multi.code, action: { type: 'end', revision: 0 } }, a.cookie)));
    assert.deepEqual(results.map(r => r.status).sort(), [200, 400]);
    assert.deepEqual((await req('/api/me', undefined, a.cookie)).value.state, baseline);
    assert.equal((await req('/api/me', undefined, a.cookie)).value.state.tcg, undefined);
    const alternate = C.starter.map(id => id === 'naruto' ? 'sasuke' : id);
    await req('/api/tcg/deck', { deck: alternate }, a.cookie);
    // Existing file store batches writes; wait beyond both the state flush and disk debounce.
    await new Promise(r => setTimeout(r, 3000)); await stop(); await start();
    const resumed = await req('/api/tcg', undefined, a.cookie);
    assert.equal(resumed.status, 200); assert.deepEqual(resumed.value.deck, alternate);
    assert.equal(resumed.value.room.code, multi.code); assert.equal(resumed.value.room.game.revision, 1);
    await req('/api/tcg/leave', { code: multi.code }, b.cookie);
    assert.equal((await req('/api/tcg', undefined, a.cookie)).value.room.game.winner, 0);
});
