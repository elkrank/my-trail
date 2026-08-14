import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  analyzeGpxBuffer,
  assessGpxElevationQuality,
  buildRouteAsset,
  collectGpxForEntry,
  extractMapPlatformLinks,
  extractGpxFromZip,
  findGpxCandidate,
  GPX_NOT_FOUND_WARNING,
  parseTraceDeTrailEventTraces,
  parseStravaAccountRoutes,
  sha256Hex,
} from "../../scrapers/common/gpx.mjs";
import { createEdition, createEvent, createRace, createRaceEntry } from "../../scrapers/common/model.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixtures = join(__dirname, "..", "fixtures", "gpx");

test("parses a valid GPX and computes distance and elevation with noise threshold", async () => {
  const buffer = await readFile(join(fixtures, "valid.gpx"));
  const parsed = analyzeGpxBuffer(buffer);

  assert.equal(parsed.trackCount, 1);
  assert.equal(parsed.routeCount, 0);
  assert.equal(parsed.pointCount, 4);
  assert.equal(parsed.hasElevation, true);
  assert.equal(parsed.computed.distanceKm > 0, true);
  assert.equal(parsed.computed.elevationGainM, 26);
  assert.equal(parsed.computed.elevationLossM, 6);
  assert.equal(parsed.computed.minElevationM, 1000);
  assert.equal(parsed.computed.maxElevationM, 1020);
});

test("accepts a GPX without elevation and leaves elevation metrics null", async () => {
  const buffer = await readFile(join(fixtures, "no-elevation.gpx"));
  const parsed = analyzeGpxBuffer(buffer);

  assert.equal(parsed.pointCount, 3);
  assert.equal(parsed.hasElevation, false);
  assert.equal(parsed.computed.elevationGainM, null);
  assert.equal(parsed.computed.minElevationM, null);
});

test("rejects invalid GPX coordinates", async () => {
  const buffer = await readFile(join(fixtures, "invalid.gpx"));

  assert.throws(() => analyzeGpxBuffer(buffer), /invalid latitude/i);
});

test("rejects HTML returned instead of GPX", async () => {
  const buffer = await readFile(join(fixtures, "html-as-gpx.gpx"));

  assert.throws(() => analyzeGpxBuffer(buffer), /HTML/i);
});

test("extracts a GPX from a ZIP download", async () => {
  const gpx = await readFile(join(fixtures, "valid.gpx"));
  const zip = createStoredZip("course.gpx", gpx);
  const extracted = extractGpxFromZip(zip);
  const parsed = analyzeGpxBuffer(extracted);

  assert.equal(extracted.equals(gpx), true);
  assert.equal(parsed.pointCount, 4);
});

test("assesses GPX elevation quality against official elevation gain", () => {
  assert.deepEqual(
    assessGpxElevationQuality({
      gpxStatus: "available",
      officialGainM: 6200,
      computedGainM: 6400,
      hasElevation: true,
    }),
    {
      status: "consistent",
      officialGainM: 6200,
      computedGainM: 6400,
      deltaM: 200,
      deltaPercent: 3.2,
    },
  );

  assert.equal(
    assessGpxElevationQuality({
      gpxStatus: "available",
      officialGainM: 6200,
      computedGainM: 37833,
      hasElevation: true,
    }).status,
    "inconsistent",
  );
  assert.equal(
    assessGpxElevationQuality({
      gpxStatus: "available",
      officialGainM: null,
      computedGainM: 6400,
      hasElevation: true,
    }).status,
    "unverified",
  );
  assert.equal(
    assessGpxElevationQuality({
      gpxStatus: "available",
      officialGainM: 6200,
      computedGainM: null,
      hasElevation: false,
    }).status,
    "unavailable",
  );
});

test("builds compact frontend route assets", async () => {
  const buffer = await readFile(join(fixtures, "valid.gpx"));
  const parsed = analyzeGpxBuffer(buffer);
  const asset = buildRouteAsset({
    parsed,
    sourceUrl: "https://example.test/race",
    downloadUrl: "https://example.test/course.gpx",
    localFile: "gpx/2026/example/course.gpx",
    sha256: sha256Hex(buffer),
  });

  assert.equal(asset.segments.length, 1);
  assert.equal(asset.segments[0].length, 4);
  assert.equal(asset.elevationProfile.length, 4);
  assert.equal(asset.computed.distanceKm, parsed.computed.distanceKm);
});

test("detects Pacevisor links from an official page and resolves the public GPX URL", async () => {
  const event = createEvent({ id: "ntmf", slug: "ntmf", name: "NTMF" });
  const race = createRace(event, { name: "115 km", shortName: "115 km" });
  const entry = createRaceEntry({
    event,
    race,
    edition: createEdition(2026, {
      distanceKm: 115,
      gpxUrl: "https://static.pacevisor.com/previous-ntmf-115.gpx",
      sources: [
        {
          url: "https://organizer.test/les-courses",
          type: "official-race-page",
          retrievedAt: "2026-08-12T10:00:00.000Z",
          event: event.name,
          race: race.shortName,
        },
      ],
    }),
  });
  const pageCache = new Map([
    ["https://organizer.test/les-courses", {
      url: "https://organizer.test/les-courses",
      finalUrl: "https://organizer.test/les-courses",
      content: '<a href="https://pacevisor.com/races/ntmf-115-2026">Voir le parcours ici</a>',
    }],
    ["https://pacevisor.com/api/races/ntmf-115-2026", {
      url: "https://pacevisor.com/api/races/ntmf-115-2026",
      finalUrl: "https://pacevisor.com/api/races/ntmf-115-2026",
      content: JSON.stringify({
        id: "ntmf-115-2026",
        title: "Nord Trail Monts de Flandres",
        distance: 115,
        gpxUrl: "https://static.pacevisor.com/ntmf-2026-115-km.gpx",
      }),
    }],
  ]);

  const links = extractMapPlatformLinks(pageCache.get("https://organizer.test/les-courses").content, "https://organizer.test/les-courses");
  const candidate = await findGpxCandidate(entry, { pageCache });

  assert.deepEqual(links, ["https://pacevisor.com/races/ntmf-115-2026"]);
  assert.equal(candidate.sourceType, "official-map-platform");
  assert.equal(candidate.sourcePlatform, "pacevisor");
  assert.equal(candidate.sourceUrl, "https://pacevisor.com/races/ntmf-115-2026");
  assert.equal(candidate.downloadUrl, "https://static.pacevisor.com/ntmf-2026-115-km.gpx");
});

test("resolves an official map platform source directly", async () => {
  const event = createEvent({ id: "ntmf", slug: "ntmf", name: "NTMF" });
  const race = createRace(event, { name: "80 km", shortName: "80 km" });
  const entry = createRaceEntry({
    event,
    race,
    edition: createEdition(2026, {
      distanceKm: 80,
      sources: [
        {
          url: "https://pacevisor.com/races/ntmf-80-2026",
          type: "official-map-platform",
          retrievedAt: "2026-08-12T10:00:00.000Z",
          event: event.name,
          race: race.shortName,
        },
      ],
    }),
  });
  const pageCache = new Map([
    ["https://pacevisor.com/api/races/ntmf-80-2026", {
      url: "https://pacevisor.com/api/races/ntmf-80-2026",
      finalUrl: "https://pacevisor.com/api/races/ntmf-80-2026",
      content: JSON.stringify({
        id: "ntmf-80-2026",
        title: "Nord Trail Monts de Flandres",
        distance: 80,
        gpxUrl: "https://static.pacevisor.com/ntmf-2026-80-km.gpx",
      }),
    }],
  ]);

  const candidate = await findGpxCandidate(entry, { pageCache });

  assert.equal(candidate.sourceType, "official-map-platform");
  assert.equal(candidate.sourcePlatform, "pacevisor");
  assert.equal(candidate.sourceUrl, "https://pacevisor.com/races/ntmf-80-2026");
  assert.equal(candidate.downloadUrl, "https://static.pacevisor.com/ntmf-2026-80-km.gpx");
});

