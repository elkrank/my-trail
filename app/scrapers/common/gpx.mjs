import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve, sep } from "node:path";
import { inflateRawSync } from "node:zlib";
import { fetchText } from "./fetch.mjs";
import { slugify } from "./model.mjs";

export const GPX_NOT_FOUND_WARNING = "GPX officiel non trouvé";

const GPX_ACCEPT = "application/gpx+xml,application/xml,text/xml,application/octet-stream,*/*;q=0.8";
const USER_AGENT = "TrailCompareMVP/0.1 (+https://example.local; official-gpx-scraper)";
const MAP_POINT_TARGET = 700;
const PROFILE_POINT_TARGET = 400;
const ELEVATION_NOISE_THRESHOLD_M = 3;
const GPX_ELEVATION_GAIN_MISMATCH_TOLERANCE_M = 250;
const GPX_ELEVATION_GAIN_MISMATCH_TOLERANCE_RATIO = 0.25;
const WEB_MERCATOR_RADIUS_M = 6378137;

const SOURCE_PRIORITY = new Map([
  ["official-race-page", 1],
  ["official-roadbook", 2],
  ["official-rules", 3],
  ["official-map-platform", 4],
  ["official-gpx", 5],
]);

const TRACE_DE_TRAIL_DOWNLOAD_URL = "https://tracedetrail.fr/download/getFile/tracedetrail";

export async function enrichResultWithGpx(result, { year, outDir = "data", previousResult = null } = {}) {
  const previousByKey = indexPreviousEntries(previousResult);
  const pageCache = new Map();

  for (const entry of result.races ?? []) {
    const previousEntry = previousByKey.get(entryKey(entry));
    await collectGpxForEntry(entry, {
      year,
      outDir,
      previousEntry,
      pageCache,
    });
  }

  return result;
}

export async function collectGpxForEntry(entry, {
  year = entry.edition?.year,
  outDir = "data",
  previousEntry = null,
  pageCache = new Map(),
  fetchImpl = globalThis.fetch,
} = {}) {
  const warnings = (entry.quality?.warnings ?? []).filter((warning) => !isGpxWarning(warning));

  if (["not_published", "not_applicable", "known_none"].includes(entry.edition?.dataAvailability?.gpx?.status)) {
    entry.edition.gpx = null;
    entry.quality = { ...(entry.quality ?? {}), warnings };
    return entry;
  }

  if (
    entry.edition?.gpx?.status === "multi-stage" ||
    asArray(entry.edition?.rawOfficial?.stageTraceUrls).length > 0
  ) {
    return collectMultiStageGpxForEntry(entry, {
      year,
      outDir,
      previousEntry,
      pageCache,
      fetchImpl,
      warnings,
    });
  }

  const candidate = await findGpxCandidate(entry, { pageCache });

  if (!candidate) {
    entry.edition.gpx = null;
    warnings.push(GPX_NOT_FOUND_WARNING);
    entry.quality = { ...(entry.quality ?? {}), warnings };
    return entry;
  }

  const retrievedAt = new Date().toISOString();

  try {
    const downloaded = await downloadGpxCandidate(candidate, {
      fetchImpl,
    });
    const parsed = downloaded.parsed;
    assertGpxDistanceCompatible(entry, parsed);
    assertGpxBoundsCompatible(entry, parsed);
    const fileSlug = raceFileSlug(entry.race);
    const localFile = join("gpx", String(year), entry.event.slug, `${fileSlug}.gpx`).replaceAll("\\", "/");
    const routeAsset = join("generated", "routes", `${entry.event.slug}-${fileSlug}-${year}.json`).replaceAll("\\", "/");
    const sha256 = sha256Hex(downloaded.gpxBuffer);
    const gpxFilePath = join(outDir, localFile);
    const routeAssetPath = join(outDir, routeAsset);
    const downloadUrl = downloaded.displayDownloadUrl ?? downloaded.finalUrl;
    const elevationQuality = assessGpxElevationQuality({
      gpxStatus: "available",
      officialGainM: entry.edition?.elevationGainM,
      computedGainM: parsed.computed?.elevationGainM,
      hasElevation: parsed.hasElevation,
    });
    const routePayload = buildRouteAsset({
      parsed,
      sourceUrl: candidate.sourceUrl,
      downloadUrl,
      localFile,
      sha256,
    });

    await mkdir(dirname(gpxFilePath), { recursive: true });
    await mkdir(dirname(routeAssetPath), { recursive: true });
    await writeFile(gpxFilePath, downloaded.gpxBuffer);
    await writeFile(routeAssetPath, `${JSON.stringify(routePayload, null, 2)}\n`);

    entry.edition.gpxUrl = downloadUrl;
    entry.edition.gpx = {
      status: "available",
      sourceUrl: candidate.sourceUrl,
      downloadUrl,
      downloadMethod: downloaded.request?.method ?? "GET",
      downloadParams: candidate.downloadParams ?? null,
      sourceType: candidate.sourceType,
      sourcePlatform: candidate.sourcePlatform ?? null,
      retrievedAt,
      localFile,
      routeAsset,
      sha256,
      trackCount: parsed.trackCount,
      routeCount: parsed.routeCount,
      pointCount: parsed.pointCount,
      hasElevation: parsed.hasElevation,
      computed: parsed.computed,
      elevationQuality,
    };

    addOfficialGpxSource(entry, {
      url: downloadUrl,
      retrievedAt,
    });
    if (candidate.sourceType === "official-map-platform") {
      addOfficialMapPlatformSource(entry, {
        url: candidate.sourceUrl,
        retrievedAt,
      });
    }

    warnings.push(...buildGpxQualityWarnings(entry, previousEntry));
  } catch (error) {
    const status = error.code === "GPX_UNAVAILABLE" ? "unavailable" : "invalid";
    const previousGpx = previousEntry?.edition?.gpx;

    if (status === "unavailable" && previousGpx?.status === "available") {
      entry.edition.gpxUrl = previousEntry.edition?.gpxUrl ?? entry.edition.gpxUrl;
      entry.edition.gpx = {
        ...previousGpx,
        refreshStatus: "unavailable",
        refreshAttemptedAt: retrievedAt,
        refreshError: error.message,
      };
      warnings.push(`GPX_REFRESH_FAILED: ${error.message}; previous GPX retained`);
    } else {
      entry.edition.gpx = {
        status,
        sourceUrl: candidate.sourceUrl,
        downloadUrl: candidate.downloadUrl,
        sourceType: candidate.sourceType,
        sourcePlatform: candidate.sourcePlatform ?? null,
        retrievedAt,
      };
      if (status === "unavailable") warnings.push(GPX_NOT_FOUND_WARNING);
      warnings.push(`${status === "unavailable" ? "GPX_UNAVAILABLE" : "GPX_INVALID"}: ${error.message}`);
    }
  }

  entry.quality = {
    ...(entry.quality ?? {}),
    warnings,
  };
  return entry;
}

