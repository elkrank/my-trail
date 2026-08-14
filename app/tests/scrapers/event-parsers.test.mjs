import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { extractIllustration, extractNextData, extractRegistrationUrl, parseDate, stripHtml } from "../../scrapers/common/parse.mjs";
import { parseMainInfo, extractGpxUrl, minimumWaterLiters } from "../../scrapers/events/ecotrail/index.mjs";
import { parseHeaderFields, parseSaintelyonCheckpoints } from "../../scrapers/events/saintelyon/index.mjs";
import { parseAidStations, parseTempliersCutoffPdfText } from "../../scrapers/events/templiers/index.mjs";
import { parseGrandRaidBarrierPdf, parseGrandRaidRacePage } from "../../scrapers/events/grand-raid-reunion/index.mjs";
import { buildAidStations, buildCheckpoints as buildUtmbCheckpoints } from "../../scrapers/events/utmb/index.mjs";
import { buildCheckpoints as buildNtmfCheckpoints, parsePrices, parseStats } from "../../scrapers/events/ntmf/index.mjs";
import { parseLiveTrailRacePage } from "../../scrapers/events/ultra-marin/index.mjs";
import { parseMaxiRaceCutoffPdfText } from "../../scrapers/events/maxi-race/index.mjs";

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
  assert.equal(extractRegistrationUrl(html, "https://www.ecotrailparis.com/course/test"), "https://www.ecotrailparis.com/inscriptions/trail-80");
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

test("parses Saintelyon official cutoff clock times as dated checkpoints", () => {
  const checkpoints = parseSaintelyonCheckpoints(
    "Barrieres horaires KM17 Saint-Christo-en-Jarez : 4h00 >KM32 Sainte-Catherine : 7h00 >KM82 Lyon : 16h00 Retrait des dossards",
    { date: "2026-11-28", startTime: "23:30", distanceKm: 82 },
  );

  assert.equal(checkpoints.length, 3);
  assert.equal(checkpoints[0].cutoffDateTime, "2026-11-29T04:00:00");
  assert.equal(checkpoints[0].cutoffElapsedMinutes, 270);
  assert.equal(checkpoints[2].distanceKm, 82);
  assert.equal(checkpoints[2].cutoffElapsedMinutes, 990);
});

test("parses Grand Raid Reunion detail page characteristics and official links", async () => {
  const html = await readFile(join(fixtures, "grand-raid-zembrocal.html"), "utf8");
  const parsed = parseGrandRaidRacePage(html, { year: 2026 });

  assert.equal(parsed.date, "2026-10-15");
  assert.equal(parsed.startTime, "17:00");
  assert.equal(parsed.distanceKm, 160);
  assert.equal(parsed.elevationGainM, 8460);
  assert.equal(parsed.maxDurationMinutes, 2385);
  assert.equal(parsed.priceEur, 390);
  assert.equal(parsed.maxParticipants, 215);
  assert.equal(parsed.traceId, "7027");
  assert.deepEqual(parsed.relayLegsKm, [37, 35, 49, 39]);
  assert.equal(parsed.pdfUrls.length, 2);
});

test("parses Templiers aid station names and access warning", async () => {
  const text = await readFile(join(fixtures, "templiers-aid.txt"), "utf8");
  const aidStations = parseAidStations(text);

  assert.equal(aidStations.length, 5);
  assert.equal(aidStations[0].name, "Le Rozier");
  assert.equal(aidStations[1].crewAccess, false);
});

test("parses Grand Raid Reunion barrier PDF text into dated checkpoints", () => {
  const parsed = parseGrandRaidBarrierPdf(`
DEP
ST Pierre Ravine Blanche
Jeudi
18h00
Jeudi
22h00
0,00,0
O
CP1
Domaine Vidot
Jeudi
22h00
Vendredi
01h30
14,014,0
O
ARR
La Redoute
Vendredi
20h00
Dimanche
16h00
3,0180,6
O
`, {
    date: "2026-10-15",
    startTime: "22:00",
    distanceKm: 180.6,
    maxDurationMinutes: 3960,
  });

  assert.equal(parsed.checkpoints.length, 2);
  assert.equal(parsed.checkpoints[0].name, "Domaine Vidot");
  assert.equal(parsed.checkpoints[0].distanceKm, 14);
  assert.equal(parsed.checkpoints[0].cutoffDateTime, "2026-10-16T01:30:00");
  assert.equal(parsed.checkpoints[0].cutoffElapsedMinutes, 210);
  assert.equal(parsed.checkpoints[1].name, "La Redoute");
  assert.equal(parsed.checkpoints[1].cutoffElapsedMinutes, 3960);
});

