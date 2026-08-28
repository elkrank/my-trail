import test from 'node:test';
import assert from 'node:assert/strict';
import {
  assessConfidence,
  calculateMinimumCheckpointPace,
  compareRunnerToRace,
  DATA_REASON,
  deriveVerdict,
  estimateTrailPerformance,
  formatMinutesAsHoursMinutes,
  getPastEditionInfo,
} from '../public/profile-comparison.js';
import { COMPARISON_THRESHOLDS, STATUS } from '../public/profile-config.js';
import { getRaceBySlug } from '../src/repository.js';

const now = new Date('2026-08-21T10:00:00Z');
const profile = {
  version: 1,
  updatedAt: '2026-08-20T10:00:00Z',
  training: {
    weeklyDistanceKm: 70, weeklyElevationGainM: 2500, weeklyHours: 9, weeklySessions: 5,
    longRun: { distanceKm: 45, durationMinutes: 390, elevationGainM: 2100, date: '2026-08-01' },
  },
  performances: [{ id: 'ref', type: 'trail', distanceKm: 50, durationMinutes: 450, elevationGainM: 2500, date: '2026-06-01', name: 'Trail test' }],
  experience: { longestCompletedDistanceKm: 80, longestEffortMinutes: 720, maximumElevationGainM: 3500, technicalLevel: 'confirmed', nightExperience: 'regular', autonomyExperience: 'regular' },
  goal: 'finish_cutoffs',
};

const completeRace = {
  name: 'Trail complet', date: '2026-10-10', startTime: '06:00', distanceKm: 80, elevationGainM: 4000,
  technicalScore: 3, nightStart: false, quality: { status: 'complete' },
  aidStations: [{ distanceKm: 15 }, { distanceKm: 32 }, { distanceKm: 52 }, { distanceKm: 68 }],
  checkpoints: [
    { name: 'Col', distanceKm: 40, elevationGainFromStartM: 1900, elapsedLimitMinutes: 480 },
    { name: 'Arrivée', distanceKm: 80, elevationGainFromStartM: 4000, elapsedLimitMinutes: 960 },
  ],
};

test('calculates the minimum cutoff pace and formats margins as hours and minutes', () => {
  const pace = calculateMinimumCheckpointPace(40, 480);
  assert.equal(pace.minutesPerKm, 12);
  assert.equal(pace.speedKmh, 5);
  assert.equal(formatMinutesAsHoursMinutes(95, { signed: true }), '+1 h 35');
  assert.equal(formatMinutesAsHoursMinutes(-75, { signed: true }), '−1 h 15');
});

test('compares a profile against a complete race on five explicit axes', () => {
  const result = compareRunnerToRace(profile, completeRace, now);
  assert.equal(result.axes.length, 5);
  assert.equal(result.axes.find((axis) => axis.id === 'barriers').barriers.length, 2);
  assert.notEqual(result.verdict, 'insufficient_data');
});

test('keeps partial course data visible and refuses unsupported passage estimates', () => {
  const partial = { ...completeRace, elevationGainM: null, technicalScore: null, aidStations: [], checkpoints: [{ name: 'Village', distanceKm: 20, elapsedLimitMinutes: 240, elevationGainFromStartM: null }], quality: { status: 'partial' } };
  const result = compareRunnerToRace({ ...profile, performances: [] }, partial, now);
  const barrier = result.axes.find((axis) => axis.id === 'barriers').barriers[0];
  assert.equal(barrier.requiredMinutesPerKm, 12);
  assert.equal(barrier.estimatedElapsedMinutes, null);
  assert.equal(barrier.status, STATUS.INSUFFICIENT);
  assert.notEqual(result.confidence.level, 'high');
});

test('does not estimate a trail passage from a road performance', () => {
  const roadOnly = { ...profile, performances: [{ type: 'marathon', distanceKm: 42.195, durationMinutes: 210, date: '2026-07-01' }] };
  const barrier = compareRunnerToRace(roadOnly, completeRace, now).axes.find((axis) => axis.id === 'barriers').barriers[0];
  assert.equal(barrier.estimatedTime, null);
});

