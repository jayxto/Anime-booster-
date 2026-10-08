'use strict';
const C = require('./tcg-catalog');
const keyOf = c => c.anime + '|' + c.name;

// Normal, special and seasonal printings share a character inventory. Shiny and
// finish are attributes of copies already counted in n. A duo is not two singles.
function inventory(state, collection) {
    const counts = Object.create(null);
    for (const [key, entry] of Object.entries(state.cards || {})) {
        if (!Number.isSafeInteger(entry?.n) || entry.n <= 0 || !collection.validKey(key)) continue;
        const card = collection.cardOfKey(key);
        if (!card || card.duo || !card.u) continue;
        const identity = card.u + '|' + card.name;
        counts[identity] = Math.min(Number.MAX_SAFE_INTEGER, (counts[identity] || 0) + entry.n);
    }
    return counts;
}
function validate(deck, owned) {
    const format = C.validateDeck(deck); if (format) return format;
    const used = Object.create(null);
    for (const id of deck) {
        const c = C.byId[id], key = keyOf(c); used[key] = (used[key] || 0) + 1;
        if (used[key] > (owned[key] || 0)) return `Collection insuffisante pour ${c.name} : ${owned[key] || 0} exemplaire(s) possédé(s), partagé(s) entre personnage et assist.`;
    }
    return null;
}
function decorate(cards, owned) { return cards.map(c => ({ ...c, collectionKey: keyOf(c), owned: owned[keyOf(c)] || 0 })); }
let identities;
function suggestion(owned) {
    if (!identities) {
        identities = new Map();
        for (const c of C.cards) {
            const key = keyOf(c); if (!identities.has(key)) identities.set(key, {});
            identities.get(key)[c.kind] = c.id;
        }
    }
    const candidates = Object.keys(owned).map(key => ({ key, ...identities.get(key) }));
    const deck = [], spent = Object.create(null), copies = Object.create(null);
    const add = (kind, limit) => {
        for (const c of candidates) {
            const id = c[kind]; if (!id) continue;
            while (deck.length < limit && (spent[c.key] || 0) < owned[c.key] && (copies[id] || 0) < 2) {
                deck.push(id); spent[c.key] = (spent[c.key] || 0) + 1; copies[id] = (copies[id] || 0) + 1;
            }
        }
    };
    add('character', 12); add('assist', 20); add('character', 20);
    return deck;
}
module.exports = { keyOf, inventory, validate, decorate, suggestion };
