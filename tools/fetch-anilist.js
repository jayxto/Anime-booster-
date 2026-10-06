// Récupère sur AniList les animés les plus populaires et LEURS persos (donc les bonnes photos).
// Les saisons / films / spin-offs sont regroupés en une seule franchise.
// Reprend là où il s'est arrêté (cache dans tools/cache/). Usage : node tools/fetch-anilist.js [nbAnimes]
const fs = require('fs');
const path = require('path');
const CACHE = path.join(__dirname, 'cache');
fs.mkdirSync(CACHE, { recursive: true });
const MAX_MEDIA = +(process.argv[2] || 1500);
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function gql(query) {
    for (let t = 0; t < 10; t++) {
        try {
            const r = await fetch('https://graphql.anilist.co', { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify({ query }) });
            if (r.status === 429) { const w = +(r.headers.get('retry-after') || 60); console.log('  limite, attente', w, 's'); await sleep((w + 1) * 1000); continue; }
            const j = await r.json();
            if (j.data) { await sleep(2100); return j.data; }
            console.log('  erreur', JSON.stringify(j.errors).slice(0, 200));
        } catch (e) { console.log('  réseau', e.message); }
        await sleep(5000);
    }
    throw new Error('AniList ne répond pas');
}
const cached = async (name, fn) => {
    const f = path.join(CACHE, name + '.json');
    if (fs.existsSync(f)) return JSON.parse(fs.readFileSync(f, 'utf8'));
    const v = await fn();
    fs.writeFileSync(f, JSON.stringify(v));
    return v;
};

(async () => {
    // 1) les animés les plus populaires
    const media = [];
    for (let p = 1; media.length < MAX_MEDIA; p++) {
        const d = await cached('media-' + p, () => gql(`{Page(page:${p},perPage:50){pageInfo{hasNextPage} media(type:ANIME,sort:POPULARITY_DESC,isAdult:false){id format popularity favourites title{romaji english} coverImage{extraLarge large color} bannerImage relations{edges{relationType node{id type}}}}}}`));
        media.push(...d.Page.media);
        console.log('animés :', media.length);
        if (!d.Page.pageInfo.hasNextPage) break;
    }
    // 2) franchises : on relie les suites, préquelles, films, spin-offs…
    const byId = new Map(media.map(m => [m.id, m]));
    const parent = new Map(media.map(m => [m.id, m.id]));
    const find = x => { while (parent.get(x) !== x) { parent.set(x, parent.get(parent.get(x))); x = parent.get(x); } return x; };
    const LINK = ['SEQUEL', 'PREQUEL', 'PARENT', 'SIDE_STORY', 'SPIN_OFF', 'ALTERNATIVE', 'SUMMARY', 'COMPILATION', 'CONTAINS'];
    for (const m of media) for (const e of m.relations.edges) if (e.node.type === 'ANIME' && LINK.includes(e.relationType) && byId.has(e.node.id)) {
        const a = find(m.id), b = find(e.node.id);
        if (a !== b) { if (byId.get(a).popularity >= byId.get(b).popularity) parent.set(b, a); else parent.set(a, b); }
    }
    const fr = new Map();
    for (const m of media) { const r = find(m.id); if (!fr.has(r)) fr.set(r, []); fr.get(r).push(m); }
    const franchises = [...fr.values()].map(list => list.sort((a, b) => b.popularity - a.popularity));
    console.log('franchises :', franchises.length);

    // 3) persos : 1re page de chaque animé, puis plus de pages pour les grosses franchises
    const chars = new Map(); // mediaId -> [persos]
    const want = new Map();  // mediaId -> pages voulues
    for (const list of franchises) {
        const pop = list.reduce((s, m) => s + m.popularity, 0);
        const pages = pop > 1500000 ? 12 : pop > 700000 ? 6 : pop > 300000 ? 3 : pop > 120000 ? 2 : 1;
        list.forEach((m, i) => want.set(m.id, i === 0 ? pages : i < 4 ? Math.min(2, pages) : 1));
    }
    const jobs = [];
    for (const [id, pages] of want) for (let p = 1; p <= pages; p++) jobs.push([id, p]);
    let done = 0;
    for (let i = 0; i < jobs.length; i += 8) {
        const part = jobs.slice(i, i + 8);
        const key = 'chars-' + part.map(j => j.join('_')).join('-');
        const d = await cached(key.length > 200 ? 'chars-' + require('crypto').createHash('md5').update(key).digest('hex') : key, () =>
            gql(`{${part.map(([id, p], k) => `m${k}:Media(id:${id}){characters(sort:[FAVOURITES_DESC],perPage:25,page:${p}){nodes{id favourites name{full userPreferred} image{large}}}}`).join(' ')}}`));
        part.forEach(([id], k) => { const n = d['m' + k] ? d['m' + k].characters.nodes : []; chars.set(id, (chars.get(id) || []).concat(n)); });
        done += part.length;
        if ((i / 8) % 20 === 0) console.log('persos :', done, '/', jobs.length);
    }

    // 4) une liste par franchise, sans doublons, sans persos sans photo
    const out = [];
    const taken = new Set();
    for (const list of franchises) {
        const seen = new Map();
        for (const m of list) for (const c of chars.get(m.id) || []) {
            if (!c.image || !c.image.large || /default\.(jpg|png)/.test(c.image.large)) continue;
            if (taken.has(c.id) || seen.has(c.id)) continue;
            seen.set(c.id, c);
        }
        const cs = [...seen.values()].sort((a, b) => b.favourites - a.favourites);
        if (cs.length < 6) continue;
        cs.forEach(c => taken.add(c.id));
        const top = list[0];
        out.push({
            id: top.id, title: top.title.english || top.title.romaji, romaji: top.title.romaji,
            popularity: list.reduce((s, m) => s + m.popularity, 0), color: top.coverImage.color,
            cover: top.coverImage.extraLarge || top.coverImage.large, banner: top.bannerImage,
            chars: cs.map(c => ({ id: c.id, name: c.name.full || c.name.userPreferred, fav: c.favourites, img: c.image.large }))
        });
    }
    out.sort((a, b) => b.popularity - a.popularity);
    fs.writeFileSync(path.join(__dirname, 'anilist.json'), JSON.stringify(out));
    console.log('fini :', out.length, 'animés,', out.reduce((s, f) => s + f.chars.length, 0), 'persos');
})();