test("converts an official LiveTrail public track JSON into a stored GPX", async () => {
  const outDir = await mkdtemp(join(tmpdir(), "trailcompare-livetrail-gpx-"));
  const liveTrailUrl = "https://ultramarin-breizhchrono.v3.livetrail.net/fr/2026/races/GdRaid";
  const trackUrl = "https://livetrailv3.s3.gra.io.cloud.ovh.net/ultramarin-breizhchrono_2026/tracks/a1091c19.json";
  const event = createEvent({ id: "ultra-marin", slug: "ultra-marin", name: "Ultra Marin" });
  const race = createRace(event, { name: "Grand Raid", shortName: "Grand Raid" });
  const entry = createRaceEntry({
    event,
    race,
    edition: createEdition(2026, {
      distanceKm: null,
      sources: [
        {
          url: "https://www.ultra-marin.fr/grand-raid-ultramarin",
          type: "official-race-page",
          retrievedAt: "2026-08-14T10:00:00.000Z",
          event: event.name,
          race: race.shortName,
        },
      ],
    }),
  });
  const pageCache = new Map([
    ["https://www.ultra-marin.fr/grand-raid-ultramarin", {
      url: "https://www.ultra-marin.fr/grand-raid-ultramarin",
      finalUrl: "https://www.ultra-marin.fr/grand-raid-ultramarin",
      content: `<a href="${liveTrailUrl}">Suivi LiveTrail</a>`,
    }],
    [liveTrailUrl, {
      url: liveTrailUrl,
      finalUrl: liveTrailUrl,
      content: `<title>Grand Raid course</title><script>window.__track="${trackUrl}\\";</script>`,
    }],
  ]);
  const trackJson = JSON.stringify({
    segments: [
      {
        segment: [
          [0, 4, [-2.75858, 47.65272], [0, 0], 1, "U"],
          [18, 5, [-2.75859, 47.65288], [0, 0], 1, "U"],
          [37, 6, [-2.7586, 47.65305], [0, 0], 1, "U"],
        ],
      },
    ],
  });

  await collectGpxForEntry(entry, {
    outDir,
    pageCache,
    fetchImpl: async (url) => {
      assert.equal(url, trackUrl);
      return new Response(trackJson, {
        headers: { "content-type": "application/octet-stream" },
      });
    },
  });

  assert.equal(entry.edition.gpx.status, "available");
  assert.equal(entry.edition.gpx.sourcePlatform, "livetrail");
  assert.equal(entry.edition.gpx.sourceUrl, liveTrailUrl);
  assert.equal(entry.edition.gpx.downloadUrl, trackUrl);

  const stored = await readFile(join(outDir, entry.edition.gpx.localFile), "utf8");
  assert.match(stored, /<gpx\b/);
  assert.match(stored, /<trkpt lat="47\.65272" lon="-2\.75858">/);
  assert.match(stored, /<ele>4<\/ele>/);
});

test("skips a mismatched LiveTrail race page and uses the configured official race page", async () => {
  const ducsUrl = "https://ultramarin-breizhchrono.v3.livetrail.net/fr/2026/races/Ducs";
  const arvorUrl = "https://ultramarin-breizhchrono.v3.livetrail.net/fr/2026/races/Arvor";
  const arvorTrackUrl = "https://livetrailv3.s3.gra.io.cloud.ovh.net/ultramarin-breizhchrono_2026/tracks/arvor.json";
  const event = createEvent({ id: "ultra-marin", slug: "ultra-marin", name: "Ultra Marin" });
  const race = createRace(event, { name: "L'Arvor", shortName: "L'Arvor" });
  const entry = createRaceEntry({
    event,
    race,
    edition: createEdition(2026, {
      distanceKm: 56,
      sources: [
        {
          url: "https://www.ultra-marin.fr/trail-ultramarin",
          type: "official-race-page",
          retrievedAt: "2026-08-14T10:00:00.000Z",
          event: event.name,
          race: race.shortName,
        },
        {
          url: arvorUrl,
          type: "official-map-platform",
          retrievedAt: "2026-08-14T10:00:00.000Z",
          event: event.name,
          race: race.shortName,
        },
      ],
    }),
  });
  const pageCache = new Map([
    ["https://www.ultra-marin.fr/trail-ultramarin", {
      url: "https://www.ultra-marin.fr/trail-ultramarin",
      finalUrl: "https://www.ultra-marin.fr/trail-ultramarin",
      content: `<a href="${ducsUrl}">LiveTrail</a>`,
    }],
    [ducsUrl, {
      url: ducsUrl,
      finalUrl: ducsUrl,
      content: "<title>Réveil des Ducs course</title>",
    }],
    [arvorUrl, {
      url: arvorUrl,
      finalUrl: arvorUrl,
      content: `<title>Arvor course</title><script>window.__track="${arvorTrackUrl}";</script>`,
    }],
  ]);

  const candidate = await findGpxCandidate(entry, { pageCache });

  assert.equal(candidate.sourcePlatform, "livetrail");
  assert.equal(candidate.sourceUrl, arvorUrl);
  assert.equal(candidate.downloadUrl, arvorTrackUrl);
});

test("detects Strava route links from an official page and resolves the GPX export URL", async () => {
  const event = createEvent({ id: "ultra-marin", slug: "ultra-marin", name: "Ultra Marin" });
  const race = createRace(event, { name: "Grand Raid", shortName: "Grand Raid" });
  const entry = createRaceEntry({
    event,
    race,
    edition: createEdition(2026, {
      distanceKm: 175,
      sources: [
        {
          url: "https://organizer.test/grand-raid",
          type: "official-race-page",
          retrievedAt: "2026-08-14T10:00:00.000Z",
          event: event.name,
          race: race.shortName,
        },
      ],
    }),
  });
  const pageCache = new Map([
    ["https://organizer.test/grand-raid", {
      url: "https://organizer.test/grand-raid",
      finalUrl: "https://organizer.test/grand-raid",
      content: '<a href="https://www.strava.com/routes/1234567890?hl=fr-FR">Parcours officiel Strava</a>',
    }],
  ]);

  const links = extractMapPlatformLinks(pageCache.get("https://organizer.test/grand-raid").content, "https://organizer.test/grand-raid");
  const candidate = await findGpxCandidate(entry, { pageCache });

  assert.deepEqual(links, ["https://www.strava.com/routes/1234567890?hl=fr-FR"]);
  assert.equal(candidate.sourceType, "official-map-platform");
  assert.equal(candidate.sourcePlatform, "strava");
  assert.equal(candidate.sourceUrl, "https://www.strava.com/routes/1234567890");
  assert.equal(candidate.downloadUrl, "https://www.strava.com/routes/1234567890/export_gpx");
});

