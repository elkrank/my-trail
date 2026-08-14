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
};

const favoriteStorageKey = 'trailcompare:favorites:v1';

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
};

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
            <svg class="route-map" viewBox="0 0 560 190" role="img" aria-label="Tracé GPX disponible">
              ${polylines.map((polyline) => `<polyline class="route-shadow" points="${polyline}"></polyline>`).join('')}
              ${polylines.map((polyline) => `<polyline points="${polyline}"></polyline>`).join('')}
            </svg>
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
  const hasProfile = elevationPoints.length > 1;
  const polyline = hasProfile ? createPolyline(elevationPoints, 560, 134, 12) : '';
  const areaPath = hasProfile ? createAreaPath(elevationPoints, 560, 134, 12) : '';
  const altitudes = elevationPoints.map((point) => point.y);
  const minAltitude = hasProfile ? Math.min(...altitudes) : null;
  const maxAltitude = hasProfile ? Math.max(...altitudes) : null;

  return `
    <section class="profile-block ${raceToneClass(variant)}" aria-label="Profil altimétrique">
      <div class="section-heading">
        <h3>Profil altimétrique</h3>
        <span>${hasProfile ? `${formatAltitude(minAltitude)} - ${formatAltitude(maxAltitude)}` : 'Données absentes'}</span>
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
              <span>Profil GPX réel non disponible dans les données actuelles.</span>
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
      ${metricTemplate('TEMPS LIMITE', formatDuration(race.timeLimitMinutes))}
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
    return '<div class="explorer-card-media is-empty" aria-hidden="true"></div>';
  }

  const alt = race.illustration?.alt || `Illustration ${race.name}`;
  return `
    <div class="explorer-card-media">
      <img src="${escapeHtml(illustrationUrl)}" alt="${escapeHtml(alt)}" loading="lazy" decoding="async" referrerpolicy="no-referrer" onerror="this.parentElement.classList.add('is-empty'); this.remove();">
    </div>
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
          <h2>${escapeHtml(race.name)}</h2>
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
        <span>${escapeHtml(formatDuration(race.timeLimitMinutes))}</span>
      </div>

      <footer class="explorer-card-footer">
        <span class="gpx-badge ${isGpxAvailable ? 'is-available' : 'is-missing'}">
          ${isGpxAvailable ? 'GPX disponible' : 'GPX absent'}
        </span>
        <div class="explorer-actions">
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

    comparisonEl.innerHTML =
      raceCardTemplate(comparison.raceA, 'a', gpxA) +
      raceCardTemplate(comparison.raceB, 'b', gpxB);
    setStatus('');
  } catch (error) {
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

init();
