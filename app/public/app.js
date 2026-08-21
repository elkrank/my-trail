import { STATUS } from './profile-config.js';
import { compareRunnerToRace, formatMinutesAsHoursMinutes } from './profile-comparison.js';
import { createProfileRepository, emptyProfile, formatDurationInput, parseDurationInput, ProfileValidationError } from './profile-repository.js';

const raceASelect = document.querySelector('#race-a');
const raceBSelect = document.querySelector('#race-b');
const swapButton = document.querySelector('#swap-races');
const shareButton = document.querySelector('#share-button');
const exportButton = document.querySelector('#export-button');
const statusEl = document.querySelector('#status');
const comparisonEl = document.querySelector('#comparison');
const toastEl = document.querySelector('#toast');
const viewLinks = Array.from(document.querySelectorAll('[data-view-link]'));
const compareView = document.querySelector('#compare-view');
const explorerView = document.querySelector('#explorer-view');
const favoritesView = document.querySelector('#favorites-view');
const explorerSearchInput = document.querySelector('#explorer-search');
const explorerLocationSelect = document.querySelector('#explorer-location');
const explorerDateFromInput = document.querySelector('#explorer-date-from');
const explorerDateToInput = document.querySelector('#explorer-date-to');
const explorerElevationSelect = document.querySelector('#explorer-elevation');
const explorerDistanceSelect = document.querySelector('#explorer-distance');
const explorerMonthSelect = document.querySelector('#explorer-month');
const explorerPriceMaxSelect = document.querySelector('#explorer-price-max');
const explorerRegistrationStatusSelect = document.querySelector('#explorer-registration-status');
const explorerDurationMaxSelect = document.querySelector('#explorer-duration-max');
const explorerSortSelect = document.querySelector('#explorer-sort');
const explorerGpxOnlyInput = document.querySelector('#explorer-gpx-only');
const explorerResetButton = document.querySelector('#explorer-reset');
const explorerCountEl = document.querySelector('#explorer-count');
const explorerResultsEl = document.querySelector('#explorer-results');
const favoritesCountEl = document.querySelector('#favorites-count');
const favoritesResultsEl = document.querySelector('#favorites-results');
const courseView = document.querySelector('#course-view');
const courseStatusEl = document.querySelector('#course-status');
const courseContentEl = document.querySelector('#course-content');
const profileView = document.querySelector('#profile-view');
const profileStatusEl = document.querySelector('#profile-status');
const profileContentEl = document.querySelector('#profile-content');
let profileRepository;
try {
  profileRepository = createProfileRepository(window.localStorage);
} catch {
  profileRepository = createProfileRepository(null);
}

const confidenceLabels = {
  official: 'Source officielle',
  secondary: 'Source secondaire',
  unverified: 'Donnée non vérifiée',
};

const registrationStatusLabels = {
  open: 'Ouverte',
  upcoming: 'A venir',
  closed: 'Fermee',
  lottery: "Liste d'attente ou loterie",
  unknown: 'Inconnue',
};

const verticalityLabels = {
  rolling: 'Roulante',
  hilly: 'Vallonnée',
  mountainous: 'Montagneuse',
  very_mountainous: 'Très montagneuse',
  extreme: 'Extrême',
};

const viewMeta = {
  compare: {
    title: 'TrailCompare - Comparateur de trails',
    description: 'Comparez deux trails avec les données officielles disponibles, la difficulté physique estimée, la pression des barrières et les traces GPX.',
  },
  explorer: {
    title: 'TrailCompare - Explorer les trails',
    description: 'Explorez les trails par mois, lieu, distance, dénivelé, prix, durée, inscription et disponibilité GPX.',
  },
  favorites: {
    title: 'TrailCompare - Favoris',
    description: 'Retrouvez vos trails favoris sauvegardés localement sur cet appareil.',
  },
  profile: {
    title: 'TrailCompare - Profil coureur',
    description: 'Créez votre profil coureur et confrontez vos repères récents aux exigences d’une course trail.',
  },
};

const favoriteStorageKey = 'trailcompare:favorites:v1';
const explorerStorageKey = 'trailcompare:explorer-filters:v1';

const htmlEscapeMap = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

const elevationRanges = {
  'under-1000': { max: 1000 },
  '1000-3000': { min: 1000, max: 3000 },
  '3000-6000': { min: 3000, max: 6000 },
  'over-6000': { min: 6000 },
};

const distanceRanges = {
  'under-30': { max: 30 },
  '30-80': { min: 30, max: 80 },
  '80-120': { min: 80, max: 120 },
  'over-120': { min: 120 },
};

const state = {
  races: [],
  currentComparison: null,
  gpxCache: new Map(),
  favorites: new Set(),
  isSwapping: false,
  activeView: 'compare',
  currentCourse: null,
  courseMap: null,
  courseMapCleanup: null,
  comparisonMaps: [],
  runnerProfile: null,
  profileRace: null,
};

let leafletLoadPromise = null;

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (character) => htmlEscapeMap[character]);
}

function safeHttpUrl(value) {
  if (!value) return null;

  try {
    const url = new URL(String(value));
    return ['http:', 'https:'].includes(url.protocol) ? url.href : null;
  } catch {
    return null;
  }
}

function courseHref(race) {
  return race?.slug ? `/courses/${encodeURIComponent(race.slug)}` : '/#explorer';
}

function setStatus(message) {
  statusEl.textContent = message;
}

function showToast(message) {
  toastEl.textContent = message;
  toastEl.classList.add('is-visible');
  window.clearTimeout(showToast.timeoutId);
  showToast.timeoutId = window.setTimeout(() => {
    toastEl.classList.remove('is-visible');
  }, 2200);
}

function numericValue(value) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function formatNumber(value, digits = 1) {
  const number = numericValue(value);
  if (number === null) return 'Non disponible';

  return number.toLocaleString('fr-FR', {
    maximumFractionDigits: digits,
    minimumFractionDigits: Number.isInteger(number) ? 0 : digits,
  });
}

function formatDuration(minutes) {
  const number = numericValue(minutes);
  if (number === null || number <= 0) return 'Non disponible';

  const hours = Math.floor(number / 60);
  const remainder = Math.round(number % 60);
  return remainder ? `${hours} h ${String(remainder).padStart(2, '0')}` : `${hours} h`;
}

function formatRaceTimeLimit(race) {
  const duration = numericValue(race?.timeLimitMinutes);
  if (duration !== null && duration > 0) return formatDuration(duration);
  if (race?.finishCutoffTime) return `Arrivée avant ${race.finishCutoffTime}`;
  if (race?.dataAvailability?.maxDurationMinutes?.status === 'not_applicable') return 'Sans objet';
  return 'Non disponible';
}

function formatPrice(value) {
  const number = numericValue(value);
  return number !== null ? `${formatNumber(number, 0)} EUR` : 'Non disponible';
}

function formatMonthOption(month) {
  const value = Number(month);
  if (!Number.isInteger(value) || value < 1 || value > 12) return 'Mois inconnu';
  const date = new Date(2026, value - 1, 1);
  return date.toLocaleDateString('fr-FR', { month: 'long' });
}

function formatKm(value) {
  return numericValue(value) !== null ? `${formatNumber(value, 1)} km` : 'Non disponible';
}

function formatElevation(value) {
  return numericValue(value) !== null ? `${formatNumber(value, 0)} D+` : 'Non disponible';
}

function formatDate(value) {
  const date = parseDateValue(value);
  if (!date) return 'Date a preciser';

  return date.toLocaleDateString('fr-FR', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

function formatRaceDateTime(race) {
  const date = formatDate(race.date);
  return race.startTime ? `${date} - ${race.startTime}` : date;
}

function formatAltitude(value) {
  return numericValue(value) !== null ? `${formatNumber(value, 0)} m` : 'Non disponible';
}

function formatSpeed(value) {
  return numericValue(value) !== null ? `${formatNumber(value, 2)} km/h` : 'Non disponible';
}

function formatScore(value) {
  const number = numericValue(value);
  return number !== null ? `${Math.round(number)}/100` : 'Non disponible';
}

function sourceLabel(race) {
  const confidence = String(race.confidence ?? 'unverified');
  return confidenceLabels[confidence] ?? confidence;
}

function normalizeText(value) {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

function parseDateValue(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value ?? ''))) return null;
  const [year, month, day] = String(value).split('-').map(Number);
  const date = new Date(year, month - 1, day);
  return Number.isNaN(date.getTime()) ? null : date;
}

function dateToTime(value) {
  const date = parseDateValue(value);
  return date ? date.getTime() : null;
}

function raceMonthValue(race) {
  const date = parseDateValue(race.date);
  return date ? String(date.getMonth() + 1).padStart(2, '0') : '';
}

function hasAvailableGpx(race) {
  return race.gpx?.status === 'available';
}

function hasDownloadableGpx(race) {
  return hasAvailableGpx(race) && Boolean(race.gpx?.localFile);
}

function normalizeRegistrationStatus(status) {
  const value = String(status ?? 'unknown');
  return registrationStatusLabels[value] ? value : 'unknown';
}

function registrationStatusLabel(status) {
  return registrationStatusLabels[normalizeRegistrationStatus(status)] ?? registrationStatusLabels.unknown;
}

function verticalityLabel(level) {
  return verticalityLabels[level] ?? 'Non disponible';
}

function difficultyScoreValue(race) {
  return numericValue(race?.difficultyScore) ?? numericValue(race?.difficultyScoreV1);
}

function readFavoriteIds() {
  try {
    const raw = window.localStorage?.getItem(favoriteStorageKey);
    if (!raw) return new Set();
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return new Set();
    return new Set(parsed.filter((value) => typeof value === 'string' && value.trim()));
  } catch {
    return new Set();
  }
}

function writeFavoriteIds() {
  try {
    window.localStorage?.setItem(favoriteStorageKey, JSON.stringify([...state.favorites]));
  } catch {
    // Local storage can be disabled; keep the in-memory state usable for the session.
  }
}

function reconcileFavorites(races) {
  const knownSourceIds = new Set(races.map((race) => race.sourceId).filter(Boolean));
  state.favorites = new Set([...readFavoriteIds()].filter((sourceId) => knownSourceIds.has(sourceId)));
  writeFavoriteIds();
}

function isFavorite(race) {
  return Boolean(race?.sourceId && state.favorites.has(race.sourceId));
}

function updateDocumentMeta(view) {
  const meta = viewMeta[view] ?? viewMeta.compare;
  document.title = meta.title;
  document.querySelector('meta[name="description"]')?.setAttribute('content', meta.description);
  document.querySelector('meta[property="og:title"]')?.setAttribute('content', meta.title);
  document.querySelector('meta[property="og:description"]')?.setAttribute('content', meta.description);
  document.querySelector('meta[name="twitter:title"]')?.setAttribute('content', meta.title);
  document.querySelector('meta[name="twitter:description"]')?.setAttribute('content', meta.description);
}

function knownRaceLocationLabel(race) {
  const event = race.event ?? {};
  const city = event.city;
  const region = event.region;
  const country = event.country;
  const parts = [];

  if (city) parts.push(city);
  if (region && normalizeText(region) !== normalizeText(city)) parts.push(region);
  if (!parts.length && country) parts.push(country);

  return parts.join(' - ');
}

function raceLocationLabel(race) {
  return knownRaceLocationLabel(race) || 'Lieu a preciser';
}

function startFinishLabel(race) {
  const start = race.startLocation;
  const finish = race.finishLocation;
  if (start && finish && normalizeText(start) !== normalizeText(finish)) return `Depart ${start} - Arrivee ${finish}`;
  if (start) return `Depart ${start}`;
  if (finish) return `Arrivee ${finish}`;
  return 'Depart et arrivee a preciser';
}

function raceSearchText(race) {
  return normalizeText([
    race.name,
    race.eventName,
    race.raceName,
    race.shortName,
  ].filter(Boolean).join(' '));
}

function getExplorerFilters() {
  return {
    search: normalizeText(explorerSearchInput?.value),
    location: explorerLocationSelect?.value ?? '',
    dateFrom: explorerDateFromInput?.value ?? '',
    dateTo: explorerDateToInput?.value ?? '',
    elevation: explorerElevationSelect?.value ?? '',
    distance: explorerDistanceSelect?.value ?? '',
    month: explorerMonthSelect?.value ?? '',
    priceMax: explorerPriceMaxSelect?.value ?? '',
    registrationStatus: explorerRegistrationStatusSelect?.value ?? '',
    durationMax: explorerDurationMaxSelect?.value ?? '',
    sort: explorerSortSelect?.value || 'date-asc',
    gpxOnly: Boolean(explorerGpxOnlyInput?.checked),
  };
}

function persistExplorerFilters(filters = getExplorerFilters()) {
  try {
    window.sessionStorage?.setItem(explorerStorageKey, JSON.stringify(filters));
  } catch {
    // Session storage is optional; browser back still retains controls when possible.
  }
}

