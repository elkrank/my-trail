import express from 'express';
import { createReadStream } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveDataAssetPath } from '../scrapers/common/gpx.mjs';
import { enrichRaceWithScores } from './metrics.js';
import {
  getDataRoot,
  getDatasetInfo,
  getRaceBySlug,
  getRaceWithCheckpoints,
  listRaceSlugs,
  listRaces,
} from './repository.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const publicDir = path.join(__dirname, '..', 'public');
const leafletDistDir = path.join(__dirname, '..', 'node_modules', 'leaflet', 'dist');

export const app = express();
const port = Number(process.env.PORT ?? 3000);

app.get('/', serveIndex);
app.get('/index.html', serveIndex);
app.get('/profil', serveIndex);
app.get('/courses/:slug', serveCourse);
app.get('/robots.txt', (_request, response) => {
  const publicBaseUrl = getPublicBaseUrl();
  response.type('text/plain').send([
    'User-agent: *',
    'Allow: /',
    publicBaseUrl ? `Sitemap: ${publicBaseUrl}/sitemap.xml` : null,
    '',
  ].filter((line) => line !== null).join('\n'));
});
app.get('/sitemap.xml', async (_request, response, next) => {
  const publicBaseUrl = getPublicBaseUrl();
  if (!publicBaseUrl) {
    response.status(404).type('text/plain').send('Not found');
    return;
  }

  try {
    const courseUrls = (await listRaceSlugs())
      .map((slug) => `  <url>\n    <loc>${escapeXml(`${publicBaseUrl}/courses/${slug}`)}</loc>\n  </url>`)
      .join('\n');
    response.type('application/xml').send(`<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url>
    <loc>${escapeXml(publicBaseUrl)}</loc>
  </url>
${courseUrls}
</urlset>
`);
  } catch (error) {
    next(error);
  }
});

app.use('/vendor/leaflet-1.9.4', express.static(leafletDistDir, {
  index: false,
  immutable: true,
  maxAge: '1y',
}));
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

app.get('/api/races/slug/:slug', async (request, response, next) => {
  try {
    const race = await getRaceBySlug(request.params.slug);
    if (!race) {
      response.status(404).json({ error: 'Course introuvable' });
      return;
    }
    response.json({ race: enrichRaceWithScores(race, race.checkpoints) });
  } catch (error) {
    next(error);
  }
});

