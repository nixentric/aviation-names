import assert from "node:assert/strict";
import test, { describe } from "node:test";

import { DataError, applyOverrides, diffDatasets, pack, parseCsv } from "../scripts/lib.ts";
import { normalizeAirports } from "../scripts/update-airports.ts";
import { normalizeAirlines } from "../scripts/update-airlines.ts";
import { AIRLINE_RULES, AIRPORT_RULES, validateDataset } from "../scripts/validate-data.ts";

const CSV_HEADER = "id,ident,type,name,iso_country,municipality,scheduled_service,icao_code,iata_code";

const csv = (...rows: string[]) => [CSV_HEADER, ...rows].join("\n");

describe("parseCsv()", () => {
  test("handles quoted fields, embedded commas and doubled quotes", () => {
    const rows = parseCsv('a,b\n"x,1","he said ""hi"""\nplain,value');
    assert.deepEqual(rows, [
      { a: "x,1", b: 'he said "hi"' },
      { a: "plain", b: "value" },
    ]);
  });

  test("throws on input with no header", () => {
    assert.throws(() => parseCsv(""), DataError);
  });
});

describe("normalizeAirports()", () => {
  test("keeps airports with a valid IATA code", () => {
    const dataset = normalizeAirports(csv('1,WIII,large_airport,Soekarno-Hatta International Airport,ID,Jakarta,yes,WIII,CGK'));
    assert.deepEqual(dataset, { CGK: "Soekarno-Hatta International Airport" });
  });

  test("drops airports with a missing or malformed IATA code", () => {
    const dataset = normalizeAirports(
      csv(
        "1,X1,small_airport,No Code Field,US,Nowhere,no,KX1,",
        "2,X2,small_airport,Two Letters,US,Nowhere,no,KX2,AB",
        "3,X3,small_airport,Four Letters,US,Nowhere,no,KX3,ABCD",
        "4,X4,small_airport,Digits,US,Nowhere,no,KX4,1A2",
        "5,X5,small_airport,Good One,US,Nowhere,no,KX5,GUD",
      ),
    );
    assert.deepEqual(dataset, { GUD: "Good One" });
  });

  test("drops closed airports", () => {
    const dataset = normalizeAirports(
      csv("1,X1,closed,Shut Down Airport,US,Nowhere,no,KX1,CLS", "2,X2,medium_airport,Open Airport,US,Nowhere,no,KX2,OPN"),
    );
    assert.deepEqual(dataset, { OPN: "Open Airport" });
  });

  test("keeps airports without scheduled commercial service", () => {
    const dataset = normalizeAirports(csv("1,X1,small_airport,Charter Only Airport,US,Nowhere,no,KX1,CHT"));
    assert.deepEqual(dataset, { CHT: "Charter Only Airport" });
  });

  test("upper-cases codes and collapses whitespace in names", () => {
    const dataset = normalizeAirports(csv('1,X1,small_airport,"Messy   Spaced  Airport",US,Nowhere,no,KX1,lax'));
    assert.deepEqual(dataset, { LAX: "Messy Spaced Airport" });
  });

  test("collapses duplicate codes to a single mapping", () => {
    const dataset = normalizeAirports(
      csv("1,X1,small_airport,First Airport,US,Nowhere,no,KX1,DUP", "2,X2,small_airport,Second Airport,US,Nowhere,no,KX2,DUP"),
    );
    assert.equal(Object.keys(dataset).length, 1);
    assert.ok(dataset["DUP"]);
  });

  test("emits sorted output so generated diffs stay reviewable", () => {
    const dataset = normalizeAirports(
      csv("1,X1,small_airport,Zulu,US,N,no,KX1,ZZA", "2,X2,small_airport,Alpha,US,N,no,KX2,AAA"),
    );
    assert.deepEqual(Object.keys(dataset), ["AAA", "ZZA"]);
  });

  describe("upstream corruption", () => {
    test("rejects a response missing required columns", () => {
      assert.throws(() => normalizeAirports("id,ident,name\n1,X1,Some Airport"), /missing the required column/);
    });

    test("rejects a response with no data rows", () => {
      assert.throws(() => normalizeAirports(CSV_HEADER), DataError);
    });
  });
});

