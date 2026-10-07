// Construit public/cards.json à partir de tools/anilist.json (animés + leurs persos AniList)
// + le Pokédex d'Anime Game, avec les noms, raretés, cartes de saison et Duos d'Anime Game.
// Usage : node tools/build-cards.js
const fs = require('fs');
const path = require('path');
const T = f => path.join(__dirname, f);

const anilist = require(process.env.ANILIST || T('anilist.json')); // ANILIST=… : autre fichier de données (essais)
const pool = require(T('pool.json'));
const extra = require(T('extra.json'));
const halloween = require(T('halloween.json'));
const IMG_PREFIX = 'https://s4.anilist.co/file/anilistcdn/character/large/';
const short = u => u && u.startsWith(IMG_PREFIX) ? u.slice(IMG_PREFIX.length) : u;

// même répartition que cardRarity() d'Anime Game : persos connus = communes,
// leurs versions spéciales (Secrète, Divine…) sont les cartes les plus rares
const rarityAt = (i, n) => { const f = i / Math.max(1, n); return f < 0.35 ? 'commune' : f < 0.65 ? 'rare' : f < 0.88 ? 'epique' : f < 0.97 ? 'legendaire' : 'mythique'; };

const deaccent = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '');
const slug = s => deaccent(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40);
// clé d'un nom : mots triés, sans accents ni particules d'une lettre (« Monkey D. Luffy » = « Luffy Monkey »)
const tokens = s => deaccent(s).toLowerCase().replace(/uchiwa/g, 'uchiha').replace(/[^a-z0-9 ]+/g, ' ').replace(/ou|oo/g, 'o').replace(/uu/g, 'u').split(/\s+/).filter(w => w.length > 1);
const keyOf = s => tokens(s).sort().join(' ');

// espaces en trop ou retours à la ligne dans certains noms AniList (les anciens noms gardent leur forme exacte)
const tidy = s => String(s || '').replace(/\s+/g, ' ').trim();
const list = anilist.map(f => ({ ...f, chars: f.chars.map(c => ({ ...c, display: tidy(c.name), key: keyOf(c.name) })) }));

// version précédente du jeu (tools/cache/anilist-v1.json + cards-v1.json) : on garde les mêmes clés d'animés,
// les mêmes noms de persos et toutes les anciennes cartes, pour que les collections des joueurs restent valables
const V1 = fs.existsSync(T('cache/anilist-v1.json')) && fs.existsSync(T('cache/cards-v1.json'));
const oldAnilist = V1 ? JSON.parse(fs.readFileSync(T('cache/anilist-v1.json'), 'utf8')) : [];
const oldCards = V1 ? JSON.parse(fs.readFileSync(T('cache/cards-v1.json'), 'utf8')) : { animes: {} };
const oldKeyOfRoot = new Map(), oldDisplayOfChar = new Map();
{
    const taken = new Set();
    for (const f of oldAnilist) {
        let k = slug(f.romaji || f.title) || 'a' + f.id;
        if (taken.has(k)) k += '-' + f.id;
        taken.add(k); oldKeyOfRoot.set(f.id, k);
        const old = oldCards.animes[k];
        if (!old) continue;
        const byImg = new Map(old.cards.map(c => [c[2], c[0]]));
        for (const c of f.chars) { const d = byImg.get(short(c.img)); if (d) oldDisplayOfChar.set(c.id, d); }
    }
}

// noms d'Anime Game : chaque ancien animé est rattaché à la franchise AniList qui partage le plus de persos
const used = new Set();
const olds = Object.entries(pool).filter(([u]) => u !== 'pokemon').sort((a, b) => b[1].cards.length - a[1].cards.length);
let renamed = 0;
const legacyIds = {}; // ancien animé d'Anime Game -> franchise AniList
if (V1) {
    // les noms d'Anime Game ont déjà été retrouvés dans la version précédente : on les reprend tels quels
    for (const f of list) for (const c of f.chars) { const d = oldDisplayOfChar.get(c.id); if (d) { c.display = d; renamed++; } }
    for (const f of list) { const ok = (f.members || [f.id]).find(id => oldKeyOfRoot.has(id)); if (ok != null) f.oldKey = oldKeyOfRoot.get(ok); }
}
for (const [oldKey, old] of V1 ? [] : olds) {
    const oldKeys = new Map(old.cards.flatMap(c => [[keyOf(c.raw || c.n), c.n], [keyOf(c.n), c.n]])); // nom d'origine et nom affiché
    let best = null, bestN = 0;
    for (const f of list) {
        if (used.has(f.id)) continue;
        let n = 0;
        for (const c of f.chars.slice(0, 60)) if (oldKeys.has(c.key)) n++;
        if (n > bestN) { best = f; bestN = n; }
    }
    if (!best || bestN < 4) continue;
    used.add(best.id);
    legacyIds[oldKey] = best.id;
    best.title = /^Fate\//.test(old.anime) ? 'Fate' : old.anime; // toute la saga Fate est regroupée
    const taken = new Set();
    const oldToks = old.cards.map(c => ({ n: c.n, t: new Set([...tokens(c.n), ...tokens(c.raw)]) }));
    for (const c of best.chars) {
        let o = oldKeys.get(c.key);
        if (!o || taken.has(o)) {
            // « Levi » ↔ « Levi Ackerman » : seulement si un seul ancien nom contient tous les mots
            const t = tokens(c.name);
            const m = t.length ? oldToks.filter(x => !taken.has(x.n) && t.every(w => x.t.has(w))) : [];
            o = m.length === 1 ? m[0].n : null;
        }
        if (o) { c.display = o; taken.add(o); renamed++; }
    }
}

