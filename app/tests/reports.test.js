import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { auditDataAssets } from '../scripts/audit-data-assets.mjs';
import {
  buildDifficultyReport,
  formatDifficultyReportMarkdown,
} from '../scripts/difficulty-v1-report.mjs';

test('difficulty report reflects strict V1 coverage from the current dataset', async () => {
  const payload = JSON.parse(await readFile(new URL('../data/2026/races.json', import.meta.url), 'utf8'));
  const report = buildDifficultyReport(payload);
  const withoutV1Names = report.unavailable.v1.map((race) => race.name);

  assert.equal(report.totalRaces, 66);
  assert.equal(report.scores.v0Available, 46);
  assert.equal(report.scores.v1Available, 55);
  assert.equal(report.scores.withoutV1, 11);
  assert.equal(report.missing.distance.length, 1);
  assert.equal(report.missing.elevationGain.length, 11);
  assert.equal(withoutV1Names.includes("MaXi-Race du lac d'Annecy - tOur 2 jours"), true);
  assert.equal(withoutV1Names.includes('Saintelyon - Saintelyon'), true);
  assert.equal(withoutV1Names.includes('Ultra Marin - Course des Marins'), true);

  const markdown = formatDifficultyReportMarkdown(report);
  assert.match(markdown, /Scores V0 available: 46/);
  assert.match(markdown, /Scores V1 available: 55/);
  assert.match(markdown, /Elevation gain missing: 11/);
});

test('asset audit reports no orphan assets after cleanup', async () => {
  const report = await auditDataAssets();

  assert.equal(report.orphanCount, 0);
  assert.deepEqual(report.orphans, []);
});