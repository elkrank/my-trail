import test from 'node:test';
import assert from 'node:assert/strict';
import {
  assessConfidence,
  calculateMinimumCheckpointPace,
  compareRunnerToRace,
  deriveVerdict,
  formatMinutesAsHoursMinutes,
} from '../public/profile-comparison.js';
import { STATUS } from '../public/profile-config.js';

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
