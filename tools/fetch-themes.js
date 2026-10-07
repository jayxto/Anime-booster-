// Genres, tags et année de chaque franchise (pour les boosters à thème : Isekai, Mecha, Sport, Rétro…)
// Usage : node tools/fetch-themes.js  → tools/themes.json
const fs = require('fs'), path = require('path');
const CACHE = path.join(__dirname, 'cache'), sleep = ms => new Promise(r => setTimeout(r, ms));
fs.mkdirSync(CACHE, { recursive: true });
const franchises = require('./anilist.json');
const ids = [...new Set(franchises.map(f => f.id))];
async function gql(query) {
    for (let t = 0; t < 10; t++) {
        try {
            const r = await fetch('https://graphql.anilist.co', { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify({ query }) });
            if (r.status === 429) { await sleep((+(r.headers.get('retry-after') || 60) + 1) * 1000); continue; }
            const j = await r.json();
            if (j.data && j.data.Page && !j.errors) { await sleep(2100); return j.data; }
        } catch (_) {}
        await sleep(5000);
    }
    throw new Error('AniList ne répond pas');
}
(async () => {
    const out = {};
    for (let i = 0; i < ids.length; i += 50) {
        const part = ids.slice(i, i + 50), f = path.join(CACHE, `themes-${part[0]}-${part.length}.json`);
        let d;
        if (fs.existsSync(f)) d = JSON.parse(fs.readFileSync(f, 'utf8'));
        else { d = await gql(`{Page(perPage:50){media(id_in:[${part.join(',')}]){id genres startDate{year} tags{name rank}}}}`); fs.writeFileSync(f, JSON.stringify(d)); }
        for (const m of d.Page.media) out[m.id] = { g: m.genres, y: m.startDate && m.startDate.year, t: Object.fromEntries((m.tags || []).filter(t => t.rank >= 55).map(t => [t.name, t.rank])) };
        if ((i / 50) % 10 === 0) console.log('thèmes :', Math.min(i + 50, ids.length), '/', ids.length);
    }
    fs.writeFileSync(path.join(__dirname, 'themes.json'), JSON.stringify(out));
    console.log('fini :', Object.keys(out).length, 'franchises');
})();
