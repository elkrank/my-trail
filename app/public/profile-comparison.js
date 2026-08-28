import {
  COMPARISON_THRESHOLDS as T,
  COMPARISON_VERSION,
  GOAL_FACTORS,
  STATUS,
  STATUS_RANK,
} from './profile-config.js';

const DAY_MS = 86400000;
const LEVEL_VALUE = Object.freeze({ none: 0, beginner: 0, some: 1, comfortable: 1, regular: 2, confirmed: 2 });

export function compareRunnerToRace(profile, race, now = new Date()) {
  const trailEstimate = estimateTrailPerformance(profile, race, now);
  const axes = assessAxes(profile, race, trailEstimate);
  const verdict = deriveVerdict(axes);
  const confidence = assessConfidence(profile, race, now, trailEstimate, axes);
  return {
    version: COMPARISON_VERSION,
    verdict,
    confidence,
    axes,
    assumptions: [
      'Seuils V0 conservateurs et non scientifiques.',
      'Aucune estimation de passage n’est produite depuis un chrono route ou une sortie longue.',
    ],
  };
}

function assessAxes(profile, race, trailEstimate) {
  const goalFactor = GOAL_FACTORS[profile?.goal] ?? 1;
  return [
    assessEndurance(profile, race, goalFactor),
    assessElevation(profile, race, goalFactor),
    assessBarriers(profile, race, trailEstimate),
    assessLongExperience(profile, race, trailEstimate, goalFactor),
    assessTechnicalAutonomy(profile, race),
  ];
}

export function getPastEditionInfo(value, now = new Date()) {
  if (!value || !now || typeof now.getTime !== 'function' || Number.isNaN(now.getTime())) return null;
  const dateOnly = String(value).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  let year;
  let month;
  let day;
  if (dateOnly) {
    [, year, month, day] = dateOnly.map(Number);
    const validated = new Date(Date.UTC(year, month - 1, day));
    if (validated.getUTCFullYear() !== year || validated.getUTCMonth() !== month - 1 || validated.getUTCDate() !== day) return null;
  } else {
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) return null;
    year = parsed.getFullYear();
    month = parsed.getMonth() + 1;
    day = parsed.getDate();
  }
  const raceDay = Date.UTC(year, month - 1, day);
  const currentDay = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
  return raceDay < currentDay ? { year, date: String(value) } : null;
}

export function calculateKmEffort(distanceKm, elevationGainM) {
  const distance = numberOrNull(distanceKm);
  const gain = numberOrNull(elevationGainM);
  return distance !== null && distance > 0 && gain !== null && gain >= 0
    ? round(distance + gain / 100, 1)
    : null;
}

export function calculateMinimumCheckpointPace(distanceKm, elapsedMinutes) {
  const distance = numberOrNull(distanceKm);
  const elapsed = numberOrNull(elapsedMinutes);
  if (distance === null || distance <= 0 || elapsed === null || elapsed <= 0) return null;
  return {
    minutesPerKm: elapsed / distance,
    speedKmh: distance / (elapsed / 60),
  };
}

export function formatMinutesAsHoursMinutes(value, { signed = false } = {}) {
  const minutes = numberOrNull(value);
  if (minutes === null) return 'Données insuffisantes';
  const sign = minutes < 0 ? '−' : signed && minutes > 0 ? '+' : '';
  const absolute = Math.abs(Math.round(minutes));
  const hours = Math.floor(absolute / 60);
  const remainder = absolute % 60;
  return `${sign}${hours} h ${String(remainder).padStart(2, '0')}`;
}

