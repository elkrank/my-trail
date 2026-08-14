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
import { extractIllustration, parseDate, parseTime, stripHtml, textNoAccents } from "../../common/parse.mjs";
import { fetchPdfText } from "../../common/pdf.mjs";

const BASE_URL = "https://www.maxi-race.org";
const TRACE_EVENT_URL = "https://tracedetrail.fr/fr/event/adidas-terrex-maxi-race-2026";
const ROADBOOK_URL = `${BASE_URL}/plan-canicule-2026/`;

export const MAXI_RACE_RACES = [
  {
    slug: "tour-du-lac-solo",
    path: "/tour-du-lac-solo/",
    traceUrl: "https://tracedetrail.fr/fr/trace/337955",
    traceLabel: "tOur du Lac d'Annecy 100km 1 jour",
    name: "tOur du Lac solo",
    shortName: "tOur solo",
    raceType: "solo",
    aidKey: "tour",
    fallbackStats: { date: "2026-05-30", distanceKm: 100, elevationGainM: 5446, elevationLossM: 5444 },
  },
  {
    slug: "tour-du-lac-2-jours",
    path: "/tour-du-lac-solo-en-2jours/",
    traceUrls: [
      "https://tracedetrail.fr/fr/trace/337955",
      "https://tracedetrail.fr/fr/trace/317545",
    ],
    name: "tOur du Lac en deux jours",
    shortName: "tOur 2 jours",
    raceType: "stage race",
    fallbackStats: { date: "2026-05-30" },
    stageDates: ["2026-05-30", "2026-05-31"],
    warnings: [
      "Official 2026 aggregate distance/elevation for the two-day race was not confirmed in a public 2026 source; value kept null.",
      "Current model stores one route per race; official stage traces are kept as raw metadata and not downloaded as a misleading single GPX.",
    ],
  },
  {
    slug: "tour-du-lac-relais",
    path: "/tour-du-lac-en-relais/",
    traceUrl: "https://tracedetrail.fr/fr/trace/337955",
    traceLabel: "tOur du Lac d'Annecy 100km 1 jour",
    name: "tOur du Lac en relais de deux ou trois personnes",
    shortName: "tOur relais",
    raceType: "relay",
    aidKey: "tour",
    fallbackStats: { date: "2026-05-30", distanceKm: 100, elevationGainM: 5446, elevationLossM: 5444 },
  },
  {
    slug: "demi-tour-du-lac",
    path: "/demi-tour/",
    traceUrl: "https://tracedetrail.fr/fr/trace/317545",
    traceLabel: "Shokz-Demi-tOur-du-Lac 55k",
    name: "Demi-tOur du Lac",
    shortName: "Demi-tOur",
    raceType: "solo",
    aidKey: "demi",
    fallbackStats: { date: "2026-05-31", distanceKm: 57.69, elevationGainM: 3344, elevationLossM: 3354 },
  },
  {
    slug: "marathon-experience",
    path: "/marathon-experience/",
    traceUrl: "https://tracedetrail.fr/fr/trace/317565",
    traceLabel: "Marathon-eXpérience 40k",
    name: "Marathon-eXperience",
    shortName: "Marathon-eXperience",
    raceType: "solo",
    aidKey: "marathon",
    fallbackStats: { date: "2026-05-30", distanceKm: 39.88, elevationGainM: 1713, elevationLossM: 1756 },
  },
  {
    slug: "quart-de-tour-du-lac",
    path: "/quart-de-tour/",
    traceUrl: "https://tracedetrail.fr/fr/trace/317422",
    traceLabel: "Quart-de-tour : Homme : Negatif Trail",
    name: "Quart-de-tOur du Lac",
    shortName: "Quart-de-tOur",
    raceType: "solo",
    fallbackStats: { date: "2026-05-30", distanceKm: 19.95, elevationGainM: 412, elevationLossM: 1439 },
    conflictDateSource: "2026-05-29",
  },
];

