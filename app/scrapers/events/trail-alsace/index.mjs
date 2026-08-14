import { fetchText } from "../../common/fetch.mjs";
import {
  createEdition,
  createEvent,
  createRace,
  createRaceEntry,
  createSource,
  sourceFromFetch,
} from "../../common/model.mjs";
import {
  extractNextData,
  parseDate,
  parseDurationToMinutes,
  parseStartPlaceAndTime,
  stripHtml,
} from "../../common/parse.mjs";
import {
  buildAidStations as buildUtmbAidStations,
  buildCheckpoints as buildUtmbCheckpoints,
} from "../utmb/index.mjs";

const BASE_URL = "https://alsace.utmb.world";

export const TRAIL_ALSACE_RACES = [
  {
    slug: "utdc",
    indexUrl: "https://utmb.world/utmb-index/races/35486.trailalsacebyutmbultra-traildeschevaliers.2026",
    name: "Ultra-Trail des Chevaliers",
    shortName: "UTDC",
    category: "100M",
    fallback: { date: "2026-05-15", distanceKm: 158, elevationGainM: 5100, city: "Station du Lac Blanc, massif des Vosges" },
  },
  {
    slug: "utdp",
    indexUrl: "https://utmb.world/utmb-index/races/35488.trailalsacebyutmbultra-traildespaiens.2026",
    name: "Ultra-Trail des Païens",
    shortName: "UTDP",
    category: "100K",
    fallback: { date: "2026-05-15", distanceKm: 108, elevationGainM: 3750, city: "Orschwiller" },
  },
  {
    slug: "tdc",
    indexUrl: "https://utmb.world/utmb-index/races/35482.trailalsacebyutmbtraildesceltes.2026",
    name: "Trail des Celtes",
    shortName: "TDC",
    category: "50K",
    fallback: { date: "2026-05-17", distanceKm: 47, elevationGainM: 1600, city: "Barr" },
  },
  {
    slug: "tdp",
    indexUrl: "https://utmb.world/utmb-index/races/35484.trailalsacebyutmbtraildespelerins.2026",
    name: "Trail des Pèlerins",
    shortName: "TDP",
    category: "20K",
    fallback: { date: "2026-05-16", distanceKm: 29, elevationGainM: 800, city: "Barr" },
  },
  {
    slug: "rdp",
    indexUrl: "https://utmb.world/utmb-index/races/50844.trailalsacebyutmbrondedespages.2026",
    name: "Ronde des Pages",
    shortName: "RDP",
    category: "20K",
    fallback: { date: "2026-05-16", distanceKm: 18, elevationGainM: 250, city: "Obernai" },
  },
];

export async function collect({ year }) {
  const event = createEvent({
    id: "trail-alsace",
    name: "Trail Alsace by UTMB",
    slug: "trail-alsace",
    country: "France",
    region: "Grand Est",
    city: "Obernai",
    officialWebsite: BASE_URL,
  });

  const sourceErrors = [];
  const races = [];

  for (const raceConfig of TRAIL_ALSACE_RACES) {
    let indexPage = null;
    let racePage = null;
    try {
      indexPage = await fetchText(raceConfig.indexUrl, { language: "en" });
    } catch (error) {
      sourceErrors.push({ url: raceConfig.indexUrl, message: error.message, status: error.status ?? null });
    }

    const raceUrl = `${BASE_URL}/races/${raceConfig.slug}`;
    try {
      racePage = await fetchText(raceUrl, { language: "en" });
    } catch (error) {
      sourceErrors.push({ url: raceUrl, message: error.message, status: error.status ?? null });
    }

    races.push(buildTrailAlsaceEntry({ event, raceConfig, indexPage, racePage, year }));
  }

  return { event, sourceErrors, races };
}

export function buildTrailAlsaceEntry({ event, raceConfig, indexPage, racePage, year }) {
  const indexStats = parseUtmbIndexRacePage(indexPage?.content ?? "", { year, fallback: raceConfig.fallback });
  const racePageStats = parseTrailAlsaceRacePage(racePage?.content ?? "", { year });
  const race = createRace(event, {
    id: `${event.id}-${raceConfig.slug}`,
    name: raceConfig.name,
    shortName: raceConfig.shortName,
  });
  const sources = [];
  if (indexPage) {
    sources.push(sourceFromFetch(indexPage, { type: "official-results", event: event.name, race: race.shortName }));
  }
  if (racePageStats.targetYear && racePage) {
    sources.push(sourceFromFetch(racePage, { type: "official-race-page", event: event.name, race: race.shortName }));
  }
  if (racePageStats.gpxUrl) {
    sources.push(sourceFromUrl(racePageStats.gpxUrl, {
      type: "official-gpx",
      retrievedAt: racePage?.retrievedAt ?? indexPage?.retrievedAt ?? new Date().toISOString(),
      event: event.name,
      race: race.shortName,
    }));
  }

  const edition = createEdition(year, {
    date: indexStats.date,
    startTime: racePageStats.startTime,
    distanceKm: indexStats.distanceKm,
    elevationGainM: indexStats.elevationGainM,
    elevationLossM: racePageStats.elevationLossM,
    startLocation: racePageStats.startLocation ?? indexStats.city,
    finishLocation: racePageStats.finishLocation,
    maxDurationMinutes: racePageStats.maxDurationMinutes,
    raceType: "solo",
    terrainType: "trail",
    terrainDescription: racePageStats.description,
    nightStart: racePageStats.startTime ? racePageStats.startTime < "06:00" || racePageStats.startTime >= "20:00" : null,
    gpxUrl: racePageStats.gpxUrl,
    checkpoints: racePageStats.checkpoints,
    aidStations: racePageStats.aidStations,
    rawOfficial: {
      utmbCategory: raceConfig.category,
      resultCount: indexStats.resultCount,
    },
    sources,
  });

  const entry = createRaceEntry({ event, race, edition });
  entry.quality.warnings = [
    ...indexStats.warnings,
    ...racePageStats.warnings,
  ];
  return entry;
}

