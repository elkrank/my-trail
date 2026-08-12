# Scraping report - edition 2026

Derniere generation locale : `npm run scrape:gpx` apres collecte complete initiale

Statut global : `PARTIAL`

Courses exportees : 42

## UTMB Mont-Blanc

- Statut : `SUCCESS`
- Sources officielles : pages courses `montblanc.utmb.world/races/*`, page conditions d'inscription, page reglement, GPX Cloudinary exposes par les pages UTMB.
- Courses detectees : UTMB, CCC, OCC, TDS, MCC, ETC, PTL.
- Champs recuperes : date, depart, distance, D+, D-, duree maximale, GPX, checkpoints/barrieres, ravitaillements, assistance locale, drop bags, prix quand exposes.
- Champs manquants : aucun champ MVP prioritaire manquant dans le dernier export.
- Problemes : les cutoffs embarques contiennent aussi un champ `cutoffDatetime` ancien ; le collecteur ignore ce champ et recalcule depuis le libelle officiel visible.
- GPX :
  - UTMB : trouve oui ; source `official-race-page` ; fichier `gpx/2026/utmb/utmb.gpx` ; valide oui ; points 14084 ; altitude oui ; distance officielle 174 km ; distance GPX 173.83 km ; D+ officiel 9900 m ; D+ GPX 9994 m ; warnings aucun.
  - CCC : trouve oui ; source `official-race-page` ; fichier `gpx/2026/utmb/ccc.gpx` ; valide oui ; points 9064 ; altitude oui ; distance officielle 101 km ; distance GPX 99.36 km ; D+ officiel 6050 m ; D+ GPX 6015 m ; warnings aucun.
  - OCC : trouve oui ; source `official-race-page` ; fichier `gpx/2026/utmb/occ.gpx` ; valide oui ; points 5365 ; altitude oui ; distance officielle 60 km ; distance GPX 60.07 km ; D+ officiel 3500 m ; D+ GPX 3336 m ; warnings aucun.
  - TDS : trouve oui ; source `official-race-page` ; fichier `gpx/2026/utmb/tds.gpx` ; valide oui ; points 8211 ; altitude oui ; distance officielle 145 km ; distance GPX 148.19 km ; D+ officiel 9500 m ; D+ GPX 9324 m ; warnings aucun.
  - MCC : trouve oui ; source `official-race-page` ; fichier `gpx/2026/utmb/mcc.gpx` ; valide oui ; points 3451 ; altitude oui ; distance officielle 40 km ; distance GPX 37.99 km ; D+ officiel 2350 m ; D+ GPX 2362 m ; warnings aucun.
  - ETC : trouve oui ; source `official-race-page` ; fichier `gpx/2026/utmb/etc.gpx` ; valide oui ; points 952 ; altitude oui ; distance officielle 15 km ; distance GPX 14.71 km ; D+ officiel 1200 m ; D+ GPX 1164 m ; warnings aucun.
  - PTL : trouve oui ; source `official-race-page` ; fichier `gpx/2026/utmb/ptl.gpx` ; valide oui ; points 13391 ; altitude oui ; distance officielle 300 km ; distance GPX 293.29 km ; D+ officiel 25000 m ; D+ GPX 27331 m ; warnings aucun.
- Confiance : haute.

## Grand Raid de La Reunion

- Statut : `PARTIAL`
- Sources officielles : `grandraid-reunion.com/fr/les-courses/`, formalites d'inscription, reglement, page carnet de route.
- Courses detectees : Diagonale, Bourbon, Mascareignes, Metis, Zembrocal.
- Champs recuperes : distance, D+, prix pour 4 courses, participants max partiels, exigences de qualification partielles, sources.
- Champs manquants : date specifique par course, duree maximale, GPX, checkpoints/barrieres, ravitaillements ; prix Zembrocal non extrait de facon certaine.
- Problemes : la page officielle donne une plage evenement 2026 mais pas de dates de depart par course ; le carnet de route courant n'a pas ete reutilise s'il ne correspond pas clairement a 2026.
- GPX : trouve non pour les 5 courses ; warning `GPX officiel non trouvé`.
- Confiance : moyenne sur distances/D+/prix, faible sur barrieres/ravitaillements.

## Saintelyon

- Statut : `PARTIAL`
- Sources officielles : pages courses `saintelyon.com/races/*`.
- Courses detectees : Saintelyon, Relais 2, Relais 3, Relais 4, SaintExpress, SainteVia, SainteSprint, SainteTic, Lyon Saintelyon.
- Champs recuperes : date, heure de depart, distance, lieu de depart quand expose, statut d'inscription partiel, sources.
- Champs manquants : D+, duree maximale, GPX, prix, checkpoints/barrieres, ravitaillements.
- Problemes : les pages officielles indiquent plusieurs donnees comme `A venir`, notamment D+, ravitos et barrieres.
- GPX : trouve non pour les 9 courses ; warning `GPX officiel non trouvé`.
- Confiance : moyenne sur date/distance/depart, faible sur le reste.

