/* Anime Boosters — moteur des packs (raretés, finitions et taux d'Anime Game).
   Partagé : il tourne dans le navigateur pour les invités et sur le serveur pour les comptes. */
(function (root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory();
    else root.Engine = factory();
})(typeof self !== 'undefined' ? self : this, function () {
'use strict';

const BASE = ['commune', 'rare', 'epique', 'legendaire', 'mythique'];
const BASE_LABEL = { commune: 'Commune', rare: 'Rare', epique: 'Épique', legendaire: 'Légendaire', mythique: 'Mythique' };
const BASE_COLOR = { commune: '#9aa0a6', rare: '#3fa7ff', epique: '#b44dff', legendaire: '#ffb300', mythique: '#ff3c7a' };
// raretés spéciales d'Anime Game : versions à part des persos, de plus en plus dures à avoir
// [id, nom, couleur, rang, 1 chance sur…, pièces du doublon, persos concernés par animé, règle]
//   large = beaucoup de persos (Infinity = tous), nuit = seulement de minuit à 6 h (heure de Paris),
//   top10 / top3 = seulement les 10 / 3 animés les plus populaires
const TIER_TABLE = [
    ['secrete', 'Secrète', '#00f0ff', 5, 150, 50, 3],
    ['ombre', 'Ombre', '#8a7fb8', 5.1, 500, 60, Infinity, 'large'],
    ['stellaire', 'Stellaire', '#ffe98a', 5.3, 400, 70, 2],
    ['eveillee', 'Éveillée', '#ff2d55', 5.5, 900, 100, 2],
    ['minuit', 'Minuit', '#5b6bff', 5.6, 60, 120, 5, 'nuit'],
    ['mirage', 'Mirage', '#7fffd4', 5.7, 900, 110, 60, 'large'],
    ['divine', 'Divine', '#fff3b0', 6, 600, 150, 2],
    ['eclat', 'Éclat', '#00d4ff', 6.1, 1400, 160, 40, 'large'],
    ['spectrale', 'Spectrale', '#b0fff0', 6.2, 1200, 180, 2],
    ['solaire', 'Solaire', '#ffb300', 6.4, 1700, 220, 2],
    ['lunaire', 'Lunaire', '#b8c4ff', 6.45, 1800, 230, 2],
    ['celeste', 'Céleste', '#8fe3ff', 6.5, 1500, 250, 2],
    ['heroique', 'Héroïque', '#ff4d4d', 6.7, 2400, 280, 25, 'large'],
    ['sacree', 'Sacrée', '#ff3b3b', 6.9, 2800, 350, 1],
    ['cosmique', 'Cosmique', '#7b5cff', 7, 2500, 400, 1],
    ['tempete', 'Tempête', '#4fc3ff', 7.1, 3200, 420, 1],
    ['infernale', 'Infernale', '#ff3b00', 7.2, 3500, 450, 1],
    ['onirique', 'Onirique', '#c39bff', 7.25, 4500, 520, 15, 'large'],
    ['glaciale', 'Glaciale', '#7fdcff', 7.3, 1500, 500, 1],
    ['corrompue', 'Corrompue', '#39ff14', 7.4, 5000, 550, 1],
    ['legende', 'Légende vivante', '#ff4500', 7.5, 6000, 600, 1],
    ['imperiale', 'Impériale', '#d4a017', 7.8, 8000, 800, 1],
    ['eternelle', 'Éternelle', '#ffd700', 8, 10000, 1000, 1, 'top10'],
    ['demoniaque', 'Démoniaque', '#c4002b', 8.2, 12000, 1200, 1],
    ['abyssale', 'Abyssale', '#7a00ff', 8.5, 20000, 2000, 1],
    ['ancestrale', 'Ancestrale', '#c2a878', 8.6, 25000, 2200, 1],
    ['dimensionnelle', 'Dimensionnelle', '#00ffa3', 8.8, 35000, 2500, 1],
    ['omega', 'Oméga', '#ffffff', 9, 50000, 3000, 1, 'top3'],
    ['chaos', 'Chaos', '#ff0044', 9.5, 80000, 4000, 1],
    ['primordiale', 'Primordiale', '#00ffd5', 10, 150000, 8000, 1],
    ['absolue', 'Absolue', '#fffbe6', 11, 400000, 15000, 1]
];
const SPECIAL_TIERS = TIER_TABLE.map(([id, label, color, rank, every, coins, top, rule]) => ({ id, label, color, rank, rate: 1 / every, coins, top, rule: rule || null }));
const TIER_BY_ID = Object.fromEntries(SPECIAL_TIERS.map(t => [t.id, t]));
// tirage : de la plus rare à la plus courante, comme Anime Game
const TIERS_RAREST_FIRST = SPECIAL_TIERS.slice().sort((a, b) => a.rate - b.rate);
const SEASON_COLOR = { halloween: '#ff7a00', noel: '#e8363d', valentin: '#ff6fa8', ete: '#ffc233' };
const RAR_LABEL = { ...BASE_LABEL, ...Object.fromEntries(SPECIAL_TIERS.map(t => [t.id, t.label])), saison: 'Saison', duo: 'Duo' };
const RAR_COLOR = { ...BASE_COLOR, ...Object.fromEntries(SPECIAL_TIERS.map(t => [t.id, t.color])), saison: '#ffcc00', duo: '#00e5a0' };
const RANK = { commune: 0, rare: 1, epique: 2, legendaire: 3, mythique: 4, duo: 4.5, saison: 5, ...Object.fromEntries(SPECIAL_TIERS.map(t => [t.id, t.rank])) };
const RAR = [...BASE, ...SPECIAL_TIERS.slice().sort((a, b) => a.rank - b.rank).map(t => t.id)];
// les 28 finitions d'Anime Game, de la plus rare à la plus courante (chance par carte, multipliée par la chance)
const FINISHES = [
    ['numbered', 'Numérotée', 2000], ['bloodseal', 'Sceau de sang', 1200], ['signed', 'Signée', 1000], ['crystal', 'Cristal', 900],
    ['chibi', 'Chibi', 800], ['prism', 'Prismatique', 700], ['aurora', 'Aurore boréale', 600], ['stained', 'Vitrail', 600],
    ['glitch', 'Glitch', 500], ['inverted', 'Inversée', 500], ['pixel', '8-bit', 450], ['galaxy', 'Galaxie', 400],
    ['neon', 'Néon', 350], ['goldleaf', 'Feuille d’or', 350], ['manga', 'Manga', 300], ['electric', 'Électrique', 260],
    ['fullart', 'Full Art', 250], ['fire', 'En feu', 220], ['dark', 'Dark', 200], ['retro', 'Rétro VHS', 180],
    ['frost', 'Givrée', 160], ['gold', 'Gold', 150], ['watercolor', 'Aquarelle', 140], ['sketch', 'Croquis', 120],
    ['sakura', 'Sakura', 100], ['glitter', 'Pailletée', 40], ['reverse', 'Reverse Holo', 30], ['holo', 'Holographique', 20]
].map(([id, label, every]) => ({ id, label, rate: 1 / every }));
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
    { id: 'chance', n: 10, price: 10000, emo: '👑', name: 'Pack Chance', desc: '10 cartes, chance x10 sur tout.', type: 'chance', art: 10 },
    { id: 'waifu', n: 5, price: 800, emo: '💖', name: 'Booster Waifu', desc: '5 cartes, que des waifus ! 1 épique min.', type: 'waifu', art: 11 }
];
const ANIME_PACK_PRICE = 400;
const MAX_COINS = 1e15; // reste un entier exact en JavaScript
const MAX_LUCK = 1000;

const fresh = () => ({ coins: 2000, cards: {}, opened: 0, pulled: 0, best: {}, lastFree: 0, lastDaily: '', streak: 0, god: 0, infinite: 0 });
const rnd = n => Math.floor(Math.random() * n);
const pick = a => a[rnd(a.length)];
const dayKey = t => new Date(t).toDateString();
// heure de Paris (la carte Minuit ne sort que de minuit à 6 h, comme sur Anime Game)
const PARIS = (() => { try { return new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Paris', hour: '2-digit', hourCycle: 'h23' }); } catch (_) { return null; } })();
function parisHour(now) {
    if (!PARIS) return new Date(now).getHours();
    const p = PARIS.formatToParts(new Date(now)).find(x => x.type === 'hour');
    return p ? +p.value % 24 : new Date(now).getHours();
}
const isNight = now => parisHour(now) < 6;
const tierRate = (t, now) => t.rule === 'nuit' ? (isNight(now) ? t.rate : 0) : t.rate;

function create(D) {
    const U = Object.keys(D.animes);
    for (const u of U) { const a = D.animes[u]; a.idx = new Map(a.cards.map((c, i) => [c[0], i])); a.wf = []; a.cards.forEach((c, i) => { if (c[3]) a.wf.push(i); }); }
    const BY_POP = U.filter(u => u !== 'pokedex').sort((a, b) => D.animes[b].pop - D.animes[a].pop);
    // Éternelle et Oméga : les mêmes animés que sur Anime Game (sinon les plus populaires)
    const LEG = D.legacy || {};
    const fromLegacy = (keys, n) => { const l = keys.map(k => LEG[k]).filter(k => k && D.animes[k]); return new Set(l.length ? l : BY_POP.slice(0, n)); };
    const ONLY = {
        top10: fromLegacy(['naruto', 'onepiece', 'dragonball', 'bleach', 'snk', 'jojo', 'hxh', 'demonslayer', 'jjk', 'fma'], 10),
        top3: fromLegacy(['onepiece', 'naruto', 'dragonball'], 3)
    };
    // les animés populaires tombent plus souvent
    const med = (D.animes[BY_POP[Math.floor(BY_POP.length / 4)]] || {}).pop || 1;
    const W = U.map(u => Math.sqrt(D.animes[u].pop || med)), WSUM = W.reduce((s, x) => s + x, 0);
    const PU = Object.fromEntries(U.map((u, i) => [u, W[i] / WSUM]));
    function pickAnime() { let r = Math.random() * WSUM; for (let i = 0; i < U.length; i++) { r -= W[i]; if (r <= 0) return U[i]; } return U[U.length - 1]; }
    // booster Waifu : seulement les animés qui ont des persos féminins (plus il y en a, plus l'animé sort)
    const WU = U.filter(u => D.animes[u].wf.length), WW = WU.map(u => Math.sqrt(D.animes[u].pop || med) * Math.min(3, Math.sqrt(D.animes[u].wf.length / 4))), WWSUM = WW.reduce((s, x) => s + x, 0);
    function pickWaifuAnime() { let r = Math.random() * WWSUM; for (let i = 0; i < WU.length; i++) { r -= WW[i]; if (r <= 0) return WU[i]; } return WU[WU.length - 1]; }
    const isWaifu = (u, n) => { const a = D.animes[u], i = a && a.idx.get(n); return i != null && !!a.cards[i][3]; };
    const WAIFU_COUNT = WU.reduce((s, u) => s + D.animes[u].wf.length, 0);
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

    // persos qui ont une version de cette rareté dans cet animé
    const SPECIAL_CACHE = new Map();
    function specialList(u, tierId) {
        const k = u + '|' + tierId;
        if (SPECIAL_CACHE.has(k)) return SPECIAL_CACHE.get(k);
        const a = D.animes[u], t = TIER_BY_ID[tierId];
        let list = [];
        if (a && t && !(ONLY[t.rule] && !ONLY[t.rule].has(u))) {
            const names = a.names || (a.names = a.cards.map(c => c[0]));
            const icons = u === 'pokedex' ? ['Pikachu', 'Dracaufeu', 'Mewtwo', ...names].filter((n, i, l) => a.idx.has(n) && l.indexOf(n) === i) : names;
            list = t.top === Infinity ? names : icons.slice(0, t.top);
        }
        SPECIAL_CACHE.set(k, list);
        return list;
    }

    const baseCard = (u, i, shiny) => { const [n, r] = D.animes[u].cards[i]; return { key: u + '|' + n, u, name: n, anime: D.animes[u].name, rarity: r, shiny }; };
    const specialCard = (u, n, tier, shiny) => ({ key: u + '|' + n + '|' + tier, u, name: n, anime: D.animes[u].name, rarity: tier, shiny });
    const seasonCard = (id, u, n, shiny) => ({ key: 'saison:' + id + '|' + u + '|' + n, u, name: n, anime: D.animes[u].name, rarity: 'saison', season: id, shiny });
    const duoOf = (d, shiny) => ({ key: 'duo|' + d.name, name: d.name, anime: D.animes[d.a[0]].name, rarity: 'duo', duo: [imgOf(...d.a), imgOf(...d.b)], shiny });
    const DUO_NAMES = new Set(D.duos.map(d => d.name));
    const SEASON_KEYS = new Set(Object.keys(D.seasons).flatMap(id => seasonChars(id).map(([u, n]) => 'saison:' + id + '|' + u + '|' + n)));
    // une carte existe-t-elle ? (pour vérifier une collection importée)
    function validKey(k) {
        if (k.startsWith('duo|')) return DUO_NAMES.has(k.slice(4));
        if (k.startsWith('saison:')) return SEASON_KEYS.has(k);
        const [u, n, tier, extra] = k.split('|');
        const a = D.animes[u];
        if (extra !== undefined || !a || !a.idx.has(n)) return false;
        return !tier || specialList(u, tier).includes(n);
    }
    // ce que représente une clé de carte (pour l'affichage)
    function cardOfKey(k) {
        if (k.startsWith('duo|')) { const d = D.duos.find(x => x.name === k.slice(4)); return d ? duoOf(d) : null; }
        if (k.startsWith('saison:')) { const [head, u, n] = k.split('|'); return D.animes[u] ? seasonCard(head.slice(7), u, n) : null; }
        const [u, n, tier] = k.split('|');
        const a = D.animes[u]; if (!a || !a.idx.has(n)) return null;
        return tier ? specialCard(u, n, tier) : baseCard(u, a.idx.get(n));
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
            const sp = TIER_BY_ID[c.rarity];
            c.coins = sp ? sp.coins : c.rarity === 'duo' ? 60 : c.rarity === 'saison' ? 50 : (c.shiny ? 10 : 2) * (c.rarity === 'mythique' ? 3 : 1);
            S.coins = Math.min(MAX_COINS, S.coins + c.coins);
        }
        S.pulled++;
        S.best[c.rarity] = (S.best[c.rarity] || 0) + 1;
        return c;
    }
    function randomOfRarity(rar, waifu) {
        const sp = TIER_BY_ID[rar];
        for (let t = 0; t < 60; t++) {
            const u = waifu ? pickWaifuAnime() : pickAnime(), a = D.animes[u];
            if (sp) { const l = specialList(u, rar).filter(n => !waifu || isWaifu(u, n)); if (l.length) return specialCard(u, pick(l), rar, Math.random() < 0.3); continue; }
            const idx = []; a.cards.forEach((c, i) => { if (c[1] === rar && (!waifu || c[3])) idx.push(i); });
            if (idx.length) return baseCard(u, pick(idx), Math.random() < 0.3);
        }
        return null;
    }
    const packLuck = (p, boost) => (p.type === 'chance' ? 10 : 1) * Math.max(1, Math.min(MAX_LUCK, boost || 1));
    function openPack(S, p, now, boost) {
        const luck = packLuck(p, boost), n = p.n, waifu = p.type === 'waifu' && WU.length > 0;
        // God Pack : que des cartes très rares (que des waifus dans le booster Waifu)
        if (n >= 3 && Math.random() < Math.min(0.2, GOD_PACK_RATE * luck)) {
            const out = [];
            for (let i = 0; i < n; i++) {
                const r = Math.random(), rar = r < 0.02 ? 'cosmique' : r < 0.06 ? 'divine' : r < 0.14 ? 'eveillee' : r < 0.3 ? 'secrete' : r < 0.6 ? 'mythique' : 'legendaire';
                const c = randomOfRarity(rar, waifu) || randomOfRarity('legendaire', waifu); if (c) out.push(award(S, c, luck));
            }
            S.god++; out.god = true;
            return out;
        }
        const mult = (p.type === 'mythique' ? 4 : p.type === 'epique' ? 2 : 1) * luck;
        const minRank = p.type === 'mythique' ? 3 : p.type === 'epique' || p.anime || waifu ? 2 : n >= 10 ? 1 : 0;
        if (waifu) return openWaifu(S, p, luck, mult, minRank, now);
        const act = Object.keys(D.seasons).filter(id => seasonActive(id, now) && seasonChars(id).length);
        const out = [];
        for (let i = 0; i < n; i++) {
            const u = p.anime || pickAnime(), a = D.animes[u], last = i === n - 1;
            if (last && p.type === 'duo' && D.duos.length && !out.some(c => c.rarity === 'duo')) { out.push(award(S, duoOf(pick(D.duos), Math.random() < SHINY_RATE), luck)); continue; }
            if (last && p.type === 'season' && !out.some(c => c.season === p.season) && seasonChars(p.season).length) {
                const [su, sn] = pick(seasonChars(p.season)); out.push(award(S, seasonCard(p.season, su, sn, Math.random() < 0.2), luck)); continue;
            }
            let special = null;
            for (const t of TIERS_RAREST_FIRST) {
                if (Math.random() >= tierRate(t, now) * mult) continue;
                let cu = u;
                if (!specialList(u, t.id).length) {
                    if (p.anime) continue;
                    const cands = (ONLY[t.rule] ? [...ONLY[t.rule]] : BY_POP.slice(0, 10)).filter(x => specialList(x, t.id).length);
                    if (!cands.length) continue;
                    cu = pick(cands);
                }
                special = specialCard(cu, pick(specialList(cu, t.id)), t.id, Math.random() < Math.min(0.9, luck / 10));
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

    // booster Waifu : que des persos féminins, versions spéciales comprises
    function openWaifu(S, p, luck, mult, minRank, now) {
        const out = [];
        for (let i = 0; i < p.n; i++) {
            const u = pickWaifuAnime(), a = D.animes[u], last = i === p.n - 1;
            let special = null;
            for (const t of TIERS_RAREST_FIRST) {
                if (Math.random() >= tierRate(t, now) * mult) continue;
                let l = specialList(u, t.id).filter(n => isWaifu(u, n)), cu = u;
                if (!l.length) { // cette rareté ne touche pas de waifu de cet animé : on en cherche une ailleurs
                    for (let k = 0; k < 30 && !l.length; k++) { cu = pickWaifuAnime(); l = specialList(cu, t.id).filter(n => isWaifu(cu, n)); }
                    if (!l.length) continue;
                }
                special = specialCard(cu, pick(l), t.id, Math.random() < Math.min(0.9, luck / 10));
                break;
            }
            if (special) { out.push(award(S, special, luck)); continue; }
            // les waifus les plus aimées tombent plus souvent
            const wf = a.wf, L = wf.length;
            let idx = wf[Math.min(L - 1, Math.floor(Math.pow(Math.random(), 1.6 / Math.sqrt(luck)) * L))];
            if (last && minRank && !out.some(c => (RANK[c.rarity] || 0) >= minRank)) {
                for (let k = 0; k < 40; k++) {
                    const u2 = k ? pickWaifuAnime() : u, ok = D.animes[u2].wf.filter(j => RANK[D.animes[u2].cards[j][1]] >= minRank);
                    if (ok.length) { out.push(award(S, baseCard(u2, pick(ok), Math.random() < Math.min(0.9, SHINY_RATE * luck)), luck)); idx = -1; break; }
                }
                if (idx === -1) continue;
            }
            out.push(award(S, baseCard(u, idx, Math.random() < Math.min(0.9, SHINY_RATE * luck)), luck));
        }
        return out;
    }
    const waifuArt = () => { for (const u of BY_POP) { const a = D.animes[u]; if (a.wf.length) return imgUrl(a.cards[a.wf[0]][2]); } return null; };

    /* ---------- chances d'obtention (calculées avec les mêmes règles que le tirage) ---------- */
    // pour une carte tirée dans un pack normal (Pack Infini, boosters 3 / 10…)
    function slotOdds(boost = 1, packType = '', now = Date.now()) {
        const luck = packLuck({ type: packType }, boost), mult = (packType === 'mythique' ? 4 : packType === 'epique' ? 2 : 1) * luck;
        let rest = 1; const tiers = {};
        for (const t of TIERS_RAREST_FIRST) { const q = Math.min(1, tierRate(t, now) * mult); tiers[t.id] = rest * q; rest *= 1 - q; }
        const duo = D.duos.length ? rest * Math.min(0.3, DUO_RATE * luck) : 0; rest -= duo;
        const act = Object.keys(D.seasons).filter(id => seasonActive(id, now) && seasonChars(id).length);
        const season = act.length ? rest * Math.min(0.3, SEASON_RATE * luck) : 0; rest -= season;
        return { luck, tiers, duo, season, base: rest, act };
    }
    // part de chaque rareté de base parmi les cartes « normales »
    const BASE_SHARE = new Map();
    function baseShare(luck) {
        if (BASE_SHARE.has(luck)) return BASE_SHARE.get(luck);
        const e = Math.sqrt(luck) / 1.6, out = Object.fromEntries(BASE.map(r => [r, 0]));
        for (const u of U) {
            const a = D.animes[u], L = a.cards.length;
            let prev = 0;
            for (let i = 0; i < L; i++) { const c = Math.pow((i + 1) / L, e); out[a.cards[i][1]] += PU[u] * (c - prev); prev = c; }
        }
        BASE_SHARE.set(luck, out);
        return out;
    }
    function chanceOf(card, boost = 1, now = Date.now()) {
        const o = slotOdds(boost, '', now);
        if (card.rarity === 'duo') return o.duo / Math.max(1, D.duos.length);
        if (card.rarity === 'saison') {
            if (!o.act.includes(card.season)) return 0;
            return o.season / o.act.length / Math.max(1, seasonChars(card.season).length);
        }
        const t = TIER_BY_ID[card.rarity];
        if (t) {
            const list = specialList(card.u, t.id);
            if (!list.length) return 0;
            let pu = PU[card.u] || 0;
            if (ONLY[t.rule]) { // un animé sans cette rareté renvoie vers les animés qui l'ont
                const allowed = [...ONLY[t.rule]];
                pu += (1 - allowed.reduce((s, x) => s + (PU[x] || 0), 0)) / allowed.length;
            }
            return o.tiers[t.id] * pu / list.length;
        }
        const a = D.animes[card.u], i = a ? a.idx.get(card.name) : null;
        if (i == null) return 0;
        const e = Math.sqrt(o.luck) / 1.6, L = a.cards.length;
        return o.base * (PU[card.u] || 0) * (Math.pow((i + 1) / L, e) - Math.pow(i / L, e));
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
    function buy(S, id, now = Date.now(), boost = 1) {
        const p = packFor(id, now);
        if (!p) return { ok: false, error: 'Ce booster n’est pas disponible.' };
        if (p.free && freeLeft(S, now) > 0) return { ok: false, error: 'Le booster gratuit n’est pas encore prêt.' };
        if (p.price && S.coins < p.price) return { ok: false, error: 'Pas assez de pièces !' };
        S.coins -= p.price || 0;
        if (p.free) S.lastFree = now;
        S.opened++; if (p.infinite) S.infinite++;
        const cards = openPack(S, p, now, boost);
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
        const price = k => { const t = TIER_BY_ID[k.split('|')[2]]; return t ? t.coins : k.startsWith('duo|') ? 60 : k.startsWith('saison:') ? 50 : 5; };
        let total = 0, n = 0;
        for (const [k, o] of Object.entries(S.cards)) if (o.n > 1) { total += (o.n - 1) * price(k); n += o.n - 1; o.n = 1; }
        S.coins = Math.min(MAX_COINS, S.coins + total);
        return { ok: true, n, total };
    }

    return { D, U, BY_POP, PU, WU, WAIFU_COUNT, isWaifu, waifuArt, imgUrl, imgOf, seasonActive, seasonChars, specialList, baseCard, specialCard, seasonCard, duoOf, cardOfKey, animePack, packFor, freeLeft, buy, dailyAmount, claimDaily, sellDupes, validKey, dayKey, slotOdds, baseShare, chanceOf, isNight };
}

return { BASE, RAR, RAR_LABEL, RAR_COLOR, RANK, SPECIAL_TIERS, TIER_BY_ID, SEASON_COLOR, FINISHES, FIN_IDX, GOD_PACK_RATE, DUO_RATE, SEASON_RATE, SHINY_RATE, FREE_EVERY, SEASON_EMO, INFINITE, FREE_PACK, PACKS, ANIME_PACK_PRICE, MAX_COINS, MAX_LUCK, fresh, dayKey, isNight, create };
});
