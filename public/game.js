/* Anime Boosters — ouverture de boosters (même système de packs qu'Anime Game) + classeur. */
(() => {
'use strict';

const RAR = ['commune', 'rare', 'epique', 'legendaire', 'mythique', 'secrete', 'divine', 'cosmique', 'eternelle', 'omega'];
const RAR_LABEL = { commune: 'Commune', rare: 'Rare', epique: 'Épique', legendaire: 'Légendaire', mythique: 'Mythique', secrete: 'Secrète', divine: 'Divine', cosmique: 'Cosmique', eternelle: 'Éternelle', omega: 'Oméga', saison: 'Saison', duo: 'Duo' };
const RANK = Object.fromEntries(RAR.map((r, i) => [r, i]));
RANK.saison = 5; RANK.duo = 5;
// raretés spéciales : versions à part des persos les plus iconiques (chance par carte)
const SPECIAL_TIERS = [
    { id: 'secrete', rate: 1 / 150, coins: 50 }, { id: 'divine', rate: 1 / 600, coins: 150 },
    { id: 'cosmique', rate: 1 / 2500, coins: 400 }, { id: 'eternelle', rate: 1 / 10000, coins: 1000 },
    { id: 'omega', rate: 1 / 50000, coins: 3000 }
];
const FINISHES = [ // de la plus rare à la plus courante
    { id: 'numbered', label: 'Numérotée', rate: 1 / 2000 }, { id: 'signed', label: 'Signée', rate: 1 / 1000 },
    { id: 'glitch', label: 'Glitch', rate: 1 / 500 }, { id: 'galaxy', label: 'Galaxie', rate: 1 / 400 },
    { id: 'manga', label: 'Manga', rate: 1 / 300 }, { id: 'fullart', label: 'Full Art', rate: 1 / 250 },
    { id: 'dark', label: 'Dark', rate: 1 / 200 }, { id: 'gold', label: 'Gold', rate: 1 / 150 },
    { id: 'glitter', label: 'Pailletée', rate: 1 / 40 }, { id: 'reverse', label: 'Reverse Holo', rate: 1 / 30 },
    { id: 'holo', label: 'Holographique', rate: 1 / 20 }
];
const FIN_IDX = Object.fromEntries(FINISHES.map((f, i) => [f.id, i]));
const GOD_PACK_RATE = 1 / 500, DUO_RATE = 1 / 300, SEASON_RATE = 1 / 150, SHINY_RATE = 1 / 10;
const FREE_EVERY = 2 * 3600e3;
const SEASON_EMO = { halloween: '🎃', noel: '🎄', valentin: '💘', ete: '🏖️' };
const INFINITE = { id: 'infinite', n: 5, price: 0, infinite: true, emo: '♾️', name: 'Pack Infini', art: 0 };

// art = rang de l'animé (par popularité) dont le perso n°1 illustre le pack
const PACKS = [
    { id: 'b3', n: 3, price: 150, emo: '🃏', name: 'Booster 3 cartes', desc: 'Le booster de base.', art: 1 },
    { id: 'b10', n: 10, price: 450, emo: '🎴', name: 'Booster 10 cartes', desc: '1 rare minimum.', art: 2 },
    { id: 'epique', n: 5, price: 700, emo: '💜', name: 'Booster Épique', desc: '5 cartes, 1 épique min., raretés spéciales x2.', type: 'epique', art: 3 },
    { id: 'mythique', n: 5, price: 1800, emo: '🌈', name: 'Booster Mythique', desc: '5 cartes, 1 légendaire min., raretés spéciales x4.', type: 'mythique', art: 4 },
    { id: 'duo', n: 4, price: 1200, emo: '🤝', name: 'Booster Duo', desc: '4 cartes dont 1 carte Duo garantie.', type: 'duo', art: 5 },
    { id: 'halloween', n: 5, price: 900, emo: '🎃', name: 'Booster Halloween', desc: '5 cartes, 1 carte Halloween garantie.', type: 'season', season: 'halloween', art: 6 },
    { id: 'noel', n: 5, price: 900, emo: '🎄', name: 'Booster Noël', desc: '5 cartes, 1 carte Noël garantie.', type: 'season', season: 'noel', art: 7 },
    { id: 'valentin', n: 5, price: 900, emo: '💘', name: 'Booster Saint-Valentin', desc: '5 cartes, 1 carte Valentin garantie.', type: 'season', season: 'valentin', art: 8 },
    { id: 'ete', n: 5, price: 900, emo: '🏖️', name: 'Booster Été', desc: '5 cartes, 1 carte Été garantie.', type: 'season', season: 'ete', art: 9 },
    { id: 'chance', n: 10, price: 10000, emo: '👑', name: 'Pack Chance', desc: '10 cartes, chance x10 sur tout.', type: 'chance', art: 10 }
];
const ANIME_PACK_PRICE = 400;

let D = null, S = null, lastPack = null, U = [], W = [], WSUM = 0, BY_POP = [];
const $ = s => document.querySelector(s);
const rnd = n => Math.floor(Math.random() * n);
const pick = a => a[rnd(a.length)];
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmt = n => n.toLocaleString('fr-FR');

/* ---------- sauvegarde ---------- */
const SAVE_KEY = 'anime-boosters-v2';
const fresh = () => ({ coins: 2000, cards: {}, opened: 0, pulled: 0, best: {}, lastFree: 0, lastDaily: '', streak: 0, god: 0, infinite: 0 });
function load() { try { S = Object.assign(fresh(), JSON.parse(localStorage.getItem(SAVE_KEY)) || {}); } catch (_) { S = fresh(); } }
let saveT = 0;
function save() { renderCoins(); clearTimeout(saveT); saveT = setTimeout(() => { try { localStorage.setItem(SAVE_KEY, JSON.stringify(S)); } catch (_) {} }, 200); }
window.addEventListener('beforeunload', () => { try { localStorage.setItem(SAVE_KEY, JSON.stringify(S)); } catch (_) {} });

/* ---------- données ---------- */
function prepare() {
    U = Object.keys(D.animes);
    for (const u of U) { const a = D.animes[u]; a.idx = new Map(a.cards.map((c, i) => [c[0], i])); }
    BY_POP = U.filter(u => u !== 'pokedex').sort((a, b) => D.animes[b].pop - D.animes[a].pop);
    // les animés populaires tombent plus souvent
    const med = D.animes[BY_POP[Math.floor(BY_POP.length / 4)]]?.pop || 1;
    W = U.map(u => Math.sqrt(D.animes[u].pop || med)); WSUM = W.reduce((s, x) => s + x, 0);
}
function pickAnime() { let r = Math.random() * WSUM; for (let i = 0; i < U.length; i++) { r -= W[i]; if (r <= 0) return U[i]; } return U[U.length - 1]; }
const imgUrl = p => !p ? null : /^https?:/.test(p) ? p : D.imgPrefix + p;
const imgOf = (u, n) => { const a = D.animes[u]; const i = a && a.idx.get(n); return i == null ? null : imgUrl(a.cards[i][2]); };
function seasonActive(id) {
    const s = D.seasons[id]; if (!s) return false;
    if (id === 'halloween') return new Date().getMonth() === 9;
    if (!s.from) return false;
    const d = new Date(), v = d.getMonth() * 100 + d.getDate(), a = s.from[0] * 100 + s.from[1], b = s.to[0] * 100 + s.to[1];
    return a <= b ? v >= a && v <= b : v >= a || v <= b;
}
const seasonChars = id => (D.seasons[id] && D.seasons[id].chars) || [];

/* ---------- tirage ---------- */
function rollFinish(luck) { for (const f of FINISHES) if (Math.random() < Math.min(0.5, f.rate * luck)) return f.id; return null; }
function award(c, luck) {
    c.finish = rollFinish(luck);
    const o = S.cards[c.key];
    c.isNew = !o;
    if (o) { o.n++; if (c.shiny) o.shiny++; if (c.finish && (!o.fin || FIN_IDX[c.finish] < FIN_IDX[o.fin])) o.fin = c.finish; }
    else S.cards[c.key] = { n: 1, shiny: c.shiny ? 1 : 0, fin: c.finish || null };
    c.coins = 0;
    if (!c.isNew) {
        const sp = SPECIAL_TIERS.find(t => t.id === c.rarity);
        c.coins = sp ? sp.coins : c.rarity === 'duo' ? 60 : c.rarity === 'saison' ? 50 : (c.shiny ? 10 : 2) * (c.rarity === 'mythique' ? 3 : 1);
        S.coins += c.coins;
    }
    S.pulled++;
    S.best[c.rarity] = (S.best[c.rarity] || 0) + 1;
    return c;
}
const baseCard = (u, i, shiny) => { const [n, r] = D.animes[u].cards[i]; return { key: u + '|' + n, u, name: n, anime: D.animes[u].name, rarity: r, shiny }; };
const specialCard = (u, n, tier, shiny) => ({ key: u + '|' + n + '|' + tier, u, name: n, anime: D.animes[u].name, rarity: tier, shiny });
const seasonCard = (id, u, n, shiny) => ({ key: 'saison:' + id + '|' + u + '|' + n, u, name: n, anime: D.animes[u].name, rarity: 'saison', season: id, shiny });
const duoOf = (d, shiny) => ({ key: 'duo|' + d.name, name: d.name, anime: D.animes[d.a[0]].name, rarity: 'duo', duo: [imgOf(...d.a), imgOf(...d.b)], shiny });
function randomOfRarity(rar) {
    const sp = SPECIAL_TIERS.some(x => x.id === rar);
    for (let t = 0; t < 60; t++) {
        const u = pickAnime(), a = D.animes[u];
        if (sp) { const l = a.specials[rar]; if (l && l.length) return specialCard(u, pick(l), rar, Math.random() < 0.3); continue; }
        const idx = []; a.cards.forEach((c, i) => { if (c[1] === rar) idx.push(i); });
        if (idx.length) return baseCard(u, pick(idx), Math.random() < 0.3);
    }
    return null;
}

function openPack(p) {
    const luck = p.type === 'chance' ? 10 : 1, n = p.n;
    // God Pack : que des cartes très rares
    if (n >= 3 && Math.random() < Math.min(0.2, GOD_PACK_RATE * luck)) {
        const out = [];
        for (let i = 0; i < n; i++) {
            const r = Math.random(), rar = r < 0.02 ? 'cosmique' : r < 0.06 ? 'divine' : r < 0.3 ? 'secrete' : r < 0.6 ? 'mythique' : 'legendaire';
            const c = randomOfRarity(rar); if (c) out.push(award(c, luck));
        }
        S.god++; out.god = true;
        return out;
    }
    const mult = (p.type === 'mythique' ? 4 : p.type === 'epique' ? 2 : 1) * luck;
    const minRank = p.type === 'mythique' ? 3 : p.type === 'epique' || p.anime ? 2 : n >= 10 ? 1 : 0;
    const act = Object.keys(D.seasons).filter(id => seasonActive(id) && seasonChars(id).length);
    const out = [];
    for (let i = 0; i < n; i++) {
        const u = p.anime || pickAnime(), a = D.animes[u], last = i === n - 1;
        if (last && p.type === 'duo' && D.duos.length && !out.some(c => c.rarity === 'duo')) { out.push(award(duoOf(pick(D.duos), Math.random() < SHINY_RATE), luck)); continue; }
        if (last && p.type === 'season' && !out.some(c => c.season === p.season) && seasonChars(p.season).length) {
            const [su, sn] = pick(seasonChars(p.season)); out.push(award(seasonCard(p.season, su, sn, Math.random() < 0.2), luck)); continue;
        }
        let special = null;
        for (const t of SPECIAL_TIERS.slice().reverse()) {
            if (Math.random() >= t.rate * mult) continue;
            let cu = u;
            if (!(a.specials[t.id] || []).length) {
                if (p.anime) continue;
                const cands = BY_POP.slice(0, t.id === 'omega' ? 3 : 10).filter(x => (D.animes[x].specials[t.id] || []).length);
                if (!cands.length) continue;
                cu = pick(cands);
            }
            special = specialCard(cu, pick(D.animes[cu].specials[t.id]), t.id, Math.random() < Math.min(0.9, luck / 10));
            break;
        }
        if (special) { out.push(award(special, luck)); continue; }
        if (!p.anime && D.duos.length && Math.random() < Math.min(0.3, DUO_RATE * luck)) { out.push(award(duoOf(pick(D.duos), Math.random() < SHINY_RATE), luck)); continue; }
        if (!p.anime && act.length && Math.random() < Math.min(0.3, SEASON_RATE * luck)) {
            const id = pick(act), [su, sn] = pick(seasonChars(id));
            out.push(award(seasonCard(id, su, sn, Math.random() < Math.min(0.9, luck / 10)), luck)); continue;
        }
        // les persos connus tombent plus souvent, les rares moins (la chance rapproche des cartes rares)
        const L = a.cards.length;
        let idx = Math.min(L - 1, Math.floor(Math.pow(Math.random(), 1.6 / Math.sqrt(luck)) * L));
        if (last && minRank && !out.some(c => (RANK[c.rarity] || 0) >= minRank)) {
            const ok = []; a.cards.forEach((c, j) => { if (RANK[c[1]] >= minRank) ok.push(j); });
            if (ok.length) idx = pick(ok);
        }
        out.push(award(baseCard(u, idx, Math.random() < Math.min(0.9, SHINY_RATE * luck)), luck));
    }
    return out;
}

/* ---------- rendu des cartes ---------- */
function cardHtml(c, opt = {}) {
    const ini = c.name.split(/\s+/).map(w => w[0]).join('').slice(0, 2).toUpperCase();
    const cls = ['card', 'r-' + c.rarity, c.shiny ? 'shiny' : '', c.finish ? 'f-' + c.finish : '', c.duo ? 'duo' : '', RANK[c.rarity] >= 4 && !opt.flat ? 'big-rar' : ''].join(' ');
    const im = u => u ? `<img class="im" src="${esc(u)}" alt="" loading="lazy" draggable="false">` : `<div class="im" style="display:grid;place-items:center;font-size:30px;font-weight:900">${esc(ini)}</div>`;
    const art = c.duo ? c.duo.map(im).join('') : im(imgOf(c.u, c.name));
    const lab = c.season ? (SEASON_EMO[c.season] || '') + ' ' + esc(D.seasons[c.season].label) : RAR_LABEL[c.rarity];
    const fin = c.finish ? FINISHES.find(f => f.id === c.finish).label : '';
    const badges = [opt.isNew ? '<span class="new">NOUVEAU</span>' : '', opt.count > 1 ? `<span>x${opt.count}</span>` : '', c.shiny ? '<span>✨ Brillante</span>' : '', fin ? `<span>${esc(fin)}</span>` : '', opt.coins ? `<span>+${opt.coins} 🪙</span>` : ''].join('');
    return `<div class="${cls}">${art}<span class="rr">${lab}</span><div class="bd">${badges}</div>
      <div class="info"><div class="nm">${esc(c.name)}</div><div class="an">${esc(c.anime || '')}</div></div></div>`;
}

/* ---------- ouverture ---------- */
let auto = false, autoT = 0, opened = null;
function startOpen(p) {
    if (p.price && S.coins < p.price) { stopAuto(); return toast('Pas assez de pièces !'); }
    if (p.price) S.coins -= p.price;
    S.opened++; if (p.infinite) S.infinite++;
    lastPack = p;
    const cards = openPack(p);
    save();
    const ov = $('#opening'), pk = $('#op-pack'), box = $('#op-cards');
    ov.classList.add('on');
    $('#op-god').classList.remove('on');
    $('.op-bar').classList.remove('on');
    $('#op-count').textContent = p.infinite ? `♾️ Pack infini n°${fmt(S.infinite)}` : '';
    box.innerHTML = '';
    pk.style.display = '';
    pk.classList.remove('tear');
    $('#op-art').style.backgroundImage = packArt(p) ? `url('${packArt(p)}')` : '';
    $('#op-name').textContent = p.name;
    opened = { cards, revealed: false };
    pk.onclick = () => reveal();
    if (auto) autoT = setTimeout(reveal, 350);
}
function reveal() {
    if (!opened || opened.revealed) return;
    opened.revealed = true;
    const cards = opened.cards, pk = $('#op-pack'), box = $('#op-cards');
    pk.onclick = null;
    pk.classList.add('tear');
    setTimeout(() => {
        pk.style.display = 'none';
        if (cards.god) $('#op-god').classList.add('on');
        // les cartes les plus rares sont révélées en dernier
        const order = cards.map((c, i) => i).sort((a, b) => (RANK[cards[a].rarity] || 0) - (RANK[cards[b].rarity] || 0));
        box.innerHTML = order.map((i, k) => { const c = cards[i]; return `<div class="slot" style="animation-delay:${k * 60}ms"><div class="in">
          <div class="back ${RANK[c.rarity] >= 3 ? 'glow r-' + c.rarity : ''}">🎴</div>${cardHtml(c, { isNew: c.isNew, coins: c.coins })}</div></div>`; }).join('');
        box.querySelectorAll('.slot').forEach(s => s.onclick = () => { if (s.classList.contains('up')) zoom(s.querySelector('.card').outerHTML); else s.classList.add('up'); });
        $('.op-bar').classList.add('on');
        $('#op-again').disabled = !!lastPack.free || S.coins < (lastPack.price || 0);
        const top = cards.reduce((m, c) => Math.max(m, RANK[c.rarity] || 0), 0);
        if (top >= 5) { toast('🔥 Carte ' + RAR_LABEL[cards.find(c => RANK[c.rarity] === top).rarity] + ' !'); if (auto && top >= 6) stopAuto(); }
        if (auto) { flipAll(); autoT = setTimeout(() => auto && startOpen(lastPack), 1900); }
    }, 450);
}
function flipAll() { $('#op-cards').querySelectorAll('.slot:not(.up)').forEach((s, i) => setTimeout(() => s.classList.add('up'), i * 110)); }
function next() { if (!lastPack || lastPack.free) return; if (opened && !opened.revealed) return reveal(); startOpen(lastPack); }
function stopAuto() { auto = false; clearTimeout(autoT); $('#op-auto').classList.remove('on'); $('#op-auto').textContent = '▶ Auto'; }
function closeOpen() { stopAuto(); $('#opening').classList.remove('on'); renderShop(); }
$('#op-flip').onclick = flipAll;
$('#op-close').onclick = closeOpen;
$('#op-again').onclick = next;
$('#op-auto').onclick = () => {
    if (auto) return stopAuto();
    if (!lastPack || lastPack.free) return toast('Le mode auto marche avec les packs payants et le Pack Infini.');
    auto = true; $('#op-auto').classList.add('on'); $('#op-auto').textContent = '⏸ Stop';
    next();
};
function zoom(html) { const z = $('#zoom'); z.innerHTML = html; z.classList.add('on'); }
$('#zoom').onclick = () => $('#zoom').classList.remove('on');
document.addEventListener('keydown', e => {
    if ($('#zoom').classList.contains('on')) { if (e.key === 'Escape') $('#zoom').classList.remove('on'); return; }
    if ($('#book').classList.contains('on')) {
        if (e.key === 'ArrowRight') flip && flip.flipNext();
        if (e.key === 'ArrowLeft') flip && flip.flipPrev();
        if (e.key === 'Escape') closeBook();
        return;
    }
    if ($('#opening').classList.contains('on')) {
        if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); next(); }
        if (e.key === 'Escape') closeOpen();
    }
});

