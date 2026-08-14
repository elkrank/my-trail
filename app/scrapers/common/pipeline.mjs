import { exportResults } from "./export.mjs";
import { enrichResultWithGpx, loadPreviousResult } from "./gpx.mjs";
import { validateResult } from "./validate.mjs";
import { collect as collectUtmb } from "../events/utmb/index.mjs";
import { collect as collectGrandRaid } from "../events/grand-raid-reunion/index.mjs";
import { collect as collectSaintelyon } from "../events/saintelyon/index.mjs";
import { collect as collectTempliers } from "../events/templiers/index.mjs";
import { collect as collectEcotrail } from "../events/ecotrail/index.mjs";
import { collect as collectNtmf } from "../events/ntmf/index.mjs";
import { collect as collectUltraMarin } from "../events/ultra-marin/index.mjs";
import { collect as collectMarathonMontBlanc } from "../events/marathon-mont-blanc/index.mjs";
import { collect as collectMaxiRace } from "../events/maxi-race/index.mjs";
import { collect as collectTrailAlsace } from "../events/trail-alsace/index.mjs";

export const COLLECTORS = [
  { id: "utmb", label: "UTMB Mont-Blanc", collect: collectUtmb },
  { id: "grand-raid-reunion", label: "Grand Raid de La Reunion", collect: collectGrandRaid },
  { id: "saintelyon", label: "Saintelyon", collect: collectSaintelyon },
  { id: "templiers", label: "Festival des Templiers", collect: collectTempliers },
  { id: "ecotrail", label: "EcoTrail Paris", collect: collectEcotrail },
  { id: "ntmf", label: "Nord Trail Monts de Flandres", collect: collectNtmf },
  { id: "ultra-marin", label: "Ultra Marin", collect: collectUltraMarin },
  { id: "marathon-mont-blanc", label: "Marathon du Mont-Blanc", collect: collectMarathonMontBlanc },
  { id: "maxi-race", label: "MaXi-Race du lac d'Annecy", collect: collectMaxiRace },
  { id: "trail-alsace", label: "Trail Alsace by UTMB", collect: collectTrailAlsace },
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

  const exportPayload = event
    ? await mergeTargetedResults({ year, outDir, selected, results })
    : results;
  await exportResults({ year, outDir, results: exportPayload });
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

  const exportPayload = event
    ? await mergeTargetedResults({ year, outDir, selected, results })
    : results;
  await exportResults({ year, outDir, results: exportPayload });
  return results;
}

async function mergeTargetedResults({ year, outDir, selected, results }) {
  const selectedIds = new Set(selected.map((collector) => collector.id));
  const resultByCollectorId = new Map();
  for (const result of results) {
    resultByCollectorId.set(result.event?.slug ?? result.event?.id, result);
  }

  const merged = [];
  for (const collector of COLLECTORS) {
    if (selectedIds.has(collector.id)) {
      const result = resultByCollectorId.get(collector.id);
      if (result) merged.push(result);
      continue;
    }

    const previous = await loadPreviousResult({ year, outDir, eventSlug: collector.id });
    if (previous) merged.push(previous);
  }

  return merged;
}
