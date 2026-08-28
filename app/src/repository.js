import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  addCumulativeElevationGains,
  assessGpxElevationQuality,
  resolveDataAssetPath,
} from '../scrapers/common/gpx.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const dataRoot = process.env.TRAILCOMPARE_DATA_ROOT ?? path.join(__dirname, '..', 'data');
const racesPath = process.env.TRAILCOMPARE_DATASET_PATH ?? path.join(dataRoot, '2026', 'races.json');

let cache = null;
const routeAssetCache = new Map();

async function loadDataset() {
  if (cache) return cache;
  const payload = JSON.parse(await readFile(racesPath, 'utf8'));
  cache = normalizeDataset(payload);
  return cache;
}

function normalizeDataset(payload) {
  const races = payload.races.map((entry, index) => {
    const edition = entry.edition;
    const officialRaceSource =
      edition.sources.find((source) => source.type === 'official-race-page') ??
      edition.sources[0] ??
      null;

    return {
      id: index + 1,
      sourceId: `${entry.event.slug}:${entry.race.id}:${edition.year}`,
      slug: createRaceSlug(entry.race.id, edition.year),
      event: entry.event,
      race: entry.race,
      name: `${entry.event.name} - ${entry.race.shortName}`,
      edition: String(edition.year),
      date: edition.date,
      startTime: edition.startTime,
      distanceKm: numberOrNull(edition.effectiveDistanceKm ?? edition.distanceKm),
      nominalDistanceKm: numberOrNull(edition.nominalDistanceKm),
      effectiveDistanceKm: numberOrNull(edition.effectiveDistanceKm ?? edition.distanceKm),
      elevationGainM: numberOrNull(edition.elevationGainM),
      elevationLossM: numberOrNull(edition.elevationLossM),
      startLocation: edition.startLocation ?? null,
      finishLocation: edition.finishLocation ?? null,
      timeLimitMinutes: numberOrNull(edition.maxDurationMinutes),
      finishCutoffTime: textOrNull(edition.finishCutoffTime),
      sourceUrl: officialRaceSource?.url ?? null,
      confidence: edition.sources.length ? 'official' : 'unverified',
      quality: entry.quality,
      dataAvailability: normalizeDataAvailability(edition.dataAvailability),
      computed: entry.computed,
      registration: normalizeRegistration(edition.registration),
      raceType: textOrNull(edition.raceType),
      terrainType: textOrNull(edition.terrainType),
      technicalScore: numberOrNull(edition.technicalScore),
      technicalScoreSource: textOrNull(edition.technicalScoreSource),
      nightStart: booleanOrNull(edition.nightStart),
      polesAllowed: booleanOrNull(edition.polesAllowed),
      description: normalizeDescription(edition),
      program: normalizeProgram(edition.program ?? edition.schedule),
      logistics: normalizeLogistics(edition.logistics),
      rules: normalizeRules(edition.rules),
      aidStations: normalizeAidStations(edition.aidStations),
      mandatoryEquipment: normalizeEquipment(edition.mandatoryEquipment),
      sources: normalizeSources(edition.sources),
      sourceFamilies: groupSourcesByFamily(edition.sources),
      gpxUrl: edition.gpxUrl,
      gpx: normalizeGpx(edition.gpx, edition),
      illustration: normalizeIllustration(edition.illustration, entry.race.shortName),
      rawEdition: edition,
      checkpoints: normalizeCheckpoints(index + 1, edition.checkpoints),
      verifiedAt: latestRetrievedAt(edition.sources) ?? payload.generatedAt ?? null,
    };
  });

  return {
    generatedAt: payload.generatedAt,
    status: payload.status,
    events: payload.events,
    races,
  };
}

