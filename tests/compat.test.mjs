import assert from "node:assert/strict";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test, { describe } from "node:test";

/**
 * Plain JavaScript on purpose.
 *
 * The other suites import TypeScript sources directly, which needs a very
 * recent Node. This one exercises the *built* output only, so it can run on
 * every Node version the package claims to support (>= 18) and prove that
 * claim rather than assert it.
 */

const DIST = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "dist");
const require = createRequire(import.meta.url);

describe("built output, ESM", () => {
  test("resolves airports and airlines", async () => {
    const { airport, airline } = await import(path.join(DIST, "index.js"));

    assert.equal(airport("CGK"), "Soekarno-Hatta International Airport");
    assert.equal(airport("DPS"), "I Gusti Ngurah Rai International Airport");
    assert.equal(airport("SIN"), "Singapore Changi Airport");
    assert.equal(airline("GA"), "Garuda Indonesia");
    assert.equal(airline("QZ"), "Indonesia AirAsia");
    assert.equal(airline("JT"), "Lion Air");
    assert.equal(airline("ID"), "Batik Air");
  });

  test("normalizes and rejects the same way as the sources", async () => {
    const { airport, airline } = await import(path.join(DIST, "index.js"));

    assert.equal(airport("cgk"), "Soekarno-Hatta International Airport");
    assert.equal(airport(" CGK "), "Soekarno-Hatta International Airport");
    assert.equal(airline("ga"), "Garuda Indonesia");
    assert.equal(airline(" GA "), "Garuda Indonesia");

    assert.equal(airport("ZZZ"), null);
    assert.equal(airline("ZZ"), null);
    assert.equal(airport(""), null);
    assert.equal(airline(""), null);
    assert.equal(airport("constructor"), null);
    assert.equal(airline(null), null);
  });

  test("granular entrypoints work standalone", async () => {
    const { airport } = await import(path.join(DIST, "airport.js"));
    const { airline } = await import(path.join(DIST, "airline.js"));

    assert.equal(airport("LHR"), "London Heathrow Airport");
    assert.equal(airline("SQ"), "Singapore Airlines");
  });
});

describe("built output, CommonJS", () => {
  test("loads through require()", () => {
    const { airport, airline } = require(path.join(DIST, "index.cjs"));

    assert.equal(airport("CGK"), "Soekarno-Hatta International Airport");
    assert.equal(airline("GA"), "Garuda Indonesia");
    assert.equal(airport("ZZZ"), null);
  });

  test("granular CommonJS entrypoints work standalone", () => {
    assert.equal(require(path.join(DIST, "airport.cjs")).airport("SIN"), "Singapore Changi Airport");
    assert.equal(require(path.join(DIST, "airline.cjs")).airline("SQ"), "Singapore Airlines");
  });
});
