# 🎴 Anime Boosters

Jeu 100 % ouverture de boosters de cartes animé, avec le système de packs d'Anime Game.

## Lancer
```
npm install
npm start          # http://localhost:3000
```

## Comptes et admin
- On peut jouer **en invité** (partie gardée dans le navigateur) ou **créer un compte** avec son adresse e-mail, un pseudo et un mot de passe.
  Avec un compte, la collection est sauvegardée sur le serveur et on la retrouve sur tous ses appareils.
  En créant son compte, on peut garder les cartes de sa partie invité.
- Pour un compte, les packs sont tirés **par le serveur** : impossible de tricher sur ses pièces ou ses cartes.
- **Admin** : onglet 👑 Admin → pseudo du joueur + nombre de pièces, sans limite (`1000`, `1 000 000 000`, `1 milliard`, `2M`, `500k`, `-500` pour en retirer).
  Le joueur reçoit une notification « 🎁 Tu as reçu … pièces ».

### Variables d'environnement
| Variable | Rôle |
|---|---|
| `DATABASE_URL` | Base Postgres (Neon, Supabase, Render…). Les tables sont préfixées `ab_`, la base d'Anime Game peut donc être réutilisée. Sans elle, les comptes sont gardés dans `data/db.json` (à éviter sur un hébergeur qui efface le disque à chaque redémarrage). |
| `ADMIN_EMAILS` | E-mail(s) des admins, séparés par des virgules. **Sans elle, le premier compte créé devient admin** : crée ton compte juste après la mise en ligne. |
| `PORT` | Port du serveur (3000 par défaut). |

## Contenu
- Les ~3 000 animés les plus populaires d'AniList, regroupés par franchise (saisons, films, spin-offs ensemble), + le Pokédex complet
- Chaque perso a la photo de **sa** fiche dans **son** animé (récupérée depuis la liste des persos de l'animé, pas par recherche de nom)
- Les persos et animés qui existent dans Anime Game gardent leur nom (« Monkey D. Luffy », « Sangoku », « L'Attaque des Titans »)
- ♾️ **Pack Infini** : gratuit et illimité, avec mode Auto (Espace = pack suivant)
- 📖 **Classeur** : un classeur par animé, couverture en cuir, anneaux, pochettes 3×3, pages qui tournent (glisser un coin, flèches ou boutons), cartes manquantes en fantôme
- Raretés d'Anime Game : Commune → Mythique + Secrète, Divine, Cosmique, Éternelle, Oméga
- Brillantes, 11 finitions, God Pack (1/500), cartes Duo, cartes de saison (Halloween, Noël, Valentin, Été)
- Boosters : 3, 10, Épique, Mythique, Duo, saisonniers, Pack Chance (x10), un booster par animé
- Booster gratuit toutes les 2 h, cadeau du jour, vente des doublons, sons (bouton 🔊 pour couper)

## Mettre à jour les cartes
```
npm run fetch      # animés + persos depuis AniList (cache dans tools/cache)
npm run build      # génère public/cards.json
```
`tools/pool.json`, `extra.json`, `halloween.json` : noms, Pokédex, Duos et cartes de saison repris d'Anime Game.

## Fichiers
- `server.js` : site, comptes, sauvegarde, admin
- `public/engine.js` : tirage des packs (le même code tourne dans le navigateur pour les invités et sur le serveur pour les comptes)
- `public/game.js`, `index.html`, `style.css` : l'interface
- Pages qui tournent : [StPageFlip](https://github.com/Nodlik/StPageFlip) (MIT), dans `public/vendor/`
