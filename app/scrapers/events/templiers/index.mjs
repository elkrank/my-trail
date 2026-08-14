import { fetchText } from "../../common/fetch.mjs";
import {
  checkpointFromCutoff,
  dateTimeForClockSequence,
  sortCheckpoints,
} from "../../common/cutoffs.mjs";
import {
  createEdition,
  createEvent,
  createIllustration,
  createRace,
  createRaceEntry,
  createSource,
  sourceFromFetch,
} from "../../common/model.mjs";
import { extractIllustration, numberFrom, parseDate, parseTime, stripHtml, textNoAccents } from "../../common/parse.mjs";
import { fetchPdfText } from "../../common/pdf.mjs";

const BASE_URL = "https://www.festivaldestempliers.com";
const INFO_URL = `${BASE_URL}/infos_pratiques/`;

const RACES = [
  { slug: "l", name: "Endurance Trail", shortName: "Endurance Trail", cutoffLabel: "ENDURANCE TRAIL" },
  { slug: "lintegrale-des-causses", name: "Integrale des Causses", shortName: "Integrale des Causses", cutoffLabel: "INTEGRALE DES CAUSSES" },
  { slug: "marathon-du-larzac-3", name: "Marathon du Larzac", shortName: "Marathon du Larzac", cutoffLabel: "MARATHON DU LARZAC" },
  { slug: "boffi-fifty", name: "Boffi Fifty", shortName: "Boffi Fifty", cutoffLabel: "BOFFI FIFTY" },
  { slug: "dourbie-formi-2", name: "Dourbie Formi", shortName: "Dourbie Formi", cutoffLabel: "DOURBI FORMI" },
  { slug: "la-monna-lisa-trail", name: "Monna Lisa", shortName: "Monna Lisa", cutoffLabel: "MONNA LISA" },
  { slug: "le-marathon-des-causses", name: "Marathon des Causses", shortName: "Marathon des Causses", cutoffLabel: "MARATH CAUSSES" },
  { slug: "troubadours", name: "Trail des Troubadours", shortName: "Troubadours", cutoffLabel: "TROUBADOURS" },
  { slug: "vo2-trail", name: "VO2 Trail", shortName: "VO2 Trail", cutoffLabel: "VO2 TRAIL" },
  { slug: "templiere", name: "La Templiere", shortName: "Templiere", cutoffLabel: "LA TEMPLIERE" },
  { slug: "grand-trail-des-templiers", name: "Grand Trail des Templiers", shortName: "Grand Trail", cutoffLabel: "GRAND TRAIL" },
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
      const cutoffPdfs = [];
      for (const pdfUrl of extractCutoffPdfUrls(page.content, page.finalUrl ?? page.url)) {
        try {
          cutoffPdfs.push(await fetchPdfText(pdfUrl));
        } catch (error) {
          sourceErrors.push({ url: pdfUrl, message: error.message, status: error.status ?? null });
        }
      }
      races.push(buildRace(event, raceConfig, page, info, cutoffPdfs, year));
    } catch (error) {
      sourceErrors.push({ url, message: error.message, status: error.status ?? null });
    }
  }

  return { event, sourceErrors, races };
}

