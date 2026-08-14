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
  extractNextData,
  minutesBetween,
  parseCutoffDisplayToIso,
  parseDate,
  parseDurationToMinutes,
  parseStartPlaceAndTime,
  parseTime,
  stripHtml,
} from "../../common/parse.mjs";

const BASE_URL = "https://montblanc.utmb.world";
const REGISTRATION_URL = `${BASE_URL}/en/races-runners/registrationconditions`;
const REGULATION_URL = `${BASE_URL}/en/races-runners/other-information/regulation`;

const RACES = [
  { slug: "utmb", name: "UTMB", shortName: "UTMB" },
  { slug: "ccc", name: "CCC", shortName: "CCC" },
  { slug: "occ", name: "OCC", shortName: "OCC" },
  { slug: "tds", name: "TDS", shortName: "TDS" },
  { slug: "mcc", name: "MCC", shortName: "MCC" },
  { slug: "etc", name: "ETC", shortName: "ETC" },
  { slug: "ptl", name: "PTL", shortName: "PTL" },
];

export async function collect({ year }) {
  const event = createEvent({
    id: "utmb",
    name: "UTMB Mont-Blanc",
    slug: "utmb",
    country: "France",
    region: "Auvergne-Rhone-Alpes",
    city: "Chamonix",
    officialWebsite: BASE_URL,
  });

  const sourceErrors = [];
  let registration = null;
  let regulation = null;

  try {
    registration = await fetchText(REGISTRATION_URL, { language: "en" });
  } catch (error) {
    sourceErrors.push({ url: REGISTRATION_URL, message: error.message, status: error.status ?? null });
  }

  try {
    regulation = await fetchText(REGULATION_URL, { language: "en" });
  } catch (error) {
    sourceErrors.push({ url: REGULATION_URL, message: error.message, status: error.status ?? null });
  }

  const priceByRace = parsePrices(registration?.content ?? "");
  const qualificationByRace = parseQualifications(registration?.content ?? "");
  const races = [];

  for (const raceConfig of RACES) {
    const url = `${BASE_URL}/races/${raceConfig.slug}`;
    try {
      const page = await fetchText(url, { language: "en" });
      races.push(buildRaceEntry({ event, raceConfig, page, registration, regulation, priceByRace, qualificationByRace, year }));
    } catch (error) {
      sourceErrors.push({ url, message: error.message, status: error.status ?? null });
    }
  }

  return {
    event,
    sourceErrors,
    races,
  };
}

function buildRaceEntry({
  event,
  raceConfig,
  page,
  registration,
  regulation,
  priceByRace,
  qualificationByRace,
  year,
}) {
  const data = extractNextData(page.content);
  if (!data?.props?.pageProps) {
    throw new Error(`Missing __NEXT_DATA__ payload for UTMB race ${raceConfig.slug}`);
  }

  const pageProps = data.props.pageProps;
  const stats = statsMap(pageProps.bannerStats ?? []);
  const pageHeader = pageProps.pageHeader ?? {};
  const track = pageProps.track ?? {};
  const points = Array.isArray(track.points) ? track.points : [];
  const startPlaceAndTime = parseStartPlaceAndTime(stats.startPlaceAndTime);
  const startDate = pageHeader.startDateIso?.slice(0, 10) ?? parseDate(stats.startDate, year);
  const startTime = pageHeader.startDateIso?.slice(11, 16) ?? startPlaceAndTime.startTime;
  const startDateTime = startDate && startTime ? `${startDate}T${startTime}:00` : null;
  const race = createRace(event, {
    id: `${event.id}-${raceConfig.slug}`,
    name: pageHeader.title ?? raceConfig.name,
    shortName: raceConfig.shortName,
  });
  const illustration = createIllustration({
    url: extractIllustration(page.content, page.finalUrl ?? page.url),
    sourceUrl: page.finalUrl ?? page.url,
    event: event.name,
    race: race.shortName,
  });

  const officialRaceSource = sourceFromFetch(page, {
    type: "official-race-page",
    event: event.name,
    race: race.shortName,
  });

  const sources = [officialRaceSource];
  if (registration) {
    sources.push(sourceFromFetch(registration, {
      type: "official-registration",
      event: event.name,
      race: race.shortName,
    }));
  }
  if (regulation) {
    sources.push(sourceFromFetch(regulation, {
      type: "official-rules",
      event: event.name,
      race: race.shortName,
    }));
  }
  if (pageProps.gpxUrl) {
    sources.push({
      url: pageProps.gpxUrl,
      type: "official-gpx",
      retrievedAt: page.retrievedAt,
      event: event.name,
      race: race.shortName,
    });
  }

  const checkpoints = buildCheckpoints(points, startDateTime);
  const aidStations = buildAidStations(points, startDateTime);
  const warnings = [];
  if (points.some((point) => point.cutoff && !parseCutoffDisplayToIso(point.cutoff, startDateTime))) {
    warnings.push("Some UTMB cutoffs could not be converted to elapsed minutes.");
  }

  const edition = createEdition(year, {
    date: startDate,
    startTime,
    distanceKm: valueFromStats(stats.distance) ?? metersToKm(track.distance),
    elevationGainM: valueFromStats(stats.elevationGain) ?? numberOrNull(track.gainElevation),
    elevationLossM: numberOrNull(track.lossElevation),
    startLocation: startPlaceAndTime.startLocation,
    finishLocation: finishLocation(points),
    maxDurationMinutes: parseDurationToMinutes(stats.maxTime),
    raceType: valueFromStats(stats.categoryWorldSeries) ?? null,
    terrainType: "trail",
    nightStart: startTime ? parseTime(startTime) < "06:00" || parseTime(startTime) >= "20:00" : null,
    polesAllowed: null,
    gpxUrl: pageProps.gpxUrl ?? null,
    illustration,
    terrainDescription: stripHtml(pageHeader.summary ?? ""),
    registration: {
      priceEur: priceByRace.get(race.shortName) ?? null,
      status: null,
      lottery: race.shortName === "ETC" ? true : null,
      url: registration ? normalizeHttpUrl(registration.finalUrl ?? registration.url ?? REGISTRATION_URL) : null,
      qualificationRequired: qualificationByRace.get(race.shortName) ?? null,
    },
    checkpoints,
    aidStations,
    rules: {
      personalAssistanceAllowed: null,
      pacersAllowed: null,
      dropBagAllowed: aidStations.some((station) => station.dropBag === true) ? true : null,
      minimumWaterLiters: null,
    },
    sources,
  });

  const entry = createRaceEntry({ event, race, edition });
  entry.quality.warnings = warnings;
  return entry;
}