## Festival des Templiers

- Statut : `PARTIAL`
- Sources officielles : pages courses `festivaldestempliers.com/<course>/`, page infos pratiques, liens Trace de Trail 2026 integres par l'organisateur.
- Courses detectees : Endurance Trail, Integrale des Causses, Marathon du Larzac, Boffi Fifty, Dourbie Formi, Monna Lisa, Marathon des Causses, Troubadours, VO2 Trail, Templiere, Grand Trail.
- Champs recuperes : date, heure de depart, distance, D+, GPX, ravitaillements nommes quand presents, description terrain partielle, sources.
- Champs manquants : duree maximale, prix, checkpoints/barrieres ; distances des ravitaillements souvent absentes dans les pages.
- Problemes : les pages renvoient vers des details de barrieres/horaires mais ne fournissent pas de table directement exploitable dans le HTML collecte.
- GPX :
  - Endurance Trail : trouve oui ; source `official-map-platform / trace-de-trail` ; fichier `gpx/2026/templiers/endurance-trail.gpx` ; valide oui ; points 4634 ; altitude oui ; distance officielle 99.5 km ; distance GPX 100.94 km ; D+ officiel 4304 m ; D+ GPX 5751 m ; warnings `GPX_CHANGED`, `GPX_ELEVATION_GAIN_MISMATCH`.
  - Integrale des Causses : trouve oui ; source `official-map-platform / trace-de-trail` ; fichier `gpx/2026/templiers/integrale-des-causses.gpx` ; valide oui ; points 2839 ; altitude oui ; distance officielle 62 km ; distance GPX 60.27 km ; D+ officiel 2695 m ; D+ GPX 3357 m ; warnings `GPX_CHANGED`.
  - Marathon du Larzac : trouve oui ; source `official-map-platform / trace-de-trail` ; fichier `gpx/2026/templiers/marathon-du-larzac.gpx` ; valide oui ; points 1170 ; altitude oui ; distance officielle 33.3 km ; distance GPX 32.91 km ; D+ officiel 1400 m ; D+ GPX 1475 m ; warnings aucun.
  - Boffi Fifty : trouve oui ; source `official-map-platform / trace-de-trail` ; fichier `gpx/2026/templiers/boffi-fifty.gpx` ; valide oui ; points 2315 ; altitude oui ; distance officielle 47.3 km ; distance GPX 47.64 km ; D+ officiel 2208 m ; D+ GPX 2587 m ; warnings `GPX_CHANGED`.
  - Dourbie Formi : trouve oui ; source `official-map-platform / trace-de-trail` ; fichier `gpx/2026/templiers/dourbie-formi.gpx` ; valide oui ; points 1488 ; altitude oui ; distance officielle 23.1 km ; distance GPX 22.76 km ; D+ officiel 1229 m ; D+ GPX 1565 m ; warnings `GPX_CHANGED`, `GPX_ELEVATION_GAIN_MISMATCH`.
  - Monna Lisa : trouve oui ; source `official-map-platform / trace-de-trail` ; fichier `gpx/2026/templiers/monna-lisa.gpx` ; valide oui ; points 1120 ; altitude oui ; distance officielle 30 km ; distance GPX 31.82 km ; D+ officiel 1175 m ; D+ GPX 1222 m ; warnings `GPX_CHANGED`.
  - Marathon des Causses : trouve oui ; source `official-map-platform / trace-de-trail` ; fichier `gpx/2026/templiers/marathon-des-causses.gpx` ; valide oui ; points 1170 ; altitude oui ; distance officielle 34.1 km ; distance GPX 32.91 km ; D+ officiel 1581 m ; D+ GPX 1475 m ; warnings `GPX_CHANGED`.
  - Troubadours : trouve oui ; source `official-map-platform / trace-de-trail` ; fichier `gpx/2026/templiers/troubadours.gpx` ; valide oui ; points 471 ; altitude oui ; distance officielle 11.8 km ; distance GPX 12.09 km ; D+ officiel 530 m ; D+ GPX 568 m ; warnings `GPX_CHANGED`.
  - VO2 Trail : trouve oui ; source `official-map-platform / trace-de-trail` ; fichier `gpx/2026/templiers/vo2-trail.gpx` ; valide oui ; points 761 ; altitude oui ; distance officielle 17.1 km ; distance GPX 17.68 km ; D+ officiel 695 m ; D+ GPX 778 m ; warnings `GPX_CHANGED`.
  - Templiere : trouve oui ; source `official-map-platform / trace-de-trail` ; fichier `gpx/2026/templiers/templiere.gpx` ; valide oui ; points 308 ; altitude oui ; distance officielle 7.7 km ; distance GPX 7.98 km ; D+ officiel 288 m ; D+ GPX 308 m ; warnings `GPX_CHANGED`.
  - Grand Trail : trouve oui ; source `official-map-platform / trace-de-trail` ; fichier `gpx/2026/templiers/grand-trail.gpx` ; valide oui ; points 3468 ; altitude oui ; distance officielle 80.7 km ; distance GPX 79.08 km ; D+ officiel 3443 m ; D+ GPX 4040 m ; warnings `GPX_CHANGED`.