function assessEndurance(profile, race, factor) {
  const courseEffort = calculateKmEffort(race?.distanceKm, race?.elevationGainM);
  if (courseEffort === null) return unavailableAxis('endurance', 'Endurance', 'Distance ou D+ de la course manquant.');
  const weeklyTarget = clamp(courseEffort * T.endurance.weeklyKmEffortFactor, T.endurance.weeklyDistanceMinKm, T.endurance.weeklyDistanceMaxKm) * factor;
  const longTarget = courseEffort * T.endurance.longRunKmEffortFactor * factor;
  const experienceTarget = Number(race.distanceKm) * T.endurance.longestDistanceFactor * factor;
  const longRun = profile?.training?.longRun;
  const longEffort = calculateKmEffort(longRun?.distanceKm, longRun?.elevationGainM);
  const indicators = [
    indicator('Volume hebdomadaire', profile?.training?.weeklyDistanceKm, weeklyTarget, 'km/sem'),
    indicator('Sortie longue', longEffort, longTarget, 'km-effort'),
    indicator('Plus longue distance terminée', profile?.experience?.longestCompletedDistanceKm, experienceTarget, 'km'),
  ];
  return axisFromIndicators({
    id: 'endurance',
    label: 'Endurance',
    indicators,
    explanation: `La course représente ${formatNumber(courseEffort)} km-effort. Les repères portent sur le volume récent, la sortie longue et l’expérience terminée.`,
    recommendation: recommendationForWorst(indicators, {
      'Volume hebdomadaire': (target) => `Développer progressivement le volume vers environ ${roundTarget(target, 5)} km par semaine.`,
      'Sortie longue': (target) => `Valider une sortie longue proche de ${roundTarget(target, 5)} km-effort.`,
      'Plus longue distance terminée': (target) => `Terminer d’abord une épreuve ou sortie structurée proche de ${roundTarget(target, 5)} km.`,
    }),
  });
}

function assessElevation(profile, race, factor) {
  const distance = numberOrNull(race?.distanceKm);
  const gain = numberOrNull(race?.elevationGainM);
  if (distance === null || distance <= 0 || gain === null) return unavailableAxis('elevation', 'Dénivelé', 'Distance ou D+ de la course manquant.');
  const longRun = profile?.training?.longRun;
  const density = gain / distance;
  const longDensity = numberOrNull(longRun?.distanceKm) > 0 && numberOrNull(longRun?.elevationGainM) !== null
    ? Number(longRun.elevationGainM) / Number(longRun.distanceKm)
    : null;
  const indicators = [
    indicator('D+ hebdomadaire', profile?.training?.weeklyElevationGainM, clamp(gain * T.elevation.weeklyFactor, T.elevation.weeklyMinM, T.elevation.weeklyMaxM) * factor, 'm D+/sem'),
    indicator('D+ de la sortie longue', longRun?.elevationGainM, gain * T.elevation.longRunFactor * factor, 'm D+'),
    indicator('Plus gros D+ réalisé', profile?.experience?.maximumElevationGainM, gain * T.elevation.maximumFactor * factor, 'm D+'),
    indicator('Densité de la sortie longue', longDensity, density * T.elevation.densityFactor * factor, 'm D+/km'),
  ];
  return axisFromIndicators({
    id: 'elevation',
    label: 'Dénivelé',
    indicators,
    explanation: `Le parcours annonce ${formatNumber(gain, 0)} m D+, soit ${formatNumber(density)} m D+/km.`,
    recommendation: recommendationForWorst(indicators, {
      'D+ hebdomadaire': (target) => `Construire progressivement vers environ ${roundTarget(target, 100)} m D+ par semaine.`,
      'D+ de la sortie longue': (target) => `Valider une sortie longue avec environ ${roundTarget(target, 100)} m D+.`,
      'Plus gros D+ réalisé': (target) => `Valider un effort cumulé proche de ${roundTarget(target, 100)} m D+.`,
      'Densité de la sortie longue': (target) => `Tester un terrain approchant ${roundTarget(target, 5)} m D+/km.`,
    }),
  });
}