/* ---------- boutique ---------- */
function packArt(p) {
    const u = p.anime || BY_POP[(p.art || 0) % BY_POP.length];
    const a = D.animes[u];
    return a ? imgUrl(a.cards[0][2]) : null;
}
function packHtml(p, off, tag) {
    const im = packArt(p);
    return `<div class="pack ${off ? 'off' : ''}" data-id="${esc(p.id)}">${tag ? `<span class="pk-tag">${tag}</span>` : ''}
      ${im ? `<img class="pk-art" src="${esc(im)}" alt="" loading="lazy">` : ''}
      <div class="pk-emo">${p.emo}</div><div class="pk-n">${esc(p.name)}</div><div class="pk-d">${esc(p.desc)}</div><div class="pk-p">${p.price ? fmt(p.price) + ' 🪙' : 'Gratuit'}</div></div>`;
}
function renderShop() {
    const list = PACKS.filter(p => p.type !== 'season' || seasonActive(p.season));
    $('#packs').innerHTML = list.map(p => packHtml(p, S.coins < p.price, p.type === 'season' ? 'ÉVÉNEMENT' : '')).join('');
    $('#packs').querySelectorAll('.pack').forEach(el => el.onclick = () => startOpen(PACKS.find(x => x.id === el.dataset.id)));
    renderAnimePacks();
    renderFree();
}
let animeShown = 48;
const animePack = u => ({ id: 'anime:' + u, anime: u, n: 5, price: ANIME_PACK_PRICE, emo: '📦', name: D.animes[u].name, desc: `${D.animes[u].cards.length} persos · 1 épique min.` });
const animeMatches = q => { q = q.trim().toLowerCase(); return [...BY_POP, 'pokedex'].filter(u => D.animes[u] && (!q || D.animes[u].name.toLowerCase().includes(q))); };
function renderAnimePacks() {
    const us = animeMatches($('#anime-search').value);
    $('#anime-count').textContent = `${fmt(U.length)} animés · 5 cartes d'un seul animé`;
    $('#anime-packs').innerHTML = us.slice(0, animeShown).map(u => packHtml(animePack(u), S.coins < ANIME_PACK_PRICE)).join('');
    $('#anime-more').style.display = us.length > animeShown ? '' : 'none';
    $('#anime-packs').querySelectorAll('.pack').forEach(el => el.onclick = () => startOpen(animePack(el.dataset.id.slice(6))));
}
$('#anime-search').oninput = () => { animeShown = 48; renderAnimePacks(); };
$('#anime-more').onclick = () => { animeShown += 96; renderAnimePacks(); };
$('#infinite').onclick = () => startOpen(INFINITE);

