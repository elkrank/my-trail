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
