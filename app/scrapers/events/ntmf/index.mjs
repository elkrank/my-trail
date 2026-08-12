import { fetchText } from "../../common/fetch.mjs";
import {
  createEdition,
  createEvent,
  createIllustration,
  createRace,
  createRaceEntry,
  sourceFromFetch,
} from "../../common/model.mjs";
import { extractIllustration, minutesBetween, parseDate, parseTime, stripHtml, textNoAccents } from "../../common/parse.mjs";

const BASE_URL = "https://www.nordtrailmontsdeflandres.com";
const COURSES_URL = `${BASE_URL}/les-courses`;
const RULES_FR_URL = `${BASE_URL}/reglements-des-courses`;
const RULES_EN_URL = `${BASE_URL}/en/reglements-des-courses`;

const DATE = "2026-04-19";
const RACES = [13, 25, 30, 42, 59, 80, 115];

export async function collect({ year }) {
  const event = createEvent({
    id: "ntmf",
    name: "Nord Trail Monts de Flandres",
    slug: "ntmf",
    country: "France",
    region: "Hauts-de-France",
    city: "Saint-Jans-Cappel",
    officialWebsite: BASE_URL,
  });

  const sourceErrors = [];
  const pages = {};
  for (const [key, url] of Object.entries({
    courses: COURSES_URL,
    rulesFr: RULES_FR_URL,
    rulesEn: RULES_EN_URL,
  })) {
    try {
      pages[key] = await fetchText(url);
    } catch (error) {
      sourceErrors.push({ url, message: error.message, status: error.status ?? null });
    }
  }

  const coursesText = stripHtml(pages.courses?.content ?? "");
  const rulesFrText = stripHtml(pages.rulesFr?.content ?? "");
  const rulesEnText = stripHtml(pages.rulesEn?.content ?? "");
  const stats = parseStats(`${coursesText}\n${rulesFrText}`);
  const prices = parsePrices(rulesEnText || rulesFrText);
  const aidByDistance = parseAidStations(rulesFrText);
  const checkpointsByDistance = buildCheckpoints();

  const races = RACES.map((distance) => {
    const race = createRace(event, {
      name: distance === 30 ? "30 km Nocturne" : `${distance} km`,
      shortName: `${distance} km`,
    });
    const raceStats = stats.get(distance) ?? {};
    const startTime = raceStats.startTime ?? parseTime(`${knownStarts()[distance]}h`);
    const checkpoints = checkpointsByDistance.get(distance) ?? [];
    const sources = [];
    if (pages.courses) sources.push(sourceFromFetch(pages.courses, { type: "official-race-page", event: event.name, race: race.shortName }));
    if (pages.rulesFr) sources.push(sourceFromFetch(pages.rulesFr, { type: "official-rules", event: event.name, race: race.shortName }));
    if (pages.rulesEn) sources.push(sourceFromFetch(pages.rulesEn, { type: "official-rules", event: event.name, race: race.shortName }));
    const illustration = pages.courses
      ? createIllustration({
        url: extractIllustration(pages.courses.content, pages.courses.finalUrl ?? pages.courses.url),
        sourceUrl: pages.courses.finalUrl ?? pages.courses.url,
        event: event.name,
        race: race.shortName,
      })
      : null;

    const warnings = [];

    const edition = createEdition(year, {
      date: parseDate(DATE),
      startTime,
      distanceKm: distance,
      elevationGainM: raceStats.elevationGainM ?? null,
      startLocation: "Saint-Jans-Cappel",
      finishLocation: "Saint-Jans-Cappel",
      maxDurationMinutes: finishDuration(checkpoints),
      raceType: "trail",
      terrainType: "trail",
      nightStart: startTime ? startTime < "06:00" : null,
      illustration,
      registration: {
        priceEur: prices.get(distance) ?? null,
      },
      checkpoints,
      aidStations: aidByDistance.get(distance) ?? [],
      rules: {
        personalAssistanceAllowed: true,
        pacersAllowed: null,
        dropBagAllowed: distance === 115 ? true : null,
        minimumWaterLiters: distance === 13 ? 0.5 : distance >= 30 ? 1.5 : 0.5,
      },
      mandatoryEquipment: mandatoryEquipment(distance),
      sources,
    });

    const entry = createRaceEntry({ event, race, edition });
    entry.quality.warnings = warnings;
    return entry;
  });

  return { event, sourceErrors, races };
}

export function parseStats(text) {
  const output = new Map();
  const plain = textNoAccents(text);
  for (const match of plain.matchAll(/parcours de\s+(\d+)\s*kms?(?:\s+autonomie complete)?\s+avec\s+(\d+)\s*m\s+de\s+denivele\s+positif[.:]?\s*Depart\s+a\s+(\d{1,2})h/gi)) {
    output.set(Number(match[1]), {
      elevationGainM: Number(match[2]),
      startTime: parseTime(`${match[3]}h`),
    });
  }
  return output;
}

