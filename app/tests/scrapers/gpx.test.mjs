import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  analyzeGpxBuffer,
  buildRouteAsset,
  collectGpxForEntry,
  extractMapPlatformLinks,
  extractGpxFromZip,
  findGpxCandidate,
  GPX_NOT_FOUND_WARNING,
  parseTraceDeTrailEventTraces,
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
