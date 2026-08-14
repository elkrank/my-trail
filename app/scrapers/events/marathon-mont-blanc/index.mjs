import { fetchText } from "../../common/fetch.mjs";
import {
  createEdition,
  createEvent,
  createIllustration,
  createRace,
  createRaceEntry,
  normalizeHttpUrl,
  sourceFromFetch,
} from "../../common/model.mjs";
import {
  extractIllustration,
  parseDate,
  parseDurationToMinutes,
  parseTime,
  stripHtml,
} from "../../common/parse.mjs";

const BASE_URL = "https://www.marathonmontblanc.fr";
const REGISTRATION_URL = `${BASE_URL}/coureurs/inscriptions`;
const RULES_URL = `${BASE_URL}/coureurs/reglement-des-courses`;
const STRAVA_CLUB_URL = "https://www.strava.com/clubs/marathonmontblanc";

export const MARATHON_MONT_BLANC_RACES = [
  {
    slug: "90km",
    path: "/courses/90km-du-mont-blanc",
    name: "90 km du Mont-Blanc",
    shortName: "90 km",
    raceType: "solo",
    priceEur: 140,
    lottery: true,
    startLocation: "Chamonix",
    finishLocation: "Chamonix",
    polesAllowed: true,
  },
  {
    slug: "42km",
    path: "/courses/42km-du-mont-blanc",
    name: "42 km du Mont-Blanc",
    shortName: "42 km",
    raceType: "solo",
    priceEur: 80,
    lottery: true,
    startLocation: "Chamonix",
    finishLocation: "Chamonix",
    polesAllowed: true,
  },
  {
    slug: "23km",
    path: "/courses/23km-du-mont-blanc",
    name: "23 km du Mont-Blanc",
    shortName: "23 km",
    raceType: "solo",
    priceEur: 50,
    lottery: true,
    startLocation: "Chamonix",
    finishLocation: "Planpraz",
    polesAllowed: true,
  },
  {
    slug: "duo-etoile",
    path: "/courses/duo-etoile",
    name: "Duo Étoilé",
    shortName: "Duo Étoilé",
    raceType: "pair",
    priceEur: 85,
    lottery: true,
    startLocation: "Chamonix",
    finishLocation: "Chamonix",
  },
  {
    slug: "10km",
    path: "/courses/10km-du-mont-blanc",
    name: "10 km du Mont-Blanc",
    shortName: "10 km",
    raceType: "solo",
    priceEur: 40,
    lottery: false,
    startLocation: "Chamonix",
    finishLocation: "Chamonix",
  },
  {
    slug: "kilometre-vertical",
    path: "/courses/km-vertical",
    name: "Kilomètre Vertical du Mont-Blanc",
    shortName: "KM Vertical",
    raceType: "vertical kilometer",
    priceEur: 45,
    lottery: false,
    startLocation: "Chamonix",
    finishLocation: "Planpraz",
    polesAllowed: false,
  },
];

export async function collect({ year }) {
  const event = createEvent({
    id: "marathon-mont-blanc",
    name: "Marathon du Mont-Blanc",
    slug: "marathon-mont-blanc",
    country: "France",
    region: "Auvergne-Rhone-Alpes",
    city: "Chamonix",
    officialWebsite: BASE_URL,
  });

  const sourceErrors = [];
  const shared = {};
  for (const [key, url] of Object.entries({ registration: REGISTRATION_URL, rules: RULES_URL })) {
    try {
      shared[key] = await fetchText(url);
    } catch (error) {
      sourceErrors.push({ url, message: error.message, status: error.status ?? null });
    }
  }

  const races = [];
  for (const raceConfig of MARATHON_MONT_BLANC_RACES) {
    const url = new URL(raceConfig.path, BASE_URL).href;
    try {
      const page = await fetchText(url);
      races.push(buildMarathonMontBlancEntry({ event, raceConfig, page, shared, year }));
    } catch (error) {
      sourceErrors.push({ url, message: error.message, status: error.status ?? null });
    }
  }

  return { event, sourceErrors, races };
}

