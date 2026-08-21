import {
  EXPERIENCE_LEVELS,
  FIXED_PERFORMANCE_VALUES,
  GOALS,
  PERFORMANCE_TYPES,
  PROFILE_LIMITS,
  PROFILE_SCHEMA_VERSION,
  PROFILE_STORAGE_KEY,
  TECHNICAL_LEVELS,
} from './profile-config.js';

export class ProfileValidationError extends Error {
  constructor(errors) {
    super('Le profil contient des données invalides.');
    this.name = 'ProfileValidationError';
    this.errors = errors;
  }
}

export function emptyProfile() {
  return {
    version: PROFILE_SCHEMA_VERSION,
    updatedAt: null,
    training: {
      weeklyDistanceKm: null,
      weeklyElevationGainM: null,
      weeklyHours: null,
      weeklySessions: null,
      longRun: { distanceKm: null, durationMinutes: null, elevationGainM: null, date: null },
    },
    performances: [],
    experience: {
      longestCompletedDistanceKm: null,
      longestEffortMinutes: null,
      maximumElevationGainM: null,
      technicalLevel: null,
      nightExperience: null,
      autonomyExperience: null,
    },
    goal: null,
  };
}

export function normalizeProfile(input, { now = new Date() } = {}) {
  const errors = {};
  const source = input && typeof input === 'object' ? input : {};
  const training = source.training ?? {};
  const longRun = training.longRun ?? {};
  const experience = source.experience ?? {};
  const goal = Object.values(GOALS).includes(source.goal) ? source.goal : null;
  if (!goal) errors.goal = 'Sélectionnez un objectif.';

  const performances = Array.isArray(source.performances)
    ? source.performances.map((reference, index) => normalizePerformance(reference, index, errors, now))
    : [];

  const profile = {
    version: PROFILE_SCHEMA_VERSION,
    updatedAt: now.toISOString(),
    training: {
      weeklyDistanceKm: optionalNumber(training.weeklyDistanceKm, 'training.weeklyDistanceKm', PROFILE_LIMITS.weeklyDistanceKm, errors),
      weeklyElevationGainM: optionalNumber(training.weeklyElevationGainM, 'training.weeklyElevationGainM', PROFILE_LIMITS.weeklyElevationGainM, errors),
      weeklyHours: optionalNumber(training.weeklyHours, 'training.weeklyHours', PROFILE_LIMITS.weeklyHours, errors),
      weeklySessions: optionalNumber(training.weeklySessions, 'training.weeklySessions', PROFILE_LIMITS.weeklySessions, errors, { integer: true }),
      longRun: {
        distanceKm: optionalNumber(longRun.distanceKm, 'training.longRun.distanceKm', PROFILE_LIMITS.distanceKm, errors),
        durationMinutes: optionalNumber(longRun.durationMinutes, 'training.longRun.durationMinutes', PROFILE_LIMITS.durationMinutes, errors),
        elevationGainM: optionalNumber(longRun.elevationGainM, 'training.longRun.elevationGainM', PROFILE_LIMITS.elevationGainM, errors),
        date: optionalDate(longRun.date, 'training.longRun.date', errors, now),
      },
    },
    performances,
    experience: {
      longestCompletedDistanceKm: optionalNumber(experience.longestCompletedDistanceKm, 'experience.longestCompletedDistanceKm', PROFILE_LIMITS.distanceKm, errors),
      longestEffortMinutes: optionalNumber(experience.longestEffortMinutes, 'experience.longestEffortMinutes', PROFILE_LIMITS.durationMinutes, errors),
      maximumElevationGainM: optionalNumber(experience.maximumElevationGainM, 'experience.maximumElevationGainM', PROFILE_LIMITS.elevationGainM, errors),
      technicalLevel: optionalEnum(experience.technicalLevel, TECHNICAL_LEVELS, 'experience.technicalLevel', errors),
      nightExperience: optionalEnum(experience.nightExperience, EXPERIENCE_LEVELS, 'experience.nightExperience', errors),
      autonomyExperience: optionalEnum(experience.autonomyExperience, EXPERIENCE_LEVELS, 'experience.autonomyExperience', errors),
    },
    goal,
  };

  if (Object.keys(errors).length) throw new ProfileValidationError(errors);
  return profile;
}

