'use strict';
const { randomBytes } = require('node:crypto');
const C = require('./tcg-catalog');
const E = require('./tcg-engine');
const TTL = 24 * 60 * 60 * 1000;
module.exports = function tcgApi({ store, data, dirty, limited }) {
    C.initialize(data);
    // The application runs one Node process. Serialize read/modify/write sequences,
    // including database awaits, so double clicks / two players cannot lose updates.
    let queue = Promise.resolve();
    const serial = fn => { const result = queue.then(fn); queue = result.catch(() => {}); return result; };
    const ensure = u => { if (!u.state.tcg) { u.state.tcg = { deck: [...C.starter], active: null }; dirty(u.id); } return u.state.tcg; };
    const requireRule = (ok, message) => { if (!ok) throw new E.RuleError(message); };
    async function read(code) {
        if (typeof code !== 'string' || !/^[A-F0-9]{12}$/.test(code)) return null;
        const room = await store.getSetting('tcg:' + code);
        return room && room.expires > Date.now() ? room : null;
    }
    const write = room => store.setSetting('tcg:' + room.code, room);
    function project(room, uid) {
        if (!room) return null;
        const side = room.users.indexOf(uid); requireRule(side >= 0, 'Tu ne participes pas à ce salon.');
        return { code: room.code, mode: room.mode, expires: room.expires, waiting: !room.game && !room.closed,
            closed: !!room.closed, game: E.view(room.game, side) };
    }
    function related(u, room) {
        const game = room?.game, side = room?.users.indexOf(u.id);
        const ids = [...ensure(u).deck];
        if (game) for (let i = 0; i < 2; i++) {
            const p = game.players[i]; ids.push(...p.board.map(u => u.card), ...p.discard);
            if (i === side) ids.push(...p.hand.map(h => h.card));
        }
        return C.details(ids);
    }
    async function active(u) {
        const state = ensure(u), room = await read(state.active);
        if (!room && state.active) { state.active = null; dirty(u.id); }
        return room;
    }
    const wrap = fn => async (req, u, body) => {
        if (!u) return { status: 401, error: 'Connecte-toi depuis les boosters pour jouer et sauvegarder tes decks.' };
        if (limited('tcg:' + u.id, 100, 10000)) return { status: 429, error: 'Trop de requêtes. Patiente quelques secondes.' };
        return serial(async () => {
            try { const result = await fn(u, body); if (!result.error) result.cards = related(u, await active(u)); return result; }
            catch (e) { if (e instanceof E.RuleError) return { status: 400, error: e.message }; throw e; }
        });
    };
    async function available(u) {
        const old = await active(u);
        requireRule(!old || old.closed || (old.game && old.game.winner !== null), 'Termine ou abandonne ta partie actuelle avant de créer ou rejoindre un salon.');
    }
    return {
        'GET /api/tcg/catalog': async req => {
            const params = new URL(req.url || '/', 'http://localhost').searchParams;
            return { ...C.search({ q: params.get('q') || '', kind: params.get('kind') || 'all', offset: Number(params.get('offset') || 0) }), starter: C.starter, starterCards: C.details(C.starter), catalogSize: C.cards.length };
        },
        'GET /api/tcg': wrap(async u => ({ deck: ensure(u).deck, room: project(await active(u), u.id), pseudo: u.pseudo })),
        'POST /api/tcg/deck': wrap(async (u, b) => {
            requireRule(!C.validateDeck(b.deck), C.validateDeck(b.deck));
            ensure(u).deck = [...b.deck]; dirty(u.id); return { deck: [...b.deck] };
        }),
        'POST /api/tcg/create': wrap(async (u, b) => {
            requireRule(b.mode === 'solo' || b.mode === 'multi', 'Mode invalide.'); await available(u);
            const deck = ensure(u).deck; requireRule(!C.validateDeck(deck), C.validateDeck(deck));
            const code = randomBytes(6).toString('hex').toUpperCase();
            const room = { code, mode: b.mode, users: [u.id], names: [u.pseudo], deck: [...deck], expires: Date.now() + TTL, game: null };
            if (b.mode === 'solo') room.game = E.create([deck, C.starter], [u.pseudo, 'Sensei · IA']);
            await write(room); ensure(u).active = code; dirty(u.id); return { room: project(room, u.id) };
        }),
        'POST /api/tcg/join': wrap(async (u, b) => {
            const code = typeof b.code === 'string' ? b.code.trim().toUpperCase() : '';
            const room = await read(code);
            requireRule(room && room.mode === 'multi' && !room.closed, 'Salon introuvable ou expiré.');
            if (room.users.includes(u.id)) return { room: project(room, u.id) };
            requireRule(!room.game && room.users.length === 1, 'Ce salon est déjà complet.'); await available(u);
            const deck = ensure(u).deck; requireRule(!C.validateDeck(deck), C.validateDeck(deck));
            // Settings may be returned by reference by the file store. Never mutate before validation.
            const joined = { ...room, users: [...room.users, u.id], names: [...room.names, u.pseudo], deck: undefined,
                game: E.create([room.deck, deck], [...room.names, u.pseudo]) };
            await write(joined); ensure(u).active = code; dirty(u.id); return { room: project(joined, u.id) };
        }),
        'POST /api/tcg/action': wrap(async (u, b) => {
            const room = await active(u);
            requireRule(room && room.code === b.code && room.game && !room.closed, 'Partie introuvable ou expirée.');
            const side = room.users.indexOf(u.id); requireRule(side >= 0, 'Tu ne participes pas à ce salon.');
            let game = E.act(room.game, side, b.action);
            if (room.mode === 'solo') game = E.aiTurn(game);
            const next = { ...room, game }; await write(next); return { room: project(next, u.id) };
        }),
        'POST /api/tcg/leave': wrap(async (u, b) => {
            const room = await active(u);
            requireRule(room && room.code === b.code, 'Salon introuvable ou expiré.');
            const side = room.users.indexOf(u.id); requireRule(side >= 0, 'Tu ne participes pas à ce salon.');
            const game = room.game?.winner === null ? E.act(room.game, side, { type: 'concede', revision: room.game.revision }) : room.game;
            await write({ ...room, game, closed: !game }); ensure(u).active = null; dirty(u.id); return { room: null };
        })
    };
};