function restoreExplorerFilters() {
  try {
    const filters = JSON.parse(window.sessionStorage?.getItem(explorerStorageKey) ?? 'null');
    if (!filters || typeof filters !== 'object') return;
    if (explorerSearchInput) explorerSearchInput.value = filters.search ?? '';
    if (explorerLocationSelect) explorerLocationSelect.value = filters.location ?? '';
    if (explorerDateFromInput) explorerDateFromInput.value = filters.dateFrom ?? '';
    if (explorerDateToInput) explorerDateToInput.value = filters.dateTo ?? '';
    if (explorerElevationSelect) explorerElevationSelect.value = filters.elevation ?? '';
    if (explorerDistanceSelect) explorerDistanceSelect.value = filters.distance ?? '';
    if (explorerMonthSelect) explorerMonthSelect.value = filters.month ?? '';
    if (explorerPriceMaxSelect) explorerPriceMaxSelect.value = filters.priceMax ?? '';
    if (explorerRegistrationStatusSelect) explorerRegistrationStatusSelect.value = filters.registrationStatus ?? '';
    if (explorerDurationMaxSelect) explorerDurationMaxSelect.value = filters.durationMax ?? '';
    if (explorerSortSelect) explorerSortSelect.value = filters.sort ?? 'date-asc';
    if (explorerGpxOnlyInput) explorerGpxOnlyInput.checked = filters.gpxOnly === true;
  } catch {
    // Ignore malformed or unavailable session storage.
  }
}

function matchesRange(value, rangeKey, ranges) {
  if (!rangeKey) return true;
  const range = ranges[rangeKey];
  const number = numericValue(value);
  if (!range || number === null) return false;
  if (Number.isFinite(range.min) && number < range.min) return false;
  if (Number.isFinite(range.max) && number >= range.max) return false;
  return true;
}

function matchesMaximum(value, maxValue) {
  if (!maxValue) return true;
  const number = numericValue(value);
  const max = numericValue(maxValue);
  return number !== null && max !== null && number <= max;
}

function matchesExplorerFilters(race, filters) {
  if (filters.search && !raceSearchText(race).includes(filters.search)) return false;
  if (filters.location && knownRaceLocationLabel(race) !== filters.location) return false;
  if (!matchesRange(race.elevationGainM, filters.elevation, elevationRanges)) return false;
  if (!matchesRange(race.distanceKm, filters.distance, distanceRanges)) return false;
  if (filters.month && raceMonthValue(race) !== filters.month) return false;
  if (!matchesMaximum(race.registration?.priceEur, filters.priceMax)) return false;
  if (filters.registrationStatus && normalizeRegistrationStatus(race.registration?.status) !== filters.registrationStatus) return false;
  if (!matchesMaximum(race.timeLimitMinutes, filters.durationMax)) return false;
  if (filters.gpxOnly && !hasAvailableGpx(race)) return false;

  if (filters.dateFrom || filters.dateTo) {
    const raceTime = dateToTime(race.date);
    const fromTime = dateToTime(filters.dateFrom);
    const toTime = dateToTime(filters.dateTo);

    if (!Number.isFinite(raceTime)) return false;
    if (Number.isFinite(fromTime) && raceTime < fromTime) return false;
    if (Number.isFinite(toTime) && raceTime > toTime) return false;
  }

  return true;
}

function compareNullableNumbers(valueA, valueB, direction = 1) {
  const numberA = numericValue(valueA);
  const numberB = numericValue(valueB);
  const hasA = numberA !== null;
  const hasB = numberB !== null;

  if (!hasA && !hasB) return 0;
  if (!hasA) return 1;
  if (!hasB) return -1;
  return (numberA - numberB) * direction;
}

function compareRaceDates(raceA, raceB, direction = 1) {
  const timeA = dateToTime(raceA.date);
  const timeB = dateToTime(raceB.date);
  const hasA = Number.isFinite(timeA);
  const hasB = Number.isFinite(timeB);

  if (!hasA && !hasB) return 0;
  if (!hasA) return 1;
  if (!hasB) return -1;
  return (timeA - timeB) * direction;
}

function compareRaceNames(raceA, raceB) {
  return String(raceA.name).localeCompare(String(raceB.name), 'fr');
}

function sortExplorerRaces(races, sort) {
  const [field, order] = String(sort || 'date-asc').split('-');
  const direction = order === 'desc' ? -1 : 1;

  return [...races].sort((raceA, raceB) => {
    const comparison =
      field === 'distance'
        ? compareNullableNumbers(raceA.distanceKm, raceB.distanceKm, direction)
        : field === 'elevation'
          ? compareNullableNumbers(raceA.elevationGainM, raceB.elevationGainM, direction)
          : compareRaceDates(raceA, raceB, direction);

    return comparison || compareRaceNames(raceA, raceB);
  });
}

function scoreTone(score) {
  const value = numericValue(score);
  if (value === null) return 'muted';
  if (value >= 70) return 'high';
  if (value >= 50) return 'medium';
  return 'low';
}

function raceToneClass(variant) {
  return variant === 'b' ? 'tone-orange' : 'tone-green';
}

function getDistanceTicks(distanceKm) {
  const distance = Number(distanceKm);
  if (!Number.isFinite(distance) || distance <= 0) return [];

  const roughStep = distance <= 30 ? 10 : distance <= 80 ? 20 : distance <= 160 ? 40 : 60;
  const ticks = [];
  for (let tick = 0; tick <= distance; tick += roughStep) {
    ticks.push(tick);
  }
  if (ticks[ticks.length - 1] !== Math.round(distance)) {
    ticks.push(distance);
  }
  return ticks.slice(0, 6);
}

function axisTicksTemplate(distanceKm) {
  const ticks = getDistanceTicks(distanceKm);
  return ticks
    .map((tick) => `<span>${formatNumber(tick, Number.isInteger(tick) ? 0 : 1)} km</span>`)
    .join('');
}

function createPolyline(points, width, height, padding = 8) {
  if (!Array.isArray(points) || points.length < 2) return '';

  const xs = points.map((point) => Number(point.x));
  const ys = points.map((point) => Number(point.y));
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const xRange = maxX - minX || 1;
  const yRange = maxY - minY || 1;

  return points
    .map((point) => {
      const x = padding + ((Number(point.x) - minX) / xRange) * (width - padding * 2);
      const y = height - padding - ((Number(point.y) - minY) / yRange) * (height - padding * 2);
      return `${roundForSvg(x)},${roundForSvg(y)}`;
    })
    .join(' ');
}

function createRoutePolylines(segments, width, height, padding = 8) {
  const routeSegments = normalizeRouteSegments(segments);
  const allPoints = routeSegments.flat();
  if (allPoints.length < 2) return [];

  const xs = allPoints.map((point) => Number(point.x));
  const ys = allPoints.map((point) => Number(point.y));
  const bounds = {
    minX: Math.min(...xs),
    maxX: Math.max(...xs),
    minY: Math.min(...ys),
    maxY: Math.max(...ys),
  };
  bounds.xRange = bounds.maxX - bounds.minX || 1;
  bounds.yRange = bounds.maxY - bounds.minY || 1;

  return routeSegments
    .filter((segment) => segment.length > 1)
    .map((segment) => createPolylineWithBounds(segment, width, height, padding, bounds));
}

function createPolylineWithBounds(points, width, height, padding, bounds) {
  return points
    .map((point) => {
      const x = padding + ((Number(point.x) - bounds.minX) / bounds.xRange) * (width - padding * 2);
      const y = height - padding - ((Number(point.y) - bounds.minY) / bounds.yRange) * (height - padding * 2);
      return `${roundForSvg(x)},${roundForSvg(y)}`;
    })
    .join(' ');
}

function normalizeRouteSegments(segments) {
  if (!Array.isArray(segments) || segments.length === 0) return [];
  if (!Array.isArray(segments[0])) return [segments];
  return segments;
}

function roundForSvg(value) {
  return Math.round(value * 10) / 10;
}

function createAreaPath(points, width, height, padding = 8) {
  const polyline = createPolyline(points, width, height, padding);
  if (!polyline) return '';

  const pairs = polyline.split(' ');
  const firstX = pairs[0].split(',')[0];
  const lastX = pairs[pairs.length - 1].split(',')[0];
  const baseline = height - padding;
  return `M ${firstX} ${baseline} L ${polyline.replaceAll(',', ' ')} L ${lastX} ${baseline} Z`;
}

function simplifyPoints(points, target = 90) {
  if (!Array.isArray(points) || points.length <= target) return points ?? [];

  const step = Math.ceil(points.length / target);
  const simplified = points.filter((_point, index) => index % step === 0);
  const lastPoint = points[points.length - 1];
  if (simplified[simplified.length - 1] !== lastPoint) simplified.push(lastPoint);
  return simplified;
}

function mapTemplate(race, variant, gpxData) {
  const routeSegments = normalizeRouteSegments(gpxData?.segments)
    .map((segment) => simplifyPoints(segment, 160).map((point) => ({ x: point.lon, y: point.lat })));
  const polylines = createRoutePolylines(routeSegments, 560, 190, 18);
  const hasGpx = polylines.length > 0;
  const className = `map-panel ${raceToneClass(variant)} ${hasGpx ? 'has-data' : 'is-empty'}`;

  return `
    <section class="${className}" aria-label="Tracé GPX">
      <div class="map-grid" aria-hidden="true"></div>
      ${
        hasGpx
          ? `
            <div id="comparison-map-${variant}" class="comparison-map-canvas" data-comparison-map="${variant}">
              <svg class="route-map" viewBox="0 0 560 190" role="img" aria-label="Tracé GPX disponible sur fond neutre">
                ${polylines.map((polyline) => `<polyline class="route-shadow" points="${polyline}"></polyline>`).join('')}
                ${polylines.map((polyline) => `<polyline points="${polyline}"></polyline>`).join('')}
              </svg>
            </div>
          `
          : `
            <div class="empty-visual">
              <svg viewBox="0 0 80 48" aria-hidden="true" focusable="false">
                <path d="M7 36c10-8 17-8 27 0s18 8 29 0"></path>
                <path d="M13 28c8-7 14-7 22 0s15 7 24 0"></path>
                <path d="M21 20c6-5 11-5 17 0s11 5 18 0"></path>
              </svg>
              <span>Tracé GPX non disponible</span>
            </div>
          `
      }
      <div class="map-stats">
        <strong>${formatKm(race.distanceKm)}</strong>
        <strong>${formatElevation(race.elevationGainM)}</strong>
      </div>
    </section>
  `;
}

function gpxElevationQualityStatus(gpxData) {
  return gpxData?.elevationQuality?.status ?? null;
}

function gpxElevationQualityMessage(status) {
  if (status === 'inconsistent') {
    return 'Profil altimétrique non affiché : les altitudes du GPX sont incohérentes avec le D+ officiel.';
  }
  if (status === 'unverified') {
    return 'Profil issu du GPX, non vérifié par rapport à un D+ officiel.';
  }
  return '';
}

function profileTemplate(race, variant, gpxData) {
  const gpxElevationPoints = Array.isArray(gpxData?.elevationProfile) && gpxData.elevationProfile.length
    ? gpxData.elevationProfile.map((point) => ({
      x: point.distanceKm,
      y: Number(point.elevationM),
    }))
    : gpxData?.points
      ?.filter((point) => numericValue(point.ele) !== null)
      .map((point, index) => ({
        x: point.distanceKm ?? index,
        y: numericValue(point.ele),
      }));

  const elevationPoints = gpxElevationPoints?.length > 1
    ? simplifyPoints(gpxElevationPoints, 120)
    : [];
  const elevationQualityStatus = gpxElevationQualityStatus(gpxData);
  const elevationQualityMessage = gpxElevationQualityMessage(elevationQualityStatus);
  const hasProfile = elevationQualityStatus !== 'inconsistent' && elevationPoints.length > 1;
  const polyline = hasProfile ? createPolyline(elevationPoints, 560, 134, 12) : '';
  const areaPath = hasProfile ? createAreaPath(elevationPoints, 560, 134, 12) : '';
  const altitudes = elevationPoints.map((point) => point.y);
  const minAltitude = hasProfile ? Math.min(...altitudes) : null;
  const maxAltitude = hasProfile ? Math.max(...altitudes) : null;
  const profileHeadingMeta = hasProfile
    ? `${formatAltitude(minAltitude)} - ${formatAltitude(maxAltitude)}${elevationQualityStatus === 'unverified' ? ' - non vérifié' : ''}`
    : 'Données absentes';

  return `
    <section class="profile-block ${raceToneClass(variant)}" aria-label="Profil altimétrique">
      <div class="section-heading">
        <h3>Profil altimétrique</h3>
        <span>${profileHeadingMeta}</span>
      </div>
      ${
        hasProfile
          ? `
            <div class="profile-chart">
              <svg viewBox="0 0 560 134" role="img" aria-label="Profil altimétrique issu du GPX officiel">
                <path class="profile-area" d="${areaPath}"></path>
                <polyline class="profile-line" points="${polyline}"></polyline>
              </svg>
            </div>
            <div class="axis-labels">${axisTicksTemplate(gpxData?.computed?.distanceKm ?? race.distanceKm)}</div>
          `
          : `
            <div class="profile-empty">
              <span>${escapeHtml(elevationQualityMessage || 'Profil GPX réel non disponible dans les données actuelles.')}</span>
            </div>
          `
      }
    </section>
  `;
}