function assessBarriers(profile, race, estimate) {
  const checkpoints = Array.isArray(race?.checkpoints) ? race.checkpoints : [];
  const barriers = checkpoints.map((checkpoint) => assessCheckpoint(race, checkpoint, estimate));
  const assessed = barriers.filter((barrier) => barrier.status !== STATUS.INSUFFICIENT);
  const incomplete = barriers.filter((barrier) => barrier.status === STATUS.INSUFFICIENT);
  const status = assessed.length && !incomplete.length
    ? worstStatus(assessed.map((barrier) => barrier.status))
    : STATUS.INSUFFICIENT;
  const critical = [...assessed].sort((a, b) => STATUS_RANK[b.status] - STATUS_RANK[a.status])[0] ?? barriers[0];
  const estimatedCount = barriers.filter((barrier) => barrier.estimatedElapsedMinutes !== null).length;
  const missingElevation = barriers.some((barrier) => barrier.missingReason === 'missing_checkpoint_elevation_gain');
  let explanation;
  let recommendation;
  if (!barriers.length) {
    explanation = 'La course ne publie pas de barrière exploitable.';
    recommendation = 'Vérifier les barrières publiées par l’organisation avant la course.';
  } else if (!estimate) {
    explanation = 'Aucune référence trail récente et suffisamment comparable ne permet d’estimer les passages.';
    recommendation = 'Ajouter une référence trail récente avec distance, durée et D+.';
  } else if (!estimatedCount && missingElevation) {
    explanation = 'Une référence trail comparable est disponible, mais le D+ cumulé aux points de contrôle manque. Les passages intermédiaires ne peuvent pas être estimés précisément.';
    recommendation = 'Compléter le D+ cumulé des points de contrôle, idéalement à partir du GPX.';
  } else if (incomplete.length) {
    explanation = 'Certains passages sont estimés depuis une référence trail récente et comparable, mais des points de contrôle restent incomplets.';
    recommendation = missingElevation
      ? 'Compléter le D+ cumulé des points de contrôle, idéalement à partir du GPX.'
      : 'Compléter les données des points de contrôle avant de valider toutes les barrières.';
  } else {
    explanation = 'Les passages sont estimés depuis une référence trail récente et comparable; ils restent indicatifs.';
    recommendation = status === STATUS.VALIDATED
      ? 'Reproduire l’allure cible avec les arrêts et la nutrition prévus.'
      : 'Valider sur trail une allure avec arrêts offrant une marge positive aux barrières.';
  }
  return {
    id: 'barriers',
    label: 'Respect des barrières horaires',
    status,
    current: estimate ? `Référence trail : ${estimate.reference.name || formatNumber(estimate.reference.distanceKm) + ' km'}` : 'Données insuffisantes',
    requirement: barriers.length ? `${barriers.length} barrière${barriers.length > 1 ? 's' : ''} publiée${barriers.length > 1 ? 's' : ''}` : 'Aucune barrière exploitable',
    gap: critical?.marginMinutes === null || critical?.marginMinutes === undefined ? 'Données insuffisantes' : formatMinutesAsHoursMinutes(critical.marginMinutes, { signed: true }),
    explanation,
    recommendation,
    indicators: [],
    barriers,
  };
}

