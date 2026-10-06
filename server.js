// Serveur d'Anime Boosters : le site, les comptes (e-mail + mot de passe), la sauvegarde en ligne et l'admin.
//   node server.js            (PORT=3000 par défaut)
// Variables d'environnement :
//   DATABASE_URL   Postgres (Neon, Supabase…). Sans elle, les comptes sont gardés dans data/db.json.
//   ADMIN_EMAILS   e-mails des admins, séparés par des virgules. Sans elle, le 1er compte créé est admin.
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const crypto = require('crypto');
const Engine = require('./public/engine.js');

const ROOT = path.join(__dirname, 'public');
const PORT = process.env.PORT || 3000;
const ADMIN_EMAILS = String(process.env.ADMIN_EMAILS || '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
const D = JSON.parse(fs.readFileSync(path.join(ROOT, 'cards.json'), 'utf8'));
const G = Engine.create(D);

/* ---------- stockage : Postgres ou fichier ---------- */
function pgSslFor(url) {
    try {
        if (/sslmode=disable/i.test(url)) return false;
        const h = new URL(url).hostname;
        if (!h.includes('.') || h === 'localhost' || /^127\./.test(h)) return false;
    } catch (_) {}
    return { rejectUnauthorized: false };
}
function pgStore(url) {
    const { Pool } = require('pg');
    const pool = new Pool({ connectionString: url, ssl: pgSslFor(url), max: 8 });
    const row = r => r ? { id: r.id, email: r.email, pseudo: r.pseudo, pass: r.pass, admin: r.admin, state: r.state, created: +new Date(r.created_at) } : null;
    const one = async (sql, args) => row((await pool.query(sql, args)).rows[0]);
    return {
        kind: 'Postgres',
        async init() {
            // tables préfixées ab_ : la base peut être partagée avec Anime Game sans conflit
            await pool.query(`CREATE TABLE IF NOT EXISTS ab_users (id SERIAL PRIMARY KEY, email TEXT UNIQUE NOT NULL, pseudo TEXT NOT NULL, pseudo_lc TEXT UNIQUE NOT NULL,
                pass TEXT NOT NULL, admin BOOLEAN NOT NULL DEFAULT false, state JSONB NOT NULL DEFAULT '{}', created_at TIMESTAMPTZ NOT NULL DEFAULT now())`);
            await pool.query(`CREATE TABLE IF NOT EXISTS ab_sessions (hash TEXT PRIMARY KEY, user_id INTEGER NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT now())`);
            await pool.query(`CREATE TABLE IF NOT EXISTS ab_grants (id SERIAL PRIMARY KEY, admin_id INTEGER, user_id INTEGER, amount DOUBLE PRECISION, created_at TIMESTAMPTZ NOT NULL DEFAULT now())`);
        },
        async count() { return (await pool.query('SELECT count(*)::int AS n FROM ab_users')).rows[0].n; },
        byEmail: e => one('SELECT * FROM ab_users WHERE email=$1', [e]),
        byPseudo: p => one('SELECT * FROM ab_users WHERE pseudo_lc=$1', [p.toLowerCase()]),
        byId: id => one('SELECT * FROM ab_users WHERE id=$1', [id]),
        create: u => one('INSERT INTO ab_users (email, pseudo, pseudo_lc, pass, admin, state) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *', [u.email, u.pseudo, u.pseudo.toLowerCase(), u.pass, u.admin, JSON.stringify(u.state)]),
        async saveState(id, state) { await pool.query('UPDATE ab_users SET state=$2 WHERE id=$1', [id, JSON.stringify(state)]); },
        async list(q, limit) {
            const r = await pool.query(`SELECT id, pseudo, created_at, COALESCE((state->>'coins')::float8, 0) AS coins,
                (SELECT count(*) FROM jsonb_object_keys(COALESCE(state->'cards', '{}'::jsonb)))::int AS cards
                FROM ab_users WHERE pseudo_lc LIKE $1 ORDER BY pseudo_lc LIMIT $2`, ['%' + q.toLowerCase().replace(/[%_\\]/g, '\\$&') + '%', limit]);
            return r.rows.map(x => ({ id: x.id, pseudo: x.pseudo, coins: x.coins, cards: x.cards, created: +new Date(x.created_at) }));
        },
        async sessionSet(h, uid) { await pool.query('INSERT INTO ab_sessions (hash, user_id) VALUES ($1,$2) ON CONFLICT (hash) DO NOTHING', [h, uid]); },
        async sessionGet(h) { const r = (await pool.query('SELECT user_id FROM ab_sessions WHERE hash=$1', [h])).rows[0]; return r ? r.user_id : null; },
        async sessionDel(h) { await pool.query('DELETE FROM ab_sessions WHERE hash=$1', [h]); },
        async grant(adminId, userId, amount) { await pool.query('INSERT INTO ab_grants (admin_id, user_id, amount) VALUES ($1,$2,$3)', [adminId, userId, amount]); },
        async close() { await pool.end(); }
    };
}
function fileStore(file) {
    let db = { seq: 0, users: [], sessions: {}, grants: [] };
    try { db = Object.assign(db, JSON.parse(fs.readFileSync(file, 'utf8'))); } catch (_) {}
    let t = 0;
    const write = () => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file + '.tmp', JSON.stringify(db)); fs.renameSync(file + '.tmp', file); };
    const persist = () => { clearTimeout(t); t = setTimeout(write, 300); };
    const find = f => db.users.find(f) || null;
    return {
        kind: 'fichier ' + path.relative(__dirname, file),
        async init() {},
        async count() { return db.users.length; },
        async byEmail(e) { return find(u => u.email === e); },
        async byPseudo(p) { const l = p.toLowerCase(); return find(u => u.pseudo.toLowerCase() === l); },
        async byId(id) { return find(u => u.id === id); },
        async create(u) { const user = { ...u, id: ++db.seq, created: Date.now() }; db.users.push(user); persist(); return user; },
        async saveState(id, state) { const u = find(x => x.id === id); if (u) { u.state = state; persist(); } },
        async list(q, limit) {
            const l = q.toLowerCase();
            return db.users.filter(u => u.pseudo.toLowerCase().includes(l)).sort((a, b) => a.pseudo.localeCompare(b.pseudo)).slice(0, limit)
                .map(u => ({ id: u.id, pseudo: u.pseudo, coins: (u.state && u.state.coins) || 0, cards: Object.keys((u.state && u.state.cards) || {}).length, created: u.created }));
        },
        async sessionSet(h, uid) { db.sessions[h] = { uid, at: Date.now() }; persist(); },
        async sessionGet(h) { return db.sessions[h] ? db.sessions[h].uid : null; },
        async sessionDel(h) { delete db.sessions[h]; persist(); },
        async grant(adminId, userId, amount) { db.grants.push({ adminId, userId, amount, at: Date.now() }); persist(); },
        async close() { clearTimeout(t); write(); }
    };
}
const store = process.env.DATABASE_URL ? pgStore(process.env.DATABASE_URL) : fileStore(path.join(__dirname, 'data', 'db.json'));

