'use strict';
const { createHash } = require('node:crypto');
// Signature cards plus stable combat profiles for every catalog character.
// Booster rarities never grant a combat advantage.
const character = (id, name, anime, cost, attack, health, skill, text, effect, target, value, skillCost = 2, passive = '') =>
    ({ id, name, anime, kind: 'character', cost, attack, health, passive, skill: { name: skill, text, effect, target, value, cost: skillCost } });
const assist = (id, name, anime, cost, text, effect, target, value) =>
    ({ id, name, anime, kind: 'assist', cost, text, effect, target, value });
const cards = [
    character('naruto', 'Naruto Uzumaki', 'naruto', 3, 2, 5, 'Multi-clonage', 'Invoque un clone 1/2 avec Garde (place libre requise).', 'clone', 'none', 1),
    character('sasuke', 'Sasuke Uchiwa', 'naruto', 4, 3, 5, 'Chidori', 'Inflige 4 dégâts à un personnage adverse.', 'damage', 'enemy', 4, 3),
    character('gaara', 'Gaara', 'naruto', 3, 1, 7, 'Bouclier de sable', 'Accorde 3 points de bouclier à un allié.', 'shield', 'ally', 3, 2, 'guard'),
    character('kakashi', 'Kakashi Hatake', 'naruto', 3, 2, 4, 'Sharingan', 'Pioche une carte.', 'draw', 'none', 1),
    character('luffy', 'Monkey D. Luffy', 'one-piece', 3, 3, 5, 'Gum-Gum Gatling', 'Inflige 2 dégâts à tous les personnages adverses.', 'area', 'none', 2, 3),
    character('zoro', 'Roronoa Zoro', 'one-piece', 2, 3, 3, 'Santoryu', 'Gagne définitivement +2 attaque.', 'boost', 'self', 2),
    character('ace', 'Portgas D. Ace', 'one-piece', 4, 3, 5, 'Hiken', 'Inflige 2 dégâts et brûle la cible : 1 dégât à la fin de ses 2 prochains tours.', 'burn', 'enemy', 2, 3),
    character('goku', 'Sangoku', 'dragon-ball', 5, 4, 6, 'Kamehameha', 'Inflige 5 dégâts à un personnage adverse.', 'damage', 'enemy', 5, 4),
    character('vegeta', 'Vegeta', 'dragon-ball', 4, 4, 4, 'Final Flash', 'Inflige 3 dégâts à tous les personnages adverses.', 'area', 'none', 3, 4),
    character('rukia', 'Rukia Kuchiki', 'bleach', 2, 2, 4, 'Sode no Shirayuki', 'Gèle un ennemi : il ne peut pas agir pendant son prochain tour.', 'freeze', 'enemy', 1),
    character('tanjiro', 'Tanjiro Kamado', 'kimetsu-no-yaiba', 2, 2, 4, 'Souffle de l’eau', 'Inflige 2 dégâts et soigne votre héros de 2 PV.', 'drain', 'enemy', 2),
    character('gojo', 'Satoru Gojo', 'jujutsu-kaisen', 5, 3, 7, 'Infini', 'Accorde 4 points de bouclier à un allié.', 'shield', 'ally', 4, 3, 'guard'),
    assist('sakura', 'Sakura Haruno', 'naruto', 2, 'Ninjutsu médical : soigne un allié de 4 PV.', 'heal', 'ally', 4),
    assist('chopper', 'Tony Tony Chopper', 'one-piece', 2, 'Médecine de bord : soigne votre héros de 5 PV.', 'heroHeal', 'none', 5),
    assist('bulma', 'Bulma', 'dragon-ball', 2, 'Capsule de ravitaillement : pioche 2 cartes.', 'draw', 'none', 2),
    assist('shikamaru', 'Shikamaru Nara', 'naruto', 2, 'Manipulation des ombres : gèle un ennemi pour son prochain tour.', 'freeze', 'enemy', 1),
    assist('nami', 'Nami', 'one-piece', 3, 'Thunderbolt Tempo : inflige 3 dégâts à un personnage adverse.', 'damage', 'enemy', 3),
    assist('orihime', 'Orihime Inoue', 'bleach', 1, 'Santen Kesshun : accorde 2 points de bouclier à un allié.', 'shield', 'ally', 2)
];
const byId = Object.fromEntries(cards.map(c => [c.id, c]));
const starter = ['naruto', 'gaara', 'kakashi', 'luffy', 'zoro', 'rukia', 'tanjiro', 'sakura', 'bulma', 'nami'].flatMap(id => [id, id]);
function validateDeck(deck) {
    if (!Array.isArray(deck) || deck.length !== 20) return 'Un deck contient exactement 20 cartes.';
    const counts = new Map(); let characters = 0;
    for (const id of deck) {
        if (typeof id !== 'string' || !Object.hasOwn(byId, id)) return 'Carte inconnue dans le deck.';
        const n = (counts.get(id) || 0) + 1; counts.set(id, n);
        if (n > 2) return 'Deux exemplaires maximum par carte.';
        if (byId[id].kind === 'character') characters++;
    }
    return characters < 12 ? 'Il faut au moins 12 personnages.' : null;
}
const profiles = [
    { role: 'Duelliste', cost: 2, attack: 3, health: 3, skill: 'Assaut précis', text: 'Inflige 2 dégâts à un ennemi.', effect: 'damage', target: 'enemy', value: 2, skillCost: 2 },
    { role: 'Gardien', cost: 3, attack: 1, health: 7, skill: 'Protection', text: 'Accorde 3 points de bouclier à un allié.', effect: 'shield', target: 'ally', value: 3, skillCost: 2, passive: 'guard' },
    { role: 'Stratège', cost: 3, attack: 2, health: 4, skill: 'Anticipation', text: 'Pioche une carte.', effect: 'draw', target: 'none', value: 1, skillCost: 2 },
    { role: 'Soutien', cost: 2, attack: 1, health: 5, skill: 'Second souffle', text: 'Soigne un allié de 3 PV.', effect: 'heal', target: 'ally', value: 3, skillCost: 2 },
    { role: 'Combattant', cost: 4, attack: 3, health: 6, skill: 'Détermination', text: 'Gagne définitivement +2 attaque.', effect: 'boost', target: 'self', value: 2, skillCost: 2 },
    { role: 'Commandant', cost: 5, attack: 3, health: 7, skill: 'Offensive coordonnée', text: 'Inflige 2 dégâts à tous les personnages adverses.', effect: 'area', target: 'none', value: 2, skillCost: 3 }
];
const normalize = s => String(s).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
let initialized = false, searchRows = [];
function initialize(data) {
    if (initialized) return;
    const signatures = new Map(cards.filter(c => c.kind === 'character').map(c => [c.anime + '|' + c.name, c]));
    const seen = new Set();
    for (const [anime, a] of Object.entries(data.animes)) for (const row of a.cards) {
        const key = anime + '|' + row[0]; if (seen.has(key)) continue; seen.add(key);
        if (!signatures.has(key)) {
            const hash = createHash('sha256').update(key).digest('hex'), p = profiles[parseInt(hash.slice(0, 8), 16) % profiles.length];
            const c = character('char-' + hash.slice(0, 24), row[0], anime, p.cost, p.attack, p.health, p.skill, p.text, p.effect, p.target, p.value, p.skillCost, p.passive);
            c.source = 'profile'; c.role = p.role; cards.push(c); byId[c.id] = c;
        }
    }
    const artwork = new Map();
    for (const [anime, a] of Object.entries(data.animes)) for (const row of a.cards) if (!artwork.has(anime + '|' + row[0])) artwork.set(anime + '|' + row[0], row[2]);
    for (const c of cards) {
        const img = artwork.get(c.anime + '|' + c.name);
        c.franchise = data.animes[c.anime]?.name || c.anime;
        c.image = img ? (/^https?:/.test(img) ? img : data.imgPrefix + img) : null;
        c.source = c.source || 'signature';
    }
    searchRows = cards.map(c => normalize(c.name + ' ' + c.franchise + ' ' + (c.role || '')));
    initialized = true;
}
function catalog(data) { initialize(data); return cards; }
function search({ q = '', kind = 'all', offset = 0, owned } = {}) {
    const query = normalize(String(q).slice(0, 100)).trim();
    const start = Math.max(0, Math.min(cards.length, Number.isSafeInteger(offset) ? offset : 0));
    const matches = cards.filter((c, i) => (!owned || owned[c.anime + '|' + c.name] > 0) && (kind === 'all' || c.kind === kind) && (!query || searchRows[i].includes(query)));
    return { cards: matches.slice(start, start + 36), total: matches.length, offset: start, more: start + 36 < matches.length };
}
function details(ids) { return [...new Set(ids)].filter(id => Object.hasOwn(byId, id)).map(id => byId[id]); }
module.exports = { cards, byId, starter, validateDeck, catalog, initialize, search, details };
