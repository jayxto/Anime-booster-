# 🎴 Anime Boosters

Jeu 100 % ouverture de boosters de cartes animé, avec le système de packs d'Anime Game.

## Lancer
```
npm start          # http://localhost:3000
```
Aucune dépendance. La partie est sauvegardée dans le navigateur.

## Contenu
- Les ~1 500 animés les plus populaires (AniList), saisons/films regroupés, + le Pokédex complet
- Chaque perso a la photo officielle de SON animé (récupérée depuis la fiche de l'animé, pas par recherche de nom)
- ♾️ **Pack Infini** : gratuit et illimité, avec mode Auto (Espace = pack suivant)
- 📖 **Classeur** : un classeur par animé, pochettes 3×3, pages qui tournent (glisser ou flèches), silhouettes des cartes manquantes
- Raretés d'Anime Game : Commune → Mythique + Secrète, Divine, Cosmique, Éternelle, Oméga
- Brillantes, 11 finitions, God Pack (1/500), cartes Duo, cartes de saison (Halloween, Noël, Valentin, Été)
- Boosters : 3, 10, Épique, Mythique, Duo, saisonniers, Pack Chance (x10), un booster par animé
- Booster gratuit toutes les 2 h, cadeau du jour, pièces des doublons

## Mettre à jour les cartes
```
node tools/fetch-anilist.js 1500   # animés + persos depuis AniList (cache dans tools/cache)
node tools/build-cards.js          # génère public/cards.json
```
`tools/pool.json`, `extra.json`, `halloween.json` : Pokédex, Duos et cartes de saison repris d'Anime Game.

Pages qui tournent : [StPageFlip](https://github.com/Nodlik/StPageFlip) (MIT), dans `public/vendor/`.
