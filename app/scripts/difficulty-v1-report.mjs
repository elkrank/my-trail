import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { enrichRaceWithScores } from '../src/metrics.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const defaultDatasetPath = path.join(__dirname, '..', 'data', '2026', 'races.json');

export function numberOrNull(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string' && value.trim() === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function checkpointToMetric(checkpoint) {
  return {
    name: checkpoint.name,
    distanceKm: numberOrNull(checkpoint.distanceKm),
    elapsedLimitMinutes: numberOrNull(checkpoint.cutoffElapsedMinutes),
    cutoffDateTime: checkpoint.cutoffDateTime ?? null,
    aidStation: checkpoint.aidStation ?? null,
    personalAssistanceAllowed: checkpoint.personalAssistanceAllowed ?? null,
  };
}

function raceName(entry) {
  return `${entry.event?.name ?? 'Unknown event'} - ${entry.race?.shortName ?? entry.race?.name ?? 'Unknown race'}`;
}

function raceToMetricInput(entry) {
  const edition = entry.edition ?? {};
  const checkpoints = Array.isArray(edition.checkpoints) ? edition.checkpoints : [];

  return {
    sourceId: `${entry.event?.slug}:${entry.race?.id}:${edition.year}`,
    name: raceName(entry),
    eventName: entry.event?.name ?? null,
    raceName: entry.race?.name ?? null,
    shortName: entry.race?.shortName ?? null,
    date: edition.date ?? null,
    distanceKm: numberOrNull(edition.distanceKm),
    elevationGainM: numberOrNull(edition.elevationGainM),
    timeLimitMinutes: numberOrNull(edition.maxDurationMinutes),
    checkpoints: checkpoints.map(checkpointToMetric),
  };
}

function compactRace(race) {
  return {
    sourceId: race.sourceId,
    name: race.name,
    distanceKm: race.distanceKm,
    elevationGainM: race.elevationGainM,
    timeLimitMinutes: race.timeLimitMinutes,
    kmEffort: race.kmEffort,
    difficultyScoreV0: race.difficultyScoreV0,
    difficultyScoreV1: race.difficultyScoreV1,
  };
}

function sortByName(races) {
  return [...races].sort((raceA, raceB) => raceA.name.localeCompare(raceB.name, 'fr'));
}

export function buildDifficultyReport(payload) {
  const enrichedRaces = payload.races.map((entry) => {
    const race = raceToMetricInput(entry);
    return enrichRaceWithScores(race, race.checkpoints);
  });

  const v0Available = enrichedRaces.filter((race) => race.difficultyScoreV0 !== null).length;
  const v1Available = enrichedRaces.filter((race) => race.difficultyScoreV1 !== null).length;
  const withoutV1 = sortByName(enrichedRaces.filter((race) => race.difficultyScoreV1 === null));
  const withoutV0 = sortByName(enrichedRaces.filter((race) => race.difficultyScoreV0 === null));
  const missingDistance = sortByName(enrichedRaces.filter((race) => race.distanceKm === null));
  const missingElevationGain = sortByName(enrichedRaces.filter((race) => race.elevationGainM === null));
  const missingTimeLimit = sortByName(enrichedRaces.filter((race) => race.timeLimitMinutes === null));
  const newlyScoredByV1 = sortByName(
    enrichedRaces.filter((race) => race.difficultyScoreV0 === null && race.difficultyScoreV1 !== null),
  );

  const sortedScores = [...enrichedRaces]
    .filter((race) => race.difficultyScoreV1 !== null)
    .sort((raceA, raceB) =>
      raceB.difficultyScoreV1 - raceA.difficultyScoreV1 ||
      raceA.name.localeCompare(raceB.name, 'fr'),
    );

  const biggestChanges = enrichedRaces
    .filter((race) => race.difficultyScoreV0 !== null && race.difficultyScoreV1 !== null)
    .map((race) => ({
      ...race,
      delta: race.difficultyScoreV1 - race.difficultyScoreV0,
    }))
    .sort((raceA, raceB) => Math.abs(raceB.delta) - Math.abs(raceA.delta))
    .slice(0, 15);

  return {
    year: payload.year ?? null,
    generatedAt: payload.generatedAt ?? null,
    totalRaces: enrichedRaces.length,
    scores: {
      v0Available,
      v1Available,
      withoutV0: withoutV0.length,
      withoutV1: withoutV1.length,
    },
    missing: {
      distance: missingDistance.map(compactRace),
      elevationGain: missingElevationGain.map(compactRace),
      timeLimit: missingTimeLimit.map(compactRace),
    },
    unavailable: {
      v0: withoutV0.map(compactRace),
      v1: withoutV1.map(compactRace),
    },
    newlyCoveredByV1: newlyScoredByV1.map(compactRace),
    sortedScores: sortedScores.map(compactRace),
    biggestChanges: biggestChanges.map((race) => ({
      ...compactRace(race),
      delta: race.delta,
    })),
  };
}

