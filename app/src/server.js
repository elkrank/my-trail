import express from 'express';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveDataAssetPath } from '../scrapers/common/gpx.mjs';
import { enrichRaceWithScores } from './metrics.js';
import { getDataRoot, getDatasetInfo, getRaceWithCheckpoints, listRaces } from './repository.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const publicDir = path.join(__dirname, '..', 'public');

export const app = express();
const port = Number(process.env.PORT ?? 3000);

app.use(express.static(publicDir));

function parseId(value, name) {
  const id = Number(value);
  if (!Number.isInteger(id) || id <= 0) {
    const error = new Error(`${name} must be a positive integer`);
    error.status = 400;
    throw error;
  }
  return id;
}

async function loadEnrichedRace(id) {
  const race = await getRaceWithCheckpoints(id);
  return race ? enrichRaceWithScores(race, race.checkpoints) : null;
}

app.get('/api/health', async (_request, response, next) => {
  try {
    const dataset = await getDatasetInfo();
    response.json({ status: 'ok', dataset });
  } catch (error) {
    next(error);
  }
});

app.get('/api/races', async (_request, response, next) => {
  try {
    response.json({ races: await listRaces() });
  } catch (error) {
    next(error);
  }
});

app.get('/api/races/:id/gpx', async (request, response, next) => {
  try {
    const id = parseId(request.params.id, 'id');
    const race = await getRaceWithCheckpoints(id);
    if (!race) {
      response.status(404).json({ error: 'Race not found' });
      return;
    }
    if (race.gpx?.status !== 'available' || !race.gpx.routeAsset) {
      response.status(404).json({ error: 'GPX not available' });
      return;
    }

    let asset;
    try {
      const assetPath = resolveDataAssetPath(getDataRoot(), race.gpx.routeAsset);
      asset = JSON.parse(await readFile(assetPath, 'utf8'));
    } catch {
      response.status(404).json({ error: 'GPX asset not available' });
      return;
    }

    response.json({
      sourceUrl: race.gpx.sourceUrl,
      downloadUrl: race.gpx.downloadUrl,
      localFile: race.gpx.localFile,
      sha256: race.gpx.sha256,
      computed: race.gpx.computed,
      segments: asset.segments ?? [],
      points: flattenSegments(asset.segments ?? []),
      elevationProfile: asset.elevationProfile ?? [],
    });
  } catch (error) {
    next(error);
  }
});

app.get('/api/races/:id', async (request, response, next) => {
  try {
    const id = parseId(request.params.id, 'id');
    const race = await loadEnrichedRace(id);
    if (!race) {
      response.status(404).json({ error: 'Race not found' });
      return;
    }
    response.json({ race });
  } catch (error) {
    next(error);
  }
});

app.get('/api/compare', async (request, response, next) => {
  try {
    const raceAId = parseId(request.query.raceA, 'raceA');
    const raceBId = parseId(request.query.raceB, 'raceB');

    if (raceAId === raceBId) {
      response.status(400).json({ error: 'raceA and raceB must be different' });
      return;
    }

    const [raceA, raceB] = await Promise.all([
      loadEnrichedRace(raceAId),
      loadEnrichedRace(raceBId),
    ]);

    if (!raceA || !raceB) {
      response.status(404).json({ error: 'Race not found' });
      return;
    }

    response.json({ raceA, raceB });
  } catch (error) {
    next(error);
  }
});

app.use('/api', (_request, response) => {
  response.status(404).json({ error: 'API route not found' });
});

app.use((error, _request, response, _next) => {
  const status = error.status ?? 500;
  response.status(status).json({
    error: status >= 500 ? 'Internal server error' : error.message,
  });
});

if (process.env.NODE_ENV !== 'test') {
  app.listen(port, () => {
    console.log(`TrailCompare V0 listening on port ${port}`);
  });
}

function flattenSegments(segments) {
  return segments.flatMap((segment) => segment);
}
