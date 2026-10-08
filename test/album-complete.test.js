'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const Engine = require('../public/engine');
const data = require('../public/cards.json');

test('album completion emits a single 100% milestone with the anime name', () => {
    const G = Engine.create(data);
    const [anime, definition] = Object.entries(data.animes).find(([, a]) => a.cards.length >= 2);
    const state = Engine.fresh();
    for (const card of definition.cards.slice(0, -1)) {
        state.cards[anime + '|' + card[0]] = { n: 1, shiny: 0, fin: null };
    }
    // A previously visited album is already tracked: earlier rewards do not replay.
    G.syncBinders(state);
    assert.ok((state.done[anime] || 0) < 4);
    const last = definition.cards.at(-1);
    state.cards[anime + '|' + last[0]] = { n: 1, shiny: 0, fin: null };
    const rewards = G.checkBinders(state, [anime]);
    const completions = rewards.filter(r => r.pct === 100);
    assert.equal(completions.length, 1);
    assert.equal(completions[0].u, anime);
    assert.equal(completions[0].name, definition.name);
    assert.ok(completions[0].coins > 0);
    assert.equal(G.checkBinders(state, [anime]).filter(r => r.pct === 100).length, 0);

    // The achievement should not repeat after the player loses and reacquires the card.
    delete state.cards[anime + '|' + last[0]];
    state.cards[anime + '|' + last[0]] = { n: 1, shiny: 0, fin: null };
    assert.equal(G.checkBinders(state, [anime]).filter(r => r.pct === 100).length, 0);
});

test('a non-completed album does not produce a 100% notification milestone', () => {
    const G = Engine.create(require('../public/cards.json'));
    const [anime, definition] = Object.entries(data.animes).find(([, a]) => a.cards.length >= 2);
    const state = Engine.fresh();
    for (const card of definition.cards.slice(0, -1)) {
        state.cards[anime + '|' + card[0]] = { n: 1, shiny: 0, fin: null };
    }
    const rewards = G.checkBinders(state, [anime]);
    assert.equal(rewards.some(r => r.pct === 100), false);
});