function renderFree() {
    const left = S.lastFree + FREE_EVERY - Date.now();
    $('#free-btn').disabled = left > 0;
    $('#free-txt').textContent = left > 0 ? `Dans ${Math.floor(left / 3600e3)} h ${String(Math.floor(left / 60e3) % 60).padStart(2, '0')} min · 10 cartes` : '10 cartes t’attendent !';
    const today = new Date().toDateString();
    $('#daily-btn').disabled = S.lastDaily === today;
    $('#daily-txt').textContent = S.lastDaily === today ? `Reviens demain ! Série : ${S.streak} j` : `+${dailyAmount()} 🪙 (série : ${S.streak} j)`;
}
const dailyAmount = () => 500 + Math.min(S.streak, 10) * 100;
$('#free-btn').onclick = () => {
    if (S.lastFree + FREE_EVERY > Date.now()) return;
    S.lastFree = Date.now();
    startOpen({ id: 'free', n: 10, price: 0, free: true, name: 'Booster gratuit', art: 0 });
};
$('#daily-btn').onclick = () => {
    const today = new Date().toDateString(), yest = new Date(Date.now() - 864e5).toDateString();
    if (S.lastDaily === today) return;
    S.streak = S.lastDaily === yest ? S.streak + 1 : 1;
    const g = dailyAmount();
    S.coins += g; S.lastDaily = today; save(); renderShop();
    toast(`+${g} 🪙 !`);
};

