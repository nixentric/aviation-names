import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import test, { describe } from "node:test";

const DIST = path.join(import.meta.dirname, "..", "dist");

/**
 * A name that only exists in the airport dataset, and one that only exists in
 * the airline dataset. If either string turns up in the other entry's bundle,
 * the datasets are not actually isolated.
 */
const AIRPORT_ONLY = "Soekarno-Hatta International Airport";
const AIRLINE_ONLY = "Garuda Indonesia";

/** Walks an entry's real import graph the way a bundler would. */
function bundleOf(entry: string): string {
  const seen = new Set<string>();
  const queue = [path.join(DIST, entry)];
  let source = "";

  while (queue.length > 0) {
    const file = queue.pop();
    if (!file || seen.has(file)) continue;
    seen.add(file);

    const contents = readFileSync(file, "utf8");
    source += contents;

    for (const match of contents.matchAll(/from\s*["']([^"']+)["']|require\(["']([^"']+)["']\)/g)) {
      const specifier = match[1] ?? match[2];
      if (!specifier?.startsWith(".")) continue;
      const resolved = path.resolve(path.dirname(file), specifier);
      if (existsSync(resolved)) queue.push(resolved);
    }
  }

  return source;
}

describe("bundle isolation", () => {
  test("dist/ was built before running these tests", () => {
    assert.ok(existsSync(DIST), 'dist/ is missing — run "npm run build" first');
  });

  test('importing "aviation-names/airline" does not pull in the airport dataset', () => {
    const bundle = bundleOf("airline.js");
    assert.ok(bundle.includes(AIRLINE_ONLY), "airline entry is missing its own dataset");
    assert.ok(!bundle.includes(AIRPORT_ONLY), "airline entry leaked the airport dataset");
  });

  test('importing "aviation-names/airport" does not pull in the airline dataset', () => {
    const bundle = bundleOf("airport.js");
    assert.ok(bundle.includes(AIRPORT_ONLY), "airport entry is missing its own dataset");
    assert.ok(!bundle.includes(AIRLINE_ONLY), "airport entry leaked the airline dataset");
  });

  test("the same isolation holds for the CommonJS output", () => {
    const airlineBundle = bundleOf("airline.cjs");
    assert.ok(airlineBundle.includes(AIRLINE_ONLY));
    assert.ok(!airlineBundle.includes(AIRPORT_ONLY));

    const airportBundle = bundleOf("airport.cjs");
    assert.ok(airportBundle.includes(AIRPORT_ONLY));
    assert.ok(!airportBundle.includes(AIRLINE_ONLY));
  });

  test("the main entry carries both datasets", () => {
    const bundle = bundleOf("index.js");
    assert.ok(bundle.includes(AIRPORT_ONLY));
    assert.ok(bundle.includes(AIRLINE_ONLY));
  });

  test("the airline entry is a small fraction of the airport entry", () => {
    const airlineSize = Buffer.byteLength(bundleOf("airline.js"));
    const airportSize = Buffer.byteLength(bundleOf("airport.js"));
    assert.ok(
      airlineSize < airportSize * 0.2,
      `airline bundle ${airlineSize}B is not meaningfully smaller than airport bundle ${airportSize}B`,
    );
  });
});

describe("runtime portability", () => {
  test("the shipped output references no Node built-ins", () => {
    for (const file of readdirSync(DIST).filter((f) => f.endsWith(".js") || f.endsWith(".cjs"))) {
      const contents = readFileSync(path.join(DIST, file), "utf8");
      assert.doesNotMatch(contents, /["']node:/, `${file} imports a node: built-in`);
      assert.doesNotMatch(contents, /require\(["'](fs|path|http|https|zlib|url)["']\)/, `${file} requires a Node module`);
    }
  });

  test("the shipped output performs no network or filesystem access", () => {
    for (const file of readdirSync(DIST).filter((f) => f.endsWith(".js") || f.endsWith(".cjs"))) {
      const contents = readFileSync(path.join(DIST, file), "utf8");
      for (const forbidden of ["fetch(", "XMLHttpRequest", "readFileSync", "readFile(", "WebSocket"]) {
        assert.ok(!contents.includes(forbidden), `${file} contains ${forbidden}`);
      }
    }
  });

  test("both module formats resolve through the package exports map", async () => {
    const pkg = JSON.parse(readFileSync(path.join(DIST, "..", "package.json"), "utf8"));
    for (const subpath of [".", "./airport", "./airline"]) {
      const entry = pkg.exports[subpath];
      assert.ok(existsSync(path.join(DIST, "..", entry.import)), `${subpath} import target missing`);
      assert.ok(existsSync(path.join(DIST, "..", entry.require)), `${subpath} require target missing`);
      assert.ok(existsSync(path.join(DIST, "..", entry.types)), `${subpath} types target missing`);
    }
  });

  test("the CommonJS build is loadable by require()", () => {
    const require = createRequire(import.meta.url);
    const cjs = require(path.join(DIST, "index.cjs"));
    assert.equal(cjs.airport("CGK"), AIRPORT_ONLY);
    assert.equal(cjs.airline("GA"), AIRLINE_ONLY);
  });

  test("the ESM build resolves the documented examples", async () => {
    const esm = await import(path.join(DIST, "index.js"));
    assert.equal(esm.airport("CGK"), "Soekarno-Hatta International Airport");
    assert.equal(esm.airport("DPS"), "I Gusti Ngurah Rai International Airport");
    assert.equal(esm.airline("GA"), "Garuda Indonesia");
    assert.equal(esm.airline("QZ"), "Indonesia AirAsia");
    assert.equal(esm.airline("JT"), "Lion Air");
    assert.equal(esm.airline("ID"), "Batik Air");
    assert.equal(esm.airport("ZZZ"), null);
    assert.equal(esm.airline("ZZ"), null);
  });
});
