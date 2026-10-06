// Construit public/cards.json à partir de tools/anilist.json (animés + leurs persos AniList)
// + le Pokédex d'Anime Game, avec les raretés, cartes de saison et Duos d'Anime Game.
// Usage : node tools/build-cards.js
const fs = require('fs');
const path = require('path');
const T = f => path.join(__dirname, f);

const anilist = require(T('anilist.json'));
const pool = require(T('pool.json'));
const extra = require(T('extra.json'));
const halloween = require(T('halloween.json'));
const IMG_PREFIX = 'https://s4.anilist.co/file/anilistcdn/character/large/';
const short = u => u && u.startsWith(IMG_PREFIX) ? u.slice(IMG_PREFIX.length) : u;

// même répartition que cardRarity() d'Anime Game
const rarityAt = (i, n) => { const f = i / Math.max(1, n); return f < 0.35 ? 'commune' : f < 0.65 ? 'rare' : f < 0.88 ? 'epique' : f < 0.97 ? 'legendaire' : 'mythique'; };
// comme dans Anime Game : persos connus = communes, leurs versions spéciales sont les plus rares
const rarityOf = rarityAt;

const slug = s => String(s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40);
const animes = {};
for (const f of anilist) {
    let k = slug(f.romaji || f.title) || 'a' + f.id;
    if (animes[k]) k += '-' + f.id;
    const n = f.chars.length;
    animes[k] = { name: f.title, color: f.color || null, cover: f.cover, pop: f.popularity, cards: f.chars.map((c, i) => [c.name, rarityOf(i, n), short(c.img)]) };
}
// Pokédex d'Anime Game (illustrations officielles)
if (pool.pokemon) {
    animes.pokedex = { name: 'Pokémon — Pokédex', color: '#ffcb05', cover: extra.poke.Pikachu, pop: 0, cards: pool.pokemon.cards.map(c => [c.n, c.r, extra.poke[c.n] || null]).filter(c => c[2]) };
}

// raretés spéciales : versions à part des persos les plus aimés de chaque animé
const byPop = Object.keys(animes).filter(k => k !== 'pokedex').sort((a, b) => animes[b].pop - animes[a].pop);
const TOP10 = new Set(byPop.slice(0, 10)), TOP3 = new Set(byPop.slice(0, 3));
for (const [k, a] of Object.entries(animes)) {
    const icons = k === 'pokedex' ? ['Pikachu', 'Dracaufeu', 'Mewtwo'] : a.cards.slice(0, 3).map(c => c[0]);
    a.specials = { secrete: icons.slice(0, 3), divine: icons.slice(0, 2), cosmique: icons.slice(0, 1) };
    if (TOP10.has(k)) a.specials.eternelle = icons.slice(0, 1);
    if (TOP3.has(k)) a.specials.omega = icons.slice(0, 1);
}

// retrouver les persos d'Anime Game (noms français) dans les données AniList
const norm = s => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/uchiwa/g, 'uchiha').replace(/[^a-z0-9 ]+/g, ' ').trim().split(/\s+/).filter(Boolean).sort().join(' ');
const index = new Map(), first = new Map();
for (const [k, a] of Object.entries(animes)) a.cards.forEach(c => {
    const n = norm(c[0]); if (!index.has(n)) index.set(n, [k, c[0]]);
    const f = norm(c[0].split(' ')[0]); if (!first.has(f)) first.set(f, [k, c[0]]);
});
const resolve = name => index.get(norm(name)) || (name.trim().split(/\s+/).length === 1 ? first.get(norm(name)) : null) || null;

const seasons = {};
const defs = { halloween: { label: 'Halloween', chars: halloween }, ...extra.season };
for (const [id, s] of Object.entries(defs)) {
    const seen = new Set();
    const chars = s.chars.map(([, n]) => resolve(n)).filter(c => c && !seen.has(c.join('|')) && seen.add(c.join('|')));
    seasons[id] = { label: s.label, from: s.from, to: s.to, chars };
}
const duos = [];
for (const d of extra.duo) {
    const [a, b] = d.name.split(/\s*&\s*/);
    const ra = resolve(a), rb = resolve(b || '');
    if (ra && rb) duos.push({ name: d.name, a: ra, b: rb });
}

const out = { v: 2, imgPrefix: IMG_PREFIX, animes, seasons, duos };
fs.writeFileSync(path.join(__dirname, '..', 'public', 'cards.json'), JSON.stringify(out));
const total = Object.values(animes).reduce((s, a) => s + a.cards.length, 0);
console.log(`${Object.keys(animes).length} animés, ${total} persos, ${duos.length} duos, saisons : ${Object.entries(seasons).map(([k, s]) => k + ' ' + s.chars.length).join(', ')}`);
