import test from "node:test";
import assert from "node:assert/strict";
import {
  createDataAvailability,
  createEdition,
  createEvent,
  createRace,
  createRaceEntry,
} from "../../scrapers/common/model.mjs";
import { stableJson } from "../../scrapers/common/export.mjs";
import { validateEntry, validateResult } from "../../scrapers/common/validate.mjs";

const sourceUrl = "https://official.example/2026";
const checkedAt = "2026-08-21T10:00:00.000Z";

test("empty aid-station array with known_none is complete", () => {
  const entry = completeEntry({
    aidStations: [],
    dataAvailability: {
      aidStations: availability("known_none"),
    },
  });
  validateEntry(entry);
  assert.equal(entry.quality.logisticsCompleteness, "complete");
  assert.equal(entry.quality.missingFields.includes("aidStations"), false);
});

test("absent maximum time and checkpoints with not_applicable keep sport complete", () => {
  const entry = completeEntry({
    maxDurationMinutes: null,
    checkpoints: [],
    dataAvailability: {
      maxDurationMinutes: availability("not_applicable"),
      checkpoints: availability("not_applicable"),
    },
  });
  validateEntry(entry);
  assert.equal(entry.quality.sportCompleteness, "complete");
  assert.equal(entry.quality.missingFields.includes("maxDuration"), false);
});

test("not_published remains explicitly unavailable", () => {
  const entry = completeEntry({
    elevationGainM: null,
    dataAvailability: { elevationGainM: availability("not_published") },
  });
  validateEntry(entry);
  assert.equal(entry.quality.sportCompleteness, "partial");
  assert.equal(entry.quality.missingFields.includes("elevationGain"), true);
  assert.equal(entry.edition.dataAvailability.elevationGainM.status, "not_published");
});

test("official source with parser failure is extraction_error", () => {
  const entry = completeEntry({
    aidStations: [],
    dataAvailability: { aidStations: availability("extraction_error") },
  });
  validateEntry(entry);
  assert.equal(entry.quality.logisticsCompleteness, "partial");
  assert.equal(entry.quality.status, "partial");
});

test("GPX extraction diagnostics remain serializable without becoming invalid", () => {
  const entry = completeEntry({
    gpx: { status: "invalid", sourceUrl, reason: "Downloaded file is not GPX XML." },
    dataAvailability: { gpx: availability("extraction_error") },
  });
  validateEntry(entry);
  assert.equal(entry.quality.logisticsCompleteness, "partial");
  assert.equal(entry.quality.status, "partial");
  assert.doesNotMatch(entry.quality.warnings.join("\n"), /contains a usable value/);
});

test("legacy unavailable GPX metadata is inferred as an extraction error", () => {
  const entry = completeEntry({
    gpx: { status: "unavailable", sourceUrl, retrievedAt: checkedAt },
  });
  validateEntry(entry);
  assert.equal(entry.quality.logisticsCompleteness, "partial");
  assert.equal(entry.quality.status, "partial");
});

test("unknown price does not make sport completeness partial", () => {
  const entry = completeEntry({
    registration: { priceEur: null, url: sourceUrl, status: "open" },
    dataAvailability: { registration: { priceEur: createDataAvailability("unknown") } },
  });
  validateEntry(entry);
  assert.equal(entry.quality.sportCompleteness, "complete");
  assert.equal(entry.quality.registrationCompleteness, "partial");
  assert.equal(entry.quality.status, "partial");
});

test("legacy entries infer known values and keep empty arrays unknown", () => {
  const complete = completeEntry();
  validateEntry(complete);
  assert.equal(complete.quality.status, "complete");

  const legacyEmpty = completeEntry({ aidStations: [] });
  validateEntry(legacyEmpty);
  assert.equal(legacyEmpty.quality.logisticsCompleteness, "partial");
  assert.equal(legacyEmpty.quality.missingFields.includes("aidStations"), true);
});

