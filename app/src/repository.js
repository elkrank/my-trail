import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const dataRoot = process.env.TRAILCOMPARE_DATA_ROOT ?? path.join(__dirname, '..', 'data');
const racesPath = process.env.TRAILCOMPARE_DATASET_PATH ?? path.join(dataRoot, '2026', 'races.json');

let cache = null;

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
      event: entry.event,
      race: entry.race,
      name: `${entry.event.name} - ${entry.race.shortName}`,
      edition: String(edition.year),
      date: edition.date,
      startTime: edition.startTime,
      distanceKm: numberOrNull(edition.distanceKm),
      elevationGainM: numberOrNull(edition.elevationGainM),
      elevationLossM: numberOrNull(edition.elevationLossM),
      startLocation: edition.startLocation ?? null,
      finishLocation: edition.finishLocation ?? null,
      timeLimitMinutes: numberOrNull(edition.maxDurationMinutes),
      sourceUrl: officialRaceSource?.url ?? null,
      confidence: edition.sources.length ? 'official' : 'unverified',
      quality: entry.quality,
      computed: entry.computed,
      registration: normalizeRegistration(edition.registration),
      rules: edition.rules,
      aidStations: edition.aidStations,
      mandatoryEquipment: edition.mandatoryEquipment,
      gpxUrl: edition.gpxUrl,
      gpx: edition.gpx,
      illustration: normalizeIllustration(edition.illustration),
      rawEdition: edition,
      checkpoints: normalizeCheckpoints(index + 1, edition.checkpoints),
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
  return checkpoints
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
    }));
}

function publicRace(race, { includeDetails = false } = {}) {
  const output = {
    id: race.id,
    sourceId: race.sourceId,
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
    elevationGainM: race.elevationGainM,
    elevationLossM: race.elevationLossM,
    startLocation: race.startLocation,
    finishLocation: race.finishLocation,
    timeLimitMinutes: race.timeLimitMinutes,
    sourceUrl: race.sourceUrl,
    confidence: race.confidence,
    quality: race.quality,
    computed: race.computed,
    gpxUrl: race.gpxUrl,
    gpx: race.gpx,
    illustration: race.illustration,
    registration: race.registration,
  };

  if (includeDetails) {
    output.rules = race.rules;
    output.aidStations = race.aidStations;
    output.mandatoryEquipment = race.mandatoryEquipment;
    output.checkpoints = race.checkpoints;
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
  return race ? publicRace(race, { includeDetails: true }) : null;
}

export async function listCheckpointsForRace(raceId) {
  const dataset = await loadDataset();
  const race = dataset.races.find((candidate) => candidate.id === Number(raceId));
  return race ? race.checkpoints : [];
}

export async function getRaceWithCheckpoints(id) {
  const race = await getRaceById(id);
  if (!race) return null;
  return {
    ...race,
    checkpoints: await listCheckpointsForRace(id),
  };
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

function numberOrNull(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string' && value.trim() === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function normalizeIllustration(value) {
  const url = normalizeHttpUrl(value?.url);
  if (!url) return null;

  return {
    url,
    alt: value.alt ? String(value.alt) : null,
    sourceUrl: normalizeHttpUrl(value.sourceUrl),
  };
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
