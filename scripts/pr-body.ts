import { type Sizes, formatBytes, measureEntrypoints, readJson } from "./lib.ts";

/**
 * Emits GITHUB_OUTPUT lines for the automated data pull request.
 *
 * Must run BEFORE `npm run size -- --update`, so the committed baseline still
 * holds the previous release's numbers and "before vs after" compares two
 * measurements of the same thing: the built output a consumer bundles.
 */

type Summary = {
  changed: boolean;
  airports: { added: number; removed: number; renamed: number; total: number };
  airlines: { added: number; removed: number; renamed: number; total: number };
};

const summary = readJson<Summary | null>("generated/update-summary.json", null);
if (!summary) {
  console.error("generated/update-summary.json is missing — run update-data first.");
  process.exit(1);
}

const current = measureEntrypoints();
const baseline = readJson<Record<string, Sizes> | null>("size-baseline.json", null);

const after = current["combined"]?.brotli ?? 0;
const before = baseline?.["combined"]?.brotli ?? 0;
const delta = before > 0 ? ((after - before) / before) * 100 : 0;

const date = new Date().toISOString().slice(0, 10);

const server = process.env["GITHUB_SERVER_URL"];
const repo = process.env["GITHUB_REPOSITORY"];
const runId = process.env["GITHUB_RUN_ID"];
const runLink = server && repo && runId ? `${server}/${repo}/actions/runs/${runId}` : null;

const sizeRow = (label: string, key: string) => {
  const sizes = current[key];
  return sizes
    ? `| ${label} | ${formatBytes(sizes.raw)} | ${formatBytes(sizes.gzip)} | ${formatBytes(sizes.brotli)} |`
    : `| ${label} | — | — | — |`;
};

const body = [
  "## Airport Changes",
  "",
  `Added: ${summary.airports.added}`,
  `Removed: ${summary.airports.removed}`,
  `Renamed: ${summary.airports.renamed}`,
  `Total: ${summary.airports.total}`,
  "",
  "## Airline Changes",
  "",
  `Added: ${summary.airlines.added}`,
  `Removed: ${summary.airlines.removed}`,
  `Renamed/Rebranded: ${summary.airlines.renamed}`,
  `Total: ${summary.airlines.total}`,
  "",
  "## Bundle Impact",
  "",
  `Before Brotli: ${before > 0 ? formatBytes(before) : "n/a"}`,
  `After Brotli: ${formatBytes(after)}`,
  `Difference: ${delta >= 0 ? "+" : ""}${delta.toFixed(2)}%`,
  "",
  "| Entry | Raw | Gzip | Brotli |",
  "| --- | --- | --- | --- |",
  sizeRow("aviation-names/airport", "airport"),
  sizeRow("aviation-names/airline", "airline"),
  sizeRow("aviation-names (both)", "combined"),
  "",
  "## Sources",
  "",
  "- [OurAirports](https://ourairports.com/data/) — public domain",
  "- [Wikidata](https://query.wikidata.org/) property P229 — CC0 1.0",
  "",
  "## Validation",
  "",
  // GitHub does not run workflows for PRs opened with the default GITHUB_TOKEN,
  // so this PR carries no checks of its own. Point the reviewer at the run that
  // actually gated it rather than letting an empty check list imply "untested".
  runLink
    ? `Build, tests, benchmark, size check and pack verification all passed in [the run that produced this PR](${runLink}) before it was opened.`
    : "Build, tests, benchmark, size check and pack verification all passed before this PR was opened.",
  "",
  "CI does not report checks here: GitHub suppresses workflow triggers for pull",
  "requests created with the default GITHUB_TOKEN. An empty check list on this PR",
  "is expected, not a skipped gate.",
  "",
  "Generated automatically. Review the dataset diff before merging; merging does",
  "not publish — a release must be cut separately.",
].join("\n");

// Multiline values need the heredoc form of the GITHUB_OUTPUT protocol.
const delimiter = `EOF_${Math.abs(after * 31 + summary.airports.total).toString(36)}`;

process.stdout.write(`date=${date}\n`);
process.stdout.write(`summary<<${delimiter}\n${body}\n${delimiter}\n`);
