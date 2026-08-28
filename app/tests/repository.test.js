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

async function importRepositoryWithDataset(payload, { files = {} } = {}) {
  const root = await mkdtemp(path.join(tmpdir(), 'trailcompare-repository-'));
  const dataDir = path.join(root, '2026');
  await mkdir(dataDir, { recursive: true });
  await writeFile(path.join(dataDir, 'races.json'), JSON.stringify(payload), 'utf8');
  for (const [relativePath, contents] of Object.entries(files)) {
    const filePath = path.join(root, relativePath);
    await mkdir(path.dirname(filePath), { recursive: true });
    await writeFile(filePath, typeof contents === 'string' ? contents : JSON.stringify(contents), 'utf8');
  }

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

test('repository exposes cumulative checkpoint gain estimated dynamically from GPX with provenance', async () => {
  const routeAsset = {
    segments: [[
      { lat: 45, lon: 6, ele: 100, distanceKm: 0 },
      { lat: 45.1, lon: 6.1, ele: 102, distanceKm: 5 },
      { lat: 45.2, lon: 6.2, ele: 110, distanceKm: 10 },
      { lat: 45.3, lon: 6.3, ele: 106, distanceKm: 15 },
      { lat: 45.4, lon: 6.4, ele: 120, distanceKm: 20 },
    ]],
  };
  const { getRaceBySlug } = await importRepositoryWithDataset({
    generatedAt: '2026-08-14T00:00:00.000Z',
    status: 'test',
    events: [],
    races: [raceEntry({
      race: { id: 'gpx-checkpoints' },
      edition: {
        distanceKm: 20,
        elevationGainM: 50,
        gpx: { status: 'available', hasElevation: true, routeAsset: 'generated/routes/test.json' },
        checkpoints: [
          { name: 'Intermédiaire', distanceKm: 10.2, cutoffElapsedMinutes: 120 },
          { name: 'Arrivée', distanceKm: 20, cutoffElapsedMinutes: 240 },
        ],
      },
    })],
  }, { files: { 'generated/routes/test.json': routeAsset } });

  const race = await getRaceBySlug('gpx-checkpoints-2026');
  assert.equal(race.checkpoints[0].elevationGainFromStartM, 10);
  assert.equal(race.checkpoints[0].elevationGainFromStartSource, 'gpx_estimate');
  assert.equal(race.checkpoints[1].elevationGainFromStartM, 50);
  assert.equal(race.checkpoints[1].elevationGainFromStartSource, 'official_race_total');
});

test('repository exposes a stable slug and normalizes optional detail families with provenance', async () => {
  const { getRaceBySlug, listRaces } = await importRepositoryWithDataset({
    generatedAt: '2026-08-14T00:00:00.000Z',
    status: 'test',
    events: [],
    races: [
      raceEntry({
        race: { id: 'fixture-long-race' },
        edition: {
          terrainDescription: 'Original description',
          description: {
            original: 'Original description',
            originalLanguage: 'en',
            french: 'Description française',
            frenchValidated: true,
          },
          raceType: 'ultra',
          terrainType: 'mountain',
          nightStart: true,
          polesAllowed: false,
          program: [{ type: 'briefing', date: '2026-08-13', time: '18:00', location: 'Place du test' }],
          logistics: {
            access: 'Train puis navette',
            contacts: [
              { label: 'Organisation', value: 'contact@example.test', url: 'https://example.test/contact' },
              { label: 'Unsafe', url: 'javascript:alert(1)' },
            ],
          },
          registration: { priceEur: '49', status: 'open', url: 'https://example.test/register' },
          rules: { personalAssistanceAllowed: false, companionsAllowed: true, minimumWaterLiters: '1.5' },
          mandatoryEquipment: ['Veste imperméable'],
          aidStations: [{ name: 'Col', distanceKm: '12.5', lat: '45.5', lon: '6.5', water: true }],
          checkpoints: [{ name: 'Col', distanceKm: '12.5', cutoffElapsedMinutes: '180', lat: '999', lon: '6.5' }],
          sources: [
            { url: 'https://example.test/race', type: 'official-race-page', retrievedAt: '2026-08-14T10:00:00.000Z' },
            { url: 'https://example.test/register', type: 'official-registration', retrievedAt: '2026-08-14T11:00:00.000Z' },
            { url: 'https://example.test/rules', type: 'official-rules', retrievedAt: '2026-08-14T12:00:00.000Z' },
            { url: 'javascript:alert(1)', type: 'official-rules', retrievedAt: '2026-08-14T13:00:00.000Z' },
          ],
        },
      }),
    ],
  });

  const [summary] = await listRaces();
  assert.equal(summary.slug, 'fixture-long-race-2026');
  assert.equal(summary.raceType, 'ultra');
  assert.equal(summary.nightStart, true);

  const detail = await getRaceBySlug('fixture-long-race-2026');
  assert.equal(detail.description.french, 'Description française');
  assert.equal(detail.description.frenchValidated, true);
  assert.equal(detail.program[0].type, 'briefing');
  assert.equal(detail.logistics.access, 'Train puis navette');
  assert.equal(detail.logistics.contacts[1].url, null);
  assert.equal(detail.rules.minimumWaterLiters, 1.5);
  assert.equal(detail.mandatoryEquipment[0].name, 'Veste imperméable');
  assert.equal(detail.aidStations[0].latitude, 45.5);
  assert.equal(detail.checkpoints[0].latitude, null);
  assert.equal(detail.sourceFamilies.registration.length, 1);
  assert.equal(detail.sourceFamilies.rules.length, 1);
  assert.equal(detail.sourceFamilies.course.length, 1);
  assert.equal(detail.sources.length, 3);
  assert.equal(detail.verifiedAt, '2026-08-14T12:00:00.000Z');
  assert.equal(await getRaceBySlug('../fixture'), null);
});
