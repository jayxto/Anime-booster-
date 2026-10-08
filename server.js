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
// si l'hébergeur n'a pas lancé « npm install » (Build Command vide), on installe le module une fois au démarrage
function loadPg() {
    try { return require('pg'); } catch (e) {
        if (e.code !== 'MODULE_NOT_FOUND') throw e;
        console.warn('[démarrage] module pg absent : installation automatique… (mets « npm install » comme Build Command sur Render pour éviter ça)');
        require('child_process').execSync('npm install --omit=dev --no-audit --no-fund', { cwd: __dirname, stdio: 'inherit', timeout: 180000 });
        return require('pg');
    }
}
function pgStore(url) {
    const { Pool } = loadPg();
    const pool = new Pool({ connectionString: url, ssl: pgSslFor(url), max: 8 });
    const row = r => r ? { id: r.id, email: r.email, pseudo: r.pseudo, pass: r.pass, admin: r.admin, state: r.state, created: +new Date(r.created_at) } : null;
    const one = async (sql, args) => row((await pool.query(sql, args)).rows[0]);
    const TSEL = 'SELECT t.*, a.pseudo AS from_pseudo, b.pseudo AS to_pseudo FROM ab_trades t JOIN ab_users a ON a.id=t.from_id JOIN ab_users b ON b.id=t.to_id';
    const trow = r => r ? { id: r.id, from: r.from_id, to: r.to_id, fromPseudo: r.from_pseudo, toPseudo: r.to_pseudo, give: r.give, take: r.take, status: r.status, at: +new Date(r.created_at), upd: +new Date(r.updated_at) } : null;
    return {
        kind: 'Postgres',
        async init() {
            // tables préfixées ab_ : la base peut être partagée avec Anime Game sans conflit
            await pool.query(`CREATE TABLE IF NOT EXISTS ab_users (id SERIAL PRIMARY KEY, email TEXT UNIQUE NOT NULL, pseudo TEXT NOT NULL, pseudo_lc TEXT UNIQUE NOT NULL,
                pass TEXT NOT NULL, admin BOOLEAN NOT NULL DEFAULT false, state JSONB NOT NULL DEFAULT '{}', created_at TIMESTAMPTZ NOT NULL DEFAULT now())`);
            await pool.query(`CREATE TABLE IF NOT EXISTS ab_sessions (hash TEXT PRIMARY KEY, user_id INTEGER NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT now())`);
            await pool.query(`CREATE TABLE IF NOT EXISTS ab_grants (id SERIAL PRIMARY KEY, admin_id INTEGER, user_id INTEGER, amount DOUBLE PRECISION, created_at TIMESTAMPTZ NOT NULL DEFAULT now())`);
            await pool.query(`CREATE TABLE IF NOT EXISTS ab_settings (key TEXT PRIMARY KEY, value JSONB)`);
            await pool.query(`CREATE TABLE IF NOT EXISTS ab_trades (id SERIAL PRIMARY KEY, from_id INTEGER NOT NULL, to_id INTEGER NOT NULL, give JSONB NOT NULL, take JSONB NOT NULL,
                status TEXT NOT NULL DEFAULT 'pending', created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now())`);
            await pool.query(`CREATE INDEX IF NOT EXISTS ab_trades_to ON ab_trades (to_id, status)`);
            await pool.query(`CREATE INDEX IF NOT EXISTS ab_trades_from ON ab_trades (from_id, status)`);
        },
        async getSetting(k) { const r = (await pool.query('SELECT value FROM ab_settings WHERE key=$1', [k])).rows[0]; return r ? r.value : null; },
        async setSetting(k, v) { await pool.query('INSERT INTO ab_settings (key, value) VALUES ($1,$2) ON CONFLICT (key) DO UPDATE SET value=$2', [k, JSON.stringify(v)]); },
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
        // joueurs publics : les plus grosses collections d'abord
        async players(q, limit) {
            const r = await pool.query(`SELECT id, pseudo, state->'profile' AS profile, (SELECT count(*) FROM jsonb_object_keys(COALESCE(state->'cards', '{}'::jsonb)))::int AS cards
                FROM ab_users WHERE pseudo_lc LIKE $1 ORDER BY cards DESC, pseudo_lc LIMIT $2`, ['%' + q.toLowerCase().replace(/[%_\\]/g, '\\$&') + '%', limit]);
            return r.rows.map(x => ({ id: x.id, pseudo: x.pseudo, cards: x.cards, profile: x.profile || {} }));
        },
        async tradeAdd(t) { return (await pool.query('INSERT INTO ab_trades (from_id, to_id, give, take) VALUES ($1,$2,$3,$4) RETURNING id', [t.from, t.to, JSON.stringify(t.give), JSON.stringify(t.take)])).rows[0].id; },
        async tradeGet(id) { return trow((await pool.query(TSEL + ' WHERE t.id=$1', [id])).rows[0]); },
        // passe d'un statut à l'autre seulement si personne ne l'a fait avant (deux clics en même temps)
        async tradeSet(id, from, to) { return (await pool.query('UPDATE ab_trades SET status=$3, updated_at=now() WHERE id=$1 AND status=$2', [id, from, to])).rowCount === 1; },
        async tradesOf(uid) {
            const r = await pool.query(TSEL + ` WHERE (t.from_id=$1 OR t.to_id=$1) AND (t.status='pending' OR t.updated_at > now() - interval '14 days')
                ORDER BY (t.status='pending') DESC, t.updated_at DESC LIMIT 40`, [uid]);
            return r.rows.map(trow);
        },
        async tradeCount(uid) {
            const r = (await pool.query(`SELECT count(*) FILTER (WHERE to_id=$1)::int AS inc, count(*) FILTER (WHERE from_id=$1)::int AS out
                FROM ab_trades WHERE status='pending' AND (to_id=$1 OR from_id=$1)`, [uid])).rows[0];
            return { in: r.inc, out: r.out };
        },
        async sessionSet(h, uid) { await pool.query('INSERT INTO ab_sessions (hash, user_id) VALUES ($1,$2) ON CONFLICT (hash) DO NOTHING', [h, uid]); },
        async sessionGet(h) { const r = (await pool.query('SELECT user_id FROM ab_sessions WHERE hash=$1', [h])).rows[0]; return r ? r.user_id : null; },
        async sessionDel(h) { await pool.query('DELETE FROM ab_sessions WHERE hash=$1', [h]); },
        async grant(adminId, userId, amount) { await pool.query('INSERT INTO ab_grants (admin_id, user_id, amount) VALUES ($1,$2,$3)', [adminId, userId, amount]); },
        async close() { await pool.end(); }
    };
}
function fileStore(file) {
    let db = { seq: 0, users: [], sessions: {}, grants: [], settings: {}, tseq: 0, trades: [] };
    try { db = Object.assign(db, JSON.parse(fs.readFileSync(file, 'utf8'))); } catch (_) {}
    let t = 0;
    const write = () => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file + '.tmp', JSON.stringify(db)); fs.renameSync(file + '.tmp', file); };
    const persist = () => { clearTimeout(t); t = setTimeout(write, 300); };
    const find = f => db.users.find(f) || null;
    const pseudoOf = id => (find(u => u.id === id) || { pseudo: '?' }).pseudo;
    const tfull = t => ({ ...t, fromPseudo: pseudoOf(t.from), toPseudo: pseudoOf(t.to) });
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
        async players(q, limit) {
            const l = q.toLowerCase();
            return db.users.filter(u => u.pseudo.toLowerCase().includes(l)).map(u => ({ id: u.id, pseudo: u.pseudo, cards: Object.keys((u.state && u.state.cards) || {}).length, profile: (u.state && u.state.profile) || {} }))
                .sort((a, b) => b.cards - a.cards || a.pseudo.localeCompare(b.pseudo)).slice(0, limit);
        },
        async tradeAdd(t) { const id = ++db.tseq; db.trades.push({ ...t, id, status: 'pending', at: Date.now(), upd: Date.now() }); persist(); return id; },
        async tradeGet(id) { const t = db.trades.find(x => x.id === id); return t ? tfull(t) : null; },
        async tradeSet(id, from, to) { const t = db.trades.find(x => x.id === id); if (!t || t.status !== from) return false; t.status = to; t.upd = Date.now(); persist(); return true; },
        async tradesOf(uid) {
            const old = Date.now() - 14 * 864e5;
            return db.trades.filter(t => (t.from === uid || t.to === uid) && (t.status === 'pending' || t.upd > old))
                .sort((a, b) => (b.status === 'pending') - (a.status === 'pending') || b.upd - a.upd).slice(0, 40).map(tfull);
        },
        async tradeCount(uid) { let i = 0, o = 0; for (const t of db.trades) if (t.status === 'pending') { if (t.to === uid) i++; if (t.from === uid) o++; } return { in: i, out: o }; },
        async sessionSet(h, uid) { db.sessions[h] = { uid, at: Date.now() }; persist(); },
        async sessionGet(h) { return db.sessions[h] ? db.sessions[h].uid : null; },
        async sessionDel(h) { delete db.sessions[h]; persist(); },
        async grant(adminId, userId, amount) { db.grants.push({ adminId, userId, amount, at: Date.now() }); persist(); },
        async getSetting(k) { return (db.settings || {})[k] ?? null; },
        async setSetting(k, v) { (db.settings = db.settings || {})[k] = v; persist(); },
        async close() { clearTimeout(t); write(); }
    };
}
const store = process.env.DATABASE_URL ? pgStore(process.env.DATABASE_URL) : fileStore(process.env.DATA_FILE || path.join(__dirname, 'data', 'db.json'));

