import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

function raceEntry(overrides = {}) {
  const { event, race, edition, ...rest } = overrides;
  return {
    event: {
      id: 'fixture',
      slug: 'fixture',
      name: 'Fixture Trail',
      country: 'France',
      region: 'Test',
      city: 'Testville',
      ...event,
    },
    race: {
      id: 'fixture-race',
      name: 'Fixture Race',
      shortName: 'Fixture',
      ...race,
    },
    edition: {
      year: 2026,
      date: null,
      startTime: null,
      distanceKm: null,
      elevationGainM: null,
      elevationLossM: null,
      maxDurationMinutes: null,
      sources: [],
      registration: {},
      rules: null,
      aidStations: [],
      mandatoryEquipment: [],
      gpxUrl: null,
      gpx: null,
      illustration: null,
      checkpoints: [],
      ...edition,
    },
    quality: { status: 'partial', missingFields: [] },
    computed: null,
    ...rest,
  };
}

async function importRepositoryWithDataset(payload) {
  const root = await mkdtemp(path.join(tmpdir(), 'trailcompare-repository-'));
  const dataDir = path.join(root, '2026');
  await mkdir(dataDir, { recursive: true });
  await writeFile(path.join(dataDir, 'races.json'), JSON.stringify(payload), 'utf8');

  const previousDataRoot = process.env.TRAILCOMPARE_DATA_ROOT;
  process.env.TRAILCOMPARE_DATA_ROOT = root;
  const moduleUrl = new URL(`../src/repository.js?test=${Date.now()}-${Math.random()}`, import.meta.url);
  const repository = await import(moduleUrl.href);

  if (previousDataRoot === undefined) {
    delete process.env.TRAILCOMPARE_DATA_ROOT;
  } else {
    process.env.TRAILCOMPARE_DATA_ROOT = previousDataRoot;
  }

  return repository;
}

test('repository numeric normalization keeps missing values as null', async () => {
  const { listRaces } = await importRepositoryWithDataset({
    generatedAt: '2026-08-14T00:00:00.000Z',
    status: 'test',
    events: [],
    races: [
      raceEntry({
        edition: {
          distanceKm: '42',
          elevationGainM: '   ',
          elevationLossM: '',
          maxDurationMinutes: null,
          registration: {
            priceEur: '42',
          },
        },
      }),
    ],
  });

  const [race] = await listRaces();
  assert.equal(race.distanceKm, 42);
  assert.equal(race.elevationGainM, null);
  assert.equal(race.elevationLossM, null);
  assert.equal(race.timeLimitMinutes, null);
  assert.equal(race.registration.priceEur, 42);
  assert.equal(race.registration.maxParticipants, null);
});