test("normalizes Strava route iframe variants to the GPX export URL", async () => {
  const event = createEvent({ id: "fixture", slug: "fixture", name: "Fixture Trail" });
  const race = createRace(event, { name: "Official", shortName: "Official" });
  const entry = createRaceEntry({
    event,
    race,
    edition: createEdition(2026, {
      distanceKm: 42,
      sources: [
        {
          url: "https://organizer.test/route-iframes",
          type: "official-race-page",
          retrievedAt: "2026-08-14T10:00:00.000Z",
          event: event.name,
          race: race.shortName,
        },
      ],
    }),
  });
  const content = `
    <iframe src="https://www.strava.com/routes/1000000001/embed"></iframe>
    <iframe src="https://www.strava.com/routes/1000000002?hl=fr-FR"></iframe>
  `;
  const pageCache = new Map([
    ["https://organizer.test/route-iframes", {
      url: "https://organizer.test/route-iframes",
      finalUrl: "https://organizer.test/route-iframes",
      content,
    }],
  ]);

  const links = extractMapPlatformLinks(content, "https://organizer.test/route-iframes");
  const candidate = await findGpxCandidate(entry, { pageCache });

  assert.deepEqual(links, [
    "https://www.strava.com/routes/1000000001/embed",
    "https://www.strava.com/routes/1000000002?hl=fr-FR",
  ]);
  assert.equal(candidate.sourcePlatform, "strava");
  assert.equal(candidate.sourceUrl, "https://www.strava.com/routes/1000000001");
  assert.equal(candidate.downloadUrl, "https://www.strava.com/routes/1000000001/export_gpx");
});

test("normalizes official strava-embeds route iframes to the GPX export URL", async () => {
  const event = createEvent({ id: "ecotrail", slug: "ecotrail", name: "EcoTrail Paris" });
  const race = createRace(event, { name: "Trail 80 km Automne", shortName: "80 km Automne" });
  const entry = createRaceEntry({
    event,
    race,
    edition: createEdition(2026, {
      distanceKm: 80,
      sources: [
        {
          url: "https://www.ecotrailparis.com/course/trail-80-km-automne",
          type: "official-race-page",
          retrievedAt: "2026-08-14T10:00:00.000Z",
          event: event.name,
          race: race.shortName,
        },
      ],
    }),
  });
  const content = `
    <a href="#">Telecharger la trace GPX</a>
    <iframe src="https://strava-embeds.com/route/3499396767489537408?clubId=245753"></iframe>
  `;
  const pageCache = new Map([
    ["https://www.ecotrailparis.com/course/trail-80-km-automne", {
      url: "https://www.ecotrailparis.com/course/trail-80-km-automne",
      finalUrl: "https://www.ecotrailparis.com/course/trail-80-km-automne",
      content,
    }],
  ]);

  const links = extractMapPlatformLinks(content, "https://www.ecotrailparis.com/course/trail-80-km-automne");
  const candidate = await findGpxCandidate(entry, { pageCache });

  assert.deepEqual(links, ["https://strava-embeds.com/route/3499396767489537408?clubId=245753"]);
  assert.equal(candidate.sourcePlatform, "strava");
  assert.equal(candidate.sourceUrl, "https://www.strava.com/routes/3499396767489537408");
  assert.equal(candidate.downloadUrl, "https://www.strava.com/routes/3499396767489537408/export_gpx");
  assert.deepEqual(candidate.fallbackDownloads, [
    { downloadUrl: "https://strava-embeds.com/route/3499396767489537408?clubId=245753" },
  ]);
});

test("detects official Strava route placeholders with data embed ids", async () => {
  const event = createEvent({ id: "marathon-mont-blanc", slug: "marathon-mont-blanc", name: "Marathon du Mont-Blanc" });
  const race = createRace(event, { name: "90 km du Mont-Blanc", shortName: "90 km" });
  const entry = createRaceEntry({
    event,
    race,
    edition: createEdition(2026, {
      distanceKm: 90,
      sources: [
        {
          url: "https://www.marathonmontblanc.fr/courses/90km-du-mont-blanc",
          type: "official-race-page",
          retrievedAt: "2026-08-14T10:00:00.000Z",
          event: event.name,
          race: race.shortName,
        },
      ],
    }),
  });
  const content = `
    <div class="strava-embed-placeholder" data-embed-type="route" data-embed-id="3410932955339078512" data-club-id="513835"></div>
    <script src="https://strava-embeds.com/embed.js"></script>
  `;
  const pageCache = new Map([
    ["https://www.marathonmontblanc.fr/courses/90km-du-mont-blanc", {
      url: "https://www.marathonmontblanc.fr/courses/90km-du-mont-blanc",
      finalUrl: "https://www.marathonmontblanc.fr/courses/90km-du-mont-blanc",
      content,
    }],
  ]);

  const links = extractMapPlatformLinks(content, "https://www.marathonmontblanc.fr/courses/90km-du-mont-blanc");
  const candidate = await findGpxCandidate(entry, { pageCache });

  assert.deepEqual(links, ["https://strava-embeds.com/route/3410932955339078512?clubId=513835"]);
  assert.equal(candidate.sourcePlatform, "strava");
  assert.equal(candidate.sourceUrl, "https://www.strava.com/routes/3410932955339078512");
  assert.equal(candidate.downloadUrl, "https://www.strava.com/routes/3410932955339078512/export_gpx");
  assert.deepEqual(candidate.fallbackDownloads, [
    { downloadUrl: "https://strava-embeds.com/route/3410932955339078512?clubId=513835" },
  ]);
});

test("converts an official Google My Maps KML export into a stored GPX", async () => {
  const outDir = await mkdtemp(join(tmpdir(), "trailcompare-google-mymaps-gpx-"));
  const mapId = "1Yb5fI78r0UNk6m2eqKVTRUA46EWC1jvz";
  const mapUrl = `https://www.google.com/maps/d/edit?mid=${mapId}&ll=45.96251364788493%2C6.904467124485518&z=13`;
  const escapedMapUrl = `https://www.google.com/maps/d/edit?mid=${mapId}&amp;ll=45.96251364788493%2C6.904467124485518&amp;z=13`;
  const kmlUrl = `https://www.google.com/maps/d/kml?mid=${mapId}&forcekml=1`;
  const kml = `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2">
  <Document>
    <Placemark>
      <name>Official route</name>
      <description><![CDATA[<p>Public map description<br>with HTML</p>]]></description>
      <LineString>
        <coordinates>
          6.869433,45.923697,1035
          6.879433,45.933697,1105
          6.889433,45.943697,1210
        </coordinates>
      </LineString>
    </Placemark>
  </Document>
</kml>`;
  const event = createEvent({ id: "marathon-mont-blanc", slug: "marathon-mont-blanc", name: "Marathon du Mont-Blanc" });
  const race = createRace(event, { name: "23 km du Mont-Blanc", shortName: "23 km" });
  const entry = createRaceEntry({
    event,
    race,
    edition: createEdition(2026, {
      distanceKm: null,
      sources: [
        {
          url: "https://www.marathonmontblanc.fr/courses/23km-du-mont-blanc",
          type: "official-race-page",
          retrievedAt: "2026-08-14T10:00:00.000Z",
          event: event.name,
          race: race.shortName,
        },
      ],
    }),
  });
  const pageCache = new Map([
    ["https://www.marathonmontblanc.fr/courses/23km-du-mont-blanc", {
      url: "https://www.marathonmontblanc.fr/courses/23km-du-mont-blanc",
      finalUrl: "https://www.marathonmontblanc.fr/courses/23km-du-mont-blanc",
      content: `<a href="${escapedMapUrl}">Carte interactive</a>`,
    }],
  ]);

  const candidate = await findGpxCandidate(entry, { pageCache });
  await collectGpxForEntry(entry, {
    outDir,
    pageCache,
    fetchImpl: async (url) => {
      assert.equal(url, kmlUrl);
      return new Response(kml, {
        headers: { "content-type": "application/vnd.google-earth.kml+xml" },
      });
    },
  });

  assert.equal(candidate.sourcePlatform, "google-my-maps");
  assert.equal(candidate.sourceUrl, mapUrl);
  assert.equal(candidate.downloadUrl, kmlUrl);
  assert.equal(entry.edition.gpx.status, "available");
  assert.equal(entry.edition.gpx.sourcePlatform, "google-my-maps");
  assert.equal(entry.edition.gpx.downloadUrl, kmlUrl);

  const stored = await readFile(join(outDir, entry.edition.gpx.localFile), "utf8");
  assert.match(stored, /<gpx\b/);
  assert.match(stored, /<trkpt lat="45\.923697" lon="6\.869433">/);
});