/* ---------- joueurs en mémoire (le serveur fait foi pour les pièces et les cartes) ---------- */
const USERS = new Map(), LOADING = new Map(), DIRTY = new Set();
function hydrate(u) { u.state = Object.assign(Engine.fresh(), u.state || {}); USERS.set(u.id, u); return u; }
async function userById(id) {
    if (USERS.has(id)) return USERS.get(id);
    if (!LOADING.has(id)) LOADING.set(id, store.byId(id).then(u => u ? (USERS.get(id) || hydrate(u)) : null).finally(() => LOADING.delete(id)));
    return LOADING.get(id);
}
async function flush() {
    const ids = [...DIRTY]; DIRTY.clear();
    for (const id of ids) { const u = USERS.get(id); if (u) await store.saveState(id, u.state).catch(e => { DIRTY.add(id); console.warn('[sauvegarde]', e.message); }); }
}
setInterval(() => flush().catch(() => {}), 2000);
const isAdmin = u => !!u && (u.admin || ADMIN_EMAILS.includes(u.email));

/* ---------- mots de passe et sessions ---------- */
const hashPass = (pw, salt = crypto.randomBytes(16).toString('hex')) => salt + ':' + crypto.scryptSync(pw, salt, 64).toString('hex');
function checkPass(pw, stored) {
    const [salt, h] = String(stored).split(':');
    if (!salt || !h) return false;
    const a = Buffer.from(h, 'hex'), b = crypto.scryptSync(pw, salt, 64);
    return a.length === b.length && crypto.timingSafeEqual(a, b);
}
const sha = s => crypto.createHash('sha256').update(s).digest('hex');
const SESS = new Map(); // hash du jeton -> id du joueur
const cookies = req => Object.fromEntries(String(req.headers.cookie || '').split(';').map(c => c.trim().split('=')).filter(c => c[0]).map(([k, ...v]) => [k, decodeURIComponent(v.join('='))]));
async function currentUser(req) {
    const tok = cookies(req).ab_sid;
    if (!tok) return null;
    const h = sha(tok);
    let uid = SESS.get(h);
    if (uid === undefined) { uid = await store.sessionGet(h); if (uid) SESS.set(h, uid); } // on ne garde en mémoire que les vraies sessions
    return uid ? userById(uid) : null;
}
const secure = req => req.headers['x-forwarded-proto'] === 'https' || !!req.socket.encrypted;
async function startSession(req, res, user) {
    const tok = crypto.randomBytes(32).toString('hex'), h = sha(tok);
    await store.sessionSet(h, user.id); SESS.set(h, user.id);
    res.setHeader('Set-Cookie', `ab_sid=${tok}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${60 * 86400}${secure(req) ? '; Secure' : ''}`);
}