function assessCheckpoint(race, checkpoint, estimate) {
  const pace = calculateMinimumCheckpointPace(checkpoint?.distanceKm, checkpoint?.elapsedLimitMinutes);
  const suppliedGain = numberOrNull(checkpoint?.elevationGainFromStartM);
  const finishGain = suppliedGain === null && isFinishCheckpoint(race, checkpoint)
    ? numberOrNull(race?.elevationGainM)
    : null;
  const cumulativeGain = suppliedGain ?? finishGain;
  const elevationGainSource = suppliedGain !== null
    ? checkpoint?.elevationGainFromStartSource ?? 'official_checkpoint'
    : finishGain !== null ? 'official_race_total' : null;
  let estimatedElapsedMinutes = null;
  if (pace && estimate && cumulativeGain !== null) {
    const checkpointEffort = calculateKmEffort(checkpoint.distanceKm, cumulativeGain);
    estimatedElapsedMinutes = checkpointEffort === null ? null : estimate.minutesPerKmEffort * checkpointEffort;
  }
  const marginMinutes = estimatedElapsedMinutes === null ? null : Number(checkpoint.elapsedLimitMinutes) - estimatedElapsedMinutes;
  const status = marginMinutes === null ? STATUS.INSUFFICIENT : barrierStatus(marginMinutes, Number(checkpoint.elapsedLimitMinutes));
  const missingReason = estimatedElapsedMinutes !== null
    ? null
    : !pace ? 'missing_checkpoint_timing'
      : !estimate ? 'missing_comparable_trail_reference'
        : cumulativeGain === null ? 'missing_checkpoint_elevation_gain' : 'unavailable_estimate';
  return {
    name: checkpoint?.name ?? 'Point de contrôle',
    distanceKm: numberOrNull(checkpoint?.distanceKm),
    cutoffTime: cutoffClock(race, checkpoint),
    elapsedLimitMinutes: numberOrNull(checkpoint?.elapsedLimitMinutes),
    elevationGainFromStartM: cumulativeGain,
    elevationGainFromStartSource: elevationGainSource,
    requiredMinutesPerKm: pace?.minutesPerKm ?? null,
    requiredSpeedKmh: pace?.speedKmh ?? null,
    estimatedElapsedMinutes,
    estimatedTime: estimatedElapsedMinutes === null ? null : passageClock(race, estimatedElapsedMinutes),
    marginMinutes,
    reliability: estimatedElapsedMinutes === null ? null : estimate.reliability,
    missingReason,
    status,
  };
}

function isFinishCheckpoint(race, checkpoint) {
  const raceDistance = numberOrNull(race?.distanceKm);
  const checkpointDistance = numberOrNull(checkpoint?.distanceKm);
  if (raceDistance === null || raceDistance <= 0 || checkpointDistance === null) return false;
  return Math.abs(checkpointDistance - raceDistance) <= Math.max(0.5, raceDistance * 0.01);
}

function assessLongExperience(profile, race, estimate, factor) {
  const raceDistance = numberOrNull(race?.distanceKm);
  if (raceDistance === null) return unavailableAxis('long_experience', 'Expérience longue', 'Distance de la course manquante.');
  const longestDistance = numberOrNull(profile?.experience?.longestCompletedDistanceKm);
  const categoryGap = longestDistance === null ? null : distanceCategory(raceDistance) - distanceCategory(longestDistance);
  const categoryStatus = categoryGap === null ? STATUS.INSUFFICIENT
    : categoryGap <= 0 ? STATUS.VALIDATED
      : categoryGap === 1 ? STATUS.CONSOLIDATE
        : categoryGap === 2 ? STATUS.IMPORTANT_GAP : STATUS.CRITICAL;
  const indicators = [{
    label: 'Changement de catégorie',
    current: longestDistance,
    target: raceDistance,
    unit: 'km',
    coverage: longestDistance === null ? null : longestDistance / raceDistance,
    status: categoryStatus,
  }];
  if (estimate?.estimatedRaceMinutes) {
    indicators.push(indicator('Durée maximale déjà réalisée', profile?.experience?.longestEffortMinutes, estimate.estimatedRaceMinutes * T.experience.estimatedDurationFactor * factor, 'min'));
  }
  return axisFromIndicators({
    id: 'long_experience',
    label: 'Expérience longue',
    indicators,
    explanation: categoryGap === null
      ? 'La plus longue distance terminée n’est pas renseignée.'
      : categoryGap <= 0 ? 'Le coureur a déjà terminé une distance de cette catégorie.' : `La course représente un saut de ${categoryGap} catégorie${categoryGap > 1 ? 's' : ''} de distance.`,
    recommendation: categoryGap > 0 ? 'Terminer une course intermédiaire dans la catégorie immédiatement inférieure.' : 'Conserver une validation récente d’effort long.',
  });
}

