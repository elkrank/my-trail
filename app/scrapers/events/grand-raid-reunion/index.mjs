import { fetchText } from "../../common/fetch.mjs";
import {
  buildFinishCheckpoint,
  checkpointFromCutoff,
  dateTimeForFrenchWeekdayAfterStart,
  sortCheckpoints,
} from "../../common/cutoffs.mjs";
import {
  createEdition,
  createDataAvailability,
  createEvent,
  createIllustration,
  createRace,
  createRaceEntry,
  createSource,
  normalizeHttpUrl,
  sourceFromFetch,
} from "../../common/model.mjs";
import {
  extractIllustration,
  numberFrom,
  parseDurationToMinutes,
  parseTime,
  stripHtml,
  textNoAccents,
} from "../../common/parse.mjs";
import { fetchPdfText } from "../../common/pdf.mjs";

const BASE_URL = "https://www.grandraid-reunion.com";
const COURSES_URL = `${BASE_URL}/fr/les-courses/`;
const REGISTRATION_URL = `${BASE_URL}/en/registrations/registration-formalities/modalites-des-inscriptions`;
const RULES_URL = `${BASE_URL}/fr/inscriptions/reglement/`;
const ROADBOOK_URL = `${BASE_URL}/fr/informations-pratiques/carnet-de-route/`;

