import { fetchText } from "../../common/fetch.mjs";
import {
  createEdition,
  createDataAvailability,
  createEvent,
  createIllustration,
  createRace,
  createRaceEntry,
  sourceFromFetch,
} from "../../common/model.mjs";
import {
  extractIllustration,
  extractRegistrationUrl,
  minutesBetween,
  numberFrom,
  parseDate,
  parseDurationToMinutes,
  parseTime,
  stripHtml,
  textNoAccents,
} from "../../common/parse.mjs";

const BASE_URL = "https://www.saintelyon.com";

const RACES = [
  { slug: "80km-saintelyon", name: "Saintelyon", shortName: "Saintelyon", raceType: "solo" },
  { slug: "80km-relais-2", name: "Saintelyon Relais 2", shortName: "Relais 2", raceType: "relay" },
  { slug: "80km-relais-3", name: "Saintelyon Relais 3", shortName: "Relais 3", raceType: "relay" },
  { slug: "80km-relais-4", name: "Saintelyon Relais 4", shortName: "Relais 4", raceType: "relay" },
  { slug: "45km-saint-express", name: "SaintExpress", shortName: "SaintExpress", raceType: "solo" },
  { slug: "saintevia", name: "SainteVia", shortName: "SainteVia", raceType: "solo" },
  { slug: "14km-saintesprint", name: "SainteSprint", shortName: "SainteSprint", raceType: "solo" },
  { slug: "13km-saintetic", name: "SainteTic", shortName: "SainteTic", raceType: "solo" },
  { slug: "160km-lyon-saintelyon", name: "Lyon Saintelyon", shortName: "Lyon Saintelyon", raceType: "solo" },
];

export async function collect({ year }) {
  const event = createEvent({
    id: "saintelyon",
    name: "Saintelyon",
    slug: "saintelyon",
    country: "France",
    region: "Auvergne-Rhone-Alpes",
    city: "Lyon",
    officialWebsite: BASE_URL,
  });

  const sourceErrors = [];
  const races = [];
  for (const raceConfig of RACES) {
    const url = `${BASE_URL}/races/${raceConfig.slug}`;
    try {
      const page = await fetchText(url);
      races.push(buildRace(event, raceConfig, page, year));
    } catch (error) {
      sourceErrors.push({ url, message: error.message, status: error.status ?? null });
    }
  }

  return { event, sourceErrors, races };
}