function assessTechnicalAutonomy(profile, race) {
  const indicators = [];
  const technicalRequirement = technicalRequirementLevel(race?.technicalScore);
  indicators.push(levelIndicator('Terrain technique', profile?.experience?.technicalLevel, technicalRequirement));

  if (race?.nightStart === true) indicators.push(levelIndicator('Course nocturne', profile?.experience?.nightExperience, 1));
  else if (race?.nightStart === false) indicators.push(levelIndicator('Course nocturne', profile?.experience?.nightExperience, 0));
  else indicators.push(levelIndicator('Course nocturne', profile?.experience?.nightExperience, null));

  const spacing = maximumAidSpacing(race);
  const autonomyRequirement = spacing === null ? null : spacing > 20 ? 2 : spacing >= 12 ? 1 : 0;
  indicators.push(levelIndicator('Autonomie entre ravitaillements', profile?.experience?.autonomyExperience, autonomyRequirement));

  const assessed = indicators.filter((item) => item.status !== STATUS.INSUFFICIENT);
  const status = technicalRequirement === null || !assessed.length ? STATUS.INSUFFICIENT : worstStatus(assessed.map((item) => item.status));
  return {
    id: 'technical_autonomy',
    label: 'Technicité et autonomie',
    status,
    current: indicators.map((item) => `${item.label} : ${levelLabel(item.current)}`).join(' · '),
    requirement: indicators.map((item) => `${item.label} : ${levelLabel(item.target)}`).join(' · '),
    gap: status === STATUS.INSUFFICIENT ? 'Caractéristiques incomplètes' : statusLabel(status),
    explanation: technicalRequirement === null
      ? 'La technicité officielle du parcours n’est pas documentée; les informations de nuit et de ravitaillement restent visibles sans combler ce manque.'
      : `L’espacement maximal connu entre ravitaillements est ${spacing === null ? 'indisponible' : `${formatNumber(spacing)} km`}.`,
    recommendation: technicalRequirement === null
      ? 'Vérifier le descriptif technique officiel et tester l’autonomie sur un terrain comparable.'
      : status === STATUS.VALIDATED ? 'Reproduire les conditions de terrain, de nuit et d’autonomie avant la course.' : 'Valider le terrain technique, la nuit ou l’autonomie identifié comme limitant.',
    indicators,
  };
}

export function estimateTrailPerformance(profile, race, now = new Date()) {
  const raceEffort = calculateKmEffort(race?.distanceKm, race?.elevationGainM);
  if (raceEffort === null) return null;
  const candidates = (profile?.performances ?? []).filter((reference) => {
    if (reference?.type !== 'trail') return false;
    const effort = calculateKmEffort(reference.distanceKm, reference.elevationGainM);
    const duration = numberOrNull(reference.durationMinutes);
    const age = ageDays(reference.date, now);
    if (effort === null || duration === null || duration <= 0 || age === null || age > T.estimation.maximumAgeDays) return false;
    const ratio = raceEffort / effort;
    return ratio >= T.estimation.minimumKmEffortRatio && ratio <= T.estimation.maximumKmEffortRatio;
  }).map((reference) => ({ reference, effort: calculateKmEffort(reference.distanceKm, reference.elevationGainM), age: ageDays(reference.date, now) }));
  if (!candidates.length) return null;
  candidates.sort((a, b) => Math.abs(Math.log(raceEffort / a.effort)) - Math.abs(Math.log(raceEffort / b.effort)) || a.age - b.age);
  const selected = candidates[0];
  const ratio = raceEffort / selected.effort;
  const minutesPerKmEffort = (Number(selected.reference.durationMinutes) / selected.effort) * ratio ** T.estimation.fatigueExponent;
  return {
    reference: selected.reference,
    referenceKmEffort: selected.effort,
    raceKmEffort: raceEffort,
    minutesPerKmEffort,
    estimatedRaceMinutes: minutesPerKmEffort * raceEffort,
    reliability: selected.age <= 180 && ratio >= 0.75 && ratio <= 1.5 ? 'medium' : 'low',
  };
}

