import { execFileSync } from "node:child_process";

import { formatBytes } from "./lib.ts";

/**
 * Inspects the tarball npm would publish (§37).
 *
 * Consumers get the built output, the licence and the docs. Raw source data,
 * benchmark output, dev caches and the pipeline itself must never ship.
 */

const FORBIDDEN = [
  { pattern: /\.csv$/i, why: "raw OurAirports CSV" },
  { pattern: /^generated\//, why: "source dataset (consumers use dist/)" },
  { pattern: /^sources\//, why: "override source files" },
  { pattern: /^scripts\//, why: "data pipeline" },
  { pattern: /^tests?\//, why: "test files" },
  { pattern: /^\.github\//, why: "CI configuration" },
  { pattern: /^src\//, why: "TypeScript sources (dist/ ships instead)" },
  { pattern: /^node_modules\//, why: "dependencies" },
  { pattern: /\.(log|tmp|tsbuildinfo)$/i, why: "temporary or cache file" },
  { pattern: /^size-baseline\.json$/, why: "benchmark baseline" },
  { pattern: /\.dat$/i, why: "source airline database" },
];

const REQUIRED = ["package.json", "README.md", "LICENSE", "DATA_SOURCES.md", "dist/index.js", "dist/index.cjs", "dist/index.d.ts"];

type PackResult = { filename: string; size: number; unpackedSize: number; files: { path: string; size: number }[] };

// --ignore-scripts keeps the prepack build's output from polluting the JSON;
// "npm run verify-pack" has already built dist/ by this point.
const output = execFileSync("npm", ["pack", "--dry-run", "--json", "--ignore-scripts"], { encoding: "utf8" });

/**
 * npm 11 emits an array of results; npm 12 emits an object keyed by package
 * name. Accept either, and say which shape actually arrived if neither
 * matches, so the next format change is diagnosable from the log alone.
 */
function firstPackResult(raw: string): PackResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    console.error(`npm pack did not return JSON. First 200 chars:\n${raw.slice(0, 200)}`);
    process.exit(1);
  }

  const candidates = Array.isArray(parsed) ? parsed : typeof parsed === "object" && parsed !== null ? Object.values(parsed) : [];
  const result = candidates[0] as PackResult | undefined;

  if (!result || !Array.isArray(result.files)) {
    console.error(
      `npm pack returned an unrecognised shape (npm ${execFileSync("npm", ["--version"], { encoding: "utf8" }).trim()}): ` +
        `${Array.isArray(parsed) ? "array" : typeof parsed} with ${candidates.length} entries.`,
    );
    process.exit(1);
  }
  return result;
}

const result = firstPackResult(output);

const paths = result.files.map((file) => file.path);

console.log(`\nPackage contents (${result.filename})`);
console.log("-".repeat(58));
for (const file of [...result.files].sort((a, b) => b.size - a.size)) {
  console.log(`  ${file.path.padEnd(40)}${formatBytes(file.size).padStart(12)}`);
}
console.log("-".repeat(58));
console.log(`  ${"tarball".padEnd(40)}${formatBytes(result.size).padStart(12)}`);
console.log(`  ${"unpacked".padEnd(40)}${formatBytes(result.unpackedSize).padStart(12)}`);

const problems: string[] = [];

for (const path of paths) {
  for (const rule of FORBIDDEN) {
    if (rule.pattern.test(path)) problems.push(`unexpected file: ${path} (${rule.why})`);
  }
}
for (const required of REQUIRED) {
  if (!paths.includes(required)) problems.push(`missing required file: ${required}`);
}

if (problems.length > 0) {
  console.error("\nPackage verification failed:");
  for (const problem of problems) console.error(`  - ${problem}`);
  process.exit(1);
}

console.log(`\n${paths.length} files, nothing unexpected. Package is publishable.`);
