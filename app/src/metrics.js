function assertPositiveNumber(value, name) {
  if (!Number.isFinite(value) || value <= 0) {
    throw new RangeError(`${name} must be a positive number`);
  }
}

function assertNonNegativeNumber(value, name) {
  if (!Number.isFinite(value) || value < 0) {
    throw new RangeError(`${name} must be a non-negative number`);
  }
}

function clamp(value, min = 0, max = 100) {
  return Math.max(min, Math.min(max, value));
}

function round(value, digits = 1) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function finiteNumberOrNull(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string' && value.trim() === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

export const DIFFICULTY_V1_ANCHORS = Object.freeze([
  Object.freeze({ kmEffort: 0, score: 0 }),
  Object.freeze({ kmEffort: 25, score: 20 }),
  Object.freeze({ kmEffort: 45, score: 35 }),
  Object.freeze({ kmEffort: 75, score: 50 }),
  Object.freeze({ kmEffort: 115, score: 65 }),
  Object.freeze({ kmEffort: 155, score: 75 }),
  Object.freeze({ kmEffort: 210, score: 85 }),
  Object.freeze({ kmEffort: 300, score: 95 }),
  Object.freeze({ kmEffort: 550, score: 100 }),
]);

export const VERTICALITY_LEVELS = Object.freeze({
  ROLLING: 'rolling',
  HILLY: 'hilly',
  MOUNTAINOUS: 'mountainous',
  VERY_MOUNTAINOUS: 'very_mountainous',
  EXTREME: 'extreme',
});

function canCalculatePhysicalVolume(race) {
  const distanceKm = finiteNumberOrNull(race?.distanceKm);
  const elevationGainM = finiteNumberOrNull(race?.elevationGainM);

  return (
    distanceKm !== null &&
    distanceKm > 0 &&
    elevationGainM !== null &&
    elevationGainM >= 0
  );
}

function canCalculateRaceScores(race) {
  const timeLimitMinutes = finiteNumberOrNull(race?.timeLimitMinutes);

  return (
    canCalculatePhysicalVolume(race) &&
    timeLimitMinutes !== null &&
    timeLimitMinutes > 0
  );
}

function canCalculateCheckpointScores(race, checkpoint) {
  const distanceKm = finiteNumberOrNull(race?.distanceKm);
  const timeLimitMinutes = finiteNumberOrNull(race?.timeLimitMinutes);
  const checkpointDistanceKm = finiteNumberOrNull(checkpoint?.distanceKm);
  const elapsedLimitMinutes = finiteNumberOrNull(checkpoint?.elapsedLimitMinutes);

  return (
    canCalculateRaceScores(race) &&
    checkpointDistanceKm !== null &&
    checkpointDistanceKm > 0 &&
    checkpointDistanceKm <= distanceKm &&
    elapsedLimitMinutes !== null &&
    elapsedLimitMinutes > 0 &&
    elapsedLimitMinutes <= timeLimitMinutes
  );
}

export function calculateKmEffort(distanceKm, elevationGainM) {
  assertPositiveNumber(distanceKm, 'distanceKm');
  assertNonNegativeNumber(elevationGainM, 'elevationGainM');
  return round(distanceKm + elevationGainM / 100, 1);
}

export function estimateDifficultyScoreV1FromKmEffort(kmEffort) {
  const value = finiteNumberOrNull(kmEffort);
  if (value === null || value < 0) return null;

  const anchors = DIFFICULTY_V1_ANCHORS;
  const first = anchors[0];
  const last = anchors[anchors.length - 1];

  if (value <= first.kmEffort) return first.score;
  if (value >= last.kmEffort) return last.score;

  for (let index = 1; index < anchors.length; index += 1) {
    const previous = anchors[index - 1];
    const next = anchors[index];

    if (value <= next.kmEffort) {
      const ratio = (value - previous.kmEffort) / (next.kmEffort - previous.kmEffort);
      return Math.round(clamp(previous.score + ratio * (next.score - previous.score)));
    }
  }

  return last.score;
}

export function estimateDifficultyScoreV1(race) {
  if (!canCalculatePhysicalVolume(race)) return null;
  const distanceKm = finiteNumberOrNull(race.distanceKm);
  const elevationGainM = finiteNumberOrNull(race.elevationGainM);
  const kmEffort = calculateKmEffort(distanceKm, elevationGainM);
  return estimateDifficultyScoreV1FromKmEffort(kmEffort);
}

export function calculateElevationDensity(distanceKm, elevationGainM) {
  assertPositiveNumber(distanceKm, 'distanceKm');
  assertNonNegativeNumber(elevationGainM, 'elevationGainM');
  return round(elevationGainM / distanceKm, 1);
}

export function classifyVerticalityLevel(elevationDensityMPerKm) {
  const density = finiteNumberOrNull(elevationDensityMPerKm);
  if (density === null || density < 0) return null;
  if (density < 15) return VERTICALITY_LEVELS.ROLLING;
  if (density < 30) return VERTICALITY_LEVELS.HILLY;
  if (density < 50) return VERTICALITY_LEVELS.MOUNTAINOUS;
  if (density < 70) return VERTICALITY_LEVELS.VERY_MOUNTAINOUS;
  return VERTICALITY_LEVELS.EXTREME;
}

export function calculateRequiredAverageSpeed(distanceKm, timeLimitMinutes) {
  assertPositiveNumber(distanceKm, 'distanceKm');
  assertPositiveNumber(timeLimitMinutes, 'timeLimitMinutes');
  return round(distanceKm / (timeLimitMinutes / 60), 2);
}

export function calculateRequiredCheckpointSpeed(distanceKm, elapsedLimitMinutes) {
  assertPositiveNumber(distanceKm, 'checkpointDistanceKm');
  assertPositiveNumber(elapsedLimitMinutes, 'elapsedLimitMinutes');
  return round(distanceKm / (elapsedLimitMinutes / 60), 2);
}

export function estimateDifficultyScoreV0(race) {
  if (!canCalculateRaceScores(race)) return null;
  const distanceKm = finiteNumberOrNull(race.distanceKm);
  const elevationGainM = finiteNumberOrNull(race.elevationGainM);
  const timeLimitMinutes = finiteNumberOrNull(race.timeLimitMinutes);

  const kmEffort = calculateKmEffort(distanceKm, elevationGainM);
  const requiredAverageSpeed = calculateRequiredAverageSpeed(distanceKm, timeLimitMinutes);

  const distanceComponent = clamp((distanceKm / 120) * 38, 0, 38);
  const elevationComponent = clamp((elevationGainM / 6000) * 32, 0, 32);
  const effortComponent = clamp((kmEffort / 160) * 20, 0, 20);
  const cutoffComponent = clamp(((requiredAverageSpeed - 4) / 4) * 10, 0, 10);

  return Math.round(distanceComponent + elevationComponent + effortComponent + cutoffComponent);
}

export function estimateBarrierPressureScoreV0(race, checkpoint) {
  const distanceKm = finiteNumberOrNull(race?.distanceKm);
  const timeLimitMinutes = finiteNumberOrNull(race?.timeLimitMinutes);
  const checkpointDistanceKm = finiteNumberOrNull(checkpoint?.distanceKm);
  const elapsedLimitMinutes = finiteNumberOrNull(checkpoint?.elapsedLimitMinutes);

  if (
    !canCalculateRaceScores(race) ||
    checkpointDistanceKm === null ||
    checkpointDistanceKm <= 0 ||
    elapsedLimitMinutes === null ||
    elapsedLimitMinutes <= 0
  ) {
    return null;
  }

  if (checkpointDistanceKm > distanceKm) {
    throw new RangeError('checkpointDistanceKm must not exceed race distanceKm');
  }
  if (elapsedLimitMinutes > timeLimitMinutes) {
    throw new RangeError('checkpoint elapsed limit must not exceed race time limit');
  }

  const globalSpeed = calculateRequiredAverageSpeed(distanceKm, timeLimitMinutes);
  const checkpointSpeed = calculateRequiredCheckpointSpeed(checkpointDistanceKm, elapsedLimitMinutes);

  // V0 experimental model:
  // 50 means the checkpoint asks for the same average speed as the full race.
  // Every +1% of required speed adds 1 point; every -1% removes 1 point.
  const ratio = checkpointSpeed / globalSpeed;
  return Math.round(clamp(50 + (ratio - 1) * 100));
}

export function enrichRaceWithScores(race, checkpoints = []) {
  const distanceKm = finiteNumberOrNull(race?.distanceKm);
  const elevationGainM = finiteNumberOrNull(race?.elevationGainM);
  const timeLimitMinutes = finiteNumberOrNull(race?.timeLimitMinutes);
  const hasPhysicalVolume = canCalculatePhysicalVolume(race);
  const hasRaceScoresV0 = canCalculateRaceScores(race);
  const kmEffort = hasPhysicalVolume
    ? calculateKmEffort(distanceKm, elevationGainM)
    : null;
  const elevationDensityMPerKm = hasPhysicalVolume
    ? calculateElevationDensity(distanceKm, elevationGainM)
    : null;
  const verticalityLevel = classifyVerticalityLevel(elevationDensityMPerKm);
  const requiredAverageSpeedKmh = hasRaceScoresV0
    ? calculateRequiredAverageSpeed(distanceKm, timeLimitMinutes)
    : null;
  const difficultyScoreV0 = hasRaceScoresV0 ? estimateDifficultyScoreV0(race) : null;
  const difficultyScoreV1 = hasPhysicalVolume ? estimateDifficultyScoreV1(race) : null;

  const enrichedCheckpoints = checkpoints.map((checkpoint) => {
    const hasScores = canCalculateCheckpointScores(race, checkpoint);
    const checkpointDistanceKm = finiteNumberOrNull(checkpoint?.distanceKm);
    const elapsedLimitMinutes = finiteNumberOrNull(checkpoint?.elapsedLimitMinutes);
    const requiredCheckpointSpeedKmh = hasScores
      ? calculateRequiredCheckpointSpeed(checkpointDistanceKm, elapsedLimitMinutes)
      : null;
    return {
      ...checkpoint,
      requiredCheckpointSpeedKmh,
      barrierPressureScoreV0: hasScores ? estimateBarrierPressureScoreV0(race, checkpoint) : null,
    };
  });

  const criticalBarrier = findCriticalBarrier(race, enrichedCheckpoints);

  return {
    ...race,
    kmEffort,
    requiredAverageSpeedKmh,
    difficultyScoreV0,
    difficultyScoreV1,
    difficultyScore: difficultyScoreV1,
    difficultyScoreVersion: 'v1',
    elevationDensityMPerKm,
    verticalityLevel,
    barrierPressureScoreV0: criticalBarrier?.barrierPressureScoreV0 ?? null,
    criticalBarrier,
    checkpoints: enrichedCheckpoints,
  };
}

export function findCriticalBarrier(race, checkpoints = []) {
  if (!Array.isArray(checkpoints) || checkpoints.length === 0) {
    return null;
  }

  return checkpoints.reduce((critical, checkpoint) => {
    const score = Number.isFinite(checkpoint.barrierPressureScoreV0)
      ? checkpoint.barrierPressureScoreV0
      : canCalculateCheckpointScores(race, checkpoint)
        ? estimateBarrierPressureScoreV0(race, checkpoint)
        : null;

    if (!Number.isFinite(score)) return critical;

    const candidate = { ...checkpoint, barrierPressureScoreV0: score };
    if (!critical || candidate.barrierPressureScoreV0 > critical.barrierPressureScoreV0) {
      return candidate;
    }
    return critical;
  }, null);
}
