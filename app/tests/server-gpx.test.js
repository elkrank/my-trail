import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

process.env.NODE_ENV = 'test';
const __dirname = dirname(fileURLToPath(import.meta.url));
process.env.TRAILCOMPARE_DATA_ROOT = join(__dirname, 'fixtures', 'server-data');
const { app } = await import('../src/server.js');

async function request(path) {
  const server = createServer(app);
  await new Promise((resolve) => server.listen(0, resolve));
  const { port } = server.address();

  try {
    const response = await fetch(`http://127.0.0.1:${port}${path}`);
    return {
      status: response.status,
      headers: response.headers,
      body: await response.json(),
    };
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

async function requestRaw(path) {
  const server = createServer(app);
  await new Promise((resolve) => server.listen(0, resolve));
  const { port } = server.address();

  try {
    const response = await fetch(`http://127.0.0.1:${port}${path}`);
    return {
      status: response.status,
      headers: response.headers,
      text: await response.text(),
    };
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

test('gpx endpoint serves generated local route assets without external fetches', async () => {
  const previousFetch = globalThis.fetch;
  globalThis.fetch = async (url, options) => {
    if (String(url).startsWith('http://127.0.0.1')) {
      return previousFetch(url, options);
    }

    throw new Error(`Unexpected external fetch: ${url}`);
  };

  try {
    const response = await request('/api/races/1/gpx');

    assert.equal(response.status, 200);
    assert.equal(response.body.points.length, 3);
    assert.equal(response.body.segments.length, 1);
    assert.equal(response.body.elevationProfile.length, 3);
    assert.equal(response.body.points[0].distanceKm, 0);
    assert.equal(response.body.points[1].ele, 120);
    assert.equal(response.body.computed.distanceKm, 1.82);
    assert.equal(response.body.elevationQuality.status, 'consistent');
    assert.equal(response.body.elevationQuality.officialGainM, 20);
    assert.equal(response.body.elevationQuality.computedGainM, 20);
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test('races endpoint exposes event and start finish locations for explorer filters', async () => {
  const response = await request('/api/races');

  assert.equal(response.status, 200);
  assert.equal(response.body.races.length, 4);
  assert.equal(response.body.races[0].event.region, 'Test');
  assert.equal(response.body.races[0].event.city, 'Test');
  assert.equal(response.body.races[0].startLocation, 'Start');
  assert.equal(response.body.races[0].finishLocation, 'Finish');
  assert.equal(response.body.races[0].illustration.url, 'https://example.test/images/valid-gpx.jpg');
  assert.equal(response.body.races[0].illustration.alt, 'Fixture Trail - Valid GPX');
  assert.equal(response.body.races[0].registration.url, 'https://example.test/register');
  assert.equal(response.body.races[0].gpx.elevationQuality.status, 'consistent');
  assert.equal(response.body.races[3].registration.url, null);
});

test('compare endpoint exposes difficulty V1 contract while keeping barrier V0', async () => {
  const response = await request('/api/compare?raceA=1&raceB=2');

  assert.equal(response.status, 200);
  assert.equal(response.body.raceA.kmEffort, 2.2);
  assert.equal(response.body.raceA.difficultyScoreV1, 2);
  assert.equal(response.body.raceA.difficultyScore, 2);
  assert.equal(response.body.raceA.difficultyScoreVersion, 'v1');
  assert.equal(response.body.raceA.elevationDensityMPerKm, 10);
  assert.equal(response.body.raceA.verticalityLevel, 'rolling');
  assert.equal(response.body.raceA.barrierPressureScoreV0, 50);
  assert.equal(response.body.raceB.difficultyScore, response.body.raceB.difficultyScoreV1);
});

test('gpx endpoint returns a clean empty-data error when a race has no gpx', async () => {
  const response = await request('/api/races/2/gpx');

  assert.equal(response.status, 404);
  assert.equal(response.body.error, 'GPX not available');
});

test('gpx download endpoint serves the original local GPX as an attachment', async () => {
  const response = await requestRaw('/api/races/1/gpx/download');

  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-type'), /application\/gpx\+xml/);
  assert.match(response.headers.get('content-disposition'), /attachment; filename="fixture-valid-gpx-2026\.gpx"/);
  assert.match(response.text, /<gpx version="1\.1"/);
});

test('gpx download endpoint returns 404 when a race has no gpx', async () => {
  const response = await request('/api/races/2/gpx/download');

  assert.equal(response.status, 404);
  assert.equal(response.body.error, 'GPX not available');
});

test('gpx download endpoint returns 404 when the local asset is missing', async () => {
  const response = await request('/api/races/3/gpx/download');

  assert.equal(response.status, 404);
  assert.equal(response.body.error, 'GPX file not available');
});

test('gpx endpoints reject paths outside the data root', async () => {
  const assetResponse = await request('/api/races/4/gpx');
  const downloadResponse = await request('/api/races/4/gpx/download');

  assert.equal(assetResponse.status, 404);
  assert.equal(assetResponse.body.error, 'GPX asset not available');
  assert.equal(downloadResponse.status, 404);
  assert.equal(downloadResponse.body.error, 'GPX file not available');
});

test('seo endpoints expose robots and optional sitemap without inventing a public URL', async () => {
  delete process.env.PUBLIC_BASE_URL;
  const robots = await requestRaw('/robots.txt');
  const sitemapAbsent = await requestRaw('/sitemap.xml');

  assert.equal(robots.status, 200);
  assert.match(robots.text, /User-agent: \*/);
  assert.doesNotMatch(robots.text, /Sitemap:/);
  assert.equal(sitemapAbsent.status, 404);

  process.env.PUBLIC_BASE_URL = 'https://trailcompare.example/';
  const index = await requestRaw('/');
  const robotsWithSitemap = await requestRaw('/robots.txt');
  const sitemap = await requestRaw('/sitemap.xml');

  assert.match(index.text, /<link rel="canonical" href="https:\/\/trailcompare\.example">/);
  assert.match(robotsWithSitemap.text, /Sitemap: https:\/\/trailcompare\.example\/sitemap\.xml/);
  assert.equal(sitemap.status, 200);
  assert.match(sitemap.text, /<loc>https:\/\/trailcompare\.example<\/loc>/);
  delete process.env.PUBLIC_BASE_URL;
});

test('Leaflet assets are served locally and public pages do not depend on the unpkg CDN', async () => {
  const css = await requestRaw('/vendor/leaflet-1.9.4/leaflet.css');
  const script = await requestRaw('/vendor/leaflet-1.9.4/leaflet.js');
  const index = await requestRaw('/');
  const appScript = await requestRaw('/app.js');

  assert.equal(css.status, 200);
  assert.match(css.headers.get('content-type'), /text\/css/);
  assert.match(css.text, /\.leaflet-container/);
  assert.equal(script.status, 200);
  assert.match(script.headers.get('content-type'), /javascript/);
  assert.match(script.text, /Leaflet 1\.9\.4/);
  assert.match(index.text, /href="\/vendor\/leaflet-1\.9\.4\/leaflet\.css"/);
  assert.match(appScript.text, /\/vendor\/leaflet-1\.9\.4\/leaflet\.js/);
  assert.doesNotMatch(index.text, /unpkg\.com/);
  assert.doesNotMatch(appScript.text, /unpkg\.com/);
});

test('slug endpoint exposes the enriched detail contract and rejects unknown slugs', async () => {
  const response = await request('/api/races/slug/fixture-valid-2026');
  const missing = await request('/api/races/slug/fixture-unknown-2026');

  assert.equal(response.status, 200);
  assert.equal(response.body.race.slug, 'fixture-valid-2026');
  assert.equal(response.body.race.raceType, 'trail');
  assert.equal(response.body.race.rules.personalAssistanceAllowed, false);
  assert.equal(response.body.race.aidStations[0].distanceKm, 2);
  assert.equal(response.body.race.sourceFamilies.course.length, 1);
  assert.equal(response.body.race.difficultyScoreVersion, 'v1');
  assert.equal(missing.status, 404);
  assert.equal(missing.body.error, 'Race not found');
});

test('course pages have race-specific metadata, canonical URLs and real 404 responses', async () => {
  process.env.PUBLIC_BASE_URL = 'https://trailcompare.example/';
  try {
    const page = await requestRaw('/courses/fixture-valid-2026');
    const missing = await requestRaw('/courses/fixture-unknown-2026');

    assert.equal(page.status, 200);
    assert.match(page.text, /<title>Valid GPX 2026 - Fixture Trail \| TrailCompare<\/title>/);
    assert.match(page.text, /<link rel="canonical" href="https:\/\/trailcompare\.example\/courses\/fixture-valid-2026">/);
    assert.match(page.text, /<meta property="og:url" content="https:\/\/trailcompare\.example\/courses\/fixture-valid-2026">/);
    assert.match(page.text, /<meta property="og:image" content="https:\/\/example\.test\/images\/valid-gpx\.jpg">/);
    assert.equal(missing.status, 404);
    assert.match(missing.text, /Course introuvable \| TrailCompare/);
  } finally {
    delete process.env.PUBLIC_BASE_URL;
  }
});

test('profile route serves the SPA and detailed races expose technical data explicitly', async () => {
  const profilePage = await requestRaw('/profil?course=fixture-valid-2026');
  const race = await request('/api/races/1');
  assert.equal(profilePage.status, 200);
  assert.match(profilePage.text, /id="profile-view"/);
  assert.equal(Object.hasOwn(race.body.race, 'technicalScore'), true);
  assert.equal(Object.hasOwn(race.body.race, 'technicalScoreSource'), true);
});

test('sitemap contains every race slug in addition to the homepage', async () => {
  process.env.PUBLIC_BASE_URL = 'https://trailcompare.example';
  try {
    const sitemap = await requestRaw('/sitemap.xml');
    const courseUrls = sitemap.text.match(/<loc>https:\/\/trailcompare\.example\/courses\//g) ?? [];

    assert.equal(sitemap.status, 200);
    assert.equal(courseUrls.length, 4);
    assert.match(sitemap.text, /\/courses\/fixture-valid-2026<\/loc>/);
    assert.match(sitemap.text, /\/courses\/fixture-empty-2026<\/loc>/);
  } finally {
    delete process.env.PUBLIC_BASE_URL;
  }
});