/* ---------- limites anti-abus ---------- */
const HITS = new Map();
function limited(key, max, ms) {
    const now = Date.now(), l = (HITS.get(key) || []).filter(t => now - t < ms);
    l.push(now); HITS.set(key, l);
    return l.length > max;
}
setInterval(() => { const now = Date.now(); for (const [k, l] of HITS) if (!l.some(t => now - t < 600e3)) HITS.delete(k); }, 60e3);
const ipOf = req => String(req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim();

/* ---------- réponses ---------- */
const meOf = u => u ? { pseudo: u.pseudo, admin: isAdmin(u) } : null;
const STATS = ['coins', 'opened', 'pulled', 'best', 'god', 'infinite', 'lastFree', 'lastDaily', 'streak'];
// ce qui a changé après une action (pas toute la collection)
function patchOf(S, keys) {
    const p = {};
    for (const k of STATS) p[k] = S[k];
    p.entries = {};
    for (const k of keys || []) p.entries[k] = S.cards[k];
    return p;
}
const publicState = S => { const s = { ...S }; delete s.inbox; return s; };
function parseAmount(v) {
    if (typeof v === 'number') return v;
    let s = String(v || '').toLowerCase().replace(/[\s  _']/g, '');
    let mult = 1;
    const m = s.match(/(milliards?|mds?|md|b|millions?|m|k|mille)$/);
    if (m) { mult = /^(milliard|md|b)/.test(m[1]) ? 1e9 : /^(million|m$)/.test(m[1]) ? 1e6 : 1e3; s = s.slice(0, -m[1].length); }
    if (/^-?\d{1,3}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, ''); // 1.000.000
    s = s.replace(',', '.');
    return /^-?\d+(\.\d+)?$/.test(s) ? Math.round(parseFloat(s) * mult) : NaN;
}
function sanitizeImport(S) {
    // collection d'invité importée à la création du compte : cartes et compteurs, pas les pièces
    const out = Engine.fresh();
    if (!S || typeof S !== 'object') return out;
    const cards = S.cards && typeof S.cards === 'object' ? S.cards : {};
    for (const [k, o] of Object.entries(cards).slice(0, 200000)) {
        if (!G.validKey(k) || !o || typeof o !== 'object') continue;
        const n = Math.max(1, Math.min(1e6, Math.floor(+o.n) || 1));
        out.cards[k] = { n, shiny: Math.max(0, Math.min(n, Math.floor(+o.shiny) || 0)), fin: Engine.FIN_IDX[o.fin] !== undefined ? o.fin : null };
    }
    for (const k of ['opened', 'pulled', 'god', 'infinite']) out[k] = Math.max(0, Math.min(1e9, Math.floor(+S[k]) || 0));
    if (S.best && typeof S.best === 'object') for (const r of Object.keys(Engine.RAR_LABEL)) out.best[r] = Math.max(0, Math.min(1e9, Math.floor(+S.best[r]) || 0));
    return out;
}

/* ---------- API ---------- */
const API = {
    'GET /api/me': async (req, u) => ({ me: meOf(u), state: u ? publicState(u.state) : null }),

    'POST /api/register': async (req, u, b) => {
        if (limited('reg:' + ipOf(req), 10, 3600e3)) return { status: 429, error: 'Trop de comptes créés, réessaie plus tard.' };
        const email = String(b.email || '').trim().toLowerCase(), pseudo = String(b.pseudo || '').trim().replace(/\s+/g, ' '), pw = String(b.password || '');
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 200) return { error: 'Adresse e-mail invalide.' };
        if (!/^[\p{L}\p{N}_.\- ]{3,20}$/u.test(pseudo)) return { error: 'Pseudo : 3 à 20 caractères (lettres, chiffres, espace, _ . -).' };
        if (pw.length < 6 || pw.length > 200) return { error: 'Mot de passe : 6 caractères minimum.' };
        if (await store.byEmail(email)) return { error: 'Cette adresse e-mail a déjà un compte. Connecte-toi.' };
        if (await store.byPseudo(pseudo)) return { error: 'Ce pseudo est déjà pris.' };
        const admin = ADMIN_EMAILS.length ? ADMIN_EMAILS.includes(email) : (await store.count()) === 0;
        const state = b.importGuest ? sanitizeImport(b.guest) : Engine.fresh();
        let user;
        try { user = hydrate(await store.create({ email, pseudo, pass: hashPass(pw), admin, state })); }
        catch (e) { return { error: 'Cet e-mail ou ce pseudo est déjà pris.' }; }
        await startSession(req, req.res, user);
        return { me: meOf(user), state: publicState(user.state) };
    },

    'POST /api/login': async (req, u, b) => {
        const email = String(b.email || '').trim().toLowerCase();
        if (limited('login:' + ipOf(req), 20, 600e3) || limited('login-mail:' + email, 10, 600e3)) return { status: 429, error: 'Trop d’essais, réessaie dans quelques minutes.' };
        const found = email && await store.byEmail(email);
        if (!found || !checkPass(String(b.password || ''), found.pass)) return { error: 'E-mail ou mot de passe incorrect.' };
        const user = await userById(found.id);
        await startSession(req, req.res, user);
        return { me: meOf(user), state: publicState(user.state) };
    },

    'POST /api/logout': async (req) => {
        const tok = cookies(req).ab_sid;
        if (tok) { const h = sha(tok); SESS.delete(h); await store.sessionDel(h); }
        req.res.setHeader('Set-Cookie', `ab_sid=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure(req) ? '; Secure' : ''}`);
        return { ok: true };
    },

    'POST /api/open': async (req, u, b) => {
        if (!u) return { status: 401, error: 'Connecte-toi.' };
        if (limited('open:' + u.id, 12, 1000)) return { status: 429, error: 'Doucement !' };
        const r = G.buy(u.state, String(b.id || ''));
        if (!r.ok) return { error: r.error };
        DIRTY.add(u.id);
        return { cards: r.cards, god: r.god, patch: patchOf(u.state, r.cards.map(c => c.key)) };
    },

    'POST /api/daily': async (req, u) => {
        if (!u) return { status: 401, error: 'Connecte-toi.' };
        const r = G.claimDaily(u.state);
        if (!r.ok) return { error: r.error };
        DIRTY.add(u.id);
        return { amount: r.amount, patch: patchOf(u.state) };
    },

    'POST /api/sell': async (req, u) => {
        if (!u) return { status: 401, error: 'Connecte-toi.' };
        const r = G.sellDupes(u.state);
        DIRTY.add(u.id);
        return { n: r.n, total: r.total, state: publicState(u.state) };
    },

    'POST /api/reset': async (req, u) => {
        if (!u) return { status: 401, error: 'Connecte-toi.' };
        u.state = Object.assign(Engine.fresh(), { inbox: u.state.inbox || [] });
        DIRTY.add(u.id);
        return { state: publicState(u.state) };
    },

    // le jeu demande régulièrement s'il y a des pièces reçues
    'GET /api/ping': async (req, u) => {
        if (!u) return { me: null };
        const inbox = u.state.inbox || [];
        if (inbox.length) { u.state.inbox = []; DIRTY.add(u.id); }
        return { me: meOf(u), coins: u.state.coins, inbox };
    },

    'GET /api/admin/players': async (req, u) => {
        if (!isAdmin(u)) return { status: 403, error: 'Réservé aux admins.' };
        await flush();
        const q = String(new URL(req.url, 'http://x').searchParams.get('q') || '').trim().slice(0, 40);
        const list = await store.list(q, 50);
        for (const p of list) { const m = USERS.get(p.id); if (m) { p.coins = m.state.coins; p.cards = Object.keys(m.state.cards).length; } }
        return { players: list };
    },

    'POST /api/admin/give': async (req, u, b) => {
        if (!isAdmin(u)) return { status: 403, error: 'Réservé aux admins.' };
        const amount = parseAmount(b.amount);
        if (!Number.isFinite(amount) || amount === 0) return { error: 'Montant invalide (ex. 1000, 1 000 000, 1 milliard, 2M).' };
        if (Math.abs(amount) > Engine.MAX_COINS) return { error: 'Montant trop grand (max 1 million de milliards).' };
        const target = await store.byPseudo(String(b.pseudo || '').trim());
        if (!target) return { error: 'Aucun joueur avec ce pseudo.' };
        const t = await userById(target.id);
        const before = t.state.coins;
        t.state.coins = Math.max(0, Math.min(Engine.MAX_COINS, before + amount));
        const given = t.state.coins - before;
        (t.state.inbox = t.state.inbox || []).push({ amount: given, at: Date.now() });
        await store.saveState(t.id, t.state); DIRTY.delete(t.id);
        await store.grant(u.id, t.id, given);
        console.log(`[admin] ${u.pseudo} → ${t.pseudo} : ${given} pièces`);
        return { pseudo: t.pseudo, given, coins: t.state.coins };
    }
};

/* ---------- fichiers du site (gzip + cache) ---------- */
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.png': 'image/png', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.ico': 'image/x-icon' };
const FILES = new Map();
function staticFile(req, res) {
    let p;
    try { p = path.normalize(decodeURIComponent(req.url.split('?')[0])); } catch (_) { res.writeHead(400); return res.end(); }
    const file = path.join(ROOT, p === '/' || p === '\\' ? 'index.html' : p);
    if (!file.startsWith(ROOT + path.sep) || /[\\/]\./.test(path.relative(ROOT, file))) { res.writeHead(403); return res.end(); }
    fs.stat(file, (err, st) => {
        if (err || !st.isFile()) { res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }); return res.end('Introuvable'); }
        const etag = `W/"${st.size}-${+st.mtime}"`;
        if (req.headers['if-none-match'] === etag) { res.writeHead(304, { ETag: etag }); return res.end(); }
        let f = FILES.get(file);
        if (!f || f.etag !== etag) {
            const raw = fs.readFileSync(file), type = TYPES[path.extname(file)] || 'application/octet-stream';
            f = { etag, raw, type, gz: /text|json|javascript|svg/.test(type) && raw.length > 1024 ? zlib.gzipSync(raw, { level: 9 }) : null };
            FILES.set(file, f);
        }
        const gz = f.gz && /\bgzip\b/.test(req.headers['accept-encoding'] || '');
        res.writeHead(200, { 'Content-Type': f.type, ETag: etag, 'Cache-Control': 'no-cache', ...(gz ? { 'Content-Encoding': 'gzip', Vary: 'Accept-Encoding' } : {}) });
        res.end(gz ? f.gz : f.raw);
    });
}