const RACES = [
  {
    path: "/fr/les-courses/la-diagonale-des-fous/",
    name: "La Diagonale des Fous",
    shortName: "Diagonale",
    raceType: "solo",
  },
  {
    path: "/fr/les-courses/le-trail-de-bourbon/",
    name: "Le Trail de Bourbon",
    shortName: "Bourbon",
    raceType: "solo",
  },
  {
    path: "/fr/les-courses/la-mascareignes/",
    name: "La Mascareignes",
    shortName: "Mascareignes",
    raceType: "solo",
  },
  {
    path: "/fr/les-courses/le-metis-trail/",
    name: "Le Metis Trail",
    shortName: "Metis",
    raceType: "solo",
  },
  {
    path: "/fr/les-courses/le-zembrocal-trail/",
    name: "Le Zembrocal Trail",
    shortName: "Zembrocal",
    raceType: "relay",
  },
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
  const listStats = parseCourseList(coursesText);
  const prices = parsePrices(registrationText);
  const maxParticipants = parseMaxParticipants(registrationText);
  const qualifications = parseQualificationRules(registrationText, rulesText);
  const eventRange = registrationText.match(/auront lieu du\s+(\d{1,2}\s+au\s+\d{1,2}\s+[A-Za-z]+)\b/i)?.[1] ?? null;
  const roadbookIsCurrentYear = roadbookText.includes(String(year));

  const races = [];
  for (const raceConfig of RACES) {
    const url = new URL(raceConfig.path, BASE_URL).href;
    let racePage = null;
    try {
      racePage = await fetchText(url);
    } catch (error) {
      sourceErrors.push({ url, message: error.message, status: error.status ?? null });
    }

    const pageStats = parseGrandRaidRacePage(racePage?.content ?? "", { year });
    const data = {
      ...(listStats.get(raceConfig.name) ?? {}),
      ...pageStats,
    };
    const barrierPdfUrl = data.pdfUrls?.find((pdfUrl) => /barrieres?_horaires?/i.test(pdfUrl)) ?? null;
    const aidPdfUrl = data.pdfUrls?.find((pdfUrl) => /postes/i.test(pdfUrl)) ??
      (raceConfig.shortName === "Metis" ? data.pdfUrls?.find((pdfUrl) => /descriptif/i.test(pdfUrl)) : null) ??
      null;
    let barrierPdf = null;
    if (barrierPdfUrl) {
      try {
        barrierPdf = await fetchPdfText(barrierPdfUrl);
      } catch (error) {
        sourceErrors.push({ url: barrierPdfUrl, message: error.message, status: error.status ?? null });
      }
    }
    const parsedBarriers = parseGrandRaidBarrierPdf(barrierPdf?.text ?? "", {
      date: data.date ?? null,
      startTime: data.startTime ?? null,
      distanceKm: data.distanceKm ?? null,
      maxDurationMinutes: data.maxDurationMinutes ?? null,
    });
    let aidPdf = null;
    if (aidPdfUrl) {
      try {
        aidPdf = await fetchPdfText(aidPdfUrl);
      } catch (error) {
        sourceErrors.push({ url: aidPdfUrl, message: error.message, status: error.status ?? null });
      }
    }
    const parsedAid = parseGrandRaidAidStationPdf(aidPdf?.layoutPages ?? [], {
      raceDistanceKm: data.distanceKm ?? null,
    });
    const race = createRace(event, {
      name: raceConfig.name,
      shortName: raceConfig.shortName,
    });
    const sources = buildSources({
      event,
      race,
      racePage,
      pages,
      roadbookIsCurrentYear,
      data,
    });
    const illustration = racePage || pages.courses
      ? createIllustration({
        url: extractIllustration((racePage ?? pages.courses).content, (racePage ?? pages.courses).finalUrl ?? (racePage ?? pages.courses).url),
        sourceUrl: (racePage ?? pages.courses).finalUrl ?? (racePage ?? pages.courses).url,
        event: event.name,
        race: race.shortName,
      })
      : null;
    const warnings = [
      ...(eventRange && !data.date ? [`Official 2026 event range found (${eventRange}), but race-specific start date was not found.`] : []),
      ...(!roadbookIsCurrentYear ? ["Official roadbook page did not expose a current 2026 roadbook; 2025 roadbook data was not reused."] : []),
      ...parsedBarriers.warnings,
      ...parsedAid.warnings,
      ...(data.warnings ?? []),
    ];

    const edition = createEdition(year, {
      date: data.date ?? null,
      startTime: data.startTime ?? null,
      distanceKm: data.distanceKm ?? null,
      elevationGainM: data.elevationGainM ?? null,
      raceType: raceConfig.raceType,
      terrainType: "trail",
      startLocation: data.startLocation ?? (raceConfig.shortName === "Diagonale" ? "Saint-Pierre" : null),
      finishLocation: "La Redoute",
      maxDurationMinutes: data.maxDurationMinutes ?? null,
      nightStart: data.startTime ? data.startTime < "06:00" || data.startTime >= "20:00" : null,
      illustration,
      registration: {
        priceEur: data.priceEur ?? prices.get(race.shortName) ?? null,
        url: pages.registration ? normalizeHttpUrl(pages.registration.finalUrl ?? pages.registration.url ?? REGISTRATION_URL) : null,
        maxParticipants: data.maxParticipants ?? maxParticipants.get(race.shortName) ?? null,
        qualificationRequired: qualifications.get(race.shortName) ?? null,
      },
      checkpoints: parsedBarriers.checkpoints.length
        ? parsedBarriers.checkpoints
        : buildFinishCheckpoint({
          distanceKm: data.distanceKm ?? null,
          maxDurationMinutes: data.maxDurationMinutes ?? null,
        }),
      aidStations: parsedAid.reliable ? parsedAid.aidStations : [],
      mandatoryEquipment: data.mandatoryEquipment ?? [],
      rules: {
        personalAssistanceAllowed: rulesText ? true : null,
      },
      terrainDescription: data.description ?? null,
      rawOfficial: {
        traceId: data.traceId ?? null,
        relayLegsKm: data.relayLegsKm ?? null,
      },
      dataAvailability: {
        aidStations: parsedAid.reliable
          ? createDataAvailability("known", {
            sourceUrl: aidPdfUrl,
            checkedAt: aidPdf?.retrievedAt,
            reason: "Aid stations and services were extracted from the official 2026 posts table.",
          })
          : createDataAvailability("extraction_error", {
            sourceUrl: aidPdfUrl ?? url,
            checkedAt: aidPdf?.retrievedAt ?? racePage?.retrievedAt,
            reason: aidPdfUrl
              ? "Official 2026 PDF is available but its aid-station service markers could not be extracted reliably."
              : "No machine-readable 2026 aid-station table was found on the official race page.",
          }),
      },
      sources,
    });

    const entry = createRaceEntry({ event, race, edition });
    entry.quality.warnings = warnings;
    races.push(entry);
  }

  return { event, sourceErrors, races };
}