function metricTemplate(label, value, { score, accent = false } = {}) {
  const hasScore = numericValue(score) !== null;
  const tone = hasScore ? scoreTone(score) : 'muted';
  return `
    <div class="metric ${accent ? 'is-accent' : ''}">
      <span>${escapeHtml(label)}</span>
      <strong>${escapeHtml(value)}</strong>
      ${hasScore ? `<i class="score-dot score-${tone}" aria-hidden="true"></i>` : ''}
    </div>
  `;
}

function metricsTemplate(race) {
  const difficultyScore = difficultyScoreValue(race);
  return `
    <div class="metrics-grid" aria-label="Métriques principales">
      ${metricTemplate('KM-EFFORT', formatKm(race.kmEffort))}
      ${metricTemplate('DIFFICULTÉ PHYSIQUE ESTIMÉE', formatScore(difficultyScore), {
        score: difficultyScore,
        accent: true,
      })}
      ${metricTemplate('VERTICALITÉ', verticalityLabel(race.verticalityLevel))}
      ${metricTemplate('TEMPS LIMITE', formatRaceTimeLimit(race))}
      ${metricTemplate('PRESSION V0', formatScore(race.barrierPressureScoreV0), {
        score: race.barrierPressureScoreV0,
        accent: true,
      })}
    </div>
  `;
}

function criticalBarrierTemplate(race) {
  if (!race.criticalBarrier) {
    return `
      <section class="critical-block is-empty">
        <div class="section-heading">
          <h3>Barrière critique</h3>
        </div>
        <p>Aucune barrière critique calculable pour cette course.</p>
      </section>
    `;
  }

  return `
    <section class="critical-block">
      <div class="section-heading">
        <h3>Barrière critique</h3>
      </div>
      <div class="critical-content">
        <span class="alert-icon" aria-hidden="true">
          <svg viewBox="0 0 24 24" focusable="false"><path d="M12 4 3 20h18L12 4Z"></path><path d="M12 9v5M12 17h.01"></path></svg>
        </span>
        <div>
          <strong>${escapeHtml(race.criticalBarrier.name)} - ${formatKm(race.criticalBarrier.distanceKm)}</strong>
          <p>Checkpoint avec la pression V0 la plus élevée.</p>
        </div>
      </div>
    </section>
  `;
}

function checkpointTemplate(checkpoint) {
  return `
    <tr>
      <th scope="row">
        <strong>${escapeHtml(checkpoint.name)}</strong>
        <span>${formatKm(checkpoint.distanceKm)}</span>
      </th>
      <td>${formatDuration(checkpoint.elapsedLimitMinutes)}</td>
      <td>${formatSpeed(checkpoint.requiredCheckpointSpeedKmh)}</td>
      <td>
        <span class="score-inline">
          ${formatScore(checkpoint.barrierPressureScoreV0)}
          <i class="score-dot score-${scoreTone(checkpoint.barrierPressureScoreV0)}" aria-hidden="true"></i>
        </span>
      </td>
      <td aria-hidden="true" class="row-chevron">
        <svg viewBox="0 0 24 24" focusable="false"><path d="m9 6 6 6-6 6"></path></svg>
      </td>
    </tr>
  `;
}

function checkpointsTemplate(race) {
  if (!Array.isArray(race.checkpoints) || race.checkpoints.length === 0) {
    return `
      <section class="checkpoints-block">
        <div class="section-heading">
          <h3>Checkpoints clés</h3>
        </div>
        <div class="empty-state">
          <span aria-hidden="true">
            <svg viewBox="0 0 24 24" focusable="false"><path d="M12 17v-5M12 8h.01M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z"></path></svg>
          </span>
          <p>Aucun checkpoint de barrière défini pour cette course.</p>
        </div>
      </section>
    `;
  }

  return `
    <section class="checkpoints-block">
      <div class="section-heading">
        <h3>Checkpoints clés</h3>
        <span>${race.checkpoints.length} points</span>
      </div>
      <div class="checkpoint-table-wrap">
        <table class="checkpoint-table">
          <thead>
            <tr>
              <th scope="col">Point</th>
              <th scope="col">Limite</th>
              <th scope="col">Vitesse min.</th>
              <th scope="col">Pression</th>
              <th scope="col"><span class="sr-only">Détail</span></th>
            </tr>
          </thead>
          <tbody>
            ${race.checkpoints.map(checkpointTemplate).join('')}
          </tbody>
        </table>
      </div>
    </section>
  `;
}

function sourceTemplate(race) {
  const safeSourceUrl = safeHttpUrl(race.sourceUrl);
  return `
    <footer class="race-source">
      <span>${escapeHtml(sourceLabel(race))}</span>
      ${safeSourceUrl ? `<a href="${escapeHtml(safeSourceUrl)}" rel="noopener noreferrer" target="_blank">Consulter</a>` : '<span>Source indisponible</span>'}
    </footer>
  `;
}

function favoriteButtonTemplate(race) {
  const selected = isFavorite(race);
  const label = selected ? `Retirer ${race.name} des favoris` : `Ajouter ${race.name} aux favoris`;
  return `
    <button class="favorite-button ${selected ? 'is-active' : ''}" type="button" data-favorite-source-id="${escapeHtml(race.sourceId)}" aria-pressed="${selected ? 'true' : 'false'}" aria-label="${escapeHtml(label)}">
      <svg viewBox="0 0 24 24" focusable="false" aria-hidden="true">
        <path d="m12 5 2.1 4.3 4.7.7-3.4 3.3.8 4.7-4.2-2.2L7.8 18l.8-4.7L5.2 10l4.7-.7L12 5Z"></path>
      </svg>
    </button>
  `;
}

function registrationLinkTemplate(race, className = '') {
  const registrationUrl = safeHttpUrl(race.registration?.url);
  if (!registrationUrl) return '';
  return `<a class="button button-primary button-small ${className}" href="${escapeHtml(registrationUrl)}" target="_blank" rel="noopener noreferrer">S'inscrire sur le site officiel</a>`;
}

function gpxDownloadLinkTemplate(race, className = '') {
  if (!hasDownloadableGpx(race)) return '';
  return `<a class="button button-secondary button-small ${className}" href="/api/races/${escapeHtml(race.id)}/gpx/download">Télécharger le GPX officiel</a>`;
}

function raceActionsTemplate(race) {
  const actions = [
    `<a class="button button-primary button-small" href="/profil?course=${escapeHtml(race.slug)}">Comparer avec mon profil</a>`,
    registrationLinkTemplate(race),
    gpxDownloadLinkTemplate(race),
  ].filter(Boolean);
  if (!actions.length) return '';
  return `<div class="race-actions">${actions.join('')}</div>`;
}

function raceCardTemplate(race, variant, gpxData) {
  const variantLabel = variant.toUpperCase();
  const toneClass = raceToneClass(variant);
  const missing = race.quality?.missingFields?.length
    ? race.quality.missingFields.map((field) => field.toUpperCase()).join(', ')
    : 'Données principales';

  return `
    <article class="race-card ${toneClass}">
      <header class="race-card-header">
        <div class="race-title-row">
          <span class="variant-badge">${variantLabel}</span>
          ${favoriteButtonTemplate(race)}
        </div>
        <div>
          <h2>${escapeHtml(race.name)}</h2>
          <p>${formatKm(race.distanceKm)} · ${escapeHtml(race.edition)}</p>
        </div>
      </header>

      ${mapTemplate(race, variant, gpxData)}
      ${profileTemplate(race, variant, gpxData)}
      ${metricsTemplate(race)}
      ${criticalBarrierTemplate(race)}
      ${checkpointsTemplate(race)}

      <div class="data-note">
        <span>Couverture des données</span>
        <strong>${escapeHtml(missing)}</strong>
      </div>

      ${raceActionsTemplate(race)}
      ${sourceTemplate(race)}
    </article>
  `;
}

function populateSelect(select, races, selectedId) {
  select.innerHTML = races
    .map((race) => {
      const label = `${race.name} · ${race.edition}`;
      return `<option value="${escapeHtml(race.id)}" ${race.id === selectedId ? 'selected' : ''}>${escapeHtml(label)}</option>`;
    })
    .join('');
}

function populateExplorerLocations(races) {
  if (!explorerLocationSelect) return;

  const selected = explorerLocationSelect.value;
  const locations = [...new Set(races.map(knownRaceLocationLabel).filter(Boolean))]
    .sort((locationA, locationB) => locationA.localeCompare(locationB, 'fr'));

  explorerLocationSelect.innerHTML = [
    '<option value="">Tous les lieux</option>',
    ...locations.map((location) => `<option value="${escapeHtml(location)}">${escapeHtml(location)}</option>`),
  ].join('');

  explorerLocationSelect.value = locations.includes(selected) ? selected : '';
}

function populateSelectOptions(select, defaultLabel, values, labelFn) {
  if (!select) return;

  const selected = select.value;
  select.innerHTML = [
    `<option value="">${escapeHtml(defaultLabel)}</option>`,
    ...values.map((value) => `<option value="${escapeHtml(value)}">${escapeHtml(labelFn(value))}</option>`),
  ].join('');
  select.value = values.includes(selected) ? selected : '';
}

function populateExplorerDynamicFilters(races) {
  const months = [...new Set(races.map(raceMonthValue).filter(Boolean))]
    .sort((monthA, monthB) => Number(monthA) - Number(monthB));
  const prices = [...new Set(races
    .map((race) => race.registration?.priceEur)
    .map(numericValue)
    .filter((value) => value !== null)
    .map((value) => String(value)))]
    .sort((priceA, priceB) => Number(priceA) - Number(priceB));
  const durations = [...new Set(races
    .map((race) => race.timeLimitMinutes)
    .map(numericValue)
    .filter((value) => value !== null && value > 0)
    .map((value) => String(value)))]
    .sort((durationA, durationB) => Number(durationA) - Number(durationB));
  const statuses = [...new Set(races.map((race) => normalizeRegistrationStatus(race.registration?.status)))]
    .filter((status) => registrationStatusLabels[status])
    .sort((statusA, statusB) => registrationStatusLabel(statusA).localeCompare(registrationStatusLabel(statusB), 'fr'));

  populateSelectOptions(explorerMonthSelect, 'Tous les mois', months, (month) => formatMonthOption(Number(month)));
  populateSelectOptions(explorerPriceMaxSelect, 'Tous les prix', prices, (price) => `Jusqu'à ${formatPrice(price)}`);
  populateSelectOptions(explorerRegistrationStatusSelect, 'Tous les statuts', statuses, registrationStatusLabel);
  populateSelectOptions(explorerDurationMaxSelect, 'Toutes durées', durations, (duration) => `Jusqu'à ${formatDuration(duration)}`);
}

function explorerMetricTemplate(label, value) {
  return `
    <div class="explorer-metric">
      <span>${escapeHtml(label)}</span>
      <strong>${escapeHtml(value)}</strong>
    </div>
  `;
}

function explorerIllustrationTemplate(race) {
  const illustrationUrl = safeHttpUrl(race.illustration?.url);
  if (!illustrationUrl) {
    return `<a class="explorer-card-media is-empty" href="${escapeHtml(courseHref(race))}" aria-label="Voir la fiche ${escapeHtml(race.name)}"></a>`;
  }

  const alt = race.illustration?.alt || `Illustration ${race.name}`;
  return `
    <a class="explorer-card-media" href="${escapeHtml(courseHref(race))}">
      <img src="${escapeHtml(illustrationUrl)}" alt="${escapeHtml(alt)}" loading="lazy" decoding="async" referrerpolicy="no-referrer" onerror="this.parentElement.classList.add('is-empty'); this.remove();">
    </a>
  `;
}

function explorerRaceCardTemplate(race) {
  const isGpxAvailable = hasAvailableGpx(race);
  const qualityStatus = race.quality?.status === 'complete' ? 'Complet' : 'Partiel';
  const qualityClass = race.quality?.status === 'complete' ? 'is-complete' : 'is-partial';

  return `
    <article class="explorer-card">
      ${explorerIllustrationTemplate(race)}

      <header class="explorer-card-header">
        <div>
          <span class="explorer-event">${escapeHtml(race.eventName)}</span>
          <h2><a class="explorer-title-link" href="${escapeHtml(courseHref(race))}">${escapeHtml(race.name)}</a></h2>
        </div>
        <div class="explorer-card-toolbar">
          <span class="quality-badge ${qualityClass}">${qualityStatus}</span>
          ${favoriteButtonTemplate(race)}
        </div>
      </header>

      <div class="explorer-metrics">
        ${explorerMetricTemplate('Date', formatRaceDateTime(race))}
        ${explorerMetricTemplate('Lieu', raceLocationLabel(race))}
        ${explorerMetricTemplate('Distance', formatKm(race.distanceKm))}
        ${explorerMetricTemplate('D+', formatElevation(race.elevationGainM))}
        ${explorerMetricTemplate('Prix', formatPrice(race.registration?.priceEur))}
        ${explorerMetricTemplate('Inscription', registrationStatusLabel(race.registration?.status))}
      </div>

      <div class="explorer-route-note">
        <span>${escapeHtml(startFinishLabel(race))}</span>
        <span>${escapeHtml(formatRaceTimeLimit(race))}</span>
      </div>

      <footer class="explorer-card-footer">
        <span class="gpx-badge ${isGpxAvailable ? 'is-available' : 'is-missing'}">
          ${isGpxAvailable ? 'GPX disponible' : 'GPX absent'}
        </span>
        <div class="explorer-actions">
          <a class="button button-primary button-small" href="${escapeHtml(courseHref(race))}">Voir la fiche</a>
          ${registrationLinkTemplate(race)}
          ${gpxDownloadLinkTemplate(race)}
          <button class="button button-secondary button-small" type="button" data-compare-target="a" data-race-id="${escapeHtml(race.id)}">Comparer A</button>
          <button class="button button-secondary button-small" type="button" data-compare-target="b" data-race-id="${escapeHtml(race.id)}">Comparer B</button>
        </div>
      </footer>
    </article>
  `;
}