describe("normalizeAirlines()", () => {
  const binding = (
    iata: string,
    label: string,
    extra: Record<string, unknown> = {},
    qid = "Q1",
  ): Record<string, unknown> => ({
    iata: { value: iata },
    airline: { value: `http://www.wikidata.org/entity/${qid}` },
    airlineLabel: { value: label },
    ...extra,
  });

  const sparql = (...bindings: Record<string, unknown>[]) => JSON.stringify({ results: { bindings } });

  test("maps designator to brand name", () => {
    assert.deepEqual(normalizeAirlines(sparql(binding("GA", "Garuda Indonesia"))), { GA: "Garuda Indonesia" });
  });

  test("drops malformed designators", () => {
    const dataset = normalizeAirlines(
      sparql(
        binding("G", "One Char"),
        binding("GAA", "Three Chars"),
        binding("--", "Punctuation"),
        binding("GA", "Garuda Indonesia"),
      ),
    );
    assert.deepEqual(dataset, { GA: "Garuda Indonesia" });
  });

  test("drops entities whose label fell back to a QID", () => {
    assert.deepEqual(normalizeAirlines(sparql(binding("XX", "Q12345"))), {});
  });

  test("prefers an operating carrier over a dissolved one", () => {
    const dataset = normalizeAirlines(
      sparql(
        binding("ID", "Interlink Airlines", { dissolved: { value: "2010-01-01T00:00:00Z" }, sitelinks: { value: "40" } }, "Q2"),
        binding("ID", "Batik Air", { sitelinks: { value: "5" } }, "Q3"),
      ),
    );
    assert.deepEqual(dataset, { ID: "Batik Air" });
  });

  test("treats closure and discontinuation dates as defunct signals", () => {
    for (const key of ["closed", "discontinued"]) {
      const dataset = normalizeAirlines(
        sparql(
          binding("AB", "Gone Airways", { [key]: { value: "2011-01-01T00:00:00Z" }, sitelinks: { value: "99" } }, "Q2"),
          binding("AB", "Still Flying", { sitelinks: { value: "1" } }, "Q3"),
        ),
      );
      assert.deepEqual(dataset, { AB: "Still Flying" }, `failed for ${key}`);
    }
  });

  test("prefers an airline over a non-airline holder of the same code", () => {
    const airlineType = { instances: { value: "http://www.wikidata.org/entity/Q46970" } };
    const dataset = normalizeAirlines(
      sparql(
        binding("CD", "Some Holding Company", { sitelinks: { value: "50" } }, "Q2"),
        binding("CD", "Real Airline", { ...airlineType, sitelinks: { value: "3" } }, "Q3"),
      ),
    );
    assert.deepEqual(dataset, { CD: "Real Airline" });
  });

  test("falls back to sitelink count, then QID, for a deterministic winner", () => {
    const dataset = normalizeAirlines(
      sparql(binding("EF", "Small Carrier", { sitelinks: { value: "2" } }, "Q2"), binding("EF", "Famous Carrier", { sitelinks: { value: "80" } }, "Q3")),
    );
    assert.deepEqual(dataset, { EF: "Famous Carrier" });

    const tied = normalizeAirlines(sparql(binding("GH", "Bravo", {}, "Q9"), binding("GH", "Alpha", {}, "Q2")));
    assert.deepEqual(tied, { GH: "Alpha" }, "tiebreak must be stable across runs");
  });

  describe("upstream corruption", () => {
    test("rejects non-JSON", () => {
      assert.throws(() => normalizeAirlines("<html>503</html>"), /not valid JSON/);
    });

    test("rejects a response with no bindings key", () => {
      assert.throws(() => normalizeAirlines(JSON.stringify({ results: {} })), /missing results.bindings/);
    });

    test("rejects an empty result set", () => {
      assert.throws(() => normalizeAirlines(sparql()), /zero airline bindings/);
    });
  });
});

describe("applyOverrides()", () => {
  test("ADD: introduces a code upstream does not have", () => {
    const result = applyOverrides({ GA: "Garuda Indonesia" }, { QZ: { name: "Indonesia AirAsia" } });
    assert.deepEqual(result.dataset, { GA: "Garuda Indonesia", QZ: "Indonesia AirAsia" });
    assert.equal(result.added, 1);
  });

  test("UPDATE: replaces a stale upstream name", () => {
    const result = applyOverrides({ KM: "Air Malta" }, { KM: { name: "KM Malta Airlines", reason: "rebranded 2024" } });
    assert.deepEqual(result.dataset, { KM: "KM Malta Airlines" });
    assert.equal(result.updated, 1);
    assert.equal(result.added, 0);
  });

  test("REMOVE: deletes an entry upstream should not carry", () => {
    const result = applyOverrides({ GA: "Garuda Indonesia", XX: "Ceased Airways" }, { XX: { remove: true } });
    assert.deepEqual(result.dataset, { GA: "Garuda Indonesia" });
    assert.equal(result.removed, 1);
  });

  test("removing an absent code is a no-op, not an error", () => {
    const result = applyOverrides({ GA: "Garuda Indonesia" }, { ZZ: { remove: true } });
    assert.deepEqual(result.dataset, { GA: "Garuda Indonesia" });
    assert.equal(result.removed, 0);
  });

  test("normalizes override keys and trims names", () => {
    const result = applyOverrides({}, { " qz ": { name: "  Indonesia AirAsia  " } });
    assert.deepEqual(result.dataset, { QZ: "Indonesia AirAsia" });
  });

  test("counts an override that matches upstream as neither add nor update", () => {
    const result = applyOverrides({ GA: "Garuda Indonesia" }, { GA: { name: "Garuda Indonesia" } });
    assert.equal(result.added, 0);
    assert.equal(result.updated, 0);
  });

  test("rejects an empty override name", () => {
    assert.throws(() => applyOverrides({}, { GA: { name: "   " } }), /empty name/);
  });

  test("overrides take priority over upstream unconditionally", () => {
    const result = applyOverrides({ DPS: "Denpasar I Gusti Ngurah Rai International Airport" }, { DPS: { name: "I Gusti Ngurah Rai International Airport" } });
    assert.equal(result.dataset["DPS"], "I Gusti Ngurah Rai International Airport");
  });
});