function buildSources({ event, race, racePage, pages, roadbookIsCurrentYear, data }) {
  const sources = [];
  if (racePage) sources.push(sourceFromFetch(racePage, { type: "official-race-page", event: event.name, race: race.shortName }));
  if (pages.courses) sources.push(sourceFromFetch(pages.courses, { type: "official-race-page", event: event.name, race: race.shortName }));
  if (pages.registration) sources.push(sourceFromFetch(pages.registration, { type: "official-registration", event: event.name, race: race.shortName }));
  if (pages.rules) sources.push(sourceFromFetch(pages.rules, { type: "official-rules", event: event.name, race: race.shortName }));
  if (pages.roadbook && roadbookIsCurrentYear) sources.push(sourceFromFetch(pages.roadbook, { type: "official-roadbook", event: event.name, race: race.shortName }));

  for (const pdfUrl of data.pdfUrls ?? []) {
    sources.push(sourceFromUrl(pdfUrl, {
      type: "official-roadbook",
      retrievedAt: racePage?.retrievedAt ?? new Date().toISOString(),
      event: event.name,
      race: race.shortName,
    }));
  }
  if (data.traceUrl) {
    sources.push(sourceFromUrl(data.traceUrl, {
      type: "official-map-platform",
      retrievedAt: racePage?.retrievedAt ?? new Date().toISOString(),
      event: event.name,
      race: race.shortName,
    }));
  }

  return dedupeSources(sources);
}

