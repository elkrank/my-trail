export const SOURCE_TYPES = new Set([
  "official-race-page",
  "official-rules",
  "official-roadbook",
  "official-gpx",
  "official-map-platform",
  "official-registration",
  "official-results",
]);

export function slugify(value) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function createEvent(input) {
  return {
    id: input.id,
    name: input.name,
    slug: input.slug ?? slugify(input.name),
    country: input.country ?? null,
    region: input.region ?? null,
    city: input.city ?? null,
    officialWebsite: input.officialWebsite ?? null,
  };
}

export function createRace(event, input) {
  const shortName = input.shortName ?? input.name;
  return {
    id: input.id ?? `${event.id}-${slugify(shortName)}`,
    eventId: event.id,
    name: input.name,
    shortName,
  };
}

export function createEdition(year, overrides = {}) {
  return {
    year,
    date: null,
    startTime: null,
    distanceKm: null,
    elevationGainM: null,
    elevationLossM: null,
    startLocation: null,
    finishLocation: null,
    maxDurationMinutes: null,
    raceType: null,
    terrainType: null,
    nightStart: null,
    polesAllowed: null,
    gpxUrl: null,
    gpx: null,
    illustration: null,
    terrainDescription: null,
    technicalScore: null,
    technicalScoreSource: null,
    registration: {
      priceEur: null,
      registrationOpenDate: null,
      registrationCloseDate: null,
      status: null,
      lottery: null,
      maxParticipants: null,
      qualificationRequired: null,
    },
    checkpoints: [],
    aidStations: [],
    mandatoryEquipment: [],
    rules: {
      personalAssistanceAllowed: null,
      pacersAllowed: null,
      dropBagAllowed: null,
      minimumWaterLiters: null,
    },
    sources: [],
    ...overrides,
    registration: {
      priceEur: null,
      registrationOpenDate: null,
      registrationCloseDate: null,
      status: null,
      lottery: null,
      maxParticipants: null,
      qualificationRequired: null,
      ...(overrides.registration ?? {}),
    },
    rules: {
      personalAssistanceAllowed: null,
      pacersAllowed: null,
      dropBagAllowed: null,
      minimumWaterLiters: null,
      ...(overrides.rules ?? {}),
    },
  };
}

export function createIllustration({ url, sourceUrl, event, race, alt }) {
  const normalizedUrl = normalizeHttpUrl(url);
  if (!normalizedUrl) return null;

  return {
    url: normalizedUrl,
    alt: alt ?? ([event, race].filter(Boolean).join(" - ") || "Illustration course trail"),
    sourceUrl: normalizeHttpUrl(sourceUrl),
  };
}

export function createSource({ url, type, retrievedAt, event, race }) {
  if (!SOURCE_TYPES.has(type)) {
    throw new Error(`Unsupported source type: ${type}`);
  }

  return {
    url,
    type,
    retrievedAt,
    event,
    race: race ?? null,
  };
}

export function sourceFromFetch(fetchResult, { type, event, race }) {
  return createSource({
    url: fetchResult.finalUrl ?? fetchResult.url,
    type,
    retrievedAt: fetchResult.retrievedAt,
    event,
    race,
  });
}

export function createRaceEntry({ event, race, edition }) {
  return {
    event,
    race,
    edition,
    computed: computeMetrics(edition),
    quality: {
      status: "invalid",
      warnings: [],
      missingFields: [],
    },
  };
}

export function computeMetrics(edition) {
  const hasDistance = Number.isFinite(edition.distanceKm) && edition.distanceKm > 0;
  const hasGain = Number.isFinite(edition.elevationGainM);

  return {
    source: "computed",
    elevationDensityMPerKm: hasDistance && hasGain
      ? round(edition.elevationGainM / edition.distanceKm, 2)
      : null,
    kmEffort: hasDistance && hasGain
      ? round(edition.distanceKm + edition.elevationGainM / 100, 2)
      : null,
  };
}

export function refreshComputed(entry) {
  entry.computed = computeMetrics(entry.edition);
  return entry;
}

function round(value, decimals) {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

function normalizeHttpUrl(value) {
  if (!value) return null;

  try {
    const url = new URL(String(value));
    return ["http:", "https:"].includes(url.protocol) ? url.href : null;
  } catch {
    return null;
  }
}