export function buildMarathonMontBlancEntry({ event, raceConfig, page, shared = {}, year }) {
  const parsed = parseMarathonMontBlancPage(page.content, { year });
  const race = createRace(event, {
    id: `${event.id}-${raceConfig.slug}`,
    name: raceConfig.name,
    shortName: raceConfig.shortName,
  });
  const sources = [
    sourceFromFetch(page, { type: "official-race-page", event: event.name, race: race.shortName }),
  ];
  if (shared.registration) {
    sources.push(sourceFromFetch(shared.registration, {
      type: "official-registration",
      event: event.name,
      race: race.shortName,
    }));
  }
  if (shared.rules) {
    sources.push(sourceFromFetch(shared.rules, {
      type: "official-rules",
      event: event.name,
      race: race.shortName,
    }));
  }

  const illustration = createIllustration({
    url: extractIllustration(page.content, page.finalUrl ?? page.url),
    sourceUrl: page.finalUrl ?? page.url,
    event: event.name,
    race: race.shortName,
  });
  const startTime = parsed.startTime;
  const edition = createEdition(year, {
    date: parsed.date,
    startTime,
    distanceKm: parsed.distanceKm,
    elevationGainM: parsed.elevationGainM,
    elevationLossM: parsed.elevationLossM,
    startLocation: parsed.startLocation ?? raceConfig.startLocation,
    finishLocation: parsed.finishLocation ?? raceConfig.finishLocation,
    maxDurationMinutes: parsed.maxDurationMinutes,
    raceType: raceConfig.raceType,
    terrainType: "trail",
    terrainDescription: parsed.description,
    nightStart: startTime ? startTime < "06:00" || startTime >= "20:00" : null,
    polesAllowed: parsed.polesAllowed ?? raceConfig.polesAllowed ?? null,
    illustration,
    registration: {
      priceEur: raceConfig.priceEur,
      registrationCloseDate: "2026-06-27",
      lottery: raceConfig.lottery,
      url: normalizeHttpUrl(shared.registration?.finalUrl ?? shared.registration?.url ?? REGISTRATION_URL),
      maxParticipants: parsed.maxParticipants,
    },
    checkpoints: parsed.checkpoints,
    aidStations: parsed.aidStations,
    mandatoryEquipment: parsed.mandatoryEquipment,
    rules: {
      minimumWaterLiters: parsed.minimumWaterLiters,
    },
    rawOfficial: {
      latestRegistrationPeriodUsed: "Du 01/04/2026 au 27/06/2026",
      recommendedIndex: parsed.recommendedIndex,
      stravaAccountUrls: [STRAVA_CLUB_URL],
    },
    sources,
  });

  const entry = createRaceEntry({ event, race, edition });
  entry.quality.warnings = parsed.warnings;
  return entry;
}

