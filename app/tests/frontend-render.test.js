import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { STATUS } from '../public/profile-config.js';
import { compareRunnerToRace, formatMinutesAsHoursMinutes } from '../public/profile-comparison.js';
import { createProfileRepository, emptyProfile, formatDurationInput, parseDurationInput, ProfileValidationError } from '../public/profile-repository.js';

const appSource = (await readFile(new URL('../public/app.js', import.meta.url), 'utf8')).replace(/^import .*;\r?\n/gm, '');

function classListStub() {
  const classes = new Set();
  return {
    add(className) {
      classes.add(className);
    },
    remove(className) {
      classes.delete(className);
    },
    toggle(className, force) {
      if (force === true) {
        classes.add(className);
        return true;
      }
      if (force === false) {
        classes.delete(className);
        return false;
      }
      if (classes.has(className)) {
        classes.delete(className);
        return false;
      }
      classes.add(className);
      return true;
    },
    contains(className) {
      return classes.has(className);
    },
  };
}

function elementStub({ value = '', checked = false } = {}) {
  return {
    value,
    checked,
    hidden: false,
    textContent: '',
    html: '',
    dataset: {},
    listeners: {},
    classList: classListStub(),
    setAttribute(name, value) {
      this[name] = value;
    },
    removeAttribute(name) {
      delete this[name];
    },
    addEventListener(event, listener) {
      this.listeners[event] = listener;
    },
    dispatch(event) {
      this.listeners[event]?.({ target: this, preventDefault() {} });
    },
  };
}

function optionStub() {
  const element = elementStub();

  Object.defineProperty(element, 'innerHTML', {
    get() {
      return this.html ?? '';
    },
    set(value) {
      this.html = value;
      const selected = value.match(/<option value="([^"]+)" selected>/);
      const first = value.match(/<option value="([^"]+)"/);
      this.value = selected?.[1] ?? first?.[1] ?? '';
    },
  });

  return element;
}

function htmlStub() {
  const element = elementStub();

  Object.defineProperty(element, 'innerHTML', {
    get() {
      return this.html ?? '';
    },
    set(value) {
      this.html = value;
    },
  });

  return element;
}

function viewLinkStub(view) {
  return {
    ...elementStub(),
    dataset: { viewLink: view },
  };
}

async function renderApp({ races, comparison = null, hash = '', pathname = '/', search = '', storage = null, sessionStorage = null, gpxPayloads = {}, extraElements = {}, leaflet = null }) {
  const compareLink = viewLinkStub('compare');
  const explorerLink = viewLinkStub('explorer');
  const favoritesLink = viewLinkStub('favorites');
  const elements = {
    '#race-a': optionStub(),
    '#race-b': optionStub(),
    '#swap-races': elementStub(),
    '#share-button': elementStub(),
    '#export-button': elementStub(),
    '#status': elementStub(),
    '#comparison': htmlStub(),
    '#toast': elementStub(),
    '#compare-view': elementStub(),
    '#explorer-view': elementStub(),
    '#favorites-view': elementStub(),
    '#explorer-search': elementStub(),
    '#explorer-location': optionStub(),
    '#explorer-date-from': elementStub(),
    '#explorer-date-to': elementStub(),
    '#explorer-elevation': optionStub(),
    '#explorer-distance': optionStub(),
    '#explorer-month': optionStub(),
    '#explorer-price-max': optionStub(),
    '#explorer-registration-status': optionStub(),
    '#explorer-duration-max': optionStub(),
    '#explorer-sort': optionStub(),
    '#explorer-gpx-only': elementStub({ checked: false }),
    '#explorer-reset': elementStub(),
    '#explorer-count': elementStub(),
    '#explorer-results': htmlStub(),
    '#favorites-count': elementStub(),
    '#favorites-results': htmlStub(),
    '#course-view': elementStub(),
    '#course-status': elementStub(),
    '#course-content': htmlStub(),
    '#profile-view': elementStub(),
    '#profile-status': elementStub(),
    '#profile-content': htmlStub(),
    ...extraElements,
  };
  elements['#explorer-sort'].value = 'date-asc';

  const fetchCalls = [];
  const selectedComparison = comparison ?? { raceA: races[0], raceB: races[1] };
  const context = {
    Blob,
    URL,
    URLSearchParams,
    console,
    STATUS,
    compareRunnerToRace,
    formatMinutesAsHoursMinutes,
    createProfileRepository,
    emptyProfile,
    formatDurationInput,
    parseDurationInput,
    ProfileValidationError,
    document: {
      title: 'TrailCompare',
      referrer: '',
      body: {
        classList: classListStub(),
        contains() { return true; },
      },
      head: {
        appendChild() {},
      },
      querySelector(selector) {
        return elements[selector];
      },
      querySelectorAll(selector) {
        return selector === '[data-view-link]' ? [compareLink, explorerLink, favoritesLink] : [];
      },
      createElement() {
        return {
          click() {},
        };
      },
    },
    window: {
      location: { href: `http://localhost${pathname}${search}${hash}`, pathname, search, hash },
      localStorage: storage,
      sessionStorage,
      history: { length: 1, back() {} },
      clearTimeout() {},
      setTimeout() {
        return 1;
      },
      addEventListener() {},
      ...(leaflet ? { L: leaflet } : {}),
    },
    navigator: {},
    fetch: async (url) => {
      fetchCalls.push(String(url));
      if (url === '/api/races') {
        return jsonResponse({ races });
      }
      if (String(url).startsWith('/api/races/slug/')) {
        const slug = String(url).split('/').at(-1);
        const race = races.find((candidate) => candidate.slug === slug);
        return race ? jsonResponse({ race }) : jsonResponse({ error: 'Race not found' }, false);
      }
      if (String(url).startsWith('/api/compare')) {
        return jsonResponse(selectedComparison);
      }
      const urlText = String(url);
      if (urlText.startsWith('/api/races/') && urlText.endsWith('/gpx')) {
        const raceId = urlText.split('/')[3];
        const payload = gpxPayloads[raceId];
        return payload ? jsonResponse(payload) : jsonResponse({ error: 'not found' }, false);
      }
      return jsonResponse({ error: 'not found' }, false);
    },
  };

  vm.createContext(context);
  await vm.runInContext(appSource, context, { timeout: 1000 });
  await Promise.resolve();
  await Promise.resolve();
  await new Promise((resolve) => setImmediate(resolve));

  return { context, elements, fetchCalls, links: { compareLink, explorerLink, favoritesLink } };
}