test("falls back to public Strava embed coordinates when export requires login", async () => {
  const outDir = await mkdtemp(join(tmpdir(), "trailcompare-strava-embed-gpx-"));
  const routeId = "3499396767489537408";
  const embedUrl = `https://strava-embeds.com/route/${routeId}?clubId=245753`;
  const event = createEvent({ id: "ecotrail", slug: "ecotrail", name: "EcoTrail Paris" });
  const race = createRace(event, { name: "Trail 80 km Automne", shortName: "80 km Automne" });
  const entry = createRaceEntry({
    event,
    race,
    edition: createEdition(2026, {
      distanceKm: null,
      sources: [
        {
          url: "https://www.ecotrailparis.com/course/trail-80-km-automne",
          type: "official-race-page",
          retrievedAt: "2026-08-14T10:00:00.000Z",
          event: event.name,
          race: race.shortName,
        },
      ],
    }),
  });
  const pageCache = new Map([
    ["https://www.ecotrailparis.com/course/trail-80-km-automne", {
      url: "https://www.ecotrailparis.com/course/trail-80-km-automne",
      finalUrl: "https://www.ecotrailparis.com/course/trail-80-km-automne",
      content: `<iframe src="${embedUrl}"></iframe>`,
    }],
  ]);
  const embedHtml = `<!doctype html>
<html>
  <body>
    <script id="__ROUTE_DATA__" type="application/json">{"coordinates":[[2.05066,49.02543,25.42],[2.05047,49.02523,25.44],[2.04988,49.02489,22.77]]}</script>
  </body>
</html>`;
  const requested = [];

  await collectGpxForEntry(entry, {
    outDir,
    pageCache,
    fetchImpl: async (url) => {
      requested.push(url);
      if (url.endsWith("/export_gpx")) {
        return new Response(
          "<!doctype html><html><title>Log In | Strava</title><body>Sign in to export this route</body></html>",
          { headers: { "content-type": "text/html" } },
        );
      }
      return new Response(embedHtml, {
        headers: { "content-type": "text/html" },
      });
    },
  });

  assert.deepEqual(requested, [
    `https://www.strava.com/routes/${routeId}/export_gpx`,
    embedUrl,
  ]);
  assert.equal(entry.edition.gpx.status, "available");
  assert.equal(entry.edition.gpx.sourcePlatform, "strava");
  assert.equal(entry.edition.gpx.sourceUrl, `https://www.strava.com/routes/${routeId}`);
  assert.equal(entry.edition.gpx.downloadUrl, embedUrl);

  const stored = await readFile(join(outDir, entry.edition.gpx.localFile), "utf8");
  assert.match(stored, /<gpx\b/);
  assert.match(stored, /<trkpt lat="49\.02543" lon="2\.05066">/);
});

test("detects Strava route links from scripts and plain text", async () => {
  const event = createEvent({ id: "fixture", slug: "fixture", name: "Fixture Trail" });
  const race = createRace(event, { name: "Scripted", shortName: "Scripted" });
  const entry = createRaceEntry({
    event,
    race,
    edition: createEdition(2026, {
      distanceKm: null,
      sources: [
        {
          url: "https://organizer.test/scripted-route",
          type: "official-race-page",
          retrievedAt: "2026-08-14T10:00:00.000Z",
          event: event.name,
          race: race.shortName,
        },
      ],
    }),
  });
  const content = `
    <script>window.officialRoute = "https://www.strava.com/routes/2000000001?hl=fr-FR";</script>
    <p>Trace officielle: https://www.strava.com/routes/2000000002</p>
  `;
  const pageCache = new Map([
    ["https://organizer.test/scripted-route", {
      url: "https://organizer.test/scripted-route",
      finalUrl: "https://organizer.test/scripted-route",
      content,
    }],
  ]);

  const links = extractMapPlatformLinks(content, "https://organizer.test/scripted-route");
  const candidate = await findGpxCandidate(entry, { pageCache });

  assert.deepEqual(links, [
    "https://www.strava.com/routes/2000000001?hl=fr-FR",
    "https://www.strava.com/routes/2000000002",
  ]);
  assert.equal(candidate.sourcePlatform, "strava");
  assert.equal(candidate.sourceUrl, "https://www.strava.com/routes/2000000001");
  assert.equal(candidate.downloadUrl, "https://www.strava.com/routes/2000000001/export_gpx");
});

test("ignores Strava activity and segment embeds as direct GPX candidates", async () => {
  const event = createEvent({ id: "fixture", slug: "fixture", name: "Fixture Trail" });
  const race = createRace(event, { name: "Unsupported", shortName: "Unsupported" });
  const entry = createRaceEntry({
    event,
    race,
    edition: createEdition(2026, {
      distanceKm: 42,
      sources: [
        {
          url: "https://organizer.test/activity-embed",
          type: "official-race-page",
          retrievedAt: "2026-08-14T10:00:00.000Z",
          event: event.name,
          race: race.shortName,
        },
      ],
    }),
  });
  const content = `
    <iframe src="https://www.strava.com/activities/1234567890/embed"></iframe>
    <iframe src="https://www.strava.com/segments/987654321"></iframe>
  `;
  const pageCache = new Map([
    ["https://organizer.test/activity-embed", {
      url: "https://organizer.test/activity-embed",
      finalUrl: "https://organizer.test/activity-embed",
      content,
    }],
  ]);

  assert.deepEqual(extractMapPlatformLinks(content, "https://organizer.test/activity-embed"), []);
  assert.equal(await findGpxCandidate(entry, { pageCache }), null);
});

