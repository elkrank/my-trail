import {
  DATA_AVAILABILITY_STATUS_VALUES,
  getDataAvailability,
  isAvailabilityComplete,
  refreshComputed,
} from "./model.mjs";

const COMPLETENESS_FIELDS = {
  sport: [
    ["date", "date"],
    ["distanceKm", "distance"],
    ["elevationGainM", "elevationGain"],
    ["checkpoints", "checkpoints"],
  ],
  logistics: [
    ["aidStations", "aidStations"],
    ["gpx", "gpx"],
  ],
  registration: [
    ["registration.priceEur", "price"],
  ],
};

export function validateEntry(entry, extraWarnings = []) {
  const missingFields = [];
  const warnings = [...extraWarnings];
  const validationErrors = [];

  if (!entry.event?.id || !entry.race?.id || !entry.race?.name) {
    missingFields.push("identity");
  }

  validateAvailabilityRecords(entry.edition?.dataAvailability, validationErrors);
  validateDistanceModel(entry.edition, validationErrors);

  const completeness = Object.fromEntries(
    Object.entries(COMPLETENESS_FIELDS).map(([category, fields]) => [
      category,
      assessFields(entry.edition, fields, missingFields, validationErrors),
    ]),
  );

  const maxDuration = assessField(entry.edition, "maxDurationMinutes", "maxDuration", validationErrors);
  const finishCutoff = assessField(entry.edition, "finishCutoffTime", "finishCutoffTime", validationErrors);
  if (!maxDuration.complete && !finishCutoff.complete) missingFields.push("maxDuration");
  if (!maxDuration.complete && !finishCutoff.complete) completeness.sport = "partial";

  const registrationUrl = assessField(entry.edition, "registration.url", "registrationUrl", validationErrors);
  const registrationStatus = assessField(entry.edition, "registration.status", "registrationStatus", validationErrors);
  if (!registrationUrl.complete && !registrationStatus.complete) {
    missingFields.push("registrationInfo");
    completeness.registration = "partial";
  }

  if (Array.isArray(entry.edition?.aidStations) && entry.edition.aidStations.length > 0) {
    for (const station of entry.edition.aidStations) {
      if (station.distanceKm === null || station.distanceKm === undefined) {
        warnings.push(`Aid station distance unknown: ${station.name}`);
      }
    }
  }

  if (!Array.isArray(entry.edition?.sources) || entry.edition.sources.length === 0) {
    missingFields.push("sources");
  }

  const criticalMissing = ["identity", "sources"].some((field) =>
    missingFields.includes(field),
  );

  warnings.push(...validationErrors);

  entry.quality = {
    status: criticalMissing || validationErrors.length
      ? "invalid"
      : Object.values(completeness).every((status) => status === "complete")
        ? "complete"
        : "partial",
    sportCompleteness: completeness.sport,
    logisticsCompleteness: completeness.logistics,
    registrationCompleteness: completeness.registration,
    warnings: uniqueStrings(warnings),
    missingFields: uniqueStrings(missingFields),
  };

  return refreshComputed(entry);
}

function validateDistanceModel(edition, errors) {
  const nominal = finiteNumberOrNull(edition?.nominalDistanceKm);
  const effective = finiteNumberOrNull(edition?.effectiveDistanceKm ?? edition?.distanceKm);
  const legacyDistance = finiteNumberOrNull(edition?.distanceKm);
  if (nominal !== null && nominal <= 0) errors.push('nominalDistanceKm must be positive.');
  if (effective !== null && effective <= 0) errors.push('effectiveDistanceKm must be positive.');
  if (nominal !== null && finiteNumberOrNull(edition?.effectiveDistanceKm) !== null && nominal === effective) {
    errors.push('nominalDistanceKm must only be set when it differs from effectiveDistanceKm.');
  }
  for (const checkpoint of Array.isArray(edition?.checkpoints) ? edition.checkpoints : []) {
    const checkpointDistance = finiteNumberOrNull(checkpoint?.distanceKm);
    if (checkpointDistance === null || effective === null || checkpointDistance <= effective) continue;
    const explicitlyNominalLegacyDistance = nominal !== null
      && legacyDistance !== null
      && legacyDistance === nominal
      && finiteNumberOrNull(edition?.effectiveDistanceKm) === null;
    if (!explicitlyNominalLegacyDistance) {
      errors.push(`Checkpoint distance ${checkpointDistance} km exceeds effective race distance ${effective} km.`);
    }
  }
}

function finiteNumberOrNull(value) {
  if (value === null || value === undefined || String(value).trim() === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function assessFields(edition, fields, missingFields, validationErrors) {
  let complete = true;
  for (const [path, label] of fields) {
    const assessed = assessField(edition, path, label, validationErrors);
    if (!assessed.complete) {
      complete = false;
      missingFields.push(label);
    }
  }
  return complete ? "complete" : "partial";
}

function assessField(edition, path, label, validationErrors) {
  const availability = getDataAvailability(edition, path);
  const value = getPath(edition, path);
  validateAvailabilityValue(path, value, availability, validationErrors);
  return { label, availability, complete: isAvailabilityComplete(availability) };
}

function validateAvailabilityRecords(value, errors, path = "dataAvailability") {
  if (value === null || value === undefined) return;
  if (typeof value !== "object" || Array.isArray(value)) {
    errors.push(`${path} must be an object.`);
    return;
  }
  if (Object.hasOwn(value, "status")) {
    if (!DATA_AVAILABILITY_STATUS_VALUES.has(value.status)) {
      errors.push(`${path}.status is invalid.`);
    }
    if (value.sourceUrl && !isHttpUrl(value.sourceUrl)) errors.push(`${path}.sourceUrl must be HTTP(S).`);
    if (value.checkedAt && Number.isNaN(Date.parse(value.checkedAt))) errors.push(`${path}.checkedAt must be an ISO date.`);
    if (["known_none", "not_applicable", "not_published", "extraction_error"].includes(value.status) && !value.sourceUrl) {
      errors.push(`${path}.${value.status} requires sourceUrl.`);
    }
    return;
  }
  for (const [key, child] of Object.entries(value)) validateAvailabilityRecords(child, errors, `${path}.${key}`);
}

function validateAvailabilityValue(path, value, availability, errors) {
  const empty = value === null || value === undefined || value === "" || (Array.isArray(value) && value.length === 0);
  if (availability.status === "known" && empty) errors.push(`${path} is marked known but has no value.`);
  const diagnosticExtractionValue = availability.status === "extraction_error"
    && path === "gpx"
    && value
    && ["invalid", "unavailable"].includes(value.status);
  if (["known_none", "not_applicable", "not_published", "unknown"].includes(availability.status) && !empty) {
    errors.push(`${path} is marked ${availability.status} but contains a value.`);
  }
  if (availability.status === "extraction_error" && !empty && !diagnosticExtractionValue) {
    errors.push(`${path} is marked extraction_error but contains a usable value.`);
  }
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

function isHttpUrl(value) {
  try {
    return ["http:", "https:"].includes(new URL(String(value)).protocol);
  } catch {
    return false;
  }
}

function uniqueStrings(values) {
  return [...new Set(values.filter(Boolean))];
}