function renderExplorer() {
  if (!explorerResultsEl) return;

  const filters = getExplorerFilters();
  persistExplorerFilters(filters);
  const filteredRaces = sortExplorerRaces(
    state.races.filter((race) => matchesExplorerFilters(race, filters)),
    filters.sort,
  );
  const total = state.races.length;
  const count = filteredRaces.length;
  const plural = count > 1 ? 's' : '';

  if (explorerCountEl) {
    explorerCountEl.textContent = `${count} course${plural} sur ${total}`;
  }

  explorerResultsEl.innerHTML = filteredRaces.length
    ? filteredRaces.map(explorerRaceCardTemplate).join('')
    : `
      <div class="explorer-empty">
        <strong>Aucune course trouvee</strong>
        <p>Modifiez les filtres pour afficher plus de resultats.</p>
      </div>
    `;
}

function favoriteRaces() {
  return state.races.filter((race) => isFavorite(race));
}

function renderFavorites() {
  if (!favoritesResultsEl) return;

  const races = favoriteRaces();
  const count = races.length;
  const plural = count > 1 ? 's' : '';

  if (favoritesCountEl) {
    favoritesCountEl.textContent = `${count} favori${plural}`;
  }

  favoritesResultsEl.innerHTML = races.length
    ? races.map(explorerRaceCardTemplate).join('')
    : `
      <div class="explorer-empty">
        <strong>Aucun favori</strong>
        <p>Ajoutez des courses depuis Explorer ou le comparateur pour les retrouver ici.</p>
      </div>
    `;
}

function refreshFavoriteViews() {
  if (state.activeView === 'explorer') renderExplorer();
  if (state.activeView === 'favorites') renderFavorites();
  if (state.currentComparison) {
    comparisonEl.querySelectorAll?.('[data-favorite-source-id]').forEach((button) => {
      const race = state.races.find((candidate) => candidate.sourceId === button.dataset.favoriteSourceId);
      if (!race) return;
      const selected = isFavorite(race);
      button.classList.toggle('is-active', selected);
      button.setAttribute('aria-pressed', selected ? 'true' : 'false');
      button.setAttribute('aria-label', selected ? `Retirer ${race.name} des favoris` : `Ajouter ${race.name} aux favoris`);
    });
  }
  if (state.currentCourse && courseContentEl) {
    courseContentEl.querySelectorAll?.('[data-favorite-source-id]').forEach((button) => {
      const selected = isFavorite(state.currentCourse);
      button.classList.toggle('is-active', selected);
      button.setAttribute('aria-pressed', selected ? 'true' : 'false');
      button.setAttribute('aria-label', selected ? `Retirer ${state.currentCourse.name} des favoris` : `Ajouter ${state.currentCourse.name} aux favoris`);
    });
  }
}

function toggleFavorite(sourceId) {
  const race = state.races.find((candidate) => candidate.sourceId === sourceId);
  if (!race) return;

  if (state.favorites.has(sourceId)) {
    state.favorites.delete(sourceId);
    showToast('Course retirée des favoris.');
  } else {
    state.favorites.add(sourceId);
    showToast('Course ajoutée aux favoris.');
  }

  writeFavoriteIds();
  refreshFavoriteViews();
}

function resetExplorerFilters() {
  if (explorerSearchInput) explorerSearchInput.value = '';
  if (explorerLocationSelect) explorerLocationSelect.value = '';
  if (explorerDateFromInput) explorerDateFromInput.value = '';
  if (explorerDateToInput) explorerDateToInput.value = '';
  if (explorerElevationSelect) explorerElevationSelect.value = '';
  if (explorerDistanceSelect) explorerDistanceSelect.value = '';
  if (explorerMonthSelect) explorerMonthSelect.value = '';
  if (explorerPriceMaxSelect) explorerPriceMaxSelect.value = '';
  if (explorerRegistrationStatusSelect) explorerRegistrationStatusSelect.value = '';
  if (explorerDurationMaxSelect) explorerDurationMaxSelect.value = '';
  if (explorerSortSelect) explorerSortSelect.value = 'date-asc';
  if (explorerGpxOnlyInput) explorerGpxOnlyInput.checked = false;
  renderExplorer();
}

function compareFromExplorer(raceId, target) {
  const race = state.races.find((candidate) => candidate.id === Number(raceId));
  if (!race) return;

  if (target === 'b') {
    raceBSelect.value = String(race.id);
  } else {
    raceASelect.value = String(race.id);
  }

  setActiveView('compare');
  compareSelectedRaces();
  showToast(`Course ajoutée en ${target === 'b' ? 'B' : 'A'}.`);
}

function handleRaceListAction(event) {
  const favoriteButton = event.target.closest?.('[data-favorite-source-id]');
  if (favoriteButton) {
    toggleFavorite(favoriteButton.dataset.favoriteSourceId);
    return;
  }

  const button = event.target.closest?.('[data-compare-target]');
  if (!button) return;
  compareFromExplorer(button.dataset.raceId, button.dataset.compareTarget);
}

function getInitialView() {
  if (window.location.hash === '#explorer') return 'explorer';
  if (window.location.hash === '#favorites') return 'favorites';
  return 'compare';
}

function setActiveView(view, { updateHash = true } = {}) {
  const activeView = ['compare', 'explorer', 'favorites'].includes(view) ? view : 'compare';
  state.activeView = activeView;

  if (compareView) {
    compareView.hidden = activeView !== 'compare';
    compareView.classList.toggle('is-active', activeView === 'compare');
  }

  if (explorerView) {
    explorerView.hidden = activeView !== 'explorer';
    explorerView.classList.toggle('is-active', activeView === 'explorer');
  }

  if (favoritesView) {
    favoritesView.hidden = activeView !== 'favorites';
    favoritesView.classList.toggle('is-active', activeView === 'favorites');
  }

  viewLinks.forEach((link) => {
    const isActive = link.dataset.viewLink === activeView;
    link.classList.toggle('is-active', isActive);
    if (isActive) {
      link.setAttribute('aria-current', 'page');
    } else {
      link.removeAttribute('aria-current');
    }
  });

  if (updateHash) {
    const nextHash = activeView === 'explorer' ? '#explorer' : activeView === 'favorites' ? '#favorites' : '#compare';
    if (window.location.hash !== nextHash) {
      window.location.hash = nextHash;
    }
  }

  updateDocumentMeta(activeView);
  if (activeView === 'explorer') renderExplorer();
  if (activeView === 'favorites') renderFavorites();
}

function bindNavigation() {
  viewLinks.forEach((link) => {
    link.addEventListener('click', (event) => {
      event.preventDefault();
      setActiveView(link.dataset.viewLink);
    });
  });

  window.addEventListener('hashchange', () => {
    setActiveView(getInitialView(), { updateHash: false });
  });
}

function bindExplorerEvents() {
  [
    explorerSearchInput,
    explorerDateFromInput,
    explorerDateToInput,
  ].forEach((control) => control?.addEventListener('input', renderExplorer));

  [
    explorerLocationSelect,
    explorerElevationSelect,
    explorerDistanceSelect,
    explorerMonthSelect,
    explorerPriceMaxSelect,
    explorerRegistrationStatusSelect,
    explorerDurationMaxSelect,
    explorerSortSelect,
    explorerGpxOnlyInput,
  ].forEach((control) => control?.addEventListener('change', renderExplorer));

  explorerResetButton?.addEventListener('click', resetExplorerFilters);
  explorerResultsEl?.addEventListener('click', handleRaceListAction);
  favoritesResultsEl?.addEventListener('click', handleRaceListAction);
  comparisonEl?.addEventListener('click', (event) => {
    const favoriteButton = event.target.closest?.('[data-favorite-source-id]');
    if (favoriteButton) toggleFavorite(favoriteButton.dataset.favoriteSourceId);
  });
}

async function fetchJson(url) {
  const response = await fetch(url);
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.error ?? `HTTP ${response.status}`);
  }
  return response.json();
}

async function loadGpxForRace(race) {
  if (race?.gpx?.status !== 'available') return null;
  if (state.gpxCache.has(race.id)) return state.gpxCache.get(race.id);

  try {
    const payload = await fetchJson(`/api/races/${race.id}/gpx`);
    state.gpxCache.set(race.id, payload);
    return payload;
  } catch {
    state.gpxCache.set(race.id, null);
    return null;
  }
}

async function compareSelectedRaces() {
  const raceA = raceASelect.value;
  const raceB = raceBSelect.value;

  if (!raceA || !raceB) return;
  if (raceA === raceB) {
    setStatus('Sélectionne deux courses différentes.');
    destroyComparisonMaps();
    comparisonEl.innerHTML = '';
    return;
  }

  setStatus('Calcul des estimations...');
  comparisonEl.classList.toggle('is-swapping', state.isSwapping);

  try {
    const comparison = await fetchJson(`/api/compare?raceA=${raceA}&raceB=${raceB}`);
    state.currentComparison = comparison;

    const [gpxA, gpxB] = await Promise.all([
      loadGpxForRace(comparison.raceA),
      loadGpxForRace(comparison.raceB),
    ]);

    destroyComparisonMaps();
    comparisonEl.innerHTML =
      raceCardTemplate(comparison.raceA, 'a', gpxA) +
      raceCardTemplate(comparison.raceB, 'b', gpxB);
    void renderComparisonMaps([
      { race: comparison.raceA, variant: 'a', gpxData: gpxA },
      { race: comparison.raceB, variant: 'b', gpxData: gpxB },
    ]);
    setStatus('');
  } catch (error) {
    destroyComparisonMaps();
    comparisonEl.innerHTML = '';
    setStatus(error.message);
  } finally {
    state.isSwapping = false;
    comparisonEl.classList.remove('is-swapping');
  }
}

function swapRaces() {
  if (!raceASelect.value || !raceBSelect.value) return;

  const previousA = raceASelect.value;
  raceASelect.value = raceBSelect.value;
  raceBSelect.value = previousA;
  state.isSwapping = true;
  compareSelectedRaces();
}

async function shareComparison() {
  const url = new URL(window.location.href);
  url.searchParams.set('raceA', raceASelect.value);
  url.searchParams.set('raceB', raceBSelect.value);
  url.hash = 'compare';

  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(url.href);
    showToast('Lien de comparaison copié.');
  } else {
    showToast('Lien prêt dans la barre d’adresse.');
  }
}

function exportComparison() {
  if (!state.currentComparison) {
    showToast('Aucune comparaison à exporter.');
    return;
  }

  const rows = [
    ['Course', 'Distance', 'D+', 'Km-effort', 'Verticalité', 'Temps limite', 'Difficulté physique V1', 'Pression V0'],
    [
      'A',
      state.currentComparison.raceA.distanceKm,
      state.currentComparison.raceA.elevationGainM,
      state.currentComparison.raceA.kmEffort,
      verticalityLabel(state.currentComparison.raceA.verticalityLevel),
      formatDuration(state.currentComparison.raceA.timeLimitMinutes),
      formatScore(difficultyScoreValue(state.currentComparison.raceA)),
      formatScore(state.currentComparison.raceA.barrierPressureScoreV0),
    ],
    [
      'B',
      state.currentComparison.raceB.distanceKm,
      state.currentComparison.raceB.elevationGainM,
      state.currentComparison.raceB.kmEffort,
      verticalityLabel(state.currentComparison.raceB.verticalityLevel),
      formatDuration(state.currentComparison.raceB.timeLimitMinutes),
      formatScore(difficultyScoreValue(state.currentComparison.raceB)),
      formatScore(state.currentComparison.raceB.barrierPressureScoreV0),
    ],
  ];
  const csv = rows.map((row) => row.map((value) => `"${String(value ?? '').replaceAll('"', '""')}"`).join(',')).join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = 'trailcompare-comparaison.csv';
  link.click();
  URL.revokeObjectURL(url);
  showToast('Export CSV généré.');
}