test('detects a critical gap and never lets good axes mask it', () => {
  const axes = [
    { status: STATUS.VALIDATED }, { status: STATUS.VALIDATED }, { status: STATUS.VALIDATED },
    { status: STATUS.CRITICAL }, { status: STATUS.VALIDATED },
  ];
  assert.equal(deriveVerdict(axes), 'preparation_insufficient');

  const underprepared = {
    ...profile,
    training: { ...profile.training, weeklyDistanceKm: 5, longRun: { ...profile.training.longRun, distanceKm: 5, elevationGainM: 100 } },
    experience: { ...profile.experience, longestCompletedDistanceKm: 10 },
  };
  const result = compareRunnerToRace(underprepared, completeRace, now);
  assert.equal(result.axes.find((axis) => axis.id === 'endurance').status, STATUS.CRITICAL);
  assert.equal(result.verdict, 'preparation_insufficient');
});

test('confidence reflects profile freshness and course data quality', () => {
  assert.equal(assessConfidence(profile, completeRace, now).level, 'high');
  const sparse = { version: 1, updatedAt: '2024-01-01', training: { longRun: {} }, performances: [], experience: {}, goal: 'finish_cutoffs' };
  assert.equal(assessConfidence(sparse, { distanceKm: 20, elevationGainM: null, checkpoints: [], aidStations: [], quality: { status: 'invalid' } }, now).level, 'low');
});

test('keeps the existing trail-reference comparability and fatigue thresholds', () => {
  const target = { distanceKm: 115, elevationGainM: 2150 };
  const base = { ...profile, performances: [{ type: 'trail', durationMinutes: 510, date: '2026-06-01' }] };
  const tooFar = estimateTrailPerformance({
    ...base,
    performances: [{ ...base.performances[0], distanceKm: 42, elevationGainM: 1200 }],
  }, target, now);
  assert.equal(tooFar, null);

  const comparable = estimateTrailPerformance({
    ...base,
    performances: [{ ...base.performances[0], distanceKm: 60, elevationGainM: 1500 }],
  }, target, now);
  assert.ok(comparable);
  assert.equal(comparable.referenceKmEffort, 75);
  assert.equal(comparable.raceKmEffort, 136.5);
  assert.equal(COMPARISON_THRESHOLDS.estimation.minimumKmEffortRatio, 0.5);
  assert.equal(COMPARISON_THRESHOLDS.estimation.maximumKmEffortRatio, 2);
  assert.equal(COMPARISON_THRESHOLDS.estimation.fatigueExponent, 0.08);
  assert.ok(Math.abs(comparable.minutesPerKmEffort - (510 / 75) * (136.5 / 75) ** 0.08) < 1e-12);
});

test('barrier guidance distinguishes a missing reference from missing checkpoint elevation gain', () => {
  const checkpointsWithoutGain = {
    ...completeRace,
    distanceKm: 60,
    elevationGainM: 3000,
    checkpoints: [{ name: 'Village', distanceKm: 30, elapsedLimitMinutes: 420 }],
  };
  const noReference = compareRunnerToRace({ ...profile, performances: [] }, checkpointsWithoutGain, now)
    .axes.find((axis) => axis.id === 'barriers');
  assert.match(noReference.explanation, /Aucune référence trail récente et suffisamment comparable/);
  assert.equal(noReference.recommendation, 'Ajouter une référence trail récente avec distance, durée et D+.');
  assert.equal(noReference.barriers[0].missingReason, 'missing_comparable_trail_reference');

  const withReference = compareRunnerToRace(profile, checkpointsWithoutGain, now)
    .axes.find((axis) => axis.id === 'barriers');
  assert.equal(withReference.status, STATUS.INSUFFICIENT);
  assert.match(withReference.explanation, /D\+ cumulé aux points de contrôle manque/);
  assert.doesNotMatch(withReference.explanation, /Les passages sont estimés depuis/);
  assert.equal(withReference.recommendation, 'Compléter le D+ cumulé des points de contrôle, idéalement à partir du GPX.');
  assert.doesNotMatch(withReference.recommendation, /référence trail/i);
  assert.equal(withReference.barriers[0].missingReason, 'missing_checkpoint_elevation_gain');
});