function jsonResponse(body, ok = true) {
  return {
    ok,
    status: ok ? 200 : 404,
    async json() {
      return body;
    },
  };
}

function storageStub(initialValue = null, { throwOnGet = false, throwOnSet = false } = {}) {
  const store = new Map();
  if (initialValue !== null) store.set('trailcompare:favorites:v1', initialValue);
  return {
    getItem(key) {
      if (throwOnGet) throw new Error('storage get unavailable');
      return store.has(key) ? store.get(key) : null;
    },
    setItem(key, value) {
      if (throwOnSet) throw new Error('storage set unavailable');
      store.set(key, value);
    },
    value(key = 'trailcompare:favorites:v1') {
      return store.get(key);
    },
  };
}

function raceFixture(overrides = {}) {
  const fixtureId = overrides.id ?? 9;
  return {
    id: fixtureId,
    sourceId: `fixture:${fixtureId}:2026`,
    slug: `fixture-${fixtureId}-2026`,
    name: 'Nord Trail Monts de Flandres - 115 km',
    event: {
      id: 'ntmf',
      slug: 'ntmf',
      name: 'Nord Trail Monts de Flandres',
      country: 'France',
      region: 'Hauts-de-France',
      city: 'Saint-Jans-Cappel',
    },
    eventName: 'Nord Trail Monts de Flandres',
    raceName: '115 km',
    shortName: '115 km',
    edition: '2026',
    date: '2026-04-19',
    startTime: '06:00',
    distanceKm: 115,
    elevationGainM: 2150,
    elevationLossM: 2100,
    startLocation: 'Saint-Jans-Cappel',
    finishLocation: 'Saint-Jans-Cappel',
    timeLimitMinutes: 1110,
    kmEffort: 136.5,
    difficultyScoreV0: 70,
    difficultyScoreV1: 70,
    difficultyScore: 70,
    difficultyScoreVersion: 'v1',
    elevationDensityMPerKm: 18.7,
    verticalityLevel: 'hilly',
    barrierPressureScoreV0: 59,
    confidence: 'official',
    sourceUrl: 'https://example.test',
    registration: {
      priceEur: 105,
      status: 'unknown',
      lottery: null,
      url: null,
    },
    quality: { status: 'partial', missingFields: ['gpx'] },
    illustration: {
      url: 'https://example.test/images/ntmf.jpg',
      alt: 'Nord Trail Monts de Flandres - 115 km',
      sourceUrl: 'https://example.test',
    },
    gpxUrl: null,
    gpx: null,
    aidStations: [],
    mandatoryEquipment: [],
    rules: {},
    program: [],
    logistics: null,
    sources: [],
    verifiedAt: '2026-08-14T00:00:00.000Z',
    criticalBarrier: {
      name: 'Boescheppe',
      distanceKm: 74.5,
      barrierPressureScoreV0: 59,
    },
    checkpoints: [
      {
        name: 'Boescheppe',
        distanceKm: 74.5,
        elapsedLimitMinutes: 660,
        requiredCheckpointSpeedKmh: 6.77,
        barrierPressureScoreV0: 59,
      },
    ],
    ...overrides,
  };
}

