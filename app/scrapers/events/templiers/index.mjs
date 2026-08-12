import { fetchText } from "../../common/fetch.mjs";
import {
  createEdition,
  createEvent,
  createIllustration,
  createRace,
  createRaceEntry,
  sourceFromFetch,
} from "../../common/model.mjs";
import { extractIllustration, numberFrom, parseDate, parseTime, stripHtml, textNoAccents } from "../../common/parse.mjs";

const BASE_URL = "https://www.festivaldestempliers.com";
const INFO_URL = `${BASE_URL}/infos_pratiques/`;

const RACES = [
  { slug: "l", name: "Endurance Trail", shortName: "Endurance Trail" },
  { slug: "lintegrale-des-causses", name: "Integrale des Causses", shortName: "Integrale des Causses" },
  { slug: "marathon-du-larzac-3", name: "Marathon du Larzac", shortName: "Marathon du Larzac" },
  { slug: "boffi-fifty", name: "Boffi Fifty", shortName: "Boffi Fifty" },
  { slug: "dourbie-formi-2", name: "Dourbie Formi", shortName: "Dourbie Formi" },
  { slug: "la-monna-lisa-trail", name: "Monna Lisa", shortName: "Monna Lisa" },
  { slug: "le-marathon-des-causses", name: "Marathon des Causses", shortName: "Marathon des Causses" },
  { slug: "troubadours", name: "Trail des Troubadours", shortName: "Troubadours" },
  { slug: "vo2-trail", name: "VO2 Trail", shortName: "VO2 Trail" },
  { slug: "templiere", name: "La Templiere", shortName: "Templiere" },
  { slug: "grand-trail-des-templiers", name: "Grand Trail des Templiers", shortName: "Grand Trail" },
];

export async function collect({ year }) {
  const event = createEvent({
    id: "templiers",
    name: "Festival des Templiers",
    slug: "templiers",
    country: "France",
    region: "Occitanie",
    city: "Millau",
    officialWebsite: BASE_URL,
  });

  const sourceErrors = [];
  let info = null;
  try {
    info = await fetchText(INFO_URL);
  } catch (error) {
    sourceErrors.push({ url: INFO_URL, message: error.message, status: error.status ?? null });
  }

  const races = [];
  for (const raceConfig of RACES) {
    const url = `${BASE_URL}/${raceConfig.slug}/`;
    try {
      const page = await fetchText(url);
      races.push(buildRace(event, raceConfig, page, info, year));
    } catch (error) {
      sourceErrors.push({ url, message: error.message, status: error.status ?? null });
    }
  }

  return { event, sourceErrors, races };
}

function buildRace(event, raceConfig, page, info, year) {
  const text = stripHtml(page.content);
  const plain = textNoAccents(text);
  const race = createRace(event, raceConfig);
  const startBlock = plain.match(/DEPART\s+([\s\S]{0,260}?)(?:DISTANCES|VAGUES|RAVITAILLEMENTS)/i)?.[1] ?? "";
  const distanceBlock = plain.match(/DISTANCES\s+([\s\S]{0,100}?)(?:VAGUES|RAVITAILLEMENTS|REGLEMENT)/i)?.[1] ?? "";
  const distanceMatch = distanceBlock.match(/(\d+(?:[,.]\d+)?)\s*km\s*[–-]\s*(\d+(?:[,.]\d+)?)\s*m/i);
  const startLocation = startBlock.match(/\n([^\n]*(?:Millau|Peyreleau|Salvage|Est[ -]?Eve)[^\n]*)/i)?.[1]?.trim() ?? "Millau";
  const date = parseDate(startBlock, year) ?? parseDate(text, year);
  const startTime = parseTime(startBlock);
  const aidStations = parseAidStations(text);
  const hasNoCutoff = /Pas de temps [ée]liminatoire/i.test(text);
  const illustration = createIllustration({
    url: extractIllustration(page.content, page.finalUrl ?? page.url),
    sourceUrl: page.finalUrl ?? page.url,
    event: event.name,
    race: race.shortName,
  });

  const sources = [
    sourceFromFetch(page, { type: "official-race-page", event: event.name, race: race.shortName }),
  ];
  if (info) sources.push(sourceFromFetch(info, { type: "official-rules", event: event.name, race: race.shortName }));

  const warnings = [];
  if (/HORAIRES ELIMINATOIRES[\s\S]{0,80}cliquez ici/i.test(plain)) {
    warnings.push("Official page links cutoff details, but no machine-readable cutoff table was found in the page.");
  }
  if (hasNoCutoff) warnings.push("Official page states no eliminating time for this race.");
  if (aidStations.some((station) => station.distanceKm === null)) {
    warnings.push("Official page lists aid stations but their distances require a separate linked detail page.");
  }

  const edition = createEdition(year, {
    date,
    startTime,
    distanceKm: distanceMatch ? numberFrom(distanceMatch[1]) : null,
    elevationGainM: distanceMatch ? numberFrom(distanceMatch[2]) : null,
    startLocation,
    finishLocation: "Millau",
    raceType: "trail",
    terrainType: "trail",
    nightStart: startTime ? startTime < "06:00" || startTime >= "20:00" : null,
    illustration,
    aidStations,
    checkpoints: hasNoCutoff ? [] : [],
    terrainDescription: firstParagraph(text),
    sources,
  });

  const entry = createRaceEntry({ event, race, edition });
  entry.quality.warnings = warnings;
  return entry;
}

export function parseAidStations(text) {
  const block = text.match(/RAVITAILLEMENTS\s+([\s\S]{0,900}?)(?:POINTS D'EAU|R[ÈE]GLEMENT|HORAIRES|REMISE)/i)?.[1];
  if (!block) return [];
  let lines = block
    .split(/\n/)
    .map((line) => line.trim())
    .filter((line) => /^[-–]\s+/.test(line))
    .map((line) => line.replace(/^[-–]\s+/, "").trim());

  if (lines.length === 0) {
    lines = block
      .split(/\s+[–-]\s+/)
      .map((line) => line.trim())
      .filter(Boolean);
  }

  lines = lines.filter((line) => line && !/^(\d+\s+)?ravitaillements?\b/i.test(line) && !/cliquez/i.test(line));

  return lines.map((line) => ({
    name: line.replace(/\s*\([^)]*\)\s*/g, " ").replace(/\s+/g, " ").trim(),
    distanceKm: null,
    elevationM: null,
    water: true,
    sportsDrink: null,
    solidFood: true,
    hotFood: null,
    dropBag: null,
    crewAccess: /assistance interdite|acces interdit/i.test(line) ? false : null,
    medical: null,
    cutoffDateTime: null,
  }));
}

function firstParagraph(text) {
  const match = text.match(/#\s*[^\n]+\n([\s\S]{80,500}?)(?:PR[ÉE]SENTATION|Les d[ée]tails techniques|D[ÉE]PART)/i);
  return match ? match[1].replace(/\n+/g, " ").trim() : null;
}
