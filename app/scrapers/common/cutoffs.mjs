import { minutesBetween, parseTime, toLocalDateTime } from "./parse.mjs";

const WEEKDAYS_FR = new Map([
  ["dimanche", 0],
  ["lundi", 1],
  ["mardi", 2],
  ["mercredi", 3],
  ["jeudi", 4],
  ["vendredi", 5],
  ["samedi", 6],
]);

export function buildFinishCheckpoint({ name = "Arrivee", distanceKm, maxDurationMinutes }) {
  if (!Number.isFinite(distanceKm) || !Number.isFinite(maxDurationMinutes) || maxDurationMinutes <= 0) return [];
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

export function checkpointFromCutoff({ name, distanceKm, cutoffDateTime, startDateTime, aidStation = false, personalAssistanceAllowed = null }) {
  if (!name || !cutoffDateTime) return null;
  const cutoffElapsedMinutes = startDateTime ? minutesBetween(startDateTime, cutoffDateTime) : null;
  if (startDateTime && (!Number.isFinite(cutoffElapsedMinutes) || cutoffElapsedMinutes < 0)) return null;

  return {
    name,
    distanceKm: Number.isFinite(distanceKm) ? distanceKm : null,
    elevationGainFromStartM: null,
    cutoffDateTime,
    cutoffElapsedMinutes,
    aidStation,
    personalAssistanceAllowed,
  };
}

export function localDateTimeFromIso(value) {
  const match = String(value ?? "").match(/^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})(?::\d{2})?/);
  return match ? `${match[1]}T${match[2]}:00` : null;
}

export function dateTimeForFrenchWeekdayAfterStart(startDate, weekday, timeText) {
  const start = parseDateParts(startDate);
  const targetWeekday = WEEKDAYS_FR.get(normalizeWord(weekday));
  const time = parseLooseTime(timeText);
  if (!start || targetWeekday === undefined || !time) return null;

  for (let offset = 0; offset <= 7; offset += 1) {
    const candidate = new Date(Date.UTC(start.year, start.month - 1, start.day + offset, time.hour, time.minute, 0));
    if (candidate.getUTCDay() !== targetWeekday) continue;
    return formatLocalDateTime(candidate);
  }

  return null;
}

export function dateTimeForClockSequence(startDate, startTime, timeText, previousDateTime = null) {
  const start = toLocalDateTime(startDate, startTime);
  const time = parseLooseTime(timeText);
  const base = parseDateParts(startDate);
  if (!base || !time) return null;

  const lowerBound = previousDateTime ?? start;
  for (let offset = 0; offset <= 3; offset += 1) {
    const candidate = new Date(Date.UTC(base.year, base.month - 1, base.day + offset, time.hour, time.minute, 0));
    const value = formatLocalDateTime(candidate);
    if (!lowerBound || minutesBetween(lowerBound, value) >= 0) return value;
  }

  return null;
}

export function parseLooseTime(value) {
  const normalized = String(value ?? "")
    .replace(/[Oo]/g, "0")
    .replace(/\s+/g, "")
    .trim();
  const parsed = parseTime(normalized);
  if (!parsed) return null;
  const [hour, minute] = parsed.split(":").map(Number);
  return { hour, minute, iso: parsed };
}

export function sortCheckpoints(checkpoints) {
  return [...checkpoints].sort((left, right) => {
    const leftElapsed = Number.isFinite(left.cutoffElapsedMinutes) ? left.cutoffElapsedMinutes : Number.POSITIVE_INFINITY;
    const rightElapsed = Number.isFinite(right.cutoffElapsedMinutes) ? right.cutoffElapsedMinutes : Number.POSITIVE_INFINITY;
    if (leftElapsed !== rightElapsed) return leftElapsed - rightElapsed;
    const leftDistance = Number.isFinite(left.distanceKm) ? left.distanceKm : Number.POSITIVE_INFINITY;
    const rightDistance = Number.isFinite(right.distanceKm) ? right.distanceKm : Number.POSITIVE_INFINITY;
    return leftDistance - rightDistance;
  });
}

function normalizeWord(value) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

function parseDateParts(value) {
  const match = String(value ?? "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  return {
    year: Number(match[1]),
    month: Number(match[2]),
    day: Number(match[3]),
  };
}

function formatLocalDateTime(date) {
  return `${date.getUTCFullYear()}-${pad2(date.getUTCMonth() + 1)}-${pad2(date.getUTCDate())}T${pad2(date.getUTCHours())}:${pad2(date.getUTCMinutes())}:00`;
}

function pad2(value) {
  return String(value).padStart(2, "0");
}