function buildRace(event, raceConfig, page, info, cutoffPdfs, year) {
  const text = stripHtml(page.content);
  const plain = textNoAccents(text);
  const race = createRace(event, raceConfig);
  const startBlock = plain.match(/DEPART\s+([\s\S]{0,260}?)(?:DISTANCES|VAGUES|RAVITAILLEMENTS)/i)?.[1] ?? "";
  const distanceBlock = plain.match(/DISTANCES\s+([\s\S]{0,100}?)(?:VAGUES|RAVITAILLEMENTS|REGLEMENT)/i)?.[1] ?? "";
  const distanceMatch = distanceBlock.match(/(\d+(?:[,.]\d+)?)\s*km\s*[–-]\s*(\d+(?:[,.]\d+)?)\s*m/i);
  const startLocation = startBlock.match(/\n([^\n]*(?:Millau|Peyreleau|Salvage|Est[ -]?Eve)[^\n]*)/i)?.[1]?.trim() ?? "Millau";
  const date = parseDate(startBlock, year) ?? parseDate(text, year);
  const startTime = parseTime(startBlock);
  const distanceKm = distanceMatch ? numberFrom(distanceMatch[1]) : null;
  const aidStations = parseAidStations(text);
  const hasNoCutoff = /Pas de temps [ée]liminatoire/i.test(text);
  const parsedCutoffs = hasNoCutoff
    ? { checkpoints: [], maxDurationMinutes: null, warnings: [] }
    : mergeTempliersCutoffs(cutoffPdfs, {
      raceLabel: raceConfig.cutoffLabel,
      date,
      startTime,
      maxRaceDistanceKm: distanceKm,
    });
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
  for (const pdf of cutoffPdfs) {
    sources.push(sourceFromUrl(pdf.finalUrl ?? pdf.url, {
      type: "official-roadbook",
      retrievedAt: pdf.retrievedAt,
      event: event.name,
      race: race.shortName,
    }));
  }

  const warnings = [];
  if (/HORAIRES ELIMINATOIRES[\s\S]{0,80}cliquez ici/i.test(plain) && parsedCutoffs.checkpoints.length === 0) {
    warnings.push("Official page links cutoff details, but no machine-readable cutoff table was found in the page.");
  }
  if (hasNoCutoff) warnings.push("Official page states no eliminating time for this race.");
  warnings.push(...parsedCutoffs.warnings);
  if (aidStations.some((station) => station.distanceKm === null)) {
    warnings.push("Official page lists aid stations but their distances require a separate linked detail page.");
  }

  const edition = createEdition(year, {
    date,
    startTime,
    distanceKm,
    elevationGainM: distanceMatch ? numberFrom(distanceMatch[2]) : null,
    startLocation,
    finishLocation: "Millau",
    raceType: "trail",
    terrainType: "trail",
    nightStart: startTime ? startTime < "06:00" || startTime >= "20:00" : null,
    illustration,
    aidStations,
    checkpoints: parsedCutoffs.checkpoints,
    maxDurationMinutes: parsedCutoffs.maxDurationMinutes,
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

export function parseTempliersCutoffPdfText(text, { raceLabel, date, startTime, maxRaceDistanceKm = null } = {}) {
  if (!text || !raceLabel) return { checkpoints: [], maxDurationMinutes: null, warnings: [] };
  const startDateTime = date && startTime ? `${date}T${startTime}:00` : null;
  const label = normalizeKey(raceLabel);
  const lines = String(text)
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const checkpoints = [];
  let previousCutoff = startDateTime;

  for (let index = 0; index < lines.length; index += 1) {
    const rawLine = lines[index];
    const normalized = normalizeKey(rawLine);
    const labelIndex = normalized.indexOf(label);
    if (labelIndex < 0 || /\(DEPART\)/i.test(rawLine)) continue;

    const prefix = rawLine.slice(0, Math.max(0, labelIndex)).trim();
    const previousLocation = findTempliersLocation(lines, index);
    const name = cleanTempliersName(prefix || previousLocation);
    const afterLabel = rawLine.slice(labelIndex + raceLabel.length);
    const km = parseTempliersDistance(afterLabel, { maxRaceDistanceKm });
    const times = [...afterLabel.matchAll(/\d{1,2}h\d{0,2}(?:\s*\(J\+1\))?/gi)].map((match) => match[0]);
    if (!name || !Number.isFinite(km) || km === 0 || times.length === 0) continue;

    const cutoffDateTime = dateTimeForTempliers(date, times.at(-1), previousCutoff);
    const checkpoint = checkpointFromCutoff({
      name,
      distanceKm: km,
      cutoffDateTime,
      startDateTime,
      aidStation: /RAV/i.test(afterLabel) || /ARRIVEE/i.test(name),
    });
    if (!checkpoint || checkpoint.cutoffElapsedMinutes === 0) continue;
    previousCutoff = checkpoint.cutoffDateTime ?? previousCutoff;
    checkpoints.push(checkpoint);
  }

  const unique = dedupeCheckpoints(sortCheckpoints(checkpoints));
  return {
    checkpoints: unique,
    maxDurationMinutes: unique.at(-1)?.cutoffElapsedMinutes ?? null,
    warnings: text && unique.length === 0 ? [`Official cutoff PDF was found but no ${raceLabel} checkpoint was extracted.`] : [],
  };
}

function mergeTempliersCutoffs(pdfs, options) {
  const merged = [];
  const warnings = [];
  for (const pdf of pdfs) {
    const parsed = parseTempliersCutoffPdfText(pdf.text, options);
    merged.push(...parsed.checkpoints);
    warnings.push(...parsed.warnings);
  }
  const checkpoints = dedupeCheckpoints(sortCheckpoints(merged));
  return {
    checkpoints,
    maxDurationMinutes: checkpoints.at(-1)?.cutoffElapsedMinutes ?? null,
    warnings: checkpoints.length ? [] : warnings,
  };
}

function parseTempliersDistance(afterLabel, { maxRaceDistanceKm = null } = {}) {
  const raw = String(afterLabel ?? "");
  const firstTime = raw.match(/(?:[01]?\d|2[0-3])h\d{0,2}/i);
  const beforeTime = (firstTime ? raw.slice(0, firstTime.index) : raw)
    .replace(/RAV(?:\s+ALLEGE)?|EAU|ARRIVEE/gi, " ")
    .replace(/V\d+/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
  const candidates = [...beforeTime.matchAll(/\d+(?:[,.]\d+)?/g)]
    .map((match) => numberFrom(match[0]))
    .filter(Number.isFinite);
  const plausible = candidates
    .filter((km) => !Number.isFinite(maxRaceDistanceKm) || km <= maxRaceDistanceKm + 2)
    .at(-1);
  if (Number.isFinite(plausible)) return plausible;

  const fallback = numberFrom(raw.match(/\b(\d+(?:[,.]\d+)?)\b/)?.[1]);
  return Number.isFinite(fallback) ? fallback : null;
}

function extractCutoffPdfUrls(html, baseUrl) {
  const urls = [];
  for (const match of String(html ?? "").matchAll(/<a[^>]+href=["']([^"']+\.pdf)["'][^>]*>([\s\S]{0,500}?)<\/a>/gi)) {
    const href = match[1].replace(/\s+/g, "%20");
    const label = stripHtml(match[2]);
    if (!/TABLEAUTEMPS|temps\s+de\s+passage|horaires?\s+eliminatoires?/i.test(textNoAccents(`${href} ${label}`))) continue;
    try {
      const url = new URL(href, baseUrl).href;
      if (!urls.includes(url)) urls.push(url);
    } catch {
      // Ignore malformed official links.
    }
  }
  return urls;
}

function dateTimeForTempliers(date, value, previousCutoff) {
  const dayMatch = String(value ?? "").match(/\(J\+(\d+)\)/i);
  const stripped = String(value ?? "").replace(/\(J\+\d+\)/i, "").trim();
  if (dayMatch) {
    return dateTimeForClockSequence(date, "00:00", stripped, addDaysDateTime(`${date}T00:00:00`, Number(dayMatch[1])));
  }
  return dateTimeForClockSequence(date, "00:00", stripped, `${date}T00:00:00`);
}

function findTempliersLocation(lines, index) {
  for (let cursor = index - 1; cursor >= 0 && cursor >= index - 12; cursor -= 1) {
    const line = lines[cursor];
    if (isTempliersHeaderLine(line) || containsTempliersRaceLabel(line) || /\d{1,2}h|\d+[,.]\d/.test(line)) continue;
    return line;
  }
  return null;
}

function isTempliersHeaderLine(line) {
  return /^(?:VENDREDI|SAMEDI|DIMANCHE|LIEUX|TEMPS DE PASSAGE|DEROUTAGE|BH|TEMPLIERS)$/i.test(normalizeKey(line));
}

function cleanTempliersName(value) {
  return String(value ?? "")
    .replace(/^(?:P\s*\d+|P\d+)\s*/i, "")
    .replace(/\s+/g, " ")
    .trim() || null;
}

function normalizeKey(value) {
  return textNoAccents(String(value ?? ""))
    .toUpperCase()
    .replace(/\s+/g, " ")
    .trim();
}

function containsTempliersRaceLabel(value) {
  const normalized = normalizeKey(value);
  return RACES.some((race) => normalized.includes(normalizeKey(race.cutoffLabel)));
}

function addDaysDateTime(dateTime, days) {
  const match = String(dateTime ?? "").match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):00$/);
  if (!match) return null;
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]) + days, Number(match[4]), Number(match[5]), 0));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(date.getUTCDate()).padStart(2, "0")}T${String(date.getUTCHours()).padStart(2, "0")}:${String(date.getUTCMinutes()).padStart(2, "0")}:00`;
}

function sourceFromUrl(url, { type, retrievedAt, event, race }) {
  return createSource({ url, type, retrievedAt, event, race });
}

function dedupeCheckpoints(checkpoints) {
  const seen = new Set();
  return checkpoints.filter((checkpoint) => {
    const key = `${checkpoint.name}:${checkpoint.distanceKm}:${checkpoint.cutoffDateTime}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
