import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { collectGpxForEntry, GPX_NOT_FOUND_WARNING } from "../../scrapers/common/gpx.mjs";
import { createEdition, createEvent, createRace, createRaceEntry, createSource } from "../../scrapers/common/model.mjs";
import {
  buildMarathonMontBlancEntry,
  MARATHON_MONT_BLANC_RACES,
  parseMarathonMontBlancPage,
} from "../../scrapers/events/marathon-mont-blanc/index.mjs";
import {
  buildMaxiRaceEntry,
  MAXI_RACE_RACES,
  parseDistanceRange,
  parseMaxiRaceTraceEvent,
} from "../../scrapers/events/maxi-race/index.mjs";
import {
  parseTrailAlsaceRacePage,
  parseUtmbIndexRacePage,
  TRAIL_ALSACE_RACES,
} from "../../scrapers/events/trail-alsace/index.mjs";
import { extractCalameoBookUrl } from "../../scrapers/events/ultra-marin/index.mjs";
import {
  buildUltraMarinEntry,
  parseUltraMarinRacePage,
  ULTRA_MARIN_RACES,
} from "../../scrapers/events/ultra-marin/index.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixtures = join(__dirname, "..", "fixtures", "scrapers");
const retrievedAt = "2026-08-12T10:00:00.000Z";

test("Ultra Marin parses distance, D+, date, time, max duration and relay type", async () => {
  const event = createEvent({ id: "ultra-marin", slug: "ultra-marin", name: "Ultra Marin" });
  const grandRaidHtml = await readFile(join(fixtures, "ultra-marin-grand-raid.html"), "utf8");
  const grandRaid = parseUltraMarinRacePage(grandRaidHtml, { year: 2026 });

  assert.equal(grandRaid.distanceKm, 175);
  assert.equal(grandRaid.elevationGainM, 1430);
  assert.equal(grandRaid.date, "2026-06-26");
  assert.equal(grandRaid.startTime, "19:00");
  assert.equal(grandRaid.maxDurationMinutes, 2520);

  const relayHtml = await readFile(join(fixtures, "ultra-marin-grand-relais.html"), "utf8");
  const relay = buildUltraMarinEntry({
    event,
    raceConfig: ULTRA_MARIN_RACES.find((race) => race.slug === "grand-relais"),
    page: page("https://www.ultra-marin.fr/grand-relais-175km", relayHtml),
    year: 2026,
  });

  assert.equal(relay.edition.raceType, "relay");
  assert.equal(relay.edition.startTime, "20:00");
  assert.equal(relay.edition.date, null);
  assert.equal(relay.edition.gpx, null);
});

test("Ultra Marin accepts only the public Calameo book URL exposed by the official guide page", () => {
  const url = extractCalameoBookUrl('<a href="https://www.calameo.com/read/008167820d06fe08ac749">Guide coureur</a>');
  assert.equal(url, "https://www.calameo.com/books/008167820d06fe08ac749");
  assert.equal(extractCalameoBookUrl('<img src="https://i.calameoassets.com/ephemeral/page-1.jpg">'), null);
});

test("Marathon du Mont-Blanc parses the six adult formats and rejects youth-only configs", async () => {
  const html = await readFile(join(fixtures, "marathon-mont-blanc-90.html"), "utf8");
  const parsed = parseMarathonMontBlancPage(html, { year: 2026 });
  const event = createEvent({ id: "marathon-mont-blanc", slug: "marathon-mont-blanc", name: "Marathon du Mont-Blanc" });
  const raceConfig = MARATHON_MONT_BLANC_RACES.find((race) => race.slug === "90km");
  const entry = buildMarathonMontBlancEntry({
    event,
    raceConfig,
    page: page("https://www.marathonmontblanc.fr/courses/90km-du-mont-blanc", html),
    shared: {
      registration: page("https://www.marathonmontblanc.fr/coureurs/inscriptions", "<main>Tarifs 2026</main>"),
      rules: page("https://www.marathonmontblanc.fr/coureurs/reglement-des-courses", "<main>Règlement 2026</main>"),
    },
    year: 2026,
  });

  assert.equal(MARATHON_MONT_BLANC_RACES.length, 6);
  assert.equal(MARATHON_MONT_BLANC_RACES.some((race) => /mini|young/i.test(race.name)), false);
  assert.equal(MARATHON_MONT_BLANC_RACES.find((race) => race.slug === "duo-etoile").raceType, "pair");
  assert.equal(MARATHON_MONT_BLANC_RACES.find((race) => race.slug === "kilometre-vertical").raceType, "vertical kilometer");
  assert.equal(parsed.date, "2026-06-26");
  assert.equal(parsed.startTime, "04:45");
  assert.equal(parsed.distanceKm, 88);
  assert.equal(parsed.elevationGainM, 6200);
  assert.equal(parsed.elevationLossM, 6200);
  assert.equal(parsed.maxDurationMinutes, 1440);
  assert.equal(parsed.checkpoints.length, 3);
  assert.equal(parsed.aidStations.some((station) => station.name === "Buet"), true);
  assert.equal(parsed.minimumWaterLiters, 1.5);
  assert.equal(entry.edition.registration.priceEur, 140);
});