- Confiance : moyenne sur date/distance/D+/ravitaillements nommes, faible sur barrieres.

## EcoTrail Paris

- Statut : `PARTIAL`
- Sources officielles : pages courses automne 2026 `ecotrailparis.com/course/trail-80-km-automne`, `trail-50-km-automne`, `trail-20-km-automne`.
- Courses detectees : 80 km Automne, 50 km Automne, 20 km Automne.
- Champs recuperes : date, heure de depart, distance, D+, duree maximale, participants max, lieux depart/arrivee, materiel obligatoire partiel, statut d'inscription.
- Champs manquants : GPX valide, prix, checkpoints/barrieres, ravitaillements.
- Problemes : le bouton GPX est present mais pointe vers `#` dans le HTML collecte ; il est donc conserve comme `null`.
- GPX : trouve non pour les 3 courses ; warning `GPX officiel non trouvé`.
- Confiance : moyenne sur caracteristiques principales, faible sur GPX/barrieres/ravitaillements.

## Nord Trail Monts de Flandres / NTMF

- Statut : `PARTIAL`
- Sources officielles : pages `les-courses`, liens Pacevisor integres par l'organisateur, reglement FR, reglement EN sur `nordtrailmontsdeflandres.com`.
- Courses detectees : 13 km, 25 km, 30 km, 42 km, 59 km, 80 km, 115 km.
- Champs recuperes : date, heure de depart, distance, D+, GPX, prix, duree maximale, barrieres horaires, ravitaillements pour 25/42/59/80/115 km, materiel obligatoire, assistance/drop bag 115 km.
- Champs manquants : ravitaillements sur parcours pour 13 km et 30 km car les sources indiquent aucun ravitaillement ou autonomie complete.
- Problemes : conflit officiel FR/EN sur la distance du checkpoint Boescheppe du 115 km ; l'heure est conservee mais la distance du checkpoint est `null`.
- GPX :
  - 13 km : trouve oui ; source `official-map-platform / pacevisor` ; fichier `gpx/2026/ntmf/13-km.gpx` ; valide oui ; points 497 ; altitude oui ; distance officielle 13 km ; distance GPX 12.15 km ; D+ officiel 280 m ; D+ GPX 264 m ; warnings aucun.
  - 25 km : trouve oui ; source `official-map-platform / pacevisor` ; fichier `gpx/2026/ntmf/25-km.gpx` ; valide oui ; points 721 ; altitude oui ; distance officielle 25 km ; distance GPX 23.38 km ; D+ officiel 550 m ; D+ GPX 499 m ; warnings aucun.
  - 30 km : trouve oui ; source `official-map-platform / pacevisor` ; fichier `gpx/2026/ntmf/30-km.gpx` ; valide oui ; points 944 ; altitude oui ; distance officielle 30 km ; distance GPX 31.33 km ; D+ officiel 710 m ; D+ GPX 676 m ; warnings aucun.
  - 42 km : trouve oui ; source `official-map-platform / pacevisor` ; fichier `gpx/2026/ntmf/42-km.gpx` ; valide oui ; points 1352 ; altitude oui ; distance officielle 42 km ; distance GPX 43.51 km ; D+ officiel 990 m ; D+ GPX 944 m ; warnings aucun.
  - 59 km : trouve oui ; source `official-map-platform / pacevisor` ; fichier `gpx/2026/ntmf/59-km.gpx` ; valide oui ; points 1806 ; altitude oui ; distance officielle 59 km ; distance GPX 59.94 km ; D+ officiel 1150 m ; D+ GPX 1094 m ; warnings aucun.
  - 80 km : trouve oui ; source `official-map-platform / pacevisor` ; fichier `gpx/2026/ntmf/80-km.gpx` ; valide oui ; points 2478 ; altitude oui ; distance officielle 80 km ; distance GPX 78.89 km ; D+ officiel 1500 m ; D+ GPX 1426 m ; warnings aucun.
  - 115 km : trouve oui ; source `official-map-platform / pacevisor` ; fichier `gpx/2026/ntmf/115-km.gpx` ; valide oui ; points 4327 ; altitude oui ; distance officielle 115 km ; distance GPX 114.73 km ; D+ officiel 2150 m ; D+ GPX 2073 m ; warnings aucun.
- Confiance : haute sur distances/D+/prix/barrieres/GPX, moyenne sur ravitaillements.