export function deriveVerdict(axes) {
  const assessable = axes.filter((axis) => axis.status !== STATUS.INSUFFICIENT);
  if (assessable.length < 3) return 'insufficient_data';
  const critical = assessable.filter((axis) => axis.status === STATUS.CRITICAL).length;
  const important = assessable.filter((axis) => axis.status === STATUS.IMPORTANT_GAP).length;
  const consolidate = assessable.filter((axis) => axis.status === STATUS.CONSOLIDATE).length;
  if (critical || important >= 2) return 'preparation_insufficient';
  if (important === 1 || consolidate >= 2) return 'ambitious_coherent';
  return 'accessible_now';
}

export function assessConfidence(profile, race, now = new Date(), estimate = estimateTrailPerformance(profile, race, now), axes = assessAxes(profile, race, estimate)) {
  const reasons = [];
  const missing = [];
  const groups = [
    hasAny(profile?.training?.weeklyDistanceKm, profile?.training?.longRun?.distanceKm),
    hasAny(profile?.training?.weeklyElevationGainM, profile?.experience?.maximumElevationGainM),
    Boolean(estimate),
    hasAny(profile?.experience?.longestCompletedDistanceKm, profile?.experience?.longestEffortMinutes),
    hasAny(profile?.experience?.technicalLevel, profile?.experience?.nightExperience, profile?.experience?.autonomyExperience),
  ];
  let score = groups.filter(Boolean).length * 5;
  if (!groups[2]) missing.push('Aucune référence trail récente et comparable');
  if (!groups[4]) missing.push('Expérience technique, nocturne et autonomie non renseignées');

  const updatedAge = ageDays(profile?.updatedAt, now);
  if (updatedAge !== null && updatedAge <= 60) score += 10;
  else missing.push('Volume récent non actualisé depuis moins de 60 jours');
  const recentEvidence = [...(profile?.performances ?? []).map((item) => item.date), profile?.training?.longRun?.date]
    .map((date) => ageDays(date, now)).filter((age) => age !== null);
  if (recentEvidence.some((age) => age <= 365)) score += 10;
  else missing.push('Aucune sortie longue ou performance datée de moins d’un an');
  if (estimate) score += 10;
  const longRunAge = ageDays(profile?.training?.longRun?.date, now);
  if (longRunAge !== null && longRunAge <= 90) score += 5;

  if (calculateKmEffort(race?.distanceKm, race?.elevationGainM) !== null) score += 10;
  else missing.push('Distance ou D+ officiel manquant');
  if (Array.isArray(race?.checkpoints) && race.checkpoints.length && race.checkpoints.some((item) => numberOrNull(item.elevationGainFromStartM) !== null)) score += 10;
  else missing.push('Barrières avec D+ cumulé indisponibles');
  const sportStatus = race?.quality?.sportCompleteness ?? race?.quality?.status;
  const qualityScore = sportStatus === 'complete' ? 10 : sportStatus === 'partial' ? 6 : 2;
  score += qualityScore;
  if (race?.technicalScore !== null && race?.technicalScore !== undefined) score += 4;
  else missing.push('Technicité officielle indisponible');
  if (race?.nightStart !== null && race?.nightStart !== undefined) score += 2;
  if (maximumAidSpacing(race) !== null) score += 4;
  else missing.push('Espacement des ravitaillements indisponible');

  const rawLevel = score >= T.confidence.high ? 'high' : score >= T.confidence.medium ? 'medium' : 'low';
  const insufficientAxes = axes.filter((axis) => axis.status === STATUS.INSUFFICIENT);
  const cappedForInsufficientAxes = insufficientAxes.length >= 2 && rawLevel === 'high';
  const level = cappedForInsufficientAxes ? 'medium' : rawLevel;
  if (cappedForInsufficientAxes) {
    const ids = new Set(insufficientAxes.map((axis) => axis.id));
    reasons.push(ids.has('barriers') && ids.has('technical_autonomy')
      ? 'Bonne confiance sur l’endurance et le dénivelé, mais limitée sur les barrières horaires et la technicité.'
      : 'Profil exploitable, mais plusieurs axes clés restent limités par les données disponibles.');
  } else if (level === 'high') reasons.push('Profil récent et données course bien documentées.');
  else if (level === 'medium') reasons.push('Diagnostic exploitable, avec plusieurs limites signalées.');
  else reasons.push('Diagnostic indicatif : plusieurs entrées importantes manquent.');
  return {
    score: Math.min(100, score),
    rawLevel,
    level,
    insufficientAxisCount: insufficientAxes.length,
    reasons,
    missing,
  };
}

