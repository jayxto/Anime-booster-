/* Anime Boosters — interface : boutique, ouverture, classeurs, compte et admin.
   Les packs sont tirés par engine.js : dans le navigateur pour les invités, sur le serveur pour les comptes. */
(() => {
'use strict';

const { RAR, RAR_LABEL, RAR_COLOR, RANK, SPECIAL_TIERS, TIER_BY_ID, SEASON_COLOR, FINISHES, GOD_PACK_RATE, SHINY_RATE, SEASON_EMO, INFINITE, FREE_PACK, PACKS, THEME_PACKS, ANIME_PACK_PRICE, MILESTONES, TITLES } = Engine;
const MEDAL = ['🥉', '🥈', '🥇', '🏆'];
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
// partie invité d'avant les récompenses de classeur : les paliers déjà atteints sont payés d'un coup
function loadGuest() {
    let raw = null;
    try { raw = JSON.parse(localStorage.getItem(SAVE_KEY)); } catch (_) {}
    S = Object.assign(Engine.fresh(), raw || {});
    if (!raw || raw.done) return;
    const rw = G.checkBinders(S, Object.keys(S.cards).map(k => k.split('|')[0])), total = rw.reduce((t, r) => t + r.coins, 0);
    writeGuest();
    if (total) setTimeout(() => binderGift(total, rw.length), 900);
}
function binderGift(total, n) { sfx('coins'); glowPulse('.wallet'); toast(`🏆 Récompenses de classeurs : +${fmt(total)} 🪙 pour ${n} palier${n > 1 ? 's' : ''} déjà atteint${n > 1 ? 's' : ''} !`, 6000); }
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
    for (const [k, v] of Object.entries(p.entries || {})) { if (v) S.cards[k] = v; else delete S.cards[k]; } // null : carte partie dans un échange
}
// paliers de classeur gagnés côté serveur : on les note aussi ici
function noteRewards(rw) { S.done = S.done || {}; for (const r of rw || []) { const lvl = MILESTONES.indexOf(r.pct) + 1; if (lvl > (S.done[r.u] || 0)) S.done[r.u] = lvl; } }
// les actions passent par le serveur pour un compte, par le moteur local pour un invité
async function doBuy(id) {
    if (!ME) { const r = G.buy(S, id, Date.now(), luckNow()); if (r.ok) save(); return r; }
    const j = await api('POST', '/api/open', { id });
    if (j.error) return { ok: false, error: j.error, retry: j.status === 0 || j.status === 429 || j.status >= 500 };
    applyPatch(j.patch); noteRewards(j.rewards); renderCoins();
    return { ok: true, cards: j.cards, god: j.god, rewards: j.rewards || [] };
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
    if (booted && id && id !== eventSeen) { toast(`🍀 Chance x${now} activée sur tout le serveur !`, 5000); sfx('luck'); glowPulse('#event-banner'); }
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
    if (p.price && S.coins < p.price) { if (auto) stopAuto('Plus assez de pièces : mode auto arrêté.'); else toast('Pas assez de pièces !'); return; }
    busy = true; clearTimeout(autoT);
    const tok = ++openTok;
    $('#opening').classList.add('on'); $('#opening').dataset.pack = tok;
    $('#op-god').classList.remove('on');
    $('#op-sum').classList.remove('on'); $('#op-sum').innerHTML = '';
    $('#op-count').textContent = p.infinite ? `♾️ Pack infini n°${fmt((S.infinite || 0) + 1)}` : p.name;
    $('#op-luck').textContent = luckNow() > 1 ? `🍀 Chance x${luckNow()}` : '';
    opened = { tok, p, cards: null, god: false, summed: false };
    SM.open({ name: p.name, art: packArt(p), emo: p.emo, n: p.n, auto, type: p.theme ? 'th th-' + p.theme : p.type || (p.anime ? 'anime' : '') });
    setBar();
    // le pack est acheté tout de suite ; pendant ce temps le joueur le pose dans le cercle
    const buying = buyPack(p).then(r => { busy = false; if (r.ok && tok === openTok) lastPack = p; return r; });
    try {
        await SM.drop();
        const r = await buying;
        if (tok !== openTok) return;
        if (!r.ok) { const wasAuto = auto; closeOpen(); renderFree(); return toast(wasAuto ? `Mode auto arrêté : ${r.error}` : r.error); }
        lastPack = p;
        if (p.infinite) $('#op-count').textContent = `♾️ Pack infini n°${fmt(S.infinite)}`;
        opened.cards = r.cards; opened.god = r.god; opened.rewards = r.rewards || [];
        setBar();
        await SM.ignite(r.cards, r.god);
        if (tok !== openTok) return;
        setBar();
        if (auto) await autoReveal(tok);
        else if (opened.wantAll) SM.revealAll(false);
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
        + (news ? `<span>✨ ${news} nouvelle${news > 1 ? 's' : ''}</span>` : '<span>Aucune nouvelle carte</span>') + (coins ? `<span>+${fmt(coins)} 🪙 de doublons</span>` : '')
        + rewardsHtml(opened.rewards);
    el.classList.remove('on'); void el.offsetWidth; el.classList.add('on');
    if (opened.rewards && opened.rewards.length) { sfx('coins'); glowPulse('.wallet'); }
    announceCompletedAlbums(opened.rewards);
}
// paliers de classeur passés grâce au pack
function rewardsHtml(rw) {
    if (!rw || !rw.length) return '';
    const l = rw.slice(0, 3).map(r => `<span class="sum-rw m${MILESTONES.indexOf(r.pct) + 1}">${MEDAL[MILESTONES.indexOf(r.pct)]} ${esc(r.name)} ${r.pct} % : +${fmt(r.coins)} 🪙</span>`).join('');
    const more = rw.slice(3), extra = more.reduce((t, r) => t + r.coins, 0);
    return l + (more.length ? `<span class="sum-rw">🏆 +${more.length} paliers : +${fmt(extra)} 🪙</span>` : '');
}
// Espace : poser le pack, puis tout révéler, puis pack suivant
function next() {
    if (!opened) return;
    if (!SM.dealt()) { if (!SM.tapPack()) opened.wantAll = true; return; } // Espace pendant l'animation : tout se révélera ensuite
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
function closeOpen() {
    // Still show the achievement if the pack was closed before the summary appeared.
    if (opened && !opened.summed) announceCompletedAlbums(opened.rewards);
    stopAuto(); openTok++; opened = null; SM.close(); $('#opening').classList.remove('on'); $('#op-god').classList.remove('on'); renderShop();
}
$('#op-flip').onclick = () => SM.revealAll(false);
$('#op-close').onclick = closeOpen;
$('#op-again').onclick = nextPack;
$('#op-auto').onclick = () => {
    if (auto) return stopAuto();
    const p = (opened && opened.p) || lastPack;
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
    if ($('#pick').classList.contains('on')) { if (e.key === 'Escape') closePicker(); return; }
    if ($('#trade').classList.contains('on')) { if (e.key === 'Escape') closeTrade(); return; }
    if ($('#prof').classList.contains('on')) { if (e.key === 'Escape') closeProfile(); return; }
    if ($('#book').classList.contains('on')) {
        if (e.key === 'ArrowRight') flip && flip.flipNext();
        if (e.key === 'ArrowLeft') flip && flip.flipPrev();
        if (e.key === 'Escape') closeBook();
        return;
    }
    if ($('#opening').classList.contains('on')) {
        if (e.defaultPrevented) return;
        if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); if (!SM.skip()) next(); }
        if (e.key === 'Escape') closeOpen();
    }
});