test('frontend renders comparison cards with real values and empty states', async () => {
  const raceA = raceFixture();
  const raceB = raceFixture({
    id: 2,
    name: 'EcoTrail Paris - 50 km Automne',
    event: {
      id: 'ecotrail',
      slug: 'ecotrail',
      name: 'EcoTrail Paris',
      country: 'France',
      region: 'Ile-de-France',
      city: 'Paris',
    },
    eventName: 'EcoTrail Paris',
    raceName: 'Trail 50 km Automne',
    shortName: '50 km Automne',
    date: '2026-10-17',
    distanceKm: 50,
    elevationGainM: 800,
    timeLimitMinutes: 540,
    kmEffort: 58,
    difficultyScoreV0: 31,
    difficultyScoreV1: 42,
    difficultyScore: 42,
    difficultyScoreVersion: 'v1',
    elevationDensityMPerKm: 16,
    verticalityLevel: 'hilly',
    barrierPressureScoreV0: null,
    criticalBarrier: null,
    checkpoints: [],
    quality: { status: 'partial', missingFields: ['gpx', 'checkpoints'] },
  });

  const { elements, fetchCalls } = await renderApp({ races: [raceA, raceB] });
  const html = elements['#comparison'].innerHTML;

  assert.equal(fetchCalls.includes('/api/races'), true);
  assert.match(html, /Nord Trail Monts de Flandres - 115 km/);
  assert.match(html, /EcoTrail Paris - 50 km Automne/);
  assert.match(html, /136,5 km/);
  assert.match(html, /DIFFICULTÉ PHYSIQUE ESTIMÉE/);
  assert.match(html, /Vallonnée/);
  assert.match(html, /Boescheppe - 74,5 km/);
  assert.match(html, /Aucun checkpoint de barri.re d.fini pour cette course/);
  assert.match(html, /Trac. GPX non disponible/);
  assert.match(html, /Profil GPX r.el non disponible/);
  assert.match(html, /Comparer avec mon profil/);
});

test('profile route renders an optional-data form without fetching the race list', async () => {
  const { elements, fetchCalls } = await renderApp({ races: [raceFixture(), raceFixture({ id: 2 })], pathname: '/profil', storage: storageStub() });
  const html = elements['#profile-content'].innerHTML;
  assert.equal(fetchCalls.includes('/api/races'), false);
  assert.equal(elements['#profile-view'].hidden, false);
  assert.match(html, /Créer mon profil coureur/);
  assert.match(html, /Entraînement récent/);
  assert.match(html, /Références de performance/);
  assert.match(html, /Expérience trail/);
  assert.match(html, /Terminer dans les délais/);
});

test('profile route reloads a stored profile and renders the selected race diagnosis', async () => {
  const race = raceFixture({
    technicalScore: 3,
    nightStart: false,
    aidStations: [{ distanceKm: 20 }, { distanceKm: 40 }, { distanceKm: 70 }, { distanceKm: 95 }],
    checkpoints: [{ name: 'Boescheppe', distanceKm: 74.5, elevationGainFromStartM: 1700, elapsedLimitMinutes: 660 }],
  });
  const storage = storageStub();
  storage.setItem('trailcompare:runner-profile:v1', JSON.stringify({
    version: 1,
    updatedAt: '2026-08-20T10:00:00Z',
    training: { weeklyDistanceKm: 75, weeklyElevationGainM: 2000, weeklyHours: 9, weeklySessions: 5, longRun: { distanceKm: 45, durationMinutes: 360, elevationGainM: 1500, date: '2026-08-01' } },
    performances: [{ id: 'trail', type: 'trail', distanceKm: 60, durationMinutes: 500, elevationGainM: 1800, date: '2026-06-01', name: 'Référence' }],
    experience: { longestCompletedDistanceKm: 80, longestEffortMinutes: 720, maximumElevationGainM: 2500, technicalLevel: 'comfortable', nightExperience: 'some', autonomyExperience: 'some' },
    goal: 'finish_cutoffs',
  }));
  const { elements, fetchCalls } = await renderApp({ races: [race, raceFixture({ id: 2 })], pathname: '/profil', search: `?course=${race.slug}`, storage });
  const html = elements['#profile-content'].innerHTML;
  assert.equal(fetchCalls.includes(`/api/races/slug/${race.slug}`), true);
  assert.match(html, /COMPARAISON PERSONNALISÉE/);
  assert.match(html, /Respect des barrières horaires/);
  assert.match(html, /Niveau de confiance/);
  assert.match(html, /Validation recommandée/);
});

