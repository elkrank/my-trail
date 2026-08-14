import { fetchText } from "../../common/fetch.mjs";
import { buildFinishCheckpoint } from "../../common/cutoffs.mjs";
import {
  createEdition,
  createEvent,
  createIllustration,
  createRace,
  createRaceEntry,
  sourceFromFetch,
} from "../../common/model.mjs";
import { extractIllustration, extractRegistrationUrl, numberFrom, parseDate, parseDurationToMinutes, parseTime, stripHtml } from "../../common/parse.mjs";

const BASE_URL = "https://www.ecotrailparis.com";
const ROADBOOK_URL = `${BASE_URL}/roadbook`;

const RACES = [
  { slug: "trail-80-km-automne", name: "Trail 80 km Automne", shortName: "80 km Automne" },
  { slug: "trail-50-km-automne", name: "Trail 50 km Automne", shortName: "50 km Automne" },
  { slug: "trail-20-km-automne", name: "Trail 20 km Automne", shortName: "20 km Automne" },
];

export async function collect({ year }) {
  const event = createEvent({
    id: "ecotrail",
    name: "EcoTrail Paris",
    slug: "ecotrail",
    country: "France",
    region: "Ile-de-France",
    city: "Paris",
    officialWebsite: BASE_URL,
  });

  const sourceErrors = [];
  let roadbook = null;
  try {
    roadbook = await fetchText(ROADBOOK_URL);
  } catch (error) {
    sourceErrors.push({ url: ROADBOOK_URL, message: error.message, status: error.status ?? null });
  }

  const races = [];
  for (const raceConfig of RACES) {
    const url = `${BASE_URL}/course/${raceConfig.slug}`;
    try {
      const page = await fetchText(url);
      races.push(buildRace(event, raceConfig, page, roadbook, year));
    } catch (error) {
      sourceErrors.push({ url, message: error.message, status: error.status ?? null });
    }
  }

  return { event, sourceErrors, races };
}

