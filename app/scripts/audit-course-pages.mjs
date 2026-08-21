import { getRaceBySlug, listRaceSlugs, listRaces } from '../src/repository.js';

const summaries = await listRaces();
const slugs = await listRaceSlugs();
const details = await Promise.all(slugs.map((slug) => getRaceBySlug(slug)));
const failures = [];

if (summaries.length !== 66) failures.push(`Expected 66 races, found ${summaries.length}.`);
if (slugs.length !== 66) failures.push(`Expected 66 slugs, found ${slugs.length}.`);
if (new Set(slugs).size !== slugs.length) failures.push('Race slugs are not unique.');

details.forEach((race, index) => {
  const slug = slugs[index];
  if (!race) {
    failures.push(`Missing detail for ${slug}.`);
    return;
  }
  if (race.slug !== slug) failures.push(`Slug mismatch for ${slug}.`);
  if (race.edition !== '2026') failures.push(`Unexpected edition for ${slug}: ${race.edition}.`);
  if (!race.name || !race.eventName || !race.raceName) failures.push(`Incomplete identity for ${slug}.`);
  for (const source of race.sources ?? []) {
    if (!/^https?:\/\//.test(source.url)) failures.push(`Unsafe source URL for ${slug}.`);
  }
});

const report = {
  status: failures.length ? 'FAILED' : 'SUCCESS',
  raceCount: summaries.length,
  uniqueSlugCount: new Set(slugs).size,
  detailCount: details.filter(Boolean).length,
  withDescription: details.filter((race) => race?.description?.french || race?.description?.original).length,
  withGpx: details.filter((race) => race?.gpx?.status === 'available').length,
  withCheckpoints: details.filter((race) => race?.checkpoints?.length).length,
  withAidStations: details.filter((race) => race?.aidStations?.length).length,
  failures,
};

console.log(JSON.stringify(report, null, 2));
if (failures.length) process.exitCode = 1;