export function parseMarathonMontBlancPage(html, { year = 2026 } = {}) {
  const text = stripHtml(html);
  const oneLine = text.replace(/\s+/g, " ");
  const dateText = valueAfterLabel(oneLine, /Date/i, [/D[ée]part/i, /Distance/i, /D[ée]nivel[ée]/i]);
  const startText = valueAfterLabel(oneLine, /D[ée]part/i, [/Distance/i, /D[ée]nivel[ée]/i, /##/i]);
  const distanceText = valueAfterLabel(oneLine, /Distance/i, [/D[ée]nivel[ée]/i, /##/i]);
  const elevation = parseElevation(oneLine);
  const maxDurationMinutes = parseDurationToMinutes(
    oneLine.match(/Temps maximum\s*:\s*([0-9]{1,2}\s*h(?:[0-9]{2})?|\d+\s*heures?)/i)?.[1] ??
      oneLine.match(/temps maximum de course\s*:\s*([0-9]{1,2}\s*h(?:[0-9]{2})?|\d+\s*heures?)/i)?.[1],
  );
  const checkpoints = parseCutoffs(text);
  if (checkpoints.length === 0 && Number.isFinite(maxDurationMinutes)) {
    checkpoints.push({
      name: "Arrivee",
      distanceKm: numberFromText(distanceText),
      elevationGainFromStartM: null,
      cutoffDateTime: null,
      cutoffElapsedMinutes: maxDurationMinutes,
      aidStation: false,
      personalAssistanceAllowed: null,
    });
  }
  const aidStations = buildAidStationsFromPage(text, checkpoints);
  const mandatoryEquipment = parseMandatoryEquipment(text);
  const warnings = [];

  if (!/\b2026\b/.test(text)) {
    warnings.push("No 2026 marker found in official race page.");
  }
  if (/traces? GPX pourront donner des r[ée]sultats diff[ée]rents/i.test(text)) {
    warnings.push("Official page warns GPX-derived distance/elevation can differ from official values.");
  }

  return {
    date: parseDate(dateText, year),
    startTime: parseTime(startText),
    distanceKm: numberFromText(distanceText),
    elevationGainM: elevation.gain,
    elevationLossM: elevation.loss,
    startLocation: parseStartLocation(oneLine),
    finishLocation: parseFinishLocation(oneLine),
    maxDurationMinutes,
    maxParticipants: parseMaxParticipants(oneLine),
    checkpoints,
    aidStations,
    mandatoryEquipment,
    minimumWaterLiters: parseMinimumWaterLiters(text),
    polesAllowed: /B[âa]tons interdits/i.test(text) ? false : /B[âa]tons.*(?:autoris|permis)/i.test(text) ? true : null,
    recommendedIndex: text.match(/indice (?:UTMB|de performance UTMB)[^0-9]{0,80}([0-9]{3})\s*points/i)?.[1] ?? null,
    description: firstCourseDescription(text),
    warnings,
  };
}

export function parseCutoffs(text) {
  const checkpoints = [];
  for (const match of text.matchAll(/^\s*(?:\d+\.\s*)?(.+?)\s*\((?:km\s*)?([0-9]+(?:[,.][0-9]+)?)(?:\s*km)?\)\s*:\s*(?:[Hh]eure de d[ée]part[^+]*\+\s*)?([0-9]{1,2}\s*h(?:[0-9]{2})?)/gim)) {
    const name = cleanValue(match[1]).replace(/^Temps maximum de course\s*-\s*/i, "");
    checkpoints.push({
      name,
      distanceKm: numberFromText(match[2]),
      elevationGainFromStartM: null,
      cutoffDateTime: null,
      cutoffElapsedMinutes: parseDurationToMinutes(match[3]),
      aidStation: /ravitaillement/i.test(name),
      personalAssistanceAllowed: null,
    });
  }
  return checkpoints;
}

function buildAidStationsFromPage(text, checkpoints) {
  const stations = checkpoints
    .filter((checkpoint) => /ravitaillement/i.test(checkpoint.name))
    .map((checkpoint) => ({
      name: checkpoint.name.replace(/^Ravitaillement\s+(?:du|de la|des|d')?\s*/i, "").trim() || checkpoint.name,
      distanceKm: checkpoint.distanceKm,
      elevationM: null,
      water: true,
      sportsDrink: null,
      solidFood: /complets?|full/i.test(text) ? true : null,
      hotFood: null,
      dropBag: null,
      crewAccess: null,
      medical: null,
      cutoffDateTime: checkpoint.cutoffDateTime,
    }));

  if (/ravitaillement d[’']arriv[ée]e/i.test(text)) {
    stations.push({
      name: "Arrivee",
      distanceKm: null,
      elevationM: null,
      water: true,
      sportsDrink: null,
      solidFood: null,
      hotFood: null,
      dropBag: null,
      crewAccess: null,
      medical: null,
      cutoffDateTime: null,
    });
  }

  return stations;
}

function parseMandatoryEquipment(text) {
  const match = text.match(/Mat[ée]riel obligatoire\s+([\s\S]+?)(?:### Mat[ée]riel recommand[ée]|## Barri[èe]res|## Temps maximum|L[’']organisation|$)/i);
  if (!match) return [];
  return match[1]
    .split(/\n|\s+\*\s+/)
    .map((line) => cleanValue(line.replace(/^\*\s*/, "")))
    .filter((line) => line && line.length > 3 && !/^Cet [ée]v[ée]nement/i.test(line));
}

function parseElevation(text) {
  const split = text.match(/([0-9]+)\s*m\s*D?\+\s*\/\s*([0-9]+)\s*m\s*D?-/i);
  if (split) return { gain: Number(split[1]), loss: Number(split[2]) };

  const both = text.match(/([0-9]+)\s*m\s*(?:D\+\/-|\+\/-)/i);
  if (both) return { gain: Number(both[1]), loss: Number(both[1]) };

  const gain = text.match(/([0-9]+)\s*m\s*D\+/i);
  return { gain: gain ? Number(gain[1]) : null, loss: null };
}

function valueAfterLabel(text, labelPattern, stopPatterns) {
  const stop = stopPatterns.map((pattern) => pattern.source).join("|");
  const match = text.match(new RegExp(`${labelPattern.source}\\s+([\\s\\S]{0,140}?)(?=\\s+(?:${stop})|$)`, "i"));
  return cleanValue(match?.[1]);
}

function parseMaxParticipants(text) {
  const match = text.match(/Limit[ée]\s+[àa]\s+([0-9\s]+)\s+(?:coureurs|[ée]quipes)/i);
  if (!match) return null;
  return Number.parseInt(match[1].replace(/\s+/g, ""), 10);
}

function parseMinimumWaterLiters(text) {
  const match = text.match(/R[ée]serve d[’']eau(?:\s+de)?\s+([0-9]+(?:[,.][0-9]+)?)\s*litre/i);
  return match ? numberFromText(match[1]) : null;
}

function parseStartLocation(text) {
  const match = text.match(/Race Start\s+([^,.;]+)|D[ée]part\s+(?:de|depuis)\s+([^,.;]+)/i);
  const value = cleanValue(match?.[1] ?? match?.[2]);
  if (!value || /(?:course|vague|heure|chaque|derni[èe]re|votre)/i.test(value)) return null;
  return value;
}

function parseFinishLocation(text) {
  const match = text.match(/Arriv[ée]e\s+[àa]\s+([A-Za-zÀ-ÿ -]+)/i);
  return cleanValue(match?.[1]);
}

function firstCourseDescription(text) {
  const match = text.match(/##\s+[^#\n]+\s+([\s\S]{80,800}?)(?:## Infos course|Infos course)/i);
  return cleanValue(match?.[1]);
}

function numberFromText(value) {
  const match = String(value ?? "").replace(",", ".").match(/\d+(?:\.\d+)?/);
  return match ? Number(match[0]) : null;
}

function cleanValue(value) {
  const cleaned = String(value ?? "")
    .replace(/\u00a0/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return cleaned || null;
}
