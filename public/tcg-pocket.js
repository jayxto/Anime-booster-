/* ANIME DUEL — Pocket-inspired battle presentation (no third-party game assets). */
(() => {
'use strict';
const $ = id => document.getElementById(id);
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
const disabled = yes => yes ? ' disabled' : '';
let currentAction = null;
let busy = false;
function mini(unit, player, own, inBench, index, game, cards) {
    if (!unit) return '<div class="pocket-empty"><span>＋</span><small>Libre</small></div>';
    const c = cards[unit.card] || { name: unit.card, image: null, attack: 1, cost: 2 };
    const can = own && game.phase === 'main' && game.active === game.side && game.winner === null;
    const hp = Math.max(0, unit.hp), max = Math.max(1, unit.maxHp);
    const image = c.image ? '<img src="' + esc(c.image) + '" alt="" loading="lazy" referrerpolicy="no-referrer">' : '<div class="pocket-noart">✦</div>';
    let buttons = '';
    if (can && !player.energyUsed)
        buttons += '<button data-pocket-action="energy" data-uid="' + unit.uid + '" title="Donner une énergie à cette carte">+1 ◆</button>';
    if (can && inBench && player.active && player.active.energy > 0)
        buttons += '<button data-pocket-action="retreat" data-index="' + index + '">Échanger</button>';
    if (can && inBench && !player.active)
        buttons += '<button class="gold" data-pocket-action="promote" data-index="' + index + '">Choisir</button>';
    return '<article class="pocket-unit' + (inBench ? ' bench-unit' : '') + (own ? ' mine' : ' rival') + '">' +
        '<div class="pocket-art">' + image + '<span class="pocket-energy">◆ ' + unit.energy + '</span>' +
        (unit.evolved ? '<span class="pocket-evolved">TRANSFORMATION ✦</span>' : '') + '</div>' +
        '<div class="pocket-card-info"><strong>' + esc(c.name) + '</strong><b>♥ ' + hp + '/' + max + '</b></div>' +
        '<div class="pocket-hpbar"><i style="width:' + (hp / max * 100) + '%"></i></div>' +
        ((unit.shield || unit.freeze || unit.burn) ? '<div class="pocket-effects">' +
          (unit.shield ? '🛡 ' + unit.shield + ' ' : '') + (unit.freeze ? '❄ Gel ' : '') + (unit.burn ? '🔥 ' + unit.burn : '') + '</div>' : '') +
        (buttons ? '<div class="pocket-unit-buttons">' + buttons + '</div>' : '') + '</article>';
}
function bench(p, own, g, cards) {
    const slots = [...p.bench];
    while (slots.length < 3) slots.push(null);
    return '<div class="pocket-bench">' + slots.map((u,i) => mini(u,p,own,true,i,g,cards)).join('') + '</div>';
}
function hand(p, g, cards) {
    const setup = g.phase === 'setup', turn = g.active === g.side && g.phase === 'main';
    const allowed = setup ? !p.ready : turn;
    const body = p.hand.map(h => {
        const c = cards[h.card];
        if (!c) return '';
        const isCharacter = c.kind === 'character';
        const isForm = c.kind === 'evolution';
        const canPlay = allowed && (setup ? isCharacter && (!p.active || p.bench.length < 3)
            : isCharacter ? p.bench.length < 3 : c.kind === 'assist' && !p.supportUsed);
        const target = turn && isForm && [p.active, ...p.bench].find(u =>
            u && !u.evolved && !u.token && u.card === c.evolvesFrom && u.entered < g.turn);
        const canEvolve = !!target;
        const art = c.image ? '<img src="' + esc(c.image) + '" alt="" loading="lazy" referrerpolicy="no-referrer">' : '';
        return '<div class="pocket-hand-card' + (isForm ? ' transformation' : '') + '"><div class="pocket-hand-art">' + art + '<span>' +
            (isForm ? 'TRANSFORMATION' : isCharacter ? 'COMBATTANT' : 'ASSIST') + '</span></div><strong>' + esc(c.name) + '</strong>' +
            '<small>' + esc(isCharacter ? (c.skill?.name || 'Attaque') : c.text) + '</small>' +
            '<div class="pocket-hand-buttons"><button data-pocket-action="play" data-card="' + h.uid + '"' +
            disabled(busy || !canPlay) + '>' + (isForm ? 'Forme' : setup ? 'Placer' : isCharacter ? 'Banc' : 'Utiliser') + '</button>' +
            (canEvolve ? '<button class="gold" data-pocket-action="evolve" data-card="' + h.uid +
                '" data-target="' + target.uid + '"' + disabled(busy) + '>Transformer ✦</button>' : '') +
            '</div></div>';
    }).join('');
    return '<div class="pocket-hand-title"><strong>TA MAIN · ' + p.handCount + '/8</strong><span>Pioche : ' + p.deckCount + '</span></div>' +
        '<div class="pocket-hand">' + (body || '<p>Ta main est vide.</p>') + '</div>';
}
function controls(p, opponent, g, cards) {
    if (g.winner !== null) return '<div class="pocket-guide">Le duel est terminé. Tu peux quitter ce salon.</div>';
    if (g.phase === 'setup') {
        return '<div class="pocket-guide"><strong>PRÉPARE TON ÉQUIPE</strong>' +
            '<span>Place une carte active et jusqu’à 3 combattants sur le banc.</span>' +
            '<button class="gold" data-pocket-action="ready"' + disabled(busy || p.ready || !p.active) + '>' +
            (p.ready ? '✓ En attente de ton rival…' : 'Je suis prêt ✓') + '</button></div>';
    }
    if (g.active !== g.side) return '<div class="pocket-guide">⏳ Tour adverse · prépare ta prochaine attaque.</div>';
    if (!p.active) return '<div class="pocket-guide">⚠ Ton combattant est K.O. ! Choisis un remplaçant sur le banc.</div>';
    const c = cards[p.active.card];
    if (!c) return '<div class="pocket-guide">Chargement de la carte…</div>';
    const basicCost = Math.max(1, Math.min(3, Math.ceil(c.cost / 2)));
    const specialCost = c.skill ? Math.max(2, Math.min(4, Math.ceil(c.skill.cost / 2) + 1)) : null;
    const damage = c.attack * 10 + p.active.attackBonus;
    const able = !p.active.freeze && !!opponent.active;
    return '<div class="pocket-controls"><div class="pocket-attach"><span>' +
        (p.energyUsed ? '✓ Énergie posée' : '◆ ÉNERGIE DISPONIBLE') + '</span>' +
        '<button data-pocket-action="energy" data-uid="' + p.active.uid + '"' + disabled(busy || p.energyUsed) +
        '>+1 ◆ sur le combattant</button></div><div class="pocket-attacks">' +
        '<button class="pocket-attack" data-pocket-action="attack" data-mode="basic"' +
        disabled(busy || !able || p.active.energy < basicCost) +
        '><strong>⚔ Attaque · ' + damage + ' dégâts</strong><span>' + basicCost + ' ◆ nécessaires</span></button>' +
        (c.skill ? '<button class="pocket-attack special" data-pocket-action="attack" data-mode="skill"' +
        disabled(busy || !able || p.active.energy < specialCost) + '><strong>✦ ' + esc(c.skill.name) +
        '</strong><span>' + specialCost + ' ◆ · ' + esc(c.skill.text) + '</span></button>' : '') +
        '</div><button class="pocket-pass" data-pocket-action="end"' + disabled(busy) + '>Terminer le tour →</button></div>';
}
function victory(g) {
    if (g.winner === null) return '';
    const won = g.winner === g.side;
    const confetti = won ? '<div class="tcg-confetti" aria-hidden="true">' +
        Array.from({ length: 32 }, (_, i) => '<i style="--n:' + i + ';--x:' + ((i * 37 + 7) % 100) +
            '%;--delay:' + ((i * 7) % 13 * .11) + 's"></i>').join('') + '</div>' : '';
    return '<div class="pocket-result ' + (won ? 'tcg-victory' : '') + '" role="status">' + confetti +
        '<small>DUEL TERMINÉ</small><h2>' +
        (g.winner === 'draw' ? 'ÉGALITÉ' : won ? '🏆 VICTOIRE !' : 'DÉFAITE') + '</h2><p>' +
        (won ? 'Tu remportes le duel !' : 'Recompose ton deck et prépare ta revanche.') + '</p></div>';
}
function render({ game:g, cards, isBusy, action }) {
    busy = isBusy;
    currentAction = action;
    const me = g.players[g.side], foe = g.players[1 - g.side];
    const backs = Array.from({ length: Math.min(foe.handCount, 8) },
        () => '<span class="pocket-cardback">✦</span>').join('');
    const el = $('tcg-battle');
    if (!el) return;
    el.innerHTML = '<div class="pocket-wrap">' + victory(g) + '<div class="pocket-board">' +
        '<div class="pocket-zone opponent"><div class="pocket-header"><b>⚔ ' + esc(foe.name) +
        '</b><strong>🏆 ' + foe.points + '/3</strong><small>Deck ' + foe.deckCount + '</small></div>' +
        '<div class="pocket-cardbacks" aria-label="' + foe.handCount + ' cartes adverses cachées">' + backs + '</div>' +
        '<div class="pocket-label">BANC ADVERSE</div>' + bench(foe,false,g,cards) +
        '<div class="pocket-label">COMBATTANT ADVERSE</div><div class="pocket-active">' +
        mini(foe.active,foe,false,false,-1,g,cards) + '</div></div>' +
        '<div class="pocket-center"><span>✦ ANIME DUEL ✦</span><b>TOUR ' + g.turn + '</b><small>' +
        (g.phase === 'setup' ? 'PLACEMENT' : g.active === g.side ? 'À TOI DE JOUER' : 'TOUR ADVERSE') + '</small></div>' +
        '<div class="pocket-zone player"><div class="pocket-label">TON COMBATTANT</div><div class="pocket-active">' +
        mini(me.active,me,true,false,-1,g,cards) + '</div><div class="pocket-label">TON BANC</div>' +
        bench(me,true,g,cards) + '<div class="pocket-header"><b>★ ' + esc(me.name) +
        '</b><strong>🏆 ' + me.points + '/3</strong><small>Deck ' + me.deckCount + '</small></div></div></div>' +
        '<div class="pocket-bottom">' + controls(me,foe,g,cards) + hand(me,g,cards) +
        '<details class="pocket-log"><summary>📜 Historique du duel</summary>' +
        [...g.log].reverse().map(s => '<p>' + esc(s) + '</p>').join('') + '</details>' +
        '<button class="pocket-leave" data-leave' + disabled(busy) + '>' +
        (g.winner === null ? 'Abandonner le duel' : 'Quitter le résultat') + '</button></div></div>';
}
document.addEventListener('click', event => {
    const button = event.target.closest('[data-pocket-action]');
    if (!button || busy || !currentAction) return;
    const type = button.dataset.pocketAction;
    if (type === 'play') currentAction({ type, card: Number(button.dataset.card) });
    else if (type === 'evolve') currentAction({
        type, card: Number(button.dataset.card), target: Number(button.dataset.target)
    });
    else if (type === 'energy') currentAction({ type, target: Number(button.dataset.uid) });
    else if (type === 'retreat' || type === 'promote') currentAction({ type, index: Number(button.dataset.index) });
    else if (type === 'attack') currentAction({ type, mode: button.dataset.mode });
    else if (type === 'ready' || type === 'end') currentAction({ type });
});
window.TCGPocket = { render };
})();