/* ---------- joueurs en mémoire (le serveur fait foi pour les pièces et les cartes) ---------- */
const USERS = new Map(), LOADING = new Map(), DIRTY = new Set();
function hydrate(u) {
    const legacy = !!u.state && !u.state.done; // partie d'avant les récompenses de classeur
    u.state = Object.assign(Engine.fresh(), u.state || {});
    USERS.set(u.id, u);
    if (legacy) { // les paliers déjà atteints sont payés d'un coup
        const rw = G.checkBinders(u.state, Object.keys(u.state.cards).map(k => k.split('|')[0]));
        const total = rw.reduce((s, r) => s + r.coins, 0);
        if (total) (u.state.inbox = u.state.inbox || []).push({ amount: total, kind: 'binders', n: rw.length, at: Date.now() });
        DIRTY.add(u.id);
    }
    return u;
}
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

/* ---------- événement « chance x10 » pour tout le serveur (activé par un admin) ---------- */
let EVENT = { luck: 1, until: null, by: null };
const currentLuck = () => EVENT.luck > 1 && (!EVENT.until || Date.now() < EVENT.until) ? EVENT.luck : 1;
const eventInfo = () => { const luck = currentLuck(); return luck > 1 ? { luck, left: EVENT.until ? EVENT.until - Date.now() : null, id: EVENT.at || 0 } : { luck: 1 }; };

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
const STATS = ['coins', 'opened', 'pulled', 'best', 'god', 'infinite', 'lastFree', 'lastDaily', 'streak', 'trades', 'profile'];
// ce qui a changé après une action (pas toute la collection)
function patchOf(S, keys) {
    const p = {};
    for (const k of STATS) p[k] = S[k];
    p.entries = {};
    for (const k of keys || []) p.entries[k] = S.cards[k] || null; // null : la carte est partie (échange)
    return p;
}
const publicState = S => { const s = { ...S }; delete s.inbox; delete s.tcg; return s; };
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

