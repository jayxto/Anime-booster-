'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const C = require('../lib/tcg-catalog');
const O = require('../lib/tcg-collection');
const data = require('../public/cards.json');
const G = require('../public/engine').create(data); C.initialize(data);
test('base, special, seasonal copies aggregate without double counting shiny or finish', () => {
    const seasonal = Object.keys(data.seasons).flatMap(id => G.seasonChars(id).map(([anime, name]) => 'saison:' + id + '|' + anime + '|' + name))[0];
    const seasonalCard = G.cardOfKey(seasonal), seasonalKey = seasonalCard.u + '|' + seasonalCard.name;
    const state = { cards: {
        'naruto|Naruto Uzumaki': { n: 1, shiny: 1, fin: 'gold' },
        'naruto|Naruto Uzumaki|ombre': { n: 2 },
        'naruto|Naruto Uzumaki|fake': { n: 100 },
        ['duo|' + data.duos[0].name]: { n: 99 },
        'one-piece|Monkey D. Luffy': { n: -2 },
        'naruto|Gaara': { n: '99' },
        'naruto|Kakashi Hatake': { n: 1.5 }
    } };
    const owned = O.inventory(state, G);
    assert.equal(owned['naruto|Naruto Uzumaki'], 3);
    assert.equal(O.inventory({ cards: { [seasonal]: { n: 1 }, [seasonalKey]: { n: 2 } } }, G)[seasonalKey], 3);
    assert.equal(owned['one-piece|Monkey D. Luffy'], undefined); assert.equal(owned['naruto|Gaara'], undefined);
    assert.equal(Object.keys(owned).length, 1);
});
test('character and assist variants consume the same physical copies', () => {
    const sakuraCharacter = C.cards.find(c => c.kind === 'character' && c.anime === 'naruto' && c.name === 'Sakura Haruno');
    const deck = C.starter.map(id => id === 'naruto' ? sakuraCharacter.id : id);
    const owned = Object.fromEntries(deck.map(id => [O.keyOf(C.byId[id]), 2]));
    assert.match(O.validate(deck, owned), /Sakura/);
    owned['naruto|Sakura Haruno'] = 4; assert.equal(O.validate(deck, owned), null);
});
test('automatic decks never grant cards or spend the same copy twice', () => {
    assert.deepEqual(O.suggestion({}), []);
    const owned = Object.fromEntries(C.starter.map(id => [O.keyOf(C.byId[id]), 2]));
    const deck = O.suggestion(owned); assert.equal(deck.length, 20); assert.equal(O.validate(deck, owned), null);
    const small = { 'naruto|Sakura Haruno': 1 };
    assert.equal(O.suggestion(small).length, 1);
    const many = Object.fromEntries(C.cards.slice(0, 40).map(c => [O.keyOf(c), 100]));
    assert.equal(O.validate(O.suggestion(many), many), null);
});
