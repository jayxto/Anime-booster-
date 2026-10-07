/* Anime Boosters — interface : boutique, ouverture, classeurs, compte et admin.
   Les packs sont tirés par engine.js : dans le navigateur pour les invités, sur le serveur pour les comptes. */
(() => {
'use strict';

const { RAR, RAR_LABEL, RAR_COLOR, RANK, SPECIAL_TIERS, TIER_BY_ID, SEASON_COLOR, FINISHES, GOD_PACK_RATE, SHINY_RATE, SEASON_EMO, INFINITE, FREE_PACK, PACKS, ANIME_PACK_PRICE } = Engine;
const FIN_LABEL = Object.fromEntries(FINISHES.map(f => [f.id, f.label]));
let D = null, G = null, S = null, ME = null, SERVER = false, booted = false, lastPack = null, U = [], BY_POP = [];
let EVENT = { luck: 1, until: null }, eventSeen = null;
const $ = s => document.querySelector(s);
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmt = n => Number(n || 0).toLocaleString('fr-FR');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const imgUrl = p => G.imgUrl(p), imgOf = (u, n) => G.imgOf(u, n);
const seasonActive = id => G.seasonActive(id), seasonChars = id => G.seasonChars(id);
const baseCard = (...a) => G.baseCard(...a), specialCard = (...a) => G.specialCard(...a), seasonCard = (...a) => G.seasonCard(...a), duoOf = (...a) => G.duoOf(...a);
const colorOf = c => c.season ? SEASON_COLOR[c.season] || RAR_COLOR.saison : RAR_COLOR[c.rarity] || '#9aa0a6';
const labelOf = c => c.season ? `${SEASON_EMO[c.season] || ''} ${D.seasons[c.season] ? D.seasons[c.season].label : 'Saison'}` : RAR_LABEL[c.rarity] || c.rarity;
const luckNow = () => EVENT.luck > 1 && (!EVENT.until || Date.now() < EVENT.until) ? EVENT.luck : 1;

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
    let r;
    try { r = await fetch(url, { method, headers: body ? { 'Content-Type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined, credentials: 'same-origin' }); }
    catch (_) { return { error: 'Connexion perdue.', status: 0 }; }
    let j = {};
    try { j = await r.json(); } catch (_) { j = { error: 'Le serveur ne répond pas.' }; }
    if (!r.ok && !j.error) j.error = 'Erreur ' + r.status;
    j.status = r.status;
    return j;
}
function applyPatch(p) {
    if (!p) return;
    for (const k of Object.keys(p)) if (k !== 'entries') S[k] = p[k];
    for (const [k, v] of Object.entries(p.entries || {})) S.cards[k] = v;
}
// les actions passent par le serveur pour un compte, par le moteur local pour un invité
async function doBuy(id) {
    if (!ME) { const r = G.buy(S, id, Date.now(), luckNow()); if (r.ok) save(); return r; }
    const j = await api('POST', '/api/open', { id });
    if (j.error) return { ok: false, error: j.error, retry: j.status === 0 || j.status === 429 || j.status >= 500 };
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

/* ---------- événement chance pour tout le serveur ---------- */
function dur(ms) {
    const m = Math.max(0, Math.round(ms / 60000));
    if (m < 1) return 'moins d’une minute';
    const h = Math.floor(m / 60);
    return h ? `${h} h ${String(m % 60).padStart(2, '0')}` : `${m} min`;
}
function setEvent(ev) {
    const before = luckNow();
    EVENT = ev && ev.luck > 1 ? { luck: ev.luck, until: ev.left ? Date.now() + ev.left : null } : { luck: 1, until: null };
    const now = luckNow(), id = now > 1 ? `${ev.id}:${now}` : null;
    // l'annonce ne s'affiche qu'une fois par événement
    if (booted && id && id !== eventSeen) { toast(`🍀 Chance x${now} activée sur tout le serveur !`, 5000); sfx('luck'); FX.rain({ colors: ['#39ff14', '#ffe600', '#fff'], duration: 1800 }); }
    if (booted && now <= 1 && before > 1) toast('L’événement chance est terminé.');
    eventSeen = id;
    renderEvent();
}
function renderEvent() {
    const l = luckNow(), b = $('#event-banner');
    b.hidden = l <= 1;
    if (l > 1) b.innerHTML = `🍀 CHANCE x${l} SUR TOUT LE SERVEUR <small>${EVENT.until ? 'encore ' + dur(EVENT.until - Date.now()) : 'jusqu’à nouvel ordre'}</small>`;
    const st = $('#ev-status');
    st.classList.toggle('on', l > 1);
    st.textContent = l > 1 ? `🍀 Chance x${l} active pour tout le serveur — ${EVENT.until ? 'encore ' + dur(EVENT.until - Date.now()) : 'sans limite de temps'}` : 'Pas d’événement en cours.';
}

/* ---------- rendu des cartes (même structure que les cartes d'Anime Game) ---------- */
// groupe de rareté pour les effets : 0 commune … 4 mythique, 5 spéciale, 7 très rare, 8 au-delà d'Éternelle
const rkOf = c => { const r = RANK[c.rarity] || 0; return r >= 8 ? 8 : r >= 7 ? 7 : r >= 5 || c.rarity === 'duo' ? 5 : Math.floor(r); };
const STARS = ['★', '★★', '★★★', '★★★★', '★★★★★'];
const gemsOf = c => { const k = rkOf(c); return k < 5 ? STARS[k] : (RANK[c.rarity] || 0) >= 9 ? '👑' : k >= 8 ? '✦✦✦✦' : k >= 7 ? '✦✦✦' : '✦✦'; };
function cardHtml(c, opt = {}) {
    const ini = c.name.split(/\s+/).map(w => w[0]).join('').slice(0, 2).toUpperCase(), rk = rkOf(c);
    const cls = ['card', 'r-' + c.rarity, c.season ? 'r-' + c.season : '', 'rk-' + rk, c.shiny ? 'shiny' : '', c.finish ? 'f-' + c.finish + ' has-fin' : '', rk >= 4 && !opt.flat ? 'big-rar' : ''].filter(Boolean).join(' ');
    const im = u => u ? `<img src="${esc(u)}" alt="" loading="lazy" draggable="false">` : `<span class="ini">${esc(ini)}</span>`;
    const art = c.duo ? c.duo.map(im).join('') : im(imgOf(c.u, c.name));
    const badges = [opt.isNew ? '<span class="new">NOUVEAU</span>' : '', opt.count > 1 ? `<span>x${opt.count}</span>` : '', c.shiny ? '<span>✨ Brillante</span>' : '',
        c.finish ? `<span>${esc(FIN_LABEL[c.finish] || c.finish)}</span>` : '', opt.coins ? `<span>+${fmt(opt.coins)} 🪙</span>` : ''].join('');
    return `<div class="${cls}" style="--c:${colorOf(c)}"><i class="bgfx"></i><div class="ci${c.duo ? ' duo' : ''}">${art}</div><i class="fx"></i><i class="glare"></i><i class="frame"></i>`
        + `<span class="rr">${esc(labelOf(c))}</span><div class="bd">${badges}</div>`
        + `<div class="info"><div class="nm">${esc(c.name)}</div><div class="meta"><span class="an">${esc(c.anime || '')}</span><span class="gems">${gemsOf(c)}</span></div></div></div>`;
}
// chances d'obtention
const bigNum = n => n >= 1e12 ? 'plus de mille milliards' : n >= 1e9 ? (n / 1e9).toFixed(1).replace('.0', '').replace('.', ',') + (n >= 2e9 ? ' milliards' : ' milliard')
    : n >= 1e6 ? (n / 1e6).toFixed(1).replace('.0', '').replace('.', ',') + (n >= 2e6 ? ' millions' : ' million') : fmt(Math.round(n));
const oddsText = p => !(p > 0) ? null : 1 / p < 1.5 ? 'presque à coup sûr' : '1 sur ' + bigNum(1 / p);
const shortOdds = p => { if (!(p > 0)) return ''; const n = 1 / p; if (n >= 1e9) return '≈ 0'; return '1/' + (n >= 1e6 ? (n / 1e6).toFixed(1).replace('.0', '') + 'M' : n >= 1e4 ? Math.round(n / 1e3) + 'k' : n >= 1e3 ? (n / 1e3).toFixed(1).replace('.0', '') + 'k' : Math.round(n)); };
const pct = p => (p * 100 >= 1 ? (p * 100).toFixed(1) : p * 100 >= 0.01 ? (p * 100).toFixed(2) : (p * 100).toPrecision(2)).replace('.', ',') + ' %';
const RULE_TXT = { nuit: '🌙 Sort seulement entre minuit et 6 h (heure de Paris).', top10: 'Seulement les 10 animés phares (One Piece, Naruto, Dragon Ball…).', top3: 'Seulement One Piece, Naruto et Dragon Ball.' };
const tierNote = t => RULE_TXT[t.rule] || (t.top === Infinity ? `Tous les persos ont leur version ${t.label}.` : t.top === 1 ? 'Le perso le plus connu de chaque animé.' : `Les ${t.top} persos les plus connus de chaque animé.`);

/* ---------- fiche d'une carte ---------- */
function inspect(c) {
    const o = S.cards[c.key];
    const cc = { ...c, shiny: c.shiny != null ? c.shiny : !!(o && o.shiny > 0), finish: c.finish !== undefined ? c.finish : o ? o.fin : null };
    const luck = luckNow(), p = G.chanceOf(c, luck), t = oddsText(p), tier = TIER_BY_ID[c.rarity];
    const rule = tier ? tierNote(tier) : '';
    $('#zoom').innerHTML = `<div class="zoom-wrap">${cardHtml(cc)}<div class="zoom-info">
      <h3>${esc(c.name)}</h3><div class="zan">${esc(c.anime || '')}</div>
      <p>Rareté : <b style="color:${colorOf(c)}">${esc(labelOf(c))}</b></p>
      ${cc.finish ? `<p>Finition : <b>${esc(FIN_LABEL[cc.finish] || cc.finish)}</b></p>` : ''}${cc.shiny ? '<p>✨ Brillante</p>' : ''}
      <p>${o ? `Dans ta collection : <b>x${fmt(o.n)}</b>` : 'Pas encore dans ta collection'}</p>
      <div class="odds">🎲 Chance d’obtention${luck > 1 ? ` <small>(🍀 chance x${luck})</small>` : ''}<br>
        ${t ? `<b>${t}</b> par carte tirée<br><small>Pack Infini (5 cartes) : ${oddsText(1 - Math.pow(1 - p, 5))} par pack</small>`
            : `<b>${c.season ? 'Seulement pendant l’événement ' + esc(D.seasons[c.season].label) : 'Ne sort pas en ce moment'}</b>`}
        ${rule ? `<br><small>${esc(rule)}</small>` : ''}</div>
      <p class="close">Touche n’importe où pour fermer</p></div></div>`;
    $('#zoom').classList.add('on');
}
$('#zoom').onclick = () => $('#zoom').classList.remove('on');
// la carte suit le doigt / la souris avec un reflet
let tiltEl = null;
function untilt() {
    if (!tiltEl) return;
    tiltEl.classList.remove('tilting');
    const card = tiltEl.classList.contains('card') ? tiltEl : tiltEl.querySelector('.card');
    if (card) card.classList.remove('tilting');
    tiltEl = null;
}
document.addEventListener('pointermove', e => {
    const el = e.target.closest ? e.target.closest('.sm-slot.up, #zoom .card') : null;
    if (tiltEl && tiltEl !== el) untilt();
    if (!el) return;
    tiltEl = el;
    const r = el.getBoundingClientRect(), px = (e.clientX - r.left) / r.width, py = (e.clientY - r.top) / r.height;
    const card = el.classList.contains('card') ? el : el.querySelector('.card');
    el.style.setProperty('--rx', ((0.5 - py) * 22).toFixed(1) + 'deg');
    el.style.setProperty('--ry', ((px - 0.5) * 26).toFixed(1) + 'deg');
    if (card) { card.style.setProperty('--mx', (px * 100).toFixed(0) + '%'); card.style.setProperty('--my', (py * 100).toFixed(0) + '%'); card.classList.add('tilting'); }
    el.classList.add('tilting');
});
document.addEventListener('pointerleave', untilt);

/* ---------- ouverture : le cercle d'invocation (mise en scène dans summon.js) ---------- */
let auto = false, autoT = 0, opened = null, busy = false, openTok = 0;
const SM = Summon.create({
    root: $('#opening'), stage: $('#sm-stage'), canvas: $('#sm-glow'), ui: $('#op-ui'), hint: $('#sm-hint'),
    cardHtml, colorOf, labelOf, rankOf: c => RANK[c.rarity] || 0,
    oddsOf: c => { const t = oddsText(G.chanceOf(c, luckNow())); return t ? t.replace(/^1 sur /, '1 chance sur ') + ' par carte' : ''; },
    finishOf: c => c.finish ? 'Finition ' + (FIN_LABEL[c.finish] || c.finish) : '',
    inspect, muted: () => MUTED,
    onGod: () => { $('#op-god').classList.add('on'); sfx('choir'); },
    onDone: () => { showSummary(); setBar(); }
});
const isStop = e => e === Summon.STOP;
function setBar() {
    $('#op-flip').disabled = !(opened && SM.dealt() && SM.hidden());
    $('#op-again').disabled = !lastPack || !!lastPack.free || S.coins < (lastPack.price || 0);
}
// en mode auto, un souci de réseau ne coupe pas tout : on réessaie
async function buyPack(p) {
    for (let tries = 0; ; tries++) {
        let r;
        try { r = await doBuy(p.id); } catch (_) { r = { ok: false, error: 'Connexion perdue.', retry: true }; }
        if (r.ok || !auto || !r.retry || tries >= 4) return r;
        await sleep(1500);
    }
}
async function startOpen(p) {
    if (busy) return;
    if (p.price && S.coins < p.price) { stopAuto(auto ? 'Plus assez de pièces : mode auto arrêté.' : ''); if (!auto) toast('Pas assez de pièces !'); return; }
    busy = true; clearTimeout(autoT);
    const tok = ++openTok;
    $('#opening').classList.add('on'); $('#opening').dataset.pack = tok;
    $('#op-god').classList.remove('on');
    $('#op-sum').classList.remove('on'); $('#op-sum').innerHTML = '';
    $('#op-count').textContent = p.infinite ? `♾️ Pack infini n°${fmt((S.infinite || 0) + 1)}` : p.name;
    $('#op-luck').textContent = luckNow() > 1 ? `🍀 Chance x${luckNow()}` : '';
    opened = { tok, p, cards: null, god: false, summed: false };
    SM.open({ name: p.name, art: packArt(p), emo: p.emo, n: p.n, auto });
    setBar();
    // le pack est acheté tout de suite ; pendant ce temps le joueur le pose dans le cercle
    const buying = buyPack(p).then(r => { busy = false; return r; });
    try {
        await SM.drop();
        const r = await buying;
        if (tok !== openTok) return;
        if (!r.ok) { const wasAuto = auto; closeOpen(); renderFree(); return toast(wasAuto ? `Mode auto arrêté : ${r.error}` : r.error); }
        lastPack = p;
        if (p.infinite) $('#op-count').textContent = `♾️ Pack infini n°${fmt(S.infinite)}`;
        opened.cards = r.cards; opened.god = r.god;
        setBar();
        await SM.ignite(r.cards, r.god);
        if (tok !== openTok) return;
        setBar();
        if (auto) await autoReveal(tok);
    } catch (e) { if (!isStop(e)) console.error(e); }
}
// mode auto : tout se révèle vite, puis le pack suivant arrive ; il ne s'arrête jamais tout seul
async function autoReveal(tok) {
    await SM.revealAll(true);
    if (tok !== openTok || !auto) return;
    autoT = setTimeout(() => { if (auto && tok === openTok && lastPack) startOpen(lastPack); }, 650);
}
// résumé du pack une fois tout révélé
function showSummary() {
    if (!opened || !opened.cards || opened.summed) return;
    opened.summed = true;
    const cards = opened.cards, best = cards.reduce((b, c) => (RANK[c.rarity] || 0) > (RANK[b.rarity] || 0) ? c : b, cards[0]);
    const news = cards.filter(c => c.isNew).length, coins = cards.reduce((t, c) => t + (c.coins || 0), 0);
    const el = $('#op-sum');
    el.innerHTML = `<span>Meilleure carte : <b style="color:${colorOf(best)}">${esc(labelOf(best))}</b> <i class="sum-gems" style="color:${colorOf(best)}">${gemsOf(best)}</i></span>`
        + (news ? `<span>✨ ${news} nouvelle${news > 1 ? 's' : ''}</span>` : '<span>Aucune nouvelle carte</span>') + (coins ? `<span>+${fmt(coins)} 🪙 de doublons</span>` : '');
    el.classList.remove('on'); void el.offsetWidth; el.classList.add('on');
}
// Espace : poser le pack, puis tout révéler, puis pack suivant
function next() {
    if (!opened) return;
    if (!SM.dealt()) { SM.tapPack(); return; }
    if (SM.hidden()) { SM.revealAll(false); return; }
    nextPack();
}
function nextPack() { if (!lastPack || lastPack.free || busy) return; startOpen(lastPack); }
function stopAuto(msg) {
    const was = auto;
    auto = false; clearTimeout(autoT); SM.setAuto(false);
    $('#op-auto').classList.remove('on'); $('#op-auto').textContent = '▶ Auto';
    if (was && msg) toast(msg, 4000);
}
function closeOpen() { stopAuto(); openTok++; opened = null; SM.close(); $('#opening').classList.remove('on'); $('#op-god').classList.remove('on'); renderShop(); }
$('#op-flip').onclick = () => SM.revealAll(false);
$('#op-close').onclick = closeOpen;
$('#op-again').onclick = nextPack;
$('#op-auto').onclick = () => {
    if (auto) return stopAuto();
    const p = lastPack || (opened && opened.p);
    if (!p || p.free) return toast('Le mode auto marche avec les packs payants et le Pack Infini.');
    auto = true; $('#op-auto').classList.add('on'); $('#op-auto').textContent = '⏸ Stop';
    SM.setAuto(true);
    if (!opened) return startOpen(p);
    if (!SM.dealt()) return; // le pack en cours file tout seul dans le cercle et la suite s'enchaîne
    if (SM.hidden()) autoReveal(opened.tok);
    else nextPack();
};
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
        if (e.defaultPrevented) return;
        if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); if (SM.busy()) SM.skip(); else next(); }
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
const ICON_TIERS = SPECIAL_TIERS.filter(t => t.rule !== 'large').sort((a, b) => a.rank - b.rank);
const WIDE = new Set(SPECIAL_TIERS.filter(t => t.rule === 'large').map(t => t.id));
const seasonCards = () => Object.keys(D.seasons).flatMap(id => seasonChars(id).map(([su, n]) => seasonCard(id, su, n)));
function ownedSpecials() {
    return Object.keys(S.cards).filter(k => TIER_BY_ID[k.split('|')[2]]).map(k => G.cardOfKey(k)).filter(Boolean)
        .sort((a, b) => RANK[b.rarity] - RANK[a.rarity] || a.anime.localeCompare(b.anime));
}
// le classeur d'un animé : tous ses persos, puis leurs versions spéciales
function animeCards(u) {
    const a = D.animes[u], out = a.cards.map((c, i) => baseCard(u, i));
    for (const t of ICON_TIERS) for (const n of G.specialList(u, t.id)) out.push(specialCard(u, n, t.id));
    for (const k of Object.keys(S.cards)) { // versions « larges » (Ombre, Mirage…) déjà obtenues
        if (!k.startsWith(u + '|')) continue;
        const [, n, tier] = k.split('|');
        if (tier && WIDE.has(tier)) out.push(specialCard(u, n, tier));
    }
    return out;
}
const KEYS = new Map();
function binderKeys(u) {
    if (!KEYS.has(u)) {
        const ks = D.animes[u].cards.map(c => u + '|' + c[0]);
        for (const t of ICON_TIERS) for (const n of G.specialList(u, t.id)) ks.push(u + '|' + n + '|' + t.id);
        KEYS.set(u, ks);
    }
    return KEYS.get(u);
}
// le classeur principal réunit toutes les cartes
function allCards() {
    const out = [];
    for (const u of [...BY_POP, 'pokedex']) if (D.animes[u]) D.animes[u].cards.forEach((c, i) => out.push(baseCard(u, i)));
    D.duos.forEach(d => out.push(duoOf(d)));
    out.push(...seasonCards(), ...ownedSpecials());
    return out;
}
const sectionOf = c => c.season ? '🎃 Cartes de saison' : c.rarity === 'duo' ? '🤝 Cartes Duo' : TIER_BY_ID[c.rarity] ? '⭐ Raretés spéciales' : c.anime;
const SPECIAL_BINDERS = {
    _all: { name: '📚 Classeur principal', main: true, cards: allCards },
    _special: { name: '⭐ Mes raretés spéciales', cards: ownedSpecials },
    _saison: { name: '🎃 Cartes de saison', cards: seasonCards },
    _duo: { name: '🤝 Cartes Duo', cards: () => D.duos.map(d => duoOf(d)) }
};
function libStats(u) {
    if (u === '_all') {
        let own = 0; for (const k of Object.keys(S.cards)) if (!TIER_BY_ID[k.split('|')[2]]) own++;
        return { own, tot: U.reduce((s, x) => s + D.animes[x].cards.length, 0) + D.duos.length + seasonCards().length };
    }
    if (u === '_special') { const n = ownedSpecials().length; return { own: n, tot: n }; }
    if (SPECIAL_BINDERS[u]) { const l = SPECIAL_BINDERS[u].cards(); return { own: l.filter(c => S.cards[c.key]).length, tot: l.length }; }
    const ks = binderKeys(u); let own = 0; for (const k of ks) if (S.cards[k]) own++;
    return { own, tot: ks.length };
}
let libShown = 60;
function renderLibrary() {
    const q = $('#lib-search').value.trim().toLowerCase(), sort = $('#lib-sort').value;
    let us = U.filter(u => !q || D.animes[u].name.toLowerCase().includes(q)).map(u => ({ u, ...libStats(u), pop: D.animes[u].pop }));
    if (sort === 'owned') us.sort((a, b) => b.own / b.tot - a.own / a.tot || b.own - a.own || b.pop - a.pop);
    else if (sort === 'pop') us.sort((a, b) => b.pop - a.pop);
    else us.sort((a, b) => D.animes[a.u].name.localeCompare(D.animes[b.u].name));
    const sp = q ? [] : Object.keys(SPECIAL_BINDERS).map(u => ({ u, ...libStats(u), special: true }));
    const all = [...sp, ...us];
    const totalAll = U.reduce((s, u) => s + D.animes[u].cards.length, 0);
    $('#lib-prog').textContent = `${fmt(Object.keys(S.cards).length)} cartes différentes · ${fmt(totalAll)} persos dans ${fmt(U.length)} animés · ${SPECIAL_TIERS.length} raretés spéciales · ${FINISHES.length} finitions`;
    $('#library').innerHTML = all.slice(0, libShown).map(b => {
        const a = D.animes[b.u], sb = SPECIAL_BINDERS[b.u], name = sb ? sb.name : a.name;
        const cover = sb ? null : (a.cover || imgUrl(a.cards[0][2]));
        const col = !sb && a.color ? `--bc:linear-gradient(160deg, ${a.color}, #1a1230)` : '';
        const art = cover ? `<img src="${esc(cover)}" alt="" loading="lazy">` : `<div class="col">${specialArt(b.u, sb && sb.main ? 12 : 4).map(s => `<img src="${esc(s)}" alt="" loading="lazy">`).join('')}</div>`;
        const count = b.u === '_special' ? `${fmt(b.own)} cartes` : `${fmt(b.own)}/${fmt(b.tot)}`;
        return `<div class="binder-cv ${sb ? 'special' : ''}${sb && sb.main ? ' main' : ''}" data-u="${esc(b.u)}" style="${col}">${art}
          <span class="bn">${count}</span><div class="bt">${esc(name)}${sb && sb.main ? '<br><small>Toutes les cartes du jeu</small>' : ''}</div><div class="bp"><i style="width:${b.tot ? Math.round(b.own / b.tot * 100) : 0}%"></i></div></div>`;
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
// persos pour illustrer les classeurs spéciaux
function specialArt(u, n = 4) {
    const l = u === '_all' ? BY_POP.slice(0, n).map(x => imgUrl(D.animes[x].cards[0][2])) : SPECIAL_BINDERS[u].cards().slice(0, 12).map(c => c.duo ? c.duo[0] : imgOf(c.u, c.name));
    const out = l.filter(Boolean).slice(0, n);
    return out.length ? out : BY_POP.slice(0, n).map(x => imgUrl(D.animes[x].cards[0][2]));
}

let flip = null, bookU = null, bookCards = [], bookMine = false, bookSections = [], bookUpd = () => {};
const RINGS = '<div class="rings"><i></i><i></i><i></i></div>';
const PER = 9;
function pocketHtml(c, i) {
    if (!c) return '<div class="pocket empty"></div>';
    const o = S.cards[c.key];
    if (!o) {
        const ghost = c.duo ? null : imgOf(c.u, c.name);
        const tier = RANK[c.rarity] >= 5 ? `<small style="--c:${colorOf(c)}">${esc(labelOf(c))}</small>` : '';
        const odds = shortOdds(G.chanceOf(c, luckNow()));
        return `<div class="pocket empty">${ghost ? `<img class="sil" src="${esc(ghost)}" alt="" loading="lazy" draggable="false">` : ''}${odds ? `<span class="odds">${odds}</span>` : ''}<b>${i + 1}</b>${tier}</div>`;
    }
    // un <button> : la librairie ne tourne pas la page quand on touche une carte, on l'ouvre
    return `<button class="pocket" data-i="${i}">${cardHtml({ ...c, shiny: o.shiny > 0, finish: o.fin }, { flat: true })}${o.n > 1 ? `<span class="cnt">x${o.n}</span>` : ''}</button>`;
}
function openBook(u, startPage) {
    const sb = SPECIAL_BINDERS[u], a = D.animes[u], main = !!(sb && sb.main);
    let cards = sb ? sb.cards() : animeCards(u);
    if (main && bookMine) cards = cards.filter(c => S.cards[c.key]);
    bookU = u; bookCards = cards;
    // sommaire du classeur principal
    bookSections = [];
    if (main) cards.forEach((c, i) => { const s = sectionOf(c); if (!bookSections.length || bookSections[bookSections.length - 1][1] !== s) bookSections.push([i, s]); });
    $('#book-tools').hidden = !main;
    if (main) $('#book-animes').innerHTML = bookSections.map(s => `<option value="${esc(s[1])}">`).join('');
    $('#book-mine').classList.toggle('on', bookMine);
    $('#book-mine').textContent = bookMine ? '✓ Mes cartes' : 'Mes cartes';
    const name = sb ? sb.name : a.name, own = cards.filter(c => S.cards[c.key]).length;
    const color = !sb && a.color ? a.color : main ? '#8a5a12' : sb ? '#1d6b8a' : '#7a2236';
    const cover = sb ? null : (a.cover || imgUrl(a.cards[0][2]));
    $('#book-title').textContent = name;
    $('#book-prog').textContent = `${fmt(own)} / ${fmt(cards.length)}`;
    const inner = Math.max(2, Math.ceil(cards.length / PER)), total = inner + (inner % 2);
    const coverArt = cover ? `<img src="${esc(cover)}" alt="">` : `<div class="col">${specialArt(u).map(s => `<img src="${esc(s)}" alt="">`).join('')}</div>`;
    const pages = [`<div class="bpage bcover" data-density="hard"><div class="cv" style="--bc:${esc(color)}"><div class="plate">${coverArt}</div><h1>${esc(name)}</h1><p>${fmt(own)} / ${fmt(cards.length)} cartes</p></div></div>`];
    // les pages sont remplies au fil de la lecture (le classeur principal en a des milliers)
    for (let p = 0; p < total; p++) pages.push(`<div class="bpage ${p % 2 ? 'odd' : 'even'}"></div>`);
    pages.push(`<div class="bpage bcover back" data-density="hard"><div class="cv" style="--bc:${esc(color)}"></div></div>`);

    const stage = $('#book-stage');
    if (flip) { try { flip.destroy(); } catch (_) {} flip = null; }
    stage.innerHTML = '<div id="book-el"></div>';
    const el = $('#book-el');
    el.innerHTML = pages.join('');
    const PG = [...el.querySelectorAll('.bpage:not(.bcover)')];
    const sectAt = i => { let s = ''; for (const [at, l] of bookSections) { if (at > i) break; s = l; } return s; };
    function fillPage(p) {
        const node = PG[p];
        if (!node || node.dataset.done) return;
        node.dataset.done = '1';
        const from = p * PER, slice = cards.slice(from, from + PER);
        const sect = main && slice.length ? `<div class="sect">${esc(sectAt(from))}</div>` : '';
        node.innerHTML = `${RINGS}${sect}<div class="pg">${Array.from({ length: PER }, (_, k) => pocketHtml(slice[k], from + k)).join('')}</div><div class="num">${p + 1}</div>`;
        node.querySelectorAll('button.pocket').forEach(b => b.onclick = () => inspect(cards[+b.dataset.i]));
    }
    const fillAround = idx => { for (let p = Math.max(0, idx - 4); p <= Math.min(total - 1, idx + 5); p++) fillPage(p); };
    fillAround(startPage ? startPage - 1 : 0);
    $('#book').classList.add('on');
    const h = stage.clientHeight - 12, w = stage.clientWidth;
    const portrait = w < 700;
    const pw = Math.floor(Math.min(portrait ? w - 8 : (w - 8) / 2, h / 1.38));
    flip = new St.PageFlip(el, { width: pw, height: Math.floor(pw * 1.38), size: 'fixed', showCover: true, usePortrait: portrait, maxShadowOpacity: 0.7, flippingTime: 800, mobileScrollSupport: false, drawShadow: true, startPage: startPage || 0 });
    flip.loadFromHTML(el.querySelectorAll('.bpage'));
    const upd = () => {
        const i = flip.getCurrentPageIndex(), n = flip.getPageCount();
        fillAround(i - 1);
        $('#book-page').textContent = i === 0 ? 'Couverture' : i >= n - 1 ? 'Dos' : portrait || i + 1 >= n - 1 ? `Page ${fmt(i)} / ${fmt(n - 2)}` : `Pages ${fmt(i)}–${fmt(i + 1)} / ${fmt(n - 2)}`;
    };
    flip.on('flip', upd); upd();
    bookUpd = upd;
    flip.on('changeState', e => { if (e.data === 'flipping') sfx('page'); });
    // le classeur s'ouvre tout seul
    if (!startPage) setTimeout(() => { if (flip && bookU === u && flip.getCurrentPageIndex() === 0) flip.flipNext(); }, 650);
}
function closeBook() { bookU = null; $('#book').classList.remove('on'); if (flip) { try { flip.destroy(); } catch (_) {} flip = null; } renderLibrary(); }
let resizeT = 0;
window.addEventListener('resize', () => { clearTimeout(resizeT); resizeT = setTimeout(() => { if (bookU && flip) openBook(bookU, flip.getCurrentPageIndex() || 1); }, 250); });
$('#book-close').onclick = closeBook;
$('#book-prev').onclick = () => flip && flip.flipPrev();
$('#book-next').onclick = () => flip && flip.flipNext();
$('#book-first').onclick = () => flip && flip.flip(0);
$('#book-last').onclick = () => flip && flip.flip(flip.getPageCount() - 1);
$('#book-mine').onclick = () => { bookMine = !bookMine; openBook('_all', 1); };
$('#book-find').onchange = () => {
    const q = $('#book-find').value.trim().toLowerCase();
    if (!q || !flip) return;
    const s = bookSections.find(x => x[1].toLowerCase() === q) || bookSections.find(x => x[1].toLowerCase().includes(q));
    if (!s) return toast('Animé introuvable dans ce classeur.');
    flip.turnToPage(1 + Math.floor(s[0] / PER));
    bookUpd(); sfx('page');
    $('#book-find').value = ''; $('#book-find').blur();
};

/* ---------- sons (générés, pas de fichiers) ---------- */
let AC = null;
function noise(len, type, f0, f1, vol, t) {
    const buf = AC.createBuffer(1, Math.max(1, AC.sampleRate * len), AC.sampleRate), d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * (type === 'rip' && Math.random() < 0.08 ? 1 : 0.5);
    const src = AC.createBufferSource(); src.buffer = buf;
    const f = AC.createBiquadFilter(); f.type = type === 'rip' ? 'highpass' : type === 'boom' ? 'lowpass' : 'bandpass';
    f.frequency.setValueAtTime(f0, t); f.frequency.exponentialRampToValueAtTime(f1, t + len);
    const g = AC.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + Math.min(0.05, len / 3)); g.gain.exponentialRampToValueAtTime(0.0001, t + len);
    src.connect(f).connect(g).connect(AC.destination); src.start(t);
}
function tone(hz, t, len, vol, type = 'triangle', to) {
    const o = AC.createOscillator(), g = AC.createGain(); o.type = type; o.frequency.setValueAtTime(hz, t);
    if (to) o.frequency.exponentialRampToValueAtTime(to, t + len);
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t + len);
    o.connect(g).connect(AC.destination); o.start(t); o.stop(t + len + 0.05);
}
function sfx(kind) {
    if (MUTED) return;
    try {
        AC = AC || new (window.AudioContext || window.webkitAudioContext)();
        const t = AC.currentTime;
        if (kind === 'page') noise(0.32, 'page', 2200, 700, 0.22, t);
        else if (kind === 'rip') noise(0.45, 'rip', 1800, 3500, 0.3, t);
        else if (kind === 'whoosh') noise(0.4, 'page', 400, 2600, 0.12, t);
        else if (kind === 'deal') { for (let i = 0; i < 4; i++) noise(0.12, 'page', 3000, 1200, 0.08, t + i * 0.08); }
        else if (kind === 'flip') noise(0.06, 'page', 4000, 2000, 0.07, t);
        else if (kind === 'tick') tone(1600, t, 0.08, 0.05, 'square');
        else if (kind === 'chime') [880, 1320].forEach((hz, i) => tone(hz, t + i * 0.07, 0.35, 0.1));
        else if (kind === 'shimmer') { for (let i = 0; i < 8; i++) tone(2000 + i * 280, t + i * 0.045, 0.3, 0.035, 'sine'); }
        else if (kind === 'charge') { tone(180, t, 0.6, 0.08, 'sawtooth', 900); noise(0.6, 'page', 300, 3000, 0.06, t); }
        else if (kind === 'boom') { tone(140, t, 0.6, 0.35, 'sine', 38); noise(0.5, 'boom', 900, 120, 0.25, t); }
        else if (kind === 'choir') { [261.6, 329.6, 392, 523.3, 587.3].forEach((hz, i) => { tone(hz, t + i * 0.02, 1.6, 0.05, 'sawtooth'); tone(hz * 1.005, t, 1.6, 0.04, 'sawtooth'); }); }
        else if (kind === 'rare') [523, 659, 784].forEach((hz, i) => tone(hz, t + i * 0.09, 0.45, 0.15));
        else if (kind === 'epic') [523, 659, 784, 1047, 1319].forEach((hz, i) => tone(hz, t + i * 0.09, 0.5, 0.15));
        else if (kind === 'coins') [988, 1319, 988, 1319, 1568].forEach((hz, i) => tone(hz, t + i * 0.07, 0.4, 0.06, 'square'));
        else if (kind === 'luck') [523, 659, 784, 1047, 1319, 1568, 2093].forEach((hz, i) => tone(hz, t + i * 0.06, 0.5, 0.1));
    } catch (_) {}
}
$('#mute').onclick = () => { MUTED = !MUTED; $('#mute').textContent = MUTED ? '🔇' : '🔊'; try { localStorage.setItem('ab-muted', MUTED ? '1' : '0'); } catch (_) {} };

/* ---------- stats et chances d'obtention ---------- */
function renderStats() {
    const total = U.reduce((s, u) => s + D.animes[u].cards.length, 0);
    const done = U.filter(u => D.animes[u].cards.every(c => S.cards[u + '|' + c[0]])).length;
    const box = (l, v) => `<div>${l}<b>${v}</b></div>`;
    $('#stats').innerHTML = `<div class="st">${box('Packs ouverts', fmt(S.opened))}${box('Packs infinis', fmt(S.infinite))}${box('Cartes tirées', fmt(S.pulled))}${box('Cartes différentes', fmt(Object.keys(S.cards).length))}
      ${box('Persos au total', fmt(total))}${box('Animés', fmt(U.length))}${box('Classeurs complets', done)}${box('God Packs', S.god)}${box('Brillantes', Object.values(S.cards).filter(o => o.shiny).length)}</div>
      <h2 class="sec">Tes tirages par rareté</h2><div class="st">${[...RAR, 'saison', 'duo'].filter(r => S.best[r] || RANK[r] < 5 || r === 'saison' || r === 'duo').map(r => box(`<span style="color:${RAR_COLOR[r]}">${RAR_LABEL[r]}</span>`, fmt(S.best[r] || 0))).join('')}</div>`;
    renderRates();
}
function renderRates() {
    const luck = luckNow(), o = G.slotOdds(luck), share = G.baseShare(o.luck);
    const row = (name, col, p, note) => `<tr><td><span class="dot" style="--c:${col}"></span>${name}${note ? `<br><small class="rates-note">${note}</small>` : ''}</td><td>${p > 0 ? pct(p) : '—'}</td><td>${oddsText(p) || '—'}</td></tr>`;
    const base = ['commune', 'rare', 'epique', 'legendaire', 'mythique'].map(r => row(RAR_LABEL[r], RAR_COLOR[r], o.base * share[r])).join('');
    const tiers = SPECIAL_TIERS.slice().sort((a, b) => a.rank - b.rank).map(t => row(t.label, t.color, o.tiers[t.id], tierNote(t))).join('');
    let rest = 1;
    const fins = FINISHES.map(f => { const q = Math.min(0.5, f.rate * o.luck), p = rest * q; rest *= 1 - q; return row('Finition ' + f.label, '#ffd700', p); }).join('');
    $('#rates').innerHTML = `<p class="rates-note">Chances pour une carte tirée dans un pack normal (Pack Infini, boosters 3 et 10 cartes)${luck > 1 ? `, <b>avec la chance x${luck} de l’événement</b>` : ''}. Booster Épique : raretés spéciales x2, Mythique : x4, Pack Chance : tout x10. Touche une carte pour voir sa chance à elle.</p>
      <table><tr><th>Rareté de base</th><th>par carte</th><th></th></tr>${base}</table>
      <table><tr><th>Raretés spéciales (${SPECIAL_TIERS.length})</th><th>par carte</th><th></th></tr>${tiers}
        ${row('Duo', RAR_COLOR.duo, o.duo)}${row('Carte de saison', RAR_COLOR.saison, o.season, o.act.length ? '' : 'Seulement pendant Halloween, Noël, la Saint-Valentin et l’été.')}</table>
      <table><tr><th>Bonus</th><th></th><th></th></tr>${row('✨ God Pack (que des cartes très rares)', '#ffd700', Math.min(0.2, GOD_PACK_RATE * o.luck), 'par pack de 3 cartes ou plus')}${row('Brillante', '#bfe9ff', Math.min(0.9, SHINY_RATE * o.luck))}</table>
      <table><tr><th>Finitions (${FINISHES.length})</th><th>par carte</th><th></th></tr>${fins}</table>`;
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
    const j = await api('POST', authMode === 'register' ? '/api/register' : '/api/login', body);
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
    await api('POST', '/api/logout');
    ME = null; S = guestState(); startPing();
    renderAll(); toast('Déconnecté. Tu joues en invité.');
}
// pièces reçues de l'admin et événement chance (compte : toutes les 15 s, invité : toutes les 30 s)
let pingT = 0;
function startPing() { clearInterval(pingT); if (SERVER) pingT = setInterval(ping, ME ? 15000 : 30000); }
async function ping() {
    if (document.hidden) return;
    if (!ME) { const j = await api('GET', '/api/event'); if (j.event) setEvent(j.event); return; }
    const j = await api('GET', '/api/ping');
    if (j.error) return;
    if (j.event) setEvent(j.event);
    if (!j.me) { ME = null; S = guestState(); startPing(); renderAll(); return toast('Session terminée, reconnecte-toi.'); }
    S.coins = j.coins; renderCoins();
    showGifts(j.inbox);
}
function showGifts(inbox) {
    const total = (inbox || []).reduce((s, g) => s + (g.amount || 0), 0);
    if (total > 0) { sfx('coins'); toast(`🎁 Tu as reçu ${fmt(total)} pièces de l'admin !`, 5000); FX.rain({ colors: ['#ffd700', '#fff6c2'], duration: 1500 }); renderShop(); }
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
    renderEvent();
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
    if (!confirm(`${n > 0 ? 'Donner' : 'Retirer'} ${fmt(Math.abs(n))} pièces à ${pseudo} ?`)) return;
    const j = await api('POST', '/api/admin/give', { pseudo, amount });
    if (j.error) { $('#adm-msg').textContent = '❌ ' + j.error; return; }
    $('#adm-msg').textContent = `✅ ${j.given >= 0 ? '+' : ''}${fmt(j.given)} pièces pour ${j.pseudo} (total : ${fmt(j.coins)} 🪙)`;
    sfx('coins');
    if (j.pseudo.toLowerCase() === ME.pseudo.toLowerCase()) { S.coins = j.coins; renderCoins(); setTimeout(ping, 300); }
    renderAdmin();
};
async function setServerLuck(luck, minutes) {
    const j = await api('POST', '/api/admin/event', { luck, minutes });
    if (j.error) return toast(j.error);
    setEvent(j.event);
    if (luck <= 1) toast('Événement chance arrêté.');
}
$('#ev-on').onclick = () => setServerLuck(+$('#ev-luck').value, +$('#ev-min').value);
$('#ev-off').onclick = () => setServerLuck(1, 0);

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
function renderAll() { renderCoins(); renderAccount(); renderEvent(); showTab(currentTab()); }
document.querySelectorAll('nav button').forEach(b => b.onclick = () => showTab(b.dataset.tab));
setInterval(() => { renderFree(); if (EVENT.luck > 1) { if (luckNow() <= 1) setEvent(null); else renderEvent(); } }, 30e3);
$('#mute').textContent = MUTED ? '🔇' : '🔊';
FX.init($('#fx'));

Promise.all([
    fetch('cards.json').then(r => r.json()),
    fetch('/api/me', { credentials: 'same-origin' }).then(r => r.ok ? r.json() : null).catch(() => null)
]).then(([d, m]) => {
    D = d; G = Engine.create(D); U = G.U; BY_POP = G.BY_POP;
    SERVER = !!m;
    if (m && m.me) { ME = m.me; S = Object.assign(Engine.fresh(), m.state); setTimeout(ping, 1500); }
    else S = guestState();
    if (m && m.event) setEvent(m.event);
    startPing();
    renderAll();
    booted = true;
}).catch(() => { $('#packs').textContent = 'Impossible de charger les cartes.'; });
})();