export function parseUtmbIndexRacePage(html, { year = 2026, fallback = {} } = {}) {
  const text = stripHtml(html);
  const oneLine = text.replace(/\s+/g, " ");
  const dateText = valueAfterLabel(oneLine, /Date/i, [/Race Category/i, /Distance/i]);
  const distanceText = valueAfterLabel(oneLine, /Distance/i, [/Elevation Gain/i, /race ranking/i]);
  const gainText = valueAfterLabel(oneLine, /Elevation Gain/i, [/race ranking/i, /Results/i]);
  const city = valueAfterLabel(oneLine, /City \/ Country/i, [/Date/i]);
  const warnings = [];

  if (html && !new RegExp(`\\b${year}\\b`).test(text)) {
    warnings.push(`UTMB Index source does not contain target year ${year}.`);
  }

  return {
    date: parseDate(dateText, year) ?? fallback.date ?? null,
    distanceKm: numberFromText(distanceText) ?? fallback.distanceKm ?? null,
    elevationGainM: numberFromText(gainText) ?? fallback.elevationGainM ?? null,
    city: city ?? fallback.city ?? null,
    resultCount: numberFromText(oneLine.match(/\b([0-9]+)\s+Results\b/i)?.[1]),
    warnings,
  };
}

export function parseTrailAlsaceRacePage(html, { year = 2026 } = {}) {
  if (!html) {
    return emptyRacePageStats(["Official Trail Alsace race page was not fetched."]);
  }

  const text = stripHtml(html);
  const data = extractNextDataSafe(html);
  const pageProps = data?.props?.pageProps ?? {};
  const pageHeader = pageProps.pageHeader ?? {};
  const startDateIso = pageHeader.startDateIso ?? null;
  const textYear = text.match(/\b(20\d{2})\b/)?.[1] ?? null;
  const targetYear =
    startDateIso?.startsWith(String(year)) ||
    (!startDateIso && textYear === String(year) && !new RegExp(`\\b${year + 1}\\b`).test(text.slice(0, 1200)));

  if (!targetYear) {
    const currentPageGpxUrl = extractYearSpecificGpxUrl(pageProps.gpxUrl, year);
    return {
      ...emptyRacePageStats([
        `Official Trail Alsace race page is not a confirmed ${year} page; non-GPX values ignored.`,
        ...(currentPageGpxUrl ? [`Official race page exposes a year-specific ${year} GPX asset; only that GPX URL is retained.`] : []),
      ]),
      gpxUrl: currentPageGpxUrl,
    };
  }

  const stats = statsMap(pageProps.bannerStats ?? []);
  const startPlaceAndTime = parseStartPlaceAndTime(stats.startPlaceAndTime ?? text.match(/Race Start\s+([^\n]+)/i)?.[1]);
  const startDateTime = startDateIso ??
    (startPlaceAndTime.startTime && pageHeader.startDate
      ? `${parseDate(pageHeader.startDate, year)}T${startPlaceAndTime.startTime}:00`
      : null);
  const points = Array.isArray(pageProps.track?.points) ? pageProps.track.points : [];
  const checkpoints = points.length ? buildUtmbCheckpoints(points, startDateTime) : [];
  const aidStations = points.length ? buildUtmbAidStations(points, startDateTime) : [];

  return {
    targetYear: true,
    startTime: startDateIso?.slice(11, 16) ?? startPlaceAndTime.startTime,
    startLocation: startPlaceAndTime.startLocation,
    finishLocation: points.at(-1)?.name ?? null,
    maxDurationMinutes: parseDurationToMinutes(stats.maxTime ?? text.match(/Max Allowed Race Time\s+([0-9]{1,2}\s*Hours?)/i)?.[1]),
    elevationLossM: numberOrNull(pageProps.track?.lossElevation),
    gpxUrl: extractYearSpecificGpxUrl(pageProps.gpxUrl, year),
    checkpoints,
    aidStations,
    description: stripHtml(pageHeader.summary ?? ""),
    warnings: [],
  };
}

function emptyRacePageStats(warnings) {
  return {
    targetYear: false,
    startTime: null,
    startLocation: null,
    finishLocation: null,
    maxDurationMinutes: null,
    elevationLossM: null,
    gpxUrl: null,
    checkpoints: [],
    aidStations: [],
    description: null,
    warnings,
  };
}

function extractYearSpecificGpxUrl(value, year) {
  const url = String(value ?? "");
  if (!/^https?:\/\//i.test(url)) return null;
  return url.includes(`GPX%20${year}`) || url.includes(`GPX ${year}`) || url.includes(`${year}_`)
    ? url
    : null;
}

function extractNextDataSafe(html) {
  try {
    return extractNextData(html);
  } catch {
    return null;
  }
}

function statsMap(stats) {
  return Object.fromEntries((stats ?? []).map((stat) => [stat.name, stat.value]));
}

function valueAfterLabel(text, labelPattern, stopPatterns) {
  const stop = stopPatterns.map((pattern) => pattern.source).join("|");
  const match = text.match(new RegExp(`${labelPattern.source}\\s+([\\s\\S]{0,160}?)(?=\\s+(?:${stop})|$)`, "i"));
  return cleanValue(match?.[1]);
}

function sourceFromUrl(url, { type, retrievedAt, event, race }) {
  return createSource({ url, type, retrievedAt, event, race });
}

function numberOrNull(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
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
