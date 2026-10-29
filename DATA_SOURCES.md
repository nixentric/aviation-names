# Data Sources

Everything `aviation-names` ships is derived from openly licensed data with no
redistribution restrictions. This document records what those sources are, why
they were chosen, exactly what is taken from them, and what is known to be
imperfect.

Last verified: **2026-08-25**

---

## Airports

### Source

**OurAirports** — <https://ourairports.com/data/>

- File: `airports.csv`
- Download: <https://davidmegginson.github.io/ourairports-data/airports.csv>
- Repository: <https://github.com/davidmegginson/ourairports-data>
- Size at time of writing: 12,705,298 bytes, 85,945 records
- Regenerated nightly by OurAirports

### Licence

**Public domain.**

The repository ships The Unlicense (SPDX: `Unlicense`), and the project's own
download page states that all data is released to the public domain and comes
with no guarantee of accuracy or fitness for use. The same page notes that
credit is welcome but not required.

| Right | Status |
| --- | --- |
| Redistribution | Permitted, unrestricted |
| Modification | Permitted, unrestricted |
| Attribution | Not required (given anyway, in `LICENSE`) |
| Derivative database requirements | None |

Credit is given in `LICENSE` and in this file as a courtesy, not an obligation.

### Fields used

Only two fields reach the published dataset:

| Field | Use |
| --- | --- |
| `iata_code` | becomes the lookup key |
| `name` | becomes the value |

`type` is read during filtering and then discarded.

Every other column is ignored entirely and never reaches the runtime dataset:
ICAO code, latitude, longitude, elevation, continent, ISO country, ISO region,
municipality, `scheduled_service`, GPS code, local code, home link, Wikipedia
link, and keywords.

### Filtering

An airport is included when:

```
iata_code is present and matches /^[A-Z]{3}$/
AND type !== "closed"
```

Commercial scheduled service is **deliberately not required**. Filtering on
`scheduled_service === "yes"` would cut the dataset from 9,054 to 4,134 entries
and would break lookups for charter, seasonal, cargo, general-aviation and
historical flight records — all legitimate uses of an IATA code.

Measured against the 2026-08-25 dump:

| Check | Result |
| --- | --- |
| Rows in source | 85,945 |
| Rows carrying an IATA code | 9,054 |
| Of those, `type === "closed"` | 0 |
| Codes failing `/^[A-Z]{3}$/` | 0 |
| Duplicate codes | 0 |
| **Published** | **9,054** |

OurAirports strips the IATA code when an airport closes, so the closed-airport
filter currently removes nothing. It is kept as a correctness guard: the
behaviour is upstream policy, not a guarantee.

### Transformations

1. `iata_code` is trimmed and upper-cased.
2. `name` has runs of whitespace collapsed to single spaces and is trimmed —
   community-edited records occasionally contain double spaces or newlines.
3. Records with an empty name after trimming are dropped.
4. Entries are sorted by code so generated diffs stay reviewable.
5. Curated overrides are applied last (see below).

---

## Airlines

### Source

**Wikidata** — <https://www.wikidata.org/>

