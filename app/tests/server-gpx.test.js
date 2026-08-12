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
      body: await response.json(),
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
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test('races endpoint exposes event and start finish locations for explorer filters', async () => {
  const response = await request('/api/races');

  assert.equal(response.status, 200);
  assert.equal(response.body.races[0].event.region, 'Test');
  assert.equal(response.body.races[0].event.city, 'Test');
  assert.equal(response.body.races[0].startLocation, 'Start');
  assert.equal(response.body.races[0].finishLocation, 'Finish');
  assert.equal(response.body.races[0].illustration.url, 'https://example.test/images/valid-gpx.jpg');
  assert.equal(response.body.races[0].illustration.alt, 'Fixture Trail - Valid GPX');
});

test('gpx endpoint returns a clean empty-data error when a race has no gpx', async () => {
  const response = await request('/api/races/2/gpx');

  assert.equal(response.status, 404);
  assert.equal(response.body.error, 'GPX not available');
});