/* ---------- boutique ---------- */
function packArt(p) {
    if (p.type === 'waifu') return G.waifuArt();
    if (p.type === 'theme') return G.themeArt(p.theme);
    const u = p.anime || BY_POP[(p.art || 0) % BY_POP.length];
    const a = D.animes[u];
    return a ? imgUrl(a.cards[0][2]) : null;
}
function packHtml(p, off, tag) {
    const im = packArt(p);
    return `<div class="pack ${off ? 'off' : ''}${p.theme ? ' th th-' + esc(p.theme) : ''}" data-id="${esc(p.id)}">${tag ? `<span class="pk-tag">${tag}</span>` : ''}
      ${im ? `<img class="pk-art" src="${esc(im)}" alt="" loading="lazy">` : ''}
      <div class="pk-emo">${p.emo}</div><div class="pk-n">${esc(p.name)}</div><div class="pk-d">${esc(p.desc)}</div><div class="pk-p">${p.price ? fmt(p.price) + ' 🪙' : 'Gratuit'}</div></div>`;
}
function renderShop() {
    const list = PACKS.filter(p => G.packFor(p.id));
    $('#packs').innerHTML = list.map(p => packHtml(p, S.coins < p.price, p.type === 'season' ? 'ÉVÉNEMENT' : p.type === 'waifu' ? 'NOUVEAU' : '')).join('');
    $('#packs').querySelectorAll('.pack').forEach(el => el.onclick = () => startOpen(PACKS.find(x => x.id === el.dataset.id)));
    const th = THEME_PACKS.filter(p => G.packFor(p.id));
    $('#theme-sec').hidden = !th.length;
    $('#theme-packs').innerHTML = th.map(p => { const n = G.themeSize(p.theme); return packHtml({ ...p, desc: `${p.desc} · ${fmt(n)} ${p.theme === 'mechants' ? 'méchants' : 'animés'}` }, S.coins < p.price, p.theme === 'mechants' ? 'NOUVEAU' : ''); }).join('');
    $('#theme-packs').querySelectorAll('.pack').forEach(el => el.onclick = () => startOpen(THEME_PACKS.find(x => x.id === el.dataset.id)));
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
// toutes les waifus du jeu, des animés les plus populaires aux moins connus
let WAIFUS = null;
const waifuCards = () => WAIFUS || (WAIFUS = BY_POP.flatMap(u => D.animes[u].wf.map(i => baseCard(u, i))));
const sectionOf = c => c.season ? '🎃 Cartes de saison' : c.rarity === 'duo' ? '🤝 Cartes Duo' : TIER_BY_ID[c.rarity] ? '⭐ Raretés spéciales' : c.anime;
const SPECIAL_BINDERS = {
    _all: { name: '📚 Classeur principal', main: true, cards: allCards },
    _special: { name: '⭐ Mes raretés spéciales', cards: ownedSpecials },
    _waifu: { name: '💖 Waifus', cards: waifuCards },
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
    return G.binderProgress(S, u); // les persos de l'animé (les paliers de récompense comptent ceux-là)
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
    const gold = Object.values(S.done || {}).filter(l => l >= 4).length;
    $('#lib-prog').textContent = `${fmt(Object.keys(S.cards).length)} cartes différentes · ${fmt(totalAll)} persos dans ${fmt(U.length)} animés · ${fmt(G.WAIFU_COUNT)} waifus · ${SPECIAL_TIERS.length} raretés spéciales · ${FINISHES.length} finitions`
        + ` · 🏆 ${fmt(gold)} classeur${gold > 1 ? 's' : ''} complet${gold > 1 ? 's' : ''} (récompenses à 25, 50, 75 et 100 % des persos)`;
    $('#library').innerHTML = all.slice(0, libShown).map(b => {
        const a = D.animes[b.u], sb = SPECIAL_BINDERS[b.u], name = sb ? sb.name : a.name;
        const cover = sb ? null : (a.cover || imgUrl(a.cards[0][2]));
        const col = !sb && a.color ? `--bc:linear-gradient(160deg, ${a.color}, #1a1230)` : '';
        const art = cover ? `<img src="${esc(cover)}" alt="" loading="lazy">` : `<div class="col">${specialArt(b.u, sb && sb.main ? 12 : 4).map(s => `<img src="${esc(s)}" alt="" loading="lazy">`).join('')}</div>`;
        const count = b.u === '_special' ? `${fmt(b.own)} cartes` : `${fmt(b.own)}/${fmt(b.tot)}`;
        const lvl = sb ? 0 : (S.done || {})[b.u] || 0;
        const medal = lvl ? `<span class="medal" title="${lvl >= 4 ? 'Classeur complet : tous les persos' : `Palier ${MILESTONES[lvl - 1]} % des persos atteint`}">${MEDAL[lvl - 1]}</span>` : '';
        return `<div class="binder-cv ${sb ? 'special' : ''}${sb && sb.main ? ' main' : ''}${lvl >= 4 ? ' gold' : ''}" data-u="${esc(b.u)}" style="${col}">${art}${medal}
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
    $('#book-prog').textContent = `${fmt(own)} / ${fmt(cards.length)}` + (sb ? '' : nextMilestone(u));
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
// le prochain palier de récompense d'un classeur d'animé
function nextMilestone(u) {
    const { own, tot } = G.binderProgress(S, u), lvl = (S.done || {})[u] || 0;
    if (lvl >= 4) return ' · 🏆 Complet !';
    const need = Math.ceil(tot * MILESTONES[lvl] / 100) - own;
    return need > 0 ? ` · ${MEDAL[lvl]} ${MILESTONES[lvl]} % dans ${fmt(need)} perso${need > 1 ? 's' : ''} : +${fmt(G.mileCoins(tot, lvl))} 🪙`
        : ` · ${MEDAL[lvl]} ${MILESTONES[lvl]} % atteint : ouvre un booster de cet animé pour toucher +${fmt(G.mileCoins(tot, lvl))} 🪙`;
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
    window.AnimeTCG?.account(ME);
    const el = $('#account');
    if (!SERVER) { el.innerHTML = ''; return; }
    el.innerHTML = ME
        ? `<button class="acc-btn" id="acc-me" title="Se déconnecter">👤 ${esc(ME.pseudo)}${ME.admin ? ' <span class="acc-admin">ADMIN</span>' : ''}</button>`
        : `<button class="acc-btn guest" id="acc-login">Invité · <b>Se connecter</b></button>`;
    if (ME) $('#acc-me').onclick = logout; else $('#acc-login').onclick = () => openAuth('login');
    $('#nav-admin').style.display = ME && ME.admin ? '' : 'none';
    $('#nav-players').style.display = SERVER ? '' : 'none';
    setTradeBadge();
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
    f.reset(); closeAuth(); renderAll(); setTimeout(ping, 600);
    toast(authMode === 'register' ? `Bienvenue ${ME.pseudo} ! Ton compte est créé.` : `Re-bonjour ${ME.pseudo} !`);
    startPing();
};
async function logout() {
    if (!confirm('Se déconnecter ?')) return;
    await api('POST', '/api/logout');
    ME = null; TRADES_IN = 0; loadGuest(); startPing();
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
    if (!j.me) { ME = null; loadGuest(); startPing(); renderAll(); return toast('Session terminée, reconnecte-toi.'); }
    S.coins = j.coins; renderCoins();
    showGifts(j.inbox);
    tradeNews(j.inbox, j.trades);
}
function showGifts(inbox) {
    const bind = (inbox || []).filter(g => g.kind === 'binders');
    if (bind.length) { binderGift(bind.reduce((t, g) => t + g.amount, 0), bind.reduce((t, g) => t + (g.n || 0), 0)); reloadState(); return; }
    const total = (inbox || []).filter(g => !g.trade).reduce((s, g) => s + (g.amount || 0), 0);
    if (total > 0) { sfx('coins'); toast(`🎁 Tu as reçu ${fmt(total)} pièces de l'admin !`, 5000); glowPulse('.wallet'); renderShop(); }
    else if (total < 0) toast(`L'admin t'a retiré ${fmt(-total)} pièces.`, 5000);
}

/* ---------- joueurs : profils, vitrine et échanges ---------- */
let TRADES_IN = 0, TRADES = [];
const T_STATUS = { pending: '⏳ En attente', accepted: '✅ Échange fait', refused: '❌ Refusé', cancelled: '🚫 Annulé', failed: '⚠️ Annulé : une carte n’était plus là' };
const titleOf = id => TITLES.find(t => t.id === id);
const ago = t => { const s = (Date.now() - t) / 1000; return s < 60 ? 'à l’instant' : s < 3600 ? `il y a ${Math.floor(s / 60)} min` : s < 86400 ? `il y a ${Math.floor(s / 3600)} h` : `il y a ${Math.floor(s / 86400)} j`; };
// une carte d'après sa clé (+ brillance / finition de l'exemplaire si on la connaît)
function cardOf(o) {
    const k = typeof o === 'string' ? o : o && o.k, c = k && G.cardOfKey(k);
    if (!c) return null;
    if (o.k) { c.shiny = o.shiny > 0; c.finish = o.fin || null; }
    return c;
}
const thumbOf = k => { const c = k && G.cardOfKey(k); return c ? (c.duo ? c.duo[0] : imgOf(c.u, c.name)) : null; };
function miniHtml(c, opt = {}) {
    return `<div class="mini${opt.sel ? ' sel' : ''}" data-k="${esc(c.key)}">${cardHtml(c, { flat: true, count: opt.count })}${opt.x ? '<button class="mini-x" title="Retirer">✕</button>' : ''}</div>`;
}
const bindMinis = (root, list) => root.querySelectorAll('.mini').forEach(el => el.onclick = e => { if (!e.target.closest('.mini-x')) { const c = list.find(x => x.key === el.dataset.k); if (c) inspect(c); } });
function setTradeBadge() {
    const b = $('#nav-trades');
    if (b) { b.textContent = TRADES_IN; b.hidden = !ME || !TRADES_IN; }
}
async function reloadState() {
    if (!ME) return;
    const j = await api('GET', '/api/me');
    if (!j.state) return;
    S = Object.assign(Engine.fresh(), j.state); renderCoins();
    if (!$('#opening').classList.contains('on') && !$('#book').classList.contains('on')) { const t = currentTab(); if (t === 'binder') renderLibrary(); if (t === 'players') renderPlayers(); if (t === 'shop') renderShop(); }
}
// nouvelles des échanges (ping)
function tradeNews(inbox, count) {
    const tr = (inbox || []).filter(m => m.trade);
    if (tr.length) {
        // The other participant can complete an album while we are offline.
        for (const message of tr) if (message.trade === 'accepted') announceCompletedAlbums(message.rewards);
        const m = tr[tr.length - 1];
        toast(m.trade === 'accepted' ? `✅ ${m.by} a accepté ton échange !` : m.trade === 'refused' ? `❌ ${m.by} a refusé ton échange.` : `⚠️ Ton échange avec ${m.by} est annulé : une carte n’était plus là.`, 5000);
        if (tr.some(x => x.trade === 'accepted')) { sfx('coins'); reloadState(); }
        else if (currentTab() === 'players') renderTrades();
    }
    if (count == null) return;
    const more = count > TRADES_IN;
    TRADES_IN = count; setTradeBadge();
    if (more) { if (!tr.length) toast(`🔁 ${count > 1 ? `${count} propositions d’échange t’attendent` : 'Nouvelle proposition d’échange'} (onglet Joueurs)`, 5000); if (currentTab() === 'players') renderTrades(); }
}
// mon profil, calculé ici (pas besoin d'attendre le serveur)
function myProfile() {
    const st = G.profileStats(S), pr = S.profile || {};
    const own = k => k && S.cards[k] ? { k, n: S.cards[k].n, shiny: S.cards[k].shiny || 0, fin: S.cards[k].fin || null } : null;
    const tid = pr.title && st.titles.includes(pr.title) ? pr.title : st.titles[st.titles.length - 1];
    return { pseudo: ME.pseudo, mine: true, title: (titleOf(tid) || {}).label, titleId: tid, avatar: own(pr.avatar) || own(st.bestKey), avatarSet: !!own(pr.avatar),
        showcase: (pr.showcase || []).map(own).filter(Boolean), stats: st, titles: st.titles };
}
function profileHtml(p) {
    const av = cardOf(p.avatar), st = p.stats, show = p.showcase.map(cardOf).filter(Boolean);
    const stat = (n, l) => `<span><b>${fmt(n)}</b> ${l}</span>`;
    const slots = show.map(c => miniHtml(c)).join('') + Array.from({ length: 5 - show.length }, () => '<div class="mini empty"><span>?</span></div>').join('');
    const titleSel = p.mine ? `<select id="pf-title" title="Ton titre">${TITLES.map(t => `<option value="${t.id}" ${t.id === p.titleId ? 'selected' : ''} ${p.titles.includes(t.id) ? '' : 'disabled'}>${p.titles.includes(t.id) ? '🏅' : '🔒'} ${esc(t.label)}${p.titles.includes(t.id) ? '' : ' — ' + esc(t.hint)}</option>`).join('')}</select>` : '';
    return `<div class="prof${p.mine ? ' mine' : ''}">
      <div class="prof-av">${av ? miniHtml(av) : `<div class="mini empty"><span>${esc(p.pseudo[0] || '?')}</span></div>`}${p.mine ? '<button class="btn sm" id="pf-av">🖼️ Avatar</button>' : ''}</div>
      <div class="prof-id">
        <div class="prof-name">${esc(p.pseudo)}</div>
        <div class="prof-title">${p.title ? '🏅 ' + esc(p.title) : ''}</div>${titleSel}
        <div class="prof-stats">${stat(st.cards, 'cartes')}${stat(st.specials, 'raretés spéciales')}${stat(st.waifus, 'waifus')}${stat(st.done, 'classeurs 🏆')}${stat(st.trades, 'échanges')}${stat(st.opened, 'packs ouverts')}</div>
      </div>
      <div class="prof-show"><div class="prof-h">⭐ Vitrine${p.mine ? ' <button class="btn sm" id="pf-show">Choisir</button>' : ''}</div><div class="prof-cards">${slots}</div></div>
      ${p.mine ? '' : `<div class="prof-act"><button class="btn gold" id="pf-trade">🔁 Proposer un échange</button><button class="btn" id="pf-gift">🎁 Offrir une carte</button></div>`}
    </div>`;
}
function bindProfile(root, p) {
    bindMinis(root, [cardOf(p.avatar), ...p.showcase.map(cardOf)].filter(Boolean));
    if (p.mine) {
        root.querySelector('#pf-title').onchange = e => saveProfile({ title: e.target.value });
        root.querySelector('#pf-av').onclick = () => openPicker({ title: 'Choisis ton avatar', src: 'me', max: 1, done: sel => sel.length && saveProfile({ avatar: sel[0].k }) });
        root.querySelector('#pf-show').onclick = () => openPicker({ title: 'Ta vitrine : 5 cartes à montrer', src: 'me', max: 5, pre: p.showcase, done: sel => saveProfile({ showcase: sel.map(o => o.k) }) });
    } else {
        const go = gift => { if (!ME) { closeProfile(); return openAuth('register'); } closeProfile(); openTrade(p.pseudo, gift); };
        root.querySelector('#pf-trade').onclick = () => go(false);
        root.querySelector('#pf-gift').onclick = () => go(true);
    }
}
async function saveProfile(patch) {
    const j = await api('POST', '/api/profile', patch);
    if (j.error) return toast(j.error);
    S.profile = Object.assign({ avatar: null, showcase: [], title: null }, S.profile, patch);
    toast('Profil enregistré ✓');
    renderMyProfile();
}
async function renderPlayers() {
    $('#pl-guest').hidden = !!ME;
    $('#pl-mine').hidden = !ME;
    if (ME) { renderMyProfile(); renderTrades(); }
    renderPlayerList();
}
function renderMyProfile() {
    if (!ME) return;
    const p = myProfile();
    $('#pl-me').innerHTML = profileHtml(p);
    bindProfile($('#pl-me'), p);
}
let plQ = 0, plT = 0;
async function renderPlayerList() {
    const my = ++plQ, q = $('#pl-search').value.trim();
    const j = await api('GET', '/api/players?q=' + encodeURIComponent(q));
    if (my !== plQ) return;
    if (j.error) { $('#players').innerHTML = `<p class="prog">${esc(j.error)}</p>`; return; }
    $('#players').innerHTML = j.players.length ? j.players.map((p, i) => {
        const im = thumbOf(p.avatar);
        return `<button class="pl-row${p.me ? ' me' : ''}" data-p="${esc(p.pseudo)}"><span class="pl-rank">${q ? '' : i + 1}</span>
          <span class="pl-av">${im ? `<img src="${esc(im)}" alt="" loading="lazy">` : esc(p.pseudo[0] || '?')}</span>
          <span class="pl-id"><b>${esc(p.pseudo)}${p.me ? ' <small>(toi)</small>' : ''}</b>${p.title ? `<small>🏅 ${esc(p.title)}</small>` : ''}</span>
          <span class="pl-n">${fmt(p.cards)} cartes</span></button>`;
    }).join('') : '<p class="prog">Aucun joueur trouvé.</p>';
    $('#players').querySelectorAll('.pl-row').forEach(b => b.onclick = () => b.classList.contains('me') ? $('#pl-me').scrollIntoView({ behavior: 'smooth' }) : openProfile(b.dataset.p));
}
$('#pl-search').oninput = () => { clearTimeout(plT); plT = setTimeout(renderPlayerList, 250); };
$('#pl-signup').onclick = () => openAuth('register');
async function openProfile(pseudo) {
    $('#prof-body').innerHTML = '<p class="prog">Chargement…</p>';
    $('#prof').classList.add('on');
    const j = await api('GET', '/api/profile?p=' + encodeURIComponent(pseudo));
    if (j.error) { $('#prof-body').innerHTML = `<p class="prog">${esc(j.error)}</p>`; return; }
    $('#prof-body').innerHTML = profileHtml(j.profile);
    bindProfile($('#prof-body'), j.profile);
}
function closeProfile() { $('#prof').classList.remove('on'); }
$('#prof-x').onclick = closeProfile;
$('#prof').onclick = e => { if (e.target.id === 'prof') closeProfile(); };

/* --- les échanges --- */
async function renderTrades() {
    if (!ME) return;
    const j = await api('GET', '/api/trades');
    if (j.error) { $('#trades').innerHTML = `<p class="prog">${esc(j.error)}</p>`; return; }
    TRADES = j.trades;
    TRADES_IN = TRADES.filter(t => !t.mine && t.status === 'pending').length; setTradeBadge();
    $('#tr-count').textContent = TRADES_IN ? `${TRADES_IN} à répondre` : '';
    $('#trades').innerHTML = TRADES.length ? TRADES.map(tradeHtml).join('')
        : '<p class="prog">Aucun échange pour l’instant. Ouvre le profil d’un joueur pour lui proposer un échange ou lui offrir une carte.</p>';
    $('#trades').querySelectorAll('.trade-it').forEach(el => {
        const t = TRADES.find(x => x.id === +el.dataset.id);
        bindMinis(el, [...t.give, ...t.take].map(k => G.cardOfKey(k)).filter(Boolean));
        el.querySelectorAll('[data-act]').forEach(b => b.onclick = () => answerTrade(t, b.dataset.act, b));
    });
}
function tradeHtml(t) {
    const other = t.mine ? t.to : t.from, iGive = t.mine ? t.give : t.take, iGet = t.mine ? t.take : t.give;
    const cards = ks => ks.length ? ks.map(k => { const c = G.cardOfKey(k); return c ? miniHtml(c) : ''; }).join('') : '<p class="ti-none">rien</p>';
    const gift = !t.take.length;
    const head = t.mine ? (gift ? `🎁 Tu offres à <b>${esc(other)}</b>` : `📤 Tu proposes à <b>${esc(other)}</b>`) : (gift ? `🎁 <b>${esc(other)}</b> t’offre` : `📩 <b>${esc(other)}</b> te propose`);
    const pend = t.status === 'pending';
    const act = !pend ? '' : t.mine ? '<button class="btn" data-act="cancel">Annuler</button>'
        : `<button class="btn gold" data-act="accept" ${t.ok ? '' : 'disabled'}>${gift ? '🎁 Accepter le cadeau' : '✅ Accepter'}</button><button class="btn" data-act="refuse">Refuser</button>`;
    return `<div class="trade-it ${t.mine ? 'out' : 'in'} st-${t.status}" data-id="${t.id}">
      <div class="ti-head"><span>${head}</span><small>${pend ? ago(t.at) : T_STATUS[t.status] + ' · ' + ago(t.upd)}</small></div>
      <div class="ti-row">
        <div class="ti-side"><small>Tu reçois</small><div class="ti-cards">${cards(iGet)}</div></div>
        ${gift ? '' : `<div class="ti-arrow">⇄</div><div class="ti-side"><small>Tu donnes</small><div class="ti-cards">${cards(iGive)}</div></div>`}
      </div>
      ${pend && !t.ok ? '<p class="ti-warn">⚠️ Une des cartes n’est plus disponible.</p>' : ''}
      ${act ? `<div class="ti-act">${act}</div>` : ''}
    </div>`;
}
async function answerTrade(t, act, btn) {
    if (act === 'accept' && t.take.length && !confirm(`Donner ${t.take.length} carte${t.take.length > 1 ? 's' : ''} à ${t.from} ?`)) return;
    btn.disabled = true;
    const j = act === 'cancel' ? await api('POST', '/api/trade/cancel', { id: t.id }) : await api('POST', '/api/trade/answer', { id: t.id, accept: act === 'accept' });
    if (j.error) { toast(j.error); return renderTrades(); }
    if (act === 'accept') {
        applyPatch(j.patch); noteRewards(j.rewards); renderCoins();
        sfx('coins'); glowPulse('.wallet');
        const rw = (j.rewards || []).reduce((s, r) => s + r.coins, 0);
        toast(`✅ Échange fait avec ${t.from} !${rw ? ` 🏆 Palier de classeur : +${fmt(rw)} 🪙` : ''}`, 4500);
        announceCompletedAlbums(j.rewards);
        renderMyProfile();
    } else toast(act === 'cancel' ? 'Proposition annulée.' : 'Proposition refusée.');
    renderTrades();
}

/* --- préparer un échange --- */
let TB = null;
function openTrade(pseudo, gift) {
    TB = { to: pseudo, gift, give: [], take: [] };
    $('#tb-who').textContent = pseudo;
    $('#tb-title').firstChild.textContent = gift ? '🎁 Offrir à ' : '🔁 Échange avec ';
    $('#tb-take-side').hidden = gift; $('#tb-arrow').hidden = gift;
    $('#tb-err').textContent = '';
    drawTrade();
    $('#trade').classList.add('on');
}
function drawTrade() {
    const side = (l, id) => { $(id).innerHTML = l.map(o => miniHtml(cardOf(o), { x: true })).join('') || '<p class="ti-none">Aucune carte</p>'; };
    side(TB.give, '#tb-give'); side(TB.take, '#tb-take');
    for (const [l, id] of [[TB.give, '#tb-give'], [TB.take, '#tb-take']]) {
        bindMinis($(id), l.map(cardOf));
        $(id).querySelectorAll('.mini-x').forEach(x => x.onclick = () => { const k = x.parentNode.dataset.k; l.splice(l.findIndex(o => o.k === k), 1); drawTrade(); });
    }
    $('#tb-add-give').disabled = TB.give.length >= 5; $('#tb-add-take').disabled = TB.take.length >= 5;
    $('#tb-send').disabled = TB.gift ? !TB.give.length : !TB.give.length && !TB.take.length;
    $('#tb-send').textContent = TB.gift ? `🎁 Offrir ${TB.give.length > 1 ? 'ces cartes' : 'cette carte'}` : 'Envoyer la proposition';
}
$('#tb-add-give').onclick = () => openPicker({ title: TB.gift ? `Quelle carte offrir à ${TB.to} ?` : 'Tes cartes à donner', src: 'me', max: 5, pre: TB.give, dup: true, done: sel => { TB.give = sel; drawTrade(); } });
$('#tb-add-take').onclick = () => openPicker({ title: `Les cartes de ${TB.to}`, src: TB.to, max: 5, pre: TB.take, done: sel => { TB.take = sel; drawTrade(); } });
$('#tb-send').onclick = async () => {
    $('#tb-send').disabled = true;
    const j = await api('POST', '/api/trade/offer', { to: TB.to, give: TB.give.map(o => o.k), take: TB.take.map(o => o.k) });
    if (j.error) { $('#tb-err').textContent = j.error; $('#tb-send').disabled = false; return; }
    closeTrade();
    toast(TB.gift ? `🎁 Cadeau envoyé à ${TB.to} : il doit l’accepter.` : `🔁 Proposition envoyée à ${TB.to} !`, 4000);
    showTab('players');
};
function closeTrade() { $('#trade').classList.remove('on'); }
$('#tb-x').onclick = closeTrade;
$('#trade').onclick = e => { if (e.target.id === 'trade') closeTrade(); };

/* --- choisir des cartes (ma collection en local, celle d'un autre joueur par le serveur) --- */
let PK = null;
function openPicker(opt) {
    PK = { ...opt, sel: new Map((opt.pre || []).map(o => [o.k, o])), items: [], all: null, tok: 0, total: 0, first: true };
    $('#pick-title').textContent = opt.title;
    $('#pick-q').value = ''; $('#pick-dup').checked = !!opt.dup;
    $('#pick-ok').hidden = opt.max === 1;
    $('#pick').classList.add('on');
    loadPicker(true);
}
function localCollection(q, dup) {
    const out = [];
    for (const [k, o] of Object.entries(S.cards)) {
        if (dup && o.n < 2) continue;
        const c = G.cardOfKey(k);
        if (!c || (q && !(c.name + ' ' + (c.anime || '')).toLowerCase().includes(q))) continue;
        out.push({ k, n: o.n, shiny: o.shiny || 0, fin: o.fin || null, r: RANK[c.rarity] || 0 });
    }
    return out.sort((a, b) => b.r - a.r || (b.shiny > 0) - (a.shiny > 0) || (a.k < b.k ? -1 : 1));
}
async function loadPicker(reset) {
    const q = $('#pick-q').value.trim().toLowerCase(), dup = $('#pick-dup').checked, my = ++PK.tok;
    if (reset) { PK.items = []; $('#pick-grid').scrollTop = 0; }
    if (PK.src === 'me') {
        if (reset) PK.all = localCollection(q, dup);
        if (PK.first && dup && !PK.all.length) { $('#pick-dup').checked = false; PK.all = localCollection(q, false); } // pas de doublons : toutes les cartes
        PK.first = false;
        PK.items = PK.all.slice(0, PK.items.length + 60); PK.total = PK.all.length;
    } else {
        if (reset) $('#pick-grid').innerHTML = '<p class="prog">Chargement…</p>';
        const j = await api('GET', `/api/collection?p=${encodeURIComponent(PK.src)}&q=${encodeURIComponent(q)}${dup ? '&dup=1' : ''}&offset=${PK.items.length}`);
        if (!PK || my !== PK.tok) return;
        if (j.error) { $('#pick-grid').innerHTML = `<p class="prog">${esc(j.error)}</p>`; return; }
        PK.items.push(...j.cards); PK.total = j.total;
    }
    drawPicker();
}
function drawPicker() {
    const list = PK.items.map(o => ({ o, c: cardOf(o) })).filter(x => x.c);
    $('#pick-grid').innerHTML = list.length ? list.map(({ o, c }) => miniHtml(c, { sel: PK.sel.has(o.k), count: o.n })).join('') : '<p class="prog">Aucune carte.</p>';
    $('#pick-more').style.display = PK.items.length < PK.total ? '' : 'none';
    $('#pick-sel').textContent = PK.max > 1 ? `${PK.sel.size} / ${PK.max} choisie${PK.sel.size > 1 ? 's' : ''}` : 'Touche une carte';
    $('#pick-grid').querySelectorAll('.mini').forEach(el => el.onclick = () => {
        const o = PK.items.find(x => x.k === el.dataset.k);
        if (!o) return;
        if (PK.max === 1) { const done = PK.done; closePicker(); return done([o]); }
        if (PK.sel.has(o.k)) PK.sel.delete(o.k);
        else if (PK.sel.size >= PK.max) return toast(`${PK.max} cartes maximum.`);
        else PK.sel.set(o.k, o);
        el.classList.toggle('sel', PK.sel.has(o.k));
        $('#pick-sel').textContent = `${PK.sel.size} / ${PK.max} choisie${PK.sel.size > 1 ? 's' : ''}`;
    });
}
function closePicker() { $('#pick').classList.remove('on'); PK = null; }
let pickT = 0;
$('#pick-q').oninput = () => { clearTimeout(pickT); pickT = setTimeout(() => PK && loadPicker(true), 250); };
$('#pick-dup').onchange = () => PK && loadPicker(true);
$('#pick-more').onclick = () => PK && loadPicker(false);
$('#pick-ok').onclick = () => { const done = PK.done, sel = [...PK.sel.values()]; closePicker(); done(sel); };
$('#pick-x').onclick = closePicker;
$('#pick').onclick = e => { if (e.target.id === 'pick') closePicker(); };

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

/* ---------- notification spéciale : album à 100 % ---------- */
const completedAlbumsQueue = [];
let completedAlbumTimer = 0, completedAlbumClosing = false;
function announceCompletedAlbums(rewards) {
    for (const reward of rewards || []) {
        if (reward.pct === 100 && reward.u && reward.name) {
            completedAlbumsQueue.push({ u: reward.u, name: reward.name, coins: reward.coins });
        }
    }
    showNextCompletedAlbum();
}
function showNextCompletedAlbum() {
    const el = $('#album-complete-notification');
    if (!el || !el.hidden || completedAlbumClosing || !completedAlbumsQueue.length) return;
    const achievement = completedAlbumsQueue.shift();
    $('#album-complete-name').textContent = achievement.name;
    $('#album-complete-reward').textContent = `100 % des personnages collectionnés · +${fmt(achievement.coins)} 🪙`;
    el.hidden = false;
    void el.offsetWidth; // Restart the entrance animation for each completed album.
    el.classList.add('on');
    sfx('coins');
    completedAlbumTimer = setTimeout(dismissCompletedAlbum, 6500);
}
function dismissCompletedAlbum() {
    const el = $('#album-complete-notification');
    if (!el || el.hidden || completedAlbumClosing) return;
    clearTimeout(completedAlbumTimer);
    completedAlbumClosing = true;
    el.classList.remove('on');
    setTimeout(() => {
        el.hidden = true;
        completedAlbumClosing = false;
        showNextCompletedAlbum();
    }, 320);
}
$('#album-complete-close').addEventListener('click', dismissCompletedAlbum);

/* ---------- divers ---------- */
let toastT = 0;
function toast(t, ms = 2600) { const el = $('#toast'); el.textContent = t; el.classList.add('on'); clearTimeout(toastT); toastT = setTimeout(() => el.classList.remove('on'), ms); }
// petite lueur sur un élément (pièces reçues, événement) — pas de confettis
function glowPulse(sel) { const el = $(sel); if (!el) return; el.classList.remove('pulse-glow'); void el.offsetWidth; el.classList.add('pulse-glow'); }
function renderCoins() { $('#coins').textContent = fmt(S.coins); }
function currentTab() { const b = document.querySelector('nav button.on'); return b ? b.dataset.tab : 'shop'; }
function showTab(tab) {
    if (tab === 'admin' && !(ME && ME.admin)) tab = 'shop';
    if (tab === 'players' && !SERVER) tab = 'shop';
    document.querySelectorAll('nav button').forEach(x => x.classList.toggle('on', x.dataset.tab === tab));
    document.querySelectorAll('.tab').forEach(t => t.classList.toggle('on', t.id === 'tab-' + tab));
    if (tab === 'binder') renderLibrary();
    if (tab === 'stats') renderStats();
    if (tab === 'shop') renderShop();
    if (tab === 'admin') renderAdmin();
    if (tab === 'players') renderPlayers();
    if (tab === 'tcg') window.AnimeTCG?.open(ME);
}
function renderAll() { renderCoins(); renderAccount(); renderEvent(); showTab(currentTab()); }
document.querySelectorAll('nav button').forEach(b => b.onclick = () => showTab(b.dataset.tab));
setInterval(() => { renderFree(); if (EVENT.luck > 1) { if (luckNow() <= 1) setEvent(null); else renderEvent(); } }, 30e3);
$('#mute').textContent = MUTED ? '🔇' : '🔊';

Promise.all([
    fetch('cards.json').then(r => r.json()),
    fetch('/api/me', { credentials: 'same-origin' }).then(r => r.ok ? r.json() : null).catch(() => null)
]).then(([d, m]) => {
    D = d; G = Engine.create(D); U = G.U; BY_POP = G.BY_POP;
    SERVER = !!m;
    if (m && m.me) { ME = m.me; S = Object.assign(Engine.fresh(), m.state); setTimeout(ping, 1500); }
    else loadGuest();
    if (m && m.event) setEvent(m.event);
    startPing();
    renderAll();
    if (location.hash === '#tcg') showTab('tcg');
    booted = true;
}).catch(() => { $('#packs').textContent = 'Impossible de charger les cartes.'; });
})();