async function collectMultiStageGpxForEntry(entry, {
  year = entry.edition?.year,
  outDir = "data",
  previousEntry = null,
  pageCache = new Map(),
  fetchImpl = globalThis.fetch,
  warnings = [],
} = {}) {
  const stageUrls = asArray(entry.edition?.gpx?.traces ?? entry.edition?.rawOfficial?.stageTraceUrls)
    .filter(isHttpUrl);
  const retrievedAt = new Date().toISOString();

  if (stageUrls.length === 0) {
    entry.edition.gpx = null;
    warnings.push(GPX_NOT_FOUND_WARNING);
    entry.quality = { ...(entry.quality ?? {}), warnings };
    return entry;
  }

  try {
    const stages = [];
    for (const stageUrl of stageUrls) {
      const candidate = await resolveMapPlatformGpxCandidate(stageUrl, entry, { pageCache });
      if (!candidate) {
        throw gpxError("GPX_UNAVAILABLE", `No official stage GPX candidate for ${stageUrl}`);
      }
      const downloaded = await downloadGpxCandidate(candidate, { fetchImpl });
      stages.push({ candidate, downloaded });
    }

    const segments = stages.flatMap((stage) => stage.downloaded.parsed.segments);
    const gpxBuffer = segmentsToGpxBuffer(segments);
    const parsed = analyzeGpxBuffer(gpxBuffer);
    assertGpxDistanceCompatible(entry, parsed);
    assertGpxBoundsCompatible(entry, parsed);

    const fileSlug = raceFileSlug(entry.race);
    const localFile = join("gpx", String(year), entry.event.slug, `${fileSlug}.gpx`).replaceAll("\\", "/");
    const routeAsset = join("generated", "routes", `${entry.event.slug}-${fileSlug}-${year}.json`).replaceAll("\\", "/");
    const sha256 = sha256Hex(gpxBuffer);
    const gpxFilePath = join(outDir, localFile);
    const routeAssetPath = join(outDir, routeAsset);
    const stageSourceUrls = stages.map((stage) => stage.candidate.sourceUrl);
    const stageDownloadUrls = stages.map((stage) => stage.downloaded.displayDownloadUrl ?? stage.downloaded.finalUrl);
    const sourceUrl = stageSourceUrls[0];
    const downloadUrl = stageDownloadUrls[0];
    const elevationQuality = assessGpxElevationQuality({
      gpxStatus: "available",
      officialGainM: entry.edition?.elevationGainM,
      computedGainM: parsed.computed?.elevationGainM,
      hasElevation: parsed.hasElevation,
    });
    const routePayload = buildRouteAsset({
      parsed,
      sourceUrl,
      downloadUrl,
      localFile,
      sha256,
    });

    await mkdir(dirname(gpxFilePath), { recursive: true });
    await mkdir(dirname(routeAssetPath), { recursive: true });
    await writeFile(gpxFilePath, gpxBuffer);
    await writeFile(routeAssetPath, `${JSON.stringify(routePayload, null, 2)}\n`);

    entry.edition.gpxUrl = downloadUrl;
    entry.edition.gpx = {
      status: "available",
      multiStage: true,
      sourceUrl,
      downloadUrl,
      stageSourceUrls,
      stageDownloadUrls,
      downloadMethod: "GET",
      downloadMethods: stages.map((stage) => stage.downloaded.request?.method ?? "GET"),
      downloadParams: stages.map((stage) => stage.candidate.downloadParams ?? null),
      sourceType: "official-map-platform",
      sourcePlatform: stages[0]?.candidate.sourcePlatform ?? null,
      retrievedAt,
      localFile,
      routeAsset,
      sha256,
      trackCount: parsed.trackCount,
      routeCount: parsed.routeCount,
      pointCount: parsed.pointCount,
      hasElevation: parsed.hasElevation,
      computed: parsed.computed,
      elevationQuality,
    };

    addOfficialGpxSource(entry, { url: downloadUrl, retrievedAt });
    for (const url of stageSourceUrls) {
      addOfficialMapPlatformSource(entry, { url, retrievedAt });
    }

    warnings.push("GPX_MULTI_STAGE: merged official stage traces into one multi-segment GPX.");
    warnings.push(...buildGpxQualityWarnings(entry, previousEntry));
  } catch (error) {
    const status = error.code === "GPX_UNAVAILABLE" ? "unavailable" : "invalid";
    entry.edition.gpx = {
      status,
      multiStage: true,
      sourceUrl: stageUrls[0] ?? null,
      downloadUrl: stageUrls[0] ?? null,
      stageSourceUrls: stageUrls,
      sourceType: "official-map-platform",
      sourcePlatform: entry.edition?.gpx?.sourcePlatform ?? null,
      retrievedAt,
    };
    if (status === "unavailable") warnings.push(GPX_NOT_FOUND_WARNING);
    warnings.push(`${status === "unavailable" ? "GPX_UNAVAILABLE" : "GPX_INVALID"}: ${error.message}`);
  }

  entry.quality = {
    ...(entry.quality ?? {}),
    warnings,
  };
  return entry;
}

export async function loadPreviousResult({ outDir = "data", year, eventSlug }) {
  try {
    const content = await readFile(join(outDir, String(year), `${eventSlug}.json`), "utf8");
    return JSON.parse(content);
  } catch {
    return null;
  }
}

export async function findGpxCandidate(entry, { pageCache = new Map() } = {}) {
  const sources = [
    ...(entry.edition?.sources ?? []),
    ...configuredStravaAccountSources(entry),
  ]
    .filter((source) => isHttpUrl(source.url))
    .filter((source) => isOfficialSourceType(source.type))
    .sort((a, b) => sourcePriority(a.type) - sourcePriority(b.type));

  for (const source of sources) {
    if (isSupportedMapPlatformUrl(source.url)) {
      const candidate = await resolveMapPlatformGpxCandidate(source.url, entry, { pageCache });
      if (candidate) return candidate;
      continue;
    }

    if (isLikelyGpxDownloadUrl(source.url) && !isPostOnlyDisplayDownloadUrl(source.url)) {
      return {
        sourceUrl: source.url,
        downloadUrl: source.url,
        sourceType: source.type,
      };
    }

    const page = await cachedFetchText(source.url, pageCache);
    if (!page) continue;

    const links = extractGpxLinks(page.content, page.finalUrl ?? source.url);
    if (links.length > 0) {
      return {
        sourceUrl: page.finalUrl ?? source.url,
        downloadUrl: links[0],
        sourceType: source.type,
      };
    }

    for (const platformUrl of extractMapPlatformLinks(page.content, page.finalUrl ?? source.url)) {
      const candidate = await resolveMapPlatformGpxCandidate(platformUrl, entry, {
        pageCache,
        officiallyLinked: true,
      });
      if (candidate) return candidate;
    }
  }

  if (entry.edition?.gpxUrl && isHttpUrl(entry.edition.gpxUrl) && isSupportedMapPlatformUrl(entry.edition.gpxUrl)) {
    const candidate = await resolveMapPlatformGpxCandidate(entry.edition.gpxUrl, entry, { pageCache });
    if (candidate) return candidate;
  }

  if (entry.edition?.gpxUrl && !isPostOnlyDisplayDownloadUrl(entry.edition.gpxUrl)) {
    const source = firstOfficialPageSource(entry) ?? firstSource(entry);
    return {
      sourceUrl: source?.url ?? entry.edition.gpxUrl,
      downloadUrl: entry.edition.gpxUrl,
      sourceType: source?.type ?? "official-gpx",
    };
  }

  return null;
}

export function extractGpxLinks(html, baseUrl) {
  const links = [];
  const pushUrl = (rawUrl) => {
    if (!rawUrl || rawUrl === "#") return;
    let url;
    try {
      url = new URL(cleanRawUrl(rawUrl), baseUrl).toString();
    } catch {
      return;
    }
    if (!isLikelyGpxDownloadUrl(url)) return;
    if (!links.includes(url)) links.push(url);
  };

  for (const match of String(html ?? "").matchAll(/<(?:a|area|link|iframe|script)[^>]+(?:href|src)=["']([^"']+)["'][^>]*>/gi)) {
    pushUrl(match[1]);
  }

  for (const match of String(html ?? "").matchAll(/https?:\/\/[^\s"'<>]+(?:\.gpx|\.zip|download[^\s"'<>]*gpx)[^\s"'<>]*/gi)) {
    pushUrl(match[0]);
  }

  for (const match of String(html ?? "").matchAll(/<a[^>]+href=["']([^"']+)["'][^>]*>[\s\S]{0,1000}?(?:GPX|trace)[\s\S]{0,200}?<\/a>/gi)) {
    pushUrl(match[1]);
  }

  return links;
}