test("already complete legacy course remains complete", () => {
  const entry = completeEntry({ elevationGainM: 0 });
  validateEntry(entry);
  assert.equal(entry.quality.status, "complete");
  assert.deepEqual(entry.quality.missingFields, []);
});

test("new availability format serializes and validates", () => {
  const entry = completeEntry({
    aidStations: [],
    dataAvailability: { aidStations: availability("known_none") },
  });
  const parsed = JSON.parse(stableJson(entry));
  validateEntry(parsed);
  assert.equal(parsed.edition.dataAvailability.aidStations.status, "known_none");
  assert.equal(parsed.quality.status, "complete");
});

test("global result and three sub-statuses follow strict synthesis", () => {
  const sportOnly = completeEntry({
    aidStations: [],
    registration: { priceEur: null, url: sourceUrl, status: "open" },
    dataAvailability: {
      aidStations: availability("not_published"),
      registration: { priceEur: createDataAvailability("unknown") },
    },
  });
  const result = validateResult({ event: sportOnly.event, sourceErrors: [], races: [sportOnly] });
  assert.equal(result.status, "PARTIAL");
  assert.equal(result.races[0].quality.sportCompleteness, "complete");
  assert.equal(result.races[0].quality.logisticsCompleteness, "partial");
  assert.equal(result.races[0].quality.registrationCompleteness, "partial");
  assert.equal(result.races[0].quality.status, "partial");
});

test("invalid availability metadata is rejected by quality validation", () => {
  const entry = completeEntry({
    dataAvailability: {
      aidStations: { status: "known_none", sourceUrl: "javascript:alert(1)", checkedAt: "not-a-date" },
    },
  });
  entry.edition.aidStations = [];
  validateEntry(entry);
  assert.equal(entry.quality.status, "invalid");
  assert.match(entry.quality.warnings.join("\n"), /sourceUrl must be HTTP/);
  assert.match(entry.quality.warnings.join("\n"), /checkedAt must be an ISO date/);
});

test("checkpoint distance validation uses the effective distance and accepts an explicit nominal distance", () => {
  const valid = completeEntry({
    distanceKm: 80,
    nominalDistanceKm: 80,
    effectiveDistanceKm: 82,
    checkpoints: [{ name: "Arrivée", distanceKm: 82, cutoffElapsedMinutes: 240 }],
  });
  validateEntry(valid);
  assert.doesNotMatch(valid.quality.warnings.join("\n"), /exceeds effective race distance/);

  const invalid = completeEntry({
    distanceKm: 80,
    nominalDistanceKm: 80,
    effectiveDistanceKm: 82,
    checkpoints: [{ name: "Après arrivée", distanceKm: 83, cutoffElapsedMinutes: 240 }],
  });
  validateEntry(invalid);
  assert.equal(invalid.quality.status, "invalid");
  assert.match(invalid.quality.warnings.join("\n"), /83 km exceeds effective race distance 82 km/);
});

function completeEntry(overrides = {}) {
  const event = createEvent({ id: "fixture", name: "Fixture", slug: "fixture" });
  const race = createRace(event, { id: "fixture-race", name: "Fixture Race", shortName: "Fixture" });
  return createRaceEntry({
    event,
    race,
    edition: createEdition(2026, {
      date: "2026-09-01",
      distanceKm: 20,
      elevationGainM: 500,
      maxDurationMinutes: 240,
      checkpoints: [{ name: "Finish", distanceKm: 20, cutoffElapsedMinutes: 240 }],
      aidStations: [{ name: "Aid", distanceKm: 10 }],
      gpx: { status: "available", sourceUrl },
      registration: { priceEur: 25, url: sourceUrl, status: "open" },
      sources: [{ url: sourceUrl, type: "official-race-page", retrievedAt: checkedAt }],
      ...overrides,
    }),
  });
}

function availability(status) {
  return createDataAvailability(status, { sourceUrl, checkedAt, reason: "Fixture evidence." });
}
