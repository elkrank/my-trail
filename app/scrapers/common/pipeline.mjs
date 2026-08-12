import { exportResults } from "./export.mjs";
import { enrichResultWithGpx, loadPreviousResult } from "./gpx.mjs";
import { validateResult } from "./validate.mjs";
import { collect as collectUtmb } from "../events/utmb/index.mjs";
import { collect as collectGrandRaid } from "../events/grand-raid-reunion/index.mjs";
import { collect as collectSaintelyon } from "../events/saintelyon/index.mjs";
import { collect as collectTempliers } from "../events/templiers/index.mjs";
import { collect as collectEcotrail } from "../events/ecotrail/index.mjs";
import { collect as collectNtmf } from "../events/ntmf/index.mjs";

export const COLLECTORS = [
  { id: "utmb", label: "UTMB Mont-Blanc", collect: collectUtmb },
  { id: "grand-raid-reunion", label: "Grand Raid de La Reunion", collect: collectGrandRaid },
  { id: "saintelyon", label: "Saintelyon", collect: collectSaintelyon },
  { id: "templiers", label: "Festival des Templiers", collect: collectTempliers },
  { id: "ecotrail", label: "EcoTrail Paris", collect: collectEcotrail },
  { id: "ntmf", label: "Nord Trail Monts de Flandres", collect: collectNtmf },
];

export async function runPipeline({ year = 2026, event = null, outDir = "data" } = {}) {
  const selected = event
    ? COLLECTORS.filter((collector) => collector.id === event)
    : COLLECTORS;

  if (selected.length === 0) {
    throw new Error(`Unknown event collector: ${event}`);
  }

  const results = [];
  for (const collector of selected) {
    try {
      const raw = await collector.collect({ year });
      const previousResult = await loadPreviousResult({ year, outDir, eventSlug: raw.event.slug });
      const enriched = await enrichResultWithGpx(raw, { year, outDir, previousResult });
      results.push(validateResult(enriched));
    } catch (error) {
      results.push({
        event: {
          id: collector.id,
          slug: collector.id,
          name: collector.label,
          country: null,
          region: null,
          city: null,
          officialWebsite: null,
        },
        status: "FAILED",
        sourceErrors: [{ url: null, message: error.stack ?? error.message, status: null }],
        races: [],
      });
    }
  }

  await exportResults({ year, outDir, results });
  return results;
}

export async function runGpxOnlyPipeline({ year = 2026, event = null, outDir = "data" } = {}) {
  const selected = event
    ? COLLECTORS.filter((collector) => collector.id === event)
    : COLLECTORS;

  if (selected.length === 0) {
    throw new Error(`Unknown event collector: ${event}`);
  }

  const results = [];
  for (const collector of selected) {
    const previousResult = await loadPreviousResult({ year, outDir, eventSlug: collector.id });
    if (!previousResult) {
      results.push({
        event: {
          id: collector.id,
          slug: collector.id,
          name: collector.label,
          country: null,
          region: null,
          city: null,
          officialWebsite: null,
        },
        status: "FAILED",
        sourceErrors: [{ url: null, message: `No existing data file for ${collector.id}`, status: null }],
        races: [],
      });
      continue;
    }

    const result = JSON.parse(JSON.stringify(previousResult));
    const enriched = await enrichResultWithGpx(result, { year, outDir, previousResult });
    results.push(validateResult(enriched));
  }

  await exportResults({ year, outDir, results });
  return results;
}
