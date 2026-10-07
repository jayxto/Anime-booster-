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
- **🍀 Chance pour tout le serveur** (onglet Admin) : x2, x5, **x10**, x50 ou x100 pendant 15 min, 1 h, 24 h… ou jusqu'à l'arrêt.
  Tout le monde voit un bandeau, et la chance s'applique à tous les packs (Pack Chance pendant l'événement x10 = x100, comme sur Anime Game).

### Variables d'environnement
| Variable | Rôle |
|---|---|
| `DATABASE_URL` | Base Postgres (Neon, Supabase, Render…). Les tables sont préfixées `ab_`, la base d'Anime Game peut donc être réutilisée. Sans elle, les comptes sont gardés dans `data/db.json` (à éviter sur un hébergeur qui efface le disque à chaque redémarrage). |
| `ADMIN_EMAILS` | E-mail(s) des admins, séparés par des virgules. **Sans elle, le premier compte créé devient admin** : crée ton compte juste après la mise en ligne. |
| `PORT` | Port du serveur (3000 par défaut). |

## Contenu
- Les ~7 000 animés les plus populaires d'AniList, regroupés par franchise (saisons, films, spin-offs ensemble), + le Pokédex complet ; jusqu'à 750 persos pour les plus grosses franchises
- Une mise à jour des données garde les mêmes clés d'animés et les mêmes noms : les cartes déjà obtenues par les joueurs restent valables (`tools/cache/anilist-v1.json` et `cards-v1.json` servent de référence)
- Chaque perso a la photo de **sa** fiche dans **son** animé (récupérée depuis la liste des persos de l'animé, pas par recherche de nom)
- Les persos et animés qui existent dans Anime Game gardent leur nom (« Monkey D. Luffy », « Sangoku », « L'Attaque des Titans »)
- ♾️ **Pack Infini** : gratuit et illimité, avec mode Auto (Espace = pack suivant)
- 📖 **Classeur** : un classeur par animé (ses persos puis leurs versions spéciales), couverture en cuir, anneaux, pochettes 3×3, pages qui tournent (glisser un coin, flèches ou boutons), cartes manquantes en fantôme avec leur chance
- 📚 **Classeur principal** : toutes les cartes du jeu (des milliers de pages), avec « Aller à un animé » et « Mes cartes »
- 💖 **Classeur Waifus** : tous les persos féminins du jeu
- **Toutes les raretés d'Anime Game** : Commune → Mythique + 31 raretés spéciales (Secrète, Ombre, Stellaire, Éveillée, Minuit, Mirage, Divine, Éclat, Spectrale, Solaire, Lunaire, Céleste, Héroïque, Sacrée, Cosmique, Tempête, Infernale, Onirique, Glaciale, Corrompue, Légende vivante, Impériale, Éternelle, Démoniaque, Abyssale, Ancestrale, Dimensionnelle, Oméga, Chaos, Primordiale, Absolue), avec les mêmes taux et règles (Minuit seulement de minuit à 6 h, Éternelle sur les 10 animés phares, Oméga sur One Piece / Naruto / Dragon Ball)
- **Les 28 finitions d'Anime Game** (Holographique, Reverse, Pailletée, Gold, Dark, Full Art, Manga, Galaxie, Glitch, Signée, Numérotée, Sceau de sang, Cristal, Chibi, Prismatique, Aurore boréale, Vitrail, Inversée, 8-bit, Néon, Feuille d'or, Électrique, En feu, Rétro VHS, Givrée, Aquarelle, Croquis, Sakura) avec leurs styles (`public/anime-game-cards.css`, repris par `tools/port-card-css.js`)
- **🎲 Chances d'obtention** : onglet Stats (toutes les raretés, finitions, God Pack…) et sur chaque carte (fiche et classeur), calculées avec les mêmes règles que le tirage
- **Ouverture « Cercle d'invocation »** : on glisse le pack dans un cercle runique (ou on le touche) ; le cercle s'allume rune après rune dans la couleur de la meilleure carte du pack, des colonnes de lumière montent, puis tout explose en lumière. Les cartes retombent face cachée autour du cercle et leur aura trahit leur rareté (lueur bleue, violette, flammes dès légendaire, halo tournant pour les raretés spéciales). Dès légendaire, la carte vient au centre : la salle s'assombrit, le cœur bat pour les plus rares, puis bannière, nom, chance d'obtention et finition. « Tout révéler » retourne toutes les cartes d'un coup (un seul éclair dans la couleur de la meilleure, dont la rareté s'affiche au centre du cercle). Dos de carte illustré (cadre doré, médaillon, monogramme AB) dont le cœur s'allume dans la couleur de la rareté. Mode auto, clavier (Espace / Échap) et téléphone. Pas de confettis : rien que de la lumière douce et des sons générés avec réverbération
- Brillantes, God Pack (1/500), cartes Duo, cartes de saison (Halloween, Noël, Valentin, Été)
- Boosters : 3, 10, Épique, Mythique, Duo, saisonniers, Pack Chance (x10), **Waifu** (que des persos féminins, versions spéciales comprises, 1 épique min.), un booster par animé
- Booster gratuit toutes les 2 h, cadeau du jour, vente des doublons, sons (bouton 🔊 pour couper)

## Mettre à jour les cartes
```
npm run fetch      # animés + persos depuis AniList (cache dans tools/cache)
npm run build      # génère public/cards.json
```
`tools/pool.json`, `extra.json`, `halloween.json` : noms, Pokédex, Duos et cartes de saison repris d'Anime Game.

## Fichiers
- `server.js` : site, comptes, sauvegarde, admin
- `public/engine.js` : raretés, finitions, tirage des packs et chances d'obtention (le même code tourne dans le navigateur pour les invités et sur le serveur pour les comptes)
- `public/summon.js` + `summon.css` : l'ouverture « Cercle d'invocation » (mise en scène, lumière, sons)
- `public/game.js`, `index.html`, `style.css` : l'interface
- Pages qui tournent : [StPageFlip](https://github.com/Nodlik/StPageFlip) (MIT), dans `public/vendor/`
