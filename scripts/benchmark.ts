import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";

import { DIST, bundleSourceOf, formatBytes, measure } from "./lib.ts";

if (!existsSync(DIST)) {
  console.error('dist/ is missing — run "npm run build" first.');
  process.exit(1);
}

const now = () => Number(process.hrtime.bigint()) / 1e6;

// ---------------------------------------------------------------------------
// load + init
// ---------------------------------------------------------------------------

const beforeLoad = process.memoryUsage().heapUsed;

const importStart = now();
const { airport } = await import(path.join(DIST, "airport.js"));
const airportImportMs = now() - importStart;

const airlineImportStart = now();
const { airline } = await import(path.join(DIST, "airline.js"));
const airlineImportMs = now() - airlineImportStart;

const afterLoad = process.memoryUsage().heapUsed;

// The first lookup is what actually pays for the index.
const airportInitStart = now();
airport("CGK");
const airportInitMs = now() - airportInitStart;

const airlineInitStart = now();
airline("GA");
const airlineInitMs = now() - airlineInitStart;

const afterIndex = process.memoryUsage().heapUsed;

const airportCodes = Object.keys(JSON.parse(readFileSync("generated/airports.json", "utf8")));
const airlineCodes = Object.keys(JSON.parse(readFileSync("generated/airlines.json", "utf8")));

// ---------------------------------------------------------------------------
// report
// ---------------------------------------------------------------------------

const row = (label: string, value: string) => console.log(`  ${label.padEnd(30)}${value.padStart(14)}`);

console.log("\naviation-names benchmark");
console.log("=".repeat(46));

console.log("\nDataset");
console.log("-".repeat(46));
row("Airport entries", airportCodes.length.toLocaleString());
row("Airline entries", airlineCodes.length.toLocaleString());

console.log("\nBundle size (built output, per entrypoint)");
console.log("-".repeat(46));
const entries: [string, string][] = [
  ["Airport", "airport.js"],
  ["Airline", "airline.js"],
  ["Combined", "index.js"],
];
for (const [label, entry] of entries) {
  const sizes = measure(bundleSourceOf(entry));
  console.log(`\n  ${label}`);
  row("    raw", formatBytes(sizes.raw));
  row("    gzip", formatBytes(sizes.gzip));
  row("    brotli", formatBytes(sizes.brotli));
}

console.log("\nInitialization");
console.log("-".repeat(46));
row("Airport module import", `${airportImportMs.toFixed(2)} ms`);
row("Airline module import", `${airlineImportMs.toFixed(2)} ms`);
row("Airport index build (1st lookup)", `${airportInitMs.toFixed(2)} ms`);
row("Airline index build (1st lookup)", `${airlineInitMs.toFixed(2)} ms`);
row("Total cold start", `${(airportImportMs + airlineImportMs + airportInitMs + airlineInitMs).toFixed(2)} ms`);

console.log("\nMemory (approximate, no forced GC)");
console.log("-".repeat(46));
row("Module load", formatBytes(afterLoad - beforeLoad));
row("Index build", formatBytes(afterIndex - afterLoad));
row("Total resident", formatBytes(afterIndex - beforeLoad));

// ---------------------------------------------------------------------------
// lookup throughput
// ---------------------------------------------------------------------------

/** Shuffled deterministically so the access pattern is neither sorted nor random per run. */
function shuffled(codes: string[]): string[] {
  const out = codes.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = (i * 2654435761) % (i + 1);
    [out[i], out[j]] = [out[j] as string, out[i] as string];
  }
  return out;
}

const airportProbes = shuffled(airportCodes);
const airlineProbes = shuffled(airlineCodes);

function throughput(lookup: (code: string) => string | null, probes: string[], iterations: number): number {
  const warmup = Math.min(iterations, 50_000);
  for (let i = 0; i < warmup; i++) lookup(probes[i % probes.length] as string);

  const start = now();
  let sink = 0;
  for (let i = 0; i < iterations; i++) {
    const name = lookup(probes[i % probes.length] as string);
    if (name !== null) sink += name.length;
  }
  const elapsed = now() - start;
  if (sink === 0) throw new Error("benchmark resolved nothing — dataset or probes are wrong");
  return iterations / (elapsed / 1000);
}

console.log("\nLookup throughput");
console.log("-".repeat(46));
console.log(`  ${"iterations".padEnd(16)}${"airport ops/sec".padStart(18)}${"airline ops/sec".padStart(18)}`);

for (const iterations of [1, 1_000, 100_000, 1_000_000]) {
  const airportOps = throughput(airport, airportProbes, iterations);
  const airlineOps = throughput(airline, airlineProbes, iterations);
  console.log(
    `  ${iterations.toLocaleString().padEnd(16)}` +
      `${Math.round(airportOps).toLocaleString().padStart(18)}` +
      `${Math.round(airlineOps).toLocaleString().padStart(18)}`,
  );
}

console.log("\nChunks in dist/");
console.log("-".repeat(46));
for (const file of readdirSync(DIST).sort()) {
  const stat = readFileSync(path.join(DIST, file), "utf8");
  console.log(`  ${file.padEnd(30)}${formatBytes(Buffer.byteLength(stat)).padStart(14)}`);
}
console.log();