function applyUrlSelection(races) {
  const params = new URLSearchParams(window.location.search);
  const raceA = Number(params.get('raceA'));
  const raceB = Number(params.get('raceB'));
  const hasRaceA = races.some((race) => race.id === raceA);
  const hasRaceB = races.some((race) => race.id === raceB);
  const ntmf115 = races.find((race) => race.name.includes('Nord Trail Monts de Flandres - 115 km'));
  const ecotrail50 = races.find((race) => race.name.includes('EcoTrail Paris - 50 km Automne'));

  return {
    raceA: hasRaceA ? raceA : ntmf115?.id ?? races[0]?.id,
    raceB: hasRaceB ? raceB : ecotrail50?.id ?? races.find((race) => race.id !== races[0]?.id)?.id,
  };
}

function getCourseSlugFromPath() {
  let pathname = window.location.pathname;
  if (!pathname) {
    try {
      pathname = new URL(window.location.href).pathname;
    } catch {
      pathname = '/';
    }
  }
  const match = String(pathname).match(/^\/courses\/([a-z0-9]+(?:-[a-z0-9]+)*)\/?$/);
  return match?.[1] ?? null;
}

function officialMetricTemplate(label, value, { calculated = false } = {}) {
  if (value === null || value === undefined || value === 'Non disponible') return '';
  return `
    <div class="course-summary-metric ${calculated ? 'is-calculated' : 'is-official'}">
      <span>${escapeHtml(label)}</span>
      <strong>${escapeHtml(value)}</strong>
      <small>${calculated ? 'Estimation TrailCompare' : 'Donnée officielle'}</small>
    </div>
  `;
}

function courseSectionTemplate(id, title, content, className = '') {
  if (!content) return '';
  return `
    <section id="${escapeHtml(id)}" class="course-section ${escapeHtml(className)}">
      <h2>${escapeHtml(title)}</h2>
      ${content}
    </section>
  `;
}

function characteristicTemplate(label, value) {
  if (value === null || value === undefined || value === '') return '';
  return `<div class="course-characteristic"><dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value)}</dd></div>`;
}

function yesNo(value) {
  if (value === true) return 'Oui';
  if (value === false) return 'Non';
  return null;
}

function translatedDescriptionTemplate(race) {
  const description = race.description ?? {};
  const hasValidatedFrench = Boolean(description.french && description.frenchValidated);
  const primary = hasValidatedFrench ? description.french : description.original;
  if (!primary) return '';
  const originalIsDifferent = hasValidatedFrench && description.original && description.original !== description.french;
  return `
    <div class="course-description">
      ${hasValidatedFrench ? '<span class="translation-badge">Traduction française validée</span>' : ''}
      <p>${escapeHtml(primary)}</p>
      ${originalIsDifferent ? `<details><summary>Voir la description originale${description.originalLanguage ? ` (${escapeHtml(description.originalLanguage)})` : ''}</summary><p lang="${escapeHtml(description.originalLanguage || 'en')}">${escapeHtml(description.original)}</p></details>` : ''}
    </div>
  `;
}

function characteristicsTemplate(race) {
  const content = [
    characteristicTemplate('Type de course', race.raceType),
    characteristicTemplate('Terrain', race.terrainType),
    characteristicTemplate('Départ nocturne', yesNo(race.nightStart)),
    characteristicTemplate('Bâtons autorisés', yesNo(race.polesAllowed)),
    characteristicTemplate('Départ', race.startLocation),
    characteristicTemplate('Arrivée', race.finishLocation),
  ].filter(Boolean).join('');
  return content ? `<dl class="course-characteristics">${content}</dl>` : '';
}

function courseMapSectionTemplate(race) {
  if (race.gpx?.status !== 'available') return '';
  return `
    <div class="course-map-shell tiles-loading">
      <div id="course-map-canvas" class="course-map-canvas" role="img" aria-label="Carte interactive du parcours GPX"></div>
      <p class="map-fallback-note">
        <span>Fond © contributeurs OpenStreetMap.</span>
        <span class="map-tile-status" data-map-tile-status role="status" aria-live="polite"></span>
      </p>
    </div>
    <div id="course-elevation-profile" class="course-profile" aria-live="polite"></div>
  `;
}

function checkpointRowsTemplate(checkpoints) {
  return checkpoints.map((checkpoint) => `
    <tr>
      <th scope="row">${escapeHtml(checkpoint.name || 'Point de contrôle')}</th>
      <td>${escapeHtml(formatKm(checkpoint.distanceKm))}</td>
      <td>${escapeHtml(checkpoint.elevationM === null ? '—' : formatAltitude(checkpoint.elevationM))}</td>
      <td>${escapeHtml(checkpoint.cutoffDateTime ? formatDateTime(checkpoint.cutoffDateTime) : formatDuration(checkpoint.elapsedLimitMinutes))}</td>
      <td>${checkpoint.personalAssistanceAllowed === true ? 'Oui' : checkpoint.personalAssistanceAllowed === false ? 'Non' : '—'}</td>
    </tr>
  `).join('');
}

function checkpointsSectionTemplate(race) {
  if (!race.checkpoints?.length) return '';
  return `
    <div class="course-table-wrap">
      <table class="course-table">
        <caption>${race.checkpoints.length} barrières ou points de contrôle officiels</caption>
        <thead><tr><th scope="col">Point</th><th scope="col">Distance</th><th scope="col">Altitude</th><th scope="col">Limite</th><th scope="col">Assistance</th></tr></thead>
        <tbody>${checkpointRowsTemplate(race.checkpoints)}</tbody>
      </table>
    </div>
  `;
}

function aidServices(station) {
  return [
    station.water && 'Eau',
    station.sportsDrink && 'Boisson énergétique',
    station.solidFood && 'Solide',
    station.hotFood && 'Repas chaud',
    station.dropBag && 'Sac de délestage',
    station.crewAccess && 'Assistance',
    station.medical && 'Médical',
    ...(station.services ?? []),
  ].filter(Boolean);
}

function aidStationsSectionTemplate(race) {
  if (!race.aidStations?.length) return '';
  const rows = race.aidStations.map((station) => `
    <tr>
      <th scope="row">${escapeHtml(station.name || 'Ravitaillement')}</th>
      <td>${escapeHtml(formatKm(station.distanceKm))}</td>
      <td>${escapeHtml(station.elevationM === null ? '—' : formatAltitude(station.elevationM))}</td>
      <td>${escapeHtml(aidServices(station).join(', ') || 'Services non précisés')}</td>
      <td data-course-position-for="aid" data-distance-km="${escapeHtml(station.distanceKm ?? '')}">${station.latitude !== null && station.longitude !== null ? 'Officielle' : 'À projeter sur le GPX'}</td>
    </tr>
  `).join('');
  return `
    <div class="course-table-wrap">
      <table class="course-table">
        <caption>${race.aidStations.length} ravitaillements recensés</caption>
        <thead><tr><th scope="col">Point</th><th scope="col">Distance</th><th scope="col">Altitude</th><th scope="col">Services</th><th scope="col">Position carte</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
  `;
}

function registrationSectionTemplate(race) {
  const registration = race.registration ?? {};
  const items = [
    characteristicTemplate('Prix', registration.priceEur === null ? null : formatPrice(registration.priceEur)),
    characteristicTemplate('Statut', normalizeRegistrationStatus(registration.status) === 'unknown' ? null : registrationStatusLabel(registration.status)),
    characteristicTemplate('Ouverture', registration.registrationOpenDate ? formatDate(registration.registrationOpenDate) : null),
    characteristicTemplate('Clôture', registration.registrationCloseDate ? formatDate(registration.registrationCloseDate) : null),
    characteristicTemplate('Loterie', yesNo(registration.lottery)),
    characteristicTemplate('Capacité', numericValue(registration.maxParticipants) === null ? null : `${formatNumber(registration.maxParticipants, 0)} participants`),
    characteristicTemplate('Qualifications', registration.qualificationRequired),
  ].filter(Boolean).join('');
  const action = registrationLinkTemplate(race, 'course-inline-action');
  return items || action ? `<dl class="course-characteristics">${items}</dl>${action}` : '';
}

function programTemplate(program) {
  if (!program?.length) return '';
  return `<ol class="course-timeline">${program.map((item) => `
    <li>
      <time>${escapeHtml([item.date && formatDate(item.date), item.time].filter(Boolean).join(' · ') || 'Horaire à confirmer')}</time>
      <strong>${escapeHtml(item.label || item.type || 'Programme')}</strong>
      ${item.location ? `<span>${escapeHtml(item.location)}</span>` : ''}
      ${item.details ? `<p>${escapeHtml(item.details)}</p>` : ''}
    </li>
  `).join('')}</ol>`;
}

function logisticsTemplate(logistics) {
  if (!logistics) return '';
  const items = [
    characteristicTemplate('Accès', logistics.access),
    characteristicTemplate('Navettes', logistics.shuttles),
    characteristicTemplate('Transports', logistics.transport),
    characteristicTemplate('Parking', logistics.parking),
    characteristicTemplate('Consignes', logistics.bagDrop),
  ].filter(Boolean).join('');
  const contacts = logistics.contacts?.length
    ? `<ul class="course-list">${logistics.contacts.map((contact) => {
        const url = safeHttpUrl(contact.url);
        const label = [contact.label, contact.value].filter(Boolean).join(' — ');
        return `<li>${url ? `<a href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(label || url)}</a>` : escapeHtml(label)}</li>`;
      }).join('')}</ul>`
    : '';
  return items || contacts ? `<dl class="course-characteristics">${items}</dl>${contacts}` : '';
}

function rulesTemplate(race) {
  const rules = race.rules ?? {};
  const items = [
    characteristicTemplate('Assistance personnelle', yesNo(rules.personalAssistanceAllowed)),
    characteristicTemplate('Accompagnateurs / pacers', yesNo(rules.pacersAllowed ?? rules.companionsAllowed)),
    characteristicTemplate('Sac de délestage', yesNo(rules.dropBagAllowed)),
    characteristicTemplate('Eau obligatoire', rules.minimumWaterLiters === null ? null : `${formatNumber(rules.minimumWaterLiters)} L minimum`),
  ].filter(Boolean).join('');
  const equipment = race.mandatoryEquipment?.length
    ? `<h3>Matériel obligatoire</h3><ul class="course-list equipment-list">${race.mandatoryEquipment.map((item) => `<li><strong>${escapeHtml(item.name || item.details)}</strong>${item.details && item.name ? `<span>${escapeHtml(item.details)}</span>` : ''}</li>`).join('')}</ul>`
    : '';
  return items || equipment || rules.details
    ? `<dl class="course-characteristics">${items}</dl>${rules.details ? `<p>${escapeHtml(rules.details)}</p>` : ''}${equipment}`
    : '';
}

const sourceTypeLabels = {
  'official-race-page': 'Page officielle de la course',
  'official-rules': 'Règlement officiel',
  'official-roadbook': 'Roadbook officiel',
  'official-gpx': 'Trace GPX officielle',
  'official-map-platform': 'Plateforme cartographique officielle',
  'official-registration': 'Inscription officielle',
  'official-program': 'Programme officiel',
  'official-logistics': 'Logistique officielle',
  'official-transport': 'Transport officiel',
};

function qualitySourcesTemplate(race) {
  const safeSources = (race.sources ?? []).filter((source) => safeHttpUrl(source.url));
  const sources = safeSources.map((source) => {
    const url = safeHttpUrl(source.url);
    if (!url) return '';
    return `<li><a href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(sourceTypeLabels[source.type] || source.type || 'Source officielle')}</a>${source.retrievedAt ? `<time datetime="${escapeHtml(source.retrievedAt)}">Vérifiée le ${escapeHtml(formatDate(String(source.retrievedAt).slice(0, 10)))}</time>` : ''}</li>`;
  }).filter(Boolean).join('');
  const warnings = (race.quality?.warnings ?? []).map((warning) => `<li>${escapeHtml(warning)}</li>`).join('');
  const missing = (race.missingOfficialInformation ?? race.quality?.missingFields ?? []).map((field) => `<li>${escapeHtml(field)}</li>`).join('');
  const availability = availabilityEntries(race.dataAvailability).map(({ path, record }) => {
    const sourceUrl = safeHttpUrl(record.sourceUrl);
    const source = sourceUrl ? ` <a href="${escapeHtml(sourceUrl)}" target="_blank" rel="noopener noreferrer">source</a>` : '';
    const reason = record.reason ? ` — ${escapeHtml(record.reason)}` : '';
    return `<li><strong>${escapeHtml(availabilityFieldLabel(path))}</strong> : ${escapeHtml(availabilityStatusLabel(record.status))}${reason}${source}</li>`;
  }).join('');
  return `
    <div class="quality-grid">
      <div><span>Complétude</span><strong>${race.quality?.status === 'complete' ? 'Complète' : race.quality?.status === 'invalid' ? 'À contrôler' : 'Partielle'}</strong></div>
      <div><span>Sport</span><strong>${completenessLabel(race.quality?.sportCompleteness)}</strong></div>
      <div><span>Logistique</span><strong>${completenessLabel(race.quality?.logisticsCompleteness)}</strong></div>
      <div><span>Inscription</span><strong>${completenessLabel(race.quality?.registrationCompleteness)}</strong></div>
      <div><span>Dernière vérification</span><strong>${escapeHtml(race.verifiedAt ? formatDate(String(race.verifiedAt).slice(0, 10)) : 'Non renseignée')}</strong></div>
      <div><span>Provenance</span><strong>${safeSources.length} source${safeSources.length > 1 ? 's' : ''} officielle${safeSources.length > 1 ? 's' : ''}</strong></div>
    </div>
    ${warnings ? `<div class="quality-alert"><h3>Avertissements</h3><ul>${warnings}</ul></div>` : ''}
    ${availability ? `<div class="quality-alert is-muted"><h3>Disponibilité des données</h3><ul>${availability}</ul></div>` : ''}
    ${missing ? `<div class="quality-alert is-muted"><h3>Informations officielles manquantes</h3><ul>${missing}</ul></div>` : ''}
    ${sources ? `<h3>Sources officielles</h3><ul class="source-list">${sources}</ul>` : '<p>Aucune source officielle exploitable n’est publiée pour cette fiche.</p>'}
  `;
}

