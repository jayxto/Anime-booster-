# 🎴 Anime Boosters

Ouverture de boosters de cartes animé, collection, échanges et **arène Anime Duel TCG**, en solo contre l’IA ou en duel multijoueur privé.

## Lancer
```
npm install
npm start          # http://localhost:3000
npm test           # moteur TCG, API et intégration HTTP (Node >=18)
```

## ⚔ Arène Anime Duel TCG

Depuis le nouvel onglet **Arène TCG** dans l’interface existante, ou `/#tcg` : connecte-toi avec ton compte existant, prépare ton deck puis joue contre le Sensei ou crée/rejoins un salon privé avec son code. L’en-tête, la navigation, les boosters, les classeurs et les styles existants sont conservés ; les styles TCG sont limités à ce nouvel onglet. Deux comptes distincts sont nécessaires pour le multijoueur. La partie s’actualise toutes les 2,5 secondes et reprend après une déconnexion ou un redémarrage du serveur.

- **Les personnages du catalogue ont des définitions TCG**, mais le joueur ne peut utiliser que les personnages qu'il possède réellement dans sa collection après ouverture de boosters ou échanges. Les versions de rareté et les finitions du même personnage se cumulent pour la quantité jouable (maximum 2 exemplaires par deck). Les 6 assists suivent les mêmes règles de possession. Recherche paginée sur la collection de l'utilisateur.
- Deck de **20 cartes**, 2 exemplaires maximum **dans la limite des copies réellement possédées**, et au moins 12 personnages. Recherche, filtres, courbe de mana et sauvegarde dans le compte. Un deck conseillé peut être construit à partir des packs ouverts. Les modifications s’appliquent à la prochaine partie. Vérification serveur à la sauvegarde, à la création du salon et lors de l'entrée dans le salon du deuxième joueur.
- **Format Pocket 1 contre 1 :** main initiale de 5 cartes, un combattant actif et jusqu’à 3 combattants sur le banc. Mise en place avant le premier tour, main plafonnée à 8, pioche d’une carte au début de chaque tour à partir du deuxième.
- **Énergie :** une énergie à attribuer chaque tour à un personnage actif ou du banc, conservée sur la carte. Chaque attaque/technique exige un coût en énergie ; attaquer termine immédiatement le tour. Échange avec le banc contre une énergie ; au K.O., remplacement obligatoire si disponible. Une carte assist par tour.
- **K.O. et victoire :** les PV sont portés par les cartes combattantes (pas par un héros à 30 PV). Chaque K.O. donne un point, ou deux pour un personnage éveillé. Premier joueur à 3 points, ou dernier joueur ayant encore un combattant, gagne. Techniques adaptées : Chidori, Hiken, Multi-clonage, Kamehameha, boucliers, gel, brûlure, soin, zone et pioche. Éveil par une deuxième copie du même personnage jouée après le tour d’arrivée (bonus de PV et d’attaque).
- Le serveur valide la session, le participant, le tour, le placement initial, les cartes en main, l’énergie disponible, les attaques, les limites du banc et la révision de partie. Les requêtes répétées sont refusées. La main adverse et l’ordre des pioches ne sont jamais envoyés au navigateur.
- Un salon actif par compte, expiration après 24 h, abandon possible même pendant le tour adverse. Sans chronomètre ni matchmaking public. Le créateur commence.

**Compétences :** 12 personnages possèdent des techniques signature définies à la main et 6 assists ont des effets spécifiques. Les autres personnages ont un profil de combat explicite parmi six rôles équilibrés (Duelliste, Gardien, Stratège, Soutien, Combattant, Commandant). Ces compétences génériques ne sont pas présentées comme des techniques officielles de l’anime. Le profil et l’identifiant sont déterministes à partir de l’univers et du nom ; ajouter des personnages ne change pas les anciens decks. Pour enrichir un personnage avec une technique signature, conserver son identifiant publié.

**Format actuel :** l'accès aux cartes de combat dépend de la collection réelle sauvegardée du compte (packs et échanges), sans concession de cartes gratuites dans le TCG. Les raretés et finitions n’accordent aucun avantage de combat. Les cartes de collection ne sont pas consommées par un match ; aucun gain/perte de pièces ni de cartes n’est lié aux duels. Les parties déjà commencées utilisent le snapshot du deck au lancement.

