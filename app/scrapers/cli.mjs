import { runGpxOnlyPipeline, runPipeline } from "./common/pipeline.mjs";

const args = parseArgs(process.argv.slice(2));

try {
  const results = args.gpxOnly
    ? await runGpxOnlyPipeline(args)
    : await runPipeline(args);
  for (const result of results) {
    console.log(`${result.event.name.padEnd(32)} ${result.status}`);
  }
} catch (error) {
  console.error(error.stack ?? error.message);
  process.exitCode = 1;
}

function parseArgs(argv) {
  const output = {
    year: 2026,
    event: null,
    outDir: "data",
    gpxOnly: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--year") output.year = Number(argv[++index]);
    else if (arg.startsWith("--year=")) output.year = Number(arg.slice("--year=".length));
    else if (arg === "--event") output.event = argv[++index];
    else if (arg.startsWith("--event=")) output.event = arg.slice("--event=".length);
    else if (arg === "--out-dir") output.outDir = argv[++index];
    else if (arg.startsWith("--out-dir=")) output.outDir = arg.slice("--out-dir=".length);
    else if (arg === "--gpx-only") output.gpxOnly = true;
    else if (arg === "scrape") {
      // docker compose run scraper scrape maps to this positional command.
    } else if (arg === "scrape:gpx") {
      output.gpxOnly = true;
    } else if (!arg.startsWith("-") && !output.event) {
      output.event = arg;
    } else {
      throw new Error(`Unsupported argument: ${arg}`);
    }
  }

  if (!Number.isFinite(output.year)) throw new Error("Invalid --year value");
  return output;
}
