export const SOURCE_TYPES = new Set([
  "official-race-page",
  "official-rules",
  "official-roadbook",
  "official-gpx",
  "official-map-platform",
  "official-registration",
  "official-program",
  "official-logistics",
  "official-transport",
  "official-results",
]);

export const DATA_AVAILABILITY_STATUSES = Object.freeze({
  KNOWN: "known",
  KNOWN_NONE: "known_none",
  NOT_APPLICABLE: "not_applicable",
  NOT_PUBLISHED: "not_published",
  EXTRACTION_ERROR: "extraction_error",
  UNKNOWN: "unknown",
});

export const DATA_AVAILABILITY_STATUS_VALUES = new Set(
  Object.values(DATA_AVAILABILITY_STATUSES),
);

export const COMPLETE_AVAILABILITY_STATUSES = new Set([
  DATA_AVAILABILITY_STATUSES.KNOWN,
  DATA_AVAILABILITY_STATUSES.KNOWN_NONE,
  DATA_AVAILABILITY_STATUSES.NOT_APPLICABLE,
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
    finishCutoffTime: null,
    raceType: null,
    terrainType: null,
    nightStart: null,
    polesAllowed: null,
    gpxUrl: null,
    gpx: null,
    illustration: null,
    terrainDescription: null,
    description: {
      original: overrides.description?.original ?? overrides.terrainDescription ?? null,
      originalLanguage: overrides.description?.originalLanguage ?? null,
      french: null,
      frenchValidated: false,
    },
    program: [],
    logistics: null,
    technicalScore: null,
    technicalScoreSource: null,
    registration: {
      priceEur: null,
      registrationOpenDate: null,
      registrationCloseDate: null,
      status: null,
      lottery: null,
      url: null,
      maxParticipants: null,
      qualificationRequired: null,
    },
    checkpoints: [],
    aidStations: [],
    dataAvailability: {},
    mandatoryEquipment: [],
    rules: {
      personalAssistanceAllowed: null,
      pacersAllowed: null,
      companionsAllowed: null,
      dropBagAllowed: null,
      minimumWaterLiters: null,
      details: null,
    },
    sources: [],
    ...overrides,
    registration: {
      priceEur: null,
      registrationOpenDate: null,
      registrationCloseDate: null,
      status: null,
      lottery: null,
      url: null,
      maxParticipants: null,
      qualificationRequired: null,
      ...(overrides.registration ?? {}),
    },
    description: {
      original: overrides.description?.original ?? overrides.terrainDescription ?? null,
      originalLanguage: overrides.description?.originalLanguage ?? null,
      french: null,
      frenchValidated: false,
      ...(overrides.description ?? {}),
    },
    program: Array.isArray(overrides.program) ? overrides.program : [],
    logistics: overrides.logistics ?? null,
    rules: {
      personalAssistanceAllowed: null,
      pacersAllowed: null,
      companionsAllowed: null,
      dropBagAllowed: null,
      minimumWaterLiters: null,
      details: null,
      ...(overrides.rules ?? {}),
    },
    dataAvailability: {
      ...(overrides.dataAvailability ?? {}),
      ...(overrides.dataAvailability?.registration
        ? { registration: { ...overrides.dataAvailability.registration } }
        : {}),
    },
  };
}

export function createDataAvailability(status, { sourceUrl = null, checkedAt = null, reason = null } = {}) {
  if (!DATA_AVAILABILITY_STATUS_VALUES.has(status)) {
    throw new Error(`Unsupported data availability status: ${status}`);
  }

  return {
    status,
    ...(sourceUrl ? { sourceUrl: normalizeHttpUrl(sourceUrl) ?? sourceUrl } : {}),
    ...(checkedAt ? { checkedAt } : {}),
    ...(reason ? { reason } : {}),
  };
}

export function getDataAvailability(edition, path) {
  const explicit = getPath(edition?.dataAvailability, path);
  if (explicit?.status) return explicit;

  const value = getPath(edition, path);
  if (path === "gpx") {
    if (value?.status === "available") return { status: DATA_AVAILABILITY_STATUSES.KNOWN };
    if (["invalid", "unavailable"].includes(value?.status)) {
      return {
        status: DATA_AVAILABILITY_STATUSES.EXTRACTION_ERROR,
        ...(value.sourceUrl ? { sourceUrl: value.sourceUrl } : {}),
        ...(value.retrievedAt ? { checkedAt: value.retrievedAt } : {}),
      };
    }
  }
  if (Array.isArray(value)) {
    return { status: value.length ? DATA_AVAILABILITY_STATUSES.KNOWN : DATA_AVAILABILITY_STATUSES.UNKNOWN };
  }
  return {
    status: value !== null && value !== undefined && value !== ""
      ? DATA_AVAILABILITY_STATUSES.KNOWN
      : DATA_AVAILABILITY_STATUSES.UNKNOWN,
  };
}

export function isAvailabilityComplete(availability) {
  return COMPLETE_AVAILABILITY_STATUSES.has(availability?.status);
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

function getPath(object, path) {
  return String(path).split(".").reduce((current, key) => current?.[key], object);
}

export function normalizeHttpUrl(value) {
  if (!value) return null;

  try {
    const url = new URL(String(value));
    return ["http:", "https:"].includes(url.protocol) ? url.href : null;
  } catch {
    return null;
  }
}
