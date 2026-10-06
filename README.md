# 🎴 Anime Boosters

Jeu 100 % ouverture de boosters de cartes animé, avec le système de packs d'Anime Game.

## Lancer
```
npm start          # http://localhost:3000
```
Aucune dépendance. La partie est sauvegardée dans le navigateur.

## Contenu
- Les ~3 000 animés les plus populaires d'AniList, regroupés par franchise (saisons, films, spin-offs ensemble), + le Pokédex complet
- Chaque perso a la photo de **sa** fiche dans **son** animé (récupérée depuis la liste des persos de l'animé, pas par recherche de nom)
- Les persos et animés qui existent dans Anime Game gardent leur nom (« Monkey D. Luffy », « Sangoku », « L'Attaque des Titans »)
- ♾️ **Pack Infini** : gratuit et illimité, avec mode Auto (Espace = pack suivant)
- 📖 **Classeur** : un classeur par animé, couverture en cuir, anneaux, pochettes 3×3, pages qui tournent (glisser un coin, flèches ou boutons), cartes manquantes en fantôme
- Raretés d'Anime Game : Commune → Mythique + Secrète, Divine, Cosmique, Éternelle, Oméga
- Brillantes, 11 finitions, God Pack (1/500), cartes Duo, cartes de saison (Halloween, Noël, Valentin, Été)
- Boosters : 3, 10, Épique, Mythique, Duo, saisonniers, Pack Chance (x10), un booster par animé
- Booster gratuit toutes les 2 h, cadeau du jour, pièces des doublons, sons (bouton 🔊 pour couper)

## Mettre à jour les cartes
```
node tools/fetch-anilist.js 3000   # animés + persos depuis AniList (cache dans tools/cache)
node tools/build-cards.js          # génère public/cards.json
```
`tools/pool.json`, `extra.json`, `halloween.json` : noms, Pokédex, Duos et cartes de saison repris d'Anime Game.

Pages qui tournent : [StPageFlip](https://github.com/Nodlik/StPageFlip) (MIT), dans `public/vendor/`.
