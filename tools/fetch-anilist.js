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

    // 3) persos : on lit les pages tant qu'elles sont pleines, plus loin pour les grosses franchises
    const pop = list => list.reduce((s, m) => s + m.popularity, 0);
    franchises.sort((a, b) => pop(b) - pop(a));
    const cap = new Map(); // mediaId -> nb max de pages de 25 persos
    franchises.forEach((list, rank) => {
        const root = rank < 40 ? 24 : rank < 120 ? 10 : rank < 400 ? 4 : 2;
        list.forEach((m, i) => cap.set(m.id, i === 0 ? root : i < 4 ? Math.min(3, root) : 1));
    });
    // cache par (animé, page) : relu depuis les fichiers chars-<id>_<page>-….json déjà téléchargés
    const pageCache = new Map();
    for (const f of fs.readdirSync(CACHE).filter(f => /^chars-[\d_-]+\.json$/.test(f))) {
        const ids = f.slice(6, -5).split('-'), d = JSON.parse(fs.readFileSync(path.join(CACHE, f), 'utf8'));
        ids.forEach((k, i) => { if (d['m' + i]) pageCache.set(k, d['m' + i].characters.nodes); });
    }
    console.log('pages de persos en cache :', pageCache.size);
    const full = (id, p) => p === 0 || (pageCache.get(id + '_' + p) || []).length === 25;
    for (let p = 1; p <= 24; p++) {
        const jobs = [...cap].filter(([id, c]) => p <= c && full(id, p - 1) && !pageCache.has(id + '_' + p)).map(([id]) => [id, p]);
        if (!jobs.length) continue;
        console.log(`page ${p} : ${jobs.length} animés à lire`);
        for (let i = 0; i < jobs.length; i += 8) {
            const part = jobs.slice(i, i + 8);
            const d = await cached('chars-' + part.map(j => j.join('_')).join('-'), () =>
                gql(`{${part.map(([id, pg], k) => `m${k}:Media(id:${id}){characters(sort:[FAVOURITES_DESC],perPage:25,page:${pg}){nodes{id favourites name{full userPreferred} image{large}}}}`).join(' ')}}`));
            part.forEach(([id, pg], k) => pageCache.set(id + '_' + pg, d['m' + k] ? d['m' + k].characters.nodes : []));
            if ((i / 8) % 25 === 0) console.log('  persos :', Math.min(i + 8, jobs.length), '/', jobs.length);
        }
    }
    const chars = new Map(); // mediaId -> [persos]
    for (const [id, c] of cap) for (let p = 1; p <= c && pageCache.has(id + '_' + p); p++) chars.set(id, (chars.get(id) || []).concat(pageCache.get(id + '_' + p)));

    // titre de la franchise : la 1re saison (série TV sans préquelle) plutôt qu'une suite
    const clean = t => {
        let s = String(t || ''), prev;
        do { prev = s; s = s.replace(/\s*\((TV|\d{4})\)\s*$/i, '').replace(/[\s:]+(Season\s*\d+|\d+(st|nd|rd|th)\s+Season|Final Season.*|Part\s*\d+)\s*$/i, '').trim(); } while (s !== prev);
        return s;
    };
    function rootOf(list) {
        // la 1re série TV (sans préquelle en série) ; sinon la plus populaire si la 1re est bien moins connue
        const tv = list.filter(m => /^(TV|ONA)/.test(m.format || ''));
        const series = new Set(tv.map(m => m.id));
        const first = tv.find(m => !m.relations.edges.some(e => e.relationType === 'PREQUEL' && series.has(e.node.id)));
        const top = tv[0] || list[0];
        return first && first.popularity >= top.popularity * 0.5 ? first : top;
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
        const top = rootOf(list);
        out.push({
            id: top.id, title: clean(top.title.english || top.title.romaji), romaji: clean(top.title.romaji),
            popularity: pop(list), color: top.coverImage.color,
            cover: top.coverImage.extraLarge || top.coverImage.large, banner: top.bannerImage,
            chars: cs.map(c => ({ id: c.id, name: c.name.full || c.name.userPreferred, fav: c.favourites, img: c.image.large }))
        });
    }
    out.sort((a, b) => b.popularity - a.popularity);
    fs.writeFileSync(path.join(__dirname, 'anilist.json'), JSON.stringify(out));
    console.log('fini :', out.length, 'animés,', out.reduce((s, f) => s + f.chars.length, 0), 'persos');
})();