app.get('/api/races/:id/gpx', async (request, response, next) => {
  try {
    const id = parseId(request.params.id, 'id');
    const race = await getRaceWithCheckpoints(id);
    if (!race) {
      response.status(404).json({ error: 'Course introuvable' });
      return;
    }
    if (race.gpx?.status !== 'available' || !race.gpx.routeAsset) {
      response.status(404).json({ error: 'GPX indisponible' });
      return;
    }

    let asset;
    try {
      const assetPath = resolveDataAssetPath(getDataRoot(), race.gpx.routeAsset);
      asset = JSON.parse(await readFile(assetPath, 'utf8'));
    } catch {
      response.status(404).json({ error: 'Données GPX indisponibles' });
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
      response.status(404).json({ error: 'Course introuvable' });
      return;
    }
    if (race.gpx?.status !== 'available' || !race.gpx.localFile) {
      response.status(404).json({ error: 'GPX indisponible' });
      return;
    }

    let filePath;
    try {
      filePath = resolveDataAssetPath(getDataRoot(), race.gpx.localFile);
    } catch {
      response.status(404).json({ error: 'Fichier GPX indisponible' });
      return;
    }

    const fileName = `${slugPart(race.event?.slug ?? race.eventName)}-${slugPart(race.shortName ?? race.raceName)}-${slugPart(race.edition)}.gpx`;
    response.setHeader('Content-Type', 'application/gpx+xml; charset=utf-8');
    response.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);

    const stream = createReadStream(filePath);
    stream.on('error', () => {
      if (!response.headersSent) {
        response.status(404).json({ error: 'Fichier GPX indisponible' });
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
      response.status(404).json({ error: 'Course introuvable' });
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
      response.status(404).json({ error: 'Course introuvable' });
      return;
    }

    response.json({ raceA, raceB });
  } catch (error) {
    next(error);
  }
});

app.use('/api', (_request, response) => {
  response.status(404).json({ error: 'Route API introuvable' });
});

app.use((error, _request, response, _next) => {
  const status = error.status ?? 500;
  response.status(status).json({
    error: status >= 500 ? 'Erreur interne du serveur' : error.message,
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

async function serveIndex(request, response, next) {
  try {
    let html = await readFile(path.join(publicDir, 'index.html'), 'utf8');
    const publicBaseUrl = getPublicBaseUrl();
    if (publicBaseUrl) {
      const pageUrl = request.path === '/profil' ? `${publicBaseUrl}/profil` : publicBaseUrl;
      const imageUrl = `${publicBaseUrl}/og.png`;
      const tags = [
        `<link rel="canonical" href="${escapeHtml(pageUrl)}">`,
        `<meta property="og:url" content="${escapeHtml(pageUrl)}">`,
        `<meta property="og:image" content="${escapeHtml(imageUrl)}">`,
        `<meta name="twitter:image" content="${escapeHtml(imageUrl)}">`,
      ].join('\n    ');
      html = html.replace('</head>', `    ${tags}\n  </head>`);
    }
    response.type('html').send(html);
  } catch (error) {
    next(error);
  }
}

async function serveCourse(request, response, next) {
  try {
    const race = await getRaceBySlug(request.params.slug);
    if (!race) {
      response.status(404).type('html').send(await renderNotFoundPage());
      return;
    }

    let html = await readFile(path.join(publicDir, 'index.html'), 'utf8');
    const location = [race.event.city, race.event.region, race.event.country].filter(Boolean).join(', ');
    const title = `${race.shortName} ${race.edition} - ${race.eventName} | TrailCompare`;
    const fallbackDescription = naturalRaceDescription(race, location);
    const description = truncateDescription(race.description?.french ?? race.description?.original ?? fallbackDescription);
    const publicBaseUrl = getPublicBaseUrl();
    const canonicalUrl = publicBaseUrl ? `${publicBaseUrl}/courses/${race.slug}` : null;
    const imageUrl = publicBaseUrl ? `${publicBaseUrl}/og.png` : null;

    html = replaceDocumentMetadata(html, { title, description, canonicalUrl, imageUrl });
    response.type('html').send(html);
  } catch (error) {
    next(error);
  }
}

function renderNotFoundPage() {
  return `<!doctype html>
<html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Course introuvable | TrailCompare</title>
<meta name="description" content="Cette fiche course n’existe pas ou n’est plus disponible.">
<meta name="robots" content="noindex,follow"><link rel="stylesheet" href="/styles.css"></head>
<body class="not-found-page"><main class="not-found-content">
<p class="eyebrow">ERREUR 404</p><h1>Course introuvable</h1>
<p>Cette fiche course n’existe pas ou n’est plus disponible.</p>
<div class="not-found-actions"><a class="button button-primary" href="/#explorer">Explorer les courses</a><a class="button button-secondary" href="/">Retour à l’accueil</a></div>
</main></body></html>`;
}

function replaceDocumentMetadata(html, { title, description, canonicalUrl = null, imageUrl = null }) {
  const safeTitle = escapeHtml(title);
  const safeDescription = escapeHtml(description);
  html = html.replace(/<title>[\s\S]*?<\/title>/i, `<title>${safeTitle}</title>`);
  html = replaceMetaContent(html, 'name', 'description', safeDescription);
  html = replaceMetaContent(html, 'property', 'og:title', safeTitle);
  html = replaceMetaContent(html, 'property', 'og:description', safeDescription);
  html = replaceMetaContent(html, 'name', 'twitter:title', safeTitle);
  html = replaceMetaContent(html, 'name', 'twitter:description', safeDescription);

  const extraTags = [
    canonicalUrl ? `<link rel="canonical" href="${escapeHtml(canonicalUrl)}">` : null,
    canonicalUrl ? `<meta property="og:url" content="${escapeHtml(canonicalUrl)}">` : null,
    imageUrl ? `<meta property="og:image" content="${escapeHtml(imageUrl)}">` : null,
    imageUrl ? `<meta name="twitter:image" content="${escapeHtml(imageUrl)}">` : null,
    '<meta property="og:type" content="article">',
  ].filter(Boolean).join('\n    ');
  html = html.replace(/<meta property="og:type"[^>]*>\s*/i, '');
  return html.replace('</head>', `    ${extraTags}\n  </head>`);
}

function replaceMetaContent(html, attribute, key, content) {
  const expression = new RegExp(`<meta\\s+${attribute}="${key}"\\s+content="[^"]*">`, 'i');
  const tag = `<meta ${attribute}="${key}" content="${content}">`;
  return expression.test(html) ? html.replace(expression, tag) : html.replace('</head>', `    ${tag}\n  </head>`);
}

function naturalRaceDescription(race, location) {
  const distance = numberOrNull(race.effectiveDistanceKm ?? race.distanceKm);
  const elevation = numberOrNull(race.elevationGainM);
  const label = `${race.raceName ?? ''} ${race.eventName ?? ''}`.trim();
  const distancePattern = distance === null ? null : String(distance).replace('.', '[.,]');
  const includesDistance = distancePattern ? new RegExp(`\\b${distancePattern}\\s*km\\b`, 'i').test(label) : false;
  const details = [
    !includesDistance && distance !== null ? `un parcours de ${formatSeoNumber(distance)} km` : null,
    elevation !== null ? `${formatSeoNumber(elevation)} m de dénivelé positif` : null,
    location ? `à ${location}` : null,
  ].filter(Boolean);
  return `Découvrez ${race.raceName} du ${race.eventName}${details.length ? ` : ${details.join(', ')}` : ''}. Retrouvez le parcours, les barrières, les ravitaillements et les sources officielles disponibles.`;
}

function numberOrNull(value) {
  if (value === null || value === undefined || String(value).trim() === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function truncateDescription(value) {
  const text = String(value ?? '').replace(/\s+/g, ' ').trim();
  return text.length > 180 ? `${text.slice(0, 177).trimEnd()}…` : text;
}

function formatSeoNumber(value) {
  return Number.isFinite(Number(value)) ? new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 1 }).format(Number(value)) : '—';
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

function normalizeHttpUrl(value) {
  if (!value) return null;
  try {
    const url = new URL(String(value));
    return ['http:', 'https:'].includes(url.protocol) ? url.href : null;
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