test("MaXi-Race extracts requested adult formats, exact values and range warnings", async () => {
  const traceHtml = await readFile(join(fixtures, "maxi-race-trace-event.html"), "utf8");
  const traceStats = parseMaxiRaceTraceEvent(traceHtml);
  const event = createEvent({ id: "maxi-race", slug: "maxi-race", name: "MaXi-Race du lac d'Annecy" });
  const traceEvent = page("https://tracedetrail.fr/fr/event/adidas-terrex-maxi-race-2026", traceHtml);
  const solo = buildMaxiRaceEntry({
    event,
    raceConfig: MAXI_RACE_RACES.find((race) => race.slug === "tour-du-lac-solo"),
    page: page("https://www.maxi-race.org/tour-du-lac-solo/", '<main>Samedi 29 mai 2027 <a href="https://tracedetrail.fr/fr/trace/337955">Trace 2026 disponible</a></main>'),
    traceEvent,
    traceStats,
    year: 2026,
  });
  const stage = buildMaxiRaceEntry({
    event,
    raceConfig: MAXI_RACE_RACES.find((race) => race.slug === "tour-du-lac-2-jours"),
    page: page("https://www.maxi-race.org/tour-du-lac-solo-en-2jours/", "<main>29 et 30 mai 2027 Distance 104 à 108 km</main>"),
    traceEvent,
    traceStats,
    year: 2026,
  });

  assert.equal(MAXI_RACE_RACES.length, 6);
  assert.equal(MAXI_RACE_RACES.some((race) => /ado|mini|orientation/i.test(race.name)), false);
  assert.equal(solo.edition.distanceKm, 100);
  assert.equal(solo.edition.elevationGainM, 5446);
  assert.equal(MAXI_RACE_RACES.find((race) => race.slug === "tour-du-lac-relais").raceType, "relay");
  assert.equal(stage.edition.raceType, "stage race");
  assert.equal(stage.edition.distanceKm, null);
  assert.equal(stage.edition.gpx.status, "multi-stage");
  assert.deepEqual(parseDistanceRange("100 à 105 km"), { distanceKm: null, raw: "100 à 105 km" });
});

test("Trail Alsace parses UTMB Index 2026 data and reuses UTMB structured checkpoints", async () => {
  const indexHtml = await readFile(join(fixtures, "trail-alsace-index.html"), "utf8");
  const raceHtml = await readFile(join(fixtures, "trail-alsace-race-next-data.html"), "utf8");
  const oldRaceHtml = await readFile(join(fixtures, "trail-alsace-race-2027.html"), "utf8");
  const index = parseUtmbIndexRacePage(indexHtml, { year: 2026 });
  const race = parseTrailAlsaceRacePage(raceHtml, { year: 2026 });
  const rejected = parseTrailAlsaceRacePage(oldRaceHtml, { year: 2026 });

  assert.equal(TRAIL_ALSACE_RACES.length, 5);
  assert.equal(TRAIL_ALSACE_RACES.some((config) => /ecuyer|young|kid/i.test(config.name)), false);
  assert.equal(index.date, "2026-05-15");
  assert.equal(index.distanceKm, 158);
  assert.equal(index.elevationGainM, 5100);
  assert.equal(index.resultCount, 837);
  assert.equal(race.targetYear, true);
  assert.equal(race.startLocation, "Barr");
  assert.equal(race.startTime, "13:00");
  assert.equal(race.maxDurationMinutes, 360);
  assert.equal(race.checkpoints.length, 2);
  assert.equal(race.aidStations.length, 2);
  assert.equal(rejected.targetYear, false);
  assert.equal(rejected.startTime, null);

  const rejectedWithYearGpx = parseTrailAlsaceRacePage(
    '<script id="__NEXT_DATA__" type="application/json">{"props":{"pageProps":{"pageHeader":{"startDateIso":"2027-05-14T17:00:00"},"gpxUrl":"https://res.cloudinary.com/utmb-world/raw/upload/v1/alsace/GPX%202026/2026_tage_utdc.gpx"}}}</script>',
    { year: 2026 },
  );
  assert.equal(rejectedWithYearGpx.targetYear, false);
  assert.equal(rejectedWithYearGpx.startTime, null);
  assert.equal(rejectedWithYearGpx.gpxUrl, "https://res.cloudinary.com/utmb-world/raw/upload/v1/alsace/GPX%202026/2026_tage_utdc.gpx");
});

