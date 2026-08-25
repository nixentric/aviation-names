import assert from "node:assert/strict";
import test, { describe } from "node:test";

import { airport } from "../src/airport.ts";
import { airline } from "../src/airline.ts";
import { airline as airlineFromIndex, airport as airportFromIndex } from "../src/index.ts";
import { createLookup } from "../src/lookup.ts";

describe("airport()", () => {
  test("resolves a known code", () => {
    assert.equal(airport("CGK"), "Soekarno-Hatta International Airport");
    assert.equal(airport("DPS"), "I Gusti Ngurah Rai International Airport");
    assert.equal(airport("SIN"), "Singapore Changi Airport");
  });

  test("is case-insensitive and trims", () => {
    for (const input of ["cgk", " CGK ", "  cGk\t", "\nCGK\n"]) {
      assert.equal(airport(input), "Soekarno-Hatta International Airport", `failed for ${JSON.stringify(input)}`);
    }
  });

  test("returns null for unknown codes instead of throwing", () => {
    assert.equal(airport("ZZZ"), null);
    assert.equal(airport("QQQ"), null);
  });

  test("returns null for empty and malformed input", () => {
    for (const input of ["", "   ", "C", "CG", "CGKK", "12", "!!!"]) {
      assert.equal(airport(input), null, `failed for ${JSON.stringify(input)}`);
    }
  });

  test("returns null for non-string input rather than throwing", () => {
    for (const input of [null, undefined, 123, {}, [], true, Symbol("x"), () => {}]) {
      assert.equal(airport(input as unknown as string), null);
    }
  });

  test("does not leak inherited object properties", () => {
    // A plain-object dataset would return a function here.
    for (const key of ["__proto__", "constructor", "toString", "valueOf", "hasOwnProperty"]) {
      assert.equal(airport(key), null, `leaked for ${key}`);
    }
  });
});

describe("airline()", () => {
  test("resolves known designators", () => {
    assert.equal(airline("GA"), "Garuda Indonesia");
    assert.equal(airline("QZ"), "Indonesia AirAsia");
    assert.equal(airline("JT"), "Lion Air");
    assert.equal(airline("ID"), "Batik Air");
    assert.equal(airline("SQ"), "Singapore Airlines");
  });

  test("is case-insensitive and trims", () => {
    for (const input of ["ga", " GA ", " gA\t"]) {
      assert.equal(airline(input), "Garuda Indonesia", `failed for ${JSON.stringify(input)}`);
    }
  });

  test("returns null for unknown, empty and malformed input", () => {
    for (const input of ["ZZ", "", " ", "G", "GAA", "!!"]) {
      assert.equal(airline(input), null, `failed for ${JSON.stringify(input)}`);
    }
  });

  test("returns null for non-string input", () => {
    for (const input of [null, undefined, 0, {}, []]) {
      assert.equal(airline(input as unknown as string), null);
    }
  });

  test("does not leak inherited object properties", () => {
    for (const key of ["__proto__", "toString", "valueOf"]) {
      assert.equal(airline(key), null, `leaked for ${key}`);
    }
  });
});

describe("main entrypoint", () => {
  test("re-exports the same functions as the granular entrypoints", () => {
    assert.equal(airportFromIndex, airport);
    assert.equal(airlineFromIndex, airline);
  });
});

describe("createLookup()", () => {
  const SEP = String.fromCharCode(1);

  test("builds the index lazily, only on a well-formed lookup", () => {
    let splits = 0;
    // createLookup only ever calls .split() on the packed data, so a stand-in
    // makes the one-time index build directly observable.
    const packed = {
      split(separator: string): string[] {
        splits++;
        return `AAAAlpha${SEP}BBBBravo`.split(separator);
      },
    } as unknown as string;

    const lookup = createLookup(packed, 3);

    lookup("XX"); // wrong length: must return early, before touching the index
    assert.equal(splits, 0, "index was built for malformed input");

    assert.equal(lookup("AAA"), "Alpha");
    assert.equal(splits, 1);

    assert.equal(lookup("BBB"), "Bravo");
    assert.equal(splits, 1, "index was rebuilt on a second lookup");
  });

  test("handles names containing separators-adjacent characters", () => {
    const lookup = createLookup(`AAAA & B, Inc.${SEP}BBBCafé "Süd"`, 3);
    assert.equal(lookup("AAA"), "A & B, Inc.");
    assert.equal(lookup("BBB"), 'Café "Süd"');
  });
});
