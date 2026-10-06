// Reprend les styles des raretés et finitions d'Anime Game (index.html) pour les cartes d'Anime Boosters.
// Usage : node tools/port-card-css.js ../Anime-game-server/index.html  → public/anime-game-cards.css
const fs = require('fs');
const path = require('path');
const src = fs.readFileSync(process.argv[2] || path.join(__dirname, '..', '..', 'Anime-game-server', 'index.html'), 'utf8');
const R = require('./rarities.json');

const TIERS = new Set([...R.tiers.map(t => t.id), 'halloween', 'noel', 'valentin', 'ete', 'saison', 'duo']);
const FINS = new Set(R.finishes.map(f => f.id));
const map = sel => sel
    .replace(/#summon \.sm-screen\.fx-/g, '.cine.t-')
    .replace(/\.tcard/g, '.card')
    .replace(/\.tc-img img/g, '.ci img').replace(/\.tc-img/g, '.ci')
    .replace(/\.tc-bgfx/g, '.bgfx').replace(/\.tc-fx/g, '.fx').replace(/\.tc-glare/g, '.glare')
    .replace(/\.tc-name/g, '.nm').replace(/\.tc-rar/g, '.rr');
// règles de mise en page d'Anime Game qui n'ont pas de sens ici (nos cartes sont déjà « full art »)
const SKIP = [/\.card\.f-fullart \.(ci|nm|rr)\b/, /\.big\b/, /\.tc-/, /trd-mini|fin-banner|\.sm-|#summon/];

// toutes les règles « sélecteurs{déclarations} » de premier niveau dans les <style>
const rules = [], keyframes = new Map();
for (const m of src.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)) {
    const css = m[1].replace(/\/\*[\s\S]*?\*\//g, '');
    let i = 0;
    while (i < css.length) {
        const open = css.indexOf('{', i);
        if (open < 0) break;
        const head = css.slice(i, open).trim();
        let depth = 1, j = open + 1;
        while (j < css.length && depth) { if (css[j] === '{') depth++; else if (css[j] === '}') depth--; j++; }
        const body = css.slice(open + 1, j - 1);
        if (head.startsWith('@keyframes')) keyframes.set(head.split(/\s+/)[1], `${head}{${body}}`);
        else if (!head.startsWith('@')) rules.push([head, body.trim()]);
        i = j;
    }
}

const out = [], used = new Set();
for (const [head, body] of rules) {
    const sels = head.split(',').map(s => s.trim()).filter(Boolean);
    const keep = sels.filter(s => {
        const r = s.match(/\.tcard\.r-([a-z]+)/), f = s.match(/\.tcard\.f-([a-z]+)/), sc = s.match(/sm-screen\.fx-([a-z]+)/);
        if (!(r && TIERS.has(r[1])) && !(f && FINS.has(f[1])) && !(sc && TIERS.has(sc[1]))) return false;
        if (/\.tcard\.r-(commune|rare|epique|legendaire|mythique)\b/.test(s)) return false;
        return !SKIP.some(re => re.test(map(s)));
    }).map(map);
    if (!keep.length) continue;
    let decl = body;
    if (keep.every(s => /^\.card\.f-fullart$/.test(s))) decl = decl.replace(/padding:0;?/, '');
    if (keep.some(s => /^\.cine\.t-/.test(s))) decl = decl.replace(/background:/, 'background-image:none;background:');
    for (const a of decl.matchAll(/animation(?:-name)?:\s*([^;]+)/g)) for (const w of a[1].split(/[\s,]+/)) if (keyframes.has(w)) used.add(w);
    out.push(`${keep.join(',')}{${decl}}`);
}
const kf = [...used].map(k => keyframes.get(k));
const header = '/* Raretés et finitions reprises d\'Anime Game (généré par tools/port-card-css.js, ne pas modifier à la main) */\n';
fs.writeFileSync(path.join(__dirname, '..', 'public', 'anime-game-cards.css'), header + [...out, ...kf].join('\n') + '\n');
console.log(out.length, 'règles,', kf.length, 'animations →', 'public/anime-game-cards.css');
const covered = t => out.some(r => r.includes('.r-' + t + '{') || r.includes('.r-' + t + ' ') || r.includes('.r-' + t + ','));
console.log('raretés sans style :', [...TIERS].filter(t => !covered(t)).join(', ') || 'aucune');
console.log('finitions sans style :', [...FINS].filter(f => !out.some(r => r.includes('.f-' + f))).join(', ') || 'aucune');