test('barrier axis stays insufficient for partial checkpoints and uses the worst status when all are usable', () => {
  const partialRace = {
    ...completeRace,
    checkpoints: [
      completeRace.checkpoints[0],
      { name: 'Incomplete', distanceKm: 60, elapsedLimitMinutes: 700 },
      { name: 'Arrivée', distanceKm: 80, elapsedLimitMinutes: 960 },
    ],
  };
  const partial = compareRunnerToRace(profile, partialRace, now).axes.find((axis) => axis.id === 'barriers');
  assert.equal(partial.status, STATUS.INSUFFICIENT);
  assert.notEqual(partial.barriers[0].estimatedElapsedMinutes, null);
  assert.equal(partial.barriers[1].missingReason, 'missing_checkpoint_elevation_gain');
  assert.notEqual(partial.barriers[2].estimatedElapsedMinutes, null);
  assert.equal(partial.barriers[2].elevationGainFromStartM, completeRace.elevationGainM);
  assert.equal(partial.barriers[2].elevationGainFromStartSource, 'official_race_total');

  const complete = compareRunnerToRace(profile, completeRace, now).axes.find((axis) => axis.id === 'barriers');
  assert.notEqual(complete.status, STATUS.INSUFFICIENT);
  assert.equal(complete.barriers.every((barrier) => barrier.estimatedElapsedMinutes !== null && barrier.marginMinutes !== null), true);
  assert.match(complete.explanation, /Les passages sont estimés depuis une référence trail récente et comparable/);
});

test('two insufficient axes cap confidence without changing the general verdict', () => {
  const ntmfProfile = {
    ...profile,
    training: { weeklyDistanceKm: 50, weeklyElevationGainM: 1000, weeklyHours: 6, weeklySessions: 4, longRun: { distanceKm: 30, elevationGainM: 800, durationMinutes: 210, date: '2026-08-01' } },
    performances: [{ type: 'trail', distanceKm: 60, elevationGainM: 1500, durationMinutes: 510, date: '2026-06-01', name: 'Référence 60 km' }],
    experience: { longestCompletedDistanceKm: 60, longestEffortMinutes: 600, maximumElevationGainM: 2500, technicalLevel: 'comfortable', nightExperience: 'some', autonomyExperience: 'regular' },
  };
  const ntmfRace = {
    date: '2026-04-19', startTime: '06:00', distanceKm: 115, elevationGainM: 2150,
    checkpoints: [
      { name: 'Boescheppe', distanceKm: 74.5, elapsedLimitMinutes: 660 },
      { name: 'Cosmos', distanceKm: 85, elevationGainFromStartM: 1366, elevationGainFromStartSource: 'gpx_estimate', elapsedLimitMinutes: 780 },
    ],
    technicalScore: null, nightStart: false, aidStations: [], quality: { status: 'complete' },
  };
  const result = compareRunnerToRace(ntmfProfile, ntmfRace, now);
  assert.equal(result.verdict, 'ambitious_coherent');
  assert.equal(result.axes.find((axis) => axis.id === 'endurance').status, STATUS.IMPORTANT_GAP);
  assert.equal(result.axes.find((axis) => axis.id === 'elevation').status, STATUS.VALIDATED);
  assert.equal(result.axes.find((axis) => axis.id === 'long_experience').status, STATUS.CONSOLIDATE);
  assert.equal(result.axes.filter((axis) => axis.status === STATUS.INSUFFICIENT).length, 2);
  assert.equal(result.confidence.rawLevel, 'high');
  assert.equal(result.confidence.level, 'medium');
  assert.match(result.confidence.reasons[0], /barrières horaires et la technicité/);

  const oneInsufficientRace = {
    ...ntmfRace,
    checkpoints: [{ name: 'Arrivée', distanceKm: 115, elapsedLimitMinutes: 1110 }],
  };
  const oneInsufficient = compareRunnerToRace(ntmfProfile, oneInsufficientRace, now);
  assert.equal(oneInsufficient.axes.filter((axis) => axis.status === STATUS.INSUFFICIENT).length, 1);
  assert.equal(oneInsufficient.confidence.level, 'high');
});

test('past-edition detection is injectable and ignores future, missing, or invalid dates', () => {
  const current = new Date('2026-08-28T12:00:00+02:00');
  assert.deepEqual(getPastEditionInfo('2026-04-19', current), { year: 2026, date: '2026-04-19' });
  assert.equal(getPastEditionInfo('2026-10-01', current), null);
  assert.equal(getPastEditionInfo(null, current), null);
  assert.equal(getPastEditionInfo('not-a-date', current), null);
  assert.equal(getPastEditionInfo('2026-02-30', current), null);
});

