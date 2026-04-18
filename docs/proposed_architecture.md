# Proposed architecture for an experimental borehole telemetry analytics module

Last reviewed: 2026-04-18

## Objective

Add a **new experimental telemetry analytics module** without disturbing the production dashboard, pulse report, proxy, or current API integrations.

This proposal is intentionally narrow. The first build should only:

1. normalize telemetry
2. clean telemetry per borehole
3. detect pumping events
4. compute event metrics
5. keep outputs separate from the live site

No production page should depend on the new module until it is explicitly signed off.

---

## Safety principles

1. **Do not alter the live entry points** during the first build
   - leave `public/index.html` untouched
   - leave `public/app.js` untouched
   - leave `public/pulse-report.html` untouched
   - leave `public/report.js` untouched
   - leave `cloudflare-worker/worker.js` untouched unless a future API truly requires it

2. **All new work must live in separate files**
   - separate page
   - separate scripts
   - separate adapter layer
   - separate outputs

3. **API-specific logic must stop at the adapter boundary**
   - downstream analytics must never read DCP or SonSetLink raw payloads directly

4. **The experimental module stays hidden**
   - no navigation link from the main dashboard
   - no navigation link from the pulse report
   - only direct URL access during review and sign-off

---

## Proposed layered design

The new module should be split into six layers.

### 1. API adapters

Responsibility:
- talk to upstream APIs
- handle auth and endpoint quirks
- return raw or semi-raw records in a predictable adapter result

Examples:
- DCP adapter
- SonSetLink adapter
- future API adapters later

Rules:
- one adapter module per API
- no event detection logic here
- no screen rendering logic here
- this is the only layer allowed to know vendor-specific field names

---

### 2. Normalized telemetry layer

Responsibility:
- convert adapter outputs into one internal telemetry schema
- standardize timestamps, site IDs, units, and parameter names

Rules:
- this layer is the contract between adapters and analytics
- once records are normalized, downstream code should not care whether the source was DCP, SonSetLink, or another provider

---

### 3. Cleaning layer

Responsibility:
- sort telemetry
- remove invalid values
- flag duplicates and suspicious gaps
- harmonize units if needed
- attach quality flags without destroying the source record

Rules:
- cleaning should be deterministic and reversible where possible
- do not silently discard important anomalies without flagging them

---

### 4. Event detection layer

Responsibility:
- take cleaned normalized telemetry per borehole
- identify pumping start and stop windows
- remain completely independent of API payload shape

Rules:
- only normalized flow and level series should enter this layer
- the detector should not know what endpoint produced the data

---

### 5. Event metrics layer

Responsibility:
- compute duration, total volume, drawdown, maximum drawdown, recovery, estimated discharge, and specific capacity
- apply diagnostic or quality flags

Rules:
- metrics should be calculated from normalized event inputs
- approximate values should be clearly flagged as approximate

---

### 6. Outputs layer

Responsibility:
- render an experimental table or chart page
- export CSV or JSON
- keep outputs completely separate from production pages

Rules:
- first build outputs should be view-only and isolated
- do not feed experimental results into the existing dashboard table or pulse report yet

---

## Adapter pattern proposal

Use one adapter object or module per API with the same surface.

## Proposed common adapter interface

```js
TelemetryAdapter = {
  id: "string",
  label: "string",
  canHandle(config) => boolean,
  listSources(context) => Promise<Array<SourceRef>>,
  fetchTelemetry(sourceRef, window, context) => Promise<AdapterFetchResult>,
  normalize(adapterResult, context) => Promise<NormalizedTelemetryBundle>
}
```

## Why this is safe

- new APIs can be added by creating a new adapter file only
- the analytics engine never becomes coupled to one vendor
- existing live code can remain unchanged while the experimental stack grows beside it

---

## Proposed normalized internal telemetry format

The first build should normalize into a small, boring, explicit schema.

### A. Borehole source descriptor

```json
{
  "source_id": "DCP:500936",
  "api_id": "API-001",
  "provider": "DCP",
  "site_id": "601",
  "borehole_id": "500936",
  "display_name": "Chapita PS Well 2",
  "country": "Malawi",
  "lat": -13.8698,
  "lon": 34.4533,
  "metadata": {}
}
```

### B. Normalized telemetry point

```json
{
  "source_id": "DCP:500936",
  "borehole_id": "500936",
  "provider": "DCP",
  "parameter": "flow",
  "timestamp_utc": "2026-04-01T00:00:00Z",
  "timestamp_ms": 1775001600000,
  "value": 0,
  "unit": "m3/h",
  "quality": "observed",
  "flags": [],
  "raw_ref": {
    "api": "API-001",
    "field": "time_series.values"
  }
}
```