function gpxPayloadFixture(elevationQuality) {
  return {
    sourceUrl: 'https://example.test/route',
    downloadUrl: 'https://example.test/route.gpx',
    localFile: 'gpx/2026/fixture/route.gpx',
    sha256: 'test-sha',
    computed: {
      distanceKm: 2,
      elevationGainM: elevationQuality.computedGainM,
    },
    elevationQuality,
    segments: [[
      { lat: 45.1, lon: 6.1, ele: 100, distanceKm: 0 },
      { lat: 45.2, lon: 6.2, ele: 140, distanceKm: 2 },
    ]],
    points: [
      { lat: 45.1, lon: 6.1, ele: 100, distanceKm: 0 },
      { lat: 45.2, lon: 6.2, ele: 140, distanceKm: 2 },
    ],
    elevationProfile: [
      { distanceKm: 0, elevationM: 100 },
      { distanceKm: 2, elevationM: 140 },
    ],
  };
}

test('frontend keeps map profile and download for a consistent GPX', async () => {
  const raceA = raceFixture({
    id: 1,
    name: 'Consistent GPX Trail',
    gpx: { status: 'available', localFile: 'gpx/2026/fixture/route.gpx' },
  });
  const raceB = raceFixture({ id: 2, name: 'No GPX Trail', gpx: null });

  const { elements } = await renderApp({
    races: [raceA, raceB],
    comparison: { raceA, raceB },
    gpxPayloads: {
      1: gpxPayloadFixture({
        status: 'consistent',
        officialGainM: 6200,
        computedGainM: 6400,
        deltaM: 200,
        deltaPercent: 3.2,
      }),
    },
  });
  const html = elements['#comparison'].innerHTML;

  assert.equal(html.includes('route-map'), true);
  assert.equal(html.includes('id="comparison-map-a"'), true);
  assert.equal(html.includes('comparison-map-canvas'), true);
  assert.equal(html.includes('profile-chart'), true);
  assert.equal(html.includes('/api/races/1/gpx/download'), true);
  assert.equal(html.includes('Profil altimétrique non affiché'), false);
});

test('frontend renders comparison GPX on OpenStreetMap tiles with Leaflet', async () => {
  const raceA = raceFixture({
    id: 1,
    name: 'Mapped GPX Trail',
    gpx: { status: 'available', localFile: 'gpx/2026/fixture/route.gpx' },
  });
  const raceB = raceFixture({ id: 2, name: 'No GPX Trail', gpx: null });
  const shell = elementStub();
  const canvas = htmlStub();
  canvas.closest = () => shell;
  const calls = { maps: [], tiles: [], polylines: [], fitBounds: [] };
  const tileEvents = {};
  const map = {
    fitBounds(bounds, options) { calls.fitBounds.push({ bounds, options }); },
    invalidateSize() {},
    remove() {},
  };
  const route = {
    addTo() { return this; },
    getBounds() { return 'route-bounds'; },
  };
  const leaflet = {
    map(element, options) {
      calls.maps.push({ element, options });
      return map;
    },
    tileLayer(url, options) {
      calls.tiles.push({ url, options });
      return {
        on(event, listener) {
          tileEvents[event] = listener;
          return this;
        },
        addTo() {
          tileEvents.tileload?.();
          tileEvents.load?.();
          return this;
        },
      };
    },
    polyline(segments, options) {
      calls.polylines.push({ segments, options });
      return route;
    },
  };

  await renderApp({
    races: [raceA, raceB],
    comparison: { raceA, raceB },
    gpxPayloads: {
      1: gpxPayloadFixture({
        status: 'consistent',
        officialGainM: 6200,
        computedGainM: 6400,
        deltaM: 200,
        deltaPercent: 3.2,
      }),
    },
    extraElements: { '#comparison-map-a': canvas },
    leaflet,
  });

  assert.equal(calls.maps.length, 1);
  assert.equal(calls.maps[0].element, canvas);
  assert.equal(calls.maps[0].options.scrollWheelZoom, false);
  assert.equal(calls.tiles[0].url, 'https://tile.openstreetmap.org/{z}/{x}/{y}.png');
  assert.match(calls.tiles[0].options.attribution, /OpenStreetMap/);
  assert.equal(JSON.stringify(calls.polylines[0].segments), JSON.stringify([[[45.1, 6.1], [45.2, 6.2]]]));
  assert.equal(calls.fitBounds[0].bounds, 'route-bounds');
  assert.equal(JSON.stringify(calls.fitBounds[0].options.padding), JSON.stringify([18, 18]));
  assert.equal(shell.classList.contains('tiles-loading'), false);
});