test('exposes the complete insufficient-data reason matrix including GPX provenance', () => {
  const noReference = compareRunnerToRace({ ...profile, performances: [] }, completeRace, now)
    .axes.find((axis) => axis.id === 'barriers').barriers[0];
  assert.equal(noReference.reasonCode, DATA_REASON.NO_COMPARABLE_TRAIL_REFERENCE);

  const raceElevationMissing = compareRunnerToRace(profile, {
    ...completeRace,
    elevationGainM: null,
    checkpoints: [{ name: 'Lyon', distanceKm: 82, elapsedLimitMinutes: 990 }],
  }, now).axes.find((axis) => axis.id === 'barriers');
  assert.equal(raceElevationMissing.barriers[0].reasonCode, DATA_REASON.RACE_ELEVATION_MISSING);
  assert.match(raceElevationMissing.explanation, /D\+ total officiel de la course manque/);
  assert.doesNotMatch(raceElevationMissing.explanation, /Aucune référence trail/);

  const checkpointElevationMissing = compareRunnerToRace(profile, {
    ...completeRace,
    checkpoints: [{ name: 'Village', distanceKm: 30, elapsedLimitMinutes: 420 }],
  }, now).axes.find((axis) => axis.id === 'barriers').barriers[0];
  assert.equal(checkpointElevationMissing.reasonCode, DATA_REASON.CHECKPOINT_ELEVATION_MISSING);

  const gpxEstimate = compareRunnerToRace(profile, {
    ...completeRace,
    checkpoints: [{ name: 'Village', distanceKm: 30, elevationGainFromStartM: 1400, elevationGainFromStartSource: 'gpx_estimate', elapsedLimitMinutes: 420 }],
  }, now).axes.find((axis) => axis.id === 'barriers').barriers[0];
  assert.equal(gpxEstimate.reasonCode, DATA_REASON.GPX_ESTIMATE);
  assert.notEqual(gpxEstimate.estimatedElapsedMinutes, null);
});

test('SaintéLyon keeps a present 60 km trail reference and reports the missing race D+', () => {
  const saintelyonProfile = {
    ...profile,
    performances: [{ id: 'saintelyon-ref', type: 'trail', distanceKm: 60, durationMinutes: 510, elevationGainM: 1500, date: '2026-06-01', name: 'Référence trail 60 km' }],
  };
  const saintelyon = {
    name: 'SaintéLyon', date: '2026-11-28', startTime: '23:30', distanceKm: 82,
    nominalDistanceKm: 80, effectiveDistanceKm: 82, elevationGainM: null,
    checkpoints: [{ name: 'Lyon', distanceKm: 82, elapsedLimitMinutes: 990 }],
    aidStations: [], technicalScore: null, nightStart: true, quality: { status: 'partial' },
  };
  const result = compareRunnerToRace(saintelyonProfile, saintelyon, now);
  const barriers = result.axes.find((axis) => axis.id === 'barriers');
  assert.equal(barriers.barriers[0].reasonCode, DATA_REASON.RACE_ELEVATION_MISSING);
  assert.equal(barriers.current, 'Référence trail présente · D+ course manquant');
  assert.doesNotMatch(barriers.explanation, /Aucune référence comparable|Aucune référence trail/);
});

test('NTMF 115 km keeps GPX gains, estimated passages, margins and verdict unchanged', async () => {
  const race = await getRaceBySlug('ntmf-115-km-2026');
  const ntmfProfile = {
    ...profile,
    training: { weeklyDistanceKm: 50, weeklyElevationGainM: 1000, weeklyHours: 6, weeklySessions: 4, longRun: { distanceKm: 30, elevationGainM: 800, durationMinutes: 210, date: '2026-08-01' } },
    performances: [{ type: 'trail', distanceKm: 60, elevationGainM: 1500, durationMinutes: 510, date: '2026-06-01', name: 'Référence 60 km' }],
    experience: { longestCompletedDistanceKm: 60, longestEffortMinutes: 600, maximumElevationGainM: 2500, technicalLevel: 'comfortable', nightExperience: 'some', autonomyExperience: 'regular' },
  };
  const result = compareRunnerToRace(ntmfProfile, race, now);
  const barriers = result.axes.find((axis) => axis.id === 'barriers').barriers;
  assert.deepEqual(barriers.slice(0, 3).map((item) => item.elevationGainFromStartM), [1170, 1366, 1590]);
  assert.equal(barriers[3].elevationGainFromStartM, 2150);
  assert.equal(barriers[3].elevationGainFromStartSource, 'official_race_total');
  assert.deepEqual(barriers.map((item) => item.estimatedTime.hour), ['12:14', '13:44', '15:32', '18:13']);
  assert.deepEqual(barriers.map((item) => Math.round(item.marginMinutes)), [45, 96, 107, 136]);
  assert.equal(result.verdict, 'ambitious_coherent');
});
