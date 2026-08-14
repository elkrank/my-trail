# TrailCompare

Application Express et JavaScript natif pour comparer et explorer des trails a partir de donnees officielles collectees manuellement.

Les donnees de courses viennent du pipeline de scraping situe dans `app/scrapers/`. L'application lit directement :

```text
app/data/2026/races.json
```

Il n'y a pas de seed fictif utilise par l'API et aucune actualisation automatique des donnees.

## Lancement

```bash
docker compose up --build
```

Puis ouvrir :

```text
http://localhost:8080
```

Arret :

```bash
docker compose down
```

Reset complet :

```bash
docker compose down -v
docker compose up --build
```

## Configuration

`PUBLIC_BASE_URL` est optionnelle. Quand elle est definie avec une URL HTTP/HTTPS publique, l'application ajoute une URL canonique, expose un `sitemap.xml` et reference ce sitemap dans `robots.txt`.

Exemple :

```bash
PUBLIC_BASE_URL=https://trailcompare.example
```

Sans `PUBLIC_BASE_URL`, l'application fonctionne localement sans URL canonique et sans sitemap.

## Fonctionnalites

### Comparateur

Le comparateur affiche deux courses avec distance officielle, D+ officiel, temps limite, difficulte physique V1, pression des barrieres V0, verticalite, checkpoints, trace GPX visualisee quand elle existe, lien vers la source officielle, lien d'inscription officiel quand il est connu, et telechargement du GPX officiel quand le fichier local existe.

`difficultyScore` est le score principal expose par compatibilite API et correspond a `difficultyScoreV1`. `difficultyScoreV1` mesure la difficulte physique a partir des kilometres-effort. `difficultyScoreV0` reste temporairement expose pour compatibilite et comparaison historique.

La pression des barrieres reste separee dans `barrierPressureScoreV0`. Elle n'est pas melangee au score physique V1. La verticalite est un indicateur distinct base sur la densite de D+.

Une distance absente ou un D+ absent rend la difficulte physique indisponible : `kmEffort`, `difficultyScoreV1`, `difficultyScore`, la densite de D+ et la verticalite restent `null`. Aucune donnee manquante n'est remplacee automatiquement par zero. Un D+ officiel egal a `0` reste une valeur valide.

### Explorer

Explorer conserve la recherche, le filtre de lieu, les dates, distance, D+, GPX disponible, tri, compteur de resultats et reinitialisation.

Filtres supplementaires :

- mois de la course ;
- prix maximum ;
- statut d'inscription ;
- duree maximale de course.

Les options sont calculees depuis les donnees disponibles. Une donnee absente reste inconnue et n'est exclue que lorsqu'un filtre portant sur cette donnee est actif.

### Favoris

Les favoris fonctionnent sans compte utilisateur. Ils sont stockes dans `localStorage` sous la cle versionnee :

```text
trailcompare:favorites:v1
```

Le stockage utilise le `sourceId` stable de la course. Les favoris sont restaures au chargement, peuvent etre ajoutes ou retires depuis Explorer et le comparateur, et les favoris obsoletes sont ignores proprement si une course n'existe plus dans le dataset.

### GPX officiel

Quand une course a un GPX officiel local (`race.gpx.localFile`), l'interface propose le telechargement du fichier original. L'application ne telecharge jamais de ressource distante pendant une requete utilisateur.

Le GPX peut etre utilisable pour la carte meme si son profil altimetrique est marque incoherent. Dans ce cas, la trace et le telechargement restent disponibles, mais le profil n'est pas affiche comme fiable. La qualite altimetrique est exposee via `gpx.elevationQuality.status` : `consistent`, `inconsistent`, `unverified` ou `unavailable`.

## API

- `GET /api/health`
- `GET /api/races`
- `GET /api/races/:id`
- `GET /api/races/:id/gpx`
- `GET /api/races/:id/gpx/download`
- `GET /api/compare?raceA=1&raceB=2`
- `GET /robots.txt`
- `GET /sitemap.xml` uniquement quand `PUBLIC_BASE_URL` est configuree

Les scores sont calcules cote backend, pas dans le navigateur. Les champs `difficultyScoreV0`, `difficultyScoreV1` et `difficultyScore` restent exposes. Quand une donnee officielle manque, les champs correspondants restent `null` et les scores concernes sont `null`.

`GET /api/races/:id/gpx/download` sert le fichier GPX original local avec `Content-Disposition: attachment`. Le chemin est resolu uniquement dans le repertoire de donnees autorise ; un GPX absent, manquant ou hors repertoire retourne une erreur 404 propre.

## Tests et rapports

Depuis `C:\my_trail\app` :

```bash
npm ci
npm test
npm run report:difficulty
npm run report:assets
```

`npm run report:difficulty` affiche la couverture V0/V1 du dataset courant. `npm run report:assets` audite les GPX et routes generees non references. `npm run clean:assets` supprime uniquement les orphelins confirmes par cet audit.

## Collecte des donnees

La collecte reste exclusivement manuelle. Aucune tache planifiee, aucun workflow GitHub Actions, aucun scheduler, aucun commit automatique et aucun scraping au demarrage de l'application ne sont configures.

Depuis `C:\my_trail\app` :

```bash
npm run scrape
```

Ou avec Docker Compose depuis `C:\my_trail` :

```bash
docker compose run scraper scrape
```

Les fichiers generes sont dans :

```text
app/data/2026/
app/data/gpx/2026/
app/data/generated/routes/
```

La collecte conserve le GPX officiel original sans modification, calcule son SHA-256, valide les points, puis genere un asset JSON compact pour la carte et le profil altimetrique. Elle suit les GPX directs et les plateformes cartographiques liees explicitement par l'organisateur, sans accepter de traces utilisateur tierces.

Pour relancer uniquement la collecte GPX sur les donnees deja scrapees :

```bash
npm run scrape:gpx
```

Voir aussi `SCRAPING_REPORT.md`.
