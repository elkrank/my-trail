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
  const candidate = await findGpxCandidate(entry, { pageCache });

  if (!candidate) {
    entry.edition.gpx = null;
    warnings.push(GPX_NOT_FOUND_WARNING);
    entry.quality = { ...(entry.quality ?? {}), warnings };
    return entry;
  }

  const retrievedAt = new Date().toISOString();

  try {
    const downloaded = await downloadGpx(candidate.downloadUrl, {
      fetchImpl,
      request: candidate.request,
    });
    const parsed = analyzeGpxBuffer(downloaded.gpxBuffer);
    const fileSlug = raceFileSlug(entry.race);
    const localFile = join("gpx", String(year), entry.event.slug, `${fileSlug}.gpx`).replaceAll("\\", "/");
    const routeAsset = join("generated", "routes", `${entry.event.slug}-${fileSlug}-${year}.json`).replaceAll("\\", "/");
    const sha256 = sha256Hex(downloaded.gpxBuffer);
    const gpxFilePath = join(outDir, localFile);
    const routeAssetPath = join(outDir, routeAsset);
    const downloadUrl = candidate.displayDownloadUrl ?? downloaded.finalUrl;
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
      downloadMethod: candidate.request?.method ?? "GET",
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
        retrievedAt,
      };
      warnings.push(`${status === "unavailable" ? "GPX_UNAVAILABLE" : "GPX_INVALID"}: ${error.message}`);
    }
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
  const sources = [...(entry.edition?.sources ?? [])]
    .filter((source) => isHttpUrl(source.url))
    .sort((a, b) => sourcePriority(a.type) - sourcePriority(b.type));

  for (const source of sources) {
    if (isSupportedMapPlatformUrl(source.url)) {
      const candidate = await resolveMapPlatformGpxCandidate(source.url, entry, { pageCache });
      if (candidate) return candidate;
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
      const candidate = await resolveMapPlatformGpxCandidate(platformUrl, entry, { pageCache });
      if (candidate) return candidate;
    }
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
      url = new URL(rawUrl, baseUrl).toString();
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
      url = new URL(rawUrl, baseUrl).toString();
    } catch {
      return;
    }
    if (!isSupportedMapPlatformUrl(url)) return;
    if (!links.includes(url)) links.push(url);
  };

  for (const match of String(html ?? "").matchAll(/<(?:a|area|iframe)[^>]+(?:href|src)=["']([^"']+)["'][^>]*>/gi)) {
    pushUrl(match[1]);
  }

  for (const match of String(html ?? "").matchAll(/https?:\/\/[^\s"'<>]+(?:pacevisor\.com\/races|tracedetrail\.[^/\s"'<>]+\/[^\s"'<>]*(?:event|trace)|openrunner\.com|livetrail\.[^\s"'<>]+)[^\s"'<>]*/gi)) {
    pushUrl(match[0]);
  }

  return links;
}

export async function resolveMapPlatformGpxCandidate(platformUrl, entry, { pageCache = new Map() } = {}) {
  if (/^https?:\/\/(?:www\.)?pacevisor\.com\/races\//i.test(platformUrl)) {
    return resolvePacevisorGpxCandidate(platformUrl, entry, { pageCache });
  }

  if (/^https?:\/\/(?:[^/]+\.)?tracedetrail\./i.test(platformUrl)) {
    return resolveTraceDeTrailGpxCandidate(platformUrl, entry, { pageCache });
  }

  return null;
}

async function resolvePacevisorGpxCandidate(platformUrl, entry, { pageCache }) {
  const raceId = extractPacevisorRaceId(platformUrl);
  if (!raceId) return null;

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
    sourceUrl: platformUrl,
    downloadUrl: new URL(payload.gpxUrl, platformUrl).toString(),
    sourceType: "official-map-platform",
    sourcePlatform: "pacevisor",
  };
}

async function resolveTraceDeTrailGpxCandidate(platformUrl, entry, { pageCache }) {
  const directTraceId = extractTraceDeTrailTraceId(platformUrl);
  if (directTraceId) {
    const tracePageUrl = traceDeTrailTraceUrl(directTraceId);
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
    sourceUrl,
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
    sourceType: "official-map-platform",
    sourcePlatform: "trace-de-trail",
  };
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
  const title = String(html ?? "").match(/<title>\s*Trace de Trail\s*:\s*([^<]+)<\/title>/i)?.[1] ?? null;
  const distance =
    String(html ?? "").match(/traceDistance[^>]*>\s*([^<]+)/i)?.[1] ??
    String(html ?? "").match(/Distance\s*<\/[^>]+>\s*<[^>]+>\s*([^<]+)/i)?.[1] ??
    null;

  return {
    id: String(traceId),
    name: title ? stripTags(title) : null,
    distanceKm: numberFromText(distance),
  };
}

function raceMatchesPlatformTrace(entry, trace) {
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
  const gpxBuffer = shouldTreatAsZip({ buffer, url: finalUrl, contentType })
    ? extractGpxFromZip(buffer)
    : buffer;

  return { finalUrl, gpxBuffer };
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
      if (method === 0) return compressed;
      if (method === 8) return inflateRawSync(compressed);
      throw gpxError("GPX_INVALID", `Unsupported ZIP compression method ${method}`);
    }

    offset = dataEnd;
  }

  throw gpxError("GPX_INVALID", "ZIP archive does not contain a GPX file");
}

export function sha256Hex(buffer) {
  return createHash("sha256").update(buffer).digest("hex");
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

  const officialGain = numberOrNull(entry.edition.elevationGainM);
  const computedGain = numberOrNull(gpx.computed?.elevationGainM);
  if (officialGain && computedGain) {
    const delta = Math.abs(officialGain - computedGain);
    if (delta > Math.max(250, officialGain * 0.25)) {
      warnings.push(`GPX_ELEVATION_GAIN_MISMATCH: official=${officialGain} computed=${computedGain}`);
    }
  }

  return warnings;
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
  const tags = text.match(/<[^>]+>/g);
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
    const parsed = new URL(url);
    const match = parsed.pathname.match(/\/races\/([^/?#]+)/i);
    return match?.[1] ? decodeURIComponent(match[1]) : null;
  } catch {
    return null;
  }
}

function extractTraceDeTrailTraceId(url) {
  try {
    const parsed = new URL(url);
    const match =
      parsed.pathname.match(/\/trace(?:3d)?\/(\d+)/i) ??
      parsed.pathname.match(/\/orga\d*\/trace\/(\d+)/i);
    return match?.[1] ?? null;
  } catch {
    return null;
  }
}

function traceDeTrailTraceUrl(traceId) {
  return `https://tracedetrail.fr/fr/trace/${traceId}`;
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
    const parsed = new URL(url);
    return /(^|\.)tracedetrail\./i.test(parsed.hostname) &&
      /\/download\/getFile\/tracedetrail/i.test(parsed.pathname);
  } catch {
    return false;
  }
}

function isSupportedMapPlatformUrl(url) {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.toLowerCase();
    return (
      host === "pacevisor.com" && /^\/races\//i.test(parsed.pathname) ||
      /(^|\.)tracedetrail\./i.test(host) && /\/(?:event|trace|trace3d|orga\d*\/trace)\//i.test(parsed.pathname)
    );
  } catch {
    return false;
  }
}

function isHttpUrl(value) {
  try {
    const url = new URL(value);
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

function numberOrNull(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function numberFromText(value) {
  const match = String(value ?? "").replace(",", ".").match(/\d+(?:\.\d+)?/);
  return match ? Number(match[0]) : null;
}

function stripTags(value) {
  return String(value ?? "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
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
