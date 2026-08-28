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

test('duration input combines separate hours and minutes', () => {
  assert.equal(parseDurationInput('2', '30'), 150);
  assert.equal(parseDurationInput('18', '30'), 1110);
  assert.equal(parseDurationInput('', ''), null);
  assert.equal(parseDurationInput('', '45'), 45);
  assert.equal(parseDurationInput('7', ''), 420);
});

test('duration input rejects invalid minute, negative, decimal and excessive values', () => {
  assert.equal(Number.isNaN(parseDurationInput('1', '60')), true);
  assert.equal(Number.isNaN(parseDurationInput('-1', '30')), true);
  assert.equal(Number.isNaN(parseDurationInput('1', '-1')), true);
  assert.equal(Number.isNaN(parseDurationInput('2.5', '0')), true);
  assert.equal(Number.isNaN(parseDurationInput('2,30', '')), true);
  assert.equal(Number.isNaN(parseDurationInput('2', '30.5')), true);
  assert.equal(parseDurationInput('336', '0'), 20160);
  assert.equal(Number.isNaN(parseDurationInput('336', '1')), true);
});

test('stored minutes are split into unrestricted hours and minute remainder', () => {
  assert.deepEqual(formatDurationInput(150), { hours: 2, minutes: 30 });
  assert.deepEqual(formatDurationInput(1110), { hours: 18, minutes: 30 });
  assert.deepEqual(formatDurationInput(1815), { hours: 30, minutes: 15 });
  assert.deepEqual(formatDurationInput(null), { hours: '', minutes: '' });
});

test('duration minutes persist and reload without loss', () => {
  const repository = createProfileRepository(storageStub());
  repository.save({
    training: { longRun: { durationMinutes: parseDurationInput('2', '30') } },
    performances: [{ type: 'trail', distanceKm: 50, durationMinutes: parseDurationInput('18', '30'), elevationGainM: 2000, date: '2026-06-01' }],
    experience: { longestEffortMinutes: parseDurationInput('30', '15') },
    goal: 'finish_cutoffs',
  }, { now });

  const loaded = repository.load();
  assert.equal(loaded.training.longRun.durationMinutes, 150);
  assert.equal(loaded.performances[0].durationMinutes, 1110);
  assert.equal(loaded.experience.longestEffortMinutes, 1815);
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
