import { refreshComputed } from "./model.mjs";

const MVP_FIELDS = [
  ["edition.date", "date"],
  ["edition.distanceKm", "distance"],
  ["edition.elevationGainM", "elevationGain"],
  ["edition.maxDurationMinutes", "maxDuration"],
  ["edition.registration.priceEur", "price"],
];

export function validateEntry(entry, extraWarnings = []) {
  const missingFields = [];
  const warnings = [...extraWarnings];

  if (!entry.event?.id || !entry.race?.id || !entry.race?.name) {
    missingFields.push("identity");
  }

  for (const [path, label] of MVP_FIELDS) {
    if (getPath(entry, path) === null || getPath(entry, path) === undefined || getPath(entry, path) === "") {
      missingFields.push(label);
    }
  }

  if (entry.edition?.gpx?.status !== "available") {
    missingFields.push("gpx");
  }

  if (!Array.isArray(entry.edition?.checkpoints) || entry.edition.checkpoints.length === 0) {
    missingFields.push("checkpoints");
    warnings.push("Barriers/checkpoints not found in official source.");
  }

  if (!Array.isArray(entry.edition?.aidStations) || entry.edition.aidStations.length === 0) {
    missingFields.push("aidStations");
    warnings.push("Aid stations not found in official source.");
  } else {
    for (const station of entry.edition.aidStations) {
      if (station.distanceKm === null || station.distanceKm === undefined) {
        warnings.push(`Aid station distance unknown: ${station.name}`);
      }
    }
  }

  if (!Array.isArray(entry.edition?.sources) || entry.edition.sources.length === 0) {
    missingFields.push("sources");
  }

  const criticalMissing = ["identity", "sources", "distance"].some((field) =>
    missingFields.includes(field),
  );

  entry.quality = {
    status: criticalMissing ? "invalid" : missingFields.length === 0 ? "complete" : "partial",
    warnings: uniqueStrings(warnings),
    missingFields: uniqueStrings(missingFields),
  };

  return refreshComputed(entry);
}

export function validateResult(result) {
  const races = result.races.map((entry) => validateEntry(entry, entry.quality?.warnings ?? []));
  const statuses = races.map((entry) => entry.quality.status);
  const status = result.sourceErrors?.length
    ? "PARTIAL"
    : statuses.every((item) => item === "complete")
      ? "SUCCESS"
      : statuses.every((item) => item === "invalid")
        ? "FAILED"
        : "PARTIAL";

  return {
    ...result,
    status,
    races,
  };
}

function getPath(object, path) {
  return path.split(".").reduce((current, key) => current?.[key], object);
}

function uniqueStrings(values) {
  return [...new Set(values.filter(Boolean))];
}