function normalizeCheckpoints(raceId, checkpoints) {
  return arrayOrEmpty(checkpoints)
    .filter((checkpoint) =>
      Number.isFinite(Number(checkpoint.distanceKm)) &&
      Number.isFinite(Number(checkpoint.cutoffElapsedMinutes)) &&
      Number(checkpoint.distanceKm) > 0 &&
      Number(checkpoint.cutoffElapsedMinutes) > 0,
    )
    .map((checkpoint, index) => ({
      id: index + 1,
      raceId,
      name: checkpoint.name,
      distanceKm: Number(checkpoint.distanceKm),
      elapsedLimitMinutes: Number(checkpoint.cutoffElapsedMinutes),
      cutoffDateTime: checkpoint.cutoffDateTime,
      aidStation: checkpoint.aidStation,
      personalAssistanceAllowed: checkpoint.personalAssistanceAllowed,
      elevationM: numberOrNull(checkpoint.elevationM),
      elevationGainFromStartM: numberOrNull(checkpoint.elevationGainFromStartM),
      elevationGainFromStartSource: numberOrNull(checkpoint.elevationGainFromStartM) === null
        ? null
        : textOrNull(checkpoint.elevationGainFromStartSource) ?? 'official_checkpoint',
      latitude: coordinateOrNull(checkpoint.latitude ?? checkpoint.lat, -90, 90),
      longitude: coordinateOrNull(checkpoint.longitude ?? checkpoint.lon ?? checkpoint.lng, -180, 180),
    }));
}

function publicRace(race, { includeDetails = false } = {}) {
  const output = {
    id: race.id,
    sourceId: race.sourceId,
    slug: race.slug,
    event: {
      id: race.event.id,
      slug: race.event.slug,
      name: race.event.name,
      country: race.event.country ?? null,
      region: race.event.region ?? null,
      city: race.event.city ?? null,
    },
    name: race.name,
    eventName: race.event.name,
    raceName: race.race.name,
    shortName: race.race.shortName,
    edition: race.edition,
    date: race.date,
    startTime: race.startTime,
    distanceKm: race.distanceKm,
    nominalDistanceKm: race.nominalDistanceKm,
    effectiveDistanceKm: race.effectiveDistanceKm,
    elevationGainM: race.elevationGainM,
    elevationLossM: race.elevationLossM,
    startLocation: race.startLocation,
    finishLocation: race.finishLocation,
    timeLimitMinutes: race.timeLimitMinutes,
    finishCutoffTime: race.finishCutoffTime,
    sourceUrl: race.sourceUrl,
    confidence: race.confidence,
    quality: race.quality,
    dataAvailability: race.dataAvailability,
    computed: race.computed,
    gpxUrl: race.gpxUrl,
    gpx: race.gpx,
    illustration: race.illustration,
    registration: race.registration,
    raceType: race.raceType,
    terrainType: race.terrainType,
    technicalScore: race.technicalScore,
    technicalScoreSource: race.technicalScoreSource,
    nightStart: race.nightStart,
    polesAllowed: race.polesAllowed,
  };

  if (includeDetails) {
    output.description = race.description;
    output.program = race.program;
    output.logistics = race.logistics;
    output.rules = race.rules;
    output.aidStations = race.aidStations;
    output.mandatoryEquipment = race.mandatoryEquipment;
    output.checkpoints = race.checkpoints;
    output.sources = race.sources;
    output.sourceFamilies = race.sourceFamilies;
    output.verifiedAt = race.verifiedAt;
    output.missingOfficialInformation = arrayOrEmpty(race.quality?.missingFields).map(String);
  }

  return output;
}

export async function listRaces() {
  const dataset = await loadDataset();
  return dataset.races.map((race) => publicRace(race));
}

export async function getRaceById(id) {
  const dataset = await loadDataset();
  const race = dataset.races.find((candidate) => candidate.id === Number(id));
  return race ? publicDetailedRace(race) : null;
}

export async function getRaceBySlug(slug) {
  if (typeof slug !== 'string' || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) return null;
  const dataset = await loadDataset();
  const race = dataset.races.find((candidate) => candidate.slug === slug);
  return race ? publicDetailedRace(race) : null;
}

export async function listRaceSlugs() {
  const dataset = await loadDataset();
  return dataset.races.map((race) => race.slug);
}

export async function listCheckpointsForRace(raceId) {
  const dataset = await loadDataset();
  const race = dataset.races.find((candidate) => candidate.id === Number(raceId));
  return race ? enrichCheckpointsWithGpx(race) : [];
}

export async function getRaceWithCheckpoints(id) {
  const race = await getRaceById(id);
  return race ?? null;
}

