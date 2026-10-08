'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const createApi = require('../lib/tcg-api');
const C = require('../lib/tcg-catalog');
function fixture() {
    const settings = new Map(), users = [1, 2, 3].map(id => ({ id, pseudo: 'Player' + id, state: { cards: {} } }));
    for (const u of users) for (const id of new Set(C.starter)) {
        const card = C.byId[id];
        u.state.cards[card.anime + '|' + card.name] = { n: 2 };
    }
    const store = { getSetting: async k => settings.get(k), setSetting: async (k, v) => { await new Promise(r => setTimeout(r, 2)); settings.set(k, v); } };
    const options = { store, data: require('../public/cards.json'), dirty() {}, limited: () => false,
        getUser: async id => users.find(u => u.id === id) };
    const api = createApi(options);
    const call = (path, user = users[0], body = {}) => api[path]({}, user, body);
    return { call, users, settings, options };
}
test('authentication, deck validation and match replacement protection', async () => {
    const { call, users } = fixture();
    assert.equal((await call('GET /api/tcg', null)).status, 401);
    assert.equal((await call('POST /api/tcg/deck', users[0], { deck: [] })).status, 400);
    await call('GET /api/tcg'); assert.deepEqual(users[0].state.tcg.deck, C.starter);
    const { room } = await call('POST /api/tcg/create', users[0], { mode: 'solo' }); assert.equal(room.game.players[1].hand.length, 0);
    assert.equal((await call('POST /api/tcg/create', users[0], { mode: 'multi' })).status, 400);
    const card = room.game.players[0].hand[0].uid;
    const rejected = await call('POST /api/tcg/action', users[0], { code: room.code, action: { type: 'play', card, revision: 0, mana: 99 } });
    assert.equal(rejected.status, 400);
    assert.equal((await call('GET /api/tcg')).room.game.revision, 0);
});
test('two joiners racing for one seat: only one succeeds, private views remain private', async () => {
    const { call, users } = fixture();
    const { room } = await call('POST /api/tcg/create', users[0], { mode: 'multi' }); assert.equal(room.waiting, true);
    const joined = await Promise.all(users.slice(1).map(u => call('POST /api/tcg/join', u, { code: room.code })));
    assert.equal(joined.filter(r => r.room).length, 1); assert.equal(joined.filter(r => r.status === 400).length, 1);
    const host = (await call('GET /api/tcg')).room.game, guest = joined.find(r => r.room).room.game;
    assert.equal(host.side, 0); assert.equal(guest.side, 1); assert.equal(host.players[1].hand.length, 0); assert.equal(guest.players[0].hand.length, 0);
    assert.equal(host.players[0].deck, undefined); assert.equal(host.players[1].deck, undefined);
    assert.equal((await call('POST /api/tcg/action', users[2], { code: room.code, action: { type: 'concede', revision: 0 } })).status, 400);
});
test('duplicate requests, out-of-turn moves, and old-match requests cannot advance game', async () => {
    const { call, users } = fixture();
    const { room } = await call('POST /api/tcg/create', users[0], { mode: 'multi' });
    await call('POST /api/tcg/join', users[1], { code: room.code });
    const b = { code: room.code, action: { type: 'end', revision: 0 } };
    assert.equal((await call('POST /api/tcg/action', users[1], b)).status, 400);
    const responses = await Promise.all([call('POST /api/tcg/action', users[0], b), call('POST /api/tcg/action', users[0], b)]);
    assert.equal(responses.filter(r => r.room).length, 1); assert.equal(responses.filter(r => r.status === 400).length, 1);
    assert.equal((await call('GET /api/tcg')).room.game.revision, 1);
    await call('POST /api/tcg/leave', users[0], { code: room.code });
    assert.equal((await call('GET /api/tcg', users[1])).room.game.winner, 1);
    await call('POST /api/tcg/create', users[0], { mode: 'solo' });
    assert.equal((await call('POST /api/tcg/action', users[0], b)).status, 400);
});
test('room cancellation, expiration, persisted restart and deck snapshot', async () => {
    const { call, users, settings, options } = fixture();
    const { room } = await call('POST /api/tcg/create', users[0], { mode: 'multi' });
    const alternate = C.starter.map(id => id === 'naruto' ? 'gojo' : id);
    users[0].state.cards['jujutsu-kaisen|Satoru Gojo'] = { n: 2 };
    await call('POST /api/tcg/deck', users[0], { deck: alternate });
    assert.deepEqual(settings.get('tcg:' + room.code).deck, C.starter);
    const restarted = createApi(options); assert.equal((await restarted['GET /api/tcg']({}, users[0], {})).room.code, room.code);
    await call('POST /api/tcg/leave', users[0], { code: room.code });
    assert.equal((await call('POST /api/tcg/join', users[1], { code: room.code })).status, 400);
    const next = (await call('POST /api/tcg/create', users[0], { mode: 'multi' })).room;
    settings.get('tcg:' + next.code).expires = Date.now() - 1;
    assert.equal((await call('GET /api/tcg')).room, null);
    assert.equal((await call('POST /api/tcg/join', users[1], { code: next.code })).status, 400);
});
test('server rate limits apply to TCG endpoints', async () => {
    const { options, users } = fixture(), api = createApi({ ...options, limited: () => true });
    assert.equal((await api['POST /api/tcg/create']({}, users[0], { mode: 'solo' })).status, 429);
});
test('catalog pages and related card definitions do not expose opponent hidden cards', async () => {
    const { call, users } = fixture();
    const catalog = await call('GET /api/tcg/catalog');
    assert.equal(catalog.total, 10); assert.equal(catalog.cards.length, 10); assert.ok(catalog.catalogSize > 70000);
    const generated = C.cards.find(c => c.source === 'profile');
    users[1].state.cards[generated.anime + '|' + generated.name] = { n: 2 };
    await call('POST /api/tcg/deck', users[1], { deck: C.starter.map(id => id === 'naruto' ? generated.id : id) });
    const { room } = await call('POST /api/tcg/create', users[0], { mode: 'multi' });
    await call('POST /api/tcg/join', users[1], { code: room.code });
    const host = await call('GET /api/tcg', users[0]);
    assert.equal(host.cards.some(c => c.id === generated.id), false);
    assert.equal((await call('GET /api/tcg', users[1])).cards.some(c => c.id === generated.id), true);
});

