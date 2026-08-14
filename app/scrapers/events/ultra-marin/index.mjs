import { fetchText } from "../../common/fetch.mjs";
import {
  checkpointFromCutoff,
  localDateTimeFromIso,
  sortCheckpoints,
} from "../../common/cutoffs.mjs";
import {
  createEdition,
  createEvent,
  createIllustration,
  createRace,
  createRaceEntry,
  createSource,
  sourceFromFetch,
} from "../../common/model.mjs";
import {
  extractIllustration,
  extractRegistrationUrl,
  parseDate,
  parseDurationToMinutes,
  parseTime,
  stripHtml,
  decodeHtmlEntities,
} from "../../common/parse.mjs";

const BASE_URL = "https://www.ultra-marin.fr";
const LIVETRAIL_BASE_URL = "https://ultramarin-breizhchrono.v3.livetrail.net";

export const ULTRA_MARIN_RACES = [
  {
    slug: "grand-raid",
    path: "/grand-raid-ultramarin",
    liveTrailRaceCode: "GdRaid",
    name: "Grand Raid",
    shortName: "Grand Raid",
    raceType: "solo",
  },
  {
    slug: "grand-relais",
    path: "/grand-relais-175km",
    liveTrailRaceCode: "Relais",
    name: "Grand Relais",
    shortName: "Grand Relais",
    raceType: "relay",
    startTimeOverride: "20:00",
    warnings: ["Official page states a Grand Relais start-time change to 20:00; the public date field is not explicit."],
  },
  {
    slug: "raid",
    path: "/raid-ultramarin",
    liveTrailRaceCode: "Raid",
    name: "Raid",
    shortName: "Raid",
    raceType: "solo",
  },
  {
    slug: "reveil-des-ducs",
    path: "/le-r%C3%A9veil-des-ducs-70km",
    liveTrailRaceCode: "Ducs",
    name: "Le Réveil des Ducs",
    shortName: "Réveil des Ducs",
    raceType: "solo",
  },
  {
    slug: "arvor",
    path: "/trail-ultramarin",
    liveTrailRaceCode: "Arvor",
    name: "L'Arvor",
    shortName: "L'Arvor",
    raceType: "solo",
  },
  {
    slug: "ronde-des-douaniers",
    path: "/rondedesdouaniers-ultramarin",
    liveTrailRaceCode: "RondeDD",
    name: "Ronde des Douaniers",
    shortName: "Ronde des Douaniers",
    raceType: "solo",
  },
  {
    slug: "course-des-marins",
    path: "/coursesdesmarins-12k",
    liveTrailRaceCode: "Marins",
    name: "Course des Marins",
    shortName: "Course des Marins",
    raceType: "solo",
  },
];

export async function collect({ year }) {
  const event = createEvent({
    id: "ultra-marin",
    name: "Ultra Marin",
    slug: "ultra-marin",
    country: "France",
    region: "Bretagne",
    city: "Vannes",
    officialWebsite: BASE_URL,
  });

  const sourceErrors = [];
  const races = [];

  for (const raceConfig of ULTRA_MARIN_RACES) {
    const url = new URL(raceConfig.path, BASE_URL).href;
    try {
      const page = await fetchText(url);
      let liveTrailPage = null;
      if (raceConfig.liveTrailRaceCode) {
        const liveTrailUrl = liveTrailRaceUrl(raceConfig.liveTrailRaceCode, year);
        try {
          liveTrailPage = await fetchText(liveTrailUrl);
        } catch (error) {
          sourceErrors.push({ url: liveTrailUrl, message: error.message, status: error.status ?? null });
        }
      }
      races.push(buildUltraMarinEntry({ event, raceConfig, page, liveTrailPage, year }));
    } catch (error) {
      sourceErrors.push({ url, message: error.message, status: error.status ?? null });
    }
  }

  return { event, sourceErrors, races };
}

