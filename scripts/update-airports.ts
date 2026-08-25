import { type Dataset, fail, fetchText, parseCsv, sortDataset } from "./lib.ts";

export const AIRPORTS_URL = "https://davidmegginson.github.io/ourairports-data/airports.csv";
export const AIRPORTS_SOURCE = "OurAirports (public domain) — https://ourairports.com/data/";

/** Columns the pipeline reads. Anything else is filtering-only or discarded. */
const REQUIRED_COLUMNS = ["iata_code", "name", "type"] as const;

/** IATA location identifiers are exactly three letters. */
const IATA_AIRPORT_CODE = /^[A-Z]{3}$/;

/**
 * Turns the OurAirports CSV into `{ CODE: name }`.
 *
 * Inclusion rule (§10): a valid IATA code AND the airport is not closed.
 * `scheduled_service` is deliberately NOT required — charter, seasonal and
 * historical traffic all need to resolve.
 *
 * Every other column (ICAO, coordinates, elevation, timezone, continent,
 * country, municipality, GPS/local codes, website, Wikipedia, keywords) is used
 * for filtering at most, and never reaches the runtime dataset.
 */
export function normalizeAirports(csv: string): Dataset {
  const rows = parseCsv(csv);
  if (rows.length === 0) fail("OurAirports CSV contained no data rows");

  const header = Object.keys(rows[0] ?? {});
  for (const column of REQUIRED_COLUMNS) {
    if (!header.includes(column)) {
      fail(`OurAirports CSV is missing the required column "${column}" (schema change?)`);
    }
  }

  const dataset: Dataset = {};
  const duplicates: string[] = [];

  for (const row of rows) {
    const code = (row["iata_code"] ?? "").trim().toUpperCase();
    if (!IATA_AIRPORT_CODE.test(code)) continue;
    if ((row["type"] ?? "").trim() === "closed") continue;

    // Collapses stray double spaces and newlines that occasionally appear in
    // community-edited names.
    const name = (row["name"] ?? "").replace(/\s+/g, " ").trim();
    if (name === "") continue;

    if (code in dataset && dataset[code] !== name) duplicates.push(code);
    dataset[code] = name;
  }

  if (duplicates.length > 0) {
    // Not fatal on its own — validate-data.ts enforces the abnormal-growth
    // threshold — but it must be visible.
    console.warn(`  ! ${duplicates.length} conflicting duplicate IATA codes: ${duplicates.slice(0, 10).join(", ")}`);
  }

  return sortDataset(dataset);
}

export async function fetchAirports(): Promise<Dataset> {
  // The real file is ~12 MB; anything under 1 MB is a truncated or wrong response.
  const csv = await fetchText(AIRPORTS_URL, { minBytes: 1_000_000 });
  return normalizeAirports(csv);
}