export async function getDatasetInfo() {
  const dataset = await loadDataset();
  return {
    status: dataset.status,
    generatedAt: dataset.generatedAt,
    eventCount: dataset.events.length,
    raceCount: dataset.races.length,
  };
}

export function getDataRoot() {
  return dataRoot;
}

async function publicDetailedRace(race) {
  const output = publicRace(race, { includeDetails: true });
  output.checkpoints = await enrichCheckpointsWithGpx(race);
  return output;
}

async function enrichCheckpointsWithGpx(race) {
  const officialGain = numberOrNull(race.elevationGainM);
  const raceDistance = numberOrNull(race.distanceKm);
  const checkpoints = race.checkpoints.map((checkpoint) => {
    if (checkpoint.elevationGainFromStartM !== null) return { ...checkpoint };
    if (officialGain !== null && isFinishCheckpoint(checkpoint.distanceKm, raceDistance)) {
      return {
        ...checkpoint,
        elevationGainFromStartM: officialGain,
        elevationGainFromStartSource: 'official_race_total',
      };
    }
    return { ...checkpoint };
  });
  if (race.gpx?.status !== 'available' || !race.gpx.routeAsset || race.gpx.hasElevation === false) return checkpoints;

  let asset;
  try {
    asset = await loadRouteAsset(race.gpx.routeAsset);
  } catch {
    return checkpoints;
  }
  const rawSegments = Array.isArray(asset?.segments) ? asset.segments : [];
  const elevationCount = rawSegments.flat().filter((point) => Number.isFinite(point?.ele)).length;
  if (elevationCount < 2) return checkpoints;
  const hasCumulativeGain = rawSegments.some((segment) => segment.some((point) => numberOrNull(point?.elevationGainFromStartM) !== null));
  const segments = hasCumulativeGain ? rawSegments : addCumulativeElevationGains(rawSegments);
  const points = segments.flat().filter((point) =>
    numberOrNull(point?.distanceKm) !== null && numberOrNull(point?.elevationGainFromStartM) !== null,
  );
  if (!points.length) return checkpoints;

  return checkpoints.map((checkpoint) => {
    if (checkpoint.elevationGainFromStartM !== null) return checkpoint;
    const nearest = points.reduce((best, point) => (
      Math.abs(Number(point.distanceKm) - checkpoint.distanceKm) < Math.abs(Number(best.distanceKm) - checkpoint.distanceKm)
        ? point
        : best
    ), points[0]);
    return {
      ...checkpoint,
      elevationGainFromStartM: Math.round(Number(nearest.elevationGainFromStartM)),
      elevationGainFromStartSource: 'gpx_estimate',
    };
  });
}

async function loadRouteAsset(relativePath) {
  if (!routeAssetCache.has(relativePath)) {
    const assetPath = resolveDataAssetPath(dataRoot, relativePath);
    routeAssetCache.set(relativePath, readFile(assetPath, 'utf8').then(JSON.parse));
  }
  return routeAssetCache.get(relativePath);
}

function isFinishCheckpoint(checkpointDistance, raceDistance) {
  if (checkpointDistance === null || raceDistance === null || raceDistance <= 0) return false;
  return Math.abs(checkpointDistance - raceDistance) <= Math.max(0.5, raceDistance * 0.01);
}

function numberOrNull(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string' && value.trim() === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function normalizeGpx(value, edition) {
  if (!value) return value ?? null;
  const elevationQuality = value.elevationQuality ?? assessGpxElevationQuality({
    gpxStatus: value.status,
    officialGainM: edition?.elevationGainM,
    computedGainM: value.computed?.elevationGainM,
    hasElevation: value.hasElevation,
  });
  return {
    ...value,
    elevationQuality,
  };
}
function normalizeIllustration(value, raceName = '') {
  const url = normalizeHttpUrl(value?.url);
  if (!url) return null;
  const dimensions = imageDimensionsFromUrl(url);
  if (/rond13\.png/i.test(url) && !/^13\s*km$/i.test(String(raceName).trim())) return null;

  return {
    url,
    alt: value.alt ? String(value.alt) : null,
    sourceUrl: normalizeHttpUrl(value.sourceUrl),
    width: dimensions?.width ?? numberOrNull(value.width),
    height: dimensions?.height ?? numberOrNull(value.height),
    presentation: dimensions && Math.max(dimensions.width, dimensions.height) < 600 ? 'logo' : 'hero',
  };
}

