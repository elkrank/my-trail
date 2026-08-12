import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

export async function exportResults({ year, outDir, results }) {
  const yearDir = join(outDir, String(year));
  await mkdir(yearDir, { recursive: true });

  const generatedAt = new Date().toISOString();
  const allRaces = [];

  for (const result of results) {
    const payload = stableJson({
      generatedAt,
      year,
      event: result.event,
      status: result.status,
      sourceErrors: result.sourceErrors ?? [],
      races: result.races,
    });
    await writeFile(join(yearDir, `${result.event.slug}.json`), payload);
    allRaces.push(...result.races);
  }

  await writeFile(
    join(yearDir, "races.json"),
    stableJson({
      generatedAt,
      year,
      status: aggregateStatus(results),
      events: results.map((result) => ({
        id: result.event.id,
        slug: result.event.slug,
        name: result.event.name,
        status: result.status,
        raceCount: result.races.length,
      })),
      races: allRaces.sort((a, b) =>
        `${a.event.slug}-${a.race.shortName}`.localeCompare(`${b.event.slug}-${b.race.shortName}`),
      ),
    }),
  );
}

export function stableJson(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function aggregateStatus(results) {
  if (results.every((result) => result.status === "SUCCESS")) return "SUCCESS";
  if (results.every((result) => result.status === "FAILED")) return "FAILED";
  return "PARTIAL";
}