test('frontend hides inconsistent GPX elevation profile but keeps map and download', async () => {
  const raceA = raceFixture({
    id: 1,
    name: 'Inconsistent GPX Trail',
    gpx: { status: 'available', localFile: 'gpx/2026/fixture/route.gpx' },
  });
  const raceB = raceFixture({ id: 2, name: 'No GPX Trail', gpx: null });

  const { elements } = await renderApp({
    races: [raceA, raceB],
    comparison: { raceA, raceB },
    gpxPayloads: {
      1: gpxPayloadFixture({
        status: 'inconsistent',
        officialGainM: 6200,
        computedGainM: 37833,
        deltaM: 31633,
        deltaPercent: 510.2,
      }),
    },
  });
  const html = elements['#comparison'].innerHTML;

  assert.equal(html.includes('route-map'), true);
  assert.equal(html.includes('/api/races/1/gpx/download'), true);
  assert.equal(html.includes('Profil altimétrique non affiché : les altitudes du GPX sont incohérentes avec le D+ officiel.'), true);
  assert.equal(html.includes('profile-chart'), false);
});

test('frontend shows unverified GPX profile with a discrete indication', async () => {
  const raceA = raceFixture({
    id: 1,
    name: 'Unverified GPX Trail',
    elevationGainM: null,
    gpx: { status: 'available', localFile: 'gpx/2026/fixture/route.gpx' },
  });
  const raceB = raceFixture({ id: 2, name: 'No GPX Trail', gpx: null });

  const { elements } = await renderApp({
    races: [raceA, raceB],
    comparison: { raceA, raceB },
    gpxPayloads: {
      1: gpxPayloadFixture({
        status: 'unverified',
        officialGainM: null,
        computedGainM: 6400,
        deltaM: null,
        deltaPercent: null,
      }),
    },
  });
  const html = elements['#comparison'].innerHTML;

  assert.equal(html.includes('profile-chart'), true);
  assert.equal(html.includes('non vérifié'), true);
  assert.equal(html.includes('/api/races/1/gpx/download'), true);
});

test('explorer filters by date location elevation distance and gpx availability', async () => {
  const ntmf = raceFixture();
  const ecotrail = raceFixture({
    id: 2,
    name: 'EcoTrail Paris - 50 km Automne',
    event: {
      id: 'ecotrail',
      slug: 'ecotrail',
      name: 'EcoTrail Paris',
      country: 'France',
      region: 'Ile-de-France',
      city: 'Paris',
    },
    eventName: 'EcoTrail Paris',
    raceName: 'Trail 50 km Automne',
    shortName: '50 km Automne',
    date: '2026-10-17',
    distanceKm: 50,
    elevationGainM: 800,
    timeLimitMinutes: 540,
    quality: { status: 'partial', missingFields: ['gpx'] },
    criticalBarrier: null,
    checkpoints: [],
  });
  const utmb = raceFixture({
    id: 3,
    name: 'UTMB Mont-Blanc - UTMB',
    event: {
      id: 'utmb',
      slug: 'utmb',
      name: 'UTMB Mont-Blanc',
      country: 'France',
      region: 'Auvergne-Rhone-Alpes',
      city: 'Chamonix',
    },
    eventName: 'UTMB Mont-Blanc',
    raceName: 'UTMB',
    shortName: 'UTMB',
    date: '2026-08-28',
    distanceKm: 174,
    elevationGainM: 9900,
    timeLimitMinutes: 2805,
    quality: { status: 'complete', missingFields: [] },
    illustration: null,
    gpx: { status: 'available' },
  });

  const { elements } = await renderApp({ races: [ntmf, ecotrail, utmb], hash: '#explorer' });
  assert.match(elements['#explorer-results'].innerHTML, /<img src="https:\/\/example\.test\/images\/ntmf\.jpg" alt="Nord Trail Monts de Flandres - 115 km"/);
  assert.match(elements['#explorer-results'].innerHTML, /EcoTrail Paris - 50 km Automne/);
  assert.match(elements['#explorer-results'].innerHTML, /UTMB Mont-Blanc - UTMB/);

  elements['#explorer-location'].value = 'Chamonix - Auvergne-Rhone-Alpes';
  elements['#explorer-location'].dispatch('change');
  assert.match(elements['#explorer-results'].innerHTML, /UTMB Mont-Blanc - UTMB/);
  assert.doesNotMatch(elements['#explorer-results'].innerHTML, /EcoTrail Paris/);

  elements['#explorer-date-from'].value = '2026-09-01';
  elements['#explorer-date-from'].dispatch('input');
  assert.match(elements['#explorer-results'].innerHTML, /Aucune course trouvee/);

  elements['#explorer-reset'].dispatch('click');
  elements['#explorer-elevation'].value = 'over-6000';
  elements['#explorer-distance'].value = 'over-120';
  elements['#explorer-gpx-only'].checked = true;
  elements['#explorer-elevation'].dispatch('change');
  elements['#explorer-distance'].dispatch('change');
  elements['#explorer-gpx-only'].dispatch('change');

  assert.match(elements['#explorer-results'].innerHTML, /UTMB Mont-Blanc - UTMB/);
  assert.doesNotMatch(elements['#explorer-results'].innerHTML, /Nord Trail/);
  assert.equal(elements['#explorer-count'].textContent, '1 course sur 3');
});