/* ---------- classeurs ---------- */
const SPECIAL_BINDERS = {
    _special: { name: '⭐ Raretés spéciales', cards: () => BY_POP.slice(0, 200).flatMap(x => SPECIAL_TIERS.flatMap(t => (D.animes[x].specials[t.id] || []).map(n => specialCard(x, n, t.id)))) },
    _saison: { name: '🎃 Cartes de saison', cards: () => Object.keys(D.seasons).flatMap(id => seasonChars(id).map(([su, n]) => seasonCard(id, su, n))) },
    _duo: { name: '🤝 Cartes Duo', cards: () => D.duos.map(d => duoOf(d)) }
};
function binderCards(u) { return SPECIAL_BINDERS[u] ? SPECIAL_BINDERS[u].cards() : D.animes[u].cards.map((c, i) => baseCard(u, i)); }
function ownedIn(u) {
    if (SPECIAL_BINDERS[u]) return binderCards(u).filter(c => S.cards[c.key]).length;
    let n = 0; for (const c of D.animes[u].cards) if (S.cards[u + '|' + c[0]]) n++; return n;
}
let libShown = 60;
function renderLibrary() {
    const q = $('#lib-search').value.trim().toLowerCase(), sort = $('#lib-sort').value;
    let us = U.filter(u => !q || D.animes[u].name.toLowerCase().includes(q)).map(u => ({ u, own: ownedIn(u), tot: D.animes[u].cards.length, pop: D.animes[u].pop }));
    if (sort === 'owned') us.sort((a, b) => b.own / b.tot - a.own / a.tot || b.own - a.own || b.pop - a.pop);
    else if (sort === 'pop') us.sort((a, b) => b.pop - a.pop);
    else us.sort((a, b) => D.animes[a.u].name.localeCompare(D.animes[b.u].name));
    const sp = q ? [] : Object.keys(SPECIAL_BINDERS).map(u => ({ u, own: ownedIn(u), tot: binderCards(u).length, special: true }));
    const all = [...sp, ...us];
    const totalOwn = Object.keys(S.cards).length, totalAll = U.reduce((s, u) => s + D.animes[u].cards.length, 0);
    $('#lib-prog').textContent = `${fmt(totalOwn)} cartes différentes · ${fmt(totalAll)} persos dans ${fmt(U.length)} classeurs`;
    $('#library').innerHTML = all.slice(0, libShown).map(b => {
        const a = D.animes[b.u], name = b.special ? SPECIAL_BINDERS[b.u].name : a.name;
        const cover = b.special ? null : (a.cover || imgUrl(a.cards[0][2]));
        const col = !b.special && a.color ? `--bc:linear-gradient(160deg, ${a.color}, #1a1230)` : '';
        return `<div class="binder-cv ${b.special ? 'special' : ''}" data-u="${esc(b.u)}" style="${col}">${cover ? `<img src="${esc(cover)}" alt="" loading="lazy">` : ''}
          <span class="bn">${b.own}/${b.tot}</span><div class="bt">${esc(name)}</div><div class="bp"><i style="width:${Math.round(b.own / Math.max(1, b.tot) * 100)}%"></i></div></div>`;
    }).join('');
    $('#lib-more').style.display = all.length > libShown ? '' : 'none';
    $('#library').querySelectorAll('.binder-cv').forEach(el => el.onclick = () => openBook(el.dataset.u));
}
$('#lib-search').oninput = () => { libShown = 60; renderLibrary(); };
$('#lib-sort').onchange = renderLibrary;
$('#lib-more').onclick = () => { libShown += 120; renderLibrary(); };

