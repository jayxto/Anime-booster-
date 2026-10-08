/* Integrated arena tab; every move is resolved by the authenticated server. */
(() => {
    'use strict';
    const $ = id => document.getElementById('tcg-' + id);
    const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    let cards = [], byId = {}, starter = [], deck = [], saved = [], room = null, me = null, busy = false, pending = null, timer, epoch = 0, polling = false;
    let loaded = false, loading = false, searchEpoch = 0, searchTimer, total = 0, offset = 0, more = false, accountKey = null, readyFor;
    const notify = (text, error = false) => { $('notice').textContent = text; $('notice').className = error ? 'error' : ''; };
    async function api(path, body) {
        const res = await fetch('/api/tcg' + path, { method: body === undefined ? 'GET' : 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
        const value = await res.json();
        if (!res.ok) { const error = new Error(value.error || 'Erreur serveur.'); error.status = res.status; throw error; }
        for (const c of [...(value.cards || []), ...(value.starterCards || [])]) byId[c.id] = c;
        return value;
    }
    function accept(next) {
        const changed = room?.code !== next?.code || room?.game?.revision !== next?.game?.revision || room?.closed !== next?.closed;
        room = next; if (changed) pending = null; return changed;
    }
    async function run(fn) {
        if (busy) return;
        busy = true; epoch++; render();
        try { await fn(); }
        catch (e) {
            notify(e.message || 'Connexion perdue. Réessaie.', true);
            // Recover authoritative state after a lost response or stale revision.
            try { const current = await api(''); accept(current.room); } catch (_) {}
        } finally { busy = false; render(); }
    }
    function validity() {
        if (deck.length !== 20) return `${deck.length}/20 cartes : complète ton deck.`;
        if (deck.filter(id => byId[id].kind === 'character').length < 12) return 'Ajoute au moins 12 personnages.';
        return null;
    }
    const disabled = condition => condition ? ' disabled' : '';
    function cardHtml(c, { actions = '', unit = null, selected = false, target = false } = {}) {
        const status = unit ? [unit.guard && 'Garde', unit.shield && `Bouclier ${unit.shield}`, unit.burn && `Brûlure ${unit.burn}`, (unit.freeze || unit.frozen) && 'Gel', unit.sleep && 'Arrivée', unit.used && 'Épuisé'].filter(Boolean).join(' · ') : c.passive === 'guard' ? 'Garde' : '';
        return `<article class="tcg-card ${c.kind} ${selected ? 'selected' : ''} ${target ? 'targetable' : ''}"><div class="portrait">${c.image ? `<img src="${esc(c.image)}" alt="" loading="lazy" referrerpolicy="no-referrer">` : ''}<span class="cost" title="Coût de mana">${c.cost}</span></div><div class="card-body"><p class="franchise">${esc(c.franchise)} · ${c.kind === 'assist' ? 'Assist' : 'Personnage'}</p><h3>${esc(unit?.token ? 'Clone de Naruto' : c.name)}</h3>${c.kind === 'character' ? `<div class="stats"><span title="Attaque">⚔ ${unit ? unit.attack : c.attack}</span><span title="Points de vie">♥ ${unit ? unit.hp + '/' + unit.maxHp : c.health}</span></div><p class="ability"><span class="${c.source === 'profile' ? 'profile' : 'signature'}">${c.source === 'profile' ? 'Profil : ' + esc(c.role) : 'Technique signature'}</span><br><b>${esc(c.skill.name)} · ${c.skill.cost} mana</b><br>${esc(c.skill.text)}</p>` : `<p class="ability">${esc(c.text)}</p>`}</div>${status ? `<div class="status">${esc(status)}</div>` : ''}${actions ? `<div class="card-actions">${actions}</div>` : ''}</article>`;
    }
    function builder() {
        const deckCards = [...new Set(deck)].map(id => byId[id]);
        const counts = Object.fromEntries([...cards, ...deckCards].map(c => [c.id, deck.filter(id => id === c.id).length]));
        const filtered = cards;
        $('catalog').innerHTML = filtered.length ? filtered.map(c => cardHtml(c, { actions: `<button data-remove="${c.id}" aria-label="Retirer ${esc(c.name)}"${disabled(busy || !counts[c.id])}>−</button><span>${counts[c.id]} / 2</span><button data-add="${c.id}" aria-label="Ajouter ${esc(c.name)}"${disabled(busy || counts[c.id] >= 2 || deck.length >= 20)}>+</button>` })).join('') : '<p class="empty">Aucune carte trouvée.</p>';
        $('deck-count').textContent = `${deck.length}/20`;
        $('deck-valid').textContent = validity() || `${deck.filter(id => byId[id].kind === 'character').length} personnages · Deck valide${JSON.stringify(deck) !== JSON.stringify(saved) ? ' · Non sauvegardé' : ' · Sauvegardé'}`;
        $('deck-list').innerHTML = deckCards.map(c => `<div class="deck-row"><b>${c.cost}</b><span>${esc(c.name)}</span><b>×${counts[c.id]}</b><button data-remove="${c.id}" aria-label="Retirer ${esc(c.name)}"${disabled(busy)}>−</button></div>`).join('');
        $('curve').innerHTML = [1, 2, 3, 4, 5].map(cost => { const n = deck.filter(id => byId[id].cost === cost).length; return `<div title="${n} cartes à ${cost} mana">${n}<i style="height:${n * 4}px"></i>${cost}◆</div>`; }).join('');
        $('save-deck').disabled = busy || !me || !!validity(); $('starter-deck').disabled = busy;
        $('catalog-count').textContent = `${total.toLocaleString('fr-FR')} cartes trouvées`;
        $('prev-cards').disabled = offset === 0; $('next-cards').disabled = !more;
        $('page-label').textContent = `Page ${Math.floor(offset / 36) + 1} / ${Math.max(1, Math.ceil(total / 36))}`;
    }
    function lobby() {
        if (room && !room.game && !room.closed) {
            $('lobby').innerHTML = `<div class="panel waiting"><p class="eyebrow">SALON MULTIJOUEUR</p><h2>Ton adversaire entre en scène…</h2><p>Partage ce code avec un autre joueur connecté.</p><strong class="room-code">${esc(room.code)}</strong><p class="muted">Ce salon attend un deuxième compte. La partie démarrera automatiquement à son arrivée.</p><button data-leave${disabled(busy)}>Fermer le salon</button></div>`; return;
        }
        if (room?.game && room.game.winner === null) { $('lobby').innerHTML = ''; return; }
        $('lobby').innerHTML = `<div class="lobby-grid"><article class="panel"><span class="symbol">✦</span><p class="eyebrow">APPRENDS TES COMBOS</p><h2>Défie le Sensei</h2><p>Un duel contre l’IA pour tester ton deck et maîtriser tes compétences.</p><button class="gold" data-create="solo"${disabled(busy || !me || !!validity())}>Jouer contre l’IA ↗</button></article><article class="panel"><span class="symbol">⚔</span><p class="eyebrow">LE VRAI DUEL</p><h2>Invite un rival</h2><p>Crée un salon privé et partage son code. Deux decks, une seule victoire.</p><button data-create="multi"${disabled(busy || !me || !!validity())}>Créer un salon</button></article><article class="panel"><span class="symbol">⟡</span><p class="eyebrow">TON ADVERSAIRE T’ATTEND</p><h2>Rejoins l’arène</h2><form id="tcg-join-form"><label for="tcg-room-input">Code du salon</label><input id="tcg-room-input" autocomplete="off" spellcheck="false" maxlength="12" minlength="12" pattern="[A-Fa-f0-9]{12}" placeholder="Ex. A12B34C56D78" required><button${disabled(busy || !me || !!validity())}>Rejoindre le duel</button></form></article></div>`;
    }
    function targetable(unit, side, g) {
        if (!pending) return false;
        if (pending.type === 'attack') return side !== g.side && (!g.players[side].board.some(u => u.guard) || unit.guard);
        const spec = pending.spec; return spec.target === 'ally' ? side === g.side : spec.target === 'enemy' && side !== g.side;
    }
    function board(side, g) {
        const player = g.players[side], own = side === g.side, turn = g.active === g.side && g.winner === null;
        return player.board.map(u => {
            const c = byId[u.card], ready = turn && !u.sleep && !u.used && !u.frozen;
            const target = targetable(u, side, g);
            let actions = '';
            if (target) actions = `<button data-target="${u.uid}"${disabled(busy)}>Cibler</button>`;
            else if (own && !pending) actions = `<button data-unit="${u.uid}" data-move="attack" title="Une attaque par tour en phase de combat"${disabled(busy || !ready || g.phase !== 'combat')}>Attaquer</button>${!u.token ? `<button data-unit="${u.uid}" data-move="skill" title="${esc(c.skill.name + ' : ' + c.skill.text)}"${disabled(busy || !ready || g.phase !== 'main' || player.mana < c.skill.cost)}>Compétence · ${c.skill.cost}◆</button>` : ''}`;
            return cardHtml(c, { unit: u, actions, target, selected: pending?.unit === u.uid });
        }).join('') + Array.from({ length: 5 - player.board.length }, () => '<div class="slot" aria-label="Emplacement vide">＋</div>').join('');
    }
    function hero(p, enemy, g) {
        const target = enemy && pending?.type === 'attack' && !p.board.some(u => u.guard);
        return `<div class="hero-row"><div class="hero"><div class="avatar">${enemy ? '敵' : '桜'}</div><div><strong>${esc(p.name)}</strong><small>${enemy ? 'Adversaire' : 'Ton équipe'} · ${p.deckCount} en pioche</small></div></div><div><span class="hp">♥ ${p.hp}/30</span><br><span class="mana">◆ ${p.mana}/${p.maxMana} mana</span></div>${target ? `<button data-target="hero"${disabled(busy)}>Cibler le héros</button>` : ''}</div>`;
    }
    function battle() {
        const g = room?.game;
        if (!g) { $('battle').innerHTML = ''; return; }
        const own = g.players[g.side], enemy = g.players[1 - g.side], turn = g.active === g.side && g.winner === null;
        const result = g.winner === null ? '' : `<div class="result" role="status"><p class="eyebrow">DUEL TERMINÉ</p><h2>${g.winner === 'draw' ? 'Égalité' : g.winner === g.side ? 'Victoire !' : 'Défaite'}</h2><span>Chaque duel apprend quelque chose. Ajuste ton deck et relance une partie.</span></div>`;
        $('battle').innerHTML = `${result}<div class="match-layout"><div class="table">${hero(enemy, true, g)}<div class="opponent-hand" aria-label="${enemy.handCount} cartes cachées">${Array.from({ length: enemy.handCount }, () => '<span class="card-back" aria-hidden="true">桜</span>').join('')}</div><div class="board">${board(1 - g.side, g)}</div><div class="divider"><span>TOUR ${g.turn} · ${room.mode === 'multi' ? 'DUEL EN LIGNE' : 'ENTRAÎNEMENT'}</span></div><div class="board">${board(g.side, g)}</div>${hero(own, false, g)}<div class="hand-label"><span>TA MAIN · ${own.handCount}/8</span><span>◆ Mana ${own.mana}/${own.maxMana}</span></div><div class="hand">${own.hand.map(h => { const c = byId[h.card]; return cardHtml(c, { selected: pending?.card === h.uid, actions: `<button data-play="${h.uid}"${disabled(busy || !turn || g.phase !== 'main' || own.mana < c.cost || c.kind === 'character' && own.board.length >= 5)}>${c.kind === 'character' ? 'Invoquer' : 'Jouer l’assist'} · ${c.cost}◆</button>` }); }).join('') || '<p class="empty">Ta main est vide. Pioche au prochain tour.</p>'}</div><details class="discards"><summary>Défausses publiques · toi ${own.discard.length} / rival ${enemy.discard.length}</summary><p>Toi : ${own.discard.map(id => esc(byId[id].name)).join(', ') || 'Aucune'}</p><p>Rival : ${enemy.discard.map(id => esc(byId[id].name)).join(', ') || 'Aucune'}</p></details></div><aside class="turn-panel panel"><div><p class="eyebrow">${room.mode === 'multi' ? 'SALON ' + esc(room.code) : 'FACE AU SENSEI'}</p><h2>${g.winner !== null ? 'Duel terminé' : turn ? 'À toi de jouer' : 'Tour adverse'}</h2><ul class="phase-list"><li>01 · Pioche & recharge automatiques</li><li class="${g.phase === 'main' ? 'current' : ''}">02 · Phase principale</li><li class="${g.phase === 'combat' ? 'current' : ''}">03 · Combat</li><li>04 · Fin & effets</li></ul><p class="hint">${pending ? 'Choisis une cible encadrée sur le plateau.' : turn ? 'Invoque, active une compétence ou prépare tes attaques.' : 'Le plateau s’actualise automatiquement.'}</p></div><div>${pending ? '<button data-cancel>Annuler la sélection</button>' : ''}<button class="gold" data-phase="combat"${disabled(busy || !turn || g.phase !== 'main')}>Passer au combat →</button><button data-phase="end"${disabled(busy || !turn)}>Terminer le tour</button><button data-leave class="danger"${disabled(busy)}>${g.winner === null ? 'Abandonner le duel' : 'Fermer le résultat'}</button><p class="muted" style="font-size:11px">Attaque ou compétence : une action par personnage et par tour.</p></div><div class="log" aria-label="Journal de combat"><p class="eyebrow">JOURNAL DU DUEL</p>${[...g.log].reverse().map(l => `<p>${esc(l)}</p>`).join('')}</div></aside></div>`;
    }
    function render() { builder(); lobby(); battle(); }
    async function saveDeck() { const issue = validity(); if (issue) throw new Error(issue); await api('/deck', { deck }); saved = [...deck]; }
    function move(action) {
        run(async () => { const result = await api('/action', { code: room.code, action: { ...action, revision: room.game.revision } }); accept(result.room); pending = null; notify('Action résolue.'); });
    }
    function choose(action, spec) {
        if (spec.target === 'ally' || spec.target === 'enemy' || action.type === 'attack') {
            pending = { ...action, spec }; battle(); notify('Choisis la cible de ton action.');
        } else move(action);
    }
    document.addEventListener('click', e => {
        const b = e.target.closest('button'); if (!b || !document.getElementById('tab-tcg').contains(b) || b.disabled || busy) return;
        if (b.dataset.add) { deck.push(b.dataset.add); builder(); lobby(); }
        if (b.dataset.remove) { const index = deck.indexOf(b.dataset.remove); if (index >= 0) deck.splice(index, 1); builder(); lobby(); }
        if (b.dataset.create) run(async () => { await saveDeck(); accept((await api('/create', { mode: b.dataset.create })).room); notify('Ta partie est prête.'); });
        if (b.hasAttribute('data-leave')) {
            if (room?.game?.winner === null && !window.confirm('Abandonner ce duel ? Ton adversaire remportera la partie.')) return;
            run(async () => { accept((await api('/leave', { code: room.code })).room); notify('Salon quitté.'); });
        }
        if (b.dataset.phase) { pending = null; move({ type: b.dataset.phase }); }
        if (b.hasAttribute('data-cancel')) { pending = null; battle(); notify('Sélection annulée.'); }
        if (b.dataset.play) {
            const h = room.game.players[room.game.side].hand.find(h => h.uid === +b.dataset.play), c = byId[h.card];
            choose({ type: 'play', card: h.uid }, c.kind === 'assist' ? c : { target: 'none' });
        }
        if (b.dataset.move) {
            const u = room.game.players[room.game.side].board.find(u => u.uid === +b.dataset.unit);
            choose({ type: b.dataset.move, unit: u.uid }, b.dataset.move === 'skill' ? byId[u.card].skill : { target: 'enemy' });
        }
        if (b.dataset.target && pending) { const { spec, ...action } = pending; move({ ...action, target: b.dataset.target === 'hero' ? 'hero' : +b.dataset.target }); }
    });
    document.addEventListener('submit', e => {
        if (e.target.id !== 'tcg-join-form') return; e.preventDefault(); const code = $('room-input').value;
        run(async () => { await saveDeck(); accept((await api('/join', { code })).room); notify('Duel rejoint.'); });
    });
    const panels = ['arena', 'builder', 'rules'], tabIds = ['arena-tab', 'deck-tab', 'rules-tab'];
    tabIds.forEach((id, i) => {
        $(id).addEventListener('click', () => { panels.forEach((p, n) => { $(p).hidden = i !== n; $(tabIds[n]).setAttribute('aria-selected', String(i === n)); $(tabIds[n]).tabIndex = i === n ? 0 : -1; }); });
        $(id).addEventListener('keydown', e => { if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') { e.preventDefault(); const next = (i + (e.key === 'ArrowRight' ? 1 : 2)) % 3; $(tabIds[next]).click(); $(tabIds[next]).focus(); } });
    });
    async function searchCatalog(nextOffset = 0) {
        const version = ++searchEpoch;
        try {
            const result = await api('/catalog?' + new URLSearchParams({ q: $('search').value, kind: $('kind').value, offset: String(nextOffset) }));
            if (version !== searchEpoch) return;
            cards = result.cards; total = result.total; offset = result.offset; more = result.more; builder();
        } catch (_) { notify('Recherche indisponible. Réessaie.', true); }
    }
    $('search').addEventListener('input', () => { clearTimeout(searchTimer); searchTimer = setTimeout(() => searchCatalog(), 250); });
    $('kind').addEventListener('change', () => searchCatalog());
    $('prev-cards').addEventListener('click', () => searchCatalog(Math.max(0, offset - 36)));
    $('next-cards').addEventListener('click', () => searchCatalog(offset + 36));
    $('login').addEventListener('click', () => document.getElementById('acc-login')?.click());
    $('starter-deck').addEventListener('click', () => { deck = [...starter]; builder(); lobby(); notify('Deck de départ chargé. Sauvegarde pour le conserver.'); });
    $('save-deck').addEventListener('click', () => run(async () => { await saveDeck(); notify('Deck sauvegardé.'); }));
    async function poll() {
        if (!me || busy || polling || document.hidden || !document.getElementById('tab-tcg').classList.contains('on')) return;
        polling = true; const startEpoch = epoch;
        try { const value = await api(''); if (busy || startEpoch !== epoch) return; if (value.pseudo !== me) { location.reload(); return; } if (accept(value.room)) { lobby(); battle(); } }
        catch (e) { notify(e.status === 401 ? 'Session expirée. Reconnecte-toi depuis les boosters.' : 'Connexion interrompue : nouvelle tentative automatique…', true); }
        finally { polling = false; }
    }
    async function boot() {
        if (loading) return; loading = true; const startEpoch = epoch;
        try {
            if (!loaded) {
                const catalog = await api('/catalog'); cards = catalog.cards; starter = catalog.starter; deck = [...starter];
                total = catalog.total; more = catalog.more; loaded = true;
            }
            try { const value = await api(''); if (startEpoch !== epoch) return; me = value.pseudo; deck = [...value.deck]; saved = [...deck]; accept(value.room); }
            catch (e) { if (e.status !== 401) throw e; me = null; deck = [...starter]; saved = []; accept(null); }
            if (startEpoch !== epoch) return;
            readyFor = me; $('guest').hidden = !!me; render(); clearInterval(timer); timer = setInterval(poll, 2500);
        } catch (e) { notify('Impossible de charger l’arène. Rouvre cet onglet pour réessayer.', true); }
        finally { loading = false; if (startEpoch !== epoch) boot(); }
    }
    document.addEventListener('visibilitychange', () => { if (!document.hidden) poll(); });
    window.addEventListener('pagehide', () => clearInterval(timer));
    window.AnimeTCG = {
        account(user) {
            const key = user?.pseudo || null;
            if (key !== accountKey) { epoch++; accountKey = key; me = key; pending = null; room = null; saved = []; deck = [...starter]; }
        },
        open(user) { this.account(user); if (loaded && readyFor === accountKey) { render(); poll(); } else boot(); }
    };
})();
