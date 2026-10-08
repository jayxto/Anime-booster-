'use strict';
const { randomBytes } = require('node:crypto');
const C = require('./tcg-catalog');
const E = require('./tcg-engine');
const P = require('./tcg-pocket');
const rules = game => game?.version === 2 ? P : E;
const TTL = 24 * 60 * 60 * 1000;
module.exports = function tcgApi({ store, data, dirty, limited, getUser }) {
    C.initialize(data);
    // The application runs one Node process. Serialize read/modify/write sequences,
    // including database awaits, so double clicks / two players cannot lose updates.
    let queue = Promise.resolve();
    const serial = fn => { const result = queue.then(fn); queue = result.catch(() => {}); return result; };
    const owned = u => C.ownedCounts(u.state);
    const ensure = u => {
        if (!u.state.tcg) {
            u.state.tcg = { deck: C.suggestDeck(owned(u)), active: null };
            dirty(u.id);
        }
        if (u.state.tcg.deck.length === 0) {
            const candidate = C.suggestDeck(owned(u));
            if (!C.validateOwnedDeck(candidate, owned(u))) {
                u.state.tcg.deck = candidate;
                dirty(u.id);
            }
        }
        return u.state.tcg;
    };
    const deckError = u => C.validateOwnedDeck(ensure(u).deck, owned(u));
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
            closed: !!room.closed, game: rules(room.game).view(room.game, side) };
    }
    function related(u, room) {
        const game = room?.game, side = room?.users.indexOf(u.id);
        const ids = [...ensure(u).deck, ...C.suggestDeck(owned(u))];
        if (game) for (let i = 0; i < 2; i++) {
            const p = game.players[i];
            // Keep the other player's initial choices secret until both players are ready.
            if (game.version === 2) {
                if (game.phase !== 'setup' || i === side)
                    ids.push(...(p.active ? [p.active.card] : []), ...p.bench.map(u => u.card), ...p.discard);
            } else ids.push(...p.board.map(u => u.card), ...p.discard);
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
            catch (e) { if (e instanceof E.RuleError || e instanceof P.RuleError) return { status: 400, error: e.message }; throw e; }
        });
    };
    async function available(u) {
        const old = await active(u);
        requireRule(!old || old.closed || (old.game && old.game.winner !== null), 'Termine ou abandonne ta partie actuelle avant de créer ou rejoindre un salon.');
    }
    return {
        'GET /api/tcg/catalog': async (req, u) => {
            if (!u) return { status: 401, error: 'Connecte-toi pour afficher tes cartes.' };
            const params = new URL(req.url || '/', 'http://localhost').searchParams;
            const inventory = owned(u);
            return { ...C.search({ q: params.get('q') || '', kind: params.get('kind') || 'all', offset: Number(params.get('offset') || 0), owned: inventory }),
                owned: inventory, catalogSize: C.cards.length };
        },
        'GET /api/tcg': wrap(async u => ({ deck: ensure(u).deck, owned: owned(u), suggested: C.suggestDeck(owned(u)), room: project(await active(u), u.id), pseudo: u.pseudo })),
        'POST /api/tcg/deck': wrap(async (u, b) => {
            const issue = C.validateOwnedDeck(b?.deck, owned(u));
            requireRule(!issue, issue);
            ensure(u).deck = [...b.deck]; dirty(u.id); return { deck: [...b.deck], owned: owned(u) };
        }),
        'POST /api/tcg/create': wrap(async (u, b) => {
            requireRule(b.mode === 'solo' || b.mode === 'multi', 'Mode invalide.'); await available(u);
            const deck = ensure(u).deck; requireRule(!deckError(u), deckError(u));
            const code = randomBytes(6).toString('hex').toUpperCase();
            const room = { code, mode: b.mode, users: [u.id], names: [u.pseudo], deck: [...deck], expires: Date.now() + TTL, game: null };
            if (b.mode === 'solo') room.game = P.aiTurn(P.create([deck, C.starter], [u.pseudo, 'Sensei · IA'], undefined, 50));
            await write(room); ensure(u).active = code; dirty(u.id); return { room: project(room, u.id) };
        }),
        'POST /api/tcg/join': wrap(async (u, b) => {
            const code = typeof b.code === 'string' ? b.code.trim().toUpperCase() : '';
            const room = await read(code);
            requireRule(room && room.mode === 'multi' && !room.closed, 'Salon introuvable ou expiré.');
            if (room.users.includes(u.id)) return { room: project(room, u.id) };
            requireRule(!room.game && room.users.length === 1, 'Ce salon est déjà complet.'); await available(u);
            const deck = ensure(u).deck; requireRule(!deckError(u), deckError(u));
            // A host's collection can change via trade/sale while waiting for an opponent.
            if (typeof getUser === 'function') {
                const host = await getUser(room.users[0]);
                requireRule(host && !C.validateOwnedDeck(room.deck, owned(host)), 'Le créateur du salon ne possède plus toutes les cartes de son deck.');
            }
            // Settings may be returned by reference by the file store. Never mutate before validation.
            const joined = { ...room, users: [...room.users, u.id], names: [...room.names, u.pseudo], deck: undefined,
                game: P.create([room.deck, deck], [...room.names, u.pseudo]) };
            await write(joined); ensure(u).active = code; dirty(u.id); return { room: project(joined, u.id) };
        }),
        'POST /api/tcg/action': wrap(async (u, b) => {
            const room = await active(u);
            requireRule(room && room.code === b.code && room.game && !room.closed, 'Partie introuvable ou expirée.');
            const side = room.users.indexOf(u.id); requireRule(side >= 0, 'Tu ne participes pas à ce salon.');
            let game = rules(room.game).act(room.game, side, b.action);
            if (room.mode === 'solo') game = rules(game).aiTurn(game);
            const next = { ...room, game }; await write(next); return { room: project(next, u.id) };
        }),
        'POST /api/tcg/leave': wrap(async (u, b) => {
            const room = await active(u);
            requireRule(room && room.code === b.code, 'Salon introuvable ou expiré.');
            const side = room.users.indexOf(u.id); requireRule(side >= 0, 'Tu ne participes pas à ce salon.');
            const game = room.game?.winner === null ? rules(room.game).act(room.game, side, { type: 'concede', revision: room.game.revision }) : room.game;
            await write({ ...room, game, closed: !game }); ensure(u).active = null; dirty(u.id); return { room: null };
        })
    };
};
