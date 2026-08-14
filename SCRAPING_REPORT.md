# Scraping report - edition 2026

Derniere generation locale : `node scrapers/cli.mjs --event ...` le 2026-08-14.

Statut global : `PARTIAL`

Courses exportees : 66

Evenements exportes : 10

GPX disponibles au total : 30

Nouveaux GPX recuperes depuis la reprise : 5 (`trail-alsace`)

Courses completes : 12

Courses partielles : 53

Courses invalides : 1 (`maxi-race-tour-du-lac-2-jours`, distance/D+ agregees non confirmees pour 2026).

Principaux champs encore manquants : GPX pour plusieurs courses hors UTMB/NTMF/Templiers/Trail Alsace, prix quand non exposes dans le HTML officiel, D+ Saintelyon, ravitaillements Saintelyon/Grand Raid/Ultra Marin/Trail Alsace, checkpoints pour Templiers/MaXi-Race/Trail Alsace quand seules des sources non millesimees 2026 ou non parseables sont disponibles.

## UTMB Mont-Blanc

- Statut : `SUCCESS`
- Courses detectees : UTMB, CCC, OCC, TDS, MCC, ETC, PTL.
- Sources officielles : pages courses `montblanc.utmb.world/races/*`, conditions d'inscription, reglement, GPX Cloudinary exposes par UTMB.
- Champs recuperes : date, depart, distance, D+, D-, duree maximale, GPX, checkpoints/barrieres, ravitaillements, assistance locale, drop bags, prix quand exposes.
- Champs manquants : aucun champ MVP prioritaire.
- GPX : 7 GPX disponibles et valides.
- Confiance : haute.

## Grand Raid de La Reunion

- Statut : `PARTIAL`
- Courses detectees : Diagonale, Bourbon, Mascareignes, Metis, Zembrocal.
- Sources officielles : pages detail course 2026 `grandraid-reunion.com/fr/les-courses/*`, formalites d'inscription, reglement, carnet de route 2026, PDF officiels 2026 de descriptif/barrieres/postes quand lies par les pages course, iframes Trace de Trail officiels.
- Champs recuperes apres reprise : date, heure de depart, distance, D+, lieu de depart, duree maximale, prix, participants max, type relais Zembrocal, jambes relais Zembrocal, checkpoint arrivee calcule depuis la duree maximale officielle, sources PDF/Trace.
- Champs manquants : GPX telechargeable et ravitaillements nommes/distances ; les PDF postes sont conserves comme sources mais ne sont pas parses faute d'extraction texte fiable sans nouvelle dependance.
- Problemes : les pages indiquent que les parcours 2026 peuvent encore etre modifies ; Trace de Trail refuse le telechargement GPX sans compte ou retourne une erreur serveur selon la trace.
- GPX : 0 fichier cree, statut `unavailable` pour les 5 traces officielles.
- Confiance : haute sur caracteristiques principales 2026, moyenne sur sources PDF non parsees, faible sur GPX.
- Date de recuperation : 2026-08-14.

## Saintelyon

- Statut : `PARTIAL`
- Courses detectees : Saintelyon, Relais 2, Relais 3, Relais 4, SaintExpress, SainteVia, SainteSprint, SainteTic, Lyon Saintelyon.
- Sources officielles : pages courses `saintelyon.com/races/*`.
- Champs recuperes apres reprise : date, heure, lieu de depart, distance, type relais pour les relais, barrieres horaires officielles, checkpoints dates, duree maximale derivee des horaires de fermeture officiels et de l'heure de depart officielle.
- Champs manquants : D+ encore marque `A venir` sur les pages, prix, GPX, ravitaillements.
- Problemes : les ravitos ne sont pas exposes dans le HTML courant ; les tarifs visibles dans la page restent `tarif en cours`.
- GPX : aucun GPX officiel trouve.
- Confiance : haute sur dates/departs/distances/barrieres, faible sur champs encore `A venir`.
- Date de recuperation : 2026-08-14.

## Festival des Templiers

- Statut : `PARTIAL`
- Courses detectees : Endurance Trail, Integrale des Causses, Marathon du Larzac, Boffi Fifty, Dourbie Formi, Monna Lisa, Marathon des Causses, Troubadours, VO2 Trail, Templiere, Grand Trail.
- Sources officielles : pages courses `festivaldestempliers.com/<course>/`, page infos pratiques, liens Trace de Trail 2026 integres, plateforme d'inscription officielle liee.
- Champs recuperes : date, heure, distance, D+, GPX, ravitaillements nommes quand presents, description terrain partielle.
- Champs manquants : duree maximale, prix, checkpoints/barrieres ; quelques distances de ravitaillement.
- Problemes : les liens de temps de passage vus dans les pages pointent encore vers des PDF nommes `25...`; ils ne sont pas utilises comme source 2026. La plateforme d'inscription officielle ne rend pas les tarifs dans le HTML recupere.
- GPX : 11 GPX Trace de Trail disponibles et valides.
- Confiance : moyenne sur caracteristiques principales et GPX, faible sur barrieres/prix.

## EcoTrail Paris

- Statut : `PARTIAL`
- Courses detectees : 80 km Automne, 50 km Automne, 20 km Automne.
- Sources officielles : pages courses automne 2026 `ecotrailparis.com/course/*`.
- Champs recuperes : date, heure, distance, D+, duree maximale, participants max, lieux depart/arrivee, materiel obligatoire partiel, statut d'inscription.
- Champs manquants : GPX valide, prix, checkpoints/barrieres, ravitaillements.
- Problemes : le bouton GPX pointe vers `#` dans le HTML collecte ; les roadbooks/FAQ ne donnent pas de table exploitable dans le HTML courant.
- GPX : aucun GPX officiel trouve.
- Confiance : moyenne sur caracteristiques principales, faible sur GPX/barrieres/ravitaillements.

