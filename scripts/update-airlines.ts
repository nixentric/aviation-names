import { type Dataset, fail, fetchText, sortDataset } from "./lib.ts";

export const AIRLINES_URL = "https://query.wikidata.org/sparql";
export const AIRLINES_SOURCE = "Wikidata (CC0 1.0) — property P229, IATA airline designator";

/**
 * IATA airline designators are two alphanumeric characters.
 *
 * Selecting on P229 alone is the point: the criterion is "has a relevant IATA
 * airline designator", never "is an IATA member" (§6, §17).
 */
const IATA_AIRLINE_CODE = /^[0-9A-Z]{2}$/;

/**
 * Wikidata QIDs that mean "this entity is an airline", used to prefer a real
 * carrier over a holding company or trademark when a code is contested.
 */
const AIRLINE_TYPES = new Set([
  "Q46970", // airline
  "Q2401749", // regional airline
  "Q1129936", // cargo airline
  "Q2401751", // charter airline
  "Q1141470", // low-cost airline
  "Q6017969", // flag carrier
  "Q1145276", // helicopter airline
]);

export const SPARQL_QUERY = `
SELECT ?iata ?airline ?airlineLabel ?sitelinks
       (MIN(?d1) AS ?dissolved) (MIN(?d2) AS ?closed) (MIN(?d3) AS ?discontinued)
       (GROUP_CONCAT(DISTINCT ?instQ; separator=" ") AS ?instances)
WHERE {
  ?airline wdt:P229 ?iata .
  OPTIONAL { ?airline wdt:P576 ?d1 }
  OPTIONAL { ?airline wdt:P3999 ?d2 }
  OPTIONAL { ?airline wdt:P2669 ?d3 }
  OPTIONAL { ?airline wdt:P31 ?instQ }
  OPTIONAL { ?airline wikibase:sitelinks ?sitelinks }
  SERVICE wikibase:label { bd:serviceParam wikibase:language "en,mul". }
}
GROUP BY ?iata ?airline ?airlineLabel ?sitelinks
`.trim();

type Binding = Record<string, { value: string } | undefined>;

type Candidate = {
  qid: string;
  name: string;
  operating: boolean;
  isAirline: boolean;
  sitelinks: number;
};

/**
 * Resolves the SPARQL result into `{ CODE: brand name }`.
 *
 * IATA designators are recycled, so most codes have several historical
 * claimants. Candidates are ranked by, in order:
 *
 *   1. no recorded dissolution / closure / discontinuation date
 *   2. typed as an airline rather than a holding company or brand
 *   3. Wikipedia sitelink count, a proxy for the carrier a passenger means
 *
 * The curated override layer exists for the cases this ranking still gets
 * wrong — it is a heuristic over community data, not an authority.
 */
export function normalizeAirlines(json: string): Dataset {
  let parsed: { results?: { bindings?: Binding[] } };
  try {
    parsed = JSON.parse(json);
  } catch {
    fail("Wikidata returned a response that is not valid JSON");
  }

  const bindings = parsed.results?.bindings;
  if (!Array.isArray(bindings)) fail("Wikidata response is missing results.bindings (schema change?)");
  if (bindings.length === 0) fail("Wikidata returned zero airline bindings");

  const candidates = new Map<string, Candidate[]>();

  for (const binding of bindings) {
    const code = (binding["iata"]?.value ?? "").trim().toUpperCase();
    if (!IATA_AIRLINE_CODE.test(code)) continue;

    const name = (binding["airlineLabel"]?.value ?? "").replace(/\s+/g, " ").trim();
    // An unlabelled item falls back to its own QID, which is not a brand name.
    if (name === "" || /^Q\d+$/.test(name)) continue;

    const instances = new Set(
      (binding["instances"]?.value ?? "")
        .split(" ")
        .filter(Boolean)
        .map((uri) => uri.slice(uri.lastIndexOf("/") + 1)),
    );

    const list = candidates.get(code) ?? [];
    list.push({
      qid: binding["airline"]?.value.split("/").pop() ?? "",
      name,
      operating: !binding["dissolved"] && !binding["closed"] && !binding["discontinued"],
      isAirline: [...instances].some((qid) => AIRLINE_TYPES.has(qid)),
      sitelinks: Number(binding["sitelinks"]?.value ?? 0),
    });
    candidates.set(code, list);
  }

  const dataset: Dataset = {};
  for (const [code, list] of candidates) {
    list.sort(
      (a, b) =>
        Number(b.operating) - Number(a.operating) ||
        Number(b.isAirline) - Number(a.isAirline) ||
        b.sitelinks - a.sitelinks ||
        // Final tiebreak keeps generation deterministic across runs.
        a.qid.localeCompare(b.qid),
    );
    const best = list[0];
    if (best) dataset[code] = best.name;
  }

  return sortDataset(dataset);
}

export async function fetchAirlines(): Promise<Dataset> {
  const json = await fetchText(AIRLINES_URL, {
    minBytes: 100_000,
    headers: {
      accept: "application/sparql-results+json",
      "content-type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({ query: SPARQL_QUERY }).toString(),
  });
  return normalizeAirlines(json);
}
