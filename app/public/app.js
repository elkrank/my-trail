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
const explorerSearchInput = document.querySelector('#explorer-search');
const explorerLocationSelect = document.querySelector('#explorer-location');
const explorerDateFromInput = document.querySelector('#explorer-date-from');
const explorerDateToInput = document.querySelector('#explorer-date-to');
const explorerElevationSelect = document.querySelector('#explorer-elevation');
const explorerDistanceSelect = document.querySelector('#explorer-distance');
const explorerSortSelect = document.querySelector('#explorer-sort');
const explorerGpxOnlyInput = document.querySelector('#explorer-gpx-only');
const explorerResetButton = document.querySelector('#explorer-reset');
const explorerCountEl = document.querySelector('#explorer-count');
const explorerResultsEl = document.querySelector('#explorer-results');

const confidenceLabels = {
  official: 'Source officielle',
  secondary: 'Source secondaire',
  unverified: 'Donnée non vérifiée',
};

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
  isSwapping: false,
  activeView: 'compare',
};

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (character) => htmlEscapeMap[character]);
}

function safeHttpUrl(value) {
  if (!value) return null;

  try {
    const url = new URL(String(value), window.location.origin);
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

function formatNumber(value, digits = 1) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 'Non disponible';

  return number.toLocaleString('fr-FR', {
    maximumFractionDigits: digits,
    minimumFractionDigits: Number.isInteger(number) ? 0 : digits,
  });
}

function formatDuration(minutes) {
  const number = Number(minutes);
  if (!Number.isFinite(number) || number <= 0) return 'Non disponible';

  const hours = Math.floor(number / 60);
  const remainder = Math.round(number % 60);
  return remainder ? `${hours} h ${String(remainder).padStart(2, '0')}` : `${hours} h`;
}

function formatKm(value) {
  return Number.isFinite(Number(value)) ? `${formatNumber(value, 1)} km` : 'Non disponible';
}

function formatElevation(value) {
  return Number.isFinite(Number(value)) ? `${formatNumber(value, 0)} D+` : 'Non disponible';
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
  return Number.isFinite(Number(value)) ? `${formatNumber(value, 0)} m` : 'Non disponible';
}

function formatSpeed(value) {
  return Number.isFinite(Number(value)) ? `${formatNumber(value, 2)} km/h` : 'Non disponible';
}

function formatScore(value) {
  return Number.isFinite(Number(value)) ? `${Math.round(Number(value))}/100` : 'Non disponible';
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

function hasAvailableGpx(race) {
  return race.gpx?.status === 'available';
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
    sort: explorerSortSelect?.value || 'date-asc',
    gpxOnly: Boolean(explorerGpxOnlyInput?.checked),
  };
}

function matchesRange(value, rangeKey, ranges) {
  if (!rangeKey) return true;
  const range = ranges[rangeKey];
  const number = Number(value);
  if (!range || !Number.isFinite(number)) return false;
  if (Number.isFinite(range.min) && number < range.min) return false;
  if (Number.isFinite(range.max) && number >= range.max) return false;
  return true;
}

function matchesExplorerFilters(race, filters) {
  if (filters.search && !raceSearchText(race).includes(filters.search)) return false;
  if (filters.location && knownRaceLocationLabel(race) !== filters.location) return false;
  if (!matchesRange(race.elevationGainM, filters.elevation, elevationRanges)) return false;
  if (!matchesRange(race.distanceKm, filters.distance, distanceRanges)) return false;
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
  const numberA = Number(valueA);
  const numberB = Number(valueB);
  const hasA = Number.isFinite(numberA);
  const hasB = Number.isFinite(numberB);

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
  const value = Number(score);
  if (!Number.isFinite(value)) return 'muted';
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
      ?.filter((point) => Number.isFinite(Number(point.ele)))
      .map((point, index) => ({
        x: point.distanceKm ?? index,
        y: Number(point.ele),
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
  const hasScore = Number.isFinite(Number(score));
  const tone = score ? scoreTone(score) : 'muted';
  return `
    <div class="metric ${accent ? 'is-accent' : ''}">
      <span>${escapeHtml(label)}</span>
      <strong>${escapeHtml(value)}</strong>
      ${hasScore ? `<i class="score-dot score-${tone}" aria-hidden="true"></i>` : ''}
    </div>
  `;
}

function metricsTemplate(race) {
  return `
    <div class="metrics-grid" aria-label="Métriques principales">
      ${metricTemplate('KM-EFFORT', formatKm(race.kmEffort))}
      ${metricTemplate('TEMPS LIMITE', formatDuration(race.timeLimitMinutes))}
      ${metricTemplate('DIFFICULTÉ V0', formatScore(race.difficultyScoreV0), {
        score: race.difficultyScoreV0,
        accent: true,
      })}
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
          <p>Aucun checkpoint V0 défini pour cette course.</p>
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
      ${safeSourceUrl ? `<a href="${escapeHtml(safeSourceUrl)}" rel="noreferrer" target="_blank">Consulter</a>` : '<span>Source indisponible</span>'}
    </footer>
  `;
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
          <button class="favorite-button" type="button" aria-label="Ajouter aux favoris">
            <svg viewBox="0 0 24 24" focusable="false" aria-hidden="true">
              <path d="m12 5 2.1 4.3 4.7.7-3.4 3.3.8 4.7-4.2-2.2L7.8 18l.8-4.7L5.2 10l4.7-.7L12 5Z"></path>
            </svg>
          </button>
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
        <span>Couverture V0</span>
        <strong>${escapeHtml(missing)}</strong>
      </div>

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
      <img src="${escapeHtml(illustrationUrl)}" alt="${escapeHtml(alt)}" loading="lazy" decoding="async" referrerpolicy="no-referrer">
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
        <span class="quality-badge ${qualityClass}">${qualityStatus}</span>
      </header>

      <div class="explorer-metrics">
        ${explorerMetricTemplate('Date', formatRaceDateTime(race))}
        ${explorerMetricTemplate('Lieu', raceLocationLabel(race))}
        ${explorerMetricTemplate('Distance', formatKm(race.distanceKm))}
        ${explorerMetricTemplate('D+', formatElevation(race.elevationGainM))}
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

function resetExplorerFilters() {
  if (explorerSearchInput) explorerSearchInput.value = '';
  if (explorerLocationSelect) explorerLocationSelect.value = '';
  if (explorerDateFromInput) explorerDateFromInput.value = '';
  if (explorerDateToInput) explorerDateToInput.value = '';
  if (explorerElevationSelect) explorerElevationSelect.value = '';
  if (explorerDistanceSelect) explorerDistanceSelect.value = '';
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
  showToast(`Course ajoutee en ${target === 'b' ? 'B' : 'A'}.`);
}

function handleExplorerAction(event) {
  const button = event.target.closest?.('[data-compare-target]');
  if (!button) return;
  compareFromExplorer(button.dataset.raceId, button.dataset.compareTarget);
}

function getInitialView() {
  return window.location.hash === '#explorer' ? 'explorer' : 'compare';
}

function setActiveView(view, { updateHash = true } = {}) {
  const activeView = view === 'explorer' ? 'explorer' : 'compare';
  state.activeView = activeView;

  if (compareView) {
    compareView.hidden = activeView !== 'compare';
    compareView.classList.toggle('is-active', activeView === 'compare');
  }

  if (explorerView) {
    explorerView.hidden = activeView !== 'explorer';
    explorerView.classList.toggle('is-active', activeView === 'explorer');
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
    const nextHash = activeView === 'explorer' ? '#explorer' : '#compare';
    if (window.location.hash !== nextHash) {
      window.location.hash = nextHash;
    }
  }

  if (activeView === 'explorer') renderExplorer();
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
    explorerSortSelect,
    explorerGpxOnlyInput,
  ].forEach((control) => control?.addEventListener('change', renderExplorer));

  explorerResetButton?.addEventListener('click', resetExplorerFilters);
  explorerResultsEl?.addEventListener('click', handleExplorerAction);
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

  setStatus('Calcul des estimations V0...');
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
    ['Course', 'Distance', 'D+', 'Km-effort', 'Temps limite', 'Difficulté V0', 'Pression V0'],
    ['A', state.currentComparison.raceA.distanceKm, state.currentComparison.raceA.elevationGainM, state.currentComparison.raceA.kmEffort, formatDuration(state.currentComparison.raceA.timeLimitMinutes), formatScore(state.currentComparison.raceA.difficultyScoreV0), formatScore(state.currentComparison.raceA.barrierPressureScoreV0)],
    ['B', state.currentComparison.raceB.distanceKm, state.currentComparison.raceB.elevationGainM, state.currentComparison.raceB.kmEffort, formatDuration(state.currentComparison.raceB.timeLimitMinutes), formatScore(state.currentComparison.raceB.difficultyScoreV0), formatScore(state.currentComparison.raceB.barrierPressureScoreV0)],
  ];
  const csv = rows.map((row) => row.map((value) => `"${String(value ?? '').replaceAll('"', '""')}"`).join(',')).join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = 'trailcompare-v0.csv';
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
    const selection = applyUrlSelection(races);

    populateSelect(raceASelect, races, selection.raceA);
    populateSelect(raceBSelect, races, selection.raceB);
    populateExplorerLocations(races);

    bindNavigation();
    bindExplorerEvents();
    raceASelect.addEventListener('change', compareSelectedRaces);
    raceBSelect.addEventListener('change', compareSelectedRaces);
    swapButton.addEventListener('click', swapRaces);
    shareButton.addEventListener('click', () => shareComparison().catch(() => showToast('Copie indisponible.')));
    exportButton.addEventListener('click', exportComparison);

    setActiveView(getInitialView(), { updateHash: false });
    renderExplorer();
    await compareSelectedRaces();
  } catch (error) {
    setStatus(`Impossible de charger les courses: ${error.message}`);
  }
}

init();