function normalizePerformance(reference, index, errors, now) {
  const key = `performances.${index}`;
  const type = PERFORMANCE_TYPES.includes(reference?.type) ? reference.type : null;
  if (!type) errors[`${key}.type`] = 'Sélectionnez un type de référence.';
  const fixed = FIXED_PERFORMANCE_VALUES[type] ?? {};
  const distanceKm = optionalNumber(fixed.distanceKm ?? reference?.distanceKm, `${key}.distanceKm`, PROFILE_LIMITS.distanceKm, errors, { required: true, positive: true });
  const durationMinutes = optionalNumber(fixed.durationMinutes ?? reference?.durationMinutes, `${key}.durationMinutes`, PROFILE_LIMITS.durationMinutes, errors, { required: true, positive: true });
  const elevationGainM = optionalNumber(reference?.elevationGainM, `${key}.elevationGainM`, PROFILE_LIMITS.elevationGainM, errors, { required: type === 'trail' });
  const date = optionalDate(reference?.date, `${key}.date`, errors, now, { required: true });
  const name = optionalText(reference?.name, PROFILE_LIMITS.nameLength, `${key}.name`, errors);
  return {
    id: String(reference?.id ?? `reference-${index + 1}`),
    type,
    distanceKm,
    durationMinutes,
    elevationGainM: type === 'trail' ? elevationGainM : null,
    date,
    name,
  };
}

function optionalNumber(value, key, maximum, errors, { required = false, positive = false, integer = false } = {}) {
  if (value === null || value === undefined || String(value).trim() === '') {
    if (required) errors[key] = 'Ce champ est requis.';
    return null;
  }
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0 || (positive && number <= 0) || number > maximum || (integer && !Number.isInteger(number))) {
    errors[key] = `Saisissez une valeur ${positive ? 'positive' : 'positive ou nulle'} valide.`;
    return null;
  }
  return number;
}

function optionalDate(value, key, errors, now, { required = false } = {}) {
  if (value === null || value === undefined || String(value).trim() === '') {
    if (required) errors[key] = 'Cette date est requise.';
    return null;
  }
  const text = String(value).slice(0, 10);
  const timestamp = Date.parse(`${text}T00:00:00Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text) || Number.isNaN(timestamp) || timestamp > now.getTime()) {
    errors[key] = 'Saisissez une date valide, non future.';
    return null;
  }
  return text;
}

function optionalEnum(value, values, key, errors) {
  if (value === null || value === undefined || value === '') return null;
  if (!values.includes(value)) {
    errors[key] = 'Sélection invalide.';
    return null;
  }
  return value;
}

function optionalText(value, maximum, key, errors) {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  if (!text) return null;
  if (text.length > maximum) {
    errors[key] = `Limitez ce champ à ${maximum} caractères.`;
    return text.slice(0, maximum);
  }
  return text;
}

export function createProfileRepository(storage = globalThis.localStorage) {
  return {
    load() {
      try {
        const raw = storage?.getItem(PROFILE_STORAGE_KEY);
        if (!raw) return null;
        const parsed = JSON.parse(raw);
        if (parsed?.version !== PROFILE_SCHEMA_VERSION) return null;
        return normalizeProfile(parsed, { now: parsed.updatedAt ? new Date(parsed.updatedAt) : new Date() });
      } catch {
        return null;
      }
    },
    save(input, options) {
      const profile = normalizeProfile(input, options);
      if (!storage?.setItem) throw new Error('Local storage unavailable');
      storage.setItem(PROFILE_STORAGE_KEY, JSON.stringify(profile));
      return profile;
    },
    remove() {
      storage?.removeItem(PROFILE_STORAGE_KEY);
    },
  };
}

export function parseDurationInput(value) {
  if (value === null || value === undefined || String(value).trim() === '') return null;
  const text = String(value).trim();
  if (/^\d+(?:[.,]\d+)?$/.test(text)) return Number(text.replace(',', '.')) * 60;
  const parts = text.split(':').map(Number);
  if (parts.some((part) => !Number.isFinite(part)) || parts.length < 2 || parts.length > 3) return NaN;
  const [hours, minutes, seconds = 0] = parts;
  if (minutes >= 60 || seconds >= 60) return NaN;
  return hours * 60 + minutes + seconds / 60;
}

export function formatDurationInput(minutes) {
  if (minutes === null || minutes === undefined || minutes === '') return '';
  if (!Number.isFinite(Number(minutes))) return '';
  const totalSeconds = Math.round(Number(minutes) * 60);
  const hours = Math.floor(totalSeconds / 3600);
  const mins = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return seconds
    ? `${hours}:${String(mins).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
    : `${hours}:${String(mins).padStart(2, '0')}`;
}
