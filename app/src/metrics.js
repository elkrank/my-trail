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

function canCalculateRaceScores(race) {
  return (
    Number.isFinite(Number(race.distanceKm)) &&
    Number(race.distanceKm) > 0 &&
    Number.isFinite(Number(race.elevationGainM)) &&
    Number(race.elevationGainM) >= 0 &&
    Number.isFinite(Number(race.timeLimitMinutes)) &&
    Number(race.timeLimitMinutes) > 0
  );
}

function canCalculateCheckpointScores(race, checkpoint) {
  return (
    canCalculateRaceScores(race) &&
    Number.isFinite(Number(checkpoint.distanceKm)) &&
    Number(checkpoint.distanceKm) > 0 &&
    Number(checkpoint.distanceKm) <= Number(race.distanceKm) &&
    Number.isFinite(Number(checkpoint.elapsedLimitMinutes)) &&
    Number(checkpoint.elapsedLimitMinutes) > 0 &&
    Number(checkpoint.elapsedLimitMinutes) <= Number(race.timeLimitMinutes)
  );
}

export function calculateKmEffort(distanceKm, elevationGainM) {
  assertPositiveNumber(distanceKm, 'distanceKm');
  assertNonNegativeNumber(elevationGainM, 'elevationGainM');
  return round(distanceKm + elevationGainM / 100, 1);
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
  const distanceKm = Number(race.distanceKm);
  const elevationGainM = Number(race.elevationGainM);
  const timeLimitMinutes = Number(race.timeLimitMinutes);

  const kmEffort = calculateKmEffort(distanceKm, elevationGainM);
  const requiredAverageSpeed = calculateRequiredAverageSpeed(distanceKm, timeLimitMinutes);

  const distanceComponent = clamp((distanceKm / 120) * 38, 0, 38);
  const elevationComponent = clamp((elevationGainM / 6000) * 32, 0, 32);
  const effortComponent = clamp((kmEffort / 160) * 20, 0, 20);
  const cutoffComponent = clamp(((requiredAverageSpeed - 4) / 4) * 10, 0, 10);

  return Math.round(distanceComponent + elevationComponent + effortComponent + cutoffComponent);
}

export function estimateBarrierPressureScoreV0(race, checkpoint) {
  const globalSpeed = calculateRequiredAverageSpeed(
    Number(race.distanceKm),
    Number(race.timeLimitMinutes),
  );
  const checkpointSpeed = calculateRequiredCheckpointSpeed(
    Number(checkpoint.distanceKm),
    Number(checkpoint.elapsedLimitMinutes),
  );

  if (Number(checkpoint.distanceKm) > Number(race.distanceKm)) {
    throw new RangeError('checkpointDistanceKm must not exceed race distanceKm');
  }
  if (Number(checkpoint.elapsedLimitMinutes) > Number(race.timeLimitMinutes)) {
    throw new RangeError('checkpoint elapsed limit must not exceed race time limit');
  }

  // V0 experimental model:
  // 50 means the checkpoint asks for the same average speed as the full race.
  // Every +1% of required speed adds 1 point; every -1% removes 1 point.
  const ratio = checkpointSpeed / globalSpeed;
  return Math.round(clamp(50 + (ratio - 1) * 100));
}

export function enrichRaceWithScores(race, checkpoints = []) {
  const kmEffort = canCalculateRaceScores(race)
    ? calculateKmEffort(Number(race.distanceKm), Number(race.elevationGainM))
    : null;
  const requiredAverageSpeedKmh = canCalculateRaceScores(race)
    ? calculateRequiredAverageSpeed(Number(race.distanceKm), Number(race.timeLimitMinutes))
    : null;
  const difficultyScoreV0 = canCalculateRaceScores(race) ? estimateDifficultyScoreV0(race) : null;

  const enrichedCheckpoints = checkpoints.map((checkpoint) => {
    const hasScores = canCalculateCheckpointScores(race, checkpoint);
    const requiredCheckpointSpeedKmh = hasScores
      ? calculateRequiredCheckpointSpeed(
          Number(checkpoint.distanceKm),
          Number(checkpoint.elapsedLimitMinutes),
        )
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