export async function collect({ year }) {
  const event = createEvent({
    id: "maxi-race",
    name: "MaXi-Race du lac d'Annecy",
    slug: "maxi-race",
    country: "France",
    region: "Auvergne-Rhone-Alpes",
    city: "Annecy",
    officialWebsite: BASE_URL,
  });

  const sourceErrors = [];
  let traceEvent = null;
  let roadbook = null;
  try {
    traceEvent = await fetchText(TRACE_EVENT_URL);
  } catch (error) {
    sourceErrors.push({ url: TRACE_EVENT_URL, message: error.message, status: error.status ?? null });
  }
  try {
    roadbook = await fetchText(ROADBOOK_URL);
  } catch (error) {
    sourceErrors.push({ url: ROADBOOK_URL, message: error.message, status: error.status ?? null });
  }

  const traceStats = parseMaxiRaceTraceEvent(traceEvent?.content ?? "");
  const races = [];
  for (const raceConfig of MAXI_RACE_RACES) {
    const url = new URL(raceConfig.path, BASE_URL).href;
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
      races.push(buildMaxiRaceEntry({ event, raceConfig, page, traceEvent, roadbook, traceStats, cutoffPdfs, year }));
    } catch (error) {
      sourceErrors.push({ url, message: error.message, status: error.status ?? null });
      races.push(buildMaxiRaceEntry({ event, raceConfig, page: null, traceEvent, roadbook, traceStats, cutoffPdfs: [], year }));
    }
  }

  return { event, sourceErrors, races };
}

export function buildMaxiRaceEntry({ event, raceConfig, page, traceEvent, roadbook, traceStats, cutoffPdfs = [], year }) {
  const race = createRace(event, {
    id: `${event.id}-${raceConfig.slug}`,
    name: raceConfig.name,
    shortName: raceConfig.shortName,
  });
  const stats = raceConfig.traceLabel
    ? traceStats.get(raceConfig.traceLabel) ?? raceConfig.fallbackStats ?? {}
    : raceConfig.fallbackStats ?? {};
  const pageSignals = parseMaxiRacePageSignals(page?.content ?? "", { year });
  const warnings = [
    ...(raceConfig.warnings ?? []),
    ...pageSignals.warnings,
  ];
  const sources = [];

  if (page) {
    sources.push(sourceFromFetch(page, { type: "official-race-page", event: event.name, race: race.shortName }));
  }
  if (traceEvent) {
    sources.push(sourceFromFetch(traceEvent, { type: "official-map-platform", event: event.name, race: race.shortName }));
  }
  if (roadbook) {
    sources.push(sourceFromFetch(roadbook, { type: "official-roadbook", event: event.name, race: race.shortName }));
  }
  for (const pdf of cutoffPdfs) {
    sources.push(sourceFromUrl(pdf.finalUrl ?? pdf.url, {
      type: "official-roadbook",
      retrievedAt: pdf.retrievedAt,
      event: event.name,
      race: race.shortName,
    }));
  }
  for (const url of [raceConfig.traceUrl, ...(raceConfig.traceUrls ?? [])].filter(Boolean)) {
    sources.push(sourceFromUrl(url, {
      type: "official-map-platform",
      retrievedAt: traceEvent?.retrievedAt ?? roadbook?.retrievedAt ?? page?.retrievedAt ?? new Date().toISOString(),
      event: event.name,
      race: race.shortName,
    }));
  }

  let date = stats.date ?? null;
  if (raceConfig.conflictDateSource && date && raceConfig.conflictDateSource !== date) {
    warnings.push(`Official sources conflict on 2026 date: race page ${raceConfig.conflictDateSource}, Trace de Trail ${date}.`);
    date = null;
  }
  const parsedCutoffs = mergeMaxiRaceCutoffs(cutoffPdfs, {
    date,
    startTime: pageSignals.startTime,
  });
  warnings.push(...parsedCutoffs.warnings);

  const multiStageGpx = raceConfig.traceUrls
    ? {
      status: "multi-stage",
      sourcePlatform: "trace-de-trail",
      traces: raceConfig.traceUrls,
    }
    : null;
  const illustration = page
    ? createIllustration({
      url: extractIllustration(page.content, page.finalUrl ?? page.url),
      sourceUrl: page.finalUrl ?? page.url,
      event: event.name,
      race: race.shortName,
    })
    : null;

  const edition = createEdition(year, {
    date,
    startTime: pageSignals.startTime,
    distanceKm: stats.distanceKm ?? null,
    elevationGainM: stats.elevationGainM ?? null,
    elevationLossM: stats.elevationLossM ?? null,
    startLocation: null,
    finishLocation: null,
    maxDurationMinutes: parsedCutoffs.maxDurationMinutes,
    raceType: raceConfig.raceType,
    terrainType: "trail",
    terrainDescription: pageSignals.description,
    nightStart: pageSignals.startTime ? pageSignals.startTime < "06:00" || pageSignals.startTime >= "20:00" : null,
    illustration,
    gpx: multiStageGpx,
    checkpoints: parsedCutoffs.checkpoints,
    aidStations: roadbook && raceConfig.aidKey ? aidStationsFor(raceConfig.aidKey) : [],
    mandatoryEquipment: roadbook && raceConfig.aidKey
      ? ["minimum 1.5 L water reserve for hot-weather plan", "headwear recommended by hot-weather plan"]
      : [],
    rules: {
      dropBagAllowed: /Drop Bag/i.test(pageSignals.rawText) ? true : null,
      personalAssistanceAllowed: /Il n.?y a pas d.?assistance possible/i.test(pageSignals.rawText) ? false : null,
      minimumWaterLiters: roadbook && raceConfig.aidKey ? 1.5 : null,
    },
    rawOfficial: {
      traceLabel: raceConfig.traceLabel ?? null,
      traceIds: [raceConfig.traceUrl, ...(raceConfig.traceUrls ?? [])]
        .filter(Boolean)
        .map((url) => String(url).match(/\/trace\/(\d+)/)?.[1])
        .filter(Boolean),
      stageTraceUrls: raceConfig.traceUrls ?? null,
      stageDates: raceConfig.stageDates ?? null,
      distanceRangeKm: pageSignals.distanceRangeKm,
      elevationRangeM: pageSignals.elevationRangeM,
    },
    sources: dedupeSources(sources),
  });

  const entry = createRaceEntry({ event, race, edition });
  entry.quality.warnings = warnings;
  return entry;
}