test("common quality rules keep nulls, reject non-official sources and preserve stable ids", async () => {
  assert.throws(
    () => createSource({ url: "https://blog.example/race", type: "blog", retrievedAt, event: "Fixture" }),
    /Unsupported source type/,
  );

  const event = createEvent({ id: "fixture", slug: "fixture", name: "Fixture" });
  const race = createRace(event, { id: "fixture-stage", name: "Stage", shortName: "Stage" });
  const entry = createRaceEntry({
    event,
    race,
    edition: createEdition(2026, {
      distanceKm: null,
      gpx: { status: "multi-stage", traces: ["https://tracedetrail.fr/fr/trace/1"] },
    }),
  });

  await collectGpxForEntry(entry, {
    fetchImpl: async () => {
      throw new Error("network must not be called");
    },
  });

  assert.equal(entry.edition.distanceKm, null);
  assert.equal(entry.edition.gpx.status, "unavailable");
  assert.equal(entry.quality.warnings.includes(GPX_NOT_FOUND_WARNING), true);

  const ids = [
    ...ULTRA_MARIN_RACES.map((config) => `ultra-marin-${config.slug}`),
    ...MARATHON_MONT_BLANC_RACES.map((config) => `marathon-mont-blanc-${config.slug}`),
    ...MAXI_RACE_RACES.map((config) => `maxi-race-${config.slug}`),
    ...TRAIL_ALSACE_RACES.map((config) => `trail-alsace-${config.slug}`),
  ];
  assert.equal(new Set(ids).size, ids.length);
  assert.deepEqual(ids, [...ids].sort((a, b) => ids.indexOf(a) - ids.indexOf(b)));
});

test("Trace de Trail authentication JSON is treated as unavailable GPX", async () => {
  const event = createEvent({ id: "maxi-race", slug: "maxi-race", name: "MaXi-Race" });
  const race = createRace(event, { id: "maxi-race-tour-du-lac-solo", name: "tOur", shortName: "tOur solo" });
  const entry = createRaceEntry({
    event,
    race,
    edition: createEdition(2026, {
      distanceKm: 100,
      rawOfficial: { traceIds: ["337955"] },
      sources: [{
        url: "https://tracedetrail.fr/fr/trace/337955",
        type: "official-map-platform",
        retrievedAt,
        event: event.name,
        race: race.shortName,
      }],
    }),
  });
  const pageCache = new Map([[
    "https://tracedetrail.fr/fr/trace/337955",
    {
      url: "https://tracedetrail.fr/fr/trace/337955",
      finalUrl: "https://tracedetrail.fr/fr/trace/337955",
      content: "<title>Trace de Trail : MaaXi 26 - trace pour coureur</title>100 km 5446 m 5444 m",
    },
  ]]);

  await collectGpxForEntry(entry, {
    pageCache,
    fetchImpl: async () => new Response(
      JSON.stringify({ success: 0, msg: "Connectez-vous avec votre compte utilisateur pour télécharger ce fichier" }),
      { headers: { "content-type": "text/html; charset=UTF-8" } },
    ),
  });

  assert.equal(entry.edition.gpx.status, "unavailable");
  assert.equal(entry.quality.warnings.some((warning) => warning === "GPX officiel non trouvÃ©" || warning === "GPX officiel non trouvé"), true);
  assert.equal(entry.quality.warnings.some((warning) => warning.startsWith("GPX_UNAVAILABLE")), true);
});

function page(url, content) {
  return {
    url,
    finalUrl: url,
    retrievedAt,
    status: 200,
    contentType: "text/html",
    content,
  };
}
