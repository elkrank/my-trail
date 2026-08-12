const MONTHS_FR = new Map([
  ["janvier", 1],
  ["fevrier", 2],
  ["février", 2],
  ["mars", 3],
  ["avril", 4],
  ["mai", 5],
  ["juin", 6],
  ["juillet", 7],
  ["aout", 8],
  ["août", 8],
  ["septembre", 9],
  ["octobre", 10],
  ["novembre", 11],
  ["decembre", 12],
  ["décembre", 12],
]);

const MONTHS_EN = new Map([
  ["january", 1],
  ["february", 2],
  ["march", 3],
  ["april", 4],
  ["may", 5],
  ["june", 6],
  ["july", 7],
  ["august", 8],
  ["september", 9],
  ["october", 10],
  ["november", 11],
  ["december", 12],
]);

const WEEKDAYS_EN = new Map([
  ["sun", 0],
  ["sunday", 0],
  ["mon", 1],
  ["monday", 1],
  ["tue", 2],
  ["tuesday", 2],
  ["wed", 3],
  ["wednesday", 3],
  ["thu", 4],
  ["thursday", 4],
  ["fri", 5],
  ["friday", 5],
  ["sat", 6],
  ["saturday", 6],
]);

export function decodeHtmlEntities(value) {
  return String(value ?? "")
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(Number.parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(Number.parseInt(dec, 10)))
    .replace(/&([a-z]+);/gi, (match, name) => HTML_ENTITIES.get(name.toLowerCase()) ?? match);
}

const HTML_ENTITIES = new Map([
  ["nbsp", " "],
  ["amp", "&"],
  ["quot", '"'],
  ["apos", "'"],
  ["lt", "<"],
  ["gt", ">"],
  ["euro", "€"],
  ["ndash", "-"],
  ["mdash", "-"],
  ["hellip", "..."],
  ["rsquo", "'"],
  ["lsquo", "'"],
  ["rdquo", '"'],
  ["ldquo", '"'],
  ["agrave", "à"],
  ["acirc", "â"],
  ["aacute", "á"],
  ["ccedil", "ç"],
  ["eacute", "é"],
  ["egrave", "è"],
  ["ecirc", "ê"],
  ["euml", "ë"],
  ["icirc", "î"],
  ["iuml", "ï"],
  ["ocirc", "ô"],
  ["ouml", "ö"],
  ["ugrave", "ù"],
  ["ucirc", "û"],
  ["uuml", "ü"],
  ["aelig", "æ"],
  ["oelig", "œ"],
]);

export function stripHtml(html) {
  return normalizeWhitespace(
    decodeHtmlEntities(
      String(html ?? "")
        .replace(/<script[\s\S]*?<\/script>/gi, " ")
        .replace(/<style[\s\S]*?<\/style>/gi, " ")
        .replace(/<br\s*\/?>/gi, "\n")
        .replace(/<\/(p|div|li|h[1-6]|tr|td|th|section)>/gi, "\n")
        .replace(/<[^>]+>/g, " "),
    ),
  );
}