function imageDimensionsFromUrl(url) {
  const match = String(url).match(/\/w_(\d+),h_(\d+)[,/]/i);
  return match ? { width: Number(match[1]), height: Number(match[2]) } : null;
}

function normalizeRegistration(value) {
  const registration = value ?? {};
  const lottery = booleanOrNull(registration.lottery);
  const status = normalizeRegistrationStatus(registration.status, lottery);

  return {
    priceEur: numberOrNull(registration.priceEur),
    registrationOpenDate: registration.registrationOpenDate ?? null,
    registrationCloseDate: registration.registrationCloseDate ?? null,
    status,
    lottery,
    maxParticipants: numberOrNull(registration.maxParticipants),
    qualificationRequired: registration.qualificationRequired ?? null,
    url: normalizeHttpUrl(registration.url),
  };
}

function normalizeDescription(edition) {
  const description = edition.description ?? {};
  const original = textOrNull(description.original ?? edition.descriptionOriginal ?? edition.terrainDescription);
  const french = textOrNull(description.french ?? edition.descriptionFrench);
  return {
    original,
    originalLanguage: textOrNull(description.originalLanguage ?? edition.descriptionOriginalLanguage),
    french,
    frenchValidated: french ? description.frenchValidated === true || edition.descriptionFrenchValidated === true : false,
  };
}

function normalizeProgram(value) {
  if (!value) return [];
  const items = Array.isArray(value)
    ? value
    : Object.entries(value).map(([type, item]) => typeof item === 'object' && item !== null ? { type, ...item } : { type, label: item });
  return items.map((item) => ({
    type: textOrNull(item?.type),
    label: textOrNull(item?.label ?? item?.name),
    date: textOrNull(item?.date),
    time: textOrNull(item?.time),
    location: textOrNull(item?.location),
    details: textOrNull(item?.details),
  })).filter((item) => Object.values(item).some((value) => value !== null));
}

function normalizeLogistics(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const logistics = {
    access: textOrNull(value.access),
    shuttles: textOrNull(value.shuttles),
    transport: textOrNull(value.transport ?? value.publicTransport),
    parking: textOrNull(value.parking),
    bagDrop: textOrNull(value.bagDrop ?? value.bagStorage),
    contacts: arrayOrEmpty(value.contacts).map((contact) => typeof contact === 'string'
      ? { label: contact, value: null, url: null }
      : {
          label: textOrNull(contact?.label ?? contact?.name),
          value: textOrNull(contact?.value ?? contact?.email ?? contact?.phone),
          url: normalizeHttpUrl(contact?.url),
        }).filter((contact) => contact.label || contact.value || contact.url),
  };
  return Object.entries(logistics).some(([key, item]) => key === 'contacts' ? item.length : item !== null) ? logistics : null;
}

function normalizeRules(value) {
  const rules = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  return {
    personalAssistanceAllowed: booleanOrNull(rules.personalAssistanceAllowed),
    pacersAllowed: booleanOrNull(rules.pacersAllowed),
    companionsAllowed: booleanOrNull(rules.companionsAllowed),
    dropBagAllowed: booleanOrNull(rules.dropBagAllowed),
    minimumWaterLiters: numberOrNull(rules.minimumWaterLiters),
    details: textOrNull(rules.details),
  };
}

function normalizeEquipment(value) {
  return arrayOrEmpty(value).map((item) => typeof item === 'string'
    ? { name: textOrNull(item), details: null, category: null }
    : {
        name: textOrNull(item?.name ?? item?.label),
        details: textOrNull(item?.details),
        category: textOrNull(item?.category),
      }).filter((item) => item.name || item.details);
}