function buildRace(event, raceConfig, page, year) {
  const text = stripHtml(page.content);
  const race = createRace(event, raceConfig);
  const labels = parseHeaderFields(page.content);
  const rawDistance = page.content.match(/class=["'][^"']*text-block-67[^"']*["'][^>]*>([^<]+)</i)?.[1];
  const dateText = labelValue(labels, "DATE") ?? labelBetween(text, "DATE", "HEURE DE D");
  const timeText = labelValue(labels, "HEURE DE DEPART") ?? labelBetween(text, "HEURE DE D", "LIEU DE D");
  const startLocation = labelValue(labels, "LIEU DE DEPART") ?? labelBetween(text, "LIEU DE D", "Image") ?? null;
  const date = parseDate(dateText, year);
  const startTime = parseTime(timeText);
  const distanceKm = numberFrom(rawDistance ?? raceConfig.slug);
  const elevationText = text.match(/D[Ã©e]nivel[Ã©e]\s+([0-9][0-9\s,.]*\s*m|A venir|Ã€ venir)/i)?.[1] ?? null;
  const ravitoComing = /Ravitos?[\s\S]{0,80}?(?:a venir|Ã  venir)/i.test(text);
  const barrierComing = /Barri[Ã¨e]res horaires\s+(a venir|Ã  venir)/i.test(text);
  const checkpoints = parseSaintelyonCheckpoints(text, { date, startTime, distanceKm });
  const maxDurationMinutes =
    parseDurationToMinutes(text.match(/Temps limite\s+([^\n]+)/i)?.[1] ?? null) ??
    maxCheckpointDuration(checkpoints);
  const illustration = createIllustration({
    url: extractIllustration(page.content, page.finalUrl ?? page.url),
    sourceUrl: page.finalUrl ?? page.url,
    event: event.name,
    race: race.shortName,
  });
  const registrationUrl = extractRegistrationUrl(page.content, page.finalUrl ?? page.url);

  const warnings = [];
  if (ravitoComing) warnings.push("Official page marks aid stations as coming soon.");
  if (barrierComing) warnings.push("Official page marks time barriers as coming soon.");
  if (checkpoints.length > 0) warnings.push("Official page exposes cutoff clock times; elapsed durations are computed from official start date/time.");
  if (!elevationText || /venir/i.test(elevationText)) warnings.push("Official page does not expose elevation gain yet.");

  const edition = createEdition(year, {
    date,
    startTime,
    distanceKm,
    elevationGainM: elevationText && !/venir/i.test(elevationText) ? numberFrom(elevationText) : null,
    startLocation,
    finishLocation: /Lyon/i.test(text) ? "Lyon" : null,
    maxDurationMinutes,
    raceType: raceConfig.raceType,
    terrainType: "trail",
    nightStart: startTime ? startTime >= "20:00" || startTime < "06:00" : null,
    illustration,
    registration: {
      status: registrationStatus(text),
      url: registrationUrl,
    },
    checkpoints,
    rawOfficial: {
      routeBounds: {
        minLat: 45.25,
        maxLat: 45.9,
        minLon: 4.0,
        maxLon: 5.1,
      },
    },
    dataAvailability: {
      ...(!elevationText || /venir/i.test(elevationText) ? {
        elevationGainM: createDataAvailability("not_published", {
          sourceUrl: page.finalUrl ?? page.url,
          checkedAt: page.retrievedAt,
          reason: "Official race page marks elevation gain as coming soon.",
        }),
      } : {}),
      aidStations: createDataAvailability("not_published", {
        sourceUrl: page.finalUrl ?? page.url,
        checkedAt: page.retrievedAt,
        reason: ravitoComing
          ? "Official race page marks aid stations as coming soon."
          : "Official 2026 race page does not publish usable aid-station details yet.",
      }),
      ...(/Trace GPX\s*\(?(?:a venir|à venir)/i.test(text) ? {
        gpx: createDataAvailability("not_published", {
          sourceUrl: page.finalUrl ?? page.url,
          checkedAt: page.retrievedAt,
          reason: "Official race page marks the GPX as coming soon.",
        }),
      } : {}),
      registration: {
        priceEur: createDataAvailability("not_published", {
          sourceUrl: page.finalUrl ?? page.url,
          checkedAt: page.retrievedAt,
          reason: "Official public race page does not publish the 2026 price and no previous-edition price is reused.",
        }),
      },
    },
    sources: [
      sourceFromFetch(page, {
        type: "official-race-page",
        event: event.name,
        race: race.shortName,
      }),
    ],
  });

  const entry = createRaceEntry({ event, race, edition });
  entry.quality.warnings = warnings;
  return entry;
}

export function parseHeaderFields(html) {
  const fields = {};
  const regex = /<div class=["'][^"']*text-block-25[^"']*["'][^>]*>([^<]+)<\/div>\s*<div class=["'][^"']*text-block-26[^"']*["'][^>]*>([\s\S]*?)<\/div>/gi;
  for (const [, label, value] of html.matchAll(regex)) {
    fields[stripHtml(label).toUpperCase()] = stripHtml(value);
  }
  return fields;
}

export function parseSaintelyonCheckpoints(text, { date, startTime, distanceKm }) {
  if (!date || !startTime) return [];
  const plain = textNoAccents(text).replace(/\s+/g, " ");
  const block = plain.match(/Barrieres horaires\s+([\s\S]{0,900}?)(?:Retrait des dossards|Pour toutes questions|Infos pratiques|Liens utiles|Resultats|$)/i)?.[1] ?? "";
  if (!block || /a venir/i.test(block)) return [];

  const checkpoints = [];
  const retourIndex = block.search(/\bRETOUR\s*:/i);
  let dayOffset = 0;
  let previousMinutesOfDay = timeOfDayMinutes(startTime);

  for (const match of block.matchAll(/\bKM\s*([0-9]+(?:[,.][0-9]+)?)\s+([^:>]+?)\s*:\s*(\d{1,2}[h:]\d{2})/gi)) {
    const minutesOfDay = timeOfDayMinutes(match[3]);
    if (minutesOfDay === null) continue;
    if (minutesOfDay < previousMinutesOfDay) dayOffset += 1;
    previousMinutesOfDay = minutesOfDay;

    const displayedDistance = numberFrom(match[1]);
    const isReturn = retourIndex >= 0 && match.index > retourIndex;
    const cumulativeDistance = isReturn && Number.isFinite(displayedDistance)
      ? Math.min(Number(distanceKm), 82 + displayedDistance)
      : displayedDistance;
    const cutoffDateTime = dateTimeWithOffset(date, minutesOfDay, dayOffset);
    checkpoints.push({
      name: cleanCheckpointName(match[2]),
      distanceKm: Number.isFinite(cumulativeDistance) ? cumulativeDistance : null,
      elevationGainFromStartM: null,
      cutoffDateTime,
      cutoffElapsedMinutes: minutesBetween(`${date}T${startTime}:00`, cutoffDateTime),
      aidStation: null,
      personalAssistanceAllowed: null,
    });
  }

  if (checkpoints.length === 0) {
    const closure = block.match(/Fermeture des parcours\s*:?\s*(\d{1,2}[h:]\d{2})/i)?.[1];
    const minutesOfDay = timeOfDayMinutes(closure);
    if (minutesOfDay !== null) {
      const offset = minutesOfDay < timeOfDayMinutes(startTime) ? 1 : 0;
      const cutoffDateTime = dateTimeWithOffset(date, minutesOfDay, offset);
      checkpoints.push({
        name: "Fermeture des parcours",
        distanceKm: Number.isFinite(Number(distanceKm)) ? Number(distanceKm) : null,
        elevationGainFromStartM: null,
        cutoffDateTime,
        cutoffElapsedMinutes: minutesBetween(`${date}T${startTime}:00`, cutoffDateTime),
        aidStation: false,
        personalAssistanceAllowed: null,
      });
    }
  }

  return checkpoints.filter((checkpoint) => Number.isFinite(checkpoint.cutoffElapsedMinutes) && checkpoint.cutoffElapsedMinutes > 0);
}

function labelValue(labels, expected) {
  const normalizedExpected = normalizeLabel(expected);
  for (const [label, value] of Object.entries(labels)) {
    if (normalizeLabel(label) === normalizedExpected) return value;
  }
  return null;
}

function normalizeLabel(value) {
  return textNoAccents(value)
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, " ")
    .trim();
}

function labelBetween(text, startLabel, endLabel) {
  const normalized = text.replace(/\n/g, " ");
  const match = normalized.match(new RegExp(`${startLabel}[^\\w]*(.*?)\\s+${endLabel}`, "i"));
  return match ? match[1].trim() : null;
}

function maxCheckpointDuration(checkpoints) {
  const durations = checkpoints
    .map((checkpoint) => checkpoint.cutoffElapsedMinutes)
    .filter((value) => Number.isFinite(value));
  return durations.length ? Math.max(...durations) : null;
}

function timeOfDayMinutes(value) {
  const parsed = parseTime(String(value ?? "").replace(":", "h"));
  if (!parsed) return null;
  const [hours, minutes] = parsed.split(":").map(Number);
  return hours * 60 + minutes;
}

function dateTimeWithOffset(date, minutesOfDay, dayOffset) {
  const [year, month, day] = date.split("-").map(Number);
  const utc = new Date(Date.UTC(year, month - 1, day + dayOffset, Math.floor(minutesOfDay / 60), minutesOfDay % 60, 0));
  return `${utc.getUTCFullYear()}-${String(utc.getUTCMonth() + 1).padStart(2, "0")}-${String(utc.getUTCDate()).padStart(2, "0")}T${String(utc.getUTCHours()).padStart(2, "0")}:${String(utc.getUTCMinutes()).padStart(2, "0")}:00`;
}

function cleanCheckpointName(value) {
  return String(value ?? "")
    .replace(/\s+/g, " ")
    .trim();
}

function registrationStatus(text) {
  if (/Complet/i.test(text)) return "full";
  if (/Inscriptions ouvertes/i.test(text)) return "open";
  if (/Inscriptions termin[Ã©e]es/i.test(text)) return "closed";
  return null;
}