test("parses Ultra Marin LiveTrail embedded points with cutoffs", () => {
  const html = `<script>self.__next_f.push([1,"{\\"raceId\\":\\"GdRaid\\",\\"startDate\\":\\"2026-06-26T19:00:00.000+02:00\\"},{\\"access\\":[],\\"altitude\\":3,\\"cutoff\\":\\"2026-06-26T22:30:00.000+02:00\\",\\"distance\\":14697,\\"elevationGain\\":46,\\"pointId\\":2,\\"isAssistance\\":false,\\"isDisabled\\":false,\\"isMeet\\":true,\\"lat\\":47.62,\\"lon\\":-2.77,\\"name\\":\\"Sene Barrarac\\",\\"raceId\\":\\"GdRaid\\",\\"services\\":[\\"DRINK_SUPPLY\\"],\\"shortName\\":\\"Barrarac\\",\\"type\\":\\"SIMPLE\\",\\"livecams\\":[]}"])</script>`;
  const parsed = parseLiveTrailRacePage(html, "GdRaid");

  assert.equal(parsed.date, "2026-06-26");
  assert.equal(parsed.startTime, "19:00");
  assert.equal(parsed.checkpoints.length, 1);
  assert.equal(parsed.checkpoints[0].distanceKm, 14.7);
  assert.equal(parsed.checkpoints[0].cutoffElapsedMinutes, 210);
  assert.equal(parsed.checkpoints[0].aidStation, true);
});

test("parses Templiers cutoff PDF text for a selected race", () => {
  const parsed = parseTempliersCutoffPdfText(`
VENDREDI 16 OCTOBRE 2026
LA CRESSEENDURANCE TRAILEAU17,65h25 - 7h307h15
ARRIVEE
ENDURANCE TRAILRAV99,413h55 - 03h25 (J+1)
`, {
    raceLabel: "ENDURANCE TRAIL",
    date: "2026-10-16",
    startTime: "04:00",
  });

  assert.equal(parsed.checkpoints.length, 2);
  assert.equal(parsed.checkpoints[0].name, "LA CRESSE");
  assert.equal(parsed.checkpoints[0].distanceKm, 17.6);
  assert.equal(parsed.checkpoints[0].cutoffElapsedMinutes, 195);
  assert.equal(parsed.maxDurationMinutes, 1405);
});

test("parses compact Templiers PDF distances before clock times", () => {
  const parsed = parseTempliersCutoffPdfText(`
P 111
ROC DEL MAR
BOFFI FIFTY87h20 - 8h50
LE CADE
BOFFI FIFTYRAV41,710h40 - 18h00
`, {
    raceLabel: "BOFFI FIFTY",
    date: "2026-10-17",
    startTime: "07:30",
    maxRaceDistanceKm: 47,
  });

  assert.equal(parsed.checkpoints.length, 2);
  assert.equal(parsed.checkpoints[0].name, "ROC DEL MAR");
  assert.equal(parsed.checkpoints[0].distanceKm, 8);
  assert.equal(parsed.checkpoints[1].distanceKm, 41.7);
});

test("parses Maxi-Race cutoff PDF text with after-midnight barriers", () => {
  const parsed = parseMaxiRaceCutoffPdfText(`
LieuInfoKmD+ / D-Barriere horaire
Ravitaillement light
17,3921 / 597
2h443h313h45
6h30
Arrivee Parking des Marquisats
1005782 / 5780
12h0516h5117h30
4h20
`, {
    date: "2026-05-30",
    startTime: "01:25",
  });

  assert.equal(parsed.checkpoints.length, 2);
  assert.equal(parsed.checkpoints[0].name, "Ravitaillement light");
  assert.equal(parsed.checkpoints[0].cutoffDateTime, "2026-05-30T06:30:00");
  assert.equal(parsed.checkpoints[1].distanceKm, 100);
  assert.equal(parsed.checkpoints[1].cutoffDateTime, "2026-05-31T04:20:00");
  assert.equal(parsed.maxDurationMinutes, 1615);
});
