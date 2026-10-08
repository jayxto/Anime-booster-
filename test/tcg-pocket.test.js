'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const P = require('../lib/tcg-pocket');
const C = require('../lib/tcg-catalog');
const fresh = () => P.create([C.starter, C.starter], ['Alice', 'Bob'], () => 0);
const act = (state, side, action) => P.act(state, side, { ...action, revision: state.revision });
function choose(s, side, bench = true) {
    let h = s.players[side].hand.find(h => C.byId[h.card].kind === 'character');
    assert.ok(h);
    s = act(s, side, { type: 'play', card: h.uid });
    if (bench) {
        h = s.players[side].hand.find(h => C.byId[h.card].kind === 'character');
        if (h) s = act(s, side, { type: 'play', card: h.uid });
    }
    return act(s, side, { type: 'ready' });
}
function prepared() {
    let s = fresh();
    s = choose(s, 0);
    s = choose(s, 1);
    assert.equal(s.phase, 'main');
    return s;
}
test('initial placement uses active + 3-slot bench and protects private hand', () => {
    let s = fresh();
    assert.equal(s.phase, 'setup');
    assert.equal(s.players[0].hand.length, 5);
    assert.throws(() => act(s, 0, { type: 'ready' }), /combattant/);
    assert.throws(() => act(s, 0, { type: 'attack', mode: 'basic' }), /Place/);
    s = choose(s, 0);
    assert.equal(s.players[0].ready, true);
    assert.equal(s.phase, 'setup');
    assert.throws(() => act(s, 0, { type: 'ready' }), /déjà validé/);
    s = choose(s, 1);
    assert.equal(s.turn, 1);
    const view = P.view(s, 0);
    assert.equal(view.players[1].hand.length, 0);
    assert.equal(view.players[1].handCount, s.players[1].hand.length);
    assert.equal(view.players[0].deck, undefined);
    assert.equal(view.players[1].deck, undefined);
    assert.equal(view.players[0].bench.length, 1);
});
test('attach one energy each turn, select attack, deal real card HP and end turn', () => {
    let s = prepared();
    const id = s.players[0].active.uid;
    assert.throws(() => act(s, 1, { type: 'end' }), /tour/);
    assert.throws(() => act(s, 0, { type: 'attack', mode: 'basic' }), /énergie/);
    s = act(s, 0, { type: 'energy', target: id });
    assert.equal(s.players[0].active.energy, 1);
    assert.throws(() => act(s, 0, { type: 'energy', target: id }), /déjà placé/);
    const e = s.players[1].active;
    const own = C.byId[s.players[0].active.card];
    const required = P.attacks(own).basic.cost;
    s.players[0].active.energy = required;
    const hp = e.hp;
    s = act(s, 0, { type: 'attack', mode: 'basic' });
    assert.equal(s.players[1].active.hp, hp - own.attack * 10);
    assert.equal(s.active, 1);
    assert.equal(s.turn, 2);
});
test('KO awards points and requires a bench replacement', () => {
    let s = prepared();
    s.players[1].active.hp = 1;
    s.players[0].active.energy = 8;
    s = act(s, 0, { type: 'attack', mode: 'basic' });
    assert.equal(s.players[0].points, 1);
    assert.equal(s.players[1].active, null);
    assert.equal(s.players[1].bench.length, 1);
    assert.throws(() => act(s, 1, { type: 'end' }), /remplaçant/);
    s = act(s, 1, { type: 'promote', index: 0 });
    assert.ok(s.players[1].active);
    assert.equal(s.players[1].bench.length, 0);
});
test('three knockout points finish the match and no actions can follow', () => {
    let s = prepared();
    s.players[0].points = 2;
    s.players[1].active.hp = 1;
    s.players[0].active.energy = 8;
    s = act(s, 0, { type: 'attack', mode: 'basic' });
    assert.equal(s.players[0].points, 3);
    assert.equal(s.winner, 0);
    assert.equal(s.phase, 'finished');
    assert.throws(() => act(s, 0, { type: 'end' }), /terminée/);
});
test('evolving uses a real copy in hand and grants two points when defeated', () => {
    let s = prepared();
    const chosen = s.players[0].active.card;
    s.turn = 3;
    s.players[0].hand.push({ uid: ++s.seq, card: chosen });
    const uid = s.players[0].hand.at(-1).uid;
    const before = s.players[0].active.hp;
    s = act(s, 0, { type: 'evolve', card: uid });
    assert.equal(s.players[0].active.hp, before + 20);
    assert.equal(s.players[0].active.evolved, true);
    assert.throws(() => act(s, 0, { type: 'evolve', card: uid }), /introuvable/);
    s.players[0].active.hp = 1;
    s.players[1].active.energy = 8;
    s = act(s, 0, { type: 'end' });
    s = act(s, 1, { type: 'attack', mode: 'basic' });
    assert.equal(s.players[1].points, 2);
});
test('AI always uses legal game actions and waits for the human to finish setup', () => {
    let s = fresh();
    s = P.aiTurn(s);
    assert.equal(s.phase, 'setup');
    assert.equal(s.players[1].ready, true);
    s = choose(s, 0);
    assert.equal(s.active, 0);
    s = act(s, 0, { type: 'end' });
    s = P.aiTurn(s);
    assert.equal(s.active, 0);
    assert.equal(s.winner, null);
    assert.ok(s.revision >= 5);
});
