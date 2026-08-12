import { fetchText } from "../../common/fetch.mjs";
import {
  createEdition,
  createEvent,
  createIllustration,
  createRace,
  createRaceEntry,
  sourceFromFetch,
} from "../../common/model.mjs";
import { extractIllustration, parseDate, stripHtml } from "../../common/parse.mjs";

const BASE_URL = "https://www.grandraid-reunion.com";
const COURSES_URL = `${BASE_URL}/fr/les-courses/`;
const REGISTRATION_URL = `${BASE_URL}/en/registrations/registration-formalities/modalites-des-inscriptions`;
const RULES_URL = `${BASE_URL}/fr/inscriptions/reglement/`;
const ROADBOOK_URL = `${BASE_URL}/fr/informations-pratiques/carnet-de-route/`;

const RACE_NAMES = [
  "La Diagonale des Fous",
  "Le Trail de Bourbon",
  "La Mascareignes",
  "Le Metis Trail",
  "Le Zembrocal Trail",
];

export async function collect({ year }) {
  const event = createEvent({
    id: "grand-raid-reunion",
    name: "Grand Raid de La Reunion",
    slug: "grand-raid-reunion",
    country: "France",
    region: "La Reunion",
    city: "Saint-Denis",
    officialWebsite: BASE_URL,
  });

  const sourceErrors = [];
  const pages = {};
  for (const [key, url] of Object.entries({
    courses: COURSES_URL,
    registration: REGISTRATION_URL,
    rules: RULES_URL,
    roadbook: ROADBOOK_URL,
  })) {
    try {
      pages[key] = await fetchText(url);
    } catch (error) {
      sourceErrors.push({ url, message: error.message, status: error.status ?? null });
    }
  }

  const coursesText = stripHtml(pages.courses?.content ?? "");
  const registrationText = stripHtml(pages.registration?.content ?? "");
  const rulesText = stripHtml(pages.rules?.content ?? "");
  const roadbookText = stripHtml(pages.roadbook?.content ?? "");
  const raceData = parseCourseList(coursesText);
  const prices = parsePrices(registrationText);
  const maxParticipants = parseMaxParticipants(registrationText);
  const qualifications = parseQualificationRules(registrationText, rulesText);
  const eventRange = registrationText.match(/auront lieu du\s+(\d{1,2}\s+au\s+\d{1,2}\s+[A-Za-z]+)\b/i)?.[1] ?? null;
  const roadbookIsCurrentYear = roadbookText.includes(String(year));

  const races = RACE_NAMES.map((name) => {
    const data = raceData.get(name) ?? {};
    const race = createRace(event, { name, shortName: shortName(name) });
    const sources = [];
    if (pages.courses) sources.push(sourceFromFetch(pages.courses, { type: "official-race-page", event: event.name, race: race.shortName }));
    if (pages.registration) sources.push(sourceFromFetch(pages.registration, { type: "official-registration", event: event.name, race: race.shortName }));
    if (pages.rules) sources.push(sourceFromFetch(pages.rules, { type: "official-rules", event: event.name, race: race.shortName }));
    if (pages.roadbook) sources.push(sourceFromFetch(pages.roadbook, { type: "official-roadbook", event: event.name, race: race.shortName }));
    const illustration = pages.courses
      ? createIllustration({
        url: extractIllustration(pages.courses.content, pages.courses.finalUrl ?? pages.courses.url),
        sourceUrl: pages.courses.finalUrl ?? pages.courses.url,
        event: event.name,
        race: race.shortName,
      })
      : null;

    const warnings = [];
    if (eventRange) warnings.push(`Official 2026 event range found (${eventRange}), but race-specific start date was not found.`);
    if (!roadbookIsCurrentYear) warnings.push("Official roadbook page did not expose a current 2026 roadbook; 2025 roadbook data was not reused.");

    const edition = createEdition(year, {
      date: null,
      distanceKm: data.distanceKm ?? null,
      elevationGainM: data.elevationGainM ?? null,
      raceType: "trail",
      terrainType: "trail",
      startLocation: name === "La Diagonale des Fous" ? "Saint-Pierre" : null,
      finishLocation: "La Redoute",
      illustration,
      registration: {
        priceEur: prices.get(race.shortName) ?? null,
        maxParticipants: maxParticipants.get(race.shortName) ?? null,
        qualificationRequired: qualifications.get(race.shortName) ?? null,
      },
      rules: {
        personalAssistanceAllowed: rulesText ? true : null,
      },
      sources,
    });

    const entry = createRaceEntry({ event, race, edition });
    entry.quality.warnings = warnings;
    return entry;
  });

  return { event, sourceErrors, races };
}

function parseCourseList(text) {
  const output = new Map();
  for (const name of RACE_NAMES) {
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const match = text.match(new RegExp(`${escaped}\\s+(\\d+(?:[,.]\\d+)?)\\s*km\\s+(\\d+(?:[,.]\\d+)?)\\s*m`, "i"));
    if (match) {
      output.set(name, {
        distanceKm: Number(match[1].replace(",", ".")),
        elevationGainM: Number(match[2].replace(",", ".")),
      });
    }
  }
  return output;
}

function parsePrices(text) {
  const output = new Map();
  const mappings = new Map([
    ["La Diagonale Des Fous", "Diagonale"],
    ["Le Trail de Bourbon", "Bourbon"],
    ["La Mascareignes", "Mascareignes"],
    ["Mètis Trail", "Metis"],
    ["Métis Trail", "Metis"],
    ["Zembrocal trail", "Zembrocal"],
  ]);
  for (const [label, key] of mappings) {
    const match = text.match(new RegExp(`${label}[\\s\\S]{0,120}?Individuelle\\s*:?\\s*(\\d+)\\s*€`, "i"));
    if (match) output.set(key, Number(match[1]));
  }
  const zembrocal = text.match(/Zembrocal trail[\s\S]{0,140}?prix pour l.equipe\s*:?\s*(\d+)\s*€/i);
  if (zembrocal) output.set("Zembrocal", Number(zembrocal[1]));
  return output;
}

function parseMaxParticipants(text) {
  const output = new Map();
  const diagonal = text.match(/La Diagonale des Fous\s*:\s*(\d+)\s+places/i);
  if (diagonal) output.set("Diagonale", Number(diagonal[1]));
  const bourbon = text.match(/Trail de Bourbon[^:]*:\s*(\d+)\s+places/i);
  if (bourbon) output.set("Bourbon", Number(bourbon[1]));
  return output;
}

function parseQualificationRules(registrationText, rulesText) {
  const text = `${registrationText}\n${rulesText}`;
  return new Map([
    ["Diagonale", findPointsRule(text, "Diagonale des fous")],
    ["Bourbon", findPointsRule(text, "Trail de Bourbon")],
    ["Mascareignes", findPointsRule(text, "Mascareignes")],
  ]);
}

function findPointsRule(text, label) {
  const match = text.match(new RegExp(`${label}[\\s\\S]{0,240}?(\\d+\\s+points[^.\\n]*)`, "i"));
  return match ? match[1].trim() : null;
}

function shortName(name) {
  if (name.includes("Diagonale")) return "Diagonale";
  if (name.includes("Bourbon")) return "Bourbon";
  if (name.includes("Mascareignes")) return "Mascareignes";
  if (name.includes("Metis") || name.includes("Métis")) return "Metis";
  return "Zembrocal";
}