- Endpoint: <https://query.wikidata.org/sparql>
- Property: [P229](https://www.wikidata.org/wiki/Property:P229) — IATA airline designator
- Queried live by `scripts/update-airlines.ts`

### Licence

**CC0 1.0 Universal** (public domain dedication).

Wikidata's official licensing policy states that all structured data in the
main, property and lexeme namespaces is made available under CC0. (Prose in
other namespaces is CC BY-SA 4.0, but no prose is used here.)

| Right | Status |
| --- | --- |
| Redistribution | Permitted, unrestricted |
| Modification | Permitted, unrestricted |
| Attribution | Not required (given anyway) |
| Derivative database requirements | None |

### Why not OpenFlights

OpenFlights is the obvious candidate and was evaluated first. It was rejected on
two independent grounds:

1. **Stale.** `data/airlines.dat` in `jpatokal/openflights` was last modified on
   **2017-02-02** — over nine years ago. It has no entry for carriers founded
   since, and carries names for airlines that have rebranded or folded.
2. **Share-alike licence.** OpenFlights data is published under the Open
   Database License (ODbL), with contents under the Database Contents License.
   ODbL requires derivative databases made available to the public to be
   released under a free licence too. That obligation would propagate into every
   consumer of `aviation-names`, which is unacceptable for a general-purpose
   utility package.

Coverage comparison, measured 2026-08-25:

| Set | Codes |
| --- | --- |
| Wikidata (P229) | 1,109 |
| OpenFlights, all | 1,105 |
| OpenFlights, `active = Y` | 983 |
| In Wikidata but not in OpenFlights' active set | 170 |

Wikidata is both larger and legally cleaner. OpenFlights was used during
research only, to produce the coverage numbers above; no OpenFlights data is
redistributed by this package.

### Fields used

| SPARQL binding | Use |
| --- | --- |
| `?iata` (P229) | becomes the lookup key |
| `?airlineLabel` | becomes the value |
| `?dissolved` (P576) | ranking only — discarded |
| `?closed` (P3999) | ranking only — discarded |
| `?discontinued` (P2669) | ranking only — discarded |
| `?instances` (P31) | ranking only — discarded |
| `?sitelinks` | ranking only — discarded |

ICAO code, callsign, fleet, country, alliance, website, internal identifiers and
routes are never requested and never shipped.

### Inclusion criterion

```
the entity has a P229 value matching /^[0-9A-Z]{2}$/
```

That is the whole rule.

**An IATA airline designator does not imply IATA membership, and
`aviation-names` does not use IATA membership as its inclusion criterion.** The
two are different things: a carrier can hold a valid designator without being an
IATA member, and this package represents it either way. No IATA membership list
is consulted, and no IATA-proprietary database is scraped or redistributed.

### Resolving reused designators

IATA designators are recycled, so most codes have several historical claimants —
848 of 1,109 codes have more than one Wikidata entity attached. Candidates are
ranked by, in order:

1. **Still operating** — no P576 dissolution, P3999 closure, or P2669
   discontinuation date.
2. **Typed as an airline** — P31 is `airline` or a subtype (regional, cargo,
   charter, low-cost, flag carrier, helicopter), preferred over a holding
   company, trademark or generic business.
3. **Sitelink count** — how many Wikipedias have an article, as a proxy for the
   carrier a passenger actually means.
4. **QID**, ascending, purely so the result is deterministic across runs.

Entities whose English label falls back to a bare QID are dropped, since a QID
is not a brand name.

This is a heuristic over community-maintained data, not an authority. The
override layer exists for what it gets wrong.

### Consumer-facing names

Values are Wikidata's English labels, which are conventionally the brand a
passenger recognises rather than the registered corporate entity — `Garuda
Indonesia`, not `PT Garuda Indonesia (Persero) Tbk`. Where a label drifts toward
the legal name, an override corrects it.

### Known limitations

- **Non-carrier designator holders.** A handful of two-character designators are
  assigned to GDS, distribution and technology companies rather than operating
  airlines (`1U` → ITA Software, `1N` → Navitaire). These are genuine designator
  holders, so they are included by the stated criterion. Remove them with an
  override if that is unwanted for your use case.
- **Wikidata lag.** A rebrand may take days or weeks to reach Wikidata. Overrides
  are the fix, and they take effect on the next dataset run.
- **Missing dissolution dates.** A defunct carrier without a recorded end date
  ranks as operating, and can win a contested code. Sitelink ranking usually
  corrects this; an override always does.
- **Endpoint availability.** The Wikidata Query Service occasionally rate-limits
  or times out. The pipeline retries with backoff and aborts the whole update
  rather than shipping a partial dataset.

---

## Override layer

```
sources/
├── airport-overrides.json
└── airline-overrides.json
```

Overrides have the highest priority in the pipeline and are applied after
normalization, before validation.

### Format

```jsonc
{
  // ADD or UPDATE
  "KM": {
    "name": "KM Malta Airlines",
    "reason": "Air Malta ceased 2024-03-30; upstream label was stale"
  },

  // REMOVE
  "XX": {
    "remove": true,
    "reason": "designator retired, no current holder"
  }
}
```

`reason` is not read by the pipeline. It is required by convention so the next
maintainer knows why an override exists and when it can be dropped.

Because an override wins silently and never expires, every run prints what each
one is actually doing:

```
  ! IU override masks upstream "Midstate Airlines" with "Super Air Jet"
  = QZ override no longer changes anything (upstream agrees)
```

`=` means upstream has caught up and the override is dead weight. `!` names the
value being suppressed — and since IATA designators are recycled, that line is
also how a designator quietly changing hands becomes visible: the masked name
is simply no longer the carrier the override was written for.

### What overrides are for

- new airlines and airports not yet in upstream
- renames and rebrandings
- stale upstream data
- incorrect upstream mappings
- airline closures
- IATA code reassignment
- correcting a legal name back to the consumer-facing brand

### Currently shipped overrides

| Dataset | Code | Override | Reason |
| --- | --- | --- | --- |
| Airport | `DPS` | `I Gusti Ngurah Rai International Airport` | OurAirports prefixes the municipality (`Denpasar I Gusti Ngurah Rai…`); passengers and airline systems use the unprefixed name |
| Airline | `IU` | `Super Air Jet` | Wikidata's Super Air Jet item ([Q107472762](https://www.wikidata.org/wiki/Q107472762)) carries no P229 claim, so the only `IU` claimant upstream is Midstate Airlines, dissolved 1989 |
| Airline | `8B` | `TransNusa` | TransNusa ([Q3537331](https://www.wikidata.org/wiki/Q3537331)) flies as `8B` in 2026 schedules, but Wikidata records its P229 as `M8`, so the only `8B` claimant upstream is Business Air, defunct |
| Airline | `6L` | `Aklak Air` | Aklak Air holds `6L`, but Hokkaido Air System outranks it on sitelinks and flies as `JL`; pins the correct holder against the sitelink tiebreak |
| Airline | `RE` | `Stobart Air` | Aer Arann Islands has no IATA designator (`IATA = -`); `RE`'s last real holder was Stobart Air, ceased 2021-06-12
| Airline | `ZQ` | `German Airways` | Air Montenegro flies as `4O`; `ZQ`'s documented holders are German Airways (ceased 2020) and Locair (ceased 2010)

Wikidata resolves rebrands reliably (`KM` → KM Malta Airlines, `OD` → Batik
Air Malaysia), so the airline file stays reserved for what the ranking cannot
reach: a live carrier whose Wikidata item is missing its designator never
appears in the query at all, and no amount of tiebreaking will surface it.
`RI` (Mandala Airlines, ceased 2014) is the same shape and a candidate for the
same treatment.

---

## Pipeline

```
approved upstream source
          ↓
      normalize
          ↓
   apply overrides
          ↓
       validate
          ↓
   diff vs committed
          ↓
  production dataset
```

Run it with:

```bash
npm run update-data
```

### Validation gates

The update **fails and leaves the last known-good dataset untouched** when any
of these hold:

| Guard | Condition |
| --- | --- |
| Empty download | response shorter than 1 MB (airports) or 100 KB (airlines) |
| Wrong content type | response body starts with `<!doctype html` or `<html` |
| HTTP failure | non-2xx after 3 attempts with backoff |
| Schema change | a required CSV column or `results.bindings` is missing |
| Empty result | zero rows parsed, or zero entries generated |
| Suspiciously small | under 5,000 airports or 500 airlines |
| Invalid codes | any code failing the dataset's code pattern |
| Empty names | any entry with a blank name |
| Duplicate codes | two spellings of one code surviving normalization |
| Mass deletion | more than 10% of the previous dataset disappearing in one update |

Size regressions are checked separately against `size-baseline.json`: over +5%
brotli warns, over +10% fails.

### Change detection

Changes are detected by comparing **normalized content**, never upstream
timestamps. The report distinguishes:

```
+ XYZ → New Airport          (added)
- XYZ → Old Airport          (removed)
~ ABC                        (renamed)
    Old Airport Name
    → New Airport Name
```

If nothing changed, the pipeline stops and nothing is committed, tagged or
released.

### Automation

| Workflow | Trigger | Does |
| --- | --- | --- |
| `.github/workflows/update-data.yml` | daily 03:00 UTC, or manual | fetch → validate → test → benchmark → size check → commit to `main` → version bump + tag → GitHub release → dispatch `release.yml` |
| `.github/workflows/ci.yml` | push, human-opened PRs | typecheck, build, test, size, pack verification; built output re-tested on Node 18/20/22 |
| `.github/workflows/release.yml` | published GitHub release, or dispatched at a `v*` tag | full gate, then publish via npm Trusted Publishing (OIDC) |

An upstream change reaches npm as a patch release with no human in the loop.
A run dispatched by hand can choose `minor` or `major` through the workflow's
`bump` input, which is what a release carrying more than upstream drift needs —
a change to the resolution logic that moves many names at once, for instance.
The schedule has no inputs, so it always falls back to `patch`.
Nothing gates it but code, so the gate is deliberately strict: `validate-data.ts`
refuses a dataset that is empty, too small, badly shaped, internally duplicated
or more than 10% smaller than the last one, and the full build, test, benchmark,
size-regression and pack check all have to pass before anything is tagged. A
failure anywhere leaves the last known-good dataset committed and untagged.

`release.yml` stays the only workflow that publishes — that single filename is
what npm's trusted publisher is configured against. It has a `workflow_dispatch`
trigger because a GitHub release created with the default `GITHUB_TOKEN` does
not fire `release: published`; `workflow_dispatch` is the documented exception,
so `update-data.yml` dispatches it explicitly at the tag it just pushed. The tag
ref matters twice over: it is what `release.yml` checks against `package.json`,
and the `release` environment only accepts deployments from `v*` tags.

To stop shipping automatically, drop the last step of `update-data.yml`: the
data still lands on `main` and the release is still cut, but nothing publishes
until someone dispatches `release.yml` by hand.
