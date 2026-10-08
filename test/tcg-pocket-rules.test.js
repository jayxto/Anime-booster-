'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const C = require('../lib/tcg-catalog');
const P = require('../lib/tcg-pocket');
const move = (s, side, action) => P.act(s, side, { ...action, revision: s.revision });
function ready(s, side) {
    const card = s.players[side].hand.find(h => C.byId[h.card].kind === 'character');
    assert.ok(card);
    s = move(s, side, { type: 'play', card: card.uid });
    const bench = s.players[side].hand.find(h => C.byId[h.card].kind === 'character');
    if (bench) s = move(s, side, { type: 'play', card: bench.uid });
    return move(s, side, { type: 'ready' });
}
function game(first = 0, maxTurns = 30) {
    let s = P.create([C.starter, C.starter], ['Player 0', 'Player 1'],
        n => n === 2 && first === 1 ? 1 : 0, maxTurns);
    s = ready(s, 0);
    s = ready(s, 1);
    return s;
}
test('server coin toss can pick the second player and opening energy is denied', () => {
    let s = game(1);
    assert.equal(s.firstPlayer, 1);
    assert.equal(s.active, 1);
    assert.equal(s.turn, 1);
    assert.equal(s.players[1].energyUsed, true);
    assert.throws(() => move(s, 1, { type: 'energy', target: s.players[1].active.uid }), /déjà placé/);
    s = move(s, 1, { type: 'end' });
    assert.equal(s.turn, 2);
    assert.equal(s.active, 0);
    assert.equal(s.players[0].energyUsed, false);
    s = move(s, 0, { type: 'energy', target: s.players[0].active.uid });
    assert.equal(s.players[0].active.energy, 1);
});
test('the hand is capped at ten cards and excess draws enter the discard', () => {
    let s = game();
    s.players[0].active.card = 'kakashi';
    const p = s.players[0];
    while (p.hand.length < 10) p.hand.push({ uid: ++s.seq, card: 'gaara' });
    assert.ok(p.deck.length > 0);
    const deckBefore = p.deck.length, discardBefore = p.discard.length;
    s = move(s, 0, { type: 'ability', target: p.active.uid });
    assert.equal(s.players[0].hand.length, 10);
    assert.equal(s.players[0].deck.length, deckBefore - 1);
    assert.equal(s.players[0].discard.length, discardBefore + 1);
});
test('several Objects can be played but only one Supporter per turn', () => {
    let s = game();
    const p = s.players[0];
    const add = card => { const uid = ++s.seq; p.hand.push({ uid, card }); return uid; };
    const item1 = add('chopper'), item2 = add('orihime');
    const supporter1 = add('sakura'), supporter2 = add('nami');
    s = move(s, 0, { type: 'play', card: item1 });
    assert.equal(s.players[0].supportUsed, false);
    s = move(s, 0, { type: 'play', card: item2 });
    assert.equal(s.players[0].supportUsed, false);
    s = move(s, 0, { type: 'play', card: supporter1 });
    assert.equal(s.players[0].supportUsed, true);
    assert.throws(() => move(s, 0, { type: 'play', card: supporter2 }), /seul Supporter/);
});
test('retreat costs energy and is limited to once per turn', () => {
    let s = game();
    assert.ok(s.players[0].bench.length);
    s.players[0].active.energy = 2;
    s = move(s, 0, { type: 'retreat', index: 0 });
    assert.equal(s.players[0].retreatUsed, true);
    s.players[0].active.energy = 2;
    assert.throws(() => move(s, 0, { type: 'retreat', index: 0 }), /seule retraite/);
});
test('a talent can be used from the bench once per turn without ending the turn', () => {
    let s = game();
    assert.ok(s.players[0].bench.length);
    s.players[0].bench[0].card = 'gaara';
    const uid = s.players[0].bench[0].uid;
    s = move(s, 0, { type: 'ability', target: uid });
    assert.equal(s.players[0].active.shield, 10);
    assert.equal(s.active, 0);
    assert.throws(() => move(s, 0, { type: 'ability', target: uid }), /déjà été utilisé/);
    s = move(s, 0, { type: 'end' });
    s = move(s, 1, { type: 'end' });
    s = move(s, 0, { type: 'ability', target: uid });
    assert.equal(s.players[0].active.shield, 20);
});
test('matches end in a draw at the turn limit (30 PvP and 50 solo)', () => {
    let s = game();
    s.turn = 30;
    s = move(s, 0, { type: 'end' });
    assert.equal(s.winner, 'draw');
    assert.equal(s.phase, 'finished');
    assert.throws(() => move(s, 1, { type: 'end' }), /terminée/);
    const solo = game(0, 50);
    assert.equal(solo.maxTurns, 50);
});
test('opponent starting fighter stays secret until both players confirm', () => {
    let s = P.create([C.starter, C.starter], ['A', 'B'], () => 0);
    s = ready(s, 0);
    assert.ok(s.players[0].active);
    assert.equal(P.view(s, 1).players[0].active, null);
    assert.deepEqual(P.view(s, 1).players[0].bench, []);
    s = ready(s, 1);
    assert.ok(P.view(s, 1).players[0].active);
});