test('explorer filters by month price registration status duration and unknown values', async () => {
  const known = raceFixture({
    id: 1,
    name: 'Known April Trail',
    date: '2026-04-19',
    distanceKm: 42,
    elevationGainM: 1200,
    timeLimitMinutes: 540,
    registration: { priceEur: 45, status: 'open', lottery: null, url: null },
  });
  const expensive = raceFixture({
    id: 2,
    name: 'Expensive August Trail',
    date: '2026-08-28',
    distanceKm: 100,
    elevationGainM: 5000,
    timeLimitMinutes: 1800,
    registration: { priceEur: 250, status: 'closed', lottery: null, url: null },
  });
  const unknown = raceFixture({
    id: 3,
    name: 'Unknown Data Trail',
    date: null,
    distanceKm: 20,
    elevationGainM: null,
    timeLimitMinutes: null,
    registration: { priceEur: null, status: 'unknown', lottery: null, url: null },
  });

  const { elements } = await renderApp({ races: [known, expensive, unknown], hash: '#explorer' });
  assert.match(elements['#explorer-results'].innerHTML, /Unknown Data Trail/);
  assert.match(elements['#explorer-month'].innerHTML, /avril/);
  assert.match(elements['#explorer-price-max'].innerHTML, /Jusqu&#39;à 45 EUR/);
  assert.doesNotMatch(elements['#explorer-price-max'].innerHTML, /value="0"/);
  assert.match(elements['#explorer-registration-status'].innerHTML, /Ouverte/);
  assert.match(elements['#explorer-duration-max'].innerHTML, /Jusqu&#39;à 9 h/);

  elements['#explorer-price-max'].value = '45';
  elements['#explorer-price-max'].dispatch('change');
  assert.match(elements['#explorer-results'].innerHTML, /Known April Trail/);
  assert.doesNotMatch(elements['#explorer-results'].innerHTML, /Expensive August Trail/);
  assert.doesNotMatch(elements['#explorer-results'].innerHTML, /Unknown Data Trail/);

  elements['#explorer-reset'].dispatch('click');
  elements['#explorer-month'].value = '04';
  elements['#explorer-month'].dispatch('change');
  assert.match(elements['#explorer-results'].innerHTML, /Known April Trail/);
  assert.doesNotMatch(elements['#explorer-results'].innerHTML, /Unknown Data Trail/);

  elements['#explorer-reset'].dispatch('click');
  elements['#explorer-registration-status'].value = 'unknown';
  elements['#explorer-registration-status'].dispatch('change');
  assert.match(elements['#explorer-results'].innerHTML, /Unknown Data Trail/);
  assert.doesNotMatch(elements['#explorer-results'].innerHTML, /Known April Trail/);

  elements['#explorer-reset'].dispatch('click');
  elements['#explorer-duration-max'].value = '540';
  elements['#explorer-duration-max'].dispatch('change');
  assert.match(elements['#explorer-results'].innerHTML, /Known April Trail/);
  assert.doesNotMatch(elements['#explorer-results'].innerHTML, /Unknown Data Trail/);
});

test('explorer sorts by distance and can reset filters', async () => {
  const shortRace = raceFixture({
    id: 1,
    name: 'Short Trail',
    date: '2026-06-01',
    distanceKm: 20,
    elevationGainM: 500,
  });
  const longRace = raceFixture({
    id: 2,
    name: 'Long Trail',
    date: '2026-07-01',
    distanceKm: 120,
    elevationGainM: 4000,
  });

  const { elements } = await renderApp({ races: [shortRace, longRace], hash: '#explorer' });
  elements['#explorer-sort'].value = 'distance-desc';
  elements['#explorer-sort'].dispatch('change');

  const sortedHtml = elements['#explorer-results'].innerHTML;
  assert.equal(sortedHtml.indexOf('Long Trail') < sortedHtml.indexOf('Short Trail'), true);

  elements['#explorer-search'].value = 'short';
  elements['#explorer-search'].dispatch('input');
  assert.match(elements['#explorer-results'].innerHTML, /Short Trail/);
  assert.doesNotMatch(elements['#explorer-results'].innerHTML, /Long Trail/);

  elements['#explorer-reset'].dispatch('click');
  assert.equal(elements['#explorer-month'].value, '');
  assert.equal(elements['#explorer-price-max'].value, '');
  assert.equal(elements['#explorer-registration-status'].value, '');
  assert.equal(elements['#explorer-duration-max'].value, '');
  assert.match(elements['#explorer-results'].innerHTML, /Short Trail/);
  assert.match(elements['#explorer-results'].innerHTML, /Long Trail/);
});

test('registration and gpx actions render only when safe data is available', async () => {
  const withActions = raceFixture({
    id: 1,
    name: 'Action Trail',
    registration: {
      priceEur: 45,
      status: 'open',
      lottery: null,
      url: 'https://example.test/register',
    },
    gpx: {
      status: 'available',
      localFile: 'gpx/2026/fixture/action.gpx',
    },
  });
  const invalidAction = raceFixture({
    id: 2,
    name: 'Invalid Action Trail',
    registration: {
      priceEur: null,
      status: 'unknown',
      lottery: null,
      url: 'javascript:alert(1)',
    },
    gpx: {
      status: 'available',
    },
  });

  const { elements } = await renderApp({ races: [withActions, invalidAction], hash: '#explorer' });
  const explorerHtml = elements['#explorer-results'].innerHTML;
  const comparisonHtml = elements['#comparison'].innerHTML;

  assert.match(explorerHtml, /href="https:\/\/example\.test\/register"[\s\S]*?S'inscrire sur le site officiel/);
  assert.match(explorerHtml, /href="\/api\/races\/1\/gpx\/download"[\s\S]*?Télécharger le GPX officiel/);
  assert.doesNotMatch(explorerHtml, /javascript:alert/);
  assert.doesNotMatch(explorerHtml, /\/api\/races\/2\/gpx\/download/);
  assert.match(comparisonHtml, /S'inscrire sur le site officiel/);
  assert.match(comparisonHtml, /Source officielle/);
});

test('favorites persist by sourceId and ignore missing races', async () => {
  const raceA = raceFixture({ id: 1, name: 'Favorite Trail' });
  const raceB = raceFixture({ id: 2, name: 'Second Trail' });
  const storage = storageStub(JSON.stringify([raceA.sourceId, 'missing:race:2026']));

  const { elements } = await renderApp({ races: [raceA, raceB], hash: '#favorites', storage });
  assert.equal(elements['#favorites-count'].textContent, '1 favori');
  assert.match(elements['#favorites-results'].innerHTML, /Favorite Trail/);
  assert.doesNotMatch(elements['#favorites-results'].innerHTML, /Second Trail/);
  assert.match(elements['#favorites-results'].innerHTML, /aria-pressed="true"/);
  assert.equal(storage.value(), JSON.stringify([raceA.sourceId]));

  elements['#favorites-results'].listeners.click({
    target: {
      closest(selector) {
        return selector === '[data-favorite-source-id]'
          ? { dataset: { favoriteSourceId: raceA.sourceId } }
          : null;
      },
    },
  });

  assert.equal(elements['#favorites-count'].textContent, '0 favori');
  assert.match(elements['#favorites-results'].innerHTML, /Aucun favori/);
  assert.equal(storage.value(), JSON.stringify([]));
});

test('favorites tolerate corrupted or unavailable localStorage', async () => {
  const raceA = raceFixture({ id: 1, name: 'Storage Trail' });
  const raceB = raceFixture({ id: 2, name: 'Other Trail' });
  const corrupted = await renderApp({
    races: [raceA, raceB],
    hash: '#favorites',
    storage: storageStub('not json'),
  });

  assert.equal(corrupted.elements['#favorites-count'].textContent, '0 favori');
  assert.match(corrupted.elements['#favorites-results'].innerHTML, /Aucun favori/);

  const unavailable = await renderApp({
    races: [raceA, raceB],
    hash: '#explorer',
    storage: storageStub(null, { throwOnGet: true, throwOnSet: true }),
  });

  unavailable.elements['#explorer-results'].listeners.click({
    target: {
      closest(selector) {
        return selector === '[data-favorite-source-id]'
          ? { dataset: { favoriteSourceId: raceA.sourceId } }
          : null;
      },
    },
  });

  assert.match(unavailable.elements['#explorer-results'].innerHTML, /aria-pressed="true"/);
});

test('course detail renders available sections, labels translations and hides empty data safely', async () => {
  const race = raceFixture({
    id: 7,
    slug: 'fixture-detail-2026',
    sourceId: 'fixture:detail:2026',
    raceType: 'Ultra trail',
    terrainType: 'Montagne',
    nightStart: true,
    polesAllowed: false,
    description: {
      original: 'A demanding mountain loop.',
      originalLanguage: 'en',
      french: 'Une boucle de montagne exigeante.',
      frenchValidated: true,
    },
    registration: { priceEur: null, status: 'unknown', lottery: null, url: 'javascript:alert(1)' },
    checkpoints: [],
    aidStations: [],
    program: [],
    logistics: null,
    rules: { personalAssistanceAllowed: false, minimumWaterLiters: 1 },
    mandatoryEquipment: [{ name: 'Veste imperméable', details: null, category: null }],
    sources: [
      { url: 'https://example.test/race', type: 'official-race-page', retrievedAt: '2026-08-14T00:00:00.000Z' },
      { url: 'javascript:alert(1)', type: 'official-rules', retrievedAt: null },
    ],
    missingOfficialInformation: ['checkpoints', 'aidStations'],
  });

  const { elements, fetchCalls } = await renderApp({ races: [race], pathname: '/courses/fixture-detail-2026' });
  const html = elements['#course-content'].innerHTML;

  assert.equal(fetchCalls.includes('/api/races/slug/fixture-detail-2026'), true);
  assert.equal(elements['#course-view'].hidden, false);
  assert.equal(elements['#compare-view'].hidden, true);
  assert.match(html, /Traduction française validée/);
  assert.match(html, /Une boucle de montagne exigeante/);
  assert.match(html, /Donnée officielle/);
  assert.match(html, /Estimation TrailCompare/);
  assert.match(html, /Veste imperméable/);
  assert.match(html, /Informations officielles manquantes/);
  assert.match(html, /https:\/\/example\.test\/race/);
  assert.doesNotMatch(html, /javascript:alert/);
  assert.doesNotMatch(html, /id="barrieres"/);
  assert.doesNotMatch(html, /id="ravitaillements"/);
  assert.doesNotMatch(html, /id="programme"/);
  assert.doesNotMatch(html, /id="logistique"/);
  assert.doesNotMatch(html, /id="inscription"/);
});

test('tile loading keeps partial OSM tiles and only enables neutral fallback when every tile fails', async () => {
  const raceA = raceFixture({ id: 1 });
  const raceB = raceFixture({ id: 2 });
  const { context } = await renderApp({ races: [raceA, raceB] });
  const createTracker = vm.runInContext('createTileLoadTracker', context);

  const completeShell = elementStub();
  const completeStatus = elementStub();
  const complete = createTracker(completeShell, completeStatus);
  complete.tileLoaded();
  assert.equal(complete.settled(), 'complete');
  assert.equal(completeShell.classList.contains('is-tile-fallback'), false);
  assert.equal(completeStatus.textContent, '');

  const partialShell = elementStub();
  const partialStatus = elementStub();
  const partial = createTracker(partialShell, partialStatus);
  partial.tileLoaded();
  partial.tileFailed();
  assert.equal(partial.settled(), 'partial');
  assert.equal(partialShell.classList.contains('has-tile-errors'), true);
  assert.equal(partialShell.classList.contains('is-tile-fallback'), false);
  assert.match(partialStatus.textContent, /tuiles chargées restent affichées/);

  const fallbackShell = elementStub();
  const fallbackStatus = elementStub();
  const fallback = createTracker(fallbackShell, fallbackStatus);
  fallback.tileFailed();
  fallback.tileFailed();
  assert.equal(fallback.settled(), 'fallback');
  assert.equal(fallbackShell.classList.contains('is-tile-fallback'), true);
  assert.match(fallbackStatus.textContent, /fond neutre/);
  assert.equal(fallback.counts().loadedTiles, 0);
  assert.equal(fallback.counts().failedTiles, 2);
});
