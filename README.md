# TrailCompare

Application Express et JavaScript natif pour comparer, explorer et consulter des trails à partir de données officielles. La collecte est effectuée par des scrapers déclenchés manuellement ; aucune actualisation n’a lieu au démarrage de l’application.

Le pipeline de collecte se trouve dans `app/scrapers/`. L’application lit par défaut :

```text
app/data/2026/races.json
```

L’API n’utilise ni base de données ni jeu de données fictif.

## Prérequis

- Docker avec Docker Compose pour le lancement recommandé ;
- ou Node.js 22 et npm pour un lancement local.

## Lancement avec Docker

Depuis la racine du projet :

```bash
docker compose up --build
```

Ouvrir ensuite <http://localhost:8080>.

Pour arrêter l’application :

```bash
docker compose down
```

Pour recréer également les volumes Docker :

```bash
docker compose down -v
docker compose up --build
```

## Lancement local

Depuis `app/` :

```bash
npm ci
npm start
```

L’application est alors disponible sur <http://localhost:3000>.

## Configuration

| Variable | Valeur par défaut | Rôle |
| --- | --- | --- |
| `PORT` | `3000` | Port HTTP utilisé par le serveur Node.js. |
| `PUBLIC_BASE_URL` | aucune | URL publique HTTP/HTTPS utilisée pour les URL canoniques et le sitemap. |
| `TRAILCOMPARE_DATA_ROOT` | `app/data` | Répertoire racine des données et des assets GPX. |
| `TRAILCOMPARE_DATASET_PATH` | `app/data/2026/races.json` | Chemin du dataset chargé par l’application. |

Pour Docker Compose, copier `.env.example` vers `.env` et renseigner `PUBLIC_BASE_URL` uniquement lors d’un déploiement public :

```dotenv
PUBLIC_BASE_URL=https://trailcompare.example
```

Sans `PUBLIC_BASE_URL`, l’application fonctionne normalement, mais n’ajoute pas d’URL canonique, ne référence pas de sitemap dans `robots.txt` et retourne `404` sur `/sitemap.xml`.

Pour un lancement local, définir les variables dans l’environnement du processus. L’application ne charge pas automatiquement les fichiers `.env` :

```powershell
$env:PUBLIC_BASE_URL = 'https://trailcompare.example'
npm start
```

## Fonctionnalités

### Comparateur

Le comparateur affiche deux courses avec leur distance officielle, leur D+ officiel, leur temps limite, leur difficulté physique V1, la pression des barrières V0, la verticalité, les checkpoints, la trace GPX lorsqu’elle existe, les liens officiels et le téléchargement du GPX officiel local.

`difficultyScore` est le score principal exposé pour compatibilité API et correspond à `difficultyScoreV1`. `difficultyScoreV1` mesure la difficulté physique à partir des kilomètres-effort. `difficultyScoreV0` reste temporairement exposé pour compatibilité et comparaison historique.

La pression des barrières reste séparée dans `barrierPressureScoreV0`. Elle n’est pas mélangée au score physique V1. La verticalité est un indicateur distinct fondé sur la densité de D+.

Une distance ou un D+ absent rend la difficulté physique indisponible : `kmEffort`, `difficultyScoreV1`, `difficultyScore`, la densité de D+ et la verticalité restent à `null`. Aucune donnée manquante n’est remplacée par zéro. Un D+ officiel égal à `0` reste une valeur valide.

### Explorer

Explorer propose la recherche, le filtre de lieu, les dates, la distance, le D+, la disponibilité du GPX, le tri, le compteur de résultats et la réinitialisation.

Filtres supplémentaires :

- mois de la course ;
- prix maximum ;
- statut d’inscription ;
- durée maximale de course.

Les filtres sont conservés dans `sessionStorage` pendant la session. Leurs options sont calculées depuis les données disponibles. Une donnée absente reste inconnue et n’est exclue que lorsqu’un filtre portant sur cette donnée est actif.

### Fiches course

Chaque course dispose d’une URL stable sous `/courses/:slug`. Selon les informations officielles disponibles, la fiche présente le parcours, les caractéristiques, les barrières horaires, les ravitaillements, le programme, la logistique, le règlement, le matériel obligatoire et les sources utilisées.

Les champs absents sont masqués ou signalés comme indisponibles. Avec `PUBLIC_BASE_URL`, chaque fiche reçoit ses métadonnées SEO et son URL canonique, et elle est ajoutée au sitemap.

