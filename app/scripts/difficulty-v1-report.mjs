import { readFile } from 'node:fs/promises';
import { enrichRaceWithScores } from '../src/metrics.js';

const datasetPath = new URL('../data/2026/races.json', import.meta.url);
const payload = JSON.parse(await readFile(datasetPath, 'utf8'));

function numberOrNull(value) {
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

function raceToMetricInput(entry) {
  const edition = entry.edition ?? {};
  const checkpoints = Array.isArray(edition.checkpoints) ? edition.checkpoints : [];

  return {
    sourceId: `${entry.event?.slug}:${entry.race?.id}:${edition.year}`,
    name: `${entry.event?.name ?? 'Unknown event'} - ${entry.race?.shortName ?? entry.race?.name ?? 'Unknown race'}`,
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

const enrichedRaces = payload.races.map((entry) => {
  const race = raceToMetricInput(entry);
  return enrichRaceWithScores(race, race.checkpoints);
});

const total = enrichedRaces.length;
const v0Available = enrichedRaces.filter((race) => race.difficultyScoreV0 !== null).length;
const v1Available = enrichedRaces.filter((race) => race.difficultyScoreV1 !== null).length;
const withoutV1 = enrichedRaces
  .filter((race) => race.difficultyScoreV1 === null)
  .map((race) => ({
    name: race.name,
    missing: [
      race.distanceKm === null ? 'distanceKm' : null,
      race.elevationGainM === null ? 'elevationGainM' : null,
    ].filter(Boolean),
  }));

const sortedScores = [...enrichedRaces]
  .filter((race) => race.difficultyScoreV1 !== null)
  .sort((raceA, raceB) =>
    raceB.difficultyScoreV1 - raceA.difficultyScoreV1 ||
    raceA.name.localeCompare(raceB.name, 'fr'),
  );

const newlyScored = enrichedRaces
  .filter((race) => race.difficultyScoreV0 === null && race.difficultyScoreV1 !== null)
  .sort((raceA, raceB) => raceA.name.localeCompare(raceB.name, 'fr'));

const biggestChanges = enrichedRaces
  .filter((race) => race.difficultyScoreV0 !== null && race.difficultyScoreV1 !== null)
  .map((race) => ({
    ...race,
    delta: race.difficultyScoreV1 - race.difficultyScoreV0,
  }))
  .sort((raceA, raceB) => Math.abs(raceB.delta) - Math.abs(raceA.delta))
  .slice(0, 15);

function table(rows) {
  return rows.join('\n');
}

console.log(`# Difficulty V1 dataset check (${payload.year ?? 'unknown year'})`);
console.log('');
console.log(`Total races: ${total}`);
console.log(`Scores V0 available: ${v0Available}`);
console.log(`Scores V1 available: ${v1Available}`);
console.log(`Races without V1 score: ${withoutV1.length}`);
console.log('');

if (withoutV1.length) {
  console.log('## Races without V1 score');
  console.log(table(withoutV1.map((race) => `- ${race.name}: missing ${race.missing.join(', ') || 'unknown'}`)));
  console.log('');
}

console.log('## V1 scores, sorted');
console.log('| Score V1 | Score V0 | Km-effort | Race |');
console.log('| ---: | ---: | ---: | --- |');
for (const race of sortedScores) {
  console.log(`| ${race.difficultyScoreV1} | ${race.difficultyScoreV0 ?? 'null'} | ${race.kmEffort} | ${race.name} |`);
}
console.log('');

if (newlyScored.length) {
  console.log('## V1 scores now available where V0 was null');
  console.log(table(newlyScored.map((race) => `- ${race.name}: V1 ${race.difficultyScoreV1}, km-effort ${race.kmEffort}`)));
  console.log('');
}

console.log('## Biggest V1 vs V0 differences');
console.log('| Delta | Score V1 | Score V0 | Race |');
console.log('| ---: | ---: | ---: | --- |');
for (const race of biggestChanges) {
  const delta = race.delta > 0 ? `+${race.delta}` : String(race.delta);
  console.log(`| ${delta} | ${race.difficultyScoreV1} | ${race.difficultyScoreV0} | ${race.name} |`);
}