function completenessLabel(status) {
  return status === 'complete' ? 'Complète' : status === 'partial' ? 'Partielle' : 'À contrôler';
}

function availabilityEntries(value, prefix = '') {
  if (!value || typeof value !== 'object') return [];
  const output = [];
  for (const [key, item] of Object.entries(value)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (item?.status) output.push({ path, record: item });
    else output.push(...availabilityEntries(item, path));
  }
  return output;
}

function availabilityStatusLabel(status) {
  return ({
    known: 'connue',
    known_none: 'absence confirmée',
    not_applicable: 'sans objet',
    not_published: 'pas encore publiée',
    extraction_error: 'source disponible, extraction en échec',
    unknown: 'inconnue',
  })[status] ?? status ?? 'inconnue';
}

function availabilityFieldLabel(path) {
  return ({
    date: 'Date',
    elevationGainM: 'Dénivelé positif',
    maxDurationMinutes: 'Temps maximum',
    finishCutoffTime: 'Heure limite d’arrivée',
    checkpoints: 'Barrières horaires',
    aidStations: 'Ravitaillements',
    gpx: 'GPX',
    'registration.priceEur': 'Prix',
  })[path] ?? path;
}

function formatDateTime(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value ?? '—');
  return new Intl.DateTimeFormat('fr-FR', { dateStyle: 'short', timeStyle: 'short' }).format(date);
}

function courseDetailTemplate(race) {
  const illustrationUrl = safeHttpUrl(race.illustration?.url);
  const description = translatedDescriptionTemplate(race);
  const characteristics = characteristicsTemplate(race);
  const sections = [
    { id: 'presentation', title: 'Description et caractéristiques', content: `${description}${characteristics}` },
    { id: 'parcours', title: 'Carte et profil altimétrique', content: courseMapSectionTemplate(race) },
    { id: 'barrieres', title: 'Barrières horaires', content: checkpointsSectionTemplate(race) },
    { id: 'ravitaillements', title: 'Ravitaillements', content: aidStationsSectionTemplate(race) },
    { id: 'inscription', title: 'Inscription et conditions', content: registrationSectionTemplate(race) },
    { id: 'programme', title: 'Programme', content: programTemplate(race.program) },
    { id: 'logistique', title: 'Logistique', content: logisticsTemplate(race.logistics) },
    { id: 'reglement', title: 'Règlement et matériel', content: rulesTemplate(race) },
    { id: 'qualite', title: 'Qualité des données et sources', content: qualitySourcesTemplate(race) },
  ].filter((section) => section.content);
  const nav = sections.map((section) => `<a href="#${escapeHtml(section.id)}">${escapeHtml(section.title)}</a>`).join('');
  const actions = [registrationLinkTemplate(race), gpxDownloadLinkTemplate(race)].filter(Boolean).join('');
  return `
    <a class="course-back" href="/#explorer" data-course-back>← Retour aux courses</a>
    <article class="course-detail">
      <header class="course-hero ${illustrationUrl ? 'has-image' : 'is-empty'}">
        ${illustrationUrl ? `<img src="${escapeHtml(illustrationUrl)}" alt="${escapeHtml(race.illustration?.alt || race.name)}" decoding="async" referrerpolicy="no-referrer">` : ''}
        <div class="course-hero-overlay"></div>
        <div class="course-hero-content">
          <span class="course-event">${escapeHtml(race.eventName)} · ${escapeHtml(race.edition)}</span>
          <h1>${escapeHtml(race.raceName)}</h1>
          <p>${escapeHtml(formatRaceDateTime(race))}${raceLocationLabel(race) ? ` · ${escapeHtml(raceLocationLabel(race))}` : ''}</p>
          <div class="course-hero-actions">
            ${favoriteButtonTemplate(race)}
            <a class="button button-secondary button-small" href="/?raceA=${escapeHtml(race.id)}#compare">Comparer</a>
            <a class="button button-primary button-small" href="/profil?course=${escapeHtml(race.slug)}">Comparer avec mon profil</a>
            <button class="button button-secondary button-small" type="button" data-course-share>Partager</button>
            ${actions}
          </div>
        </div>
      </header>

      <div class="course-summary" aria-label="Résumé de la course">
        ${officialMetricTemplate('Distance', formatKm(race.distanceKm))}
        ${officialMetricTemplate('D+', formatElevation(race.elevationGainM))}
        ${officialMetricTemplate('D-', numericValue(race.elevationLossM) === null ? null : `${formatNumber(race.elevationLossM, 0)} D-`)}
        ${officialMetricTemplate('Temps limite', formatRaceTimeLimit(race))}
        ${officialMetricTemplate('Km-effort', race.kmEffort === null ? null : `${formatNumber(race.kmEffort)} km`, { calculated: true })}
        ${officialMetricTemplate('Difficulté', difficultyScoreValue(race) === null ? null : formatScore(difficultyScoreValue(race)), { calculated: true })}
        ${officialMetricTemplate('Verticalité', race.verticalityLevel ? verticalityLabel(race.verticalityLevel) : null, { calculated: true })}
      </div>

      <nav class="course-toc" aria-label="Sommaire de la fiche">${nav}</nav>
      <div class="course-body">${sections.map((section) => courseSectionTemplate(section.id, section.title, section.content)).join('')}</div>
    </article>
  `;
}

function elevationProfileTemplate(gpxData) {
  const raw = Array.isArray(gpxData?.elevationProfile) && gpxData.elevationProfile.length
    ? gpxData.elevationProfile.map((point) => ({ x: point.distanceKm, y: numericValue(point.elevationM) }))
    : (gpxData?.points ?? []).map((point, index) => ({ x: point.distanceKm ?? index, y: numericValue(point.ele) }));
  const points = simplifyPoints(raw.filter((point) => point.y !== null), 180);
  if (gpxElevationQualityStatus(gpxData) === 'inconsistent') return `<p class="quality-alert">${escapeHtml(gpxElevationQualityMessage('inconsistent'))}</p>`;
  if (points.length < 2) return '';
  const line = createPolyline(points, 900, 220, 24);
  const area = createAreaPath(points, 900, 220, 24);
  return `
    <h3>Profil altimétrique</h3>
    <svg class="course-profile-svg" viewBox="0 0 900 220" role="img" aria-label="Profil altimétrique du parcours">
      <path class="profile-area" d="${area}"></path><polyline class="profile-line" points="${line}"></polyline>
    </svg>
    <div class="profile-axis">${axisTicksTemplate(state.currentCourse?.distanceKm)}</div>
    ${gpxElevationQualityMessage(gpxElevationQualityStatus(gpxData)) ? `<p class="map-fallback-note">${escapeHtml(gpxElevationQualityMessage(gpxElevationQualityStatus(gpxData)))}</p>` : ''}
  `;
}

function projectedPosition(item, points) {
  const latitude = numericValue(item?.latitude);
  const longitude = numericValue(item?.longitude);
  if (latitude !== null && longitude !== null) return { lat: latitude, lon: longitude, approximate: false };
  const distance = numericValue(item?.distanceKm);
  if (distance === null) return null;
  const candidates = points.filter((point) => numericValue(point.lat) !== null && numericValue(point.lon) !== null && numericValue(point.distanceKm) !== null);
  if (!candidates.length) return null;
  const point = candidates.reduce((nearest, candidate) => Math.abs(Number(candidate.distanceKm) - distance) < Math.abs(Number(nearest.distanceKm) - distance) ? candidate : nearest);
  return { lat: Number(point.lat), lon: Number(point.lon), approximate: true };
}

function updateProjectedPositionLabels(race, points) {
  const labels = courseContentEl?.querySelectorAll?.('[data-course-position-for]') ?? [];
  labels.forEach((label) => {
    const distanceKm = numericValue(label.dataset.distanceKm);
    const station = race.aidStations?.find((candidate) => numericValue(candidate.distanceKm) === distanceKm);
    const position = projectedPosition(station, points);
    label.textContent = position ? (position.approximate ? 'Position approximative' : 'Officielle') : 'Non positionnée';
    label.classList.toggle('is-approximate', Boolean(position?.approximate));
  });
}

function neutralRouteFallback(segments) {
  const normalized = normalizeRouteSegments(segments).map((segment) => simplifyPoints(segment, 220).map((point) => ({ x: point.lon, y: point.lat })));
  const lines = createRoutePolylines(normalized, 900, 420, 28);
  return lines.length ? `<svg class="neutral-route-map" viewBox="0 0 900 420" role="img" aria-label="Trace GPX sur fond neutre">${lines.map((line) => `<polyline points="${line}"></polyline>`).join('')}</svg>` : '<p>Trace GPX indisponible.</p>';
}

function loadLeaflet() {
  if (window.L) return Promise.resolve(window.L);
  if (!document.head?.appendChild) return Promise.resolve(null);
  if (leafletLoadPromise) return leafletLoadPromise;
  leafletLoadPromise = new Promise((resolve) => {
    const script = document.createElement('script');
    script.src = '/vendor/leaflet-1.9.4/leaflet.js';
    script.onload = () => resolve(window.L ?? null);
    script.onerror = () => {
      leafletLoadPromise = null;
      resolve(null);
    };
    document.head.appendChild(script);
  });
  return leafletLoadPromise;
}

function destroyComparisonMaps() {
  state.comparisonMaps.forEach(({ map, cleanup }) => {
    cleanup?.();
    map?.remove?.();
  });
  state.comparisonMaps = [];
}

function destroyCourseMap() {
  state.courseMapCleanup?.();
  state.courseMapCleanup = null;
  if (state.courseMap) {
    state.courseMap.remove();
    state.courseMap = null;
  }
}

function createTileLoadTracker(shell, statusElement) {
  let loadedTiles = 0;
  let failedTiles = 0;

  return {
    tileLoaded() {
      loadedTiles += 1;
    },
    tileFailed() {
      failedTiles += 1;
      shell?.classList.add('has-tile-errors');
    },
    settled() {
      shell?.classList.remove('tiles-loading');
      if (loadedTiles === 0 && failedTiles > 0) {
        shell?.classList.add('is-tile-fallback');
        if (statusElement) statusElement.textContent = 'Fond cartographique indisponible : trace affichée sur fond neutre.';
        return 'fallback';
      }

      shell?.classList.remove('is-tile-fallback');
      if (statusElement) {
        statusElement.textContent = failedTiles > 0
          ? 'Certaines tuiles sont indisponibles; les tuiles chargées restent affichées.'
          : '';
      }
      return failedTiles > 0 ? 'partial' : 'complete';
    },
    counts() {
      return { loadedTiles, failedTiles };
    },
  };
}

function observeCourseMapSize(canvas, map) {
  let frameId = null;
  const scheduleInvalidate = () => {
    if (frameId !== null) return;
    const run = () => {
      frameId = null;
      if (document.body?.contains?.(canvas)) map.invalidateSize({ pan: false });
    };
    if (window.requestAnimationFrame) {
      frameId = window.requestAnimationFrame(run);
    } else {
      frameId = window.setTimeout(run, 0);
    }
  };

  let observer = null;
  if (window.ResizeObserver) {
    observer = new window.ResizeObserver(scheduleInvalidate);
    observer.observe(canvas);
  } else {
    window.addEventListener?.('resize', scheduleInvalidate);
  }
  scheduleInvalidate();

  return () => {
    observer?.disconnect();
    if (!observer) window.removeEventListener?.('resize', scheduleInvalidate);
    if (frameId !== null) {
      if (window.cancelAnimationFrame) window.cancelAnimationFrame(frameId);
      else window.clearTimeout?.(frameId);
    }
  };
}

async function renderComparisonMap(race, variant, gpxData) {
  const canvas = document.querySelector(`#comparison-map-${variant}`);
  if (!canvas) return;
  const segments = normalizeRouteSegments(gpxData?.segments)
    .map((segment) => segment
      .map((point) => [Number(point.lat), Number(point.lon)])
      .filter(([lat, lon]) => Number.isFinite(lat) && Number.isFinite(lon)))
    .filter((segment) => segment.length > 1);
  if (!segments.length) return;

  const L = await loadLeaflet();
  if (!L || !document.body?.contains?.(canvas) || document.querySelector(`#comparison-map-${variant}`) !== canvas) return;

  const shell = canvas.closest?.('.map-panel');
  shell?.classList.add('tiles-loading');
  canvas.innerHTML = '';
  const map = L.map(canvas, {
    attributionControl: true,
    scrollWheelZoom: false,
    zoomControl: false,
  });
  const tileTracker = createTileLoadTracker(shell, null);
  const tileLayer = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
  });
  tileLayer.on('tileload', () => tileTracker.tileLoaded());
  tileLayer.on('tileerror', () => tileTracker.tileFailed());
  tileLayer.on('load', () => tileTracker.settled());
  tileLayer.addTo(map);

  const route = L.polyline(segments, {
    color: variant === 'b' ? '#e56b20' : '#196c50',
    opacity: 0.95,
    weight: 4,
  }).addTo(map);
  map.fitBounds(route.getBounds(), { padding: [18, 18] });
  const cleanup = observeCourseMapSize(canvas, map);
  state.comparisonMaps.push({ map, cleanup, raceId: race.id, variant });
}