function indicator(label, currentValue, targetValue, unit) {
  const current = numberOrNull(currentValue);
  const target = numberOrNull(targetValue);
  const coverage = current === null || target === null || target <= 0 ? null : current / target;
  return { label, current, target, unit, coverage, status: statusFromCoverage(coverage) };
}

function levelIndicator(label, currentValue, targetValue) {
  const current = currentValue === null || currentValue === undefined ? null : LEVEL_VALUE[currentValue] ?? numberOrNull(currentValue);
  const target = targetValue === null || targetValue === undefined ? null : targetValue;
  const coverage = current === null || target === null ? null : target === 0 ? 1 : current / target;
  return { label, current, target, unit: 'level', coverage, status: statusFromCoverage(coverage) };
}

function statusFromCoverage(coverage) {
  if (coverage === null || !Number.isFinite(coverage)) return STATUS.INSUFFICIENT;
  if (coverage >= T.coverage.validated) return STATUS.VALIDATED;
  if (coverage >= T.coverage.consolidate) return STATUS.CONSOLIDATE;
  if (coverage >= T.coverage.importantGap) return STATUS.IMPORTANT_GAP;
  return STATUS.CRITICAL;
}

function axisFromIndicators({ id, label, indicators, explanation, recommendation }) {
  const available = indicators.filter((item) => item.status !== STATUS.INSUFFICIENT);
  const status = available.length ? worstStatus(available.map((item) => item.status)) : STATUS.INSUFFICIENT;
  const worst = available.sort((a, b) => STATUS_RANK[b.status] - STATUS_RANK[a.status])[0];
  return {
    id,
    label,
    status,
    current: worst ? metricText(worst.current, worst.unit) : 'Données insuffisantes',
    requirement: worst ? metricText(worst.target, worst.unit) : 'Données insuffisantes',
    gap: worst ? gapText(worst) : 'Données insuffisantes',
    explanation,
    recommendation: status === STATUS.VALIDATED ? 'Maintenir ce repère dans la préparation.' : recommendation,
    indicators,
  };
}

function unavailableAxis(id, label, explanation) {
  return { id, label, status: STATUS.INSUFFICIENT, current: 'Données insuffisantes', requirement: 'Données insuffisantes', gap: 'Données insuffisantes', explanation, recommendation: 'Compléter les données manquantes avant de conclure.', indicators: [] };
}

function recommendationForWorst(indicators, factories) {
  const available = indicators.filter((item) => item.status !== STATUS.INSUFFICIENT).sort((a, b) => STATUS_RANK[b.status] - STATUS_RANK[a.status]);
  const worst = available[0];
  return worst ? factories[worst.label]?.(worst.target) ?? 'Valider progressivement le repère manquant.' : 'Compléter le profil pour obtenir une validation mesurable.';
}

function worstStatus(statuses) {
  return statuses.reduce((worst, status) => STATUS_RANK[status] > STATUS_RANK[worst] ? status : worst, STATUS.VALIDATED);
}

function barrierStatus(marginMinutes, elapsedLimitMinutes) {
  const comfortable = Math.max(T.barriers.comfortableMarginMinutes, elapsedLimitMinutes * T.barriers.comfortableMarginRatio);
  if (marginMinutes >= comfortable) return STATUS.VALIDATED;
  if (marginMinutes >= 0) return STATUS.CONSOLIDATE;
  if (marginMinutes >= -elapsedLimitMinutes * T.barriers.comfortableMarginRatio) return STATUS.IMPORTANT_GAP;
  return STATUS.CRITICAL;
}

