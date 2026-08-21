import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createProfileRepository,
  formatDurationInput,
  normalizeProfile,
  parseDurationInput,
  ProfileValidationError,
} from '../public/profile-repository.js';

function storageStub() {
  const values = new Map();
  return {
    getItem(key) { return values.get(key) ?? null; },
    setItem(key, value) { values.set(key, value); },
    removeItem(key) { values.delete(key); },
  };
}

const now = new Date('2026-08-21T10:00:00Z');

test('creates and normalizes a partially completed profile without performance', () => {
  const profile = normalizeProfile({
    training: { weeklyDistanceKm: '42', weeklyElevationGainM: '', longRun: {} },
    experience: { technicalLevel: 'comfortable' },
    performances: [],
    goal: 'finish_cutoffs',
  }, { now });

  assert.equal(profile.version, 1);
  assert.equal(profile.training.weeklyDistanceKm, 42);
  assert.equal(profile.training.weeklyElevationGainM, null);
  assert.deepEqual(profile.performances, []);
  assert.equal(profile.experience.technicalLevel, 'comfortable');
});

test('persists, reloads and modifies the versioned profile', () => {
  const repository = createProfileRepository(storageStub());
  const created = repository.save({
    training: { weeklyDistanceKm: 35, longRun: {} },
    experience: {}, performances: [], goal: 'finish_cutoffs',
  }, { now });
  assert.equal(repository.load().training.weeklyDistanceKm, 35);

  repository.save({ ...created, training: { ...created.training, weeklyDistanceKm: 48 } }, { now: new Date('2026-08-22T10:00:00Z') });
  assert.equal(repository.load().training.weeklyDistanceKm, 48);
});

test('accepts a profile with no chronometer reference and validates an added trail reference', () => {
  const profile = normalizeProfile({
    training: { longRun: {} }, experience: {}, goal: 'finish_comfortably',
    performances: [{ id: 'trail-1', type: 'trail', distanceKm: 50, durationMinutes: 420, elevationGainM: 2200, date: '2026-06-01', name: '' }],
  }, { now });
  assert.equal(profile.performances[0].name, null);
  assert.equal(profile.performances[0].durationMinutes, 420);
});

test('rejects future dates, invalid durations and a missing goal', () => {
  assert.throws(() => normalizeProfile({
    training: { longRun: { durationMinutes: NaN, date: '2027-01-01' } }, experience: {}, performances: [], goal: null,
  }, { now }), (error) => Boolean(error instanceof ProfileValidationError && error.errors.goal && error.errors['training.longRun.durationMinutes']));
});

test('duration input supports decimal hours and h:mm:ss', () => {
  assert.equal(parseDurationInput('2,5'), 150);
  assert.equal(parseDurationInput('1:30:30'), 90.5);
  assert.equal(Number.isNaN(parseDurationInput('1:70')), true);
  assert.equal(formatDurationInput(null), '');
});

test('corrupted and unknown stored versions are ignored', () => {
  const storage = storageStub();
  storage.setItem('trailcompare:runner-profile:v1', '{broken');
  assert.equal(createProfileRepository(storage).load(), null);
  storage.setItem('trailcompare:runner-profile:v1', JSON.stringify({ version: 99 }));
  assert.equal(createProfileRepository(storage).load(), null);
});

test('reports unavailable storage instead of pretending the profile was persisted', () => {
  assert.throws(() => createProfileRepository(null).save({ training: { longRun: {} }, experience: {}, performances: [], goal: 'finish_cutoffs' }, { now }), /storage unavailable/i);
});