### Favoris

Les favoris fonctionnent sans compte utilisateur. Ils sont stockés dans `localStorage` sous la clé versionnée :

```text
trailcompare:favorites:v1
```

Le stockage utilise le `sourceId` stable de la course. Les favoris sont restaurés au chargement, peuvent être ajoutés ou retirés depuis Explorer et le comparateur, et les favoris obsolètes sont ignorés proprement si une course n’existe plus dans le dataset.

### Profil coureur

Le profil coureur est disponible sur `/profil`. En l’absence de compte utilisateur, il reste sur l’appareil dans `localStorage` sous la clé versionnée :

```text
trailcompare:runner-profile:v1
```

Les fiches et cartes course proposent « Comparer avec mon profil ». Le diagnostic évalue cinq axes : endurance, dénivelé, barrières horaires, expérience longue, et technicité/autonomie. Il affiche également les données manquantes et le niveau de confiance. Les hypothèses V0 sont documentées dans [`app/docs/profile-comparison-v0.md`](app/docs/profile-comparison-v0.md).

### GPX officiel

Quand une course possède un GPX officiel local (`race.gpx.localFile`), l’interface propose le téléchargement du fichier original. L’application ne télécharge jamais de ressource distante pendant une requête utilisateur.

Le GPX peut rester utilisable pour la carte même si son profil altimétrique est marqué incohérent. Dans ce cas, la trace et le téléchargement restent disponibles, mais le profil n’est pas affiché comme fiable. La qualité altimétrique est exposée via `gpx.elevationQuality.status` : `consistent`, `inconsistent`, `unverified` ou `unavailable`.

## API

- `GET /api/health`
- `GET /api/races`
- `GET /api/races/:id`
- `GET /api/races/slug/:slug`
- `GET /api/races/:id/gpx`
- `GET /api/races/:id/gpx/download`
- `GET /api/compare?raceA=1&raceB=2`
- `GET /robots.txt`
- `GET /sitemap.xml` uniquement quand `PUBLIC_BASE_URL` est configurée

Les scores sont calculés côté serveur, pas dans le navigateur. Les champs `difficultyScoreV0`, `difficultyScoreV1` et `difficultyScore` restent exposés. Quand une donnée officielle manque, les champs et les scores concernés restent à `null`.

`GET /api/races/:id/gpx/download` sert le fichier GPX original local avec `Content-Disposition: attachment`. Le chemin est résolu uniquement dans le répertoire de données autorisé ; un GPX absent, manquant ou hors de ce répertoire produit une réponse `404` propre.

## Tests et rapports

Depuis `app/` :

```bash
npm ci
npm test
npm run report:difficulty
npm run report:course-pages
npm run report:assets
```

- `report:difficulty` affiche la couverture des scores V0 et V1 du dataset courant.
- `report:course-pages` vérifie les slugs et la disponibilité des fiches course.
- `report:assets` audite les GPX et les routes générées non référencés.
- `report:quality` régénère `SCRAPING_REPORT.md` depuis le dataset courant.
- `clean:assets` supprime uniquement les assets orphelins confirmés par l’audit.

## Collecte des données

La collecte est exclusivement manuelle. Aucun workflow GitHub Actions, scheduler, commit automatique ou scraping au démarrage de l’application n’est configuré.

Depuis `app/` :

```bash
npm run scrape
```

Ou avec Docker Compose depuis la racine du projet :

```bash
docker compose run --rm scraper scrape
```

Les fichiers générés se trouvent dans :

```text
app/data/2026/
app/data/gpx/2026/
app/data/generated/routes/
```

La collecte conserve le GPX officiel original sans modification, calcule son SHA-256, valide ses points, puis génère un asset JSON compact pour la carte et le profil altimétrique. Elle suit les GPX directs et les plateformes cartographiques liées explicitement par l’organisateur, sans accepter de traces utilisateur tierces.

Pour relancer uniquement la collecte GPX sur les données déjà collectées :

```bash
npm run scrape:gpx
```

Après une collecte avec Docker, reconstruire le service `app` pour intégrer le nouveau dataset dans son image :

```bash
docker compose up --build app
```

Le détail de la couverture et des données manquantes se trouve dans [`SCRAPING_REPORT.md`](SCRAPING_REPORT.md).