function parseCourseList(text) {
  const output = new Map();
  for (const { name } of RACES) {
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

export function parseGrandRaidRacePage(html, { year = 2026 } = {}) {
  if (!html) return { warnings: ["Official race detail page was not fetched."] };

  const text = stripHtml(html);
  const plain = textNoAccents(text);
  const characteristics = plain.match(/Caracteristiques\s+([\s\S]{0,1400}?)(?:equipement obligatoire|Retrait|Programme|$)/i)?.[1] ?? "";
  const date = parseGrandRaidDate(characteristics, year);
  const startTime = parseTime(characteristics.match(/(?:Depart a\s*)?(\d{1,2}h(?:\d{2})?)/i)?.[1]);
  const traceUrl = extractTraceUrl(html);
  const warnings = [];

  if (/Avis important/i.test(text)) {
    warnings.push("Official race page states the 2026 route can still be modified for administrative, practical or trail-condition reasons.");
  }
  if (characteristics && !date) warnings.push("Official race page exposes characteristics but no parseable 2026 race date.");

  return {
    date,
    startTime,
    distanceKm: parseRaceDistance(characteristics),
    elevationGainM: numberFrom(characteristics.match(/\b(\d+(?:[,.]\d+)?)\s*m\s*D\+/i)?.[1]),
    startLocation: extractStartLocation(characteristics),
    maxDurationMinutes: parseDurationToMinutes(characteristics.match(/Barriere horaire\s*:?\s*([0-9]{1,3}\s*h(?:[0-9]{2})?)/i)?.[1]),
    priceEur: numberFrom(characteristics.match(/Prix inscription\s*:?\s*(\d+)/i)?.[1]),
    maxParticipants: parseGrandRaidMaxParticipants(characteristics),
    mandatoryEquipment: parseMandatoryEquipment(plain),
    description: parseDescription(text),
    traceUrl,
    traceId: traceUrl?.match(/\/iframe\/(\d+)/i)?.[1] ?? null,
    relayLegsKm: parseRelayLegs(characteristics),
    pdfUrls: extractOfficialPdfUrls(html),
    warnings,
  };
}

function parseGrandRaidDate(text, year) {
  const match = String(text ?? "").match(/\b(\d{1,2})\/(\d{1,2})\/(\d{2,4})\b/);
  if (!match) return null;
  const parsedYear = match[3].length === 2 ? 2000 + Number(match[3]) : Number(match[3]);
  if (parsedYear !== year) return null;
  return `${parsedYear}-${String(Number(match[2])).padStart(2, "0")}-${String(Number(match[1])).padStart(2, "0")}`;
}

function parseRaceDistance(text) {
  const afterCategory = String(text ?? "").match(/\bTrail\s+[A-Z]+\s+(\d+(?:[,.]\d+)?)\s*km\b/i)?.[1];
  return numberFrom(afterCategory ?? String(text ?? "").match(/\b(\d+(?:[,.]\d+)?)\s*km\b/i)?.[1]);
}

function extractStartLocation(characteristics) {
  const withoutRelay = String(characteristics ?? "").replace(/^Relais a 4\s*:\s*(?:\d+\s*km\s*\/?\s*){2,}/i, "").trim();
  const match = withoutRelay.match(/\b\d{1,2}\/\d{1,2}\/\d{2,4}\s+([\s\S]{2,90}?)(?:\s+Depart a\s+\d{1,2}h(?:\d{2})?|\s+\d{1,2}h(?:\d{2})?\s+Trail\b)/i);
  return cleanValue(match?.[1]);
}

function parseGrandRaidMaxParticipants(text) {
  const value = String(text ?? "").match(/\b(\d+)\s+participants maximum/i)?.[1] ??
    String(text ?? "").match(/participants maximum\s*:?\s*(\d+)/i)?.[1] ??
    String(text ?? "").match(/\b(\d+)\s+equipes? de \d+ maximum/i)?.[1];
  return value ? Number(value) : null;
}

function parseRelayLegs(text) {
  const match = String(text ?? "").match(/Relais a 4\s*:\s*([0-9km\s/]+)/i);
  if (!match) return null;
  const legs = [...match[1].matchAll(/(\d+(?:[,.]\d+)?)\s*km/gi)].map((item) => Number(item[1].replace(",", ".")));
  return legs.length ? legs : null;
}

function parseMandatoryEquipment(text) {
  const known = [
    ["reserve d'eau", "Reserve d'eau"],
    ["reserve alimentaire", "Reserve alimentaire"],
    ["gobelet", "Gobelet personnel"],
    ["couverture de survie", "Couverture de survie"],
    ["sifflet", "Sifflet"],
    ["telephone", "Telephone mobile"],
    ["lampe", "Lampe frontale"],
    ["batterie", "Batterie de rechange"],
    ["veste", "Veste de pluie"],
    ["piece d'identite", "Piece d'identite"],
  ];
  return [...new Set(known.filter(([needle]) => text.includes(needle)).map(([, label]) => label))];
}

function parseDescription(text) {
  const matches = [...String(text ?? "").matchAll(/20\d{2}\)\s+([\s\S]{80,900}?)(?:AVIS IMPORTANT|Le parcours|Caracteristiques)/gi)];
  const candidate = cleanValue(matches.at(-1)?.[1]);
  if (!candidate || /equipement obligatoire|dossard|bracelet de course/i.test(candidate)) return null;
  return candidate;
}

function extractTraceUrl(html) {
  const match = String(html ?? "").match(/<iframe[^>]+src=["']([^"']*tracedetrail\.fr[^"']*\/iframe\/\d+[^"']*)["']/i);
  return match ? normalizeHttpUrl(match[1]) : null;
}

function extractOfficialPdfUrls(html) {
  const urls = [];
  for (const match of String(html ?? "").matchAll(/<a[^>]+href=["']([^"']+\.pdf)["']/gi)) {
    const url = rootOfficialUrl(match[1]);
    if (url && !urls.includes(url) && url.includes("2026")) urls.push(url);
  }
  return urls;
}

function rootOfficialUrl(rawUrl) {
  try {
    const raw = String(rawUrl ?? "");
    const path = raw.startsWith("IMG/") ? `/${raw}` : raw;
    return new URL(path, BASE_URL).href;
  } catch {
    return null;
  }
}

function parsePrices(text) {
  const output = new Map();
  const mappings = new Map([
    ["La Diagonale Des Fous", "Diagonale"],
    ["Le Trail de Bourbon", "Bourbon"],
    ["La Mascareignes", "Mascareignes"],
    ["MÃ¨tis Trail", "Metis"],
    ["MÃ©tis Trail", "Metis"],
    ["Zembrocal trail", "Zembrocal"],
  ]);
  for (const [label, key] of mappings) {
    const match = text.match(new RegExp(`${label}[\\s\\S]{0,120}?Individuelle\\s*:?\\s*(\\d+)\\s*â‚¬`, "i"));
    if (match) output.set(key, Number(match[1]));
  }
  const zembrocal = text.match(/Zembrocal trail[\s\S]{0,140}?prix pour l.equipe\s*:?\s*(\d+)\s*â‚¬/i);
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

function sourceFromUrl(url, { type, retrievedAt, event, race }) {
  return createSource({ url, type, retrievedAt, event, race });
}

function dedupeSources(sources) {
  const seen = new Set();
  return sources.filter((source) => {
    const key = `${source.type}:${source.url}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function cleanValue(value) {
  const cleaned = String(value ?? "")
    .replace(/\s+/g, " ")
    .trim();
  return cleaned || null;
}

export function parseGrandRaidBarrierPdf(text, { date, startTime, distanceKm, maxDurationMinutes } = {}) {
  if (!text) return { checkpoints: [], warnings: [] };
  const startDateTime = date && startTime ? `${date}T${startTime}:00` : null;
  const lines = String(text)
    .split(/\r?\n/)
    .map((line) => cleanValue(line))
    .filter(Boolean);
  const timeGroups = findGrandRaidTimeGroups(lines);
  const checkpoints = [];
  const warnings = [];
  let previousDistance = 0;

  for (const group of timeGroups) {
    if (group.times.length < 2) continue;
    const name = extractGrandRaidName(lines, group.startIndex);
    const close = group.times.at(-1);
    const cutoffDateTime = dateTimeForFrenchWeekdayAfterStart(date, close.weekday, close.time);
    const distance = extractGrandRaidDistance(lines.slice(group.endIndex + 1, group.endIndex + 8), {
      previousDistance,
      raceDistanceKm: distanceKm,
    });
    if (!name || !cutoffDateTime || distance === 0) continue;

    const checkpoint = checkpointFromCutoff({
      name,
      distanceKm: distance,
      cutoffDateTime,
      startDateTime,
      aidStation: /^(BV|La Redoute|Hell-Bourg|Ilet Savannah|Grande Chaloupe|Colorado|Marla|Cilaos|Domaine Vidot|Mare a Boue|Plaine des Merles|Deux Bras|Place Festival|La Possession)/i.test(textNoAccents(name)),
      personalAssistanceAllowed: null,
    });
    if (!checkpoint) continue;
    if (Number.isFinite(checkpoint.distanceKm)) previousDistance = checkpoint.distanceKm;
    checkpoints.push(checkpoint);
  }

  const unique = dedupeCheckpoints(sortCheckpoints(checkpoints));
  const finish = unique.at(-1);
  if (
    Number.isFinite(maxDurationMinutes) &&
    finish &&
    Number.isFinite(finish.cutoffElapsedMinutes) &&
    Math.abs(finish.cutoffElapsedMinutes - maxDurationMinutes) > 90
  ) {
    warnings.push(`Official barrier PDF finish cutoff (${finish.cutoffElapsedMinutes} min) differs from race page max duration (${maxDurationMinutes} min).`);
  }
  if (text && unique.length === 0) warnings.push("Official barrier PDF was found but no usable cutoff checkpoint was extracted.");

  return { checkpoints: unique, warnings };
}

export function parseGrandRaidAidStationPdf(layoutPages, { raceDistanceKm = null } = {}) {
  const items = (layoutPages ?? []).flatMap((page) => page?.items ?? []);
  if (!items.length) {
    return {
      aidStations: [],
      reliable: false,
      warnings: ["Official posts PDF was found but has no machine-readable layout data."],
    };
  }

  const headerTop = Math.max(...items.map((item) => item.y).filter(Number.isFinite));
  const headerItems = items.filter((item) => item.y >= headerTop - 35);
  const altiX = headerItems.find((item) => /^Alti\.?$/i.test(item.text?.trim()))?.x;
  const openingX = headerItems.find((item) => /^Ouverture$/i.test(item.text?.trim()))?.x;
  const cumulativeX = headerItems
    .filter((item) => /^Cumul\b/i.test(item.text?.trim()) && (!Number.isFinite(altiX) || item.x < altiX))
    .sort((left, right) => right.x - left.x)[0]?.x;
  const serviceColumns = [
    ["refreshment", /^(?:Rav\.?|Ravito|Ravitaillement)$/i],
    ["soup", /^soupe$/i],
    ["hotMeal", /^Repas(?: chaud)?$/i],
    ["medical", /^Médecin$/i],
  ].map(([key, pattern]) => ({ key, x: headerItems.find((item) => pattern.test(item.text?.trim()))?.x }))
    .filter((column) => Number.isFinite(column.x));

  if (!Number.isFinite(cumulativeX) || !Number.isFinite(openingX) || serviceColumns.length < 2) {
    return {
      aidStations: [],
      reliable: false,
      warnings: ["Official posts PDF columns could not be identified reliably."],
    };
  }

  const dataItems = items.filter((item) => item.y < headerTop - 35);
  const markers = dataItems.filter((item) =>
    /^(?:|0|O)$/i.test(String(item.text ?? "").trim()) &&
    serviceColumns.some((column) => Math.abs(item.x - column.x) <= 16),
  );
  const rows = new Map();
  for (const marker of markers) {
    const distanceItem = dataItems
      .filter((item) => Math.abs(item.x - cumulativeX) <= 8 && Math.abs(item.y - marker.y) <= 7)
      .map((item) => ({ item, value: numberFrom(item.text) }))
      .find((candidate) => Number.isFinite(candidate.value) && candidate.value >= 0 && (!Number.isFinite(raceDistanceKm) || candidate.value <= raceDistanceKm + 5));
    if (!distanceItem) continue;
    const distanceKm = distanceItem.value;
    const name = dataItems
      .filter((item) => item.x < openingX - 5 && Math.abs(item.y - distanceItem.item.y) <= 9 && item.text?.trim())
      .sort((left, right) => right.y - left.y || left.x - right.x)
      .map((item) => item.text.trim())
      .join(" ")
      .replace(/\s+/g, " ")
      .trim();
    if (!name) continue;
    const row = rows.get(`${name}:${distanceKm}`) ?? { name, distanceKm, services: new Set() };
    const column = serviceColumns.find((candidate) => Math.abs(marker.x - candidate.x) <= 16);
    if (column) row.services.add(column.key);
    rows.set(`${name}:${distanceKm}`, row);
  }

  const aidStations = [...rows.values()]
    .filter((row) => row.services.has("refreshment") || row.services.has("soup") || row.services.has("hotMeal"))
    .sort((left, right) => left.distanceKm - right.distanceKm)
    .map((row) => ({
      name: row.name,
      distanceKm: row.distanceKm,
      elevationM: null,
      water: true,
      sportsDrink: null,
      solidFood: row.services.has("refreshment") || row.services.has("soup") || row.services.has("hotMeal"),
      hotFood: row.services.has("soup") || row.services.has("hotMeal"),
      dropBag: null,
      crewAccess: null,
      medical: row.services.has("medical"),
      cutoffDateTime: null,
      services: [...row.services],
    }));
  const lastAidDistanceKm = aidStations.at(-1)?.distanceKm ?? 0;
  const coversCourse = !Number.isFinite(raceDistanceKm) || lastAidDistanceKm >= raceDistanceKm * 0.6;
  const reliable = aidStations.length >= 2
    && coversCourse
    && aidStations.every((station, index) => index === 0 || station.distanceKm >= aidStations[index - 1].distanceKm);
  return {
    aidStations: reliable ? aidStations : [],
    reliable,
    warnings: reliable ? [] : [coversCourse
      ? "Official posts PDF service markers were not extractable with sufficient confidence."
      : "Official posts PDF extraction did not cover enough of the course to be considered complete."],
  };
}

function findGrandRaidTimeGroups(lines) {
  const tokens = [];
  for (let index = 0; index < lines.length; index += 1) {
    const current = lines[index];
    const sameLine = current.match(/^(jeudi|vendredi|samedi|dimanche)\s+([0-9oO]{1,2}h[0-9oO]{0,2})$/i);
    if (sameLine) {
      tokens.push({ weekday: sameLine[1], time: sameLine[2], startIndex: index, endIndex: index });
      continue;
    }
    if (/^(jeudi|vendredi|samedi|dimanche)$/i.test(current) && lines[index + 1] && /^[0-9oO]{1,2}h[0-9oO]{0,2}$/i.test(lines[index + 1])) {
      tokens.push({ weekday: current, time: lines[index + 1], startIndex: index, endIndex: index + 1 });
    }
  }

  const groups = [];
  let current = null;
  for (const token of tokens) {
    if (!current || token.startIndex - current.endIndex > 3) {
      if (current) groups.push(current);
      current = { startIndex: token.startIndex, endIndex: token.endIndex, times: [token] };
    } else {
      current.times.push(token);
      current.endIndex = token.endIndex;
    }
  }
  if (current) groups.push(current);
  return groups;
}

function extractGrandRaidName(lines, startIndex) {
  const parts = [];
  for (let index = startIndex - 1; index >= 0; index -= 1) {
    const line = lines[index];
    if (isGrandRaidBoundaryLine(line)) break;
    parts.unshift(line);
    if (parts.length >= 3) break;
  }
  return cleanValue(parts.join(" "))
    ?.replace(/^(?:DEP|ARR|CP\d+|BV\d+|PR\d+)\s+/i, "")
    ?.replace(/\s+/g, " ") ?? null;
}

function isGrandRaidBoundaryLine(line) {
  return /^(?:O|0|X|-)$/.test(line) ||
    /^(?:jeudi|vendredi|samedi|dimanche)(?:\s+[0-9oO]{1,2}h[0-9oO]{0,2})?$/i.test(line) ||
    /^[0-9,.\s/]+$/.test(line) ||
    /^(?:Ouverture|Fermeture|Partiel|Cumul|Alti|D\+|D-|Pointage|Assistance|Ravitaillement|soupe|Repas|Medecin|Infirmier|Kine|Podologue|Secouriste|Osteopathe|Autoris|Non autoris|Details|Pointage indicatif|Pointage avec|DEP =|DIAGONALE|TRAIL DE|MASCAREIGNES|METIS|RELAIS ZEMBROCAL)/i.test(textNoAccents(line));
}

function extractGrandRaidDistance(lines, { previousDistance = 0, raceDistanceKm = null } = {}) {
  for (const line of lines) {
    const candidates = grandRaidDistanceCandidates(line, raceDistanceKm);
    if (candidates.length >= 2) return candidates[1];
    const next = candidates.find((value) =>
      value >= Math.max(0, previousDistance - 0.3) &&
      (!Number.isFinite(raceDistanceKm) || value <= raceDistanceKm + 5),
    );
    if (Number.isFinite(next)) return next;
  }
  return null;
}

function grandRaidDistanceCandidates(line, raceDistanceKm) {
  const raw = String(line ?? "").replace(/\s+/g, "");
  const values = [...raw.matchAll(/\d{1,3},\d/g)].map((match) => Number(match[0].replace(",", ".")));
  const compactDecimal = raw.match(/^(\d)(\d{1,3},\d)$/);
  if (compactDecimal) values.push(Number(compactDecimal[2].replace(",", ".")));
  const compactCommaInteger = raw.match(/^\d,\d(\d{2,3})$/);
  if (compactCommaInteger) values.push(Number(compactCommaInteger[1]));
  const compactInteger = raw.match(/^\d(\d{2})$/);
  if (compactInteger) values.push(Number(compactInteger[1]));
  if (raw === "0") values.push(0);
  return [...new Set(values)]
    .filter((value) => Number.isFinite(value) && value >= 0 && (!Number.isFinite(raceDistanceKm) || value <= raceDistanceKm + 5));
}

function dedupeCheckpoints(checkpoints) {
  const seen = new Set();
  return checkpoints.filter((checkpoint) => {
    const key = `${checkpoint.name}:${checkpoint.cutoffDateTime}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