test("resolves routes from a configured Strava account that links the official website", async () => {
  const event = createEvent({
    id: "marathon-mont-blanc",
    slug: "marathon-mont-blanc",
    name: "Marathon du Mont-Blanc",
    officialWebsite: "https://www.marathonmontblanc.fr",
  });
  const race = createRace(event, { name: "42 km du Mont-Blanc", shortName: "42 km" });
  const entry = createRaceEntry({
    event,
    race,
    edition: createEdition(2026, {
      distanceKm: 42,
      rawOfficial: {
        stravaAccountUrls: ["https://www.strava.com/clubs/marathonmontblanc"],
      },
      sources: [
        {
          url: "https://organizer.test/42km",
          type: "official-race-page",
          retrievedAt: "2026-08-14T10:00:00.000Z",
          event: event.name,
          race: race.shortName,
        },
      ],
    }),
  });
  const accountHtml = `
    <a href="https://www.marathonmontblanc.fr">Site officiel</a>
    <a href="/routes/420000">42 km du Mont-Blanc - 42 km</a>
    <a href="/routes/900000">90 km du Mont-Blanc - 88 km</a>
  `;
  const pageCache = new Map([
    ["https://organizer.test/42km", {
      url: "https://organizer.test/42km",
      finalUrl: "https://organizer.test/42km",
      content: "<p>Infos course</p>",
    }],
    ["https://www.strava.com/clubs/marathonmontblanc", {
      url: "https://www.strava.com/clubs/marathonmontblanc",
      finalUrl: "https://www.strava.com/clubs/marathonmontblanc",
      content: accountHtml,
    }],
  ]);

  const routes = parseStravaAccountRoutes(accountHtml, "https://www.strava.com/clubs/marathonmontblanc");
  const candidate = await findGpxCandidate(entry, { pageCache });

  assert.equal(routes.length, 2);
  assert.deepEqual(routes[0], { id: "420000", name: "42 km du Mont-Blanc - 42 km", distanceKm: 42 });
  assert.equal(candidate.sourcePlatform, "strava");
  assert.equal(candidate.sourceUrl, "https://www.strava.com/routes/420000");
  assert.equal(candidate.downloadUrl, "https://www.strava.com/routes/420000/export_gpx");
});

test("accepts a Strava account linked from an official page", async () => {
  const event = createEvent({
    id: "marathon-mont-blanc",
    slug: "marathon-mont-blanc",
    name: "Marathon du Mont-Blanc",
    officialWebsite: "https://www.marathonmontblanc.fr",
  });
  const race = createRace(event, { name: "90 km du Mont-Blanc", shortName: "90 km" });
  const entry = createRaceEntry({
    event,
    race,
    edition: createEdition(2026, {
      distanceKm: 88,
      sources: [
        {
          url: "https://organizer.test/90km",
          type: "official-race-page",
          retrievedAt: "2026-08-14T10:00:00.000Z",
          event: event.name,
          race: race.shortName,
        },
      ],
    }),
  });
  const pageCache = new Map([
    ["https://organizer.test/90km", {
      url: "https://organizer.test/90km",
      finalUrl: "https://organizer.test/90km",
      content: '<a href="https://www.strava.com/clubs/mmb-official">Club Strava officiel</a>',
    }],
    ["https://www.strava.com/clubs/mmb-official", {
      url: "https://www.strava.com/clubs/mmb-official",
      finalUrl: "https://www.strava.com/clubs/mmb-official",
      content: '<a href="/routes/880000">90 km du Mont-Blanc - 88 km</a>',
    }],
  ]);

  const links = extractMapPlatformLinks(pageCache.get("https://organizer.test/90km").content, "https://organizer.test/90km");
  const candidate = await findGpxCandidate(entry, { pageCache });

  assert.deepEqual(links, ["https://www.strava.com/clubs/mmb-official"]);
  assert.equal(candidate.sourcePlatform, "strava");
  assert.equal(candidate.sourceUrl, "https://www.strava.com/routes/880000");
});

test("resolves a Strava club iframe from an official page as a verified account", async () => {
  const event = createEvent({
    id: "marathon-mont-blanc",
    slug: "marathon-mont-blanc",
    name: "Marathon du Mont-Blanc",
    officialWebsite: "https://www.marathonmontblanc.fr",
  });
  const race = createRace(event, { name: "90 km du Mont-Blanc", shortName: "90 km" });
  const entry = createRaceEntry({
    event,
    race,
    edition: createEdition(2026, {
      distanceKm: 88,
      sources: [
        {
          url: "https://organizer.test/90km-iframe",
          type: "official-race-page",
          retrievedAt: "2026-08-14T10:00:00.000Z",
          event: event.name,
          race: race.shortName,
        },
      ],
    }),
  });
  const pageCache = new Map([
    ["https://organizer.test/90km-iframe", {
      url: "https://organizer.test/90km-iframe",
      finalUrl: "https://organizer.test/90km-iframe",
      content: '<iframe src="https://www.strava.com/clubs/mmb-official"></iframe>',
    }],
    ["https://www.strava.com/clubs/mmb-official", {
      url: "https://www.strava.com/clubs/mmb-official",
      finalUrl: "https://www.strava.com/clubs/mmb-official",
      content: '<a href="/routes/880001">90 km du Mont-Blanc - 88 km</a>',
    }],
  ]);

  const links = extractMapPlatformLinks(pageCache.get("https://organizer.test/90km-iframe").content, "https://organizer.test/90km-iframe");
  const candidate = await findGpxCandidate(entry, { pageCache });

  assert.deepEqual(links, ["https://www.strava.com/clubs/mmb-official"]);
  assert.equal(candidate.sourcePlatform, "strava");
  assert.equal(candidate.sourceUrl, "https://www.strava.com/routes/880001");
  assert.equal(candidate.downloadUrl, "https://www.strava.com/routes/880001/export_gpx");
});

test("rejects a configured Strava account that does not link the official website", async () => {
  const event = createEvent({
    id: "ultra-marin",
    slug: "ultra-marin",
    name: "Ultra Marin",
    officialWebsite: "https://www.ultra-marin.fr",
  });
  const race = createRace(event, { name: "Grand Raid", shortName: "Grand Raid" });
  const entry = createRaceEntry({
    event,
    race,
    edition: createEdition(2026, {
      distanceKm: 175,
      rawOfficial: {
        stravaAccountUrls: ["https://www.strava.com/clubs/partner-club"],
      },
    }),
  });
  const pageCache = new Map([
    ["https://www.strava.com/clubs/partner-club", {
      url: "https://www.strava.com/clubs/partner-club",
      finalUrl: "https://www.strava.com/clubs/partner-club",
      content: '<a href="https://partner.example">Partenaire</a><a href="/routes/175000">Grand Raid - 175 km</a>',
    }],
  ]);

  assert.equal(await findGpxCandidate(entry, { pageCache }), null);
});

