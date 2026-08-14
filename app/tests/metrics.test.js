import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DIFFICULTY_V1_ANCHORS,
  calculateElevationDensity,
  calculateKmEffort,
  calculateRequiredAverageSpeed,
  calculateRequiredCheckpointSpeed,
  classifyVerticalityLevel,
  enrichRaceWithScores,
  estimateBarrierPressureScoreV0,
  estimateDifficultyScoreV0,
  estimateDifficultyScoreV1,
  estimateDifficultyScoreV1FromKmEffort,
  findCriticalBarrier,
} from '../src/metrics.js';

const race = {
  distanceKm: 100,
  elevationGainM: 3000,
  timeLimitMinutes: 1200,
};

test('calculateKmEffort adds distance and elevation divided by 100', () => {
  assert.equal(calculateKmEffort(115, 2800), 143);
});

test('calculateRequiredAverageSpeed returns the minimum global speed', () => {
  assert.equal(calculateRequiredAverageSpeed(100, 1200), 5);
});

test('calculateRequiredCheckpointSpeed returns the speed to reach a checkpoint', () => {
  assert.equal(calculateRequiredCheckpointSpeed(50, 600), 5);
});

test('estimateDifficultyScoreV0 returns a bounded estimation', () => {
  const score = estimateDifficultyScoreV0(race);
  assert.equal(Number.isInteger(score), true);
  assert.equal(score >= 0 && score <= 100, true);
});

test('estimateDifficultyScoreV0 increases for a harder race', () => {
  const easier = estimateDifficultyScoreV0({
    distanceKm: 40,
    elevationGainM: 800,
    timeLimitMinutes: 600,
  });
  const harder = estimateDifficultyScoreV0({
    distanceKm: 110,
    elevationGainM: 5200,
    timeLimitMinutes: 1320,
  });
  assert.equal(harder > easier, true);
});

test('estimateDifficultyScoreV1 returns exact anchor scores', () => {
  for (const anchor of DIFFICULTY_V1_ANCHORS) {
    assert.equal(estimateDifficultyScoreV1FromKmEffort(anchor.kmEffort), anchor.score);
  }
});

test('estimateDifficultyScoreV1 interpolates linearly between anchors', () => {
  assert.equal(estimateDifficultyScoreV1FromKmEffort(35), 28);
});

test('estimateDifficultyScoreV1 depends on physical volume, not time limit', () => {
  const baseRace = { distanceKm: 100, elevationGainM: 4000 };
  assert.equal(estimateDifficultyScoreV1({ ...baseRace, timeLimitMinutes: 1200 }), 71);
  assert.equal(estimateDifficultyScoreV1({ ...baseRace, timeLimitMinutes: 1800 }), 71);
  assert.equal(estimateDifficultyScoreV1(baseRace), 71);
});

test('enrichRaceWithScores exposes V1 as the main difficulty score', () => {
  const enriched = enrichRaceWithScores({ distanceKm: 100, elevationGainM: 4000 });
  assert.equal(enriched.kmEffort, 140);
  assert.equal(enriched.difficultyScoreV0, null);
  assert.equal(enriched.difficultyScoreV1, 71);
  assert.equal(enriched.difficultyScore, 71);
  assert.equal(enriched.difficultyScoreVersion, 'v1');
  assert.equal(enriched.barrierPressureScoreV0, null);
  assert.equal(enriched.criticalBarrier, null);
});

test('estimateDifficultyScoreV1 is monotonic for distance and elevation gain', () => {
  const shorter = estimateDifficultyScoreV1({ distanceKm: 60, elevationGainM: 1000 });
  const longer = estimateDifficultyScoreV1({ distanceKm: 80, elevationGainM: 1000 });
  const lower = estimateDifficultyScoreV1({ distanceKm: 60, elevationGainM: 1000 });
  const higher = estimateDifficultyScoreV1({ distanceKm: 60, elevationGainM: 3000 });

  assert.equal(longer >= shorter, true);
  assert.equal(higher >= lower, true);
});

test('estimateDifficultyScoreV1 does not saturate long races prematurely', () => {
  const ptl = estimateDifficultyScoreV1({ distanceKm: 300, elevationGainM: 25000 });
  const utmb = estimateDifficultyScoreV1({ distanceKm: 174, elevationGainM: 9900 });
  assert.equal(ptl > utmb, true);
});