### Stockage et exploitation du TCG

Les decks et le code du salon actif sont conservés dans `state.tcg`. Les salons privés sont stockés dans les paramètres existants (`ab_settings` sous Postgres, `settings` dans le fichier JSON) avec une échéance de 24 h. Pas de migration destructive. Le délai de sauvegarde existant des comptes est d’environ 2 secondes ; le stockage fichier ajoute 300 ms. Utiliser Postgres ou un disque persistant en production.

**Une seule instance Node est prise en charge**, comme le cache de comptes existant. Une file d’exécution protège les mutations de salons dans ce processus, y compris pendant les écritures asynchrones. Ne pas activer plusieurs workers/réplicas sans ajouter des transactions/verrous interprocessus et revoir le cache des comptes. Les salons expirés sont refusés ; une purge périodique des paramètres `tcg:*` expirés peut être planifiée pour les longues exploitations.

Les tests HTTP utilisent un fichier temporaire via `DATA_FILE`, deux comptes fictifs et un port attribué automatiquement ; ils ne touchent pas la base configurée en production. La suite couvre aussi les courses entre deux joueurs, les reprises après redémarrage, les informations privées et l’absence de modification de la collection.

Fichiers TCG : `lib/tcg-catalog.js` (cartes et decks), `lib/tcg-pocket.js` (nouveau moteur de duel et IA), `lib/tcg-engine.js` (ancien moteur pour les parties déjà ouvertes), `lib/tcg-api.js` (salons et autorisations), `public/index.html`, `tcg-pocket.css` et `tcg-pocket.js` (terrain interactif), `tcg.css` et `tcg.js` (onglet intégré), `test/`. `/tcg.html` redirige vers l’onglet intégré. CI sur Node 18 et 22.

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
- **Ouverture « Cercle d'invocation »** : on glisse le pack dans un cercle runique (ou on le touche) ; le cercle s'allume rune après rune dans la couleur de la meilleure carte du pack, des colonnes de lumière montent, puis tout explose en lumière. Les cartes retombent face cachée autour du cercle et leur aura trahit leur rareté (lueur bleue, violette, flammes dès légendaire, halo tournant pour les raretés spéciales). Dès légendaire, la carte vient au centre : la salle s'assombrit, le cœur bat pour les plus rares, puis bannière, nom, chance d'obtention et finition. « Tout révéler » retourne toutes les cartes d'un coup (un seul éclair dans la couleur de la meilleure, dont la rareté s'affiche au centre du cercle). Dos de carte « Sakura impérial » (laque rouge, soleil d'or, cerisier, vagues seigaiha, sceau 桜) dont le cœur s'allume dans la couleur de la rareté. Mode auto, clavier (Espace / Échap) et téléphone. Pas de confettis : rien que de la lumière douce et des sons générés avec réverbération
- Brillantes, God Pack (1/500), cartes Duo, cartes de saison (Halloween, Noël, Valentin, Été)
- Boosters : 3, 10, Épique, Mythique, Duo, saisonniers, Pack Chance (x10), **Waifu** (que des persos féminins, versions spéciales comprises, 1 épique min.), un booster par animé
- Booster gratuit toutes les 2 h, cadeau du jour, vente des doublons, sons (bouton 🔊 pour couper)

## Mettre à jour les cartes
```
npm run fetch      # animés + persos depuis AniList (cache dans tools/cache)
npm run cards      # génère public/cards.json
```
`tools/pool.json`, `extra.json`, `halloween.json` : noms, Pokédex, Duos et cartes de saison repris d'Anime Game.

## Fichiers
- `server.js` : site, comptes, sauvegarde, admin
- `public/engine.js` : raretés, finitions, tirage des packs et chances d'obtention (le même code tourne dans le navigateur pour les invités et sur le serveur pour les comptes)
- `public/summon.js` + `summon.css` : l'ouverture « Cercle d'invocation » (mise en scène, lumière, sons)
- `public/game.js`, `index.html`, `style.css` : l'interface
- Pages qui tournent : [StPageFlip](https://github.com/Nodlik/StPageFlip) (MIT), dans `public/vendor/`