test("collects a GPX from an official Strava route when export is public", async () => {
  const gpx = await readFile(join(fixtures, "valid.gpx"));
  const outDir = await mkdtemp(join(tmpdir(), "trailcompare-strava-gpx-"));
  const event = createEvent({ id: "marathon-mont-blanc", slug: "marathon-mont-blanc", name: "Marathon du Mont-Blanc" });
  const race = createRace(event, { name: "42 km du Mont-Blanc", shortName: "42 km" });
  const entry = createRaceEntry({
    event,
    race,
    edition: createEdition(2026, {
      distanceKm: null,
      sources: [
        {
          url: "https://organizer.test/42km",
          type: "official-race-page",
          retrievedAt: "2026-08-14T10:00:00.000Z",
          event: event.name,
          race: race.shortName,
        },
      ],
    }),
  });
  const pageCache = new Map([
    ["https://organizer.test/42km", {
      url: "https://organizer.test/42km",
      finalUrl: "https://organizer.test/42km",
      content: '<iframe src="https://www.strava.com/routes/9876543210/embed"></iframe>',
    }],
  ]);

  await collectGpxForEntry(entry, {
    outDir,
    pageCache,
    fetchImpl: async (url) => {
      assert.equal(url, "https://www.strava.com/routes/9876543210/export_gpx");
      return new Response(gpx, {
        headers: { "content-type": "application/gpx+xml" },
      });
    },
  });

  assert.equal(entry.edition.gpx.status, "available");
  assert.equal(entry.edition.gpx.sourceType, "official-map-platform");
  assert.equal(entry.edition.gpx.sourcePlatform, "strava");
  assert.equal(entry.edition.gpx.sourceUrl, "https://www.strava.com/routes/9876543210");
  assert.equal(entry.edition.gpx.downloadUrl, "https://www.strava.com/routes/9876543210/export_gpx");
  assert.equal(entry.edition.gpx.localFile, "gpx/2026/marathon-mont-blanc/42-km.gpx");
  assert.equal(entry.edition.sources.some((source) =>
    source.type === "official-map-platform" &&
    source.url === "https://www.strava.com/routes/9876543210"
  ), true);
});

test("treats Strava login HTML as unavailable GPX", async () => {
  const event = createEvent({ id: "ultra-marin", slug: "ultra-marin", name: "Ultra Marin" });
  const race = createRace(event, { name: "Raid", shortName: "Raid" });
  const entry = createRaceEntry({
    event,
    race,
    edition: createEdition(2026, {
      distanceKm: null,
      sources: [
        {
          url: "https://organizer.test/raid",
          type: "official-race-page",
          retrievedAt: "2026-08-14T10:00:00.000Z",
          event: event.name,
          race: race.shortName,
        },
      ],
    }),
  });
  const pageCache = new Map([
    ["https://organizer.test/raid", {
      url: "https://organizer.test/raid",
      finalUrl: "https://organizer.test/raid",
      content: '<a href="https://www.strava.com/routes/1122334455">Strava officiel</a>',
    }],
  ]);

  await collectGpxForEntry(entry, {
    pageCache,
    fetchImpl: async () => new Response(
      "<!doctype html><html><title>Log In | Strava</title><body>Sign in to export this route</body></html>",
      { headers: { "content-type": "text/html" } },
    ),
  });

  assert.equal(entry.edition.gpx.status, "unavailable");
  assert.equal(entry.edition.gpx.sourcePlatform, "strava");
  assert.equal(entry.quality.warnings.includes(GPX_NOT_FOUND_WARNING), true);
  assert.equal(entry.quality.warnings.some((warning) => warning.startsWith("GPX_UNAVAILABLE")), true);
});

test("ignores Strava route links from non-official sources", async () => {
  const event = createEvent({ id: "fixture", slug: "fixture", name: "Fixture" });
  const race = createRace(event, { name: "Unofficial", shortName: "Unofficial" });
  const entry = createRaceEntry({
    event,
    race,
    edition: createEdition(2026, {
      distanceKm: 42,
      sources: [
        {
          url: "https://blog.example/route",
          type: "blog",
          retrievedAt: "2026-08-14T10:00:00.000Z",
          event: event.name,
          race: race.shortName,
        },
      ],
    }),
  });
  const pageCache = new Map([
    ["https://blog.example/route", {
      url: "https://blog.example/route",
      finalUrl: "https://blog.example/route",
      content: '<a href="https://www.strava.com/routes/1234567890">Trace probable</a>',
    }],
  ]);

  assert.equal(await findGpxCandidate(entry, { pageCache }), null);
});

test("detects Trace de Trail event links and resolves a POST GPX download", async () => {
  const event = createEvent({ id: "templiers", slug: "templiers", name: "Festival des Templiers" });
  const race = createRace(event, { name: "Grand Trail des Templiers", shortName: "Grand Trail" });
  const entry = createRaceEntry({
    event,
    race,
    edition: createEdition(2026, {
      distanceKm: 80,
      gpxUrl: "https://tracedetrail.fr/download/getFile/tracedetrail?traceID=old&format=gpx",
      sources: [
        {
          url: "https://organizer.test/grand-trail/",
          type: "official-race-page",
          retrievedAt: "2026-08-12T10:00:00.000Z",
          event: event.name,
          race: race.shortName,
        },
      ],
    }),
  });
  const traceEventHtml = `
    <button class="nav-link navlinkEventDownloads" data-id=325091>
      <span class="traceTabDistance">101.8 km</span><br><span class="traceTabNom">Endurance Trail</span>
    </button>
    <button class="nav-link navlinkEventDownloads" data-id=325090>
      <span class="traceTabDistance">79.8 km</span><br><span class="traceTabNom">Grand Trail des Templiers</span>
    </button>
  `;
  const pageCache = new Map([
    ["https://organizer.test/grand-trail/", {
      url: "https://organizer.test/grand-trail/",
      finalUrl: "https://organizer.test/grand-trail/",
      content: '<a href="https://tracedetrail.fr/fr/event/hoka-les-templiers-2026">PARCOURS</a>',
    }],
    ["https://tracedetrail.fr/fr/event/hoka-les-templiers-2026", {
      url: "https://tracedetrail.fr/fr/event/hoka-les-templiers-2026",
      finalUrl: "https://tracedetrail.fr/fr/event/hoka-les-templiers-2026",
      content: traceEventHtml,
    }],
  ]);

  const traces = parseTraceDeTrailEventTraces(traceEventHtml);
  const candidate = await findGpxCandidate(entry, { pageCache });

  assert.equal(traces.length, 2);
  assert.equal(traces[1].id, "325090");
  assert.equal(candidate.sourceType, "official-map-platform");
  assert.equal(candidate.sourcePlatform, "trace-de-trail");
  assert.equal(candidate.sourceUrl, "https://tracedetrail.fr/fr/trace/325090");
  assert.equal(candidate.downloadUrl, "https://tracedetrail.fr/download/getFile/tracedetrail");
  assert.equal(candidate.request.method, "POST");
  assert.equal(candidate.downloadParams.traceID, "325090");
  assert.deepEqual(candidate.fallbackDownloads, [
    {
      downloadUrl: "https://tracedetrail.fr/fr/trace/325090",
      displayDownloadUrl: "https://tracedetrail.fr/fr/trace/325090",
    },
  ]);
});

