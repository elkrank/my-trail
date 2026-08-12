# TrailCompare V0

V0 volontairement simple pour comparer des trails par difficulte estimee et pression des barrieres horaires.

Les donnees de courses viennent du pipeline de scraping officiel situe dans `app/scrapers/`. L'application lit directement :

```text
app/data/2026/races.json
```

Il n'y a plus de seed fictif utilise par l'API.

## Lancement

```bash
docker compose up --build
```

Puis ouvrir :

```text
http://localhost:8080
```

## Arret

```bash
docker compose down
```

## Reset complet

```bash
docker compose down -v
docker compose up --build
```

## Tests

Depuis `C:\my_trail\app` :

```bash
npm test
```

## API

- `GET /api/health`
- `GET /api/races`
- `GET /api/races/:id`
- `GET /api/races/:id/gpx`
- `GET /api/compare?raceA=1&raceB=2`

Les scores sont des estimations V0. Ils sont calcules cote backend, pas dans le navigateur. Quand une donnee officielle manque, les champs correspondants restent `null` et les scores concernes sont `null`.

## Collecte des donnees

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
  utmb.json
  grand-raid-reunion.json
  saintelyon.json
  templiers.json
  ecotrail.json
  ntmf.json
  races.json

app/data/gpx/2026/
  <event>/<race>.gpx

app/data/generated/routes/
  <event>-<race>-<year>.json
```

La collecte conserve le GPX officiel original sans modification, calcule son SHA-256, valide les points, puis genere un asset JSON compact pour la carte et le profil altimetrique. Elle suit les GPX directs et les plateformes cartographiques liees explicitement par l'organisateur, actuellement Pacevisor et Trace de Trail, sans accepter de traces utilisateur tierces. Les valeurs calculees depuis le GPX restent dans `edition.gpx.computed` et ne remplacent pas les valeurs officielles `edition.distanceKm` / `edition.elevationGainM`.

Pour relancer uniquement la collecte GPX sur les donnees deja scrapees :

```bash
npm run scrape:gpx
```

Voir aussi `SCRAPING_REPORT.md`.
