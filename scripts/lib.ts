import { brotliCompressSync, constants, gzipSync } from "node:zlib";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

export type Dataset = Record<string, string>;

/** `{ "GA": { name, reason } }` adds or updates; `{ remove: true }` deletes. */
export type Override = { name: string; reason?: string } | { remove: true; reason?: string };
export type Overrides = Record<string, Override>;

export const SEPARATOR = String.fromCharCode(1);

export class DataError extends Error {}

/** Fails the run rather than letting a bad upstream response reach the dataset. */
export function fail(message: string): never {
  throw new DataError(message);
}

// ---------------------------------------------------------------------------
// fetching
// ---------------------------------------------------------------------------

const USER_AGENT = "aviation-names-data-pipeline (+https://github.com/aviation-names/aviation-names)";

export async function fetchText(
  url: string,
  options: { minBytes: number; headers?: Record<string, string>; body?: string; attempts?: number } = {
    minBytes: 1,
  },
): Promise<string> {
  const attempts = options.attempts ?? 3;
  let lastError: unknown;

  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      const response = await fetch(url, {
        method: options.body === undefined ? "GET" : "POST",
        headers: { "user-agent": USER_AGENT, ...options.headers },
        body: options.body,
        signal: AbortSignal.timeout(120_000),
      });

      if (!response.ok) fail(`${url} responded ${response.status} ${response.statusText}`);

      const text = await response.text();

      // Guard 29: an error page, a captive portal or a truncated transfer must
      // never be mistaken for data.
      if (text.length < options.minBytes) {
        fail(`${url} returned ${text.length} bytes, expected at least ${options.minBytes}`);
      }
      const head = text.slice(0, 512).trimStart().toLowerCase();
      if (head.startsWith("<!doctype html") || head.startsWith("<html")) {
        fail(`${url} returned an HTML page, not data`);
      }

      return text;
    } catch (error) {
      lastError = error;
      if (attempt < attempts) {
        await new Promise((resolve) => setTimeout(resolve, attempt * 2000));
      }
    }
  }

  fail(`${url} failed after ${attempts} attempts: ${String(lastError)}`);
}

// ---------------------------------------------------------------------------
// csv
// ---------------------------------------------------------------------------

/**
 * Minimal RFC-4180 reader: quoted fields, embedded commas/newlines, doubled
 * quotes. OurAirports uses all four, and a dependency for 30 lines is not worth
 * the supply-chain surface on a data pipeline.
 */
export function parseCsv(text: string): Record<string, string>[] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;

  for (let i = 0; i < text.length; i++) {
    const char = text[i];

    if (quoted) {
      if (char === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          quoted = false;
        }
      } else {
        field += char;
      }
      continue;
    }

    if (char === '"') quoted = true;
    else if (char === ",") {
      row.push(field);
      field = "";
    } else if (char === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else if (char !== "\r") {
      field += char;
    }
  }

  if (field !== "" || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  const header = rows.shift();
  if (!header) fail("CSV contained no header row");

  return rows
    .filter((cells) => cells.length === header.length)
    .map((cells) => {
      const record: Record<string, string> = {};
      header.forEach((column, index) => {
        record[column] = cells[index] ?? "";
      });
      return record;
    });
}

// ---------------------------------------------------------------------------
// overrides
// ---------------------------------------------------------------------------

/** Overrides win over upstream unconditionally. */
export function applyOverrides(
  base: Dataset,
  overrides: Overrides,
): { dataset: Dataset; added: number; updated: number; removed: number } {
  const dataset: Dataset = { ...base };
  let added = 0;
  let updated = 0;
  let removed = 0;

  for (const [rawCode, override] of Object.entries(overrides)) {
    const code = rawCode.trim().toUpperCase();

    if ("remove" in override) {
      if (code in dataset) {
        delete dataset[code];
        removed++;
      }
      continue;
    }

    const name = override.name.trim();
    if (name === "") fail(`Override for ${code} has an empty name`);

    if (code in dataset) {
      if (dataset[code] !== name) updated++;
    } else {
      added++;
    }
    dataset[code] = name;
  }

  return { dataset: sortDataset(dataset), added, updated, removed };
}