describe("diffDatasets()", () => {
  test("classifies added, removed and renamed", () => {
    const diff = diffDatasets({ AAA: "Old Alpha", BBB: "Bravo" }, { AAA: "New Alpha", CCC: "Charlie" });
    assert.deepEqual(diff.added, [["CCC", "Charlie"]]);
    assert.deepEqual(diff.removed, [["BBB", "Bravo"]]);
    assert.deepEqual(diff.renamed, [["AAA", "Old Alpha", "New Alpha"]]);
    assert.equal(diff.changed, true);
    assert.equal(diff.total, 2);
  });

  test("reports no change for identical datasets", () => {
    const diff = diffDatasets({ AAA: "Alpha" }, { AAA: "Alpha" });
    assert.equal(diff.changed, false);
  });
});

describe("validateDataset()", () => {
  const many = (count: number, prefix: string) =>
    Object.fromEntries(
      Array.from({ length: count }, (_, i) => [`${prefix}${String(i).padStart(3, "0")}`.slice(0, 3).toUpperCase(), `Airport ${i}`]),
    );

  const airports = (count: number) =>
    Object.fromEntries(
      Array.from({ length: count }, (_, i) => {
        const n = i.toString(26).padStart(3, "0");
        return [[...n].map((c) => String.fromCharCode(65 + parseInt(c, 26))).join(""), `Airport ${i}`];
      }),
    );

  test("accepts a healthy dataset", () => {
    const dataset = airports(6000);
    assert.doesNotThrow(() => validateDataset(dataset, dataset, AIRPORT_RULES));
  });

  test("rejects an empty dataset", () => {
    assert.throws(() => validateDataset({}, { CGK: "x" }, AIRPORT_RULES), /empty/);
  });

  test("rejects a dataset that is suspiciously small", () => {
    assert.throws(() => validateDataset({ CGK: "x" }, {}, AIRPORT_RULES), /expected at least/);
  });

  test("rejects invalid codes", () => {
    const dataset = { ...airports(6000), "1": "Bad Code" };
    assert.throws(() => validateDataset(dataset, {}, AIRPORT_RULES), /invalid codes/);
  });

  test("rejects empty names", () => {
    const dataset = { ...airports(6000), ZZZ: "  " };
    assert.throws(() => validateDataset(dataset, {}, AIRPORT_RULES), /empty name/);
  });

  test("refuses an update that loses more than 10% of the previous dataset", () => {
    const previous = airports(6000);
    const next = Object.fromEntries(Object.entries(previous).slice(0, 5200));
    assert.throws(() => validateDataset(next, previous, AIRPORT_RULES), /Refusing to overwrite/);
  });

  test("allows a small loss below the guard", () => {
    const previous = airports(6000);
    const next = Object.fromEntries(Object.entries(previous).slice(0, 5900));
    assert.doesNotThrow(() => validateDataset(next, previous, AIRPORT_RULES));
  });

  test("applies the same guards to airlines with their own thresholds", () => {
    const airlines = Object.fromEntries(Array.from({ length: 600 }, (_, i) => [i.toString(36).padStart(2, "0").toUpperCase().slice(0, 2), `Airline ${i}`]));
    assert.throws(() => validateDataset({ GA: "Garuda Indonesia" }, {}, AIRLINE_RULES), /expected at least/);
    assert.doesNotThrow(() => validateDataset(airlines, airlines, AIRLINE_RULES));
  });

  void many;
});

describe("pack()", () => {
  test("round-trips through the runtime lookup format", () => {
    const dataset = { AAA: "Alpha Field", BBB: "Bravo Field" };
    const records = pack(dataset).split(String.fromCharCode(1));
    assert.deepEqual(records, ["AAAAlpha Field", "BBBBravo Field"]);
  });
});
