'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const E = require('../lib/tcg-engine');
const C = require('../lib/tcg-catalog');
const fresh = () => E.create([C.starter, C.starter], ['Alice', 'Bob'], () => 0);
const act = (s, a, side = s.active) => E.act(s, side, { revision: s.revision, ...a });
const hand = (s, id, side = 0) => { const h = { uid: ++s.seq, card: id }; s.players[side].hand.push(h); return h.uid; };
function summon(s, id, side = 0) {
    s.active = side; s.phase = 'main'; s.players[side].mana = 10;
    s = act(s, { type: 'play', card: hand(s, id, side) });
    const u = s.players[side].board.at(-1); u.sleep = false;
    return [s, u.uid];
}
test('catalog uses genuine existing character artwork and legal starter', () => {
    const data = require('../public/cards.json'), cards = C.catalog(data);
    const expected = new Set(Object.entries(data.animes).flatMap(([anime, a]) => a.cards.map(c => anime + '|' + c[0])));
    const characters = cards.filter(c => c.kind === 'character');
    assert.equal(characters.length, expected.size);
    assert.ok(characters.every(c => expected.has(c.anime + '|' + c.name)));
    assert.equal(new Set(cards.map(c => c.id)).size, cards.length);
    assert.ok(cards.filter(c => c.source === 'signature').every(c => c.image && c.franchise));
    assert.equal(C.validateDeck(C.starter), null);
    for (const bad of [null, {}, [], Array(20).fill('naruto'), [...C.starter.slice(1), '__proto__'], [...C.starter.slice(1), 'constructor']]) assert.ok(C.validateDeck(bad));
    const assists = C.cards.filter(c => c.kind === 'assist').flatMap(c => [c.id, c.id]);
    assert.ok(C.validateDeck([...assists, ...C.starter.slice(0, 8)]));
});
test('all-catalog profiles are legal, stable, searchable and playable', () => {
    const generated = C.cards.find(c => c.source === 'profile');
    assert.ok(generated.id.startsWith('char-')); assert.ok(generated.role); assert.ok(generated.skill.name);
    const deck = C.starter.map(id => id === 'naruto' ? generated.id : id);
    assert.equal(C.validateDeck(deck), null);
    let s = E.create([deck, C.starter], ['Alice', 'Bob']); s.players[0].mana = 10;
    s = act(s, { type: 'play', card: hand(s, generated.id) }); assert.equal(s.players[0].board[0].card, generated.id);
    const page = C.search({ q: generated.name }); assert.ok(page.total > 0); assert.ok(page.cards.length <= 36);
    assert.ok(C.search().total > 70000); assert.equal(C.search({ kind: 'assist' }).total, 6);
});
test('opening hand, first-player compensation and mana progression', () => {
    let s = fresh(); assert.equal(s.players[0].hand.length, 4); assert.equal(s.players[0].mana, 1);
    s = act(s, { type: 'end' }); assert.equal(s.players[1].hand.length, 5); assert.equal(s.players[1].mana, 1);
    s = act(s, { type: 'end' }); assert.equal(s.players[0].mana, 2); assert.equal(s.players[0].hand.length, 5);
    s.players.forEach(p => { p.maxMana = 10; }); s = act(s, { type: 'end' }); assert.equal(s.players[1].maxMana, 10);
});
test('invalid player, stale revision, turn, mana and forged hand are rejected without mutation', () => {
    const s = fresh(), before = structuredClone(s);
    for (const [side, a] of [[2, { type: 'end' }], [1, { type: 'end' }], [0, { type: 'end', revision: 55 }], [0, { type: 'play', card: 999 }], [0, { type: 'teleport' }]]) {
        assert.throws(() => act(s, a, side), E.RuleError); assert.deepEqual(s, before);
    }
    assert.throws(() => act(s, { type: 'play', card: s.players[0].hand[0].uid }), /Mana/);
});
test('arrival, phases and once-per-turn exhaustion are enforced', () => {
    let s = fresh(); s.players[0].mana = 10; s = act(s, { type: 'play', card: hand(s, 'zoro') });
    const u = s.players[0].board[0];
    assert.throws(() => act(s, { type: 'skill', unit: u.uid }), /ne peut pas/);
    s = act(s, { type: 'end' }); s = act(s, { type: 'end' }); s.players[0].mana = 10;
    s = act(s, { type: 'skill', unit: u.uid }); assert.equal(s.players[0].board[0].attack, 5);
    s = act(s, { type: 'combat' });
    assert.throws(() => act(s, { type: 'attack', unit: u.uid, target: 'hero' }), /ne peut pas/);
    assert.throws(() => act(s, { type: 'play', card: s.players[0].hand[0].uid }), /principale/);
    assert.throws(() => act(s, { type: 'skill', unit: u.uid }), /phase/);
});
test('guard protects hero, retaliation is simultaneous and shield absorbs damage', () => {
    let s, attacker, guardian; [s, attacker] = summon(fresh(), 'goku'); [s, guardian] = summon(s, 'gaara', 1);
    s.active = 0; s.phase = 'combat'; s.players[1].board[0].shield = 2;
    assert.throws(() => act(s, { type: 'attack', unit: attacker, target: 'hero' }), /Garde/);
    s = act(s, { type: 'attack', unit: attacker, target: guardian });
    assert.equal(s.players[1].board[0].hp, 5); assert.equal(s.players[1].board[0].shield, 0); assert.equal(s.players[0].board[0].hp, 5);
});
test('mutual lethal combat clears both boards and adds discards', () => {
    let s, a, b; [s, a] = summon(fresh(), 'zoro'); [s, b] = summon(s, 'zoro', 1); s.active = 0; s.phase = 'combat';
    s = act(s, { type: 'attack', unit: a, target: b });
    assert.ok(s.players.every(p => p.board.length === 0 && p.discard.includes('zoro')));
});
test('freeze blocks exactly the next owner turn, including skill', () => {
    let s, a, b; [s, a] = summon(fresh(), 'rukia'); [s, b] = summon(s, 'zoro', 1); s.active = 0;
    s = act(s, { type: 'skill', unit: a, target: b }); s = act(s, { type: 'end' });
    assert.equal(s.players[1].board[0].frozen, true);
    assert.throws(() => act(s, { type: 'skill', unit: b }), /ne peut pas/);
    s = act(s, { type: 'end' }); s = act(s, { type: 'end' }); assert.equal(s.players[1].board[0].frozen, false);
});
test('burn ticks twice at the end of the target owner turns', () => {
    let s, a, b; [s, a] = summon(fresh(), 'ace'); [s, b] = summon(s, 'gaara', 1); s.active = 0;
    s = act(s, { type: 'skill', unit: a, target: b }); assert.equal(s.players[1].board[0].hp, 5);
    s = act(s, { type: 'end' }); assert.equal(s.players[1].board[0].hp, 5);
    s = act(s, { type: 'end' }); assert.equal(s.players[1].board[0].hp, 4);
    s = act(s, { type: 'end' }); s = act(s, { type: 'end' }); assert.equal(s.players[1].board[0].hp, 3); assert.equal(s.players[1].board[0].burn, 0);
});
test('Naruto clone has guard, no skill, arrival delay, and obeys the board cap', () => {
    let s, a; [s, a] = summon(fresh(), 'naruto'); s = act(s, { type: 'skill', unit: a });
    const clone = s.players[0].board.at(-1); assert.equal(clone.guard, true); assert.equal(clone.hp, 2); assert.equal(clone.sleep, true);
    clone.sleep = false; assert.throws(() => act(s, { type: 'skill', unit: clone.uid }), /clone/);
    while (s.players[0].board.length < 5) [s] = summon(s, 'zoro');
    s.players[0].board[0].used = false; s.players[0].mana = 10; const before = structuredClone(s);
    assert.throws(() => act(s, { type: 'skill', unit: a }), /plein/); assert.deepEqual(s, before);
    const id = hand(s, 'zoro'); assert.throws(() => act(s, { type: 'play', card: id }), /plein/);
});
test('assist and skill target side validation rolls back mana and hand', () => {
    let s, a, b; [s, a] = summon(fresh(), 'sasuke'); [s, b] = summon(s, 'zoro', 1); s.active = 0;
    const id = hand(s, 'sakura'), before = structuredClone(s);
    assert.throws(() => act(s, { type: 'play', card: id, target: b }), /cible/);
    assert.throws(() => act(s, { type: 'skill', unit: a, target: a }), /cible/);
    assert.deepEqual(s, before);
    s.players[0].board[0].hp = 1; s = act(s, { type: 'play', card: id, target: a });
    assert.equal(s.players[0].board[0].hp, 5); assert.ok(s.players[0].discard.includes('sakura'));
});
test('area, hero healing, shield and drain effects resolve', () => {
    let s, a; [s, a] = summon(fresh(), 'luffy'); [s] = summon(s, 'zoro', 1); [s] = summon(s, 'rukia', 1); s.active = 0; s.players[0].mana = 10;
    s = act(s, { type: 'skill', unit: a }); assert.deepEqual(s.players[1].board.map(u => u.hp), [1, 2]);
    s.players[0].hp = 29; s = act(s, { type: 'play', card: hand(s, 'chopper') }); assert.equal(s.players[0].hp, 30);
    s = act(s, { type: 'play', card: hand(s, 'orihime'), target: a }); assert.equal(s.players[0].board[0].shield, 2);
    [s, a] = summon(s, 'tanjiro'); s.players[0].hp = 20;
    s = act(s, { type: 'skill', unit: a, target: s.players[1].board[0].uid }); assert.equal(s.players[0].hp, 22); assert.equal(s.players[1].board.length, 1);
});
test('draw assist frees its hand slot, burns overflow, and fatigue grows', () => {
    let s = fresh(); s.players[0].hand = []; const id = hand(s, 'bulma'); for (let i = 0; i < 7; i++) hand(s, 'zoro'); s.players[0].mana = 10;
    s = act(s, { type: 'play', card: id }); assert.equal(s.players[0].hand.length, 8); assert.equal(s.players[0].discard.length, 2);
    s.players[0].deck = []; s.players[0].hand = []; const bulma = hand(s, 'bulma'); s.players[0].mana = 10;
    s = act(s, { type: 'play', card: bulma }); assert.equal(s.players[0].hp, 27); assert.equal(s.players[0].fatigue, 2);
});
test('victory, concession outside own turn, and terminal rejection', () => {
    let s, a; [s, a] = summon(fresh(), 'goku'); s.phase = 'combat'; s.players[1].hp = 4;
    s = act(s, { type: 'attack', unit: a, target: 'hero' }); assert.equal(s.winner, 0);
    assert.throws(() => act(s, { type: 'end' }), /terminée/);
    assert.equal(act(fresh(), { type: 'concede' }, 1).winner, 0);
});
test('public view hides opponent hand, both deck orders, and is detached', () => {
    const s = fresh(), v = E.view(s, 1); assert.equal(v.players[0].hand.length, 0); assert.equal(v.players[1].hand.length, 4);
    assert.equal(v.players[0].deck, undefined); assert.equal(v.players[1].deck, undefined); assert.equal(v.players[0].handCount, 4);
    v.players[1].hand[0].card = 'fake'; assert.notEqual(s.players[1].hand[0].card, 'fake');
});
test('AI completes its turn via legal moves, and full games terminate by fatigue', () => {
    for (let run = 0; run < 8; run++) {
        let s = fresh();
        for (let i = 0; i < 100 && s.winner === null; i++) { s = act(s, { type: 'end' }); s = E.aiTurn(s); assert.ok(s.active === 0 || s.winner !== null); }
        assert.notEqual(s.winner, null);
    }
});

test('direct attacks reduce actual hero life from 30 and show damage, never below zero', () => {
    let s = fresh();
    s.players[0].board.push({
        uid: ++s.seq, card: 'zoro', attack: 3, hp: 3, maxHp: 3,
        guard: false, shield: 0, burn: 0, freeze: 0, frozen: false, sleep: false, used: false
    });
    s = act(s, { type: 'combat' });
    s = act(s, { type: 'attack', unit: s.players[0].board[0].uid, target: 'hero' });
    assert.equal(s.players[1].hp, 27);
    assert.ok(s.log.at(-1).includes('3 PV'));
    s.players[1].hp = 2;
    s.players[0].board[0].used = false;
    s = act(s, { type: 'attack', unit: s.players[0].board[0].uid, target: 'hero' });
    assert.equal(s.players[1].hp, 0);
    assert.equal(s.winner, 0);
});
