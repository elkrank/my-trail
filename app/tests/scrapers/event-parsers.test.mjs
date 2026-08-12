import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { extractIllustration, extractNextData, parseDate, stripHtml } from "../../scrapers/common/parse.mjs";
import { parseMainInfo, extractGpxUrl, minimumWaterLiters } from "../../scrapers/events/ecotrail/index.mjs";
import { parseHeaderFields } from "../../scrapers/events/saintelyon/index.mjs";
import { parseAidStations } from "../../scrapers/events/templiers/index.mjs";
import { buildAidStations, buildCheckpoints as buildUtmbCheckpoints } from "../../scrapers/events/utmb/index.mjs";
import { buildCheckpoints as buildNtmfCheckpoints, parsePrices, parseStats } from "../../scrapers/events/ntmf/index.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixtures = join(__dirname, "..", "fixtures", "scrapers");

test("parses UTMB embedded profile checkpoints and aid stations", async () => {
  const html = await readFile(join(fixtures, "utmb-next-data.html"), "utf8");
  const data = extractNextData(html).props.pageProps;
  const checkpoints = buildUtmbCheckpoints(data.track.points, data.pageHeader.startDateIso);
  const aidStations = buildAidStations(data.track.points, data.pageHeader.startDateIso);

  assert.equal(checkpoints.length, 1);
  assert.equal(checkpoints[0].distanceKm, 12);
  assert.equal(checkpoints[0].cutoffElapsedMinutes, 270);
  assert.equal(checkpoints[0].personalAssistanceAllowed, true);
  assert.equal(aidStations.length, 1);
  assert.equal(aidStations[0].solidFood, true);
});

test("parses EcoTrail main information despite nested markup", async () => {
  const html = await readFile(join(fixtures, "ecotrail-race.html"), "utf8");
  const labels = parseMainInfo(html);

  assert.equal(labels.Distance, "80 km");
  assert.equal(labels["D+"], "1100 m");
  assert.equal(labels["Temps limite"], "12h");
  assert.equal(extractGpxUrl(html, "https://www.ecotrailparis.com/course/test"), "https://www.ecotrailparis.com/assets/trail-80.gpx");
  assert.equal(extractIllustration(html, "https://www.ecotrailparis.com/course/test"), "https://www.ecotrailparis.com/assets/trail-80.jpg");
  assert.equal(minimumWaterLiters(stripHtml(html)), 1.5);
});

test("parses NTMF route stats and prices from official text", async () => {
  const text = await readFile(join(fixtures, "ntmf-rules.txt"), "utf8");
  const stats = parseStats(text);
  const prices = parsePrices(text);

  assert.equal(stats.get(115).elevationGainM, 2150);
  assert.equal(stats.get(30).startTime, "04:00");
  assert.equal(prices.get(13), 26);
  assert.equal(prices.get(115), 105);
});

test("builds NTMF 115 km checkpoints from official FR cutoffs", () => {
  const checkpoints = buildNtmfCheckpoints().get(115);
  const boescheppe = checkpoints.find((checkpoint) => checkpoint.name === "Boescheppe");

  assert.equal(boescheppe.distanceKm, 74.5);
  assert.equal(boescheppe.cutoffDateTime, "2026-04-19T13:00:00");
  assert.equal(boescheppe.cutoffElapsedMinutes, 660);
});

test("parses Saintelyon header fields", async () => {
  const html = await readFile(join(fixtures, "saintelyon-header.html"), "utf8");
  const fields = parseHeaderFields(html);

  assert.equal(parseDate(fields.DATE, 2026), "2026-11-28");
  assert.equal(fields["HEURE DE DÉPART"], "23h30");
  assert.equal(fields["LIEU DE DÉPART"], "Saint-Étienne");
});

test("parses Templiers aid station names and access warning", async () => {
  const text = await readFile(join(fixtures, "templiers-aid.txt"), "utf8");
  const aidStations = parseAidStations(text);

  assert.equal(aidStations.length, 5);
  assert.equal(aidStations[0].name, "Le Rozier");
  assert.equal(aidStations[1].crewAccess, false);
});