function technicalRequirementLevel(value) {
  const score = numberOrNull(value);
  if (score === null) return null;
  if (score <= 2) return 0;
  if (score <= 3.5) return 1;
  return 2;
}

function maximumAidSpacing(race) {
  const raceDistance = numberOrNull(race?.distanceKm);
  if (raceDistance === null) return null;
  const distances = (race?.aidStations ?? []).map((item) => numberOrNull(item.distanceKm)).filter((value) => value !== null && value > 0 && value < raceDistance).sort((a, b) => a - b);
  if (!distances.length) return null;
  const points = [0, ...distances, raceDistance];
  return Math.max(...points.slice(1).map((value, index) => value - points[index]));
}

function cutoffClock(race, checkpoint) {
  if (checkpoint?.cutoffDateTime) return clockFromDate(checkpoint.cutoffDateTime);
  return passageClock(race, checkpoint?.elapsedLimitMinutes);
}

function passageClock(race, elapsedMinutes) {
  const date = String(race?.date ?? '').slice(0, 10);
  const time = String(race?.startTime ?? '').match(/^(\d{1,2}):(\d{2})/);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !time || !Number.isFinite(Number(elapsedMinutes))) return null;
  const start = new Date(`${date}T${String(time[1]).padStart(2, '0')}:${time[2]}:00`);
  if (Number.isNaN(start.getTime())) return null;
  return clockFromDate(new Date(start.getTime() + Number(elapsedMinutes) * 60000));
}

function clockFromDate(value) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return { iso: date.toISOString(), hour: `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}` };
}

function distanceCategory(distance) {
  if (distance <= 21) return 0;
  if (distance <= 42) return 1;
  if (distance <= 80) return 2;
  if (distance <= 120) return 3;
  return 4;
}

function ageDays(value, now) {
  if (!value) return null;
  const timestamp = Date.parse(value);
  if (Number.isNaN(timestamp)) return null;
  return Math.max(0, (now.getTime() - timestamp) / DAY_MS);
}

function metricText(value, unit) {
  if (value === null || value === undefined) return 'Données insuffisantes';
  if (unit === 'min') return formatMinutesAsHoursMinutes(value);
  if (unit === 'level') return levelLabel(value);
  return `${formatNumber(value)} ${unit}`;
}

function gapText(item) {
  if (item.current === null || item.target === null) return 'Données insuffisantes';
  if (item.unit === 'min') return formatMinutesAsHoursMinutes(item.current - item.target, { signed: true });
  if (item.unit === 'level') return statusLabel(item.status);
  const delta = item.current - item.target;
  return `${delta >= 0 ? '+' : '−'}${formatNumber(Math.abs(delta))} ${item.unit}`;
}

function levelLabel(value) {
  if (value === null || value === undefined) return 'Données insuffisantes';
  return ['Niveau initial', 'À l’aise', 'Confirmé'][Number(value)] ?? 'Données insuffisantes';
}

function statusLabel(status) {
  return ({
    [STATUS.VALIDATED]: 'Validé',
    [STATUS.CONSOLIDATE]: 'À consolider',
    [STATUS.IMPORTANT_GAP]: 'Écart important',
    [STATUS.CRITICAL]: 'Critique',
    [STATUS.INSUFFICIENT]: 'Données insuffisantes',
  })[status];
}

function hasAny(...values) {
  return values.some((value) => value !== null && value !== undefined && value !== '');
}

function numberOrNull(value) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function clamp(value, minimum, maximum) {
  return Math.max(minimum, Math.min(maximum, value));
}

function round(value, digits = 1) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function roundTarget(value, step) {
  return Math.round(value / step) * step;
}

function formatNumber(value, digits = 1) {
  return new Intl.NumberFormat('fr-FR', { maximumFractionDigits: digits }).format(Number(value));
}
