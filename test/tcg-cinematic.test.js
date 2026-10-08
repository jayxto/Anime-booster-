'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const C = require('../lib/tcg-catalog');
const P = require('../lib/tcg-pocket');
const move = (s, side, action) => P.act(s, side, { ...action, revision: s.revision });
function duel() {
    let s = P.create([C.starter, C.starter], ['Goku', 'Rival'], () => 0, 50);
    s.players[0].hand.push({ uid: ++s.seq, card: 'goku' });
    s = move(s, 0, { type: 'play', card: s.players[0].hand.at(-1).uid });
    s = move(s, 0, { type: 'ready' });
    const other = s.players[1].hand.find(h => C.byId[h.card].kind === 'character');
    s = move(s, 1, { type: 'play', card: other.uid });
    s = move(s, 1, { type: 'ready' });
    s.players[1].active.hp = 600;
    s.players[1].active.maxHp = 600;
    return s;
}
test('Goku owns three distinct moves with exact costs and damage', () => {
    const m = P.attacks(C.byId.goku);
    assert.equal(m.basic.name, 'Coup de poing');
    assert.equal(m.basic.cost, 1);
    assert.equal(m.basic.damage, 30);
    assert.equal(m.skill.name, 'Kamehameha');
    assert.equal(m.skill.cost, 2);
    assert.equal(m.skill.damage, 70);
    assert.equal(m.ultimate.name, 'Super Kamehameha');
    assert.equal(m.ultimate.cost, 4);
    assert.equal(m.ultimate.damage, 140);
});
for (const [name, mode, cost, damage] of [
    ['punch', 'basic', 1, 30],
    ['kamehameha', 'skill', 2, 70],
    ['super kamehameha', 'ultimate', 4, 140]
]) {
    test('Goku ' + name + ' uses energy gating and real combat damage', () => {
        let s = duel();
        s.players[0].active.energy = cost - 1;
        assert.throws(() => move(s, 0, { type: 'attack', mode }), /énergie/);
        s.players[0].active.energy = cost;
        const before = s.players[1].active.hp;
        s = move(s, 0, { type: 'attack', mode });
        assert.equal(s.players[1].active.hp, before - damage);
        assert.equal(s.players[0].active.energy, cost, 'attacks retain energy');
        assert.equal(s.lastAction.mode, mode);
        assert.equal(s.lastAction.damage, damage);
        assert.equal(s.events.at(-1).revision, s.lastAction.revision);
        assert.equal(P.view(s, 0).events.at(-1).damage, damage);
    });
}
test('visual hit damage is grounded in HP loss rather than raw attack power', () => {
    let s = duel();
    s.players[0].active.energy = 4;
    s.players[1].active.shield = 50;
    s = move(s, 0, { type: 'attack', mode: 'ultimate' });
    assert.equal(s.lastAction.damage, 90);
    assert.equal(s.lastAction.shieldBroken, 50);
    assert.equal(s.players[1].active.hp, 510);
});
test('human attack and AI reply both remain in the ordered FX history', () => {
    let s = duel();
    s.players[0].active.energy = 4;
    s = move(s, 0, { type: 'attack', mode: 'basic' });
    s.players[1].active.energy = 4;
    s = move(s, 1, { type: 'attack', mode: 'basic' });
    assert.equal(s.events.length, 2);
    assert.deepEqual(s.events.map(x => x.side), [0, 1]);
    assert.ok(s.events[1].revision > s.events[0].revision);
});
test('cinematic UI uses the server event, shows three attacks and never loops an effect', () => {
    const page = { innerHTML: '' }, listeners = {};
    const before = { document: global.document, window: global.window };
    global.document = {
        getElementById: id => id === 'tcg-battle' ? page : null,
        addEventListener: (kind, fn) => { listeners[kind] = fn; }
    };
    global.window = {};
    try {
        // Execute as a new script to keep animation state isolated for this test.
        const script = fs.readFileSync(require.resolve('../public/tcg-pocket'), 'utf8');
        new Function('window', 'document', 'setInterval', 'clearInterval', script)(
            global.window, global.document, () => 1, () => {});
        let s = duel();
        s.players[0].active.energy = 4;
        s = move(s, 0, { type: 'attack', mode: 'ultimate' });
        const g = P.view(s, 0);
        global.window.TCGPocket.render({ game: g, cards: C.byId, isBusy: false, action() {} });
        assert.match(page.innerHTML, /pocket-fx-scene/);
        assert.match(page.innerHTML, /Super Kamehameha/);
        assert.match(page.innerHTML, /−140 PV/);
        global.window.TCGPocket.render({ game: g, cards: C.byId, isBusy: false, action() {} });
        assert.doesNotMatch(page.innerHTML, /pocket-fx-scene/);
        const ownTurn = duel();
        ownTurn.players[0].active.energy = 2;
        global.window.TCGPocket.render({ game: P.view(ownTurn, 0), cards: C.byId, isBusy: false, action() {} });
        assert.match(page.innerHTML, /data-mode="ultimate" disabled/);
        assert.match(page.innerHTML, /data-mode="basic">/);
        assert.match(page.innerHTML, /data-mode="skill">/);
        ownTurn.players[0].active.energy = 4;
        global.window.TCGPocket.render({ game: P.view(ownTurn, 0), cards: C.byId, isBusy: false, action() {} });
        assert.match(page.innerHTML, /data-mode="ultimate">/);
    } finally {
        global.document = before.document;
        global.window = before.window;
    }
});