export function sortDataset(dataset: Dataset): Dataset {
  return Object.fromEntries(Object.entries(dataset).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
}

// ---------------------------------------------------------------------------
// diffing
// ---------------------------------------------------------------------------

export type Diff = {
  added: [string, string][];
  removed: [string, string][];
  renamed: [string, string, string][];
  total: number;
  changed: boolean;
};

/** Compares normalized content, not upstream timestamps. */
export function diffDatasets(previous: Dataset, next: Dataset): Diff {
  const added: [string, string][] = [];
  const removed: [string, string][] = [];
  const renamed: [string, string, string][] = [];

  for (const [code, name] of Object.entries(next)) {
    const before = previous[code];
    if (before === undefined) added.push([code, name]);
    else if (before !== name) renamed.push([code, before, name]);
  }
  for (const [code, name] of Object.entries(previous)) {
    if (!(code in next)) removed.push([code, name]);
  }

  return {
    added,
    removed,
    renamed,
    total: Object.keys(next).length,
    changed: added.length > 0 || removed.length > 0 || renamed.length > 0,
  };
}

// ---------------------------------------------------------------------------
// sizes
// ---------------------------------------------------------------------------

export type Sizes = { raw: number; gzip: number; brotli: number };

export function measure(text: string): Sizes {
  const buffer = Buffer.from(text, "utf8");
  return {
    raw: buffer.byteLength,
    gzip: gzipSync(buffer, { level: 9 }).byteLength,
    brotli: brotliCompressSync(buffer, {
      params: { [constants.BROTLI_PARAM_QUALITY]: 11 },
    }).byteLength,
  };
}

export function formatBytes(bytes: number): string {
  return `${(bytes / 1024).toFixed(1)} KB`;
}

// ---------------------------------------------------------------------------
// packing + files
// ---------------------------------------------------------------------------

export function pack(dataset: Dataset): string {
  return Object.entries(dataset)
    .map(([code, name]) => code + name)
    .join(SEPARATOR);
}

export function readJson<T>(path: string, fallback: T): T {
  try {
    return JSON.parse(readFileSync(path, "utf8")) as T;
  } catch {
    return fallback;
  }
}

export function writeJson(path: string, value: unknown): void {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

/**
 * Emits the runtime module. JSON.stringify escapes every control character,
 * so the U+0001 separators are written as readable backslash-u escapes and the
 * generated file stays free of raw control bytes.
 */
export function writeDataModule(path: string, exportName: string, dataset: Dataset, source: string): string {
  const literal = JSON.stringify(pack(dataset));
  const contents = [
    "// Generated by scripts/update-data.ts — do not edit by hand.",
    `// Source: ${source}`,
    `// Entries: ${Object.keys(dataset).length}`,
    "",
    `export const ${exportName} = ${literal};`,
    "",
  ].join("\n");
  writeFileSync(path, contents, "utf8");
  return contents;
}

// ---------------------------------------------------------------------------
// built output
// ---------------------------------------------------------------------------

export const DIST = path.join(import.meta.dirname, "..", "dist");

/** Entrypoints as a consumer imports them, mapped to their built ESM entry. */
export const ENTRYPOINTS: [string, string][] = [
  ["airport", "airport.js"],
  ["airline", "airline.js"],
  ["combined", "index.js"],
];

/**
 * Concatenates an entry's whole chunk graph.
 *
 * Every size figure the project reports comes from here, so the benchmark, the
 * regression gate and the pull-request body cannot drift apart and quote
 * numbers measured against different things.
 */
export function bundleSourceOf(entry: string): string {
  const seen = new Set<string>();
  const queue = [path.join(DIST, entry)];
  let source = "";

  while (queue.length > 0) {
    const file = queue.pop();
    if (!file || seen.has(file)) continue;
    seen.add(file);

    const contents = readFileSync(file, "utf8");
    source += contents;
    for (const match of contents.matchAll(/from\s*["'](\.[^"']+)["']/g)) {
      const resolved = path.resolve(path.dirname(file), match[1] ?? "");
      if (existsSync(resolved)) queue.push(resolved);
    }
  }
  return source;
}

export function measureEntrypoints(): Record<string, Sizes> {
  return Object.fromEntries(ENTRYPOINTS.map(([name, entry]) => [name, measure(bundleSourceOf(entry))]));
}
