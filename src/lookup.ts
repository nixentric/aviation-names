/**
 * Record separator used by the packed dataset representation.
 *
 * U+0001 cannot appear in an airport or airline name, so it is safe as a
 * delimiter and costs one byte per record. It is built from a char code rather
 * than written literally so the generated data files stay free of raw control
 * bytes that editors and diff viewers render invisibly.
 */
export const SEPARATOR = String.fromCharCode(1);

/**
 * Builds an O(1) lookup over a packed `<code><name>` record string.
 *
 * The dataset ships as a single string literal rather than an object literal:
 * it is the smallest gzip payload of the representations benchmarked, and the
 * engine only pays to parse one string at import time. The index is built on
 * the first well-formed lookup, so importing without calling costs nothing
 * beyond the string itself.
 *
 * A Map is used rather than a plain object because `obj["constructor"]` and
 * `obj["toString"]` return inherited functions instead of `undefined`, which
 * would leak a non-name value out of a lookup.
 */
export function createLookup(packed: string, codeLength: number): (code: string) => string | null {
  let index: Map<string, string> | null = null;

  return function lookup(code: string): string | null {
    if (typeof code !== "string") return null;

    const key = code.trim().toUpperCase();
    // Rejects empty, over-long and malformed input before touching the index.
    if (key.length !== codeLength) return null;

    if (index === null) {
      index = new Map();
      for (const record of packed.split(SEPARATOR)) {
        index.set(record.slice(0, codeLength), record.slice(codeLength));
      }
    }

    return index.get(key) ?? null;
  };
}
