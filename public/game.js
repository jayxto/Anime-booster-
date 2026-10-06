/* Anime Boosters — interface : boutique, ouverture, classeur, compte et admin.
   Les packs sont tirés par engine.js : dans le navigateur pour les invités, sur le serveur pour les comptes. */
(() => {
'use strict';

const { RAR, RAR_LABEL, RANK, SPECIAL_TIERS, FINISHES, GOD_PACK_RATE, DUO_RATE, SEASON_RATE, SHINY_RATE, SEASON_EMO, INFINITE, FREE_PACK, PACKS, ANIME_PACK_PRICE } = Engine;
let D = null, G = null, S = null, ME = null, SERVER = false, lastPack = null, U = [], BY_POP = [];
const $ = s => document.querySelector(s);
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmt = n => Number(n || 0).toLocaleString('fr-FR');
const imgUrl = p => G.imgUrl(p), imgOf = (u, n) => G.imgOf(u, n);
const seasonActive = id => G.seasonActive(id), seasonChars = id => G.seasonChars(id);
const baseCard = (...a) => G.baseCard(...a), specialCard = (...a) => G.specialCard(...a), seasonCard = (...a) => G.seasonCard(...a), duoOf = (...a) => G.duoOf(...a);

/* ---------- sauvegarde invité (navigateur) ---------- */
const SAVE_KEY = 'anime-boosters-v2';
function guestState() { try { return Object.assign(Engine.fresh(), JSON.parse(localStorage.getItem(SAVE_KEY)) || {}); } catch (_) { return Engine.fresh(); } }
let saveT = 0;
const writeGuest = () => { if (!ME) try { localStorage.setItem(SAVE_KEY, JSON.stringify(S)); } catch (_) {} };
function save() { renderCoins(); if (!ME) { clearTimeout(saveT); saveT = setTimeout(writeGuest, 200); } }
window.addEventListener('beforeunload', writeGuest);
let MUTED = false;
try { MUTED = localStorage.getItem('ab-muted') === '1'; } catch (_) {}

/* ---------- serveur ---------- */
async function api(method, url, body) {
    const r = await fetch(url, { method, headers: body ? { 'Content-Type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined, credentials: 'same-origin' });
    let j = {};
    try { j = await r.json(); } catch (_) { j = { error: 'Le serveur ne répond pas.' }; }
    if (!r.ok && !j.error) j.error = 'Erreur ' + r.status;
    return j;
}
function applyPatch(p) {
    if (!p) return;
    for (const k of Object.keys(p)) if (k !== 'entries') S[k] = p[k];
    for (const [k, v] of Object.entries(p.entries || {})) S.cards[k] = v;
}
// les actions passent par le serveur pour un compte, par le moteur local pour un invité
async function doBuy(id) {
    if (!ME) { const r = G.buy(S, id); if (r.ok) save(); return r; }
    const j = await api('POST', '/api/open', { id });
    if (j.error) return { ok: false, error: j.error };
    applyPatch(j.patch); renderCoins();
    return { ok: true, cards: j.cards, god: j.god };
}
async function doDaily() {
    if (!ME) { const r = G.claimDaily(S); if (r.ok) save(); return r; }
    const j = await api('POST', '/api/daily');
    if (j.error) return { ok: false, error: j.error };
    applyPatch(j.patch); renderCoins();
    return { ok: true, amount: j.amount };
}
async function doSell() {
    if (!ME) { const r = G.sellDupes(S); save(); return r; }
    const j = await api('POST', '/api/sell');
    if (j.error) return { ok: false, error: j.error };
    S = Object.assign(Engine.fresh(), j.state); renderCoins();
    return { ok: true, n: j.n, total: j.total };
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
let auto = false, autoT = 0, opened = null, busy = false, wantReveal = false;
async function startOpen(p) {
    if (busy) return;
    if (p.price && S.coins < p.price) { stopAuto(); return toast('Pas assez de pièces !'); }
    busy = true;
    // le pack s'affiche tout de suite ; pour un compte, les cartes arrivent du serveur juste après
    const ov = $('#opening'), pk = $('#op-pack'), box = $('#op-cards');
    ov.classList.add('on');
    $('#op-god').classList.remove('on');
    $('.op-bar').classList.remove('on');
    $('#op-count').textContent = '';
    box.innerHTML = '';
    pk.style.display = '';
    pk.classList.remove('tear');
    $('#op-art').style.backgroundImage = packArt(p) ? `url('${packArt(p)}')` : '';
    $('#op-name').textContent = p.name;
    opened = null; wantReveal = false;
    pk.onclick = () => { if (opened) reveal(); else wantReveal = true; };
    let r;
    try { r = await doBuy(p.id); } catch (_) { r = { ok: false, error: 'Connexion perdue.' }; }
    busy = false;
    if (!r.ok) { closeOpen(); renderFree(); return toast(r.error); }
    lastPack = p;
    $('#op-count').textContent = p.infinite ? `♾️ Pack infini n°${fmt(S.infinite)}` : '';
    opened = { cards: r.cards, god: r.god, revealed: false };
    if (wantReveal) reveal();
    else if (auto) autoT = setTimeout(reveal, 350);
}
function reveal() {
    if (!opened || opened.revealed) return;
    opened.revealed = true;
    const cards = opened.cards, pk = $('#op-pack'), box = $('#op-cards');
    pk.onclick = null;
    pk.classList.add('tear');
    sfx('rip');
    setTimeout(() => {
        pk.style.display = 'none';
        if (opened.god) $('#op-god').classList.add('on');
        // les cartes les plus rares sont révélées en dernier
        const order = cards.map((c, i) => i).sort((a, b) => (RANK[cards[a].rarity] || 0) - (RANK[cards[b].rarity] || 0));
        box.innerHTML = order.map((i, k) => { const c = cards[i]; return `<div class="slot" style="animation-delay:${k * 60}ms"><div class="in">
          <div class="back ${RANK[c.rarity] >= 3 ? 'glow r-' + c.rarity : ''}">🎴</div>${cardHtml(c, { isNew: c.isNew, coins: c.coins })}</div></div>`; }).join('');
        box.querySelectorAll('.slot').forEach(s => s.onclick = () => { if (s.classList.contains('up')) zoom(s.querySelector('.card').outerHTML); else turn(s); });
        $('.op-bar').classList.add('on');
        $('#op-again').disabled = !!lastPack.free || S.coins < (lastPack.price || 0);
        const top = cards.reduce((m, c) => Math.max(m, RANK[c.rarity] || 0), 0);
        if (top >= 5) { toast('🔥 Carte ' + RAR_LABEL[cards.find(c => RANK[c.rarity] === top).rarity] + ' !'); if (auto && top >= 6) stopAuto(); }
        if (auto) { flipAll(); autoT = setTimeout(() => auto && startOpen(lastPack), 1900); }
    }, 450);
}
// retourner une carte : petit son si elle est très rare
function turn(s) {
    if (s.classList.contains('up')) return;
    s.classList.add('up');
    const r = RANK[(s.querySelector('.card').className.match(/\br-(\w+)/) || [])[1]] || 0;
    if (r >= 5) sfx('epic'); else if (r >= 3) sfx('rare');
}
function flipAll() { $('#op-cards').querySelectorAll('.slot:not(.up)').forEach((s, i) => setTimeout(() => turn(s), i * 110)); }
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
    if (e.target.matches && e.target.matches('input, select, textarea')) return;
    if ($('#zoom').classList.contains('on')) { if (e.key === 'Escape') $('#zoom').classList.remove('on'); return; }
    if ($('#auth').classList.contains('on')) { if (e.key === 'Escape') closeAuth(); return; }
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
const animeMatches = q => { q = q.trim().toLowerCase(); return [...BY_POP, 'pokedex'].filter(u => D.animes[u] && (!q || D.animes[u].name.toLowerCase().includes(q))); };
function renderAnimePacks() {
    const us = animeMatches($('#anime-search').value);
    $('#anime-count').textContent = `${fmt(U.length)} animés · 5 cartes d'un seul animé`;
    $('#anime-packs').innerHTML = us.slice(0, animeShown).map(u => packHtml(G.animePack(u), S.coins < ANIME_PACK_PRICE)).join('');
    $('#anime-more').style.display = us.length > animeShown ? '' : 'none';
    $('#anime-packs').querySelectorAll('.pack').forEach(el => el.onclick = () => startOpen(G.animePack(el.dataset.id.slice(6))));
}
$('#anime-search').oninput = () => { animeShown = 48; renderAnimePacks(); };
$('#anime-more').onclick = () => { animeShown += 96; renderAnimePacks(); };
$('#infinite').onclick = () => startOpen(INFINITE);

function renderFree() {
    if (!S) return;
    const left = G.freeLeft(S);
    $('#free-btn').disabled = left > 0;
    $('#free-txt').textContent = left > 0 ? `Dans ${Math.floor(left / 3600e3)} h ${String(Math.floor(left / 60e3) % 60).padStart(2, '0')} min · 10 cartes` : '10 cartes t’attendent !';
    const done = S.lastDaily === Engine.dayKey(Date.now());
    $('#daily-btn').disabled = done;
    $('#daily-txt').textContent = done ? `Reviens demain ! Série : ${S.streak} j` : `+${fmt(G.dailyAmount(S))} 🪙 (série : ${S.streak || 0} j)`;
}
$('#free-btn').onclick = () => startOpen(FREE_PACK);
$('#daily-btn').onclick = async () => {
    const r = await doDaily();
    if (!r.ok) return toast(r.error);
    renderShop(); toast(`+${fmt(r.amount)} 🪙 !`);
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
        const art = cover ? `<img src="${esc(cover)}" alt="" loading="lazy">` : `<div class="col">${specialArt(b.u).map(s => `<img src="${esc(s)}" alt="" loading="lazy">`).join('')}</div>`;
        return `<div class="binder-cv ${b.special ? 'special' : ''}" data-u="${esc(b.u)}" style="${col}">${art}
          <span class="bn">${b.own}/${b.tot}</span><div class="bt">${esc(name)}</div><div class="bp"><i style="width:${Math.round(b.own / Math.max(1, b.tot) * 100)}%"></i></div></div>`;
    }).join('');
    $('#lib-more').style.display = all.length > libShown ? '' : 'none';
    $('#library').querySelectorAll('.binder-cv').forEach(el => el.onclick = () => openBook(el.dataset.u));
}
$('#lib-search').oninput = () => { libShown = 60; renderLibrary(); };
$('#lib-sort').onchange = renderLibrary;
$('#lib-more').onclick = () => { libShown += 120; renderLibrary(); };
$('#sell-dupes').onclick = async () => {
    const r = await doSell();
    if (!r.ok) return toast(r.error);
    if (!r.n) return toast('Aucun doublon à vendre.');
    renderLibrary(); toast(`${fmt(r.n)} doublons vendus : +${fmt(r.total)} 🪙`);
};

let flip = null, bookU = null;
const RINGS = '<div class="rings"><i></i><i></i><i></i></div>';
function openBook(u, startPage) {
    const cards = binderCards(u), sp = SPECIAL_BINDERS[u], a = D.animes[u];
    const name = sp ? sp.name : a.name, own = cards.filter(c => S.cards[c.key]).length;
    const color = !sp && a.color ? a.color : sp ? '#1d6b8a' : '#7a2236';
    const cover = sp ? null : (a.cover || imgUrl(a.cards[0][2]));
    bookU = u;
    $('#book-title').textContent = name;
    $('#book-prog').textContent = `${own} / ${cards.length}`;
    const per = 9, inner = Math.max(2, Math.ceil(cards.length / per));
    const pages = [];
    const coverArt = cover ? `<img src="${esc(cover)}" alt="">` : `<div class="col">${specialArt(u).map(s => `<img src="${esc(s)}" alt="">`).join('')}</div>`;
    pages.push(`<div class="bpage bcover" data-density="hard"><div class="cv" style="--bc:${esc(color)}"><div class="plate">${coverArt}</div><h1>${esc(name)}</h1><p>${own} / ${cards.length} cartes</p></div></div>`);
    for (let p = 0; p < inner + (inner % 2); p++) {
        const slice = cards.slice(p * per, p * per + per);
        const pockets = Array.from({ length: per }, (_, k) => {
            const c = slice[k];
            if (!c) return '<div class="pocket empty"></div>';
            const o = S.cards[c.key], num = p * per + k + 1;
            if (!o) {
                const ghost = c.duo ? null : imgOf(c.u, c.name);
                const tier = RANK[c.rarity] >= 5 ? `<small class="r-${c.rarity}">${c.season ? esc(D.seasons[c.season].label) : RAR_LABEL[c.rarity]}</small>` : '';
                return `<div class="pocket empty">${ghost ? `<img class="sil" src="${esc(ghost)}" alt="" loading="lazy" draggable="false">` : ''}<b>${num}</b>${tier}</div>`;
            }
            const cc = { ...c, shiny: o.shiny > 0, finish: o.fin };
            // un <button> : la librairie ne tourne pas la page quand on touche une carte, on la zoome
            return `<button class="pocket" data-i="${p * per + k}">${cardHtml(cc, { flat: true })}${o.n > 1 ? `<span class="cnt">x${o.n}</span>` : ''}</button>`;
        }).join('');
        pages.push(`<div class="bpage ${p % 2 ? 'odd' : 'even'}">${RINGS}<div class="pg">${pockets}</div><div class="num">${p + 1}</div></div>`);
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
    flip = new St.PageFlip(el, { width: pw, height: Math.floor(pw * 1.38), size: 'fixed', showCover: true, usePortrait: portrait, maxShadowOpacity: 0.7, flippingTime: 800, mobileScrollSupport: false, drawShadow: true, startPage: startPage || 0 });
    flip.loadFromHTML(el.querySelectorAll('.bpage'));
    const upd = () => {
        const i = flip.getCurrentPageIndex(), n = flip.getPageCount();
        $('#book-page').textContent = i === 0 ? 'Couverture' : i >= n - 1 ? 'Dos' : portrait || i + 1 >= n - 1 ? `Page ${i} / ${n - 2}` : `Pages ${i}–${i + 1} / ${n - 2}`;
    };
    flip.on('flip', upd); upd();
    flip.on('changeState', e => { if (e.data === 'flipping') sfx('page'); });
    el.querySelectorAll('.pocket[data-i]').forEach(pk => pk.onclick = () => zoom(pk.querySelector('.card').outerHTML));
    // le classeur s'ouvre tout seul
    if (!startPage) setTimeout(() => { if (flip && bookU === u && flip.getCurrentPageIndex() === 0) flip.flipNext(); }, 650);
}
function closeBook() { bookU = null; $('#book').classList.remove('on'); if (flip) { try { flip.destroy(); } catch (_) {} flip = null; } renderLibrary(); }
let resizeT = 0;
window.addEventListener('resize', () => { clearTimeout(resizeT); resizeT = setTimeout(() => { if (bookU && flip) openBook(bookU, flip.getCurrentPageIndex() || 1); }, 250); });
// 4 persos pour illustrer les classeurs spéciaux
function specialArt(u) { return binderCards(u).slice(0, 12).map(c => c.duo ? c.duo[0] : imgOf(c.u, c.name)).filter(Boolean).slice(0, 4); }
$('#book-close').onclick = closeBook;
$('#book-prev').onclick = () => flip && flip.flipPrev();
$('#book-next').onclick = () => flip && flip.flipNext();
$('#book-first').onclick = () => flip && flip.flip(0);
$('#book-last').onclick = () => flip && flip.flip(flip.getPageCount() - 1);

/* ---------- sons (générés, pas de fichiers) ---------- */
let AC = null;
function sfx(kind) {
    if (MUTED) return;
    try {
        AC = AC || new (window.AudioContext || window.webkitAudioContext)();
        const t = AC.currentTime;
        if (kind === 'page' || kind === 'rip') {
            const len = kind === 'page' ? 0.32 : 0.45;
            const buf = AC.createBuffer(1, AC.sampleRate * len, AC.sampleRate), d = buf.getChannelData(0);
            for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * (kind === 'rip' && Math.random() < 0.08 ? 1 : 0.5);
            const src = AC.createBufferSource(); src.buffer = buf;
            const f = AC.createBiquadFilter(); f.type = kind === 'page' ? 'bandpass' : 'highpass';
            f.frequency.setValueAtTime(kind === 'page' ? 2200 : 1800, t); f.frequency.exponentialRampToValueAtTime(kind === 'page' ? 700 : 3500, t + len);
            const g = AC.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(kind === 'page' ? 0.22 : 0.3, t + 0.04); g.gain.exponentialRampToValueAtTime(0.0001, t + len);
            src.connect(f).connect(g).connect(AC.destination); src.start(t);
        } else if (kind === 'rare' || kind === 'epic' || kind === 'coins') {
            const notes = kind === 'rare' ? [523, 659, 784] : kind === 'coins' ? [988, 1319, 988, 1319, 1568] : [523, 659, 784, 1047, 1319];
            notes.forEach((hz, i) => {
                const o = AC.createOscillator(), g = AC.createGain(); o.type = kind === 'coins' ? 'square' : 'triangle'; o.frequency.value = hz;
                const s = t + i * (kind === 'coins' ? 0.07 : 0.09); g.gain.setValueAtTime(0.0001, s); g.gain.exponentialRampToValueAtTime(kind === 'coins' ? 0.06 : 0.15, s + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, s + 0.45);
                o.connect(g).connect(AC.destination); o.start(s); o.stop(s + 0.5);
            });
        }
    } catch (_) {}
}
$('#mute').onclick = () => { MUTED = !MUTED; $('#mute').textContent = MUTED ? '🔇' : '🔊'; try { localStorage.setItem('ab-muted', MUTED ? '1' : '0'); } catch (_) {} };

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
$('#reset').onclick = async () => {
    if (!confirm(ME ? 'Effacer toute la collection de ton compte et recommencer ?' : 'Tout effacer et recommencer ?')) return;
    if (ME) { const j = await api('POST', '/api/reset'); if (j.error) return toast(j.error); S = Object.assign(Engine.fresh(), j.state); }
    else { S = Engine.fresh(); save(); }
    renderAll(); toast('Partie réinitialisée.');
};

/* ---------- compte ---------- */
let authMode = 'login';
function renderAccount() {
    const el = $('#account');
    if (!SERVER) { el.innerHTML = ''; return; }
    el.innerHTML = ME
        ? `<button class="acc-btn" id="acc-me" title="Se déconnecter">👤 ${esc(ME.pseudo)}${ME.admin ? ' <span class="acc-admin">ADMIN</span>' : ''}</button>`
        : `<button class="acc-btn guest" id="acc-login">Invité · <b>Se connecter</b></button>`;
    if (ME) $('#acc-me').onclick = logout; else $('#acc-login').onclick = () => openAuth('login');
    $('#nav-admin').style.display = ME && ME.admin ? '' : 'none';
}
function openAuth(mode) {
    authMode = mode;
    $('#auth').classList.add('on');
    $('#auth').querySelectorAll('.auth-tabs button').forEach(b => b.classList.toggle('on', b.dataset.m === mode));
    $('#auth-form').classList.toggle('register', mode === 'register');
    $('#auth-submit').textContent = mode === 'register' ? 'Créer mon compte' : 'Se connecter';
    $('#auth-form').password.autocomplete = mode === 'register' ? 'new-password' : 'current-password';
    $('#auth-guest-cards').textContent = fmt(Object.keys(guestState().cards).length);
    $('#auth-err').textContent = '';
    setTimeout(() => $('#auth-form').email.focus(), 50);
}
function closeAuth() { $('#auth').classList.remove('on'); }
$('#auth').querySelectorAll('.auth-tabs button').forEach(b => b.onclick = () => openAuth(b.dataset.m));
$('#auth-close').onclick = closeAuth;
$('#auth-guest').onclick = closeAuth;
$('#auth').onclick = e => { if (e.target.id === 'auth') closeAuth(); };
$('#auth-form').onsubmit = async e => {
    e.preventDefault();
    const f = e.target, btn = $('#auth-submit');
    btn.disabled = true; $('#auth-err').textContent = '';
    const body = { email: f.email.value, password: f.password.value };
    if (authMode === 'register') { body.pseudo = f.pseudo.value; body.importGuest = f.importGuest.checked; body.guest = guestState(); }
    let j;
    try { j = await api('POST', authMode === 'register' ? '/api/register' : '/api/login', body); } catch (_) { j = { error: 'Le serveur ne répond pas.' }; }
    btn.disabled = false;
    if (j.error) { $('#auth-err').textContent = j.error; return; }
    writeGuest();
    ME = j.me; S = Object.assign(Engine.fresh(), j.state);
    f.reset(); closeAuth(); renderAll();
    toast(authMode === 'register' ? `Bienvenue ${ME.pseudo} ! Ton compte est créé.` : `Re-bonjour ${ME.pseudo} !`);
    startPing();
};
async function logout() {
    if (!confirm('Se déconnecter ?')) return;
    await api('POST', '/api/logout').catch(() => {});
    ME = null; S = guestState(); stopPing();
    renderAll(); toast('Déconnecté. Tu joues en invité.');
}
// pièces reçues de l'admin
let pingT = 0;
function startPing() { stopPing(); pingT = setInterval(ping, 15000); }
function stopPing() { clearInterval(pingT); }
async function ping() {
    if (!ME || document.hidden) return;
    const j = await api('GET', '/api/ping').catch(() => null);
    if (!j) return;
    if (!j.me) { ME = null; S = guestState(); stopPing(); renderAll(); return toast('Session terminée, reconnecte-toi.'); }
    S.coins = j.coins; renderCoins();
    showGifts(j.inbox);
}
function showGifts(inbox) {
    const total = (inbox || []).reduce((s, g) => s + (g.amount || 0), 0);
    if (total > 0) { sfx('coins'); toast(`🎁 Tu as reçu ${fmt(total)} pièces de l'admin !`, 5000); renderShop(); }
    else if (total < 0) toast(`L'admin t'a retiré ${fmt(-total)} pièces.`, 5000);
}

/* ---------- admin ---------- */
function parseAmount(v) {
    let s = String(v || '').toLowerCase().replace(/[\s  _']/g, '');
    let mult = 1;
    const m = s.match(/(milliards?|mds?|md|b|millions?|m|k|mille)$/);
    if (m) { mult = /^(milliard|md|b)/.test(m[1]) ? 1e9 : /^(million|m$)/.test(m[1]) ? 1e6 : 1e3; s = s.slice(0, -m[1].length); }
    if (/^-?\d{1,3}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, '');
    s = s.replace(',', '.');
    return /^-?\d+(\.\d+)?$/.test(s) ? Math.round(parseFloat(s) * mult) : NaN;
}
let adminQ = 0;
async function renderAdmin() {
    if (!ME || !ME.admin) return;
    const q = $('#adm-search').value.trim(), my = ++adminQ;
    const j = await api('GET', '/api/admin/players?q=' + encodeURIComponent(q));
    if (my !== adminQ) return;
    if (j.error) { $('#adm-list').textContent = j.error; return; }
    $('#adm-list').innerHTML = j.players.length ? j.players.map(p => `<button class="adm-row" data-p="${esc(p.pseudo)}"><b>${esc(p.pseudo)}</b><span>${fmt(p.coins)} 🪙</span><span>${fmt(p.cards)} cartes</span></button>`).join('')
        : '<p class="prog">Aucun joueur trouvé.</p>';
    $('#adm-list').querySelectorAll('.adm-row').forEach(b => b.onclick = () => { $('#adm-pseudo').value = b.dataset.p; $('#adm-amount').focus(); });
}
let admT = 0;
$('#adm-search').oninput = () => { clearTimeout(admT); admT = setTimeout(renderAdmin, 250); };
function amountPreview() {
    const n = parseAmount($('#adm-amount').value);
    $('#adm-preview').textContent = $('#adm-amount').value.trim() ? (Number.isFinite(n) && n ? `= ${fmt(n)} pièces` : 'Montant invalide') : '';
}
$('#adm-amount').oninput = amountPreview;
document.querySelectorAll('[data-add]').forEach(b => b.onclick = () => {
    const cur = parseAmount($('#adm-amount').value);
    $('#adm-amount').value = fmt((Number.isFinite(cur) ? cur : 0) + Number(b.dataset.add));
    amountPreview();
});
$('#adm-form').onsubmit = async e => {
    e.preventDefault();
    const pseudo = $('#adm-pseudo').value.trim(), amount = $('#adm-amount').value;
    const n = parseAmount(amount);
    if (!pseudo) return toast('Choisis un joueur.');
    if (!Number.isFinite(n) || !n) return toast('Montant invalide.');
    if (!confirm(`${n > 0 ? 'Donner' : 'Retirer'} ${fmt(Math.abs(n))} pièces ${n > 0 ? 'à' : 'à'} ${pseudo} ?`)) return;
    const j = await api('POST', '/api/admin/give', { pseudo, amount });
    if (j.error) { $('#adm-msg').textContent = '❌ ' + j.error; return; }
    $('#adm-msg').textContent = `✅ ${j.given >= 0 ? '+' : ''}${fmt(j.given)} pièces pour ${j.pseudo} (total : ${fmt(j.coins)} 🪙)`;
    sfx('coins');
    if (j.pseudo.toLowerCase() === ME.pseudo.toLowerCase()) { S.coins = j.coins; renderCoins(); setTimeout(ping, 300); }
    renderAdmin();
};

/* ---------- divers ---------- */
let toastT = 0;
function toast(t, ms = 2600) { const el = $('#toast'); el.textContent = t; el.classList.add('on'); clearTimeout(toastT); toastT = setTimeout(() => el.classList.remove('on'), ms); }
function renderCoins() { $('#coins').textContent = fmt(S.coins); }
function currentTab() { const b = document.querySelector('nav button.on'); return b ? b.dataset.tab : 'shop'; }
function showTab(tab) {
    if (tab === 'admin' && !(ME && ME.admin)) tab = 'shop';
    document.querySelectorAll('nav button').forEach(x => x.classList.toggle('on', x.dataset.tab === tab));
    document.querySelectorAll('.tab').forEach(t => t.classList.toggle('on', t.id === 'tab-' + tab));
    if (tab === 'binder') renderLibrary();
    if (tab === 'stats') renderStats();
    if (tab === 'shop') renderShop();
    if (tab === 'admin') renderAdmin();
}
function renderAll() { renderCoins(); renderAccount(); showTab(currentTab()); }
document.querySelectorAll('nav button').forEach(b => b.onclick = () => showTab(b.dataset.tab));
setInterval(renderFree, 30e3);
$('#mute').textContent = MUTED ? '🔇' : '🔊';

Promise.all([
    fetch('cards.json').then(r => r.json()),
    fetch('/api/me', { credentials: 'same-origin' }).then(r => r.ok ? r.json() : null).catch(() => null)
]).then(([d, m]) => {
    D = d; G = Engine.create(D); U = G.U; BY_POP = G.BY_POP;
    SERVER = !!m;
    if (m && m.me) { ME = m.me; S = Object.assign(Engine.fresh(), m.state); startPing(); setTimeout(ping, 1500); }
    else S = guestState();
    renderAll();
}).catch(() => { $('#packs').textContent = 'Impossible de charger les cartes.'; });
})();
