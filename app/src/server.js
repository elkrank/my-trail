import express from 'express';
import { createReadStream } from 'node:fs';
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

app.get('/', serveIndex);
app.get('/index.html', serveIndex);
app.get('/robots.txt', (_request, response) => {
  const publicBaseUrl = getPublicBaseUrl();
  response.type('text/plain').send([
    'User-agent: *',
    'Allow: /',
    publicBaseUrl ? `Sitemap: ${publicBaseUrl}/sitemap.xml` : null,
    '',
  ].filter((line) => line !== null).join('\n'));
});
app.get('/sitemap.xml', (_request, response) => {
  const publicBaseUrl = getPublicBaseUrl();
  if (!publicBaseUrl) {
    response.status(404).type('text/plain').send('Not found');
    return;
  }

  response.type('application/xml').send(`<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url>
    <loc>${escapeXml(publicBaseUrl)}</loc>
  </url>
</urlset>
`);
});

app.use(express.static(publicDir, { index: false }));

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
      elevationQuality: race.gpx.elevationQuality,
      segments: asset.segments ?? [],
      points: flattenSegments(asset.segments ?? []),
      elevationProfile: asset.elevationProfile ?? [],
    });
  } catch (error) {
    next(error);
  }
});

app.get('/api/races/:id/gpx/download', async (request, response, next) => {
  try {
    const id = parseId(request.params.id, 'id');
    const race = await getRaceWithCheckpoints(id);
    if (!race) {
      response.status(404).json({ error: 'Race not found' });
      return;
    }
    if (race.gpx?.status !== 'available' || !race.gpx.localFile) {
      response.status(404).json({ error: 'GPX not available' });
      return;
    }

    let filePath;
    try {
      filePath = resolveDataAssetPath(getDataRoot(), race.gpx.localFile);
    } catch {
      response.status(404).json({ error: 'GPX file not available' });
      return;
    }

    const fileName = `${slugPart(race.event?.slug ?? race.eventName)}-${slugPart(race.shortName ?? race.raceName)}-${slugPart(race.edition)}.gpx`;
    response.setHeader('Content-Type', 'application/gpx+xml; charset=utf-8');
    response.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);

    const stream = createReadStream(filePath);
    stream.on('error', () => {
      if (!response.headersSent) {
        response.status(404).json({ error: 'GPX file not available' });
      } else {
        response.destroy();
      }
    });
    stream.pipe(response);
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
    console.log(`TrailCompare listening on port ${port}`);
  });
}

function flattenSegments(segments) {
  return segments.flatMap((segment) => segment);
}

async function serveIndex(_request, response, next) {
  try {
    let html = await readFile(path.join(publicDir, 'index.html'), 'utf8');
    const publicBaseUrl = getPublicBaseUrl();
    if (publicBaseUrl) {
      const tags = [
        `<link rel="canonical" href="${escapeHtml(publicBaseUrl)}">`,
        `<meta property="og:url" content="${escapeHtml(publicBaseUrl)}">`,
      ].join('\n    ');
      html = html.replace('</head>', `    ${tags}\n  </head>`);
    }
    response.type('html').send(html);
  } catch (error) {
    next(error);
  }
}

function getPublicBaseUrl() {
  return normalizePublicBaseUrl(process.env.PUBLIC_BASE_URL);
}

function normalizePublicBaseUrl(value) {
  if (!value) return null;
  try {
    const url = new URL(String(value));
    if (!['http:', 'https:'].includes(url.protocol)) return null;
    url.hash = '';
    url.search = '';
    return url.href.replace(/\/$/, '');
  } catch {
    return null;
  }
}

function slugPart(value) {
  const slug = String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug || 'course';
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function escapeXml(value) {
  return escapeHtml(value).replace(/'/g, '&apos;');
}