export function buildCheckpoints(points, startDateTime) {
  return points
    .filter((point) => point.cutoff)
    .map((point) => {
      const cutoffDateTime = parseCutoffDisplayToIso(point.cutoff, startDateTime);
      return {
        name: point.name ?? point.shortName ?? "",
        distanceKm: metersToKm(point.distance),
        elevationGainFromStartM: numberOrNull(point.gainElevation),
        cutoffDateTime,
        cutoffElapsedMinutes: cutoffDateTime ? minutesBetween(startDateTime, cutoffDateTime) : null,
        aidStation: hasAid(point),
        personalAssistanceAllowed: booleanOrNull(point.isAssistance),
      };
    });
}

export function buildAidStations(points, startDateTime) {
  return points
    .filter(hasAid)
    .map((point) => {
      const cutoffDateTime = parseCutoffDisplayToIso(point.cutoff, startDateTime);
      const supplies = point.supplies ?? "none";
      return {
        name: point.name ?? point.shortName ?? "",
        distanceKm: metersToKm(point.distance),
        elevationM: numberOrNull(point.elevation),
        water: supplies !== "none" ? true : null,
        sportsDrink: booleanOrNull(point.hasNaak),
        solidFood: supplies === "food" || supplies === "hotFood" ? true : supplies === "drink" ? false : null,
        hotFood: supplies === "hotFood" ? true : supplies === "food" || supplies === "drink" ? false : null,
        dropBag: booleanOrNull(point.hasBag),
        crewAccess: booleanOrNull(point.isAssistance),
        medical: booleanOrNull(point.hasMedical),
        cutoffDateTime,
      };
    });
}

function hasAid(point) {
  return (
    point.supplies && point.supplies !== "none" ||
    point.hasBag === true ||
    point.hasMedical === true ||
    point.hasRest === true ||
    point.hasBus === true
  );
}

export function parsePrices(html) {
  const text = stripHtml(html);
  const prices = new Map();
  for (const match of text.matchAll(/\b(UTMB|CCC|OCC|ETC|PTL|TDS)\s*:\s*(\d+)\s*€/g)) {
    prices.set(match[1], Number(match[2]));
  }
  const mcc = text.match(/\bMCC\b[^:]*:\s*(\d+)\s*€/);
  if (mcc) prices.set("MCC", Number(mcc[1]));
  return prices;
}

export function parseQualifications(html) {
  const text = stripHtml(html);
  const output = new Map();
  for (const race of ["UTMB", "CCC", "OCC", "TDS"]) {
    const match = text.match(new RegExp(`${race}:\\s*(UTMB index[^\\n]+)`, "i"));
    if (match) output.set(race, match[1].trim());
  }
  return output;
}

function statsMap(stats) {
  return Object.fromEntries(stats.map((stat) => [stat.name, stat.value]));
}

function valueFromStats(value) {
  if (value === undefined || value === null || value === "") return null;
  return typeof value === "number" ? value : String(value);
}

function metersToKm(value) {
  if (!Number.isFinite(value)) return null;
  return Math.round((value / 1000) * 10) / 10;
}

function numberOrNull(value) {
  return Number.isFinite(value) ? value : null;
}

function booleanOrNull(value) {
  return typeof value === "boolean" ? value : null;
}

function finishLocation(points) {
  const finalPoint = points.at(-1);
  return finalPoint?.name ?? null;
}