function buildRace(event, raceConfig, page, roadbook, year) {
  const text = stripHtml(page.content);
  const race = createRace(event, raceConfig);
  const labels = parseMainInfo(page.content);
  const date =
    page.content.match(/class=["'][^"']*main-run-date_wrapper[^"']*["'][^>]*>[\s\S]{0,260}?class=["'][^"']*tag-date-month[^"']*["'][^>]*>([^<]+)/i)?.[1] ??
    page.content.match(/class=["'][^"']*date-begin[^"']*["'][^>]*>([^<]+)/i)?.[1] ??
    parseDate(text, year);
  const gpxUrl = extractGpxUrl(page.content, page.finalUrl);
  const registrationUrl = extractRegistrationUrl(page.content, page.finalUrl ?? page.url);
  const illustration = createIllustration({
    url: extractIllustration(page.content, page.finalUrl ?? page.url),
    sourceUrl: page.finalUrl ?? page.url,
    event: event.name,
    race: race.shortName,
  });
  const requiredEquipment = parseMandatoryEquipment(text);
  const warnings = [];
  if (!/ravitaillement|ravito/i.test(text)) warnings.push("Official page does not expose aid station details.");
  if (roadbook && /roadbook arrive tr[èe]s prochainement/i.test(stripHtml(roadbook.content))) {
    warnings.push("Official roadbook page says the runner roadbook is coming soon; intermediate cutoff and aid station tables are not published yet.");
  } else {
    warnings.push("Official page links a roadbook/FAQ for practical details; cutoff and aid station tables were not found in the race page.");
  }

  const sources = [
    sourceFromFetch(page, { type: "official-race-page", event: event.name, race: race.shortName }),
  ];
  if (gpxUrl) {
    sources.push({
      url: gpxUrl,
      type: "official-gpx",
      retrievedAt: page.retrievedAt,
      event: event.name,
      race: race.shortName,
    });
  }
  if (roadbook) {
    sources.push(sourceFromFetch(roadbook, { type: "official-roadbook", event: event.name, race: race.shortName }));
  }

  const maxDurationMinutes = parseDurationToMinutes(labels["Temps limite"]);

  const edition = createEdition(year, {
    date,
    startTime: parseTime(labels["Heure de depart"] ?? labels["Heure de départ"]),
    distanceKm: numberFrom(labels.Distance),
    elevationGainM: numberFrom(labels["D+"]),
    startLocation: blockValue(text, "Départ", "Arrivée"),
    finishLocation: blockValue(text, "Arrivée", "Inscriptions|Le parcours|L'itinéraire"),
    maxDurationMinutes,
    raceType: "trail",
    terrainType: "trail",
    gpxUrl,
    illustration,
    registration: {
      status: registrationStatus(text),
      url: registrationUrl,
      maxParticipants: numberFrom(labels.Participants),
      qualificationRequired: /Licence FFA|PPS/i.test(text) ? "Licence FFA 2026-2027 ou attestation PPS" : null,
    },
    checkpoints: buildFinishCheckpoint({
      distanceKm: numberFrom(labels.Distance),
      maxDurationMinutes,
    }),
    mandatoryEquipment: requiredEquipment,
    rules: {
      minimumWaterLiters: minimumWaterLiters(text),
    },
    terrainDescription: text.match(/L'itin[ée]raire en d[ée]tail\s+([\s\S]{0,500}?)(?:Informations essentielles|Image)/i)?.[1]?.trim() ?? null,
    sources,
  });

  const entry = createRaceEntry({ event, race, edition });
  entry.quality.warnings = warnings;
  return entry;
}

export function parseMainInfo(html) {
  const output = {};
  const lines = [...html.matchAll(/<div class=["'][^"']*text-weight-bold[^"']*["'][^>]*>([^<]+)<\/div>\s*<div[^>]*>([^<]+)<\/div>/g)];
  for (const [, key, value] of lines) {
    output[stripHtml(key).replace(/\s*:$/, "").trim()] = stripHtml(value).trim();
  }
  return output;
}

export function extractGpxUrl(html, baseUrl) {
  const anchorUrl = extractGpxUrlFromAnchors(html, baseUrl);
  if (anchorUrl !== undefined) return anchorUrl;

  const match = html.match(/<a[^>]+href=["']([^"']+)["'][^>]*>[\s\S]{0,900}?T[ée]l[ée]charger la trace GPX/i);
  if (!match) return null;
  if (match[1] === "#") return null;
  const url = new URL(match[1], baseUrl).toString();
  return /\.gpx(?:[?#]|$)/i.test(url) ? url : null;
}

function extractGpxUrlFromAnchors(html, baseUrl) {
  for (const match of String(html ?? "").matchAll(/<a[^>]+href=["']([^"']+)["'][^>]*>([\s\S]{0,900}?)<\/a>/gi)) {
    const label = stripHtml(match[2])
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase();
    if (!/telecharger\s+la\s+trace\s+gpx/.test(label)) continue;
    if (match[1] === "#") return null;
    const url = new URL(match[1], baseUrl).toString();
    return /\.gpx(?:[?#]|$)/i.test(url) ? url : null;
  }
  return undefined;
}

function parseMandatoryEquipment(text) {
  const known = [
    "Reserve d'eau minimum",
    "Réserve d'eau minimum",
    "Reserve alimentaire",
    "Réserve alimentaire",
    "Gobelet 15cl minimum",
    "Lampe frontale",
    "Brassard réfléchissant",
    "Couverture de survie",
    "Téléphone mobile",
    "Piece d'identité",
    "Pièce d'identité",
    "Moyen de paiement",
  ];
  return [...new Set(known.filter((item) => text.includes(item)))];
}

export function minimumWaterLiters(text) {
  const match = text.match(/R[ée]serve d'eau minimum\s+(\d+(?:[,.]\d+)?)\s*L/i);
  return match ? Number(match[1].replace(",", ".")) : null;
}

function blockValue(text, startLabel, endLabel) {
  const match = text.match(new RegExp(`${startLabel}\\s*:?\\s*([\\s\\S]{0,160}?)\\s+(?:${endLabel})`, "i"));
  return match ? match[1].replace(/\n+/g, " ").trim() : null;
}

function registrationStatus(text) {
  if (/Complet/i.test(text)) return "full";
  if (/Inscriptions ouvertes/i.test(text)) return "open";
  if (/Inscriptions termin[ée]es/i.test(text)) return "closed";
  return null;
}