test("falls back to public Trace de Trail geometry when GPX download requires login", async () => {
  const outDir = await mkdtemp(join(tmpdir(), "trailcompare-tracedetrail-public-geometry-"));
  const traceUrl = "https://tracedetrail.fr/fr/iframe/337955";
  const postUrl = "https://tracedetrail.fr/download/getFile/tracedetrail";
  const event = createEvent({ id: "maxi-race", slug: "maxi-race", name: "MaXi-Race" });
  const race = createRace(event, { name: "tOur du Lac solo", shortName: "tOur solo" });
  const entry = createRaceEntry({
    event,
    race,
    edition: createEdition(2026, {
      distanceKm: null,
      rawOfficial: { traceId: "337955" },
      sources: [
        {
          url: traceUrl,
          type: "official-map-platform",
          retrievedAt: "2026-08-14T10:00:00.000Z",
          event: event.name,
          race: race.shortName,
        },
      ],
    }),
  });
  const traceHtml = `<!doctype html>
<html>
  <head><title>Iframe Trace de Trail : tOur du Lac solo</title></head>
  <body>
    <script>
      initBlocProfilTrace({
        dataTrace: {
          traceID: 337955,
          distance: 100,
          geometry: "[{\\"lon\\":682868.2,\\"lat\\":5763818.7,\\"y0\\":447,\\"y\\":447,\\"instruction\\":\\"Sentier de l\\'Oratoire\\"},{\\"lon\\":682841.5,\\"lat\\":5763847.5,\\"y0\\":448,\\"y\\":448},{\\"lon\\":682824.8,\\"lat\\":5763865.1,\\"y0\\":451,\\"y\\":451}]"
        }
      });
    </script>
  </body>
</html>`;
  const pageCache = new Map([
    [traceUrl, {
      url: traceUrl,
      finalUrl: traceUrl,
      content: traceHtml,
    }],
  ]);
  const requested = [];

  await collectGpxForEntry(entry, {
    outDir,
    pageCache,
    fetchImpl: async (url) => {
      requested.push(url);
      if (url === postUrl) {
        return new Response('{"error":"connectez-vous pour télécharger ce GPX"}', {
          headers: { "content-type": "application/json" },
        });
      }
      assert.equal(url, traceUrl);
      return new Response(traceHtml, {
        headers: { "content-type": "text/html" },
      });
    },
  });

  assert.deepEqual(requested, [postUrl, traceUrl]);
  assert.equal(entry.edition.gpx.status, "available");
  assert.equal(entry.edition.gpx.sourcePlatform, "trace-de-trail");
  assert.equal(entry.edition.gpx.sourceUrl, traceUrl);
  assert.equal(entry.edition.gpx.downloadUrl, traceUrl);
  assert.equal(entry.edition.gpx.downloadMethod, "GET");

  const stored = await readFile(join(outDir, entry.edition.gpx.localFile), "utf8");
  assert.match(stored, /<gpx\b/);
  assert.match(stored, /<trkpt lat="45\.8967\d*" lon="6\.1343\d*">/);
  assert.match(stored, /<ele>447<\/ele>/);
});

test("collects a multi-stage race from official Trace de Trail stage geometries", async () => {
  const outDir = await mkdtemp(join(tmpdir(), "trailcompare-tracedetrail-multistage-"));
  const stage1Url = "https://tracedetrail.fr/fr/iframe/337955";
  const stage2Url = "https://tracedetrail.fr/fr/iframe/317545";
  const postUrl = "https://tracedetrail.fr/download/getFile/tracedetrail";
  const event = createEvent({ id: "maxi-race", slug: "maxi-race", name: "MaXi-Race" });
  const race = createRace(event, { name: "tOur du Lac en deux jours", shortName: "tOur 2 jours" });
  const entry = createRaceEntry({
    event,
    race,
    edition: createEdition(2026, {
      distanceKm: null,
      gpx: {
        status: "multi-stage",
        sourcePlatform: "trace-de-trail",
        traces: [stage1Url, stage2Url],
      },
      rawOfficial: { traceIds: ["337955", "317545"] },
      sources: [
        {
          url: "https://www.maxi-race.org/tour-du-lac-solo-en-2jours/",
          type: "official-race-page",
          retrievedAt: "2026-08-14T10:00:00.000Z",
          event: event.name,
          race: race.shortName,
        },
      ],
    }),
  });
  const stageHtml = (traceId, offset) => `<!doctype html>
<html>
  <head><title>Iframe Trace de Trail : stage ${traceId}</title></head>
  <body>
    <script>
      initBlocProfilTrace({
        dataTrace: {
          traceID: ${traceId},
          geometry: "[{\\"lon\\":${682868.2 + offset},\\"lat\\":5763818.7,\\"y0\\":447,\\"y\\":447},{\\"lon\\":${682841.5 + offset},\\"lat\\":5763847.5,\\"y0\\":448,\\"y\\":448},{\\"lon\\":${682824.8 + offset},\\"lat\\":5763865.1,\\"y0\\":451,\\"y\\":451}]"
        }
      });
    </script>
  </body>
</html>`;
  const pageCache = new Map([
    [stage1Url, { url: stage1Url, finalUrl: stage1Url, content: stageHtml("337955", 0) }],
    [stage2Url, { url: stage2Url, finalUrl: stage2Url, content: stageHtml("317545", 100) }],
  ]);

  await collectGpxForEntry(entry, {
    outDir,
    pageCache,
    fetchImpl: async (url) => {
      if (url === postUrl) {
        return new Response('{"error":"connectez-vous"}', {
          headers: { "content-type": "application/json" },
        });
      }
      if (url === stage1Url) {
        return new Response(stageHtml("337955", 0), {
          headers: { "content-type": "text/html" },
        });
      }
      if (url === stage2Url) {
        return new Response(stageHtml("317545", 100), {
          headers: { "content-type": "text/html" },
        });
      }
      throw new Error(`Unexpected URL ${url}`);
    },
  });

  assert.equal(entry.edition.gpx.status, "available");
  assert.equal(entry.edition.gpx.multiStage, true);
  assert.deepEqual(entry.edition.gpx.stageSourceUrls, [stage1Url, stage2Url]);
  assert.deepEqual(entry.edition.gpx.stageDownloadUrls, [stage1Url, stage2Url]);

  const stored = await readFile(join(outDir, entry.edition.gpx.localFile), "utf8");
  assert.equal((stored.match(/<trkseg>/g) ?? []).length, 2);
});

test("collects GPX for an entry, writes original and route asset, and warns on SHA changes", async () => {
  const gpx = await readFile(join(fixtures, "valid.gpx"));
  const outDir = await mkdtemp(join(tmpdir(), "trailcompare-gpx-"));
  const event = createEvent({
    id: "fixture",
    slug: "fixture",
    name: "Fixture Trail",
    officialWebsite: "https://example.test",
  });
  const race = createRace(event, { name: "115 km", shortName: "115 km" });
  const edition = createEdition(2026, {
    date: "2026-08-12",
    distanceKm: 1,
    elevationGainM: 10,
    maxDurationMinutes: 60,
    gpxUrl: "https://example.test/course.gpx",
    sources: [
      {
        url: "https://example.test/race",
        type: "official-race-page",
        retrievedAt: "2026-08-12T10:00:00.000Z",
        event: event.name,
        race: race.shortName,
      },
    ],
  });
  const entry = createRaceEntry({ event, race, edition });
  entry.quality.warnings.push(GPX_NOT_FOUND_WARNING, "GPX_INVALID: old failed download", "manual warning");
  const previousEntry = JSON.parse(JSON.stringify(entry));
  previousEntry.edition.gpx = { sha256: "previous-sha" };

  await collectGpxForEntry(entry, {
    outDir,
    previousEntry,
    fetchImpl: async () => new Response(gpx, {
      headers: { "content-type": "application/octet-stream" },
    }),
  });

  assert.equal(entry.edition.gpx.status, "available");
  assert.equal(entry.edition.gpx.sha256, sha256Hex(gpx));
  assert.equal(entry.edition.gpx.localFile, "gpx/2026/fixture/115-km.gpx");
  assert.equal(entry.quality.warnings.includes(GPX_NOT_FOUND_WARNING), false);
  assert.equal(entry.quality.warnings.includes("GPX_INVALID: old failed download"), false);
  assert.equal(entry.quality.warnings.includes("manual warning"), true);
  assert.equal(entry.quality.warnings.some((warning) => warning.startsWith("GPX_CHANGED")), true);

  const storedGpx = await readFile(join(outDir, entry.edition.gpx.localFile));
  const routeAsset = JSON.parse(await readFile(join(outDir, entry.edition.gpx.routeAsset), "utf8"));
  assert.equal(storedGpx.equals(gpx), true);
  assert.equal(routeAsset.segments[0].length, 4);
});

