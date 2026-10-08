'use strict';
// Anime TCG Duel: compact active/bench card battles inspired by handheld TCGs.
// Unlike collector cards, battle units are temporary and never consume inventory.
const { randomInt, randomUUID } = require('node:crypto');
const { byId, validateDeck } = require('./tcg-catalog');
class RuleError extends Error {}
const check = (value, message) => { if (!value) throw new RuleError(message); };
const copy = x => JSON.parse(JSON.stringify(x));
const attacks = card => ({
    basic: { cost: Math.max(1, Math.min(3, Math.ceil(card.cost / 2))), damage: card.attack * 10, name: 'Attaque' },
    skill: card.skill ? { cost: Math.max(2, Math.min(4, Math.ceil(card.skill.cost / 2) + 1)), name: card.skill.name, text: card.skill.text } : null
});
function shuffle(deck, rng = randomInt) {
    const a = [...deck];
    for (let i = a.length - 1; i > 0; i--) {
        const j = rng(i + 1);
        [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
}
const log = (s, str) => { s.log.push(str); if (s.log.length > 35) s.log.shift(); };
function take(s, p, amount = 1) {
    for (let i = 0; i < amount; i++) {
        if (!p.deck.length) break;
        const card = p.deck.pop();
        if (p.hand.length >= 10) p.discard.push(card);
        else p.hand.push({ uid: ++s.seq, card });
    }
}
function unit(s, id) {
    const c = byId[id];
    return { uid: ++s.seq, card: id, hp: 40 + c.health * 10, maxHp: 40 + c.health * 10,
        energy: 0, shield: 0, burn: 0, freeze: 0, attackBonus: 0, evolved: false,
        entered: s.turn, token: false };
}
function damage(u, raw) {
    if (!u) return 0;
    const amount = Math.max(0, raw);
    const blocked = Math.min(u.shield, amount);
    u.shield -= blocked;
    const hit = Math.min(u.hp, amount - blocked);
    u.hp -= hit;
    return hit;
}
function heal(u, amount) { if (u) u.hp = Math.min(u.maxHp, u.hp + amount); }
function resolve(s) {
    if (s.winner !== null) return;
    for (let side = 0; side < 2; side++) {
        const p = s.players[side], u = p.active;
        if (u && u.hp <= 0) {
            p.discard.push(...(u.evolutionStack || []), u.card);
            s.players[1 - side].points += u.evolved ? 2 : 1;
            log(s, byId[u.card].name + ' est K.O. ! +' + (u.evolved ? 2 : 1) + ' point(s) pour ' + s.players[1 - side].name + '.');
            p.active = null;
        }
        p.bench = p.bench.filter(u => {
            if (u.hp > 0) return true;
            p.discard.push(...(u.evolutionStack || []), u.card);
            s.players[1 - side].points += u.evolved ? 2 : 1;
            log(s, byId[u.card].name + ' est K.O. sur le banc ! +' + (u.evolved ? 2 : 1) + ' point(s).');
            return false;
        });
    }
    const points = s.players.map(p => p.points >= 3);
    const empty = s.players.map(p => p.ready && !p.active && !p.bench.length);
    if (points.some(Boolean) || empty.some(Boolean)) {
        const lost = points.map((p, i) => !p && empty[i]);
        const winners = [points[0] || lost[1], points[1] || lost[0]];
        s.winner = winners[0] && winners[1] ? 'draw' : winners[0] ? 0 : winners[1] ? 1 : 'draw';
        s.phase = 'finished';
    }
}
function begin(s) {
    s.turn++;
    const p = s.players[s.active];
    p.energyUsed = false;
    p.supportUsed = false;
    p.retreatUsed = false;
    for (const u of [p.active, ...p.bench]) if (u) u.abilityUsed = false;
    // The next turn after turn 30/50 is a draw, as in a short-form card duel.
    if (s.turn > (s.maxTurns || 30)) {
        s.winner = 'draw'; s.phase = 'finished';
        log(s, 'Limite de ' + s.maxTurns + ' tours atteinte : égalité.');
        return;
    }
    take(s, p);
    // The starting player prepares on turn one but receives no normal energy.
    if (s.turn === 1) p.energyUsed = true;
    // Damage-over-time is resolved before a new action.
    if (p.active && p.active.burn > 0) {
        damage(p.active, 10);
        p.active.burn--;
        log(s, p.name + ' subit 10 dégâts de brûlure.');
    }
    s.phase = 'main';
    resolve(s);
    if (s.winner === null) log(s, 'Tour ' + s.turn + ' · ' + p.name + ' · une énergie à placer.');
}
function create(decks, names, rng = randomInt, maxTurns = 30) {
    decks.forEach(d => check(!validateDeck(d), validateDeck(d)));
    const firstPlayer = rng(2); // Server-side coin toss, deterministic when seeded in tests.
    const s = { version: 2, id: randomUUID(), revision: 0, seq: 0, turn: 0,
        firstPlayer, maxTurns: maxTurns === 50 ? 50 : 30,
        active: firstPlayer, phase: 'setup', winner: null, log: [],
        players: decks.map((d, i) => ({ name: names[i], ready: false, points: 0,
            deck: shuffle(d, rng), hand: [], discard: [], active: null, bench: [],
            energyUsed: false, supportUsed: false, retreatUsed: false })) };
    // Opening hand must contain at least one character; deck validation assures 12.
    for (const p of s.players) {
        let count = 0;
        do {
            p.deck.push(...p.hand.map(h => h.card));
            p.hand = [];
            p.deck = shuffle(p.deck, rng);
            take(s, p, 5);
        } while (!p.hand.some(h => byId[h.card].kind === 'character') && ++count < 30);
        check(p.hand.some(h => byId[h.card].kind === 'character'), 'Main de départ sans combattant.');
    }
    log(s, 'Pile ou face : ' + s.players[firstPlayer].name + ' jouera en premier.');
    log(s, 'Choisissez secrètement votre premier combattant et vos remplaçants.');
    return s;
}
function applyEffect(s, side, card) {
    const p = s.players[side], e = s.players[1 - side], spec = card.kind === 'assist' ? card : card.skill;
    if (!spec) return;
    const n = spec.value * 10;
    switch (spec.effect) {
    case 'damage': damage(e.active, n); break;
    case 'area': {
        damage(e.active, n);
        for (const u of e.bench) damage(u, Math.ceil(n / 2));
        break;
    }
    case 'burn': damage(e.active, n); if (e.active) e.active.burn = Math.max(e.active.burn, 2); break;
    case 'freeze': if (e.active) e.active.freeze = 1; break;
    case 'drain': damage(e.active, n); heal(p.active, n); break;
    case 'heal': heal(p.active, n); break;
    case 'heroHeal': heal(p.active, n); break;
    case 'shield': if (p.active) p.active.shield += n; break;
    case 'draw': take(s, p, spec.value); break;
    case 'boost': if (p.active) p.active.attackBonus += n; break;
    case 'clone': {
        if (p.bench.length < 3) {
            const clone = unit(s, 'naruto');
            Object.assign(clone, { maxHp: 30, hp: 30, attackBonus: -10, token: true });
            p.bench.push(clone);
        }
        break;
    }
    default: break;
    }
}
function act(state, side, action) {
    check(action && typeof action === 'object' && !Array.isArray(action), 'Action invalide.');
    check(side === 0 || side === 1, 'Joueur invalide.');
    check(state.version === 2, 'Partie non compatible.');
    check(action.revision === state.revision, 'La partie a évolué. Actualise ton écran.');
    check(state.winner === null, 'La partie est déjà terminée.');
    const s = copy(state), p = s.players[side];
    if (action.type === 'concede') {
        s.winner = 1 - side;
        s.phase = 'finished';
        s.revision++;
        log(s, p.name + ' abandonne.');
        return s;
    }
    if (s.phase === 'setup') {
        check(!p.ready, 'Ton placement initial est déjà validé.');
        if (action.type === 'play') {
            const i = p.hand.findIndex(h => h.uid === action.card);
            check(i >= 0, 'Cette carte n’est pas dans ta main.');
            const id = p.hand[i].card;
            check(byId[id].kind === 'character', 'Choisis un personnage.');
            check(!p.active || p.bench.length < 3, 'Ton banc est complet.');
            p.hand.splice(i, 1);
            if (!p.active) p.active = unit(s, id);
            else p.bench.push(unit(s, id));
            log(s, p.name + ' prépare sa formation.');
        } else if (action.type === 'ready') {
            check(p.active, 'Place ton premier combattant avant de valider.');
            p.ready = true;
            log(s, p.name + ' est prêt.');
            if (s.players.every(p => p.ready)) begin(s);
        } else throw new RuleError('Place tes cartes avant de commencer.');
        s.revision++;
        return s;
    }
    check(s.active === side, 'Ce n’est pas ton tour.');
    check(s.phase === 'main', 'Tour terminé.');
    if (!p.active) {
        check(action.type === 'promote', 'Choisis un combattant du banc.');
        const index = action.index;
        check(Number.isInteger(index) && index >= 0 && index < p.bench.length, 'Remplaçant invalide.');
        p.active = p.bench.splice(index, 1)[0];
        log(s, p.name + ' envoie ' + byId[p.active.card].name + ' au combat.');
    } else if (action.type === 'play') {
        const i = p.hand.findIndex(h => h.uid === action.card);
        check(i >= 0, 'Cette carte n’est pas dans ta main.');
        const id = p.hand[i].card, c = byId[id];
        if (c.kind === 'character') {
            check(p.bench.length < 3, 'Le banc est complet.');
            p.hand.splice(i, 1);
            p.bench.push(unit(s, id));
            log(s, p.name + ' pose ' + c.name + ' sur le banc.');
        } else {
            check(c.kind === 'assist', 'Une transformation doit être posée sur son personnage de base.');
            const isSupporter = c.subtype !== 'item';
            check(!isSupporter || !p.supportUsed, 'Un seul Supporter par tour.');
            p.hand.splice(i, 1);
            applyEffect(s, side, c);
            p.discard.push(id);
            if (isSupporter) p.supportUsed = true;
            log(s, p.name + ' utilise ' + c.name + '.');
        }
    } else if (action.type === 'ability') {
        const u = [p.active, ...p.bench].find(u => u && u.uid === action.target);
        check(u, 'Personnage introuvable pour ce talent.');
        const ability = byId[u.card].ability;
        check(ability, 'Ce personnage ne possède pas de talent activable.');
        check(!u.abilityUsed, 'Ce talent a déjà été utilisé ce tour.');
        if (ability.effect === 'shield') {
            check(p.active, 'Aucun combattant à protéger.');
            p.active.shield += ability.value * 10;
        } else if (ability.effect === 'draw') take(s, p, ability.value);
        else if (ability.effect === 'heal') heal(p.active, ability.value * 10);
        else throw new RuleError('Talent inconnu.');
        u.abilityUsed = true;
        log(s, byId[u.card].name + ' active ' + ability.name + '.');
    } else if (action.type === 'energy') {
        check(!p.energyUsed, 'Tu as déjà placé ton énergie ce tour.');
        const u = [p.active, ...p.bench].find(x => x && x.uid === action.target);
        check(u, 'Combattant introuvable.');
        u.energy = Math.min(10, u.energy + 1);
        p.energyUsed = true;
        log(s, '+1 énergie sur ' + byId[u.card].name + '.');
    } else if (action.type === 'retreat') {
        check(!p.retreatUsed, 'Une seule retraite par tour.');
        check(!p.active.freeze, 'Impossible de battre en retraite lorsque le combattant est gelé.');
        check(Number.isInteger(action.index) && action.index >= 0 && action.index < p.bench.length, 'Remplaçant invalide.');
        check(p.active.energy >= 1, 'Il faut 1 énergie pour battre en retraite.');
        p.active.energy--;
        const previous = p.active;
        previous.freeze = 0; previous.burn = 0;
        p.active = p.bench.splice(action.index, 1, previous)[0];
        p.retreatUsed = true;
        log(s, byId[previous.card].name + ' bat en retraite.');
    } else if (action.type === 'evolve') {
        const i = p.hand.findIndex(h => h.uid === action.card);
        check(i >= 0, 'Carte de transformation introuvable dans ta main.');
        const id = p.hand[i].card, form = byId[id];
        check(form?.kind === 'evolution', 'Il faut une vraie carte de transformation pour évoluer.');
        const target = [p.active, ...p.bench].find(u => u && u.uid === action.target);
        check(target, 'Choisis le combattant à transformer.');
        check(!target.token && target.card === form.evolvesFrom,
            'Cette transformation ne correspond pas au personnage choisi.');
        check(!target.evolved, 'Ce combattant a déjà atteint sa transformation.');
        check(s.turn >= side + 3 && target.entered < s.turn,
            'La transformation n’est possible qu’à partir de ton deuxième tour, après la pose du personnage.');
        check(target.lastEvolutionTurn !== s.turn, 'Une seule transformation par tour.');
        const previous = byId[target.card], lostHp = target.maxHp - target.hp;
        const maxHp = 40 + form.health * 10;
        check(maxHp > lostHp, 'Impossible de transformer un personnage déjà trop affaibli.');
        p.hand.splice(i, 1);
        target.evolutionStack = [...(target.evolutionStack || []), target.card];
        target.card = id;
        target.maxHp = maxHp;
        target.hp = maxHp - lostHp; // Damage and attached energy are retained.
        target.evolved = true;
        target.lastEvolutionTurn = s.turn;
        target.freeze = 0;
        target.burn = 0;
        target.attackBonus = 0;
        log(s, previous.name + ' se transforme en ' + form.name + ' !');
    } else if (action.type === 'attack') {
        check(p.active.freeze === 0, 'Ce personnage est gelé ce tour.');
        const id = p.active.card, c = byId[id];
        const moves = attacks(c);
        check(action.mode === 'basic' || action.mode === 'skill', 'Attaque invalide.');
        const move = moves[action.mode];
        check(move, 'Cette attaque n’existe pas.');
        check(p.active.energy >= move.cost, 'Pas assez d’énergie sur le combattant.');
        check(s.players[1 - side].active, 'Pas de cible active.');
        if (action.mode === 'basic') {
            const dealt = damage(s.players[1 - side].active, move.damage + p.active.attackBonus);
            log(s, c.name + ' attaque ! ' + dealt + ' dégâts.');
        } else {
            applyEffect(s, side, c);
            log(s, c.name + ' lance ' + c.skill.name + ' !');
        }
        resolve(s);
        if (s.winner === null) {
            // An attack finishes the turn, as in a compact TCG.
            if (p.active && p.active.freeze) p.active.freeze = 0;
            s.active = 1 - side;
            begin(s);
        }
    } else if (action.type === 'end') {
        if (p.active && p.active.freeze) p.active.freeze = 0;
        s.active = 1 - side;
        begin(s);
    } else throw new RuleError('Action inconnue.');
    resolve(s);
    s.revision++;
    return s;
}
function view(s, side) {
    if (!s) return null;
    return { version: s.version, id: s.id, revision: s.revision, turn: s.turn, phase: s.phase,
        firstPlayer: s.firstPlayer ?? 0, maxTurns: s.maxTurns || 30,
        active: s.active, side, winner: s.winner, log: [...s.log],
        players: s.players.map((p, i) => ({
            name: p.name, ready: p.ready, points: p.points, energyUsed: p.energyUsed,
            supportUsed: p.supportUsed, retreatUsed: !!p.retreatUsed,
            active: s.phase === 'setup' && i !== side ? null : copy(p.active),
            bench: s.phase === 'setup' && i !== side ? [] : copy(p.bench),
            deckCount: p.deck.length, handCount: p.hand.length, hand: i === side ? copy(p.hand) : [],
            discard: [...p.discard]
        })) };
}
function aiTurn(state) {
    let s = state;
    const go = action => { s = act(s, 1, { ...action, revision: s.revision }); };
    if (s.phase === 'setup' && !s.players[1].ready) {
        for (let n = 0; n < 4; n++) {
            const p = s.players[1];
            const first = p.hand.find(h => byId[h.card].kind === 'character');
            if (!first || (p.active && p.bench.length >= 2)) break;
            go({ type: 'play', card: first.uid });
        }
        go({ type: 'ready' });
    }
    for (let n = 0; n < 25 && s.winner === null && s.phase === 'main' && s.active === 1; n++) {
        const p = s.players[1], enemy = s.players[0];
        if (!p.active) { if (p.bench.length) { go({ type: 'promote', index: 0 }); continue; } break; }
        const talent = [p.active, ...p.bench].find(u => u && byId[u.card].ability && !u.abilityUsed);
        if (talent) { go({ type: 'ability', target: talent.uid }); continue; }
        if (!p.energyUsed) { go({ type: 'energy', target: p.active.uid }); continue; }
        const benchCard = p.hand.find(h => byId[h.card].kind === 'character');
        if (p.bench.length < 2 && benchCard) { go({ type: 'play', card: benchCard.uid }); continue; }
        const targets = s.turn >= 4 ? [p.active, ...p.bench].filter(u =>
            u && !u.evolved && !u.token && u.entered < s.turn) : [];
        const evolution = p.hand.map(h => ({ hand: h, target: targets.find(u =>
            byId[h.card]?.kind === 'evolution' && byId[h.card].evolvesFrom === u.card) })).find(x => x.target);
        if (evolution) { go({ type: 'evolve', card: evolution.hand.uid, target: evolution.target.uid }); continue; }
        const support = p.hand.find(h => byId[h.card].kind === 'assist');
        if (support && (!p.supportUsed || byId[support.card].subtype === 'item')) {
            go({ type: 'play', card: support.uid }); continue;
        }
        const card = byId[p.active.card], move = attacks(card);
        // Avoid endless non-damaging AI skills (shield/draw/clone) instead of attacking.
        const offensive = card.skill && ['damage', 'area', 'burn', 'drain'].includes(card.skill.effect);
        const healing = card.skill && card.skill.effect === 'heal' && p.active.hp < p.active.maxHp / 2;
        const mode = move.skill && p.active.energy >= move.skill.cost && enemy.active && (offensive || healing) ? 'skill' : 'basic';
        if (!p.active.freeze && enemy.active && p.active.energy >= move[mode].cost) go({ type: 'attack', mode });
        else go({ type: 'end' });
    }
    return s;
}
module.exports = { RuleError, create, act, view, aiTurn, attacks };
