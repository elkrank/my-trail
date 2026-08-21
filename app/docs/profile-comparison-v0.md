# Comparaison profil coureur — règles V0

Cette fonctionnalité mesure une adéquation actuelle entre des repères déclarés et les exigences connues d’une course. Elle ne prédit pas une arrivée et ne remplace ni un avis médical, ni un accompagnement d’entraînement.

## Les cinq axes

1. **Endurance** : volume des quatre dernières semaines, km-effort de la sortie longue et plus longue distance terminée, comparés à la distance et aux km-effort de la course.
2. **Dénivelé** : D+ hebdomadaire, D+ et densité de la sortie longue, plus gros D+ réalisé, comparés au D+ total et au ratio D+/km.
3. **Barrières horaires** : allure minimale arrêts compris. Un passage n’est estimé que depuis une référence trail complète de moins d’un an et de volume comparable.
4. **Expérience longue** : plus longue distance et durée réalisées, ainsi que le saut de catégorie de distance.
5. **Technicité et autonomie** : expérience technique, nocturne et en autonomie, comparée aux seules caractéristiques officielles disponibles et à l’espacement connu des ravitaillements.

## Seuils V0

Les exigences sont multipliées par `1,0` pour « terminer dans les délais », `1,1` pour « terminer confortablement » et `1,2` pour « rechercher une performance ».

Une couverture d’exigence d’au moins 100 % est validée, 75 à 99 % est à consolider, 50 à 74 % représente un écart important et moins de 50 % un écart critique. L’axe conserve le statut le plus défavorable parmi ses indicateurs disponibles.

- Endurance : volume cible `clamp(0,5 × km-effort, 20, 120)` km/semaine, sortie longue à 35 % des km-effort et expérience terminée à 60 % de la distance.
- Dénivelé : volume cible `clamp(0,4 × D+, 500, 4 000)` m/semaine, sortie longue à 30 % du D+, expérience maximale à 50 % et densité à 75 % de celle du parcours.
- Barrières : marge confortable égale au maximum entre 60 minutes et 10 % du temps disponible. Une marge positive plus petite est à consolider, un retard inférieur à 10 % est un écart important, au-delà il est critique.
- Expérience : même catégorie validée, saut d’une catégorie à consolider, deux catégories en écart important, trois ou plus critique. Catégories : ≤21, ≤42, ≤80, ≤120 et >120 km.
- Autonomie : espacement maximal connu des ravitaillements inférieur à 12 km, de 12 à 20 km ou supérieur à 20 km.

Le verdict devient « préparation encore insuffisante » dès qu’un axe est critique ou que deux axes présentent un écart important. Moins de trois axes évaluables produit « données insuffisantes ».

## Estimation et confiance

L’heuristique de passage utilise la référence trail récente la plus proche en km-effort :

`durée référence / km-effort référence × km-effort du point × (km-effort course / km-effort référence)^0,08`

Elle exige un ratio de km-effort compris entre 0,5 et 2, un D+ cumulé officiel au checkpoint et une référence de 365 jours maximum. Un chrono route, un test de six minutes ou une simple sortie longue ne produit jamais de passage estimé. La fiabilité reste faible ou moyenne en V0.

La confiance combine complétude et fraîcheur du profil, présence d’une référence récente, qualité déclarée de la course, données physiques, barrières avec D+ cumulé, technicité, nuit et ravitaillements. Les niveaux sont faible (<45), moyen (45–74) et élevé (≥75). Les données manquantes restent toujours visibles.

## Limites et calibration future

Les seuils sont conservateurs et ne sont pas des vérités scientifiques. La technicité officielle est actuellement rarement renseignée, les ravitaillements ne sont pas complets pour toutes les courses et les barrières n’ont pas toujours leur D+ cumulé. Les futures calibrations devront s’appuyer sur des résultats consentis : départ, arrivée, temps aux contrôles, conditions, abandons et ressenti, en segmentant par terrain et distance plutôt qu’en ajustant un unique score global.