test("rejects a GPX whose computed distance is clearly incompatible with the official race distance", async () => {
  const gpx = await readFile(join(fixtures, "valid.gpx"));
  const outDir = await mkdtemp(join(tmpdir(), "trailcompare-gpx-distance-mismatch-"));
  const event = createEvent({ id: "saintelyon", slug: "saintelyon", name: "Saintelyon" });
  const race = createRace(event, { name: "Saintelyon", shortName: "Saintelyon" });
  const entry = createRaceEntry({
    event,
    race,
    edition: createEdition(2026, {
      distanceKm: 80,
      gpxUrl: "https://example.test/short-route.gpx",
      sources: [
        {
          url: "https://example.test/race",
          type: "official-race-page",
          retrievedAt: "2026-08-12T10:00:00.000Z",
          event: event.name,
          race: race.shortName,
        },
      ],
    }),
  });

  await collectGpxForEntry(entry, {
    outDir,
    fetchImpl: async () => new Response(gpx, {
      headers: { "content-type": "application/gpx+xml" },
    }),
  });

  assert.equal(entry.edition.gpx.status, "invalid");
  assert.match(entry.quality.warnings.join("\n"), /GPX distance does not match official distance/);
});

test("rejects a GPX whose computed distance is outside the official race distance range", async () => {
  const gpx = await readFile(join(fixtures, "valid.gpx"));
  const outDir = await mkdtemp(join(tmpdir(), "trailcompare-gpx-distance-range-mismatch-"));
  const event = createEvent({ id: "maxi-race", slug: "maxi-race", name: "MaXi-Race" });
  const race = createRace(event, { name: "tOur du Lac en deux jours", shortName: "tOur 2 jours" });
  const entry = createRaceEntry({
    event,
    race,
    edition: createEdition(2026, {
      distanceKm: null,
      rawOfficial: {
        distanceRangeKm: "104 a 108 km",
      },
      gpxUrl: "https://example.test/short-route.gpx",
      sources: [
        {
          url: "https://example.test/race",
          type: "official-race-page",
          retrievedAt: "2026-08-12T10:00:00.000Z",
          event: event.name,
          race: race.shortName,
        },
      ],
    }),
  });

  await collectGpxForEntry(entry, {
    outDir,
    fetchImpl: async () => new Response(gpx, {
      headers: { "content-type": "application/gpx+xml" },
    }),
  });

  assert.equal(entry.edition.gpx.status, "invalid");
  assert.match(entry.quality.warnings.join("\n"), /official distance range/);
});

test("rejects a GPX outside the configured official race area", async () => {
  const gpx = await readFile(join(fixtures, "valid.gpx"));
  const outDir = await mkdtemp(join(tmpdir(), "trailcompare-gpx-bounds-mismatch-"));
  const event = createEvent({ id: "saintelyon", slug: "saintelyon", name: "Saintelyon" });
  const race = createRace(event, { name: "SaintExpress", shortName: "SaintExpress" });
  const entry = createRaceEntry({
    event,
    race,
    edition: createEdition(2026, {
      distanceKm: null,
      rawOfficial: {
        routeBounds: {
          minLat: 45.25,
          maxLat: 45.9,
          minLon: 4.0,
          maxLon: 5.1,
        },
      },
      gpxUrl: "https://example.test/wrong-area.gpx",
      sources: [
        {
          url: "https://example.test/race",
          type: "official-race-page",
          retrievedAt: "2026-08-12T10:00:00.000Z",
          event: event.name,
          race: race.shortName,
        },
      ],
    }),
  });

  await collectGpxForEntry(entry, {
    outDir,
    fetchImpl: async () => new Response(gpx, {
      headers: { "content-type": "application/gpx+xml" },
    }),
  });

  assert.equal(entry.edition.gpx.status, "invalid");
  assert.match(entry.quality.warnings.join("\n"), /outside the expected official race area/);
});

test("retains the previous valid GPX metadata when a refresh download is unavailable", async () => {
  const event = createEvent({
    id: "fixture",
    slug: "fixture",
    name: "Fixture Trail",
    officialWebsite: "https://example.test",
  });
  const race = createRace(event, { name: "42 km", shortName: "42 km" });
  const edition = createEdition(2026, {
    distanceKm: 42,
    gpxUrl: "https://example.test/course.gpx",
    sources: [
      {
        url: "https://example.test/race",
        type: "official-race-page",
        retrievedAt: "2026-08-12T10:00:00.000Z",
        event: event.name,
        race: race.shortName,
      },
    ],
  });
  const entry = createRaceEntry({ event, race, edition });
  const previousEntry = JSON.parse(JSON.stringify(entry));
  previousEntry.edition.gpxUrl = "https://example.test/course.gpx";
  previousEntry.edition.gpx = {
    status: "available",
    sourceUrl: "https://example.test/race",
    downloadUrl: "https://example.test/course.gpx",
    sourceType: "official-race-page",
    retrievedAt: "2026-08-12T10:00:00.000Z",
    localFile: "gpx/2026/fixture/42-km.gpx",
    routeAsset: "generated/routes/fixture-42-km-2026.json",
    sha256: "previous-sha",
    trackCount: 1,
    pointCount: 12,
    hasElevation: true,
    computed: { distanceKm: 42.1 },
  };

  await collectGpxForEntry(entry, {
    previousEntry,
    fetchImpl: async () => {
      throw new Error("network down");
    },
  });

  assert.equal(entry.edition.gpx.status, "available");
  assert.equal(entry.edition.gpx.sha256, "previous-sha");
  assert.equal(entry.edition.gpx.refreshStatus, "unavailable");
  assert.equal(entry.quality.warnings.some((warning) => warning.startsWith("GPX_REFRESH_FAILED")), true);
});

function createStoredZip(fileName, content) {
  const name = Buffer.from(fileName, "utf8");
  const header = Buffer.alloc(30);
  header.writeUInt32LE(0x04034b50, 0);
  header.writeUInt16LE(20, 4);
  header.writeUInt16LE(0, 6);
  header.writeUInt16LE(0, 8);
  header.writeUInt32LE(0, 10);
  header.writeUInt32LE(0, 14);
  header.writeUInt32LE(content.length, 18);
  header.writeUInt32LE(content.length, 22);
  header.writeUInt16LE(name.length, 26);
  header.writeUInt16LE(0, 28);
  return Buffer.concat([header, name, content]);
}