### C. Allowed initial parameters

For the narrow first build, only support:
- `flow`
- `water_level_above_pump`

Optional later:
- runtime
- power
- pressure
- static depth
- pump state
- rainfall

### D. Normalized telemetry bundle

```json
{
  "source": { ...source descriptor... },
  "series": {
    "flow": [ ...points... ],
    "water_level_above_pump": [ ...points... ]
  },
  "quality_summary": {
    "missing_parameters": [],
    "has_gaps": false,
    "has_duplicates": false,
    "is_approximate": false
  }
}
```

---

## Narrow first-build scope

### Included
- adapter modules for DCP and SonSetLink
- normalization into one common format
- cleaning and QC flags per borehole
- event detection on normalized flow series
- event metrics on normalized flow and level series
- isolated exports to CSV or JSON
- a hidden experimental review page

### Explicitly excluded from the first build
- changes to production dashboard cards or tables
- changes to pulse report behavior
- multi-provider blending inside the live site
- permanent backend storage
- complex new charts on the main dashboard
- advanced model scoring or predictive analytics

---

## Safe reuse from the existing repo

### Safe to reuse directly or adapt carefully
- `public/event-analysis.js`
  - safe as a reference or reusable core for event detection and metric logic
  - best reused through a wrapper or copied into an experimental module rather than editing the live version first

- `public/styles.css`
  - safe for basic visual consistency if a new experimental page needs the same styling
  - avoid major edits to the shared stylesheet during the first build

- current fetch and proxy approach
  - safe to reuse conceptually through the same proxy base and credential model
  - keep new adapter code separate from `public/app.js` and `public/report.js`

### Should remain untouched during the first build
- `public/index.html`
- `public/app.js`
- `public/pulse-report.html`
- `public/report.js`
- `cloudflare-worker/worker.js`
- live navigation links

These files are production-sensitive and should not be part of the first experimental implementation.

---

## Recommended first implementation sequence

### Phase 1 — scaffolding only
1. create the isolated experimental folder and hidden page
2. add adapter stubs for DCP and SonSetLink
3. define the normalized telemetry schema in code comments and docs

### Phase 2 — normalization
4. implement DCP adapter normalization for `flow` and `water_level_above_pump`
5. implement SonSetLink adapter normalization for daily flow and approximate depth slots
6. mark all SonSetLink derived event inputs as approximate

### Phase 3 — cleaning
7. sort records and remove obvious malformed points
8. flag duplicates, large timestamp gaps, null-heavy windows, and unit ambiguity
9. produce one cleaned telemetry bundle per borehole

### Phase 4 — analytics
10. run event detection only on cleaned normalized bundles
11. compute event metrics in a separate module
12. keep DCP and SonSetLink confidence levels explicit in the results

### Phase 5 — outputs
13. render results on the hidden experimental page only
14. allow CSV or JSON export from that hidden page
15. collect review feedback before any live integration discussion

---

## Risks and mitigations

| Risk | Why it matters | Mitigation |
|---|---|---|
| accidental breakage of live dashboard | production-sensitive site | keep all first-build work in new files and an unlinked page |
| API-specific coupling leaking into analytics | hard to scale to future APIs | enforce the adapter boundary and normalized schema |
| SonSetLink over-interpreted as hourly telemetry | misleading hydrogeology | label SonSetLink results as approximate or screening-only |
| performance slowdown | many site-level requests already exist | restrict the first experimental page to one borehole or a small filtered set |
| duplicate logic drift | current repo already has some overlap | centralize only in the new experimental stack, do not refactor production yet |
| unclear timezone handling | event windows can shift | store normalized UTC timestamps plus explicit local display conversion |
| future API growth becoming messy | more providers likely later | require one adapter module and one documentation entry per new API |

---

## Assumptions still needing validation

1. DCP remains the preferred analytical source for event-level Q and S calculations
2. SonSetLink depth slots should remain screening-only unless a more explicit higher-resolution feed is confirmed
3. the existing proxy route is sufficient for the first experimental page and does not need Worker changes
4. the first experimental page can remain hidden and unlinked until sign-off
5. browser-only output storage is acceptable for the first build
6. the current event-analysis thresholds are a starting point, not yet the final accepted hydrogeological standard

---

## Decision summary

The safest path is **not** to extend the live dashboard directly.

Instead:
- create a separate experimental module
- isolate every new concern behind adapters and normalized telemetry
- keep event detection independent of vendor payloads
- keep outputs off the live site until reviewed and approved