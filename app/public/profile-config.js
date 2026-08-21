export const PROFILE_STORAGE_KEY = 'trailcompare:runner-profile:v1';
export const PROFILE_SCHEMA_VERSION = 1;
export const COMPARISON_VERSION = 'v0';

export const GOALS = Object.freeze({
  FINISH_CUTOFFS: 'finish_cutoffs',
  FINISH_COMFORTABLY: 'finish_comfortably',
  PERFORMANCE: 'performance',
});

export const GOAL_FACTORS = Object.freeze({
  [GOALS.FINISH_CUTOFFS]: 1,
  [GOALS.FINISH_COMFORTABLY]: 1.1,
  [GOALS.PERFORMANCE]: 1.2,
});

export const EXPERIENCE_LEVELS = Object.freeze(['none', 'some', 'regular']);
export const TECHNICAL_LEVELS = Object.freeze(['beginner', 'comfortable', 'confirmed']);

export const PROFILE_LIMITS = Object.freeze({
  weeklyDistanceKm: 500,
  weeklyElevationGainM: 30000,
  weeklyHours: 168,
  weeklySessions: 30,
  distanceKm: 1000,
  durationMinutes: 14 * 24 * 60,
  elevationGainM: 50000,
  nameLength: 120,
});

export const STATUS = Object.freeze({
  VALIDATED: 'validated',
  CONSOLIDATE: 'consolidate',
  IMPORTANT_GAP: 'important_gap',
  CRITICAL: 'critical',
  INSUFFICIENT: 'insufficient_data',
});

export const STATUS_RANK = Object.freeze({
  [STATUS.VALIDATED]: 0,
  [STATUS.CONSOLIDATE]: 1,
  [STATUS.IMPORTANT_GAP]: 2,
  [STATUS.CRITICAL]: 3,
  [STATUS.INSUFFICIENT]: -1,
});

export const PERFORMANCE_TYPES = Object.freeze([
  '5k',
  '10k',
  'half_marathon',
  'marathon',
  'six_minute_test',
  'trail',
]);

export const FIXED_PERFORMANCE_VALUES = Object.freeze({
  '5k': Object.freeze({ distanceKm: 5 }),
  '10k': Object.freeze({ distanceKm: 10 }),
  half_marathon: Object.freeze({ distanceKm: 21.0975 }),
  marathon: Object.freeze({ distanceKm: 42.195 }),
  six_minute_test: Object.freeze({ durationMinutes: 6 }),
});

export const COMPARISON_THRESHOLDS = Object.freeze({
  coverage: Object.freeze({ validated: 1, consolidate: 0.75, importantGap: 0.5 }),
  endurance: Object.freeze({
    weeklyKmEffortFactor: 0.5,
    weeklyDistanceMinKm: 20,
    weeklyDistanceMaxKm: 120,
    longRunKmEffortFactor: 0.35,
    longestDistanceFactor: 0.6,
  }),
  elevation: Object.freeze({
    weeklyFactor: 0.4,
    weeklyMinM: 500,
    weeklyMaxM: 4000,
    longRunFactor: 0.3,
    maximumFactor: 0.5,
    densityFactor: 0.75,
  }),
  experience: Object.freeze({ estimatedDurationFactor: 0.6 }),
  estimation: Object.freeze({
    maximumAgeDays: 365,
    minimumKmEffortRatio: 0.5,
    maximumKmEffortRatio: 2,
    fatigueExponent: 0.08,
  }),
  barriers: Object.freeze({ comfortableMarginMinutes: 60, comfortableMarginRatio: 0.1 }),
  confidence: Object.freeze({ high: 75, medium: 45 }),
});
