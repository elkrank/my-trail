import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const appSource = await readFile(new URL('../public/app.js', import.meta.url), 'utf8');

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

async function renderApp({ races, comparison = null, hash = '' }) {
  const compareLink = viewLinkStub('compare');
  const explorerLink = viewLinkStub('explorer');
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
    '#explorer-search': elementStub(),
    '#explorer-location': optionStub(),
    '#explorer-date-from': elementStub(),
    '#explorer-date-to': elementStub(),
    '#explorer-elevation': optionStub(),
    '#explorer-distance': optionStub(),
    '#explorer-sort': optionStub(),
    '#explorer-gpx-only': elementStub({ checked: false }),
    '#explorer-reset': elementStub(),
    '#explorer-count': elementStub(),
    '#explorer-results': htmlStub(),
  };
  elements['#explorer-sort'].value = 'date-asc';

  const fetchCalls = [];
  const selectedComparison = comparison ?? { raceA: races[0], raceB: races[1] };
  const context = {
    Blob,
    URL,
    URLSearchParams,
    console,
    document: {
      querySelector(selector) {
        return elements[selector];
      },
      querySelectorAll(selector) {
        return selector === '[data-view-link]' ? [compareLink, explorerLink] : [];
      },
      createElement() {
        return {
          click() {},
        };
      },
    },
    window: {
      location: { href: `http://localhost/${hash}`, hash },
      clearTimeout() {},
      setTimeout() {
        return 1;
      },
      addEventListener() {},
    },
    navigator: {},
    fetch: async (url) => {
      fetchCalls.push(String(url));
      if (url === '/api/races') {
        return jsonResponse({ races });
      }
      if (String(url).startsWith('/api/compare')) {
        return jsonResponse(selectedComparison);
      }
      return jsonResponse({ error: 'not found' }, false);
    },
  };

  vm.createContext(context);
  await vm.runInContext(appSource, context, { timeout: 1000 });
  await Promise.resolve();
  await Promise.resolve();

  return { elements, fetchCalls, links: { compareLink, explorerLink } };
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

function raceFixture(overrides = {}) {
  return {
    id: 9,
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
    startLocation: 'Saint-Jans-Cappel',
    finishLocation: 'Saint-Jans-Cappel',
    timeLimitMinutes: 1110,
    kmEffort: 136.5,
    difficultyScoreV0: 70,
    barrierPressureScoreV0: 59,
    confidence: 'official',
    sourceUrl: 'https://example.test',
    quality: { status: 'partial', missingFields: ['gpx'] },
    illustration: {
      url: 'https://example.test/images/ntmf.jpg',
      alt: 'Nord Trail Monts de Flandres - 115 km',
      sourceUrl: 'https://example.test',
    },
    gpxUrl: null,
    gpx: null,
    aidStations: [],
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
  assert.match(html, /Boescheppe - 74,5 km/);
  assert.match(html, /Aucun checkpoint V0 d.fini pour cette course/);
  assert.match(html, /Trac. GPX non disponible/);
  assert.match(html, /Profil GPX r.el non disponible/);
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
  assert.match(elements['#explorer-results'].innerHTML, /Short Trail/);
  assert.match(elements['#explorer-results'].innerHTML, /Long Trail/);
});
