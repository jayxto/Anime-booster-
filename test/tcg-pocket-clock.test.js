'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const C = require('../lib/tcg-catalog');
const P = require('../lib/tcg-pocket');
const action = (s, side, a) => P.act(s, side, { ...a, revision: s.revision });
function start(maxTurns = 30) {
    let s = P.create([C.starter, C.starter], ['Alice', 'Bob'], () => 0, maxTurns);
    for (let side = 0; side < 2; side++) {
        const card = s.players[side].hand.find(h => C.byId[h.card].kind === 'character');
        s = action(s, side, { type: 'play', card: card.uid });
        s = action(s, side, { type: 'ready' });
    }
    return s;
}
test('PvP exposes per-player 20m clocks and a server-enforced 90s turn', () => {
    const s = start();
    assert.equal(s.timed, true);
    assert.equal(s.players[0].timeRemainingMs, 1_200_000);
    assert.ok(P.view(s, 0).turnRemainingMs <= 90_000);
    assert.equal(P.view(s, 0).players[1].timeRemainingMs, 1_200_000);
});
test('a full timed-out turn automatically advances on the next server poll', () => {
    const s = start();
    const before = s.revision;
    const now = s.turnStartedAt + 90_100;
    const changed = P.advance(s, now);
    assert.notEqual(changed, s);
    assert.equal(changed.active, 1);
    assert.equal(changed.turn, 2);
    assert.equal(changed.revision, before + 1);
    assert.equal(changed.players[0].timeRemainingMs, 1_110_000);
    assert.equal(s.turn, 1, 'the original game state must remain unmodified');
});
test('a player loses when their 20 minute game clock expires first', () => {
    let s = start();
    s.players[0].timeRemainingMs = 5_000;
    const next = P.advance(s, s.players[0].chargedAt + 5_000);
    assert.equal(next.winner, 1);
    assert.equal(next.phase, 'finished');
    assert.equal(next.players[0].timeRemainingMs, 0);
    assert.throws(() => action(next, 0, { type: 'end' }), /terminée/);
});
test('the engine catches up on multiple elapsed 90-second turns after disconnection', () => {
    const s = start();
    const next = P.advance(s, s.turnStartedAt + 190_000);
    assert.equal(next.turn, 3);
    assert.equal(next.active, 0);
    assert.equal(next.players[0].timeRemainingMs, 1_110_000);
    assert.equal(next.players[1].timeRemainingMs, 1_110_000);
});
test('solo stays untimed and preserves its 50 turn limit', () => {
    const s = start(50);
    assert.equal(s.maxTurns, 50);
    assert.equal(s.timed, false);
    assert.equal(P.advance(s, Date.now() + 600_000), s);
    assert.equal(P.view(s, 0).turnRemainingMs, null);
});
test('game clock does not start before both players confirm the initial setup', () => {
    let s = P.create([C.starter, C.starter], ['Alice', 'Bob'], () => 0);
    const c = s.players[0].hand.find(h => C.byId[h.card].kind === 'character');
    s = action(s, 0, { type: 'play', card: c.uid });
    s = action(s, 0, { type: 'ready' });
    assert.equal(s.phase, 'setup');
    assert.equal(P.advance(s, Date.now() + 600_000), s);
});