function readBody(req, max = 3e6) {
    return new Promise((resolve, reject) => {
        let size = 0; const chunks = [];
        req.on('data', c => { size += c.length; if (size > max) { reject(new Error('trop gros')); req.destroy(); } else chunks.push(c); });
        req.on('end', () => { try { resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {}); } catch (e) { reject(e); } });
        req.on('error', reject);
    });
}
function sendJson(req, res, status, obj) {
    const body = Buffer.from(JSON.stringify(obj));
    const gz = body.length > 2048 && /\bgzip\b/.test(req.headers['accept-encoding'] || '');
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...(gz ? { 'Content-Encoding': 'gzip', Vary: 'Accept-Encoding' } : {}) });
    res.end(gz ? zlib.gzipSync(body) : body);
}

const server = http.createServer(async (req, res) => {
    const route = req.method + ' ' + req.url.split('?')[0];
    if (!route.includes(' /api/')) return staticFile(req, res);
    const fn = API[route];
    if (!fn) return sendJson(req, res, 404, { error: 'Introuvable' });
    try {
        if (req.method === 'POST') {
            // pas de requête venant d'un autre site
            const origin = req.headers.origin;
            if (origin) { let host = ''; try { host = new URL(origin).host; } catch (_) {} if (host !== req.headers.host) return sendJson(req, res, 403, { error: 'Origine refusée.' }); }
        }
        const body = req.method === 'POST' ? await readBody(req) : {};
        req.res = res;
        const u = await currentUser(req);
        const out = await fn(req, u, body || {});
        const status = out.status || (out.error ? 400 : 200);
        delete out.status;
        sendJson(req, res, status, out);
    } catch (e) {
        console.warn('[api]', route, e.message);
        if (!res.headersSent) sendJson(req, res, 500, { error: 'Erreur du serveur.' });
    }
});

(async () => {
    await store.init();
    server.listen(PORT, () => console.log(`Anime Boosters sur le port ${PORT} — comptes : ${store.kind}${ADMIN_EMAILS.length ? ' — admins : ' + ADMIN_EMAILS.join(', ') : ' — le 1er compte créé sera admin'}`));
})().catch(e => { console.error('Démarrage impossible :', e.message); process.exit(1); });

async function stop() { try { await flush(); await store.close(); } catch (_) {} process.exit(0); }
process.on('SIGTERM', stop);
process.on('SIGINT', stop);