/* ---------- profils, joueurs et échanges ---------- */
const qs = req => new URL(req.url, 'http://x').searchParams;
const titleLabel = id => { const t = Engine.TITLES.find(x => x.id === id); return t ? t.label : null; };
const ownedOf = (S, k) => k && S.cards[k] ? { k, n: S.cards[k].n, shiny: S.cards[k].shiny || 0, fin: S.cards[k].fin || null } : null;
function profileOf(user, viewer) {
    const S = user.state, st = G.profileStats(S), pr = S.profile || {};
    const tid = pr.title && st.titles.includes(pr.title) ? pr.title : st.titles[st.titles.length - 1];
    const mine = !!viewer && viewer.id === user.id;
    return {
        pseudo: user.pseudo, joined: user.created || null, mine, title: titleLabel(tid), titleId: tid,
        avatar: ownedOf(S, pr.avatar) || ownedOf(S, st.bestKey), avatarSet: !!ownedOf(S, pr.avatar),
        showcase: (pr.showcase || []).map(k => ownedOf(S, k)).filter(Boolean),
        stats: { cards: st.cards, specials: st.specials, waifus: st.waifus, done: st.done, trades: st.trades, opened: st.opened, god: st.god },
        titles: mine ? st.titles : undefined
    };
}
async function userByPseudo(p) { const f = p && await store.byPseudo(String(p).trim().slice(0, 40)); return f ? userById(f.id) : null; }
const tradeId = v => { const n = Math.floor(+v); return Number.isSafeInteger(n) && n > 0 && n < 2 ** 31 ? n : 0; };
const keyList = v => Array.isArray(v) ? [...new Set(v.filter(k => typeof k === 'string' && k.length < 300))] : [];
const animesOf = ks => ks.map(k => k.split('|')[0]).filter(u => G.D.animes[u]);
function notify(user, msg) { (user.state.inbox = user.state.inbox || []).push({ ...msg, at: Date.now() }); DIRTY.add(user.id); }
const RANK_OF = new Map(); // rang d'une carte d'après sa clé (tri des collections)
function rankOfKey(k) {
    let r = RANK_OF.get(k);
    if (r === undefined) { const c = G.cardOfKey(k); r = c ? Engine.RANK[c.rarity] || 0 : -1; if (RANK_OF.size < 400000) RANK_OF.set(k, r); }
    return r;
}

