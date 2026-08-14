# Scraping report - edition 2026

Snapshot recalcule depuis `app/data/2026/races.json` le 2026-08-14 apres corrections V1. Aucun scraper n'a ete relance pour cette mise a jour.

Statut global dataset : `PARTIAL`

Courses exportees : 66

Evenements exportes : 10

## Couverture difficulte

- Scores V0 disponibles : 46
- Scores V1 disponibles : 55
- Courses sans score V1 : 11
- Distance absente : 1
- D+ absent : 11
- Duree maximale absente : 9

## Statuts course

- Complete : 17
- Partial : 48
- Invalid : 1

## Statuts GPX

- Available : 56
- Invalid : 10
- Unavailable : 0

## Qualite altimetrique GPX

- Consistent : 44
- Inconsistent : 11
- Unverified : 1
- Unavailable : 10

Les GPX incoherents conservent la geometrie et le fichier original quand ils sont references, mais leur profil altimetrique n'est pas presente comme fiable. Les valeurs officielles de distance et D+ restent celles utilisees par l'algorithme V1.

## Synthese par evenement

| Evenement | Courses | Complete | Partial | Invalid | GPX available | GPX invalid | GPX unavailable | Elev consistent | Elev inconsistent | Elev unverified | Elev unavailable |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| UTMB Mont-Blanc | 7 | 7 | 0 | 0 | 7 | 0 | 0 | 7 | 0 | 0 | 0 |
| Grand Raid de La Reunion | 5 | 0 | 5 | 0 | 5 | 0 | 0 | 1 | 4 | 0 | 0 |
| Saintelyon | 9 | 0 | 9 | 0 | 0 | 9 | 0 | 0 | 0 | 0 | 9 |
| Festival des Templiers | 11 | 0 | 11 | 0 | 11 | 0 | 0 | 9 | 2 | 0 | 0 |
| EcoTrail Paris | 3 | 0 | 3 | 0 | 3 | 0 | 0 | 3 | 0 | 0 | 0 |
| Nord Trail Monts de Flandres | 7 | 5 | 2 | 0 | 7 | 0 | 0 | 7 | 0 | 0 | 0 |
| Ultra Marin | 7 | 0 | 7 | 0 | 7 | 0 | 0 | 4 | 2 | 1 | 0 |
| Marathon du Mont-Blanc | 6 | 5 | 1 | 0 | 6 | 0 | 0 | 5 | 1 | 0 | 0 |
| MaXi-Race du lac d'Annecy | 6 | 0 | 5 | 1 | 5 | 1 | 0 | 3 | 2 | 0 | 1 |
| Trail Alsace by UTMB | 5 | 0 | 5 | 0 | 5 | 0 | 0 | 5 | 0 | 0 | 0 |

## Courses sans score V1

- MaXi-Race du lac d'Annecy - tOur 2 jours
- Saintelyon - Lyon Saintelyon
- Saintelyon - Relais 2
- Saintelyon - Relais 3
- Saintelyon - Relais 4
- Saintelyon - Saintelyon
- Saintelyon - SainteSprint
- Saintelyon - SainteTic
- Saintelyon - SainteVia
- Saintelyon - SaintExpress
- Ultra Marin - Course des Marins
