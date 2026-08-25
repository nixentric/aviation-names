import { AIRLINES } from "./airlines.data.ts";
import { createLookup } from "./lookup.ts";

/**
 * Looks up an airline brand name by its 2-character IATA designator.
 *
 * Input is trimmed and upper-cased, so `"ga"` and `" GA "` both resolve.
 * Unknown or malformed codes return `null` rather than throwing.
 *
 * An IATA airline designator does not imply IATA membership; this package does
 * not use membership as an inclusion criterion.
 *
 * @example
 * airline("GA"); // "Garuda Indonesia"
 * airline("ZZ"); // null
 */
export const airline: (code: string) => string | null = createLookup(AIRLINES, 2);