/* ---------- API ---------- */
const API = {
    ...require('./lib/tcg-api')({ store, data: D, dirty: id => DIRTY.add(id), limited, getUser: userById }),
    'GET /api/me': async (req, u) => ({ me: meOf(u), state: u ? publicState(u.state) : null, event: eventInfo() }),
    'GET /api/event': async () => ({ event: eventInfo() }),

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
        G.syncBinders(state); // paliers des classeurs importés notés, sans pièces
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
        const r = G.buy(u.state, String(b.id || ''), Date.now(), currentLuck());
        if (!r.ok) return { error: r.error };
        DIRTY.add(u.id);
        return { cards: r.cards, god: r.god, rewards: r.rewards, patch: patchOf(u.state, r.cards.map(c => c.key)) };
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
        u.state = Object.assign(Engine.fresh(), { inbox: u.state.inbox || [], ...(u.state.tcg ? { tcg: u.state.tcg } : {}) });
        DIRTY.add(u.id);
        return { state: publicState(u.state) };
    },

    // le jeu demande régulièrement s'il y a des pièces reçues
    'GET /api/ping': async (req, u) => {
        if (!u) return { me: null, event: eventInfo() };
        const inbox = u.state.inbox || [];
        if (inbox.length) { u.state.inbox = []; DIRTY.add(u.id); }
        const tc = await store.tradeCount(u.id).catch(() => ({ in: 0 }));
        return { me: meOf(u), coins: u.state.coins, inbox, trades: tc.in, event: eventInfo() };
    },

    /* --- profils --- */
    'GET /api/profile': async (req, u) => {
        if (limited('prof:' + ipOf(req), 60, 60e3)) return { status: 429, error: 'Doucement !' };
        const p = qs(req).get('p'), t = p ? await userByPseudo(p) : u;
        if (!t) return { status: 404, error: 'Joueur introuvable.' };
        return { profile: profileOf(t, u) };
    },
    'POST /api/profile': async (req, u, b) => {
        if (!u) return { status: 401, error: 'Crée un compte pour avoir un profil.' };
        if (limited('prof-set:' + u.id, 40, 60e3)) return { status: 429, error: 'Doucement !' };
        const S = u.state, pr = S.profile = Object.assign({ avatar: null, showcase: [], title: null }, S.profile);
        if ('avatar' in b) {
            const k = b.avatar == null ? null : String(b.avatar);
            if (k && !S.cards[k]) return { error: 'Tu n’as pas cette carte.' };
            pr.avatar = k;
        }
        if ('showcase' in b) {
            const l = keyList(b.showcase);
            if (l.length > 5) return { error: '5 cartes maximum dans la vitrine.' };
            if (!l.every(k => S.cards[k])) return { error: 'Tu n’as pas toutes ces cartes.' };
            pr.showcase = l;
        }
        if ('title' in b) {
            const t = b.title == null ? null : String(b.title);
            if (t && !G.profileStats(S).titles.includes(t)) return { error: 'Ce titre n’est pas encore débloqué.' };
            pr.title = t;
        }
        DIRTY.add(u.id);
        return { profile: profileOf(u, u) };
    },
    // les joueurs, plus grosses collections d'abord
    'GET /api/players': async (req, u) => {
        if (limited('players:' + ipOf(req), 40, 60e3)) return { status: 429, error: 'Doucement !' };
        const q = String(qs(req).get('q') || '').trim().slice(0, 40);
        const list = await store.players(q, 40);
        for (const p of list) { const m = USERS.get(p.id); if (m) { p.cards = Object.keys(m.state.cards).length; p.profile = m.state.profile || {}; } }
        list.sort((a, b) => b.cards - a.cards || a.pseudo.localeCompare(b.pseudo));
        return { players: list.map(p => ({ pseudo: p.pseudo, cards: p.cards, title: titleLabel(p.profile.title), avatar: typeof p.profile.avatar === 'string' ? p.profile.avatar : null, me: !!u && p.id === u.id })) };
    },
    // la collection d'un joueur, par pages de 60 (pour choisir les cartes d'un échange)
    'GET /api/collection': async (req, u) => {
        if (limited('coll:' + ipOf(req), 60, 60e3)) return { status: 429, error: 'Doucement !' };
        const p = qs(req), t = await userByPseudo(p.get('p'));
        if (!t) return { status: 404, error: 'Joueur introuvable.' };
        const q = String(p.get('q') || '').trim().toLowerCase().slice(0, 60), dup = p.get('dup') === '1';
        const off = Math.max(0, Math.min(1e6, Math.floor(+p.get('offset')) || 0));
        const C = t.state.cards;
        let ks = Object.keys(C);
        if (dup) ks = ks.filter(k => C[k].n > 1);
        if (q) ks = ks.filter(k => { const c = G.cardOfKey(k); return c && (c.name + ' ' + (c.anime || '')).toLowerCase().includes(q); });
        const rk = new Map(ks.map(k => [k, rankOfKey(k)]));
        ks = ks.filter(k => rk.get(k) >= 0).sort((a, b) => rk.get(b) - rk.get(a) || (C[b].shiny ? 1 : 0) - (C[a].shiny ? 1 : 0) || (a < b ? -1 : 1));
        return { pseudo: t.pseudo, total: ks.length, cards: ks.slice(off, off + 60).map(k => ownedOf(t.state, k)) };
    },

    /* --- échanges entre joueurs --- */
    'POST /api/trade/offer': async (req, u, b) => {
        if (!u) return { status: 401, error: 'Crée un compte pour échanger.' };
        if (limited('trade:' + u.id, 30, 3600e3)) return { status: 429, error: 'Trop de propositions, réessaie plus tard.' };
        const give = keyList(b.give), take = keyList(b.take);
        if (give.length > 5 || take.length > 5) return { error: '5 cartes maximum de chaque côté.' };
        if (!give.length && !take.length) return { error: 'Choisis au moins une carte.' };
        const other = await userByPseudo(b.to);
        if (!other) return { error: 'Joueur introuvable.' };
        if (other.id === u.id) return { error: 'Tu ne peux pas échanger avec toi-même.' };
        if (!give.every(k => G.validKey(k) && u.state.cards[k])) return { error: 'Tu n’as pas toutes ces cartes.' };
        if (!take.every(k => G.validKey(k) && other.state.cards[k])) return { error: `${other.pseudo} n’a plus toutes ces cartes.` };
        const [c1, c2] = await Promise.all([store.tradeCount(u.id), store.tradeCount(other.id)]);
        if (c1.out >= 10) return { error: 'Tu as déjà 10 propositions en attente : annules-en une.' };
        if (c2.in >= 30) return { error: `${other.pseudo} a trop de propositions en attente.` };
        const id = await store.tradeAdd({ from: u.id, to: other.id, give, take });
        return { ok: true, id };
    },
    'GET /api/trades': async (req, u) => {
        if (!u) return { status: 401, error: 'Connecte-toi.' };
        const out = [];
        for (const t of await store.tradesOf(u.id)) {
            let ok = true;
            if (t.status === 'pending') {
                const a = await userById(t.from), b = await userById(t.to);
                ok = !!a && !!b && t.give.every(k => a.state.cards[k]) && t.take.every(k => b.state.cards[k]);
            }
            out.push({ id: t.id, from: t.fromPseudo, to: t.toPseudo, mine: t.from === u.id, give: t.give, take: t.take, status: t.status, at: t.at, upd: t.upd, ok });
        }
        return { trades: out };
    },
    'POST /api/trade/answer': async (req, u, b) => {
        if (!u) return { status: 401, error: 'Connecte-toi.' };
        if (limited('trade-ans:' + u.id, 30, 60e3)) return { status: 429, error: 'Doucement !' };
        const id = tradeId(b.id), t = id && await store.tradeGet(id);
        if (!t || t.to !== u.id) return { error: 'Échange introuvable.' };
        if (t.status !== 'pending') return { error: 'Cet échange n’est plus en attente.' };
        const from = await userById(t.from);
        if (!b.accept) {
            if (!await store.tradeSet(id, 'pending', 'refused')) return { error: 'Cet échange n’est plus en attente.' };
            if (from) notify(from, { trade: 'refused', by: u.pseudo, id });
            return { ok: true, result: 'refused' };
        }
        const can = () => !!from && t.give.every(k => from.state.cards[k]) && t.take.every(k => u.state.cards[k]);
        const fail = async st => { await store.tradeSet(id, st, 'failed'); if (from) notify(from, { trade: 'failed', by: u.pseudo, id }); return { error: 'Une des cartes n’est plus disponible : échange annulé.' }; };
        if (!can()) return fail('pending');
        if (!await store.tradeSet(id, 'pending', 'accepted')) return { error: 'Cet échange n’est plus en attente.' };
        if (!can()) return fail('accepted'); // une carte a bougé pendant l'écriture en base
        // à partir d'ici, plus d'attente : l'échange se fait d'un bloc
        for (const k of t.give) G.transferCard(from.state, u.state, k);
        for (const k of t.take) G.transferCard(u.state, from.state, k);
        from.state.trades = (from.state.trades || 0) + 1; u.state.trades = (u.state.trades || 0) + 1;
        const mine = G.checkBinders(u.state, animesOf(t.give)), theirs = G.checkBinders(from.state, animesOf(t.take));
        notify(from, { trade: 'accepted', by: u.pseudo, id, rewards: theirs });
        DIRTY.add(u.id); DIRTY.add(from.id);
        console.log(`[échange] ${from.pseudo} → ${u.pseudo} : ${t.give.length} contre ${t.take.length}`);
        return { ok: true, result: 'accepted', rewards: mine, patch: patchOf(u.state, [...t.give, ...t.take]) };
    },
    'POST /api/trade/cancel': async (req, u, b) => {
        if (!u) return { status: 401, error: 'Connecte-toi.' };
        const id = tradeId(b.id), t = id && await store.tradeGet(id);
        if (!t || t.from !== u.id) return { error: 'Échange introuvable.' };
        if (!await store.tradeSet(id, 'pending', 'cancelled')) return { error: 'Cet échange n’est plus en attente.' };
        return { ok: true };
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
    },

    // chance multipliée pour tout le serveur (luck 1 = arrêter)
    'POST /api/admin/event': async (req, u, b) => {
        if (!isAdmin(u)) return { status: 403, error: 'Réservé aux admins.' };
        const luck = Math.round(+b.luck), minutes = Math.round(+b.minutes || 0);
        if (!Number.isFinite(luck) || luck < 1 || luck > Engine.MAX_LUCK) return { error: `Multiplicateur entre 1 et ${Engine.MAX_LUCK}.` };
        if (!Number.isFinite(minutes) || minutes < 0 || minutes > 60 * 24 * 30) return { error: 'Durée invalide (30 jours max).' };
        EVENT = luck > 1 ? { luck, until: minutes ? Date.now() + minutes * 60e3 : null, by: u.pseudo, at: Date.now() } : { luck: 1, until: null, by: u.pseudo };
        await store.setSetting('event', EVENT);
        console.log(`[admin] ${u.pseudo} : chance x${luck}${luck > 1 ? (minutes ? ' pendant ' + minutes + ' min' : ' sans limite') : ' (arrêt)'}`);
        return { event: eventInfo() };
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
    const ev = await store.getSetting('event').catch(() => null);
    if (ev && ev.luck > 1) EVENT = ev;
    server.listen(PORT, () => console.log(`Anime Boosters sur le port ${server.address().port} — comptes : ${store.kind}${ADMIN_EMAILS.length ? ' — admins : ' + ADMIN_EMAILS.join(', ') : ' — le 1er compte créé sera admin'}`));
})().catch(e => { console.error('Démarrage impossible :', e.message); process.exit(1); });

async function stop() { try { await flush(); await store.close(); } catch (_) {} process.exit(0); }
process.on('SIGTERM', stop);
process.on('SIGINT', stop);