function normalizeAidStations(value) {
  return arrayOrEmpty(value).map((station) => ({
    name: textOrNull(station?.name),
    distanceKm: numberOrNull(station?.distanceKm),
    elevationM: numberOrNull(station?.elevationM),
    water: booleanOrNull(station?.water),
    sportsDrink: booleanOrNull(station?.sportsDrink),
    solidFood: booleanOrNull(station?.solidFood),
    hotFood: booleanOrNull(station?.hotFood),
    dropBag: booleanOrNull(station?.dropBag),
    crewAccess: booleanOrNull(station?.crewAccess),
    medical: booleanOrNull(station?.medical),
    cutoffDateTime: textOrNull(station?.cutoffDateTime),
    latitude: coordinateOrNull(station?.latitude ?? station?.lat, -90, 90),
    longitude: coordinateOrNull(station?.longitude ?? station?.lon ?? station?.lng, -180, 180),
    services: arrayOrEmpty(station?.services).map(textOrNull).filter(Boolean),
  })).filter((station) => station.name || station.distanceKm !== null);
}

function normalizeSources(value) {
  return arrayOrEmpty(value).map((source) => ({
    url: normalizeHttpUrl(source?.url),
    type: textOrNull(source?.type),
    retrievedAt: textOrNull(source?.retrievedAt),
    event: textOrNull(source?.event),
    race: textOrNull(source?.race),
  })).filter((source) => source.url);
}

function normalizeDataAvailability(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const output = {};
  for (const [key, item] of Object.entries(value)) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) continue;
    if (item.status) {
      output[key] = {
        status: textOrNull(item.status),
        sourceUrl: normalizeHttpUrl(item.sourceUrl),
        checkedAt: textOrNull(item.checkedAt),
        reason: textOrNull(item.reason),
      };
    } else {
      output[key] = normalizeDataAvailability(item);
    }
  }
  return output;
}

function groupSourcesByFamily(value) {
  const groups = { course: [], registration: [], schedule: [], logistics: [], rules: [], checkpoints: [], gpx: [] };
  for (const source of normalizeSources(value)) {
    const families = sourceFamiliesForType(source.type);
    for (const family of families) groups[family].push(source);
  }
  return groups;
}

function sourceFamiliesForType(type) {
  if (type === 'official-registration') return ['registration'];
  if (type === 'official-rules') return ['rules'];
  if (type === 'official-program') return ['schedule'];
  if (type === 'official-logistics' || type === 'official-transport') return ['logistics'];
  if (type === 'official-gpx' || type === 'official-map-platform') return ['course', 'gpx'];
  if (type === 'official-roadbook') return ['course', 'schedule', 'logistics', 'checkpoints'];
  if (type === 'official-race-page') return ['course', 'schedule', 'logistics', 'checkpoints'];
  return ['course'];
}

function latestRetrievedAt(sources) {
  return normalizeSources(sources).map((source) => source.retrievedAt).filter(Boolean).sort().at(-1) ?? null;
}

function createRaceSlug(raceId, year) {
  return `${slugPart(raceId)}-${slugPart(year)}`;
}

function slugPart(value) {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'course';
}

function textOrNull(value) {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  return text || null;
}

function coordinateOrNull(value, min, max) {
  const number = numberOrNull(value);
  return number !== null && number >= min && number <= max ? number : null;
}

function arrayOrEmpty(value) {
  return Array.isArray(value) ? value : [];
}

function normalizeRegistrationStatus(value, lottery) {
  if (lottery === true) return 'lottery';

  const status = String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim()
    .replace(/[\s_-]+/g, '-');

  if (!status) return 'unknown';
  if (['open', 'opened', 'ouvert', 'ouverte', 'inscriptions-ouvertes'].includes(status)) return 'open';
  if (['upcoming', 'coming-soon', 'a-venir', 'avenir', 'soon'].includes(status)) return 'upcoming';
  if (['closed', 'close', 'full', 'complete', 'complet', 'ferme', 'fermee', 'finished', 'termine', 'terminee'].includes(status)) return 'closed';
  if (['lottery', 'loterie', 'waitlist', 'waiting-list', 'liste-attente', 'liste-d-attente'].includes(status)) return 'lottery';
  return 'unknown';
}

function normalizeHttpUrl(value) {
  if (!value) return null;

  try {
    const url = new URL(String(value));
    return ['http:', 'https:'].includes(url.protocol) ? url.href : null;
  } catch {
    return null;
  }
}

function booleanOrNull(value) {
  return typeof value === 'boolean' ? value : null;
}
