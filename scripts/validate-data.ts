import { type Dataset, fail } from "./lib.ts";

export type ValidationRules = {
  label: string;
  codePattern: RegExp;
  /** Refuses to generate a dataset smaller than this at all. */
  minimumEntries: number;
  /** Largest share of the previous dataset that may disappear in one update. */
  maximumShrinkRatio: number;
};

export const AIRPORT_RULES: ValidationRules = {
  label: "airports",
  codePattern: /^[A-Z]{3}$/,
  minimumEntries: 5_000,
  maximumShrinkRatio: 0.1,
};

export const AIRLINE_RULES: ValidationRules = {
  label: "airlines",
  codePattern: /^[0-9A-Z]{2}$/,
  minimumEntries: 500,
  maximumShrinkRatio: 0.1,
};

/**
 * Refuses to hand a dataset to the generator unless it survives every check.
 *
 * Upstream is not trusted: a schema change, a bad export, or a bulk revert
 * should stop the pipeline with the last known-good dataset still in place,
 * never silently ship a hollowed-out package.
 */
export function validateDataset(dataset: Dataset, previous: Dataset, rules: ValidationRules): void {
  const entries = Object.entries(dataset);

  if (entries.length === 0) fail(`${rules.label}: generated dataset is empty`);
  if (entries.length < rules.minimumEntries) {
    fail(`${rules.label}: only ${entries.length} entries, expected at least ${rules.minimumEntries}`);
  }

  const invalidCodes: string[] = [];
  const emptyNames: string[] = [];
  const seen = new Set<string>();
  const duplicates: string[] = [];

  for (const [code, name] of entries) {
    if (!rules.codePattern.test(code)) invalidCodes.push(code);
    if (typeof name !== "string" || name.trim() === "") emptyNames.push(code);
    // Catches a normalization bug that lets two spellings of one code coexist.
    const normalized = code.trim().toUpperCase();
    if (seen.has(normalized)) duplicates.push(code);
    seen.add(normalized);
  }

  if (invalidCodes.length > 0) {
    fail(`${rules.label}: ${invalidCodes.length} invalid codes, e.g. ${invalidCodes.slice(0, 10).join(", ")}`);
  }
  if (emptyNames.length > 0) {
    fail(`${rules.label}: ${emptyNames.length} entries with an empty name, e.g. ${emptyNames.slice(0, 10).join(", ")}`);
  }
  if (duplicates.length > 0) {
    fail(`${rules.label}: ${duplicates.length} duplicate codes after normalization: ${duplicates.slice(0, 10).join(", ")}`);
  }

  const previousCount = Object.keys(previous).length;
  if (previousCount > 0) {
    const lost = Object.keys(previous).filter((code) => !(code in dataset)).length;
    const ratio = lost / previousCount;
    if (ratio > rules.maximumShrinkRatio) {
      fail(
        `${rules.label}: ${lost} of ${previousCount} entries disappeared (${(ratio * 100).toFixed(1)}%), ` +
          `above the ${(rules.maximumShrinkRatio * 100).toFixed(0)}% guard. Refusing to overwrite the last known-good dataset.`,
      );
    }
  }
}
