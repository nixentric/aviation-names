import { existsSync } from "node:fs";

import { type Sizes, DIST, formatBytes, measureEntrypoints, readJson, writeJson } from "./lib.ts";

const BASELINE = "size-baseline.json";

/**
 * Growth allowances. The baseline is generated from the real built output
 * rather than guessed: a routine daily dataset update moves combined brotli by
 * well under 1%, so 5% is already a loud signal and 10% means something
 * structural changed and needs a human.
 */
const WARN_RATIO = 0.05;
const FAIL_RATIO = 0.1;

function main(): void {
  if (!existsSync(DIST)) {
    console.error('dist/ is missing — run "npm run build" first.');
    process.exit(1);
  }

  const current = measureEntrypoints();

  if (process.argv.includes("--update")) {
    writeJson(BASELINE, current);
    console.log(`Baseline written to ${BASELINE}:`);
    for (const [name, sizes] of Object.entries(current)) {
      console.log(`  ${name.padEnd(10)} raw ${formatBytes(sizes.raw)}  gzip ${formatBytes(sizes.gzip)}  brotli ${formatBytes(sizes.brotli)}`);
    }
    return;
  }

  const baseline = readJson<Record<string, Sizes> | null>(BASELINE, null);
  if (!baseline) {
    console.error(`No ${BASELINE} found. Generate one with: npm run size -- --update`);
    process.exit(1);
  }

  console.log("\nSize check (brotli, built output)");
  console.log("-".repeat(62));
  console.log(`  ${"entry".padEnd(12)}${"baseline".padStart(12)}${"current".padStart(12)}${"delta".padStart(12)}`);

  let failed = false;
  let warned = false;

  for (const [name, sizes] of Object.entries(current)) {
    const before = baseline[name];
    if (!before) {
      console.log(`  ${name.padEnd(12)}${"(new)".padStart(12)}${formatBytes(sizes.brotli).padStart(12)}`);
      continue;
    }

    const ratio = (sizes.brotli - before.brotli) / before.brotli;
    const delta = `${ratio >= 0 ? "+" : ""}${(ratio * 100).toFixed(2)}%`;
    let flag = "";

    if (ratio > FAIL_RATIO) {
      flag = `  FAIL (over +${(FAIL_RATIO * 100).toFixed(0)}%)`;
      failed = true;
    } else if (ratio > WARN_RATIO) {
      flag = `  WARN (over +${(WARN_RATIO * 100).toFixed(0)}%)`;
      warned = true;
    }

    console.log(
      `  ${name.padEnd(12)}${formatBytes(before.brotli).padStart(12)}${formatBytes(sizes.brotli).padStart(12)}${delta.padStart(12)}${flag}`,
    );
  }

  if (failed) {
    console.error("\nSize regression exceeds the fail threshold. Review the dataset change before merging.");
    process.exit(1);
  }
  console.log(warned ? "\nSize grew more than expected — worth a look, not blocking." : "\nSize is within budget.");
}

main();
