# aviation-names

Fast, offline airport & airline name lookup by IATA code.

```ts
import { airport, airline } from "aviation-names";

airport("CGK");
// "Soekarno-Hatta International Airport"

airline("GA");
// "Garuda Indonesia"
```

## Features

- **Instant** — O(1) key lookup, ~27M lookups/sec
- **Offline** — the dataset is bundled, nothing is fetched at runtime
- **No API** — no endpoint to call
- **No API key** — nothing to configure
- **No database** — no query layer, no connection
- **No network requests** — zero at runtime, ever
- **Global coverage** — 9,054 airports, 1,109 airlines
- **Lightweight** — 8.4 KB brotli for airlines alone, 86.3 KB for both
- **Zero runtime dependencies**
- **TypeScript** — full type declarations included
- **Browser compatible**
- **Next.js compatible**
- **Cloudflare Workers compatible**
- **Node.js compatible**
- **Bun compatible**

## Install

```bash
npm install aviation-names
```

## Usage

```ts
import { airport, airline } from "aviation-names";

airport("CGK");
// "Soekarno-Hatta International Airport"

airport("DPS");
// "I Gusti Ngurah Rai International Airport"

airline("GA");
// "Garuda Indonesia"

airline("QZ");
// "Indonesia AirAsia"
```

Lookups are case-insensitive and whitespace-tolerant:

```ts
airport("cgk");   // "Soekarno-Hatta International Airport"
airport(" CGK "); // "Soekarno-Hatta International Airport"

airline("ga");    // "Garuda Indonesia"
airline(" GA ");  // "Garuda Indonesia"
```

Unknown or malformed codes return `null` rather than throwing:

```ts
airport("ZZZ"); // null
airline("ZZ");  // null
airport("");    // null
```

## Granular imports

Import only the dataset you need. An airline-only consumer never pays for the
airport data.

```ts
import { airport } from "aviation-names/airport";
```

```ts
import { airline } from "aviation-names/airline";
```

## API

```ts
airport(code: string): string | null;
airline(code: string): string | null;
```

Both normalize input with `trim` then `toUpperCase`. Both return `null` for
unknown codes, empty strings, wrong-length codes, and non-string values passed
from untyped JavaScript.

## Size

Measured on the built output, including the lookup code.

| Entry | Raw | Gzip | Brotli |
| --- | --- | --- | --- |
| `aviation-names/airport` | 239.6 KB | 92.1 KB | 78.5 KB |
| `aviation-names/airline` | 20.1 KB | 9.6 KB | 8.4 KB |
| `aviation-names` (both) | 258.6 KB | 100.8 KB | 86.3 KB |

## Performance

Run `npm run benchmark` to reproduce these on your own machine.

| Metric | Airport | Airline |
| --- | --- | --- |
| Entries | 9,054 | 1,109 |
| Module import | 2.50 ms | 0.74 ms |
| Index build (first lookup) | 2.24 ms | 0.23 ms |
| Throughput (1M lookups) | 26.8M ops/sec | 33.3M ops/sec |

The dataset is stored as a single packed string and indexed into a `Map` on the
first lookup. Importing the package without calling anything costs only the
string itself.

## Scope

This package does one thing:

```
IATA code in → human-readable name out
```

It deliberately does not provide flight status, routes, schedules, aircraft or
fleet data, coordinates, timezones, weather, geolocation, or fuzzy search.

## Data

| | Airports | Airlines |
| --- | --- | --- |
| Source | [OurAirports](https://ourairports.com/data/) | [Wikidata](https://www.wikidata.org/) P229 |
| Licence | Public domain | CC0 1.0 |
| Refreshed | Daily via CI | Daily via CI |

Dataset updates are proposed by a scheduled GitHub Action, reviewed by a human,
and only published after a release is cut. See [DATA_SOURCES.md](DATA_SOURCES.md)
for the full provenance, filtering rules and known limitations.

**An IATA airline designator does not imply IATA membership.** `aviation-names`
does not use IATA membership as an inclusion criterion, and is not affiliated
with or endorsed by IATA.

## Licence

MIT. Bundled data is public domain / CC0 — see [LICENSE](LICENSE).