test('only booster-owned cards are valid, including the true copy count', async () => {
    const { call, users } = fixture();
    const player = users[0];
    const unowned = C.starter.map(id => id === 'naruto' ? 'gojo' : id);
    assert.match((await call('POST /api/tcg/deck', player, { deck: unowned })).error, /possèdes/);
    player.state.cards['naruto|Naruto Uzumaki'].n = 1;
    assert.equal((await call('POST /api/tcg/create', player, { mode: 'solo' })).status, 400);
    assert.match((await call('POST /api/tcg/deck', player, { deck: C.starter })).error, /exemplaires/);
    player.state.cards['naruto|Naruto Uzumaki'].n = 2;
    assert.equal((await call('POST /api/tcg/deck', player, { deck: C.starter })).deck.length, 20);
    // A rare version of the same character counts as another playable copy.
    delete player.state.cards['naruto|Naruto Uzumaki'];
    player.state.cards['naruto|Naruto Uzumaki|secrete'] = { n: 2 };
    const inventory = C.ownedCounts(player.state);
    assert.equal(inventory.naruto, 2);
    assert.equal((await call('POST /api/tcg/create', player, { mode: 'solo' })).room.mode, 'solo');
});
test('player without packs has no default free deck and no available catalog', async () => {
    const { call, users } = fixture();
    users[2].state.cards = {};
    const empty = await call('GET /api/tcg', users[2]);
    assert.deepEqual(empty.deck, []); assert.deepEqual(empty.suggested, []);
    const catalog = await call('GET /api/tcg/catalog', users[2]);
    assert.equal(catalog.total, 0); assert.deepEqual(catalog.cards, []);
    assert.equal((await call('POST /api/tcg/create', users[2], { mode: 'solo' })).status, 400);
    assert.equal((await call('GET /api/tcg/catalog', null)).status, 401);
});
test('multiplayer rejects host decks whose cards were traded after salon creation', async () => {
    const { call, users } = fixture();
    const { room } = await call('POST /api/tcg/create', users[0], { mode: 'multi' });
    delete users[0].state.cards['naruto|Naruto Uzumaki'];
    assert.match((await call('POST /api/tcg/join', users[1], { code: room.code })).error, /créateur/);
    assert.equal((await call('POST /api/tcg/create', users[0], { mode: 'solo' })).status, 400);
});