test('estimateDifficultyScoreV1 matches reference races approximately', () => {
  const references = [
    ['PTL', { distanceKm: 300, elevationGainM: 25000 }, 100],
    ['Diagonale des Fous', { distanceKm: 175, elevationGainM: 10700 }, 93],
    ['UTMB', { distanceKm: 174, elevationGainM: 9900 }, 92],
    ['TDS', { distanceKm: 148, elevationGainM: 9200 }, 88],
    ['CCC', { distanceKm: 101, elevationGainM: 6050 }, 76],
    ['NTMF 115 km', { distanceKm: 115, elevationGainM: 2150 }, 70],
    ['Grand Trail des Templiers', { distanceKm: 80.43, elevationGainM: 3470 }, 65],
    ['OCC', { distanceKm: 57, elevationGainM: 3500 }, 58],
    ['NTMF 80 km', { distanceKm: 80, elevationGainM: 1450 }, 58],
    ['EcoTrail 80 km', { distanceKm: 80, elevationGainM: 1100 }, 56],
  ];

  for (const [name, referenceRace, expected] of references) {
    const score = estimateDifficultyScoreV1(referenceRace);
    assert.equal(Math.abs(score - expected) <= 2, true, `${name}: expected about ${expected}, got ${score}`);
  }
});

test('estimateDifficultyScoreV1 keeps missing or invalid physical data unavailable', () => {
  assert.equal(estimateDifficultyScoreV1({ elevationGainM: 1000 }), null);
  assert.equal(estimateDifficultyScoreV1({ distanceKm: 10 }), null);
  assert.equal(estimateDifficultyScoreV1({ distanceKm: 10, elevationGainM: 0 }), 8);
  assert.equal(estimateDifficultyScoreV1({ distanceKm: -10, elevationGainM: 1000 }), null);
  assert.equal(estimateDifficultyScoreV1({ distanceKm: 10, elevationGainM: -1 }), null);
  assert.equal(estimateDifficultyScoreV1FromKmEffort(''), null);
});

test('verticality density and levels are calculated independently', () => {
  assert.equal(calculateElevationDensity(42, 1000), 23.8);
  assert.equal(classifyVerticalityLevel(14.9), 'rolling');
  assert.equal(classifyVerticalityLevel(15), 'hilly');
  assert.equal(classifyVerticalityLevel(29.9), 'hilly');
  assert.equal(classifyVerticalityLevel(30), 'mountainous');
  assert.equal(classifyVerticalityLevel(49.9), 'mountainous');
  assert.equal(classifyVerticalityLevel(50), 'very_mountainous');
  assert.equal(classifyVerticalityLevel(69.9), 'very_mountainous');
  assert.equal(classifyVerticalityLevel(70), 'extreme');
  assert.equal(classifyVerticalityLevel(null), null);
});

test('estimateBarrierPressureScoreV0 is 50 when checkpoint speed matches global speed', () => {
  assert.equal(
    estimateBarrierPressureScoreV0(race, { distanceKm: 50, elapsedLimitMinutes: 600 }),
    50,
  );
});

test('estimateBarrierPressureScoreV0 increases when checkpoint requires more speed', () => {
  assert.equal(
    estimateBarrierPressureScoreV0(race, { distanceKm: 50, elapsedLimitMinutes: 480 }),
    75,
  );
});

test('findCriticalBarrier returns the highest pressure checkpoint', () => {
  const critical = findCriticalBarrier(race, [
    { id: 1, name: 'Easy', distanceKm: 50, elapsedLimitMinutes: 650 },
    { id: 2, name: 'Hard', distanceKm: 50, elapsedLimitMinutes: 480 },
  ]);
  assert.equal(critical.name, 'Hard');
  assert.equal(critical.barrierPressureScoreV0, 75);
});

test('findCriticalBarrier returns null without checkpoints', () => {
  assert.equal(findCriticalBarrier(race, []), null);
});

test('invalid distances are rejected', () => {
  assert.throws(() => calculateKmEffort(0, 1000), /distanceKm/);
  assert.throws(() => calculateRequiredAverageSpeed(-1, 100), /distanceKm/);
});

test('invalid elevation is rejected', () => {
  assert.throws(() => calculateKmEffort(10, -1), /elevationGainM/);
});

test('invalid time limits are rejected', () => {
  assert.throws(() => calculateRequiredAverageSpeed(10, 0), /timeLimitMinutes/);
  assert.throws(() => calculateRequiredCheckpointSpeed(10, 0), /elapsedLimitMinutes/);
});

test('checkpoint after race distance is rejected', () => {
  assert.throws(
    () => estimateBarrierPressureScoreV0(race, { distanceKm: 101, elapsedLimitMinutes: 600 }),
    /checkpointDistanceKm/,
  );
});

test('checkpoint after race time limit is rejected', () => {
  assert.throws(
    () => estimateBarrierPressureScoreV0(race, { distanceKm: 90, elapsedLimitMinutes: 1300 }),
    /elapsed limit/,
  );
});