async function renderComparisonMaps(items) {
  await Promise.all(items.map((item) => renderComparisonMap(item.race, item.variant, item.gpxData)));
}

async function renderInteractiveCourseMap(race, gpxData) {
  const canvas = document.querySelector('#course-map-canvas');
  const profile = document.querySelector('#course-elevation-profile');
  if (profile) profile.innerHTML = elevationProfileTemplate(gpxData);
  if (!canvas) return;
  const segments = normalizeRouteSegments(gpxData?.segments).filter((segment) => segment.length > 1);
  const points = segments.flat();
  updateProjectedPositionLabels(race, points);
  canvas.innerHTML = neutralRouteFallback(segments);
  const L = await loadLeaflet();
  if (!L || !segments.length || !document.body?.contains?.(canvas)) return;

  destroyCourseMap();
  canvas.innerHTML = '';
  const map = L.map(canvas, { scrollWheelZoom: false });
  state.courseMap = map;
  const shell = canvas.closest('.course-map-shell');
  const tileStatus = shell?.querySelector?.('[data-map-tile-status]') ?? document.querySelector('[data-map-tile-status]');
  const tileTracker = createTileLoadTracker(shell, tileStatus);
  const tileLayer = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
  });
  tileLayer.on('tileload', () => tileTracker.tileLoaded());
  tileLayer.on('tileerror', () => tileTracker.tileFailed());
  tileLayer.on('load', () => tileTracker.settled());
  tileLayer.addTo(map);
  const latLngSegments = segments.map((segment) => segment.map((point) => [Number(point.lat), Number(point.lon)]).filter(([lat, lon]) => Number.isFinite(lat) && Number.isFinite(lon))).filter((segment) => segment.length > 1);
  const route = L.polyline(latLngSegments, { color: '#196c50', weight: 5, opacity: 0.95 }).addTo(map);
  map.fitBounds(route.getBounds(), { padding: [24, 24] });
  state.courseMapCleanup = observeCourseMapSize(canvas, map);

  const markerItems = [
    ...(race.checkpoints ?? []).map((item) => ({ ...item, markerType: 'Barrière' })),
    ...(race.aidStations ?? []).map((item) => ({ ...item, markerType: 'Ravitaillement' })),
  ];
  markerItems.forEach((item) => {
    const position = projectedPosition(item, points);
    if (!position) return;
    const marker = L.circleMarker([position.lat, position.lon], {
      radius: item.markerType === 'Barrière' ? 6 : 5,
      color: position.approximate ? '#9b6b16' : '#174f3b',
      fillColor: position.approximate ? '#f2b84b' : '#2f9e73',
      fillOpacity: 0.9,
      weight: 2,
    }).addTo(map);
    marker.bindPopup(`<strong>${escapeHtml(item.name || item.markerType)}</strong><br>${escapeHtml(item.markerType)}${position.approximate ? '<br>Position approximative' : ''}`);
  });
}

async function shareCourse() {
  const url = window.location.href.split('#')[0];
  if (navigator.share) {
    await navigator.share({ title: document.title, url });
    return;
  }
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(url);
    showToast('Lien de la fiche copié.');
  } else {
    showToast('Lien prêt dans la barre d’adresse.');
  }
}

function bindCourseActions() {
  courseContentEl?.addEventListener('click', (event) => {
    const favoriteButton = event.target.closest?.('[data-favorite-source-id]');
    if (favoriteButton) {
      toggleFavorite(favoriteButton.dataset.favoriteSourceId);
      return;
    }
    if (event.target.closest?.('[data-course-share]')) {
      shareCourse().catch(() => showToast('Partage indisponible.'));
      return;
    }
    const back = event.target.closest?.('[data-course-back]');
    if (back && window.history?.length > 1 && document.referrer) {
      event.preventDefault();
      window.history.back();
    }
  });
}

const profileStatusLabels = {
  [STATUS.VALIDATED]: 'Validé',
  [STATUS.CONSOLIDATE]: 'À consolider',
  [STATUS.IMPORTANT_GAP]: 'Écart important',
  [STATUS.CRITICAL]: 'Critique',
  [STATUS.INSUFFICIENT]: 'Données insuffisantes',
};

const verdictLabels = {
  accessible_now: 'Accessible actuellement',
  ambitious_coherent: 'Ambitieux mais cohérent',
  preparation_insufficient: 'Préparation encore insuffisante',
  insufficient_data: 'Données insuffisantes',
};

const confidenceLevelLabels = { high: 'Confiance élevée', medium: 'Confiance moyenne', low: 'Confiance faible' };

function inputValue(value) {
  return value === null || value === undefined ? '' : escapeHtml(value);
}

function profileNumberField(name, label, unit, value, { step = 'any', min = 0 } = {}) {
  return `
    <label class="profile-field">
      <span>${escapeHtml(label)}</span>
      <span class="input-with-unit"><input name="${escapeHtml(name)}" type="number" min="${min}" step="${step}" value="${inputValue(value)}"><small>${escapeHtml(unit)}</small></span>
    </label>`;
}

function profileDurationField(name, label, value) {
  return `
    <label class="profile-field">
      <span>${escapeHtml(label)}</span>
      <input name="${escapeHtml(name)}" type="text" inputmode="numeric" placeholder="h:mm" value="${inputValue(formatDurationInput(value))}">
      <small>Format h:mm, par exemple 2:30</small>
    </label>`;
}

function performanceRowTemplate(reference = {}, index = 0) {
  const selectedType = reference.type || 'trail';
  const fixedDistance = { '5k': 5, '10k': 10, half_marathon: 21.0975, marathon: 42.195 }[selectedType];
  const distanceValue = fixedDistance ?? reference.distanceKm;
  const durationValue = selectedType === 'six_minute_test' ? 6 : reference.durationMinutes;
  return `
    <fieldset class="performance-row" data-performance-row>
      <legend>Référence ${index + 1}</legend>
      <input type="hidden" data-performance-field="id" value="${inputValue(reference.id || `reference-${Date.now()}-${index}`)}">
      <label class="profile-field"><span>Type</span>
        <select data-performance-field="type">
          ${[
            ['5k', '5 km'], ['10k', '10 km'], ['half_marathon', 'Semi-marathon'], ['marathon', 'Marathon'], ['six_minute_test', 'Test de six minutes'], ['trail', 'Trail'],
          ].map(([value, label]) => `<option value="${value}" ${selectedType === value ? 'selected' : ''}>${label}</option>`).join('')}
        </select>
      </label>
      <label class="profile-field"><span>Distance</span><span class="input-with-unit"><input name="performance-distance" type="number" min="0" step="any" value="${inputValue(distanceValue)}" ${fixedDistance ? 'readonly' : ''}><small>km</small></span></label>
      <label class="profile-field"><span>Durée</span><input name="performance-duration" type="text" inputmode="numeric" placeholder="h:mm" value="${inputValue(formatDurationInput(durationValue))}" ${selectedType === 'six_minute_test' ? 'readonly' : ''}><small>Format h:mm, par exemple 2:30</small></label>
      <label class="profile-field" ${selectedType === 'trail' ? '' : 'hidden'}><span>D+</span><span class="input-with-unit"><input name="performance-elevation" type="number" min="0" step="1" value="${inputValue(reference.elevationGainM)}"><small>m</small></span></label>
      <label class="profile-field"><span>Date</span><input name="performance-date" type="date" value="${inputValue(reference.date)}"></label>
      <label class="profile-field performance-name"><span>Nom de la course <small>(facultatif)</small></span><input name="performance-name" type="text" maxlength="120" value="${inputValue(reference.name)}"></label>
      <button class="button button-secondary button-small remove-performance" type="button" data-remove-performance>Supprimer</button>
    </fieldset>`;
}

function profileFormTemplate(profile, { selectedRace = null } = {}) {
  const data = profile ?? emptyProfile();
  return `
    <header class="page-header profile-header">
      <div>
        <p class="eyebrow">PROFIL COUREUR</p>
        <h1>${profile ? 'Mettre à jour mon profil' : 'Créer mon profil coureur'}</h1>
        <p class="subtitle">Des repères simples pour confronter votre niveau actuel aux exigences réelles d’une course.</p>
      </div>
    </header>
    ${selectedRace ? `<div class="selected-profile-race"><span>Course conservée</span><strong>${escapeHtml(selectedRace.name)}</strong><small>${formatKm(selectedRace.distanceKm)} · ${formatElevation(selectedRace.elevationGainM)}</small></div>` : ''}
    <form id="runner-profile-form" class="runner-profile-form" novalidate>
      <div id="profile-errors" class="profile-errors" role="alert" tabindex="-1" hidden></div>
      <section class="profile-form-section">
        <div class="profile-section-heading"><span>01</span><div><h2>Entraînement récent</h2><p>Moyennes des quatre dernières semaines.</p></div></div>
        <div class="profile-field-grid">
          ${profileNumberField('weeklyDistanceKm', 'Distance hebdomadaire moyenne', 'km/sem', data.training.weeklyDistanceKm)}
          ${profileNumberField('weeklyElevationGainM', 'D+ hebdomadaire moyen', 'm/sem', data.training.weeklyElevationGainM, { step: 1 })}
          ${profileNumberField('weeklyHours', 'Temps moyen', 'h/sem', data.training.weeklyHours)}
          ${profileNumberField('weeklySessions', 'Nombre moyen de séances', 'séances/sem', data.training.weeklySessions, { step: 1 })}
          ${profileNumberField('longRunDistanceKm', 'Plus longue sortie récente', 'km', data.training.longRun.distanceKm)}
          ${profileDurationField('longRunDuration', 'Durée de cette sortie', data.training.longRun.durationMinutes)}
          ${profileNumberField('longRunElevationGainM', 'D+ de cette sortie', 'm', data.training.longRun.elevationGainM, { step: 1 })}
          <label class="profile-field"><span>Date de cette sortie</span><input name="longRunDate" type="date" value="${inputValue(data.training.longRun.date)}"></label>
        </div>
      </section>

      <section class="profile-form-section">
        <div class="profile-section-heading"><span>02</span><div><h2>Références de performance</h2><p>Facultatives. Un chrono route seul ne sert jamais à prédire un trail.</p></div></div>
        <div id="performance-list" class="performance-list">${data.performances.map(performanceRowTemplate).join('')}</div>
        <button id="add-performance" class="button button-secondary" type="button">Ajouter une référence</button>
      </section>

      <section class="profile-form-section">
        <div class="profile-section-heading"><span>03</span><div><h2>Expérience trail</h2><p>Choisissez des niveaux simples, sans fausse précision.</p></div></div>
        <div class="profile-field-grid">
          ${profileNumberField('longestCompletedDistanceKm', 'Plus longue distance terminée', 'km', data.experience.longestCompletedDistanceKm)}
          ${profileDurationField('longestEffortDuration', 'Plus longue durée d’effort', data.experience.longestEffortMinutes)}
          ${profileNumberField('maximumElevationGainM', 'Plus gros D+ réalisé', 'm', data.experience.maximumElevationGainM, { step: 1 })}
          ${experienceSelect('technicalLevel', 'Terrain technique', data.experience.technicalLevel, [['', 'Non renseigné'], ['beginner', 'Peu ou pas d’expérience'], ['comfortable', 'À l’aise régulièrement'], ['confirmed', 'Confirmé sur terrain exigeant']])}
          ${experienceSelect('nightExperience', 'Course nocturne', data.experience.nightExperience, [['', 'Non renseigné'], ['none', 'Aucune expérience'], ['some', 'Quelques expériences'], ['regular', 'Expérience régulière']])}
          ${experienceSelect('autonomyExperience', 'Autonomie', data.experience.autonomyExperience, [['', 'Non renseigné'], ['none', 'Aucune expérience'], ['some', 'Quelques expériences'], ['regular', 'Expérience régulière']])}
        </div>
      </section>

      <section class="profile-form-section">
        <div class="profile-section-heading"><span>04</span><div><h2>Objectif</h2><p>Ce choix ajuste prudemment les exigences, pas votre niveau.</p></div></div>
        <div class="goal-options" role="radiogroup" aria-label="Objectif">
          ${goalOption('finish_cutoffs', 'Terminer dans les délais', data.goal)}
          ${goalOption('finish_comfortably', 'Terminer confortablement', data.goal)}
          ${goalOption('performance', 'Rechercher une performance', data.goal)}
        </div>
      </section>

      <div class="profile-form-actions">
        <button class="button button-primary" type="submit">${selectedRace ? 'Enregistrer et comparer' : 'Enregistrer mon profil'}</button>
        ${profile ? '<button class="button button-secondary" type="button" data-cancel-profile>Annuler</button>' : ''}
      </div>
    </form>`;
}