function bulletList(races, emptyText = '- None') {
  if (!races.length) return emptyText;
  return races.map((race) => `- ${race.name}`).join('\n');
}

function unavailableBulletList(races) {
  if (!races.length) return '- None';
  return races.map((race) => {
    const missing = [
      race.distanceKm === null ? 'distanceKm' : null,
      race.elevationGainM === null ? 'elevationGainM' : null,
      race.timeLimitMinutes === null ? 'timeLimitMinutes' : null,
    ].filter(Boolean);
    return `- ${race.name}: missing ${missing.join(', ') || 'unknown'}`;
  }).join('\n');
}

export function formatDifficultyReportMarkdown(report) {
  const lines = [];
  lines.push(`# Difficulty V1 dataset check (${report.year ?? 'unknown year'})`);
  lines.push('');
  lines.push(`Total races: ${report.totalRaces}`);
  lines.push(`Scores V0 available: ${report.scores.v0Available}`);
  lines.push(`Scores V1 available: ${report.scores.v1Available}`);
  lines.push(`Races without V1 score: ${report.scores.withoutV1}`);
  lines.push(`Races without V0 score: ${report.scores.withoutV0}`);
  lines.push('');
  lines.push('## Missing source data');
  lines.push(`Distance missing: ${report.missing.distance.length}`);
  lines.push(`Elevation gain missing: ${report.missing.elevationGain.length}`);
  lines.push(`Time limit missing: ${report.missing.timeLimit.length}`);
  lines.push('');
  lines.push('### Distance missing');
  lines.push(bulletList(report.missing.distance));
  lines.push('');
  lines.push('### Elevation gain missing');
  lines.push(bulletList(report.missing.elevationGain));
  lines.push('');
  lines.push('### Time limit missing');
  lines.push(bulletList(report.missing.timeLimit));
  lines.push('');
  lines.push('## Races without V1 score');
  lines.push(unavailableBulletList(report.unavailable.v1));
  lines.push('');
  lines.push('## Races without V0 score');
  lines.push(unavailableBulletList(report.unavailable.v0));
  lines.push('');

  if (report.newlyCoveredByV1.length) {
    lines.push('## V1 scores now available where V0 was null');
    lines.push(report.newlyCoveredByV1.map((race) => `- ${race.name}: V1 ${race.difficultyScoreV1}, km-effort ${race.kmEffort}`).join('\n'));
    lines.push('');
  }

  lines.push('## V1 scores, sorted');
  lines.push('| Score V1 | Score V0 | Km-effort | Race |');
  lines.push('| ---: | ---: | ---: | --- |');
  for (const race of report.sortedScores) {
    lines.push(`| ${race.difficultyScoreV1} | ${race.difficultyScoreV0 ?? 'null'} | ${race.kmEffort} | ${race.name} |`);
  }
  lines.push('');

  lines.push('## Biggest V1 vs V0 differences');
  lines.push('| Delta | Score V1 | Score V0 | Race |');
  lines.push('| ---: | ---: | ---: | --- |');
  for (const race of report.biggestChanges) {
    const delta = race.delta > 0 ? `+${race.delta}` : String(race.delta);
    lines.push(`| ${delta} | ${race.difficultyScoreV1} | ${race.difficultyScoreV0} | ${race.name} |`);
  }

  return `${lines.join('\n')}\n`;
}

export async function loadDifficultyReport(datasetPath = defaultDatasetPath) {
  const payload = JSON.parse(await readFile(datasetPath, 'utf8'));
  return buildDifficultyReport(payload);
}

function isDirectRun() {
  return process.argv[1] && path.resolve(process.argv[1]) === __filename;
}

if (isDirectRun()) {
  const json = process.argv.includes('--json');
  const datasetPathArg = process.argv.find((arg) => arg.startsWith('--dataset='));
  const datasetPath = datasetPathArg ? path.resolve(datasetPathArg.slice('--dataset='.length)) : defaultDatasetPath;
  const report = await loadDifficultyReport(datasetPath);
  process.stdout.write(json ? `${JSON.stringify(report, null, 2)}\n` : formatDifficultyReportMarkdown(report));
}