export function buildUltraMarinEntry({ event, raceConfig, page, liveTrailPage = null, year }) {
  const parsed = parseUltraMarinRacePage(page.content, { year });
  const liveTrail = parseLiveTrailRacePage(liveTrailPage?.content ?? "", raceConfig.liveTrailRaceCode);
  const race = createRace(event, {
    id: `${event.id}-${raceConfig.slug}`,
    name: raceConfig.name,
    shortName: raceConfig.shortName,
  });
  const registrationUrl = extractRegistrationUrl(page.content, page.finalUrl ?? page.url);
  const sources = [
    sourceFromFetch(page, {
      type: "official-race-page",
      event: event.name,
      race: race.shortName,
    }),
  ];

  if (registrationUrl) {
    sources.push(sourceFromUrl(registrationUrl, {
      type: "official-registration",
      retrievedAt: page.retrievedAt,
      event: event.name,
      race: race.shortName,
    }));
  }
  if (raceConfig.liveTrailRaceCode) {
    sources.push(liveTrailPage
      ? sourceFromFetch(liveTrailPage, {
        type: "official-map-platform",
        event: event.name,
        race: race.shortName,
      })
      : sourceFromUrl(liveTrailRaceUrl(raceConfig.liveTrailRaceCode, year), {
        type: "official-map-platform",
        retrievedAt: page.retrievedAt,
        event: event.name,
        race: race.shortName,
      }));
  }

  const illustration = createIllustration({
    url: extractIllustration(page.content, page.finalUrl ?? page.url),
    sourceUrl: page.finalUrl ?? page.url,
    event: event.name,
    race: race.shortName,
  });
  const date = parsed.date ?? liveTrail.date;
  const startTime = raceConfig.startTimeOverride ?? parsed.startTime ?? liveTrail.startTime;
  const checkpoints = liveTrail.checkpoints.length ? liveTrail.checkpoints : buildFinishCheckpoint({
    name: "Arrivee",
    distanceKm: parsed.distanceKm,
    maxDurationMinutes: parsed.maxDurationMinutes,
  });

  const edition = createEdition(year, {
    date,
    startTime,
    distanceKm: parsed.distanceKm,
    elevationGainM: parsed.elevationGainM,
    elevationLossM: null,
    startLocation: parsed.startLocation,
    finishLocation: parsed.finishLocation ?? "Vannes",
    maxDurationMinutes: parsed.maxDurationMinutes ?? liveTrail.maxDurationMinutes,
    raceType: raceConfig.raceType,
    terrainType: "trail",
    terrainDescription: parsed.description,
    nightStart: startTime ? startTime < "06:00" || startTime >= "20:00" : null,
    illustration,
    registration: {
      status: parsed.registrationStatus,
      url: registrationUrl,
    },
    checkpoints,
    aidStations: [],
    sources,
  });

  const entry = createRaceEntry({ event, race, edition });
  entry.quality.warnings = [
    ...(raceConfig.warnings ?? []),
    ...parsed.warnings,
    ...liveTrail.warnings,
  ];
  return entry;
}

export function parseUltraMarinRacePage(html, { year = 2026 } = {}) {
  const text = stripHtml(html).replace(/\u200b/g, " ");
  const oneLine = text.replace(/\s+/g, " ");
  const dateText = valueAfterLabel(oneLine, /D\s*ate/i, [
    /D[ée]part/i,
    /D[ée]nivel[ée]/i,
    /Temps maximum/i,
    /Retrait dossard/i,
  ]);
  const startLocation = valueAfterLabel(oneLine, /D[ée]part/i, [
    /D[ée]nivel[ée]/i,
    /Temps maximum/i,
    /Retrait dossard/i,
    /Cat[ée]gories/i,
  ]);
  const description = safePresentationDescription(text);
  const warnings = [];

  if (/annul[ée]/i.test(text)) {
    warnings.push("Official page states this 2026 race was cancelled.");
  }
  if (/LE PARCOURS 2026[\s\S]{0,220}provisoire/i.test(text)) {
    warnings.push("Official page states the 2026 route was provisional when published.");
  }
  if (/points? des ravitaillements? (?:sont )?[aà] venir/i.test(text)) {
    warnings.push("Official page says aid stations are forthcoming; none were extracted.");
  }
  if (dateText && /communiqu[ée]e prochainement/i.test(dateText)) {
    warnings.push("Official page does not publish a confirmed 2026 race date in text.");
  }

  return {
    date: parseDate(dateText, year),
    startTime: parseTime(dateText),
    distanceKm: metricNumber(oneLine.match(/D\s*i\s*sta\s*nce\s+([0-9]+(?:[,.][0-9]+)?)\s*KM/i)?.[1]),
    elevationGainM: metricNumber(oneLine.match(/D[ée]nivel[ée]\s+([0-9\s]+)\s*m\s*D\+/i)?.[1]),
    startLocation: cleanValue(startLocation),
    finishLocation: /arriv[ée]e(?: de la course)? se feront?[^.]*Vannes/i.test(text) ? "Vannes" : null,
    maxDurationMinutes: parseDurationToMinutes(
      oneLine.match(/Temps maximum\s+([0-9]{1,3}\s*h(?:\s*[0-9]{1,2})?)/i)?.[1],
    ),
    registrationStatus: /Course compl[èe]te/i.test(text) ? "closed" : null,
    description,
    warnings,
  };
}