let flip = null;
function openBook(u) {
    const cards = binderCards(u), sp = SPECIAL_BINDERS[u], a = D.animes[u];
    const name = sp ? sp.name : a.name, own = cards.filter(c => S.cards[c.key]).length;
    const color = !sp && a.color ? a.color : sp ? '#1d4b6b' : '#5a1d2a';
    const cover = sp ? null : (a.cover || imgUrl(a.cards[0][2]));
    $('#book-title').textContent = name;
    $('#book-prog').textContent = `${own} / ${cards.length}`;
    const per = 9, inner = Math.max(2, Math.ceil(cards.length / per));
    const pages = [];
    pages.push(`<div class="bpage bcover" data-density="hard"><div class="cv" style="--bc:${esc(color)}">${cover ? `<img src="${esc(cover)}" alt="">` : '<div style="font-size:70px">🎴</div>'}<h1>${esc(name)}</h1><p>${own} / ${cards.length} cartes</p></div></div>`);
    for (let p = 0; p < inner + (inner % 2); p++) {
        const slice = cards.slice(p * per, p * per + per);
        const pockets = Array.from({ length: per }, (_, k) => {
            const c = slice[k];
            if (!c) return '<div class="pocket empty"></div>';
            const o = S.cards[c.key], num = p * per + k + 1;
            if (!o) {
                const sil = c.duo ? null : imgOf(c.u, c.name);
                return `<div class="pocket empty" title="n°${num}">${sil ? `<img class="sil" src="${esc(sil)}" alt="" loading="lazy" draggable="false">` : ''}<b>${num}</b></div>`;
            }
            const cc = { ...c, shiny: o.shiny > 0, finish: o.fin };
            return `<div class="pocket" data-i="${p * per + k}">${cardHtml(cc, { flat: true })}${o.n > 1 ? `<span class="cnt">x${o.n}</span>` : ''}</div>`;
        }).join('');
        pages.push(`<div class="bpage ${p % 2 ? 'odd' : 'even'}"><div class="pg">${pockets}</div><div class="num">${p + 1}</div></div>`);
    }
    pages.push(`<div class="bpage bcover back" data-density="hard"><div class="cv" style="--bc:${esc(color)}"></div></div>`);

    const stage = $('#book-stage');
    if (flip) { try { flip.destroy(); } catch (_) {} flip = null; }
    stage.innerHTML = '<div id="book-el"></div>';
    const el = $('#book-el');
    el.innerHTML = pages.join('');
    $('#book').classList.add('on');
    const h = stage.clientHeight - 12, w = stage.clientWidth;
    const portrait = w < 700;
    const pw = Math.floor(Math.min(portrait ? w - 8 : (w - 8) / 2, h / 1.38));
    flip = new St.PageFlip(el, { width: pw, height: Math.floor(pw * 1.38), size: 'fixed', showCover: true, usePortrait: portrait, maxShadowOpacity: 0.6, flippingTime: 750, mobileScrollSupport: false, drawShadow: true });
    flip.loadFromHTML(el.querySelectorAll('.bpage'));
    const upd = () => { const i = flip.getCurrentPageIndex(), n = flip.getPageCount(); $('#book-page').textContent = i === 0 ? 'Couverture' : i >= n - 1 ? 'Fin' : `Page ${i} / ${n - 2}`; };
    flip.on('flip', upd); upd();
    el.querySelectorAll('.pocket[data-i]').forEach(pk => {
        let down = null;
        pk.addEventListener('pointerdown', e => { down = [e.clientX, e.clientY]; });
        pk.addEventListener('pointerup', e => { if (down && Math.hypot(e.clientX - down[0], e.clientY - down[1]) < 6) zoom(pk.querySelector('.card').outerHTML); down = null; });
    });
}
function closeBook() { $('#book').classList.remove('on'); if (flip) { try { flip.destroy(); } catch (_) {} flip = null; } renderLibrary(); }
$('#book-close').onclick = closeBook;
$('#book-prev').onclick = () => flip && flip.flipPrev();
$('#book-next').onclick = () => flip && flip.flipNext();
$('#book-first').onclick = () => flip && flip.flip(0);
$('#book-last').onclick = () => flip && flip.flip(flip.getPageCount() - 1);