## Nord Trail Monts de Flandres / NTMF

- Statut : `PARTIAL`
- Courses detectees : 13 km, 25 km, 30 km, 42 km, 59 km, 80 km, 115 km.
- Sources officielles : pages `les-courses`, liens Pacevisor integres, reglement FR, reglement EN.
- Champs recuperes : date, heure, distance, D+, GPX, prix, duree maximale, barrieres, ravitaillements pour 25/42/59/80/115 km, materiel obligatoire, assistance/drop bag 115 km.
- Champs manquants : ravitaillements sur parcours pour 13 km et 30 km car les sources indiquent aucun ravitaillement ou autonomie complete.
- GPX : 7 GPX Pacevisor disponibles et valides.
- Confiance : haute.

## Ultra Marin

- Statut : `PARTIAL`
- Courses detectees : Grand Raid, Grand Relais, Raid, Reveil des Ducs, L'Arvor, Ronde des Douaniers, Course des Marins.
- Sources officielles : pages courses `ultra-marin.fr/*`, page inscription `ultra-marin.fr/commentsinscrire`.
- Champs recuperes : identite evenement, distance, D+, date/heure pour 5 courses, depart, arrivee Vannes quand exposee, duree maximale, type relais Grand Relais, statut inscription partiel, illustrations.
- Champs manquants : date Grand Raid/Grand Relais non publiee clairement dans le texte officiel courant, prix, GPX, ravitaillements, D+ Course des Marins.
- Problemes : pages Wix contenant encore des intitules 2025 et blocs 2027 ; ces textes ne sont pas utilises pour completer 2026. La page inscription indique surtout la bourse aux dossards, sans tarifs par course.
- GPX : aucun GPX officiel direct ou telechargeable trouve.
- Confiance : moyenne sur distances/D+/depart/durees, faible sur dates absentes/prix/GPX/ravitos.

## Marathon du Mont-Blanc

- Statut : `PARTIAL`
- Courses detectees : 90 km, 42 km, 23 km, Duo Etoile, 10 km, KM Vertical.
- Sources officielles : pages courses `marathonmontblanc.fr/courses/*`, page inscriptions 2026, reglement officiel 2026.
- Champs recuperes : date, heure, distance, D+, D- quand expose, lieux principaux, duree maximale sauf KM Vertical, prix, participants max, tirage au sort, barrieres pour 90/42/23/Duo, ravitaillements, materiel obligatoire, reserve d'eau minimale.
- Champs manquants : GPX telechargeables ; duree maximale et checkpoints du KM Vertical.
- Problemes : les pages avertissent que les traces GPX peuvent differer des donnees officielles mais ne donnent pas de lien GPX direct exploitable.
- GPX : aucun GPX officiel trouve.
- Confiance : haute sur donnees principales, faible sur GPX.

## MaXi-Race du lac d'Annecy

- Statut : `PARTIAL`
- Courses detectees : tOur solo, tOur 2 jours, tOur relais, Demi-tOur, Marathon-eXperience, Quart-de-tOur.
- Sources officielles : pages courses `maxi-race.org/*`, evenement Trace de Trail officiel `adidas-terrex-maxi-race-2026`, traces Trace de Trail creees par MaXi-Race, page officielle `plan-canicule-2026`.
- Champs recuperes : dates confirmees pour 5 courses, heures quand exposees, distances/D+/D- exacts Trace de Trail 2026 pour 5 courses, type relais, type course en etapes, ravitaillements et reserve d'eau minimale pour plusieurs courses.
- Champs manquants : distance/D+/D- agregees du tOur 2 jours, date definitive du Quart-de-tOur en conflit, prix, durees maximales, checkpoints/barrieres, certains ravitaillements.
- Problemes : les pages course affichent parfois des fourchettes ; aucune valeur n'est inventee. Trace de Trail refuse le telechargement GPX sans compte.
- GPX : 0 fichier cree, traces officielles identifiees mais statut `unavailable`.
- Confiance : haute sur traces 2026 simples, moyenne sur dates/heures, faible sur GPX/barrieres/prix.

## Trail Alsace by UTMB

- Statut : `PARTIAL`
- Courses detectees : UTDC, UTDP, TDC, TDP, RDP.
- Sources officielles : pages UTMB Index 2026 pour les valeurs course ; pages `alsace.utmb.world/races/*` courantes uniquement pour les URL GPX explicitement millesimees `GPX 2026/2026_*.gpx`.
- Champs recuperes apres reprise : dates, distances, D+, categories UTMB, villes principales, 5 GPX officiels 2026, metriques calculees GPX, assets carte/profil.
- Champs manquants : heures de depart, D-, arrivees, durees maximales, prix, barrieres, ravitaillements, materiel.
- Problemes : les pages evenement courantes sont des pages 2027 ; leurs horaires/durees/checkpoints ne sont pas utilises pour 2026. Seuls les assets GPX dont l'URL est explicitement 2026 sont conserves.
- GPX : 5 GPX Cloudinary officiels disponibles et valides.
- Ecarts officiel/GPX : D+ GPX superieur aux D+ officiels sur UTDC/UTDP, conserve separement dans `edition.gpx.computed`.
- Confiance : haute sur index 2026 et GPX 2026, faible sur champs horaires/barrieres absents.
- Date de recuperation : 2026-08-14.
