import { AIRPORTS } from "./airports.data.ts";
import { createLookup } from "./lookup.ts";

/**
 * Looks up an airport display name by its 3-letter IATA code.
 *
 * Input is trimmed and upper-cased, so `"cgk"` and `" CGK "` both resolve.
 * Unknown or malformed codes return `null` rather than throwing.
 *
 * @example
 * airport("CGK"); // "Soekarno-Hatta International Airport"
 * airport("ZZZ"); // null
 */
export const airport: (code: string) => string | null = createLookup(AIRPORTS, 3);