function buildFinishCheckpoint({ name, distanceKm, maxDurationMinutes }) {
  if (!Number.isFinite(distanceKm) || !Number.isFinite(maxDurationMinutes)) return [];
  return [{
    name,
    distanceKm,
    elevationGainFromStartM: null,
    cutoffDateTime: null,
    cutoffElapsedMinutes: maxDurationMinutes,
    aidStation: false,
    personalAssistanceAllowed: null,
  }];
}

function valueAfterLabel(text, labelPattern, stopPatterns) {
  const label = labelPattern.source;
  const stop = stopPatterns.map((pattern) => pattern.source).join("|");
  const match = text.match(new RegExp(`${label}\\s+([\\s\\S]{0,120}?)(?=\\s+(?:${stop})|$)`, "i"));
  return cleanValue(match?.[1]);
}

function safePresentationDescription(text) {
  const section = firstPresentationParagraph(text);
  if (/\b20(2[0-5]|27)\b/.test(section ?? "")) return null;
  return section;
}

function firstPresentationParagraph(text) {
  const match = text.match(/PR[ÉE]SENTATION\s+([\s\S]{40,900}?)(?:R[ÈE]GLEMENT|R[ÉE]SULTATS|MODALIT[ÉE]S|LE PARCOURS|PARCOURS|TABLEAU DE BORD)/i);
  return cleanValue(match?.[1]);
}

function metricNumber(value) {
  if (!value) return null;
  const number = Number.parseFloat(String(value).replace(/\s+/g, "").replace(",", "."));
  return Number.isFinite(number) ? number : null;
}

function cleanValue(value) {
  const cleaned = String(value ?? "")
    .replace(/\u200b/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return cleaned || null;
}

function sourceFromUrl(url, { type, retrievedAt, event, race }) {
  return createSource({ url, type, retrievedAt, event, race });
}

function liveTrailRaceUrl(code, year) {
  return `${LIVETRAIL_BASE_URL}/fr/${year}/races/${encodeURIComponent(code)}`;
}

export function parseLiveTrailRacePage(html, raceId) {
  if (!html || !raceId) return { date: null, startTime: null, maxDurationMinutes: null, checkpoints: [], warnings: [] };
  const decoded = decodeHtmlEntities(String(html))
    .replace(/\\"/g, "\"")
    .replace(/\\\\\//g, "/");
  const racePattern = new RegExp(`"raceId":"${escapeRegex(raceId)}"[\\s\\S]{0,900}?"startDate":"([^"]+)"`, "i");
  const startDateTime = localDateTimeFromIso(decoded.match(racePattern)?.[1]);
  const checkpoints = [];

  for (const match of decoded.matchAll(/\{[^{}]*"cutoff":"[^"]+"[^{}]*"raceId":"[^"]+"[^{}]*\}/gi)) {
    let point = null;
    try {
      point = JSON.parse(match[0]);
    } catch {
      continue;
    }
    if (point.raceId !== raceId || !point.cutoff) continue;
    const cutoffDateTime = localDateTimeFromIso(point.cutoff);
    const checkpoint = checkpointFromCutoff({
      name: cleanValue(point.name ?? point.shortName),
      distanceKm: Number.isFinite(point.distance) ? round(point.distance / 1000, 2) : null,
      cutoffDateTime,
      startDateTime,
      aidStation: Array.isArray(point.services) && point.services.some((service) => /AID_STATION|DRINK_SUPPLY|FOOD/i.test(service)),
      personalAssistanceAllowed: point.isAssistance === true ? true : null,
    });
    if (checkpoint) checkpoints.push(checkpoint);
  }

  const unique = dedupeLiveTrailCheckpoints(sortCheckpoints(checkpoints));
  const finish = unique.at(-1);
  return {
    date: startDateTime?.slice(0, 10) ?? null,
    startTime: startDateTime?.slice(11, 16) ?? null,
    maxDurationMinutes: finish?.cutoffElapsedMinutes ?? null,
    checkpoints: unique,
    warnings: html && unique.length === 0
      ? ["Official LiveTrail page was found but no cutoff checkpoint was extracted."]
      : [],
  };
}

function dedupeLiveTrailCheckpoints(checkpoints) {
  const seen = new Set();
  return checkpoints.filter((checkpoint) => {
    const key = `${checkpoint.name}:${checkpoint.cutoffDateTime}:${checkpoint.distanceKm}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function escapeRegex(value) {
  return String(value ?? "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function round(value, decimals) {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}