export function parsePrices(text) {
  const output = new Map();
  for (const match of text.matchAll(/\b(\d{2,3})\s*km\s*:\s*(?:€\s*)?(\d+)\s*(?:€|euros?)?/gi)) {
    output.set(Number(match[1]), Number(match[2]));
  }
  return output;
}

function parseAidStations(text) {
  return new Map([
    [13, []],
    [25, [station("Moulin de Boeschepe", 13, { solidFood: true })]],
    [30, []],
    [42, [
      station("Moulin de Boeschepe", 21.6, { solidFood: true }),
      station("Parking Cosmos (Mont Rouge)", 34.7, { solidFood: true }),
    ]],
    [59, [
      station("Ravitaillement eau", 17.7, { water: true, solidFood: false }),
      station("Moulin de Boeschepe", 38.1, { solidFood: true }),
      station("Parking Cosmos (Mont Rouge)", 51, { solidFood: true }),
    ]],
    [80, [
      station("Ravitaillement eau", 17.7, { water: true, solidFood: false }),
      station("Moulin de Boeschepe", 38.1, { solidFood: true }),
      station("Parking Cosmos (Mont Rouge)", 51, { solidFood: true }),
      station("Chateau de Kemmel", 60.4, { solidFood: true }),
    ]],
    [115, [
      station("Ravitaillement eau", 17.7, { water: true, solidFood: false }),
      station("Saint Sylvestre (brasserie 3 Monts)", 32.9, { solidFood: true }),
      station("Clocher eglise ville de Eecke", 61, { solidFood: true }),
      station("Moulin de Boeschepe", 74.5, { solidFood: true }),
      station("Parking Cosmos (Mont Rouge)", 87.8, { solidFood: true }),
      station("Chateau de Kemmel", 96.8, { solidFood: true }),
    ]],
  ]);
}

export function buildCheckpoints() {
  return new Map([
    [13, [checkpoint("Arrivee", 13, "12:30", "08:00")]],
    [25, [checkpoint("Arrivee", 25, "13:30", "09:00")]],
    [30, [checkpoint("Arrivee", 30, "11:00", "04:00")]],
    [42, [checkpoint("Arrivee", 42, "18:30", "10:00")]],
    [59, [checkpoint("Arrivee", 59, "18:30", "07:00")]],
    [80, [
      checkpoint("Cosmos", 50, "13:40", "06:00"),
      checkpoint("Kemmel", 63, "16:00", "06:00"),
      checkpoint("Arrivee", 80, "20:30", "06:00"),
    ]],
    [115, [
      checkpoint("Boescheppe", 74.5, "13:00", "02:00"),
      checkpoint("Cosmos", 85, "15:20", "02:00"),
      checkpoint("Kemmel", 98, "17:20", "02:00"),
      checkpoint("Arrivee", 115, "20:30", "02:00"),
    ]],
  ]);
}

function checkpoint(name, distanceKm, cutoffTime, startTime) {
  const startDateTime = `${DATE}T${startTime}:00`;
  const cutoffDateTime = `${DATE}T${cutoffTime}:00`;
  return {
    name,
    distanceKm,
    elevationGainFromStartM: null,
    cutoffDateTime,
    cutoffElapsedMinutes: minutesBetween(startDateTime, cutoffDateTime),
    aidStation: name !== "Arrivee",
    personalAssistanceAllowed: true,
  };
}

function station(name, distanceKm, overrides = {}) {
  return {
    name,
    distanceKm,
    elevationM: null,
    water: true,
    sportsDrink: null,
    solidFood: overrides.solidFood ?? true,
    hotFood: null,
    dropBag: name.includes("Boeschepe") ? true : null,
    crewAccess: true,
    medical: null,
    cutoffDateTime: null,
  };
}

function finishDuration(checkpoints) {
  const finish = checkpoints.find((item) => item.name === "Arrivee");
  return finish?.cutoffElapsedMinutes ?? null;
}

function knownStarts() {
  return {
    13: 8,
    25: 9,
    30: 4,
    42: 10,
    59: 7,
    80: 6,
    115: 2,
  };
}

function mandatoryEquipment(distance) {
  const base = ["reusable cup/container"];
  if (distance === 13 || distance === 25) return [...base, "minimum 0.5 L water/liquid"];
  return [...base, "minimum 1.5 L water/liquid", "energy bars or gels", "whistle", "rain jacket", "survival blanket"];
}