function experienceSelect(name, label, selected, options) {
  return `<label class="profile-field"><span>${escapeHtml(label)}</span><select name="${escapeHtml(name)}">${options.map(([value, text]) => `<option value="${value}" ${selected === value ? 'selected' : ''}>${escapeHtml(text)}</option>`).join('')}</select></label>`;
}

function goalOption(value, label, selected) {
  return `<label class="goal-option"><input type="radio" name="goal" value="${value}" ${selected === value ? 'checked' : ''}><span>${escapeHtml(label)}</span></label>`;
}

function readProfileForm(form) {
  const value = (name) => form.elements.namedItem(name)?.value ?? null;
  const performances = Array.from(form.querySelectorAll('[data-performance-row]')).map((row) => ({
    id: row.querySelector('[data-performance-field="id"]')?.value,
    type: row.querySelector('[data-performance-field="type"]')?.value,
    distanceKm: row.querySelector('[name="performance-distance"]')?.value,
    durationMinutes: parseDurationInput(row.querySelector('[name="performance-duration"]')?.value),
    elevationGainM: row.querySelector('[name="performance-elevation"]')?.value,
    date: row.querySelector('[name="performance-date"]')?.value,
    name: row.querySelector('[name="performance-name"]')?.value,
  }));
  return {
    training: {
      weeklyDistanceKm: value('weeklyDistanceKm'), weeklyElevationGainM: value('weeklyElevationGainM'), weeklyHours: value('weeklyHours'), weeklySessions: value('weeklySessions'),
      longRun: { distanceKm: value('longRunDistanceKm'), durationMinutes: parseDurationInput(value('longRunDuration')), elevationGainM: value('longRunElevationGainM'), date: value('longRunDate') },
    },
    performances,
    experience: {
      longestCompletedDistanceKm: value('longestCompletedDistanceKm'), longestEffortMinutes: parseDurationInput(value('longestEffortDuration')), maximumElevationGainM: value('maximumElevationGainM'),
      technicalLevel: value('technicalLevel'), nightExperience: value('nightExperience'), autonomyExperience: value('autonomyExperience'),
    },
    goal: form.querySelector('[name="goal"]:checked')?.value ?? null,
  };
}

function showProfileErrors(errors) {
  const container = document.querySelector('#profile-errors');
  if (!container) return;
  const messages = [...new Set(Object.values(errors))];
  container.hidden = false;
  container.innerHTML = `<strong>Vérifiez les informations saisies.</strong><ul>${messages.map((message) => `<li>${escapeHtml(message)}</li>`).join('')}</ul>`;
  container.focus?.();
}

function statusBadge(status) {
  return `<span class="diagnostic-status status-${escapeHtml(status)}">${escapeHtml(profileStatusLabels[status] ?? status)}</span>`;
}

function diagnosticTemplate(profile, race) {
  const result = compareRunnerToRace(profile, race, new Date());
  const confidence = result.confidence;
  return `
    <a class="course-back" href="${escapeHtml(courseHref(race))}">← Retour à la course</a>
    <header class="diagnostic-hero">
      <div><p class="eyebrow">COMPARAISON PERSONNALISÉE · V0</p><h1>${escapeHtml(race.name)}</h1><p>Un indicateur d’adéquation actuel, pas une prédiction de résultat.</p></div>
      <div class="verdict-panel"><span>Verdict général</span><strong>${escapeHtml(verdictLabels[result.verdict])}</strong>${statusBadge(verdictStatus(result.verdict))}</div>
    </header>
    <section class="confidence-panel confidence-${escapeHtml(confidence.level)}">
      <div><span>Niveau de confiance</span><strong>${escapeHtml(confidenceLevelLabels[confidence.level])}</strong></div>
      <p>${escapeHtml(confidence.reasons[0])}</p>
      ${confidence.missing.length ? `<details><summary>Voir les limites (${confidence.missing.length})</summary><ul>${confidence.missing.map((item) => `<li>${escapeHtml(item)}</li>`).join('')}</ul></details>` : ''}
    </section>
    <div class="diagnostic-axes">${result.axes.map(axisTemplate).join('')}</div>
    <aside class="method-note"><strong>À garder en tête</strong><p>Les seuils sont conservateurs, explicables et ajustables. Ils ne garantissent ni réussite ni échec.</p></aside>
    <div class="profile-form-actions"><button class="button button-primary" type="button" data-edit-profile>Modifier mon profil</button><a class="button button-secondary" href="${escapeHtml(courseHref(race))}">Voir la fiche course</a></div>`;
}

function axisTemplate(axis) {
  return `<article class="diagnostic-axis status-border-${escapeHtml(axis.status)}">
    <header><div><span>AXE</span><h2>${escapeHtml(axis.label)}</h2></div>${statusBadge(axis.status)}</header>
    <div class="axis-comparison"><div><span>Niveau actuel</span><strong>${escapeHtml(axis.current)}</strong></div><div><span>Exigence course</span><strong>${escapeHtml(axis.requirement)}</strong></div><div><span>Écart</span><strong>${escapeHtml(axis.gap)}</strong></div></div>
    <p>${escapeHtml(axis.explanation)}</p>
    ${axis.indicators?.length ? `<ul class="axis-indicators">${axis.indicators.map((item) => `<li><span>${escapeHtml(item.label)}</span>${statusBadge(item.status)}</li>`).join('')}</ul>` : ''}
    ${axis.barriers?.length ? barriersTemplate(axis.barriers) : ''}
    <div class="axis-recommendation"><span>Validation recommandée</span><strong>${escapeHtml(axis.recommendation)}</strong></div>
  </article>`;
}

function barriersTemplate(barriers) {
  return `<div class="barrier-table-wrap"><table class="barrier-table"><thead><tr><th>Point</th><th>Barrière</th><th>Disponible</th><th>Allure minimale</th><th>Passage estimé</th><th>Marge</th></tr></thead><tbody>${barriers.map((barrier) => `<tr>
    <th>${escapeHtml(barrier.name)}<small>${formatKm(barrier.distanceKm)}</small></th>
    <td>${barrier.cutoffTime?.hour ? escapeHtml(barrier.cutoffTime.hour) : 'Non renseignée'}</td>
    <td>${formatMinutesAsHoursMinutes(barrier.elapsedLimitMinutes)}</td>
    <td>${barrier.requiredMinutesPerKm === null ? 'Indisponible' : `${formatPace(barrier.requiredMinutesPerKm)} min/km`}<small>${barrier.requiredSpeedKmh === null ? '' : `${formatNumber(barrier.requiredSpeedKmh, 1)} km/h`}</small></td>
    <td>${barrier.estimatedTime?.hour ? `${escapeHtml(barrier.estimatedTime.hour)}<small>Fiabilité ${barrier.reliability === 'medium' ? 'moyenne' : 'faible'}</small>` : 'Données insuffisantes'}</td>
    <td>${barrier.marginMinutes === null ? 'Données insuffisantes' : formatMinutesAsHoursMinutes(barrier.marginMinutes, { signed: true })}</td>
  </tr>`).join('')}</tbody></table></div>`;
}

function formatPace(minutes) {
  const totalSeconds = Math.round(minutes * 60);
  return `${Math.floor(totalSeconds / 60)}:${String(totalSeconds % 60).padStart(2, '0')}`;
}

function verdictStatus(verdict) {
  if (verdict === 'accessible_now') return STATUS.VALIDATED;
  if (verdict === 'ambitious_coherent') return STATUS.CONSOLIDATE;
  if (verdict === 'preparation_insufficient') return STATUS.CRITICAL;
  return STATUS.INSUFFICIENT;
}

function renderProfile({ editing = false } = {}) {
  if (!profileContentEl) return;
  if (state.runnerProfile && state.profileRace && !editing) profileContentEl.innerHTML = diagnosticTemplate(state.runnerProfile, state.profileRace);
  else profileContentEl.innerHTML = profileFormTemplate(state.runnerProfile, { selectedRace: state.profileRace });
}

function bindProfileActions() {
  profileContentEl?.addEventListener('click', (event) => {
    if (event.target.closest?.('#add-performance')) {
      const list = document.querySelector('#performance-list');
      if (list) list.insertAdjacentHTML('beforeend', performanceRowTemplate({}, list.querySelectorAll('[data-performance-row]').length));
      return;
    }
    const remove = event.target.closest?.('[data-remove-performance]');
    if (remove) { remove.closest('[data-performance-row]')?.remove(); return; }
    if (event.target.closest?.('[data-edit-profile]')) { renderProfile({ editing: true }); return; }
    if (event.target.closest?.('[data-cancel-profile]')) { renderProfile(); }
  });
  profileContentEl?.addEventListener('submit', (event) => {
    if (event.target.id !== 'runner-profile-form') return;
    event.preventDefault();
    try {
      state.runnerProfile = profileRepository.save(readProfileForm(event.target));
      profileStatusEl.textContent = 'Profil enregistré sur cet appareil.';
      renderProfile();
      showToast('Profil enregistré.');
    } catch (error) {
      if (error instanceof ProfileValidationError) showProfileErrors(error.errors);
      else profileStatusEl.textContent = 'Impossible d’enregistrer le profil dans ce navigateur.';
    }
  });
  profileContentEl?.addEventListener('change', (event) => {
    const row = event.target.closest?.('[data-performance-row]');
    if (!row || event.target.dataset.performanceField !== 'type') return;
    const fixed = { '5k': 5, '10k': 10, half_marathon: 21.0975, marathon: 42.195 }[event.target.value];
    const distance = row.querySelector('[name="performance-distance"]');
    const duration = row.querySelector('[name="performance-duration"]');
    const elevation = row.querySelector('[name="performance-elevation"]');
    if (distance) { if (fixed) distance.value = fixed; distance.readOnly = Boolean(fixed); }
    if (duration && event.target.value === 'six_minute_test') { duration.value = '0:06'; duration.readOnly = true; } else if (duration) duration.readOnly = false;
    if (elevation) elevation.closest('.profile-field').hidden = event.target.value !== 'trail';
  });
}

async function initProfile() {
  destroyCourseMap();
  compareView.hidden = true;
  explorerView.hidden = true;
  favoritesView.hidden = true;
  courseView.hidden = true;
  profileView.hidden = false;
  document.body?.classList?.add('is-profile-page');
  state.runnerProfile = profileRepository.load();
  const slug = new URLSearchParams(window.location.search).get('course');
  if (slug && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) {
    try {
      const { race } = await fetchJson(`/api/races/slug/${encodeURIComponent(slug)}`);
      state.profileRace = race;
    } catch (error) {
      profileStatusEl.textContent = `Course sélectionnée indisponible : ${error.message}`;
    }
  }
  updateDocumentMeta('profile');
  bindProfileActions();
  renderProfile();
}

async function initCourse(slug) {
  destroyCourseMap();
  compareView.hidden = true;
  explorerView.hidden = true;
  favoritesView.hidden = true;
  courseView.hidden = false;
  document.body?.classList?.add('is-course-page');
  try {
    const { race } = await fetchJson(`/api/races/slug/${encodeURIComponent(slug)}`);
    state.currentCourse = race;
    state.races = [race];
    state.favorites = readFavoriteIds();
    courseContentEl.innerHTML = courseDetailTemplate(race);
    courseStatusEl.textContent = '';
    bindCourseActions();
    if (race.gpx?.status === 'available') {
      const gpxData = await loadGpxForRace(race);
      if (gpxData) await renderInteractiveCourseMap(race, gpxData);
    }
  } catch (error) {
    courseStatusEl.textContent = `Impossible de charger cette fiche : ${error.message}`;
  }
}

async function init() {
  try {
    const { races } = await fetchJson('/api/races');
    state.races = races;
    reconcileFavorites(races);
    const selection = applyUrlSelection(races);

    populateSelect(raceASelect, races, selection.raceA);
    populateSelect(raceBSelect, races, selection.raceB);
    populateExplorerLocations(races);
    populateExplorerDynamicFilters(races);
    restoreExplorerFilters();

    bindNavigation();
    bindExplorerEvents();
    raceASelect.addEventListener('change', compareSelectedRaces);
    raceBSelect.addEventListener('change', compareSelectedRaces);
    swapButton.addEventListener('click', swapRaces);
    shareButton.addEventListener('click', () => shareComparison().catch(() => showToast('Copie indisponible.')));
    exportButton.addEventListener('click', exportComparison);

    setActiveView(getInitialView(), { updateHash: false });
    renderExplorer();
    renderFavorites();
    await compareSelectedRaces();
  } catch (error) {
    setStatus(`Impossible de charger les courses: ${error.message}`);
  }
}

const courseSlug = getCourseSlugFromPath();
if (window.location.pathname === '/profil' || window.location.pathname === '/profil/') {
  initProfile();
} else if (courseSlug) {
  initCourse(courseSlug);
} else {
  init();
}
