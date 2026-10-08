'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const C = require('../lib/tcg-catalog');
const P = require('../lib/tcg-pocket');
C.initialize(require('../public/cards.json'));

const forms = ['form-goku-ssj', 'form-vegeta-ssj', 'form-naruto-sage', 'form-luffy-gear5', 'form-ichigo-bankai'];
const action = (game, side, act) => P.act(game, side, { ...act, revision: game.revision });

test('only canonical characters have separate, stage-1 transformation definitions', () => {
    assert.deepEqual(C.cards.filter(c => c.kind === 'evolution').map(c => c.id), forms);
    for (const id of forms) {
        const form = C.byId[id], base = C.byId[form.evolvesFrom];
        assert.ok(base && base.kind === 'character');
        assert.equal(form.stage, 1);
        assert.ok(form.name !== base.name);
        assert.ok(form.skill.name !== base.skill.name);
        assert.equal(form.collectorKey, base.anime + '|' + base.name + '|secrete');
        assert.ok(form.image, 'evolution inherits verified character artwork');
    }
    assert.equal(C.cards.some(c => c.kind === 'evolution' && c.evolvesFrom === 'gaara'), false);
});

test('the rare Secrète version unlocks the form, not another duplicate of the base', () => {
    for (const id of forms) {
        const form = C.byId[id], base = C.byId[form.evolvesFrom];
        const state = { cards: {
            [base.anime + '|' + base.name]: { n: 1 },
            [form.collectorKey]: { n: 1 }
        } };
        const owned = C.ownedCounts(state);
        assert.equal(owned[base.id], 1);
        assert.equal(owned[id], 1);
        delete state.cards[base.anime + '|' + base.name];
        assert.equal(C.ownedCounts(state)[base.id], undefined,
            'secret transformation must not also produce an owned base card');
        assert.equal(C.ownedCounts(state)[id], 1);
    }
});

test('deck must contain its matching base and genuinely owned form', () => {
    const deck = [...C.starter.slice(2), 'goku', 'form-goku-ssj'];
    assert.equal(C.validateDeck(deck), null);
    const ownedState = { cards: {} };
    for (const id of new Set(C.starter.slice(2))) {
        const c = C.byId[id];
        ownedState.cards[c.anime + '|' + c.name] = { n: 2 };
    }
    ownedState.cards['dragon-ball|Sangoku'] = { n: 1 };
    let owned = C.ownedCounts(ownedState);
    assert.match(C.validateOwnedDeck(deck, owned), /possèdes/);
    ownedState.cards['dragon-ball|Sangoku|secrete'] = { n: 1 };
    owned = C.ownedCounts(ownedState);
    assert.equal(C.validateOwnedDeck(deck, owned), null);
    assert.match(C.validateDeck([...C.starter.slice(1), 'form-goku-ssj']), /Ajoute/);
});

test('a character duplicate or a mismatched transformation cannot evolve Gaara', () => {
    let s = P.create([C.starter, C.starter], ['A', 'B'], () => 0);
    // Guarantee Gaara is available regardless of shuffle order.
    s.players[0].hand.push({ uid: ++s.seq, card: 'gaara' });
    const gaara = s.players[0].hand.at(-1);
    s = action(s, 0, { type: 'play', card: gaara.uid });
    s = action(s, 0, { type: 'ready' });
    let other = s.players[1].hand.find(h => C.byId[h.card].kind === 'character');
    if (!other) { s.players[1].hand.push({ uid: ++s.seq, card: 'naruto' }); other = s.players[1].hand.at(-1); }
    s = action(s, 1, { type: 'play', card: other.uid });
    s = action(s, 1, { type: 'ready' });
    s = action(s, 0, { type: 'end' });
    s = action(s, 1, { type: 'end' });
    const target = s.players[0].active.uid;
    s.players[0].hand.push({ uid: ++s.seq, card: 'gaara' });
    s.players[0].hand.push({ uid: ++s.seq, card: 'form-goku-ssj' });
    const duplicate = s.players[0].hand.at(-2).uid, form = s.players[0].hand.at(-1).uid;
    assert.throws(() => action(s, 0, { type: 'evolve', card: duplicate, target }), /vraie carte de transformation/);
    assert.throws(() => action(s, 0, { type: 'evolve', card: form, target }), /ne correspond pas/);
    assert.equal(s.players[0].active.card, 'gaara');
});

test('a real evolution can transform the matching benched character only', () => {
    let s = P.create([C.starter, C.starter], ['A', 'B'], () => 0);
    const first = s.players[0].hand.find(h => C.byId[h.card].kind === 'character');
    s = action(s, 0, { type: 'play', card: first.uid });
    s.players[0].hand.push({ uid: ++s.seq, card: 'goku' });
    const goku = s.players[0].hand.at(-1).uid;
    s = action(s, 0, { type: 'play', card: goku });
    s = action(s, 0, { type: 'ready' });
    const second = s.players[1].hand.find(h => C.byId[h.card].kind === 'character');
    s = action(s, 1, { type: 'play', card: second.uid });
    s = action(s, 1, { type: 'ready' });
    s = action(s, 0, { type: 'end' });
    s = action(s, 1, { type: 'end' });
    const active = s.players[0].active.card, target = s.players[0].bench[0].uid;
    s.players[0].hand.push({ uid: ++s.seq, card: 'form-goku-ssj' });
    const uid = s.players[0].hand.at(-1).uid;
    s = action(s, 0, { type: 'evolve', card: uid, target });
    assert.equal(s.players[0].active.card, active);
    assert.equal(s.players[0].bench[0].card, 'form-goku-ssj');
    assert.equal(s.players[0].bench[0].energy, 0);
});
