import { appendFileSync } from "node:fs";
import {
  type Dataset,
  type Diff,
  type Overrides,
  type Sizes,
  DataError,
  applyOverrides,
  diffDatasets,
  formatBytes,
  measure,
  readJson,
  writeDataModule,
  writeJson,
} from "./lib.ts";
import { AIRPORTS_SOURCE, fetchAirports } from "./update-airports.ts";
import { AIRLINES_SOURCE, fetchAirlines } from "./update-airlines.ts";
import { AIRLINE_RULES, AIRPORT_RULES, type ValidationRules, validateDataset } from "./validate-data.ts";

const PATHS = {
  airports: { json: "generated/airports.json", module: "src/airports.data.ts", overrides: "sources/airport-overrides.json" },
  airlines: { json: "generated/airlines.json", module: "src/airlines.data.ts", overrides: "sources/airline-overrides.json" },
};

type Result = { diff: Diff; sizes: Sizes; dataset: Dataset; module: string; overrideCounts: string };

async function build(
  kind: "airports" | "airlines",
  rules: ValidationRules,
  fetcher: () => Promise<Dataset>,
  exportName: string,
  source: string,
): Promise<Result> {
  const paths = PATHS[kind];
  const previous = readJson<Dataset>(paths.json, {});

  console.log(`Checking ${source.split(" ")[0]}...`);
  const upstream = await fetcher();
  console.log(`  fetched ${Object.keys(upstream).length} ${kind} from upstream`);

  const overrides = readJson<Overrides>(paths.overrides, {});
  const applied = applyOverrides(upstream, overrides);
  const dataset = applied.dataset;

  validateDataset(dataset, previous, rules);

  const diff = diffDatasets(previous, dataset);

  writeJson(paths.json, dataset);
  // Sizes are measured on the emitted module, not the in-memory packed string:
  // that file is what a bundler actually swallows, separator escapes included.
  const module = writeDataModule(paths.module, exportName, dataset, source);

  return {
    diff,
    dataset,
    module,
    sizes: measure(module),
    overrideCounts: `${applied.added} added, ${applied.updated} updated, ${applied.removed} removed`,
  };
}

function report(label: string, result: Result): void {
  const { diff } = result;
  console.log(`\n${label}`);
  console.log("-------------------");
  console.log(`Added:   ${String(diff.added.length).padStart(6)}`);
  console.log(`Removed: ${String(diff.removed.length).padStart(6)}`);
  console.log(`Renamed: ${String(diff.renamed.length).padStart(6)}`);
  console.log(`Total:   ${String(diff.total).padStart(6)}`);
  console.log(`Overrides applied: ${result.overrideCounts}`);

  const byCode = <T extends [string, ...unknown[]]>(rows: T[]): T[] => [...rows].sort((a, b) => a[0].localeCompare(b[0]));

  for (const [code, name] of byCode(diff.added).slice(0, 20)) console.log(`  + ${code} -> ${name}`);
  for (const [code, name] of byCode(diff.removed).slice(0, 20)) console.log(`  - ${code} -> ${name}`);
  for (const [code, before, after] of byCode(diff.renamed).slice(0, 20)) {
    console.log(`  ~ ${code}\n      ${before}\n      -> ${after}`);
  }
  const hidden = diff.added.length + diff.removed.length + diff.renamed.length - 60;
  if (hidden > 0) console.log(`  ... and ${hidden} more changes`);
}

function sizeBlock(label: string, sizes: Sizes): string[] {
  return [
    `${label} raw:      ${formatBytes(sizes.raw)}`,
    `${label} gzip:     ${formatBytes(sizes.gzip)}`,
    `${label} brotli:   ${formatBytes(sizes.brotli)}`,
  ];
}

async function main(): Promise<void> {
  const airports = await build("airports", AIRPORT_RULES, fetchAirports, "AIRPORTS", AIRPORTS_SOURCE);
  const airlines = await build("airlines", AIRLINE_RULES, fetchAirlines, "AIRLINES", AIRLINES_SOURCE);

  report("Airports", airports);
  report("Airlines", airlines);

  // Sizes of the emitted src/*.data.ts modules. The pull-request body reports
  // built-output sizes instead, measured against the same baseline as the
  // regression gate — see scripts/pr-body.ts.
  const combined = measure(airports.module + airlines.module);
  console.log("\nGenerated dataset modules");
  console.log("-------------------");
  for (const line of [
    ...sizeBlock("Airports", airports.sizes),
    "",
    ...sizeBlock("Airlines", airlines.sizes),
    "",
    ...sizeBlock("Combined", combined),
  ]) {
    console.log(line);
  }

  const changed = airports.diff.changed || airlines.diff.changed;
  console.log(`\n${changed ? "Dataset changed." : "No changes. Dataset is already up to date."}`);

  // Consumed by .github/workflows/update-data.yml to decide whether to open a PR.
  const summary = {
    changed,
    airports: {
      added: airports.diff.added.length,
      removed: airports.diff.removed.length,
      renamed: airports.diff.renamed.length,
      total: airports.diff.total,
    },
    airlines: {
      added: airlines.diff.added.length,
      removed: airlines.diff.removed.length,
      renamed: airlines.diff.renamed.length,
      total: airlines.diff.total,
    },
  };
  writeJson("generated/update-summary.json", summary);

  if (process.env["GITHUB_OUTPUT"]) {
    appendFileSync(process.env["GITHUB_OUTPUT"], `changed=${changed}\n`);
  }
}

main().catch((error: unknown) => {
  if (error instanceof DataError) {
    console.error(`\nUpdate aborted: ${error.message}`);
    console.error("The previously generated dataset was left untouched.");
  } else {
    console.error(error);
  }
  process.exitCode = 1;
});
