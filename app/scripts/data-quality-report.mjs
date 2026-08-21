import { readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const appRoot = join(here, "..");
const datasetPath = join(appRoot, "data", "2026", "races.json");
const reportPath = join(appRoot, "..", "SCRAPING_REPORT.md");
const dataset = JSON.parse(await readFile(datasetPath, "utf8"));
const markdown = buildReport(dataset);

if (process.argv.includes("--write")) {
  await writeFile(reportPath, markdown);
  console.log(`Wrote ${reportPath}`);
} else {
  process.stdout.write(markdown);
}

export function buildReport(dataset) {
  const races = dataset.races ?? [];
  const qualityCounts = countBy(races, (entry) => entry.quality?.status ?? "unknown");
  const sportCounts = countBy(races, (entry) => entry.quality?.sportCompleteness ?? "unknown");
  const logisticsCounts = countBy(races, (entry) => entry.quality?.logisticsCompleteness ?? "unknown");
  const registrationCounts = countBy(races, (entry) => entry.quality?.registrationCompleteness ?? "unknown");
  const availabilityCounts = {};
  for (const entry of races) {
    for (const record of availabilityRecords(entry.edition?.dataAvailability)) {
      availabilityCounts[record.status] = (availabilityCounts[record.status] ?? 0) + 1;
    }
  }

  const lines = [
    "# Scraping report - edition 2026",
    "",
    `Rapport régénéré depuis \`app/data/2026/races.json\` (snapshot ${dataset.generatedAt ?? "inconnu"}).`,
    "",
    `Statut global dataset : \`${dataset.status ?? "UNKNOWN"}\``,
    "",
    `Courses exportées : ${races.length}`,
    "",
    `Événements exportés : ${new Set(races.map((entry) => entry.event?.id).filter(Boolean)).size}`,
    "",
    "## Complétude",
    "",
    `- Globale : ${formatCounts(qualityCounts)}`,
    `- Sport : ${formatCounts(sportCounts)}`,
    `- Logistique : ${formatCounts(logisticsCounts)}`,
    `- Inscription : ${formatCounts(registrationCounts)}`,
    "",
    "## États explicites d’indisponibilité",
    "",
    ...["known_none", "not_applicable", "not_published", "extraction_error", "unknown"]
      .map((status) => `- \`${status}\` : ${availabilityCounts[status] ?? 0}`),
    "",
    "## Synthèse par événement",
    "",
    "| Événement | Courses | Complete | Partial | Invalid | Sport complet | Logistique complète | Inscription complète |",
    "| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |",
  ];

  for (const group of groupBy(races, (entry) => entry.event?.name ?? "Inconnu").values()) {
    const name = group[0]?.event?.name ?? "Inconnu";
    const counts = countBy(group, (entry) => entry.quality?.status ?? "unknown");
    lines.push(`| ${name} | ${group.length} | ${counts.complete ?? 0} | ${counts.partial ?? 0} | ${counts.invalid ?? 0} | ${group.filter((entry) => entry.quality?.sportCompleteness === "complete").length} | ${group.filter((entry) => entry.quality?.logisticsCompleteness === "complete").length} | ${group.filter((entry) => entry.quality?.registrationCompleteness === "complete").length} |`);
  }

  lines.push("", "## Données restant indisponibles", "");
  const unavailable = [];
  for (const entry of races) {
    for (const record of availabilityRecords(entry.edition?.dataAvailability)) {
      if (["known", "known_none", "not_applicable"].includes(record.status)) continue;
      unavailable.push({
        race: `${entry.event?.name} — ${entry.race?.shortName}`,
        field: record.path,
        status: record.status,
        reason: record.reason ?? "Aucune information fiable supplémentaire.",
      });
    }
  }
  if (unavailable.length === 0) lines.push("- Aucune indisponibilité explicitement annotée.");
  else for (const item of unavailable) lines.push(`- ${item.race} — \`${item.field}\` : \`${item.status}\` — ${item.reason}`);

  return `${lines.join("\n")}\n`;
}

function availabilityRecords(value, prefix = "") {
  if (!value || typeof value !== "object" || Array.isArray(value)) return [];
  const output = [];
  for (const [key, item] of Object.entries(value)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (item?.status) output.push({ path, ...item });
    else output.push(...availabilityRecords(item, path));
  }
  return output;
}

function countBy(values, key) {
  const output = {};
  for (const value of values) {
    const item = key(value);
    output[item] = (output[item] ?? 0) + 1;
  }
  return output;
}

function groupBy(values, key) {
  const output = new Map();
  for (const value of values) {
    const item = key(value);
    if (!output.has(item)) output.set(item, []);
    output.get(item).push(value);
  }
  return output;
}

function formatCounts(counts) {
  return Object.entries(counts).map(([status, count]) => `${status} ${count}`).join(", ");
}