export function extractMapPlatformLinks(html, baseUrl) {
  const links = [];
  const pushUrl = (rawUrl) => {
    if (!rawUrl || rawUrl === "#") return;
    let url;
    try {
      url = new URL(cleanRawUrl(rawUrl), baseUrl).toString();
    } catch {
      return;
    }
    if (!isSupportedMapPlatformUrl(url)) return;
    if (!links.includes(url)) links.push(url);
  };

  for (const match of String(html ?? "").matchAll(/<(?:a|area|iframe|script)[^>]+(?:href|src)=["']([^"']+)["'][^>]*>/gi)) {
    pushUrl(match[1]);
  }

  for (const match of String(html ?? "").matchAll(/<[^>]+\bdata-embed-type=["']route["'][^>]*\bdata-embed-id=["']([0-9]+)["'][^>]*>/gi)) {
    const routeId = match[1];
    const clubId = extractAttribute(match[0], "data-club-id");
    const query = clubId ? `?clubId=${encodeURIComponent(clubId)}` : "";
    pushUrl(`https://strava-embeds.com/route/${routeId}${query}`);
  }

  for (const match of String(html ?? "").matchAll(/https?:\/\/[^\s"'<>]*(?:pacevisor\.com\/races|tracedetrail\.[^/\s"'<>]+\/[^\s"'<>]*(?:event|trace|iframe)|strava\.com\/(?:routes\/[0-9]+|clubs\/[^/\s"'<>]+|athletes\/[0-9]+)|strava-embeds\.com\/route\/[0-9]+|google\.[^/\s"'<>]+\/maps\/d\/(?:edit|viewer|kml)[^\s"'<>]*|[a-z0-9.-]*livetrail[a-z0-9.-]*\/[^\s"'<>]*(?:races|tracks)[^\s"'<>]*|openrunner\.com)[^\s"'<>]*/gi)) {
    pushUrl(match[0]);
  }

  for (const match of String(html ?? "").matchAll(/https?:\/\/[^\s"'<>]+\/tracks\/[^/\s"'<>]+\.json[^\s"'<>]*/gi)) {
    pushUrl(match[0]);
  }

  return links;
}

export async function resolveMapPlatformGpxCandidate(platformUrl, entry, {
  pageCache = new Map(),
  officiallyLinked = false,
} = {}) {
  if (isGoogleMyMapsUrl(platformUrl)) {
    return resolveGoogleMyMapsGpxCandidate(platformUrl);
  }

  if (/^https?:\/\/(?:www\.)?pacevisor\.com\/races\//i.test(platformUrl)) {
    return resolvePacevisorGpxCandidate(platformUrl, entry, { pageCache });
  }

  if (isLiveTrailTrackJsonUrl(platformUrl)) {
    return resolveLiveTrailTrackGpxCandidate(platformUrl);
  }

  if (isLiveTrailRaceUrl(platformUrl)) {
    return resolveLiveTrailRaceGpxCandidate(platformUrl, entry, { pageCache });
  }

  if (/^https?:\/\/(?:[^/]+\.)?tracedetrail\./i.test(platformUrl)) {
    return resolveTraceDeTrailGpxCandidate(platformUrl, entry, { pageCache });
  }

  if (isStravaRouteUrl(platformUrl)) {
    return resolveStravaRouteGpxCandidate(platformUrl);
  }

  if (isStravaAccountUrl(platformUrl)) {
    return resolveStravaAccountGpxCandidate(platformUrl, entry, { pageCache, officiallyLinked });
  }

  return null;
}

function resolveGoogleMyMapsGpxCandidate(platformUrl) {
  const mapId = extractGoogleMyMapsId(platformUrl);
  if (!mapId) return null;
  const sourceUrl = normalizedAbsoluteUrl(platformUrl) ?? platformUrl;

  return {
    sourceUrl,
    downloadUrl: googleMyMapsKmlUrl(mapId),
    sourceType: "official-map-platform",
    sourcePlatform: "google-my-maps",
  };
}

async function resolvePacevisorGpxCandidate(platformUrl, entry, { pageCache }) {
  const raceId = extractPacevisorRaceId(platformUrl);
  if (!raceId) return null;
  const sourceUrl = normalizedAbsoluteUrl(platformUrl) ?? platformUrl;

  const apiUrl = `https://pacevisor.com/api/races/${encodeURIComponent(raceId)}`;
  const apiResponse = await cachedFetchText(apiUrl, pageCache);
  if (!apiResponse?.content) return null;

  let payload;
  try {
    payload = JSON.parse(apiResponse.content);
  } catch {
    return null;
  }

  if (!payload?.gpxUrl || !raceMatchesPlatformTrace(entry, {
    name: payload.title,
    distanceKm: payload.distance,
    id: payload.id,
  })) {
    return null;
  }

  return {
    sourceUrl,
    downloadUrl: new URL(cleanRawUrl(payload.gpxUrl), sourceUrl).toString(),
    sourceType: "official-map-platform",
    sourcePlatform: "pacevisor",
  };
}

async function resolveLiveTrailRaceGpxCandidate(platformUrl, entry, { pageCache }) {
  const sourceUrl = normalizedAbsoluteUrl(platformUrl);
  if (!sourceUrl) return null;

  const page = await cachedFetchText(sourceUrl, pageCache);
  if (!page?.content) return null;
  if (!raceMatchesPlatformTrace(entry, parseLiveTrailRacePage(page.content, page.finalUrl ?? sourceUrl))) return null;

  const trackUrls = extractLiveTrailTrackJsonLinks(page.content, page.finalUrl ?? sourceUrl);
  if (trackUrls.length === 0) return null;

  return resolveLiveTrailTrackGpxCandidate(trackUrls[0], { sourceUrl });
}

function resolveLiveTrailTrackGpxCandidate(trackUrl, { sourceUrl = trackUrl } = {}) {
  const downloadUrl = normalizedAbsoluteUrl(trackUrl);
  const cleanSourceUrl = normalizedAbsoluteUrl(sourceUrl);
  if (!downloadUrl || !cleanSourceUrl) return null;

  return {
    sourceUrl: cleanSourceUrl,
    downloadUrl,
    sourceType: "official-map-platform",
    sourcePlatform: "livetrail",
  };
}

function extractLiveTrailTrackJsonLinks(html, baseUrl) {
  const links = [];
  const pushUrl = (rawUrl) => {
    try {
      const url = new URL(cleanRawUrl(rawUrl), baseUrl).toString();
      if (isLiveTrailTrackJsonUrl(url) && !links.includes(url)) links.push(url);
    } catch {
      // Ignore non-URL text fragments.
    }
  };

  for (const match of String(html ?? "").matchAll(/https?:\\?\/\\?\/[^\s"'<>]+?\\?\/tracks\\?\/[^\\/\s"'<>]+\.json/gi)) {
    pushUrl(match[0]);
  }

  return links;
}

function parseLiveTrailRacePage(html, pageUrl) {
  const rawTitle = String(html ?? "").match(/<title>([\s\S]*?)<\/title>/i)?.[1] ?? null;
  const name = rawTitle
    ? stripTags(rawTitle).replace(/\s+course\s*$/i, "").trim()
    : null;
  const code = String(pageUrl ?? "").match(/\/races\/([^/?#]+)/i)?.[1] ?? null;

  return {
    id: code,
    name: name || code,
  };
}

async function resolveTraceDeTrailGpxCandidate(platformUrl, entry, { pageCache }) {
  const directTraceId = extractTraceDeTrailTraceId(platformUrl);
  if (directTraceId) {
    const tracePageUrl = normalizedAbsoluteUrl(platformUrl) ?? traceDeTrailTraceUrl(directTraceId);
    const page = await cachedFetchText(tracePageUrl, pageCache);
    const metadata = parseTraceDeTrailTracePage(page?.content ?? "", directTraceId);
    if (!raceMatchesPlatformTrace(entry, metadata)) return null;
    return traceDeTrailDownloadCandidate(directTraceId, tracePageUrl);
  }

  if (!/\/event\//i.test(platformUrl)) return null;

  const eventPage = await cachedFetchText(platformUrl, pageCache);
  if (!eventPage?.content) return null;

  const traces = parseTraceDeTrailEventTraces(eventPage.content);
  const match = traces.find((trace) => raceMatchesPlatformTrace(entry, trace));
  if (!match) return null;

  return traceDeTrailDownloadCandidate(match.id, traceDeTrailTraceUrl(match.id));
}

function traceDeTrailDownloadCandidate(traceId, sourceUrl) {
  const cleanSourceUrl = normalizedAbsoluteUrl(sourceUrl) ?? sourceUrl;
  const params = {
    traceID: String(traceId),
    format: "gpx",
    trace: "1",
    pi: "0",
    waytypes: "0",
    devneg: "0",
    devpos: "0",
    distance: "0",
    dir: "0",
    download: "1",
  };
  const body = new URLSearchParams(params);

  return {
    sourceUrl: cleanSourceUrl,
    downloadUrl: TRACE_DE_TRAIL_DOWNLOAD_URL,
    displayDownloadUrl: `${TRACE_DE_TRAIL_DOWNLOAD_URL}?traceID=${encodeURIComponent(traceId)}&format=gpx`,
    request: {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded;charset=UTF-8",
      },
      body,
    },
    downloadParams: params,
    fallbackDownloads: [
      {
        downloadUrl: cleanSourceUrl,
        displayDownloadUrl: cleanSourceUrl,
      },
    ],
    sourceType: "official-map-platform",
    sourcePlatform: "trace-de-trail",
  };
}

function resolveStravaRouteGpxCandidate(platformUrl) {
  const routeId = extractStravaRouteId(platformUrl);
  if (!routeId) return null;

  return stravaRouteDownloadCandidate(routeId, {
    embedUrl: isStravaRouteEmbedUrl(platformUrl) ? platformUrl : stravaRouteEmbedUrl(routeId),
  });
}

async function resolveStravaAccountGpxCandidate(platformUrl, entry, { pageCache, officiallyLinked }) {
  const accountUrl = canonicalStravaAccountUrl(platformUrl);
  if (!accountUrl) return null;

  const page = await cachedFetchText(accountUrl, pageCache);
  if (!page?.content) return null;
  if (!officiallyLinked && !stravaAccountLinksOfficialWebsite(page.content, entry)) return null;

  const routes = parseStravaAccountRoutes(page.content, page.finalUrl ?? accountUrl);
  const match = routes.find((route) => raceMatchesPlatformTrace(entry, route));
  return match?.id ? stravaRouteDownloadCandidate(match.id) : null;
}

function stravaRouteDownloadCandidate(routeId, { embedUrl = stravaRouteEmbedUrl(routeId) } = {}) {
  return {
    sourceUrl: stravaRouteUrl(routeId),
    downloadUrl: stravaRouteDownloadUrl(routeId),
    fallbackDownloads: [
      { downloadUrl: embedUrl },
    ],
    sourceType: "official-map-platform",
    sourcePlatform: "strava",
  };
}

export function parseStravaAccountRoutes(html, baseUrl) {
  const routesById = new Map();
  const pushRoute = (rawUrl, context = "") => {
    let url;
    try {
      url = new URL(rawUrl, baseUrl).toString();
    } catch {
      return;
    }

    const routeId = extractStravaRouteId(url);
    if (!routeId || routesById.has(routeId)) return;

    routesById.set(routeId, {
      id: routeId,
      name: cleanStravaRouteName(context),
      distanceKm: stravaRouteDistanceFromText(context),
    });
  };

  for (const match of String(html ?? "").matchAll(/<a[^>]+href=["']([^"']*\/routes\/[0-9][^"']*)["'][^>]*>([\s\S]{0,500}?)<\/a>/gi)) {
    pushRoute(match[1], stripTags(match[2]));
  }

  for (const match of String(html ?? "").matchAll(/https?:\/\/[^\s"'<>]+strava\.com\/routes\/[0-9][^\s"'<>]*/gi)) {
    const start = Math.max(0, match.index - 240);
    const end = Math.min(String(html).length, match.index + match[0].length + 240);
    pushRoute(match[0], stripTags(String(html).slice(start, end)));
  }

  return [...routesById.values()];
}

export function parseTraceDeTrailEventTraces(html) {
  return [...String(html ?? "").matchAll(/navlinkEventDownloads[^>]+data-id=["']?(\d+)["']?[\s\S]{0,320}?traceTabDistance[^>]*>([^<]+)[\s\S]{0,180}?traceTabNom[^>]*>([^<]+)/gi)]
    .map((match) => ({
      id: match[1],
      distanceKm: numberFromText(match[2]),
      name: stripTags(match[3]),
    }));
}

function parseTraceDeTrailTracePage(html, traceId) {
  const title = String(html ?? "").match(/<title>\s*(?:Iframe\s+)?Trace de Trail\s*:\s*([^<]+)<\/title>/i)?.[1] ?? null;
  const distance =
    String(html ?? "").match(/traceDistance[^>]*>\s*([^<]+)/i)?.[1] ??
    String(html ?? "").match(/Distance\s*<\/[^>]+>\s*<[^>]+>\s*([^<]+)/i)?.[1] ??
    stripTags(String(html ?? "")).match(/\b([0-9]+(?:[,.][0-9]+)?)\s*km\s+[0-9]+(?:[,.][0-9]+)?\s*m\s+[0-9]+(?:[,.][0-9]+)?\s*m/i)?.[1] ??
    null;

  return {
    id: String(traceId),
    name: title ? stripTags(title) : null,
    distanceKm: numberFromText(distance),
  };
}

function raceMatchesPlatformTrace(entry, trace) {
  const configuredTraceIds = new Set([
    ...(entry.edition?.rawOfficial?.traceIds ?? []),
    entry.edition?.rawOfficial?.traceId,
  ].filter(Boolean).map(String));
  if (trace?.id && configuredTraceIds.has(String(trace.id))) return true;

  const traceDistance = numberOrNull(trace?.distanceKm);
  const officialDistance = numberOrNull(entry.edition?.distanceKm);
  const traceName = normalizeMatchText(trace?.name ?? trace?.id ?? "");
  const names = [entry.race?.shortName, entry.race?.name]
    .map(normalizeMatchText)
    .filter(Boolean);

  const nameMatches = names.some((name) =>
    traceName.includes(name) ||
    name.includes(traceName) ||
    tokenOverlapRatio(name, traceName) >= 0.6,
  );

  if (nameMatches) return true;
  if (!traceDistance || !officialDistance) return false;

  return Math.abs(traceDistance - officialDistance) <= Math.max(2, officialDistance * 0.04);
}

async function downloadGpxCandidate(candidate, { fetchImpl = globalThis.fetch } = {}) {
  const attempts = [
    {
      downloadUrl: candidate.downloadUrl,
      displayDownloadUrl: candidate.displayDownloadUrl,
      request: candidate.request,
    },
    ...(candidate.fallbackDownloads ?? []),
  ].filter((attempt) => isHttpUrl(attempt.downloadUrl));
  let lastError = null;

  for (const attempt of attempts) {
    try {
      const downloaded = await downloadGpx(attempt.downloadUrl, {
        fetchImpl,
        request: attempt.request,
      });
      const parsed = analyzeGpxBuffer(downloaded.gpxBuffer);
      return {
        ...downloaded,
        parsed,
        displayDownloadUrl: attempt.displayDownloadUrl ?? downloaded.finalUrl,
        request: attempt.request ?? null,
      };
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError ?? gpxError("GPX_UNAVAILABLE", "Unable to download GPX");
}

export async function downloadGpx(url, { fetchImpl = globalThis.fetch, request = null } = {}) {
  let response;
  try {
    const headers = {
      accept: GPX_ACCEPT,
      "user-agent": USER_AGENT,
      ...(request?.headers ?? {}),
    };
    response = await fetchImpl(url, {
      method: request?.method ?? "GET",
      headers,
      body: request?.body ?? null,
      redirect: "follow",
      signal: AbortSignal.timeout(20000),
    });
  } catch (error) {
    throw gpxError("GPX_UNAVAILABLE", `Unable to download GPX (${error.message})`);
  }

  if (!response?.ok) {
    throw gpxError("GPX_UNAVAILABLE", `HTTP ${response?.status ?? "unknown"} for GPX download`);
  }

  const buffer = Buffer.from(await response.arrayBuffer());
  const finalUrl = response.url || url;
  const contentType = response.headers?.get?.("content-type") ?? "";
  const downloadedBuffer = shouldTreatAsZip({ buffer, url: finalUrl, contentType })
    ? extractGpxFromZip(buffer)
    : buffer;
  const stravaEmbedGpx = convertStravaRouteEmbedToGpx(downloadedBuffer);
  const traceDeTrailGpx = stravaEmbedGpx ? null : convertTraceDeTrailPageToGpx(downloadedBuffer);
  const liveTrailGpx = stravaEmbedGpx || traceDeTrailGpx ? null : convertLiveTrailTrackJsonToGpx(downloadedBuffer);
  const rawGpxBuffer = stravaEmbedGpx ??
    traceDeTrailGpx ??
    liveTrailGpx ??
    (isKmlBuffer(downloadedBuffer)
    ? convertKmlToGpx(downloadedBuffer)
    : downloadedBuffer);
  const gpxBuffer = normalizeVolatileGpxMetadata(rawGpxBuffer, {
    stripTimes: /tracedetrail/i.test(`${url} ${finalUrl}`),
  });

  return { finalUrl, gpxBuffer };
}

export function normalizeVolatileGpxMetadata(buffer, { stripTimes = false } = {}) {
  const text = stripBom(buffer.toString("utf8"));
  if (!/<gpx\b/i.test(text)) return buffer;
  const times = [...text.matchAll(/<time\b[^>]*>([^<]+)<\/time>/gi)].map((match) => match[1].trim());
  if (!stripTimes && (times.length < 2 || new Set(times).size !== 1)) return buffer;
  if (times.length === 0) return buffer;

  // Trace de Trail exports route-relative timestamps anchored to the download
  // instant. They have no sporting meaning and change on every scrape.
  return Buffer.from(text.replace(/\s*<time\b[^>]*>[^<]+<\/time>/gi, ""), "utf8");
}

export function analyzeGpxBuffer(buffer) {
  rejectKnownNonGpxContent(buffer);
  const text = stripBom(buffer.toString("utf8"));

  if (!validateXmlWellFormed(text)) {
    throw gpxError("GPX_INVALID", "Downloaded file is not well-formed XML");
  }
  if (!/<gpx\b[^>]*>/i.test(text)) {
    throw gpxError("GPX_INVALID", "XML document is not a GPX file");
  }

  const rawSegments = extractGpxSegments(text);
  const pointCount = rawSegments.reduce((sum, segment) => sum + segment.length, 0);
  if (rawSegments.length === 0 || pointCount <= 1) {
    throw gpxError("GPX_INVALID", "GPX has no usable track or route points");
  }

  const segments = addCumulativeDistances(rawSegments);
  const points = segments.flat();
  const elevation = computeElevation(points);
  const distanceKm = points.at(-1)?.distanceKm ?? 0;

  return {
    trackCount: countTag(text, "trk"),
    routeCount: countTag(text, "rte"),
    pointCount,
    hasElevation: elevation.hasElevation,
    segments,
    points,
    computed: {
      distanceKm: round(distanceKm, 2),
      elevationGainM: elevation.hasElevation ? Math.round(elevation.gainM) : null,
      elevationLossM: elevation.hasElevation ? Math.round(elevation.lossM) : null,
      minElevationM: elevation.hasElevation ? Math.round(elevation.minElevationM) : null,
      maxElevationM: elevation.hasElevation ? Math.round(elevation.maxElevationM) : null,
      elevationMethod: elevation.hasElevation
        ? `Cumulative elevation with ${ELEVATION_NOISE_THRESHOLD_M} m noise threshold`
        : null,
    },
  };
}

export function buildRouteAsset({ parsed, sourceUrl, downloadUrl, localFile, sha256 }) {
  const segments = simplifySegments(parsed.segments, MAP_POINT_TARGET).map((segment) =>
    segment.map(publicPoint),
  );
  const elevationProfile = parsed.hasElevation
    ? simplifyPoints(
      parsed.points
        .filter((point) => Number.isFinite(point.ele))
        .map((point) => ({
          distanceKm: round(point.distanceKm, 3),
          elevationM: round(point.ele, 1),
        })),
      PROFILE_POINT_TARGET,
    )
    : [];

  return {
    sourceUrl,
    downloadUrl,
    localFile,
    sha256,
    segments,
    elevationProfile,
    computed: parsed.computed,
  };
}

export function extractGpxFromZip(buffer) {
  let offset = 0;
  let kmlBuffer = null;

  const extractEntry = (method, compressed) => {
    if (method === 0) return compressed;
    if (method === 8) return inflateRawSync(compressed);
    throw gpxError("GPX_INVALID", `Unsupported ZIP compression method ${method}`);
  };

  while (offset + 30 <= buffer.length) {
    const signature = buffer.readUInt32LE(offset);
    if (signature !== 0x04034b50) break;

    const flags = buffer.readUInt16LE(offset + 6);
    const method = buffer.readUInt16LE(offset + 8);
    const compressedSize = buffer.readUInt32LE(offset + 18);
    const fileNameLength = buffer.readUInt16LE(offset + 26);
    const extraLength = buffer.readUInt16LE(offset + 28);
    const nameStart = offset + 30;
    const dataStart = nameStart + fileNameLength + extraLength;
    const dataEnd = dataStart + compressedSize;
    const fileName = buffer.subarray(nameStart, nameStart + fileNameLength).toString("utf8");

    if (flags & 0x08) {
      throw gpxError("GPX_INVALID", "ZIP entries with data descriptors are not supported");
    }
    if (dataEnd > buffer.length) {
      throw gpxError("GPX_INVALID", "ZIP file is truncated");
    }

    if (/\.gpx$/i.test(fileName)) {
      const compressed = buffer.subarray(dataStart, dataEnd);
      return extractEntry(method, compressed);
    }

    if (/\.kml$/i.test(fileName) && !kmlBuffer) {
      const compressed = buffer.subarray(dataStart, dataEnd);
      kmlBuffer = extractEntry(method, compressed);
    }

    offset = dataEnd;
  }

  if (kmlBuffer) return kmlBuffer;

  throw gpxError("GPX_INVALID", "ZIP archive does not contain a GPX or KML file");
}

export function sha256Hex(buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}

function isKmlBuffer(buffer) {
  const head = stripBom(buffer.subarray(0, 4096).toString("utf8"));
  return /<kml\b/i.test(head) && !/<gpx\b/i.test(head);
}

function convertStravaRouteEmbedToGpx(buffer) {
  const text = stripBom(buffer.toString("utf8"));
  if (!/<script\b[^>]*id=["']__ROUTE_DATA__["'][^>]*>/i.test(text)) return null;

  const json = text.match(/<script\b[^>]*id=["']__ROUTE_DATA__["'][^>]*>([\s\S]*?)<\/script>/i)?.[1];
  if (!json) return null;

  let payload;
  try {
    payload = JSON.parse(json);
  } catch {
    throw gpxError("GPX_INVALID", "Strava embed route data is not valid JSON");
  }

  const segment = asArray(payload.coordinates)
    .map((tuple) => {
      const [lon, lat, ele] = asArray(tuple).map(Number);
      return {
        lat,
        lon,
        ele: Number.isFinite(ele) ? ele : null,
      };
    })
    .filter(isUsablePoint);

  if (segment.length <= 1) {
    throw gpxError("GPX_INVALID", "Strava embed has no usable route coordinates");
  }

  return segmentsToGpxBuffer([segment]);
}

function convertTraceDeTrailPageToGpx(buffer) {
  const text = stripBom(buffer.toString("utf8"));
  if (!/initBlocProfilTrace|dataTrace/i.test(text)) return null;

  const geometryJson = extractTraceDeTrailGeometryJson(text);
  if (!geometryJson) return null;

  let geometry;
  try {
    geometry = JSON.parse(geometryJson);
  } catch {
    throw gpxError("GPX_INVALID", "Trace de Trail public geometry is not valid JSON");
  }

  const segment = asArray(geometry)
    .map(traceDeTrailPointToGpxPoint)
    .filter(isUsablePoint);

  if (segment.length <= 1) {
    throw gpxError("GPX_INVALID", "Trace de Trail page has no usable public geometry");
  }

  return segmentsToGpxBuffer([segment]);
}

function convertLiveTrailTrackJsonToGpx(buffer) {
  const text = stripBom(buffer.toString("utf8"));
  if (!/^\s*\{/.test(text) || !/"segments"\s*:/.test(text)) return null;

  let payload;
  try {
    payload = JSON.parse(text);
  } catch {
    throw gpxError("GPX_INVALID", "LiveTrail track JSON is not valid JSON");
  }

  const segments = asArray(payload.segments)
    .map((segment) => asArray(segment?.segment ?? segment?.points ?? segment?.gpx)
      .map(liveTrailPointToGpxPoint)
      .filter(isUsablePoint))
    .filter((segment) => segment.length > 1);

  if (segments.length === 0) {
    throw gpxError("GPX_INVALID", "LiveTrail track JSON has no usable route coordinates");
  }

  return segmentsToGpxBuffer(segments);
}

function liveTrailPointToGpxPoint(point) {
  if (Array.isArray(point)) {
    const coordinates = asArray(point[2]);
    const [lon, lat] = coordinates.map(Number);
    return {
      lat,
      lon,
      ele: firstFiniteNumber(point[1]),
    };
  }

  return {
    lat: Number(point?.lat ?? point?.latitude),
    lon: Number(point?.lng ?? point?.lon ?? point?.longitude),
    ele: firstFiniteNumber(point?.ele, point?.alt, point?.altitude),
  };
}

function extractTraceDeTrailGeometryJson(text) {
  const stringMatch = String(text ?? "").match(/\bgeometry\s*:\s*"((?:\\.|[^"\\])*)"/i);
  if (stringMatch?.[1]) {
    try {
      return JSON.parse(`"${stringMatch[1]}"`);
    } catch {
      try {
        return JSON.parse(`"${stringMatch[1].replace(/\\'/g, "'")}"`);
      } catch {
        throw gpxError("GPX_INVALID", "Trace de Trail public geometry string is not valid JSON");
      }
    }
  }

  const arrayMatch = String(text ?? "").match(/\bgeometry\s*:\s*(\[[\s\S]*?\])\s*[,}]/i);
  return arrayMatch?.[1] ?? null;
}

function traceDeTrailPointToGpxPoint(point) {
  const rawLon = Number(point?.lon ?? point?.lng ?? point?.longitude);
  const rawLat = Number(point?.lat ?? point?.latitude);
  if (!Number.isFinite(rawLon) || !Number.isFinite(rawLat)) {
    return { lat: null, lon: null, ele: null };
  }

  const coordinates = isWgs84Coordinate(rawLon, rawLat)
    ? { lon: rawLon, lat: rawLat }
    : webMercatorToWgs84(rawLon, rawLat);
  const ele = firstFiniteNumber(point?.y0, point?.ele, point?.alt, point?.altitude, point?.z, point?.y);

  return {
    ...coordinates,
    ele,
  };
}

function isWgs84Coordinate(lon, lat) {
  return Math.abs(lon) <= 180 && Math.abs(lat) <= 90;
}

function webMercatorToWgs84(x, y) {
  return {
    lon: (x / WEB_MERCATOR_RADIUS_M) * 180 / Math.PI,
    lat: (2 * Math.atan(Math.exp(y / WEB_MERCATOR_RADIUS_M)) - Math.PI / 2) * 180 / Math.PI,
  };
}

function convertKmlToGpx(buffer) {
  const text = stripBom(buffer.toString("utf8"));
  if (!validateXmlWellFormed(text)) {
    throw gpxError("GPX_INVALID", "Downloaded KML is not well-formed XML");
  }

  const segments = [
    ...extractKmlCoordinateSegments(text),
    ...extractKmlGxTrackSegments(text),
  ].filter((segment) => segment.length > 1);

  if (segments.length === 0) {
    throw gpxError("GPX_INVALID", "KML has no usable LineString coordinates");
  }

  return segmentsToGpxBuffer(segments);
}

function segmentsToGpxBuffer(segments) {
  const trackSegments = segments.map((segment) => `    <trkseg>
${segment.map(kmlPointToGpx).join("\n")}
    </trkseg>`).join("\n");

  return Buffer.from(`<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="TrailCompareMVP" xmlns="http://www.topografix.com/GPX/1/1">
  <trk>
${trackSegments}
  </trk>
</gpx>
`, "utf8");
}

function extractKmlCoordinateSegments(text) {
  return extractTagBlocks(text, "coordinates")
    .map((block) => block
      .trim()
      .split(/\s+/)
      .map((tuple) => {
        const [lon, lat, ele] = tuple.split(",").map(Number);
        return {
          lat,
          lon,
          ele: Number.isFinite(ele) ? ele : null,
        };
      })
      .filter(isUsablePoint));
}

function extractKmlGxTrackSegments(text) {
  return extractTagBlocks(text, "gx:Track")
    .map((block) => extractTagBlocks(block, "gx:coord")
      .map((tuple) => {
        const [lon, lat, ele] = tuple.trim().split(/\s+/).map(Number);
        return {
          lat,
          lon,
          ele: Number.isFinite(ele) ? ele : null,
        };
      })
      .filter(isUsablePoint));
}

function isUsablePoint(point) {
  return Number.isFinite(point.lat) && point.lat >= -90 && point.lat <= 90 &&
    Number.isFinite(point.lon) && point.lon >= -180 && point.lon <= 180;
}

function kmlPointToGpx(point) {
  const ele = Number.isFinite(point.ele) ? `\n        <ele>${point.ele}</ele>` : "";
  return `      <trkpt lat="${point.lat}" lon="${point.lon}">${ele}\n      </trkpt>`;
}

export function assessGpxElevationQuality({
  gpxStatus = "available",
  officialGainM = null,
  computedGainM = null,
  hasElevation = null,
} = {}) {
  const officialGain = numberOrNull(officialGainM);
  const computedGain = numberOrNull(computedGainM);
  const base = {
    status: "unavailable",
    officialGainM: officialGain,
    computedGainM: computedGain,
    deltaM: null,
    deltaPercent: null,
  };

  if (gpxStatus !== "available" || hasElevation === false || computedGain === null) {
    return base;
  }
  if (officialGain === null) {
    return { ...base, status: "unverified" };
  }

  const deltaM = Math.round(Math.abs(officialGain - computedGain));
  const deltaPercent = officialGain > 0 ? round((deltaM / officialGain) * 100, 1) : null;
  const tolerance = gpxElevationGainMismatchToleranceM(officialGain);
  return {
    status: deltaM > tolerance ? "inconsistent" : "consistent",
    officialGainM: officialGain,
    computedGainM: computedGain,
    deltaM,
    deltaPercent,
  };
}

export function gpxElevationGainMismatchToleranceM(officialGainM) {
  const officialGain = numberOrNull(officialGainM);
  return Math.max(
    GPX_ELEVATION_GAIN_MISMATCH_TOLERANCE_M,
    (officialGain ?? 0) * GPX_ELEVATION_GAIN_MISMATCH_TOLERANCE_RATIO,
  );
}
export function buildGpxQualityWarnings(entry, previousEntry = null) {
  const warnings = [];
  const gpx = entry.edition?.gpx;
  if (!gpx || gpx.status !== "available") return warnings;

  const previousSha = previousEntry?.edition?.gpx?.sha256;
  if (previousSha && previousSha !== gpx.sha256) {
    warnings.push(
      `GPX_CHANGED: Le GPX officiel de ${entry.event.name} ${entry.race.shortName} ${entry.edition.year} a changé depuis la dernière collecte.`,
    );
  }

  const officialDistance = numberOrNull(entry.edition.distanceKm);
  const computedDistance = numberOrNull(gpx.computed?.distanceKm);
  if (officialDistance && computedDistance) {
    const delta = Math.abs(officialDistance - computedDistance);
    if (delta > Math.max(5, officialDistance * 0.15)) {
      warnings.push(`GPX_DISTANCE_MISMATCH: official=${officialDistance} computed=${computedDistance}`);
    }
  }

  const elevationQuality = assessGpxElevationQuality({
    gpxStatus: gpx.status,
    officialGainM: entry.edition.elevationGainM,
    computedGainM: gpx.computed?.elevationGainM,
    hasElevation: gpx.hasElevation,
  });
  if (elevationQuality.status === "inconsistent") {
    warnings.push(`GPX_ELEVATION_GAIN_MISMATCH: official=${elevationQuality.officialGainM} computed=${elevationQuality.computedGainM}`);
  }

  return warnings;
}

function assertGpxDistanceCompatible(entry, parsed) {
  const officialDistance = numberOrNull(entry.edition?.distanceKm);
  const computedDistance = numberOrNull(parsed?.computed?.distanceKm);
  if (!computedDistance) return;

  const officialRange = distanceRangeFromText(entry.edition?.rawOfficial?.distanceRangeKm);
  if (!officialDistance && officialRange) {
    const tolerance = Math.max(5, officialRange.max * 0.15);
    if (computedDistance < officialRange.min - tolerance || computedDistance > officialRange.max + tolerance) {
      throw gpxError(
        "GPX_INVALID",
        `GPX distance does not match official distance range (official=${officialRange.min}-${officialRange.max} computed=${computedDistance})`,
      );
    }
    return;
  }

  if (!officialDistance) return;

  const delta = Math.abs(officialDistance - computedDistance);
  const tolerance = Math.max(5, officialDistance * 0.15);
  if (delta > tolerance) {
    throw gpxError(
      "GPX_INVALID",
      `GPX distance does not match official distance (official=${officialDistance} computed=${computedDistance})`,
    );
  }
}

function distanceRangeFromText(value) {
  const numbers = [...String(value ?? "").replaceAll(",", ".").matchAll(/\d+(?:\.\d+)?/g)]
    .map((match) => Number(match[0]))
    .filter(Number.isFinite);
  if (numbers.length < 2) return null;
  return {
    min: Math.min(numbers[0], numbers[1]),
    max: Math.max(numbers[0], numbers[1]),
  };
}

function assertGpxBoundsCompatible(entry, parsed) {
  const bounds = entry.edition?.rawOfficial?.routeBounds;
  if (!bounds) return;

  const minLat = numberOrNull(bounds.minLat);
  const maxLat = numberOrNull(bounds.maxLat);
  const minLon = numberOrNull(bounds.minLon);
  const maxLon = numberOrNull(bounds.maxLon);
  if (![minLat, maxLat, minLon, maxLon].every(Number.isFinite)) return;

  const points = asArray(parsed?.points);
  if (points.length === 0) return;

  const insideCount = points.filter((point) =>
    point.lat >= minLat && point.lat <= maxLat &&
    point.lon >= minLon && point.lon <= maxLon
  ).length;
  if (insideCount / points.length < 0.8) {
    throw gpxError("GPX_INVALID", "GPX route is outside the expected official race area");
  }
}

function isGpxWarning(warning) {
  const value = String(warning ?? "");
  return value === GPX_NOT_FOUND_WARNING || /^GPX[_:]/.test(value);
}

export function resolveDataAssetPath(dataRoot, relativePath) {
  const root = resolve(dataRoot);
  const filePath = resolve(root, relativePath);
  if (filePath !== root && !filePath.startsWith(`${root}${sep}`)) {
    throw new Error("Invalid data asset path");
  }
  return filePath;
}

function extractGpxSegments(text) {
  const segments = [];

  for (const block of extractTagBlocks(text, "trkseg")) {
    const points = parsePointBlock(block, "trkpt");
    if (points.length) segments.push(points);
  }

  if (segments.length === 0) {
    for (const block of extractTagBlocks(text, "trk")) {
      const points = parsePointBlock(block, "trkpt");
      if (points.length) segments.push(points);
    }
  }

  for (const block of extractTagBlocks(text, "rte")) {
    const points = parsePointBlock(block, "rtept");
    if (points.length) segments.push(points);
  }

  return segments;
}

function parsePointBlock(block, tagName) {
  const points = [];
  const pattern = new RegExp(`<${tagName}\\b([^>]*?)(?:\\/\\s*>|>([\\s\\S]*?)<\\/${tagName}>)`, "gi");
  let match;

  while ((match = pattern.exec(block)) !== null) {
    const lat = Number(extractAttribute(match[1], "lat"));
    const lon = Number(extractAttribute(match[1], "lon"));
    const rawEle = extractTagValue(match[2] ?? "", "ele");
    const ele = rawEle === null ? null : Number(rawEle);

    if (!Number.isFinite(lat) || lat < -90 || lat > 90) {
      throw gpxError("GPX_INVALID", "GPX contains an invalid latitude");
    }
    if (!Number.isFinite(lon) || lon < -180 || lon > 180) {
      throw gpxError("GPX_INVALID", "GPX contains an invalid longitude");
    }

    points.push({
      lat,
      lon,
      ele: Number.isFinite(ele) ? ele : null,
    });
  }

  return points;
}

function addCumulativeDistances(rawSegments) {
  let totalDistanceKm = 0;
  return rawSegments.map((segment) => {
    let previous = null;
    return segment.map((point) => {
      if (previous) totalDistanceKm += haversineKm(previous, point);
      previous = point;
      return {
        ...point,
        distanceKm: totalDistanceKm,
      };
    });
  });
}

function computeElevation(points) {
  const elevations = points
    .map((point) => point.ele)
    .filter((value) => Number.isFinite(value));

  if (elevations.length < 2) {
    return {
      hasElevation: false,
      gainM: null,
      lossM: null,
      minElevationM: null,
      maxElevationM: null,
    };
  }

  let gainM = 0;
  let lossM = 0;
  let anchor = elevations[0];
  for (const elevation of elevations.slice(1)) {
    const delta = elevation - anchor;
    if (Math.abs(delta) < ELEVATION_NOISE_THRESHOLD_M) continue;
    if (delta > 0) gainM += delta;
    else lossM += Math.abs(delta);
    anchor = elevation;
  }

  return {
    hasElevation: true,
    gainM,
    lossM,
    minElevationM: Math.min(...elevations),
    maxElevationM: Math.max(...elevations),
  };
}

function validateXmlWellFormed(text) {
  const stack = [];
  const xml = String(text ?? "")
    .replace(/<!\[CDATA\[[\s\S]*?\]\]>/g, "")
    .replace(/<!--[\s\S]*?-->/g, "");
  const tags = xml.match(/<[^>]+>/g);
  if (!tags) return false;

  for (const tag of tags) {
    if (
      tag.startsWith("<?") ||
      tag.startsWith("<!--") ||
      tag.startsWith("<![CDATA[") ||
      tag.startsWith("<!")
    ) {
      continue;
    }

    if (tag.startsWith("</")) {
      const name = tag.slice(2, -1).trim().split(/\s+/)[0];
      if (stack.pop() !== name) return false;
      continue;
    }

    if (tag.endsWith("/>")) continue;

    const name = tag.slice(1, -1).trim().split(/\s+/)[0];
    if (!name) return false;
    stack.push(name);
  }

  return stack.length === 0;
}

function rejectKnownNonGpxContent(buffer) {
  if (buffer.subarray(0, 4).toString("latin1") === "%PDF") {
    throw gpxError("GPX_INVALID", "Downloaded file is a PDF, not GPX");
  }

  const head = stripBom(buffer.subarray(0, 4096).toString("utf8")).toLowerCase();
  if (/^\s*\{/.test(head) && /connectez-vous|login|authent/i.test(head)) {
    throw gpxError("GPX_UNAVAILABLE", "Official GPX download requires authentication");
  }
  if (/<html\b|<!doctype\s+html\b/i.test(head) && /strava/i.test(head) && /connectez-vous|log in|login|sign in|connexion|authent|export/i.test(head)) {
    throw gpxError("GPX_UNAVAILABLE", "Official GPX download requires authentication");
  }
  if (/<html\b|<!doctype\s+html\b|<form\b[^>]*(login|connexion)|<title>.*(login|connexion|error|erreur)/i.test(head)) {
    throw gpxError("GPX_INVALID", "Downloaded file is HTML, not GPX");
  }
}

function extractTagBlocks(text, tagName) {
  return [...text.matchAll(new RegExp(`<${tagName}\\b[^>]*>([\\s\\S]*?)<\\/${tagName}>`, "gi"))]
    .map((match) => match[1]);
}

function countTag(text, tagName) {
  return [...text.matchAll(new RegExp(`<${tagName}\\b`, "gi"))].length;
}

function extractAttribute(attributes, name) {
  const match = String(attributes ?? "").match(new RegExp(`\\b${name}\\s*=\\s*["']([^"']+)["']`, "i"));
  return match?.[1] ?? null;
}

function extractTagValue(body, tagName) {
  const match = String(body ?? "").match(new RegExp(`<${tagName}\\b[^>]*>([^<]+)<\\/${tagName}>`, "i"));
  return match?.[1] ?? null;
}

function simplifySegments(segments, target) {
  const total = segments.reduce((sum, segment) => sum + segment.length, 0);
  if (total <= target) return segments;
  const step = Math.ceil(total / target);
  return segments.map((segment) => simplifyPointsByStep(segment, step));
}

function simplifyPoints(points, target) {
  if (points.length <= target) return points;
  return simplifyPointsByStep(points, Math.ceil(points.length / target));
}

function simplifyPointsByStep(points, step) {
  if (points.length <= 2) return points;
  const simplified = points.filter((_point, index) => index % step === 0);
  const lastPoint = points[points.length - 1];
  if (simplified[simplified.length - 1] !== lastPoint) simplified.push(lastPoint);
  return simplified;
}

function publicPoint(point) {
  return {
    lat: round(point.lat, 6),
    lon: round(point.lon, 6),
    ele: Number.isFinite(point.ele) ? round(point.ele, 1) : null,
    distanceKm: round(point.distanceKm, 3),
  };
}

function addOfficialGpxSource(entry, { url, retrievedAt }) {
  const sources = entry.edition.sources ?? [];
  if (sources.some((source) => source.type === "official-gpx" && source.url === url)) return;
  sources.push({
    url,
    type: "official-gpx",
    retrievedAt,
    event: entry.event.name,
    race: entry.race.shortName,
  });
  entry.edition.sources = sources;
}

function addOfficialMapPlatformSource(entry, { url, retrievedAt }) {
  const sources = entry.edition.sources ?? [];
  if (sources.some((source) => source.type === "official-map-platform" && source.url === url)) return;
  sources.push({
    url,
    type: "official-map-platform",
    retrievedAt,
    event: entry.event.name,
    race: entry.race.shortName,
  });
  entry.edition.sources = sources;
}

async function cachedFetchText(url, pageCache) {
  if (!pageCache.has(url)) {
    pageCache.set(
      url,
      fetchText(url).catch(() => null),
    );
  }
  return pageCache.get(url);
}

function firstOfficialPageSource(entry) {
  return (entry.edition?.sources ?? []).find((source) => source.type === "official-race-page");
}

function firstSource(entry) {
  return entry.edition?.sources?.[0] ?? null;
}

function configuredStravaAccountSources(entry) {
  return asArray(entry.edition?.rawOfficial?.stravaAccountUrls)
    .filter((url) => isHttpUrl(url) && isStravaAccountUrl(url))
    .map((url) => ({
      url,
      type: "official-map-platform",
      retrievedAt: null,
      event: entry.event?.name ?? null,
      race: entry.race?.shortName ?? entry.race?.name ?? null,
    }));
}

function indexPreviousEntries(previousResult) {
  const output = new Map();
  for (const entry of previousResult?.races ?? []) {
    output.set(entryKey(entry), entry);
  }
  return output;
}

function entryKey(entry) {
  return `${entry.event?.slug ?? entry.event?.id}:${entry.race?.id}:${entry.edition?.year}`;
}

function raceFileSlug(race) {
  return slugify(race.shortName ?? race.name ?? race.id);
}

function extractPacevisorRaceId(url) {
  try {
    const parsed = new URL(cleanRawUrl(url));
    const match = parsed.pathname.match(/\/races\/([^/?#]+)/i);
    return match?.[1] ? decodeURIComponent(match[1]) : null;
  } catch {
    return null;
  }
}

function extractTraceDeTrailTraceId(url) {
  try {
    const parsed = new URL(cleanRawUrl(url));
    const match =
      parsed.pathname.match(/\/trace(?:3d)?\/(\d+)/i) ??
      parsed.pathname.match(/\/orga\d*\/trace\/(\d+)/i) ??
      parsed.pathname.match(/\/iframe\/(\d+)/i);
    return match?.[1] ?? null;
  } catch {
    return null;
  }
}

function traceDeTrailTraceUrl(traceId) {
  return `https://tracedetrail.fr/fr/trace/${traceId}`;
}

function isGoogleMyMapsUrl(url) {
  return extractGoogleMyMapsId(url) !== null;
}

function extractGoogleMyMapsId(url) {
  try {
    const parsed = new URL(cleanRawUrl(url));
    if (!/(^|\.)google\.[a-z.]+$/i.test(parsed.hostname)) return null;
    if (!/^\/maps\/d\/(?:edit|viewer|kml)/i.test(parsed.pathname)) return null;
    return parsed.searchParams.get("mid");
  } catch {
    return null;
  }
}

function googleMyMapsKmlUrl(mapId) {
  const params = new URLSearchParams({
    mid: mapId,
    forcekml: "1",
  });
  return `https://www.google.com/maps/d/kml?${params.toString()}`;
}

function isLiveTrailRaceUrl(url) {
  try {
    const parsed = new URL(cleanRawUrl(url));
    return /(^|\.)livetrail\.net$/i.test(parsed.hostname) &&
      /\/(?:[a-z]{2}\/)?[0-9]{4}\/races\/[^/?#]+/i.test(parsed.pathname);
  } catch {
    return false;
  }
}

function isLiveTrailTrackJsonUrl(url) {
  try {
    const parsed = new URL(cleanRawUrl(url));
    return /livetrail/i.test(parsed.hostname) &&
      /\/tracks\/[^/?#]+\.json$/i.test(parsed.pathname);
  } catch {
    return false;
  }
}

function isStravaAccountUrl(url) {
  return canonicalStravaAccountUrl(url) !== null;
}

function isStravaRouteUrl(url) {
  return extractStravaRouteId(url) !== null;
}

function isStravaRouteEmbedUrl(url) {
  try {
    const parsed = new URL(cleanRawUrl(url));
    return /^strava-embeds\.com$/i.test(parsed.hostname) && /^\/route\/[0-9]+/i.test(parsed.pathname);
  } catch {
    return false;
  }
}

function canonicalStravaAccountUrl(url) {
  try {
    const parsed = new URL(cleanRawUrl(url));
    if (!/(^|\.)strava\.com$/i.test(parsed.hostname)) return null;

    const clubMatch = parsed.pathname.match(/^\/clubs\/([^/?#]+)/i);
    if (clubMatch?.[1]) {
      return `https://www.strava.com/clubs/${encodeURIComponent(decodeURIComponent(clubMatch[1]))}`;
    }

    const athleteMatch = parsed.pathname.match(/^\/athletes\/([0-9]+)/i);
    if (athleteMatch?.[1]) {
      return `https://www.strava.com/athletes/${encodeURIComponent(athleteMatch[1])}`;
    }

    return null;
  } catch {
    return null;
  }
}

function extractStravaRouteId(url) {
  try {
    const parsed = new URL(cleanRawUrl(url));
    if (/(^|\.)strava\.com$/i.test(parsed.hostname)) {
      const match = parsed.pathname.match(/^\/routes\/([0-9]+)/i);
      return match?.[1] ?? null;
    }
    if (/^strava-embeds\.com$/i.test(parsed.hostname)) {
      const match = parsed.pathname.match(/^\/route\/([0-9]+)/i);
      return match?.[1] ?? null;
    }
    return null;
  } catch {
    return null;
  }
}

function stravaRouteUrl(routeId) {
  return `https://www.strava.com/routes/${encodeURIComponent(routeId)}`;
}

function stravaRouteDownloadUrl(routeId) {
  return `${stravaRouteUrl(routeId)}/export_gpx`;
}

function stravaRouteEmbedUrl(routeId) {
  return `https://strava-embeds.com/route/${encodeURIComponent(routeId)}`;
}

function stravaAccountLinksOfficialWebsite(html, entry) {
  const officialHosts = officialWebsiteHosts(entry);
  if (officialHosts.length === 0) return false;

  for (const url of extractHttpUrls(html)) {
    const host = normalizedHost(url);
    if (host && officialHosts.some((officialHost) => host === officialHost || host.endsWith(`.${officialHost}`))) {
      return true;
    }
  }

  const text = stripTags(html).toLowerCase();
  return officialHosts.some((host) => text.includes(host));
}

function officialWebsiteHosts(entry) {
  return [
    entry.event?.officialWebsite,
    ...asArray(entry.edition?.rawOfficial?.officialWebsites),
  ]
    .map(normalizedHost)
    .filter(Boolean);
}

function normalizedHost(value) {
  try {
    return new URL(cleanRawUrl(value)).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return null;
  }
}

function extractHttpUrls(html) {
  const urls = [];
  const pushUrl = (rawUrl) => {
    try {
      const url = new URL(rawUrl);
      if (["http:", "https:"].includes(url.protocol)) urls.push(url.href);
    } catch {
      // Ignore non-URL text fragments.
    }
  };

  for (const match of String(html ?? "").matchAll(/(?:href|content)=["'](https?:\/\/[^"']+)["']/gi)) {
    pushUrl(match[1]);
  }
  for (const match of String(html ?? "").matchAll(/https?:\/\/[^\s"'<>]+/gi)) {
    pushUrl(match[0]);
  }

  return urls;
}

function shouldTreatAsZip({ buffer, url, contentType }) {
  return (
    buffer.subarray(0, 4).equals(Buffer.from([0x50, 0x4b, 0x03, 0x04])) ||
    /\.zip(?:[?#]|$)/i.test(url) ||
    /zip/i.test(contentType)
  );
}

function isLikelyGpxDownloadUrl(url) {
  return (
    /\.(?:gpx|zip)(?:[?#]|$)/i.test(url) ||
    /(?:download|telecharger|télécharger)[^?#]*(?:gpx|trace)/i.test(url) ||
    /(?:gpx|trace)[^?#]*(?:download|telecharger|télécharger)/i.test(url)
  );
}

function isPostOnlyDisplayDownloadUrl(url) {
  try {
    const parsed = new URL(cleanRawUrl(url));
    return /(^|\.)tracedetrail\./i.test(parsed.hostname) &&
      /\/download\/getFile\/tracedetrail/i.test(parsed.pathname);
  } catch {
    return false;
  }
}

function isSupportedMapPlatformUrl(url) {
  try {
    const parsed = new URL(cleanRawUrl(url));
    const host = parsed.hostname.toLowerCase();
    return (
      host === "pacevisor.com" && /^\/races\//i.test(parsed.pathname) ||
      /(^|\.)tracedetrail\./i.test(host) && /\/(?:event|trace|trace3d|iframe|orga\d*\/trace)\//i.test(parsed.pathname) ||
      /(^|\.)strava\.com$/i.test(host) && /^\/(?:routes\/[0-9]+|clubs\/[^/?#]+|athletes\/[0-9]+)/i.test(parsed.pathname) ||
      host === "strava-embeds.com" && /^\/route\/[0-9]+/i.test(parsed.pathname) ||
      /(^|\.)google\.[a-z.]+$/i.test(host) && /^\/maps\/d\/(?:edit|viewer|kml)/i.test(parsed.pathname) && parsed.searchParams.has("mid") ||
      isLiveTrailRaceUrl(parsed.href) ||
      isLiveTrailTrackJsonUrl(parsed.href)
    );
  } catch {
    return false;
  }
}

function isOfficialSourceType(type) {
  return typeof type === "string" && type.startsWith("official-");
}

function isHttpUrl(value) {
  try {
    const url = new URL(cleanRawUrl(value));
    return ["http:", "https:"].includes(url.protocol);
  } catch {
    return false;
  }
}

function sourcePriority(type) {
  return SOURCE_PRIORITY.get(type) ?? 99;
}

function haversineKm(a, b) {
  const radiusKm = 6371.0088;
  const dLat = toRadians(b.lat - a.lat);
  const dLon = toRadians(b.lon - a.lon);
  const lat1 = toRadians(a.lat);
  const lat2 = toRadians(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * radiusKm * Math.asin(Math.sqrt(h));
}

function toRadians(value) {
  return (value * Math.PI) / 180;
}

function stripBom(value) {
  return String(value ?? "").replace(/^\uFEFF/, "");
}

function cleanRawUrl(value) {
  return decodeHtmlEntities(String(value ?? ""))
    .replace(/\\\//g, "/")
    .trim()
    .replace(/[\\)\],.]+$/g, "");
}

function decodeHtmlEntities(value) {
  return String(value ?? "")
    .replace(/&amp;/gi, "&")
    .replace(/&#38;/gi, "&")
    .replace(/&#x26;/gi, "&")
    .replace(/&quot;/gi, "\"")
    .replace(/&#34;/gi, "\"")
    .replace(/&#x22;/gi, "\"");
}

function normalizedAbsoluteUrl(value) {
  try {
    return new URL(cleanRawUrl(value)).toString();
  } catch {
    return null;
  }
}

function numberOrNull(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === "string" && value.trim() === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function numberFromText(value) {
  const match = String(value ?? "").replace(",", ".").match(/\d+(?:\.\d+)?/);
  return match ? Number(match[0]) : null;
}

function stravaRouteDistanceFromText(value) {
  const text = String(value ?? "").replace(",", ".");
  const km = text.match(/\b([0-9]+(?:\.[0-9]+)?)\s*km\b/i);
  if (km) return Number(km[1]);

  const miles = text.match(/\b([0-9]+(?:\.[0-9]+)?)\s*mi(?:les?)?\b/i);
  if (miles) return round(Number(miles[1]) * 1.609344, 1);

  return null;
}

function stripTags(value) {
  return String(value ?? "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

function cleanStravaRouteName(value) {
  const cleaned = String(value ?? "")
    .replace(/https?:\/\/\S+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return cleaned || null;
}

function asArray(value) {
  if (value === null || value === undefined) return [];
  return Array.isArray(value) ? value : [value];
}

function firstFiniteNumber(...values) {
  for (const value of values) {
    if (value === null || value === undefined) continue;
    if (typeof value === "string" && value.trim() === "") continue;
    const number = Number(value);
    if (Number.isFinite(number)) return number;
  }
  return null;
}

function normalizeMatchText(value) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\b(?:trail|course|km|des|du|de|la|le|les|l)\b/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function tokenOverlapRatio(a, b) {
  const left = new Set(String(a).split(/\s+/).filter((token) => token.length > 2));
  const right = new Set(String(b).split(/\s+/).filter((token) => token.length > 2));
  if (left.size === 0 || right.size === 0) return 0;

  let overlap = 0;
  for (const token of left) {
    if (right.has(token)) overlap += 1;
  }
  return overlap / Math.min(left.size, right.size);
}

function round(value, decimals) {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

function gpxError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}