export function normalizeWhitespace(value) {
  return String(value ?? "")
    .replace(/\u00a0/g, " ")
    .replace(/[ \t\r\f\v]+/g, " ")
    .replace(/\n[ \t]+/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function textNoAccents(value) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

export function extractNextData(html) {
  const match = String(html ?? "").match(
    /<script[^>]+id=["']__NEXT_DATA__["'][^>]*>([\s\S]*?)<\/script>/i,
  );
  if (!match) return null;
  return JSON.parse(decodeHtmlEntities(match[1]));
}

export function extractIllustration(html, baseUrl) {
  const input = String(html ?? "");
  const metaCandidates = [];

  for (const match of input.matchAll(/<meta\b[^>]*>/gi)) {
    const attributes = parseTagAttributes(match[0]);
    const key = String(attributes.property ?? attributes.name ?? attributes.itemprop ?? "").toLowerCase();
    if (IMAGE_META_KEYS.has(key)) metaCandidates.push(attributes.content);
  }

  for (const candidate of metaCandidates) {
    const url = normalizeIllustrationUrl(candidate, baseUrl);
    if (url) return url;
  }

  for (const match of input.matchAll(/<(?:img|source)\b[^>]*>/gi)) {
    const attributes = parseTagAttributes(match[0]);
    for (const attribute of IMAGE_SOURCE_ATTRIBUTES) {
      const raw = attribute === "srcset"
        ? firstSrcsetCandidate(attributes[attribute])
        : attributes[attribute];
      const url = normalizeIllustrationUrl(raw, baseUrl);
      if (url && isLikelyIllustration(url, attributes)) return url;
    }
  }

  return null;
}

export function numberFrom(value) {
  if (value === null || value === undefined) return null;
  const raw = String(value)
    .replace(/\u00a0/g, " ")
    .replace(/\s+/g, "")
    .replace(/,/g, ".");
  const match = raw.match(/-?\d+(?:\.\d+)?/);
  return match ? Number.parseFloat(match[0]) : null;
}

export function intFrom(value) {
  const parsed = numberFrom(value);
  return Number.isFinite(parsed) ? Math.round(parsed) : null;
}

export function parseDurationToMinutes(value) {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  let match = text.match(/^(\d{1,3}):(\d{2})$/);
  if (match) return Number(match[1]) * 60 + Number(match[2]);

  match = text.match(/(\d{1,3})\s*hours?(?:\s*(\d{1,2})\s*minutes?)?/i);
  if (match) return Number(match[1]) * 60 + Number(match[2] ?? 0);

  match = text.match(/(\d{1,3})\s*h(?:eures?)?(?:\s*(\d{1,2}))?/i);
  if (match) return Number(match[1]) * 60 + Number(match[2] ?? 0);

  match = text.match(/(\d{1,3})\s*minutes?/i);
  if (match) return Number(match[1]);

  return null;
}

export function parseDate(value, defaultYear = null) {
  if (!value) return null;
  const text = String(value).trim();

  let match = text.match(/\b(20\d{2})-(\d{2})-(\d{2})\b/);
  if (match) return `${match[1]}-${match[2]}-${match[3]}`;

  match = text.match(/\b(\d{1,2})[\/.](\d{1,2})[\/.](20\d{2})\b/);
  if (match) return isoDate(Number(match[3]), Number(match[2]), Number(match[1]));

  match = text.match(/\b(\d{1,2})(?:st|nd|rd|th)?\s+([A-Za-z]+)\s+(20\d{2})\b/i);
  if (match) {
    const month = MONTHS_EN.get(match[2].toLowerCase());
    if (month) return isoDate(Number(match[3]), month, Number(match[1]));
  }

  match = text.match(/\b([A-Za-z]+)\s+(\d{1,2}),?\s+(20\d{2})\b/i);
  if (match) {
    const month = MONTHS_EN.get(match[1].toLowerCase());
    if (month) return isoDate(Number(match[3]), month, Number(match[2]));
  }

  match = text.match(/\b(\d{1,2})\s+([A-Za-zÀ-ÿ]+)\s+(20\d{2})\b/i);
  if (match) {
    const month = MONTHS_FR.get(match[2].toLowerCase());
    return month ? isoDate(Number(match[3]), month, Number(match[1])) : null;
  }

  if (defaultYear) {
    match = text.match(/\b(\d{1,2})\s+([A-Za-zÀ-ÿ]+)\b/i);
    if (match) {
      const month =
        MONTHS_FR.get(match[2].toLowerCase()) ??
        MONTHS_EN.get(match[2].toLowerCase());
      return month ? isoDate(defaultYear, month, Number(match[1])) : null;
    }
  }

  return null;
}

export function parseTime(value) {
  if (!value) return null;
  const text = String(value).trim().toLowerCase();
  let match = text.match(/\b(?:de|entre|from)?\s*(\d{1,2})\s*h\s*(\d{2})?\b/);
  if (match) return isoTime(Number(match[1]), Number(match[2] ?? 0));

  match = text.match(/\b(\d{1,2}):(\d{2})\s*(am|pm)?\b/);
  if (match) {
    let hour = Number(match[1]);
    if (match[3] === "pm" && hour < 12) hour += 12;
    if (match[3] === "am" && hour === 12) hour = 0;
    return isoTime(hour, Number(match[2]));
  }

  match = text.match(/\b(\d{1,2})\s*(am|pm)\b/);
  if (match) {
    let hour = Number(match[1]);
    if (match[2] === "pm" && hour < 12) hour += 12;
    if (match[2] === "am" && hour === 12) hour = 0;
    return isoTime(hour, 0);
  }

  return null;
}

export function toLocalDateTime(date, time) {
  return date && time ? `${date}T${time}:00` : null;
}

export function parseStartPlaceAndTime(value) {
  if (!value) return { startLocation: null, startTime: null };
  const text = stripHtml(value);
  const match = text.match(/^(.*?)\s*-\s*(\d{1,2}:\d{2})\s*$/);
  if (!match) return { startLocation: text || null, startTime: parseTime(text) };
  return {
    startLocation: match[1].trim() || null,
    startTime: parseTime(match[2]),
  };
}

export function parseCutoffDisplayToIso(cutoff, startDateTime) {
  if (!cutoff || !startDateTime) return null;
  const match = String(cutoff).trim().match(
    /^(sun|mon|tue|wed|thu|fri|sat|sunday|monday|tuesday|wednesday|thursday|friday|saturday)\s+(\d{1,2}):(\d{2})\s*(am|pm)$/i,
  );
  if (!match) return null;

  const targetWeekday = WEEKDAYS_EN.get(match[1].toLowerCase());
  if (targetWeekday === undefined) return null;

  let hour = Number(match[2]);
  if (match[4].toLowerCase() === "pm" && hour < 12) hour += 12;
  if (match[4].toLowerCase() === "am" && hour === 12) hour = 0;
  const minute = Number(match[3]);

  const start = parseLocalDateTime(startDateTime);
  if (!start) return null;

  for (let offset = 0; offset <= 7; offset += 1) {
    const candidate = new Date(Date.UTC(
      start.year,
      start.month - 1,
      start.day + offset,
      hour,
      minute,
      0,
    ));
    if (candidate.getUTCDay() !== targetWeekday) continue;
    const iso = formatUtcAsLocal(candidate);
    if (minutesBetween(startDateTime, iso) >= 0) return iso;
  }

  return null;
}

export function minutesBetween(startDateTime, endDateTime) {
  const start = parseLocalDateTime(startDateTime);
  const end = parseLocalDateTime(endDateTime);
  if (!start || !end) return null;
  const startMs = Date.UTC(start.year, start.month - 1, start.day, start.hour, start.minute, 0);
  const endMs = Date.UTC(end.year, end.month - 1, end.day, end.hour, end.minute, 0);
  return Math.round((endMs - startMs) / 60000);
}

export function absoluteCutoff(date, time) {
  return toLocalDateTime(date, parseTime(time));
}

export function uniqueBy(items, keyFn) {
  const seen = new Set();
  const output = [];
  for (const item of items) {
    const key = keyFn(item);
    if (seen.has(key)) continue;
    seen.add(key);
    output.push(item);
  }
  return output;
}

export function compactNullish(value) {
  if (Array.isArray(value)) return value.map(compactNullish);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value).map(([key, entry]) => [key, compactNullish(entry)]),
  );
}

const IMAGE_META_KEYS = new Set([
  "og:image",
  "og:image:url",
  "twitter:image",
  "twitter:image:src",
  "image",
]);

const IMAGE_SOURCE_ATTRIBUTES = [
  "src",
  "data-src",
  "data-lazy-src",
  "data-original",
  "srcset",
];

function parseTagAttributes(tag) {
  const attributes = {};
  for (const match of String(tag ?? "").matchAll(/([:@\w-]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g)) {
    const [, name, doubleQuoted, singleQuoted, unquoted] = match;
    attributes[name.toLowerCase()] = decodeHtmlEntities(doubleQuoted ?? singleQuoted ?? unquoted ?? "");
  }
  return attributes;
}

function firstSrcsetCandidate(value) {
  const first = String(value ?? "").split(",")[0]?.trim();
  return first ? first.split(/\s+/)[0] : null;
}

function normalizeIllustrationUrl(value, baseUrl) {
  const raw = decodeHtmlEntities(value).trim();
  if (!raw || raw === "#" || /^(?:data|blob|javascript|mailto):/i.test(raw)) return null;

  try {
    const url = new URL(raw, baseUrl);
    if (!["http:", "https:"].includes(url.protocol)) return null;
    if (isExcludedImageUrl(url.href)) return null;
    return url.href;
  } catch {
    return null;
  }
}

function isLikelyIllustration(url, attributes) {
  const descriptor = [
    url,
    attributes.alt,
    attributes.class,
    attributes.id,
    attributes.role,
  ].filter(Boolean).join(" ").toLowerCase();

  return !/(?:^|[\/_. -])(logo|icon|favicon|sprite|placeholder|loading|blank|pixel|tracking|avatar|map|trace|gpx|profile|parcours)(?:[\/_. -]|$)/i.test(descriptor);
}

function isExcludedImageUrl(value) {
  try {
    const url = new URL(value);
    const path = url.pathname.toLowerCase();
    return /\.(?:svg|ico)$/i.test(path) ||
      /(?:^|[\/_.-])(logo|icon|favicon|sprite|placeholder|loading|blank|pixel|tracking)(?:[\/_.-]|$)/i.test(path);
  } catch {
    return true;
  }
}

function parseLocalDateTime(value) {
  const match = String(value ?? "").match(
    /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?/,
  );
  if (!match) return null;
  return {
    year: Number(match[1]),
    month: Number(match[2]),
    day: Number(match[3]),
    hour: Number(match[4]),
    minute: Number(match[5]),
  };
}

function isoDate(year, month, day) {
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function isoTime(hour, minute) {
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return null;
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

function formatUtcAsLocal(date) {
  return `${isoDate(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate())}T${isoTime(date.getUTCHours(), date.getUTCMinutes())}:00`;
}
