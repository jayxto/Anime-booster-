/* Anime Boosters — moteur des packs (même système qu'Anime Game).
   Partagé : il tourne dans le navigateur pour les invités et sur le serveur pour les comptes. */
(function (root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory();
    else root.Engine = factory();
})(typeof self !== 'undefined' ? self : this, function () {
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
const FREE_PACK = { id: 'free', n: 10, price: 0, free: true, emo: '🎁', name: 'Booster gratuit', art: 0 };
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
const MAX_COINS = 1e15; // reste un entier exact en JavaScript

const fresh = () => ({ coins: 2000, cards: {}, opened: 0, pulled: 0, best: {}, lastFree: 0, lastDaily: '', streak: 0, god: 0, infinite: 0 });
const rnd = n => Math.floor(Math.random() * n);
const pick = a => a[rnd(a.length)];
const dayKey = t => new Date(t).toDateString();

function create(D) {
    const U = Object.keys(D.animes);
    for (const u of U) { const a = D.animes[u]; a.idx = new Map(a.cards.map((c, i) => [c[0], i])); }
    const BY_POP = U.filter(u => u !== 'pokedex').sort((a, b) => D.animes[b].pop - D.animes[a].pop);
    // les animés populaires tombent plus souvent
    const med = (D.animes[BY_POP[Math.floor(BY_POP.length / 4)]] || {}).pop || 1;
    const W = U.map(u => Math.sqrt(D.animes[u].pop || med)), WSUM = W.reduce((s, x) => s + x, 0);
    function pickAnime() { let r = Math.random() * WSUM; for (let i = 0; i < U.length; i++) { r -= W[i]; if (r <= 0) return U[i]; } return U[U.length - 1]; }
    const imgUrl = p => !p ? null : /^https?:/.test(p) ? p : D.imgPrefix + p;
    const imgOf = (u, n) => { const a = D.animes[u]; const i = a && a.idx.get(n); return i == null ? null : imgUrl(a.cards[i][2]); };
    function seasonActive(id, now = Date.now()) {
        const s = D.seasons[id]; if (!s) return false;
        const d = new Date(now);
        if (id === 'halloween') return d.getMonth() === 9;
        if (!s.from) return false;
        const v = d.getMonth() * 100 + d.getDate(), a = s.from[0] * 100 + s.from[1], b = s.to[0] * 100 + s.to[1];
        return a <= b ? v >= a && v <= b : v >= a || v <= b;
    }
    const seasonChars = id => (D.seasons[id] && D.seasons[id].chars) || [];

    const baseCard = (u, i, shiny) => { const [n, r] = D.animes[u].cards[i]; return { key: u + '|' + n, u, name: n, anime: D.animes[u].name, rarity: r, shiny }; };
    const specialCard = (u, n, tier, shiny) => ({ key: u + '|' + n + '|' + tier, u, name: n, anime: D.animes[u].name, rarity: tier, shiny });
    const seasonCard = (id, u, n, shiny) => ({ key: 'saison:' + id + '|' + u + '|' + n, u, name: n, anime: D.animes[u].name, rarity: 'saison', season: id, shiny });
    const duoOf = (d, shiny) => ({ key: 'duo|' + d.name, name: d.name, anime: D.animes[d.a[0]].name, rarity: 'duo', duo: [imgOf(...d.a), imgOf(...d.b)], shiny });

    // toutes les cartes qui existent (pour vérifier une collection importée)
    let VALID = null;
    function validKey(k) {
        if (!VALID) {
            VALID = new Set();
            for (const u of U) {
                const a = D.animes[u];
                for (const c of a.cards) VALID.add(u + '|' + c[0]);
                for (const t of SPECIAL_TIERS) for (const n of a.specials[t.id] || []) VALID.add(u + '|' + n + '|' + t.id);
            }
            for (const id of Object.keys(D.seasons)) for (const [u, n] of seasonChars(id)) VALID.add('saison:' + id + '|' + u + '|' + n);
            for (const d of D.duos) VALID.add('duo|' + d.name);
        }
        return VALID.has(k);
    }

    /* ---------- tirage ---------- */
    function rollFinish(luck) { for (const f of FINISHES) if (Math.random() < Math.min(0.5, f.rate * luck)) return f.id; return null; }
    function award(S, c, luck) {
        c.finish = rollFinish(luck);
        const o = S.cards[c.key];
        c.isNew = !o;
        if (o) { o.n++; if (c.shiny) o.shiny++; if (c.finish && (!o.fin || FIN_IDX[c.finish] < FIN_IDX[o.fin])) o.fin = c.finish; }
        else S.cards[c.key] = { n: 1, shiny: c.shiny ? 1 : 0, fin: c.finish || null };
        c.coins = 0;
        if (!c.isNew) {
            const sp = SPECIAL_TIERS.find(t => t.id === c.rarity);
            c.coins = sp ? sp.coins : c.rarity === 'duo' ? 60 : c.rarity === 'saison' ? 50 : (c.shiny ? 10 : 2) * (c.rarity === 'mythique' ? 3 : 1);
            S.coins = Math.min(MAX_COINS, S.coins + c.coins);
        }
        S.pulled++;
        S.best[c.rarity] = (S.best[c.rarity] || 0) + 1;
        return c;
    }
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
    function openPack(S, p, now) {
        const luck = p.type === 'chance' ? 10 : 1, n = p.n;
        // God Pack : que des cartes très rares
        if (n >= 3 && Math.random() < Math.min(0.2, GOD_PACK_RATE * luck)) {
            const out = [];
            for (let i = 0; i < n; i++) {
                const r = Math.random(), rar = r < 0.02 ? 'cosmique' : r < 0.06 ? 'divine' : r < 0.3 ? 'secrete' : r < 0.6 ? 'mythique' : 'legendaire';
                const c = randomOfRarity(rar); if (c) out.push(award(S, c, luck));
            }
            S.god++; out.god = true;
            return out;
        }
        const mult = (p.type === 'mythique' ? 4 : p.type === 'epique' ? 2 : 1) * luck;
        const minRank = p.type === 'mythique' ? 3 : p.type === 'epique' || p.anime ? 2 : n >= 10 ? 1 : 0;
        const act = Object.keys(D.seasons).filter(id => seasonActive(id, now) && seasonChars(id).length);
        const out = [];
        for (let i = 0; i < n; i++) {
            const u = p.anime || pickAnime(), a = D.animes[u], last = i === n - 1;
            if (last && p.type === 'duo' && D.duos.length && !out.some(c => c.rarity === 'duo')) { out.push(award(S, duoOf(pick(D.duos), Math.random() < SHINY_RATE), luck)); continue; }
            if (last && p.type === 'season' && !out.some(c => c.season === p.season) && seasonChars(p.season).length) {
                const [su, sn] = pick(seasonChars(p.season)); out.push(award(S, seasonCard(p.season, su, sn, Math.random() < 0.2), luck)); continue;
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
            if (special) { out.push(award(S, special, luck)); continue; }
            if (!p.anime && D.duos.length && Math.random() < Math.min(0.3, DUO_RATE * luck)) { out.push(award(S, duoOf(pick(D.duos), Math.random() < SHINY_RATE), luck)); continue; }
            if (!p.anime && act.length && Math.random() < Math.min(0.3, SEASON_RATE * luck)) {
                const id = pick(act), [su, sn] = pick(seasonChars(id));
                out.push(award(S, seasonCard(id, su, sn, Math.random() < Math.min(0.9, luck / 10)), luck)); continue;
            }
            // les persos connus tombent plus souvent, les rares moins (la chance rapproche des cartes rares)
            const L = a.cards.length;
            let idx = Math.min(L - 1, Math.floor(Math.pow(Math.random(), 1.6 / Math.sqrt(luck)) * L));
            if (last && minRank && !out.some(c => (RANK[c.rarity] || 0) >= minRank)) {
                const ok = []; a.cards.forEach((c, j) => { if (RANK[c[1]] >= minRank) ok.push(j); });
                if (ok.length) idx = pick(ok);
            }
            out.push(award(S, baseCard(u, idx, Math.random() < Math.min(0.9, SHINY_RATE * luck)), luck));
        }
        return out;
    }

    /* ---------- actions du joueur ---------- */
    const animePack = u => D.animes[u] ? { id: 'anime:' + u, anime: u, n: 5, price: ANIME_PACK_PRICE, emo: '📦', name: D.animes[u].name, desc: `${D.animes[u].cards.length} persos · 1 épique min.` } : null;
    function packFor(id, now = Date.now()) {
        if (id === 'infinite') return INFINITE;
        if (id === 'free') return FREE_PACK;
        if (String(id).startsWith('anime:')) return animePack(String(id).slice(6));
        const p = PACKS.find(x => x.id === id);
        return p && (p.type !== 'season' || seasonActive(p.season, now)) ? p : null;
    }
    const freeLeft = (S, now = Date.now()) => Math.max(0, (S.lastFree || 0) + FREE_EVERY - now);
    function buy(S, id, now = Date.now()) {
        const p = packFor(id, now);
        if (!p) return { ok: false, error: 'Ce booster n’est pas disponible.' };
        if (p.free && freeLeft(S, now) > 0) return { ok: false, error: 'Le booster gratuit n’est pas encore prêt.' };
        if (p.price && S.coins < p.price) return { ok: false, error: 'Pas assez de pièces !' };
        S.coins -= p.price || 0;
        if (p.free) S.lastFree = now;
        S.opened++; if (p.infinite) S.infinite++;
        const cards = openPack(S, p, now);
        return { ok: true, pack: p, cards, god: !!cards.god };
    }
    const dailyAmount = S => 500 + Math.min(S.streak || 0, 10) * 100;
    function claimDaily(S, now = Date.now()) {
        const today = dayKey(now), yest = dayKey(now - 864e5);
        if (S.lastDaily === today) return { ok: false, error: 'Déjà récupéré aujourd’hui.' };
        S.streak = S.lastDaily === yest ? (S.streak || 0) + 1 : 1;
        const amount = dailyAmount(S);
        S.coins = Math.min(MAX_COINS, S.coins + amount); S.lastDaily = today;
        return { ok: true, amount };
    }
    function sellDupes(S) {
        const price = k => { const r = k.split('|')[2]; const t = SPECIAL_TIERS.find(x => x.id === r); return t ? t.coins : k.startsWith('duo|') ? 60 : k.startsWith('saison:') ? 50 : 5; };
        let total = 0, n = 0;
        for (const [k, o] of Object.entries(S.cards)) if (o.n > 1) { total += (o.n - 1) * price(k); n += o.n - 1; o.n = 1; }
        S.coins = Math.min(MAX_COINS, S.coins + total);
        return { ok: true, n, total };
    }

    return { D, U, BY_POP, imgUrl, imgOf, seasonActive, seasonChars, baseCard, specialCard, seasonCard, duoOf, animePack, packFor, freeLeft, buy, dailyAmount, claimDaily, sellDupes, validKey, dayKey };
}

return { RAR, RAR_LABEL, RANK, SPECIAL_TIERS, FINISHES, FIN_IDX, GOD_PACK_RATE, DUO_RATE, SEASON_RATE, SHINY_RATE, FREE_EVERY, SEASON_EMO, INFINITE, FREE_PACK, PACKS, ANIME_PACK_PRICE, MAX_COINS, fresh, dayKey, create };
});