/* ---------- stats ---------- */
function renderStats() {
    const total = U.reduce((s, u) => s + D.animes[u].cards.length, 0);
    const done = U.filter(u => D.animes[u].cards.every(c => S.cards[u + '|' + c[0]])).length;
    const box = (l, v) => `<div>${l}<b>${v}</b></div>`;
    $('#stats').innerHTML = `<div class="st">${box('Packs ouverts', fmt(S.opened))}${box('Packs infinis', fmt(S.infinite))}${box('Cartes tirées', fmt(S.pulled))}${box('Cartes différentes', fmt(Object.keys(S.cards).length))}
      ${box('Persos au total', fmt(total))}${box('Animés', fmt(U.length))}${box('Classeurs complets', done)}${box('God Packs', S.god)}${box('Brillantes', Object.values(S.cards).filter(o => o.shiny).length)}</div>
      <h2 class="sec">Tes tirages par rareté</h2><div class="st">${[...RAR, 'saison', 'duo'].map(r => box(`<span style="color:var(--${r})">${RAR_LABEL[r]}</span>`, fmt(S.best[r] || 0))).join('')}</div>`;
    const pct = r => (r * 100 < 0.01 ? (r * 100).toFixed(4) : (r * 100).toFixed(2)) + ' %';
    $('#rates').innerHTML = `<table>${SPECIAL_TIERS.map(t => `<tr><td style="color:var(--${t.id})">${RAR_LABEL[t.id]}</td><td>${pct(t.rate)} par carte</td></tr>`).join('')}
      <tr><td>✨ God Pack</td><td>${pct(GOD_PACK_RATE)} par pack</td></tr><tr><td style="color:var(--duo)">Duo</td><td>${pct(DUO_RATE)} par carte</td></tr>
      <tr><td style="color:var(--saison)">Saison (pendant l'événement)</td><td>${pct(SEASON_RATE)} par carte</td></tr><tr><td>Brillante</td><td>${pct(SHINY_RATE)} par carte</td></tr>
      ${FINISHES.map(f => `<tr><td>Finition ${f.label}</td><td>${pct(f.rate)}</td></tr>`).join('')}</table>`;
}
$('#reset').onclick = () => { if (confirm('Tout effacer et recommencer ?')) { S = fresh(); save(); renderShop(); toast('Partie réinitialisée.'); } };

/* ---------- divers ---------- */
let toastT = 0;
function toast(t) { const el = $('#toast'); el.textContent = t; el.classList.add('on'); clearTimeout(toastT); toastT = setTimeout(() => el.classList.remove('on'), 2600); }
function renderCoins() { $('#coins').textContent = fmt(S.coins); }
document.querySelectorAll('nav button').forEach(b => b.onclick = () => {
    document.querySelectorAll('nav button').forEach(x => x.classList.toggle('on', x === b));
    document.querySelectorAll('.tab').forEach(t => t.classList.toggle('on', t.id === 'tab-' + b.dataset.tab));
    if (b.dataset.tab === 'binder') renderLibrary();
    if (b.dataset.tab === 'stats') renderStats();
    if (b.dataset.tab === 'shop') renderShop();
});
setInterval(renderFree, 30e3);

load();
fetch('cards.json').then(r => r.json()).then(d => { D = d; prepare(); renderCoins(); renderShop(); })
    .catch(() => { $('#packs').textContent = 'Impossible de charger les cartes.'; });
})();
