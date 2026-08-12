import { fetchText } from "../../common/fetch.mjs";
import {
  createEdition,
  createEvent,
  createIllustration,
  createRace,
  createRaceEntry,
  sourceFromFetch,
} from "../../common/model.mjs";
import { extractIllustration, numberFrom, parseDate, parseDurationToMinutes, parseTime, stripHtml } from "../../common/parse.mjs";

const BASE_URL = "https://www.saintelyon.com";

const RACES = [
  { slug: "80km-saintelyon", name: "Saintelyon", shortName: "Saintelyon" },
  { slug: "80km-relais-2", name: "Saintelyon Relais 2", shortName: "Relais 2" },
  { slug: "80km-relais-3", name: "Saintelyon Relais 3", shortName: "Relais 3" },
  { slug: "80km-relais-4", name: "Saintelyon Relais 4", shortName: "Relais 4" },
  { slug: "45km-saint-express", name: "SaintExpress", shortName: "SaintExpress" },
  { slug: "saintevia", name: "SainteVia", shortName: "SainteVia" },
  { slug: "14km-saintesprint", name: "SainteSprint", shortName: "SainteSprint" },
  { slug: "13km-saintetic", name: "SainteTic", shortName: "SainteTic" },
  { slug: "160km-lyon-saintelyon", name: "Lyon Saintelyon", shortName: "Lyon Saintelyon" },
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
  const dateText = labels.DATE ?? labelBetween(text, "DATE", "HEURE DE D");
  const timeText = labels["HEURE DE DÉPART"] ?? labels["HEURE DE DEPART"] ?? labelBetween(text, "HEURE DE D", "LIEU DE D");
  const startLocation = labels["LIEU DE DÉPART"] ?? labels["LIEU DE DEPART"] ?? labelBetween(text, "LIEU DE D", "Image") ?? null;
  const elevationText = text.match(/D[ée]nivel[ée]\s+([0-9][0-9\s,.]*\s*m|A venir|À venir)/i)?.[1] ?? null;
  const ravitoComing = /Ravitos\s+(a venir|à venir)/i.test(text);
  const barrierComing = /Barri[èe]res horaires\s+(a venir|à venir)/i.test(text);
  const illustration = createIllustration({
    url: extractIllustration(page.content, page.finalUrl ?? page.url),
    sourceUrl: page.finalUrl ?? page.url,
    event: event.name,
    race: race.shortName,
  });

  const warnings = [];
  if (ravitoComing) warnings.push("Official page marks aid stations as coming soon.");
  if (barrierComing) warnings.push("Official page marks time barriers as coming soon.");
  if (!elevationText || /venir/i.test(elevationText)) warnings.push("Official page does not expose elevation gain yet.");

  const edition = createEdition(year, {
    date: parseDate(dateText, year),
    startTime: parseTime(timeText),
    distanceKm: numberFrom(rawDistance ?? raceConfig.slug),
    elevationGainM: elevationText && !/venir/i.test(elevationText) ? numberFrom(elevationText) : null,
    startLocation,
    finishLocation: /Lyon/i.test(text) ? "Lyon" : null,
    maxDurationMinutes: parseDurationToMinutes(text.match(/Temps limite\s+([^\n]+)/i)?.[1] ?? null),
    raceType: "trail",
    terrainType: "trail",
    nightStart: parseTime(timeText) ? parseTime(timeText) >= "20:00" || parseTime(timeText) < "06:00" : null,
    illustration,
    registration: {
      status: registrationStatus(text),
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

function labelBetween(text, startLabel, endLabel) {
  const normalized = text.replace(/\n/g, " ");
  const match = normalized.match(new RegExp(`${startLabel}[^\\w]*(.*?)\\s+${endLabel}`, "i"));
  return match ? match[1].trim() : null;
}

function registrationStatus(text) {
  if (/Complet/i.test(text)) return "full";
  if (/Inscriptions ouvertes/i.test(text)) return "open";
  if (/Inscriptions termin[ée]es/i.test(text)) return "closed";
  return null;
}