export function parseMaxiRaceTraceEvent(html) {
  const text = stripHtml(html);
  const stats = new Map();
  for (const match of text.matchAll(/([^\n]+?)\s*\n\s*(?:vendredi|samedi|dimanche)\s+([0-9]{1,2}\s+\w+\s+2026)\s*\n\s*Image\s+([0-9]+(?:[,.][0-9]+)?)\s*km\s+([0-9]+)\s*m\s+([0-9]+)\s*m/gi)) {
    stats.set(cleanValue(match[1]), {
      date: parseDate(match[2], 2026),
      distanceKm: numberFromText(match[3]),
      elevationGainM: Number.parseInt(match[4], 10),
      elevationLossM: Number.parseInt(match[5], 10),
    });
  }
  return stats;
}

export function parseMaxiRacePageSignals(html, { year = 2026 } = {}) {
  const text = stripHtml(html);
  const warnings = [];
  const oneLine = text.replace(/\s+/g, " ");
  const distanceRangeKm = parseDistanceRange(valueAfterLabel(oneLine, /Distance/i, [/D[ée]nivel[ée]/i, /Inscriptions/i, /##/i]));
  const elevationRangeM = parseDistanceRange(valueAfterLabel(oneLine, /D[ée]nivel[ée]/i, [/Inscriptions/i, /##/i]));
  const pageDate = parseDate(valueAfterLabel(oneLine, /Date(?:s)?/i, [/Distance/i, /D[ée]nivel[ée]/i, /Inscriptions/i]), year);

  if (distanceRangeKm.raw && distanceRangeKm.distanceKm === null) {
    warnings.push(`Official race page exposes a distance range (${distanceRangeKm.raw}); no exact value was inferred from it.`);
  }
  if (pageDate && pageDate.startsWith(String(year + 1))) {
    warnings.push(`Official race page date appears to be ${pageDate}; it was not used for the 2026 edition.`);
  }

  return {
    rawText: text,
    startTime: parseTime(oneLine.match(/Horaires? de d[ée]part\s*:\s*\*?\s*([0-9]{1,2}h[0-9]{0,2})/i)?.[1]),
    description: firstDescription(text),
    distanceRangeKm: distanceRangeKm.raw,
    elevationRangeM: elevationRangeM.raw,
    warnings,
  };
}

export function parseDistanceRange(value) {
  const raw = cleanValue(value);
  if (!raw) return { distanceKm: null, raw: null };
  if (/\b[0-9]+(?:[,.][0-9]+)?\s*(?:[aà]|-)\s*[0-9]+(?:[,.][0-9]+)?\b/i.test(raw)) {
    return { distanceKm: null, raw };
  }
  return { distanceKm: numberFromText(raw), raw };
}

function aidStationsFor(key) {
  const stations = {
    tour: [
      station("Alex Light Aid", 16.6, { solidFood: false }),
      station("Montremont Light Aid", 27.5, { solidFood: false }),
      station("Montmin water point", 36, { solidFood: false }),
      station("Doussard Life Base", 45.5),
      station("Below Col de Bornette water point", 61, { solidFood: false }),
      station("Bellecombe-en-Bauges", 66),
      station("Route du Col de Leschaux water point", 75, { solidFood: false }),
      station("Route du Col de Leschaux water point", 78, { solidFood: false }),
      station("Semnoz Life Base", 86),
      station("Route du Grand Roc water point", 94, { solidFood: false }),
    ],
    demi: [
      station("Les Maisons water point", 13.5, { solidFood: false }),
      station("Saint-Eustache water point", 21.5, { solidFood: false }),
      station("Route du Col de Leschaux water point", 30, { solidFood: false }),
      station("Semnoz Life Base", 37),
      station("Chez Charvin water point", 46, { solidFood: false }),
      station("Route du Grand Roc water point", 51, { solidFood: false }),
    ],
    marathon: [
      station("Semnoz Life Base", 18),
      station("Route du Grand Roc water point", 33, { solidFood: false }),
    ],
  };
  return stations[key] ?? [];
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
    dropBag: null,
    crewAccess: null,
    medical: null,
    cutoffDateTime: null,
  };
}

function valueAfterLabel(text, labelPattern, stopPatterns) {
  const stop = stopPatterns.map((pattern) => pattern.source).join("|");
  const match = text.match(new RegExp(`${labelPattern.source}\\s+([\\s\\S]{0,120}?)(?=\\s+(?:${stop})|$)`, "i"));
  return cleanValue(match?.[1]);
}

function firstDescription(text) {
  const match = text.match(/##\s+[^#\n]+\s+([\s\S]{70,900}?)(?:## Plus d'infos|Plus d'infos sur la course|Retraits des dossards|Assistance|Mat[ée]riel|$)/i);
  return cleanValue(match?.[1]);
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

export function parseMaxiRaceCutoffPdfText(text, { date, startTime } = {}) {
  if (!text) return { checkpoints: [], maxDurationMinutes: null, warnings: [] };
  const lines = String(text)
    .split(/\r?\n/)
    .map((line) => cleanValue(line))
    .filter(Boolean);
  const effectiveDate = date ?? "2000-01-01";
  const effectiveStartTime = startTime ?? inferMaxiStartTime(lines) ?? "00:00";
  const startDateTime = `${effectiveDate}T${effectiveStartTime}:00`;
  const checkpoints = [];
  let previousCutoff = startDateTime;
  let nameParts = [];

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (isMaxiFooterLine(line) || isMaxiHeaderLine(line)) {
      nameParts = [];
      continue;
    }

    const metric = parseMaxiMetricLine(line);
    if (!metric) {
      if (!isMaxiNoiseLine(line)) nameParts.push(line);
      continue;
    }

    if (metric.distanceKm === 0) {
      index = consumeMaxiTimeLines(lines, index);
      nameParts = [];
      continue;
    }

    const name = cleanMaxiCheckpointName(metric.name ? metric.name : nameParts.join(" "));
    nameParts = [];
    if (!name) continue;

    let barrier = null;
    let consumedUntil = index;
    for (let cursor = index + 1; cursor < lines.length; cursor += 1) {
      const candidate = lines[cursor];
      if (parseMaxiMetricLine(candidate) || isMaxiFooterLine(candidate) || isMaxiHeaderLine(candidate)) break;
      if (/^-$/.test(candidate)) {
        consumedUntil = cursor;
        barrier = null;
        break;
      }
      const standaloneBeforeNoise = candidate.match(/^(\d{1,2}[:h]\d{2})$/i)?.[1];
      if (standaloneBeforeNoise) {
        consumedUntil = cursor;
        barrier = standaloneBeforeNoise;
        break;
      }
      if (isMaxiNoiseLine(candidate)) {
        consumedUntil = cursor;
        continue;
      }
      if (/apres|après|bascule|parcours plus court/i.test(candidate)) continue;
      const standalone = candidate.match(/^(\d{1,2}[:h]\d{2})$/i)?.[1];
      if (standalone) {
        consumedUntil = cursor;
        barrier = standalone;
        break;
      }
      if (/\d{1,2}[:h]\d{2}/i.test(candidate)) {
        consumedUntil = cursor;
        continue;
      }
      break;
    }
    index = consumedUntil;
    if (!barrier) continue;

    const cutoffDateTime = dateTimeForClockSequence(effectiveDate, effectiveStartTime, barrier, previousCutoff);
    const checkpoint = checkpointFromCutoff({
      name,
      distanceKm: metric.distanceKm,
      cutoffDateTime,
      startDateTime,
      aidStation: /ravitaillement|base vie|point d.eau|arrivee/i.test(textNoAccents(name)),
    });
    if (!checkpoint) continue;
    previousCutoff = cutoffDateTime ?? previousCutoff;
    if (!date) checkpoint.cutoffDateTime = null;
    checkpoints.push(checkpoint);
  }

  const unique = dedupeCheckpoints(sortCheckpoints(checkpoints));
  return {
    checkpoints: unique,
    maxDurationMinutes: unique.at(-1)?.cutoffElapsedMinutes ?? null,
    warnings: text && unique.length === 0 ? ["Official Maxi-Race cutoff PDF was found but no usable checkpoint was extracted."] : [],
  };
}

function mergeMaxiRaceCutoffs(pdfs, options) {
  const merged = [];
  const warnings = [];
  for (const pdf of pdfs) {
    const parsed = parseMaxiRaceCutoffPdfText(pdf.text, options);
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

function extractCutoffPdfUrls(html, baseUrl) {
  const urls = [];
  for (const match of String(html ?? "").matchAll(/<a[^>]+href=["']([^"']+\.pdf)["'][^>]*>/gi)) {
    const href = match[1];
    if (!/tableau-de-course/i.test(href)) continue;
    try {
      const url = new URL(href, baseUrl).href;
      if (!urls.includes(url)) urls.push(url);
    } catch {
      // Ignore malformed official links.
    }
  }
  return urls;
}

function parseMaxiMetricLine(line) {
  const raw = String(line ?? "").trim();
  if (/^\d{1,2}[:h]/i.test(raw)) return null;
  if (/^\d{1,2}$/.test(raw) || /^\d{1,2}[,.]\d\s*(?:a|Ã |à)?$/i.test(raw)) return null;
  const inline = /^\d/.test(raw) ? null : raw.match(/^(.+?[^0-9])(\d[\d,.].*)$/);
  const name = inline ? inline[1] : null;
  const metricRaw = inline ? inline[2] : raw;
  if (!inline && /^0+\s*\/\s*0+$/.test(metricRaw)) return { distanceKm: 0, name };
  if (!inline && /^\d{1,3}\s*\/\s*\d+/.test(metricRaw)) return null;
  const normalized = metricRaw.replace(",", ".");
  const compactDecimal = raw.match(/^(\d{1,3})[,.](\d)(?=\d{2,})/);
  const compactInteger = metricRaw.match(/^(\d{4,})(?:\s*\/|\s|$)/);
  const match = normalized.match(/^(\d+(?:\.\d+)?)/);
  let distanceKm = null;
  const metricCompactDecimal = metricRaw.match(/^(\d{1,3})[,.](\d)(?=\d{2,})/);
  if (metricCompactDecimal) {
    distanceKm = Number(`${metricCompactDecimal[1]}.${metricCompactDecimal[2]}`);
  } else if (compactDecimal) {
    distanceKm = Number(`${compactDecimal[1]}.${compactDecimal[2]}`);
  } else if (compactInteger) {
    const digits = compactInteger[1];
    distanceKm = Number(digits.startsWith("100") ? digits.slice(0, 3) : digits.slice(0, 2));
  } else if (match) {
    distanceKm = Number(match[1]);
  }
  return Number.isFinite(distanceKm) ? { distanceKm, name } : null;
}

function consumeMaxiTimeLines(lines, index) {
  let consumedUntil = index;
  for (let cursor = index + 1; cursor < lines.length; cursor += 1) {
    const candidate = lines[cursor];
    if (parseMaxiMetricLine(candidate) || isMaxiFooterLine(candidate)) break;
    if (
      /^-+$/.test(candidate) ||
      /\d{1,2}[:h]\d{2}/i.test(candidate) ||
      /apres|aprÃ¨s|bascule|parcours plus court/i.test(candidate) ||
      isMaxiNoiseLine(candidate)
    ) {
      consumedUntil = cursor;
      continue;
    }
    break;
  }
  return consumedUntil;
}

function cleanMaxiCheckpointName(value) {
  return String(value ?? "")
    .replace(/\b\d+(?:er|eme|ème|nd)?\b/gi, " ")
    .replace(/\bzone etroite et caillouteuse\b/i, "Zone etroite et caillouteuse")
    .replace(/\s+/g, " ")
    .trim() || null;
}

function isMaxiHeaderLine(line) {
  return /^(?:Lieu|Info|Vague|Barriere|Barri[eè]re|Heure du|D-|D\+|D\+ \/ D-|Derniers)/i.test(textNoAccents(line));
}

function isMaxiFooterLine(line) {
  return /^Tableau horaires|^Les deniveles|^Informations coureurs|^Informations accompagnants|^Samedi \d/i.test(textNoAccents(line));
}

function isMaxiNoiseLine(line) {
  const normalized = String(line ?? "").replace(/\s+/g, "");
  const compactTimes = normalized.match(/\d{1,2}[:h]\d{2}/gi) ?? [];
  return (compactTimes.length >= 1 && compactTimes.join("") === normalized) ||
    /^\d{1,2}$/.test(String(line ?? "").trim()) ||
    /^\d{1,2}[,.]\d\s*(?:a|Ã |à)?$/i.test(String(line ?? "").trim()) ||
    /^\d{1,3}\s*\/\s*\d+/.test(String(line ?? "").trim()) ||
    /zone [eé]troite|zone etroite|technique|caillouteuse/i.test(textNoAccents(line)) ||
    /^(?:-|er|ere|ère|eme|ème|nd|Barriere horaire|Barri[eè]re horaire|Vague|Dernier|Premier|Relais|meme dans les mains|Les ranger|sur son sac|indique|apres|Après)$/i.test(line);
}

function inferMaxiStartTime(lines) {
  const beforeFirstMetric = [];
  for (const line of lines) {
    if (parseMaxiMetricLine(line)) break;
    beforeFirstMetric.push(line);
  }
  const times = beforeFirstMetric.flatMap((line) =>
    [...String(line).matchAll(/\d{1,2}[:h]\d{2}/gi)].map((match) => match[0]),
  );
  return normalizeMaxiTime(times[0]);
}

function normalizeMaxiTime(value) {
  const match = String(value ?? "").match(/(\d{1,2})[:h](\d{2})/i);
  if (!match) return null;
  return `${String(Number(match[1])).padStart(2, "0")}:${match[2]}`;
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