const animes = {}, keyOfId = {};
const oldKeys = new Set(Object.keys(oldCards.animes));
let kept = 0, added = 0;
for (const f of list) {
    let k = f.oldKey && !animes[f.oldKey] ? f.oldKey : null;
    if (!k) { k = slug(f.romaji || f.title) || 'a' + f.id; if (animes[k] || oldKeys.has(k)) k += '-' + f.id; }
    keyOfId[f.id] = k;
    const old = k === f.oldKey ? oldCards.animes[k] : null;
    if (old) f.title = old.name; // nom d'Anime Game ou nom déjà affiché
    const seen = new Set();
    let cards = f.chars.filter(c => !seen.has(c.display) && seen.add(c.display));
    if (old) {
        // les anciennes cartes d'abord, dans le même ordre (mêmes versions spéciales), puis les nouveaux persos
        const byName = new Map(cards.map(c => [c.display, c]));
        const head = old.cards.map(oc => byName.get(oc[0]) || { display: oc[0], img: oc[2], g: oc[3] ? 'F' : null });
        const inHead = new Set(old.cards.map(oc => oc[0]));
        const tail = cards.filter(c => !inHead.has(c.display));
        kept += head.length; added += tail.length;
        cards = head.concat(tail);
    } else added += cards.length;
    // 4e case : 1 = perso féminin (booster Waifu)
    animes[k] = { name: f.title, color: f.color || null, cover: f.cover, pop: f.popularity, cards: cards.map((c, i) => { const t = [c.display, rarityAt(i, cards.length), short(c.img)]; if (c.g === 'F') t.push(1); return t; }) };
}
// un animé de la version précédente qui ne serait plus retrouvé est gardé tel quel
if (V1) for (const [k, a] of Object.entries(oldCards.animes)) if (!animes[k] && k !== 'pokedex') { animes[k] = a; kept += a.cards.length; }
// Pokédex d'Anime Game (illustrations officielles)
if (pool.pokemon) {
    animes.pokedex = { name: 'Pokémon — Pokédex', color: '#ffcb05', cover: extra.poke.Pikachu, pop: 0, cards: pool.pokemon.cards.map(c => [c.n, c.r, extra.poke[c.n] || null]).filter(c => c[2]) };
}

// cartes de saison et Duos d'Anime Game : on retrouve chaque perso par son nom
const index = new Map(), first = new Map();
for (const [k, a] of Object.entries(animes)) a.cards.forEach(c => {
    const n = keyOf(c[0]); if (n && !index.has(n)) index.set(n, [k, c[0]]);
    const f = keyOf(c[0].split(' ')[0]); if (f && !first.has(f)) first.set(f, [k, c[0]]);
});
const resolve = name => index.get(keyOf(name)) || (tokens(name).length === 1 ? first.get(keyOf(name)) : null) || null;

let seasons = {};
const defs = { halloween: { label: 'Halloween', chars: halloween }, ...extra.season };
for (const [id, s] of Object.entries(defs)) {
    const seen = new Set();
    const chars = s.chars.map(([, n]) => resolve(n)).filter(c => c && !seen.has(c.join('|')) && seen.add(c.join('|')));
    seasons[id] = { label: s.label, from: s.from, to: s.to, chars };
}
let duos = [];
for (const d of extra.duo) {
    const [a, b] = d.name.split(/\s*&\s*/);
    const ra = resolve(a), rb = resolve(b || '');
    if (ra && rb) duos.push({ name: d.name, a: ra, b: rb });
}

let legacy = Object.fromEntries(Object.entries(legacyIds).map(([o, id]) => [o, keyOfId[id]]));
// cartes de saison, Duos et animés d'Anime Game : exactement comme dans la version précédente
if (V1) { seasons = oldCards.seasons; duos = oldCards.duos; legacy = oldCards.legacy; }
const out = { v: 3, imgPrefix: IMG_PREFIX, animes, seasons, duos, legacy };
fs.writeFileSync(path.join(__dirname, '..', 'public', 'cards.json'), JSON.stringify(out));
const total = Object.values(animes).reduce((s, a) => s + a.cards.length, 0);
const waifus = Object.values(animes).reduce((s, a) => s + a.cards.filter(c => c[3]).length, 0);
if (V1) console.log(`anciennes cartes gardées : ${kept}, nouveaux persos : ${added}`);
console.log(`${Object.keys(animes).length} animés, ${total} persos dont ${waifus} waifus (${renamed} noms repris, ${used.size} animés d'Anime Game retrouvés), ${duos.length} duos, saisons : ${Object.entries(seasons).map(([k, s]) => k + ' ' + s.chars.length).join(', ')}`);
