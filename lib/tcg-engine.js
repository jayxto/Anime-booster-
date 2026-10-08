'use strict';
const { randomInt, randomUUID } = require('node:crypto');
const { byId, validateDeck } = require('./tcg-catalog');
class RuleError extends Error {}
const check = (ok, message) => { if (!ok) throw new RuleError(message); };
const copy = value => JSON.parse(JSON.stringify(value));
function shuffle(deck, rng = n => randomInt(n)) {
    const result = [...deck];
    for (let i = result.length - 1; i > 0; i--) { const j = rng(i + 1); [result[i], result[j]] = [result[j], result[i]]; }
    return result;
}
function log(s, message) { s.log.push(message); s.log = s.log.slice(-40); }
function finish(s) {
    for (const p of s.players) {
        for (const u of p.board.filter(u => u.hp <= 0)) p.discard.push(u.card);
        p.board = p.board.filter(u => u.hp > 0);
    }
    const dead = s.players.map(p => p.hp <= 0);
    if (dead.some(Boolean)) { s.winner = dead.every(Boolean) ? 'draw' : dead[0] ? 1 : 0; s.phase = 'finished'; }
}
function draw(s, side, count = 1) {
    const p = s.players[side];
    for (let i = 0; i < count; i++) {
        const card = p.deck.pop();
        if (!card) { p.hp -= ++p.fatigue; log(s, `${p.name} subit ${p.fatigue} dégât(s) de fatigue.`); }
        else if (p.hand.length >= 8) { p.discard.push(card); log(s, `${p.name} défausse ${byId[card].name} : main pleine.`); }
        else p.hand.push({ uid: ++s.seq, card });
    }
    finish(s);
}
function begin(s) {
    s.turn++; s.phase = 'main';
    const p = s.players[s.active];
    p.maxMana = Math.min(10, p.maxMana + 1); p.mana = p.maxMana;
    for (const u of p.board) { u.sleep = false; u.used = false; u.frozen = u.freeze > 0; u.freeze = Math.max(0, u.freeze - 1); }
    log(s, `Tour ${s.turn} · ${p.name} · pioche et recharge du mana.`);
    // First player skips the first draw to offset initiative.
    if (s.turn > 1) draw(s, s.active);
}
function create(decks, names, rng) {
    decks.forEach(d => check(!validateDeck(d), validateDeck(d)));
    const s = { version: 1, id: randomUUID(), revision: 0, seq: 0, turn: 0, active: 0, phase: 'main', winner: null, log: [],
        players: decks.map((d, i) => ({ name: names[i], hp: 30, mana: 0, maxMana: 0, fatigue: 0, deck: shuffle(d, rng), hand: [], board: [], discard: [] })) };
    draw(s, 0, 4); draw(s, 1, 4); begin(s); return s;
}
function unit(s, id) {
    const c = byId[id];
    return { uid: ++s.seq, card: id, attack: c.attack, hp: c.health, maxHp: c.health, guard: c.passive === 'guard', shield: 0, burn: 0, freeze: 0, frozen: false, sleep: true, used: false };
}
function hit(u, amount) { const blocked = Math.min(u.shield, amount); u.shield -= blocked; u.hp -= amount - blocked; }
function targetFor(s, side, spec, id, self) {
    if (spec.target === 'none') return null;
    if (spec.target === 'self') return self;
    const p = s.players[spec.target === 'enemy' ? 1 - side : side];
    const target = p.board.find(u => u.uid === id);
    check(target, 'Choisis une cible valide.'); return target;
}
function effect(s, side, spec, target) {
    const p = s.players[side], enemy = s.players[1 - side];
    switch (spec.effect) {
    case 'damage': hit(target, spec.value); break;
    case 'burn': hit(target, spec.value); target.burn = 2; break;
    case 'drain': hit(target, spec.value); p.hp = Math.min(30, p.hp + spec.value); break;
    case 'area': enemy.board.forEach(u => hit(u, spec.value)); break;
    case 'shield': target.shield += spec.value; break;
    case 'heal': target.hp = Math.min(target.maxHp, target.hp + spec.value); break;
    case 'heroHeal': p.hp = Math.min(30, p.hp + spec.value); break;
    case 'draw': draw(s, side, spec.value); break;
    case 'freeze': target.freeze = 1; break;
    case 'boost': target.attack += spec.value; break;
    case 'clone': {
        check(p.board.length < 5, 'Le plateau est plein (5 personnages).');
        const clone = unit(s, 'naruto'); Object.assign(clone, { attack: 1, hp: 2, maxHp: 2, guard: true, token: true }); p.board.push(clone); break;
    }
    default: throw new RuleError('Effet inconnu.');
    }
}
// Copy-on-write: a rejected action cannot spend resources or partially alter the match.
function act(state, side, a) {
    check(a && typeof a === 'object' && !Array.isArray(a), 'Action invalide.');
    check(side === 0 || side === 1, 'Joueur invalide.');
    check(a.revision === state.revision, 'La partie a changé. Actualise avant de rejouer.');
    check(state.winner === null, 'La partie est terminée.');
    const s = copy(state), p = s.players[side], enemy = s.players[1 - side];
    if (a.type === 'concede') { s.winner = 1 - side; s.phase = 'finished'; log(s, `${p.name} abandonne.`); s.revision++; return s; }
    check(s.active === side, 'Ce n’est pas ton tour.');
    if (a.type === 'play') {
        check(s.phase === 'main', 'Les cartes se jouent en phase principale.');
        const index = p.hand.findIndex(h => h.uid === a.card); check(index >= 0, 'Cette carte n’est pas dans ta main.');
        const c = byId[p.hand[index].card]; check(p.mana >= c.cost, 'Mana insuffisant.');
        p.hand.splice(index, 1); // Free the hand slot before resolving a draw assist.
        if (c.kind === 'character') { check(p.board.length < 5, 'Le plateau est plein (5 personnages).'); p.board.push(unit(s, c.id)); }
        else { const target = targetFor(s, side, c, a.target); effect(s, side, c, target); p.discard.push(c.id); }
        p.mana -= c.cost; log(s, `${p.name} joue ${c.name}.`);
    } else if (a.type === 'skill' || a.type === 'attack') {
        check(s.phase === (a.type === 'skill' ? 'main' : 'combat'), 'Cette action ne correspond pas à la phase.');
        const u = p.board.find(u => u.uid === a.unit); check(u, 'Personnage introuvable.');
        check(!u.sleep && !u.used && !u.frozen, 'Ce personnage ne peut pas agir (arrivée, gel ou action déjà utilisée).');
        if (a.type === 'skill') {
            check(!u.token, 'Un clone ne possède pas de compétence.');
            const spec = byId[u.card].skill; check(p.mana >= spec.cost, 'Mana insuffisant.');
            const target = targetFor(s, side, spec, a.target, u); effect(s, side, spec, target); p.mana -= spec.cost;
            log(s, `${p.name} utilise ${spec.name}.`);
        } else {
            const target = enemy.board.find(t => t.uid === a.target);
            check(a.target === 'hero' || target, 'Cible adverse introuvable.');
            check(!enemy.board.some(t => t.guard) || target?.guard, 'Un personnage avec Garde protège cet adversaire.');
            if (target) { hit(target, u.attack); hit(u, target.attack); }
            else enemy.hp = Math.max(0, enemy.hp - u.attack);
            log(s, `${byId[u.card].name} attaque ${target ? byId[target.card].name : enemy.name}${target ? '.' : ' et lui retire ' + u.attack + ' PV !'}`);
        }
        u.used = true;
    } else if (a.type === 'combat') { check(s.phase === 'main', 'Phase de combat déjà commencée.'); s.phase = 'combat'; log(s, `${p.name} entre en combat.`); }
    else if (a.type === 'end') {
        for (const u of p.board) if (u.burn > 0) { hit(u, 1); u.burn--; }
        log(s, `${p.name} termine son tour. Les brûlures se résolvent.`); finish(s);
        if (s.winner === null) { s.active = 1 - side; begin(s); }
    } else throw new RuleError('Action inconnue.');
    finish(s); s.revision++; return s;
}
function view(s, side) {
    if (!s) return null;
    return { id: s.id, revision: s.revision, turn: s.turn, active: s.active, side, phase: s.phase, winner: s.winner, log: [...s.log],
        players: s.players.map((p, i) => ({ name: p.name, hp: p.hp, mana: p.mana, maxMana: p.maxMana, fatigue: p.fatigue,
            deckCount: p.deck.length, handCount: p.hand.length, hand: i === side ? copy(p.hand) : [], board: copy(p.board), discard: [...p.discard] })) };
}
function aiTurn(state) {
    let s = state;
    // Bounded search through legal moves; same validator as human actions.
    for (let n = 0; n < 80 && s.active === 1 && s.winner === null; n++) {
        const p = s.players[1], e = s.players[0], candidates = [];
        const targets = [undefined, ...e.board.map(u => u.uid), ...p.board.map(u => u.uid)];
        if (s.phase === 'main') {
            for (const h of p.hand) for (const target of targets) candidates.push({ type: 'play', card: h.uid, target });
            for (const u of p.board) for (const target of targets) candidates.push({ type: 'skill', unit: u.uid, target });
            candidates.push({ type: 'combat' });
        } else {
            for (const u of p.board) for (const target of [...e.board.filter(t => t.guard).map(t => t.uid), 'hero', ...e.board.map(t => t.uid)]) candidates.push({ type: 'attack', unit: u.uid, target });
            candidates.push({ type: 'end' });
        }
        let next;
        for (const a of candidates) { try { next = act(s, 1, { ...a, revision: s.revision }); break; } catch (error) { if (!(error instanceof RuleError)) throw error; } }
        if (!next) break; s = next;
    }
    return s;
}
module.exports = { RuleError, create, act, view, aiTurn };
