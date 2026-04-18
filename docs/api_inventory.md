# API Inventory

This document records the external APIs currently integrated into SiteMonitor and documents the interface in a repeatable pattern that can scale as more APIs are added.

Last reviewed: 2026-04-18

## Scope and evidence labels

- **Verified from code** = directly observed in the repository
- **Verified from live response** = confirmed by sample calls through the production proxy
- **Inferred from code** = deduced from naming, field usage, or runtime behavior where formal docs are absent or incomplete

---

## Registry summary

| API ID | Name | Primary role | Proxy route used by app | Auth style | Main code touchpoints |
|---|---|---|---|---|---|
| API-001 | DCP Water API v2 | Structured telemetry, site inventory, hourly time series | `/dcp/*` | Header-based API key | `public/app.js`, `public/report.js`, `cloudflare-worker/worker.js` |
| API-002 | SonSetLink Technical API | Site inventory and daily operational telemetry | `/ssl/*` | Query-string login/password | `public/app.js`, `public/report.js`, `cloudflare-worker/worker.js` |

---

# API-001 — DCP Water API v2

## Purpose

Provide structured well and site metadata plus parameter-specific historical telemetry, especially hourly flow and water level above pump.

This is the stronger source for event detection, drawdown analysis, and specific-capacity screening.

## Where it is used in the codebase

### Main dashboard
- `public/app.js`
  - `dcpParameters(headers)` loads the parameter catalog
  - `dcpWells(headers)` loads the well inventory
  - `dcpSites(headers)` loads site-level metadata and component lists
  - `dcpSeries(headers, wellId, startIso, endIso)` loads flow and water-level series for charts and tables
  - `dcpWaterLevelSeries(headers, wellId, startIso, endIso)` loads longer historical water-level series for trend sparklines

### Pulse report / analytics page
- `public/report.js`
  - `dcpWells(headers)` identifies monitored boreholes
  - `dcpSeries(headers, wellId, parameter, startIso, endIso)` fetches event-analysis inputs
  - `analyzeWell(...)` pairs flow and groundwater-level series before passing them into the event-analysis module

### Shared integration layer
- `cloudflare-worker/worker.js`
  - maps `/dcp/*` to `https://api-dev.dcp.solar/water/`
  - injects `X-API-Key` from the Worker secret if the browser does not send one

## Formal documentation status

- **Formal docs available**: `https://api.dcp.solar/water/openapi.json` is referenced in the repo
- The exact behavior documented below is based on both code inspection and live sample responses

## Auth method

### Verified from code
- Browser override: `X-API-Key` request header
- Shared live convenience path: Cloudflare Worker secret `DCP_API_KEY`

### Notes
- On localhost without the proxy path, a user key is required
- On the live shared site, the app can omit the header and rely on the Worker to inject it

## Base URLs and interface points

- Direct upstream base used by the app in local mode: `https://api-dev.dcp.solar/water`
- Shared browser-facing proxy base: `https://wash-proxy.washways1.workers.dev/dcp`

## Endpoints currently used

| Endpoint | Method | Used for | Code usage |
|---|---|---|---|
| `/v2/parameters` | GET | Parameter labels and units | dashboard table headings |
| `/v2/wells` | GET | Borehole inventory | dashboard site list and analytics borehole list |
| `/v2/sites` | GET | Site metadata, well grouping, components | dashboard metadata enrichment |
| `/v2/wells/{wellId}/timeseries?parameter=flow` | GET | Hourly discharge series | flow charts, totals, event analysis |
| `/v2/wells/{wellId}/timeseries?parameter=water_level_above_pump` | GET | Hourly groundwater response series | depth charts, trends, drawdown, Q/S |

## Request structure

### 1) Inventory requests

```http
GET /v2/wells
Accept: application/json
X-API-Key: <optional when proxy secret is injected>
```

```http
GET /v2/sites
Accept: application/json
X-API-Key: <optional when proxy secret is injected>
```

```http
GET /v2/parameters
Accept: application/json
X-API-Key: <optional when proxy secret is injected>
```

### 2) Time-series request

```http
GET /v2/wells/{wellId}/timeseries?parameter=<parameter>&from=<ISO-UTC>&to=<ISO-UTC>
Accept: application/json
X-API-Key: <optional when proxy secret is injected>
```

### Query parameters observed in code
- `parameter` = `flow` or `water_level_above_pump`
- `from` = ISO-8601 UTC string
- `to` = ISO-8601 UTC string

## Response structure

### A. Well inventory response

**Verified from live response**: array of objects such as

```json
{
  "well_id": "500936",
  "name": "Chapita PS Well 2",
  "commissioned_date": "2024-11-14T00:00:00",
  "last_seen": "2026-04-17T09:00:24",
  "location": { "lat": -13.8698, "lon": 34.4533 }
}
```

### B. Site response

**Verified from live response**: array of objects such as

```json
{
  "site_id": 601,
  "name": "Chapita PS",
  "commissioned_date": "2024-11-14T00:00:00",
  "location": { "lat": -13.8698, "lon": 34.4533 },
  "wells": [
    { "well_id": "500936", "name": "Chapita PS Well 2", "last_seen": "2026-04-17T09:00:24" }
  ],
  "components": [
    { "name": "Depth Sensor - GLT500", "serial_number": "2310414007", "functional_status": "functional" }
  ]
}
```

### C. Parameter catalog response

**Verified from live response**: array of parameter definitions such as

```json
{
  "id": "flow",
  "label": "Aggregated flow",
  "unit": "m3/h",
  "waterml_category": "discharge"
}
```

and

```json
{
  "id": "water_level_above_pump",
  "label": "Water level above pump",
  "unit": "m",
  "waterml_category": "groundwaterLevel",
  "reference": "pump_intake",
  "positive_direction": "up"
}
```

### D. Time-series response

**Verified from live response**: object with keys `well_id`, `parameter`, and `time_series.values`

```json
{
  "well_id": "500936",
  "parameter": "flow",
  "time_series": {
    "values": [
      { "time": "2026-04-01T00:00:00Z", "value": 0.0 },
      { "time": "2026-04-01T01:00:00Z", "value": 0.0 }
    ]
  }
}
```

## Important fields actually relied on by SiteMonitor

| Field | Meaning in app | Used for |
|---|---|---|
| `well_id` | Borehole identifier | joins, chart labels, event rows |
| `name` | Human-readable well or site name | table and chart labels |
| `last_seen` | freshness indicator | recency filters and marker opacity |
| `location.lat`, `location.lon` | site mapping | map display, Malawi classification |
| `components[].functional_status` | asset metadata | detail panel display |
| `parameter` | series type | chart selection and event pairing |
| `time_series.values[].time` | timestamp | historical ordering |
| `time_series.values[].value` | reading value | totals, drawdown, event detection |
| `unit` | display unit | table heading labels |

## Timestamp handling

### Verified from code and live response
- DCP time-series values arrive as ISO timestamps such as `2026-04-01T00:00:00Z`
- The app parses them with the browser date constructor and stores them as milliseconds since epoch
- For reporting and daily grouping, the frontend converts them into Malawi local-day buckets using a fixed UTC+2 offset

### Operational consequence
- The source itself is UTC-oriented and relatively clean for historical analysis
- Local day totals shown to users are a frontend transformation, not a raw API aggregation

## Batching and pagination

### Verified from code
- No pagination logic is implemented anywhere in the repo for DCP
- The dashboard appears to assume that `/v2/wells`, `/v2/sites`, and `/v2/parameters` return complete arrays in one response
- Time-series requests are made per well and per parameter

### Client batching behavior
- Main dashboard table fetches sites in small batches of 5 to reduce browser pressure
- Pulse report processes filtered sites in chunks of 4 or 8 depending on scan mode

### Inferred from code
- If the upstream DCP inventory becomes much larger, pagination or server-side filtering may eventually be required even though the current app does not use it

## Retry and error handling

### Verified from code
- No automatic retry or exponential backoff is implemented
- The fetch helper throws on non-OK HTTP status or invalid JSON
- Site-level failures are caught and converted into empty rows or skipped events
- Errors are surfaced in the status bar or report log

## Real-time vs historical suitability

| Use case | Suitability | Reason |
|---|---|---|
| Live operational status | Good | `last_seen` and recent hourly data support near-live views |
| Historical trend review | Strong | stable timestamped time series |
| Pumping-event detection | Strong | hourly flow and level pairing |
| Specific-capacity screening | Strong | provides both discharge and groundwater response |
| High-frequency sub-hourly diagnostics | Unclear | the current app only uses hourly outputs |

## Limitations, ambiguities, and risks

- The app only uses two DCP parameters at present: `flow` and `water_level_above_pump`
- No retry logic means transient failures can show up as site errors or missing rows
- The browser currently fans out many per-well requests, which can become slow as the monitored fleet grows
- The repo treats country classification mostly as a frontend geographic rule, not as an authoritative API field
- The code points to `api-dev.dcp.solar`; production stability assumptions should be reviewed if that environment changes

---

# API-002 — SonSetLink Technical API

## Purpose

Provide SonSetLink device and site inventory plus daily usage-style telemetry used for operational screening, total-flow reporting, and approximate event summaries.

This source is currently better for screening and asset monitoring than for rigorous hourly pumping-event analysis.

## Where it is used in the codebase

### Main dashboard
- `public/app.js`
  - `sslSites()` loads the SonSetLink site inventory for map and table rows
  - `sslSeries(siteId, serial, startUtc, endUtc)` probes several device-specific endpoints to find usable telemetry
  - `getSslDailyFlow`, `getSslCumulativeFlow`, `sslDepthPoints`, and `buildSslResolutionSummary` interpret daily flow and slot-array depth data for charts

### Pulse report / analytics page
- `public/report.js`
  - `sslSites()` loads monitored SonSetLink devices
  - `sslSeries(...)` fetches the best available data window
  - `buildSslEvents(...)` converts daily totals and depth slots into approximate screening-level event rows

### Shared integration layer
- `cloudflare-worker/worker.js`
  - maps `/ssl/*` to `https://sonsetlink.org/water/technical/`
  - injects `login` and `password` query parameters from Worker secrets if the browser omits them

## Formal documentation status

- **No formal SonSetLink API docs are present in this repo**
- Most of the behavior below is therefore **inferred from code and verified live responses**
- Endpoint variability appears device-specific rather than strictly versioned

## Auth method

### Verified from code
- Query parameters `login` and `password`
- Shared live convenience path uses Worker secrets `SSL_USER` and `SSL_PASS`

### Notes
- Credentials are placed in the URL query string rather than in an HTTP header
- This is practical for the current static-site design, but it is less elegant and more exposure-prone than header-based auth

## Base URLs and interface points

- Direct upstream base used by the app in local mode: `https://sonsetlink.org/water/technical`
- Shared browser-facing proxy base: `https://wash-proxy.washways1.workers.dev/ssl`

## Endpoints currently used or probed

| Endpoint | Method | Status in current app | Purpose |
|---|---|---|---|
| `/sites.json.php` | GET | actively used | list monitored sites and metadata |
| `/usage.json.php` | GET | actively used | daily usage and cumulative flow rows |
| `/status.json.php` | GET | probed | alternate telemetry source when device setup differs |
| `/diag.json.php` | GET | probed | fallback / diagnostic table |
| `/test.json.php` | GET | probed | fallback / diagnostic table |
| `/usage1_msg.json.php` | GET | probed | device-specific fallback |
| `/usage8_msg.json.php` | GET | probed | device-specific fallback |
| `/usage12_msg.json.php` | GET | probed | device-specific fallback |

## Request structure

### 1) Site inventory request

```http
GET /sites.json.php?login=<user>&password=<pass>
```

### 2) Usage-style telemetry request

```http
GET /usage.json.php?login=<user>&password=<pass>&site=<siteId>&serial=<serial>&start_date=<YYYY-MM-DD HH:MM:SS>&end_date=<YYYY-MM-DD HH:MM:SS>&feature[]=backfill&feature[]=decumulation
```

### Query parameters observed in code
- `login`
- `password`
- `site`
- `serial`
- `start_date`
- `end_date`
- `feature[]=backfill`
- `feature[]=decumulation`

### Inferred from code
- Several alternate endpoint names represent different backing tables or device layouts
- The app searches them sequentially until it finds one that returns usable rows

## Response structure

### A. Site inventory response

**Verified from live response**: array of device/site objects with fields including

- `site`
- `serial`
- `name`
- `location`
- `latitude`
- `longitude`
- `most_recent_tx`
- `flow_total`
- `flow_unit`
- `timezone`
- `status`
- `table`
- `slots`
- `usage`
- `diag`

Example shape:

```json
{
  "site": 811,
  "serial": "SN-375",
  "name": "SN-375",
  "location": "Malawi",
  "latitude": -13.9,
  "longitude": 34.4,
  "most_recent_tx": "2026-04-02 00:08:46",
  "flow_total": 0,
  "flow_unit": "L",
  "timezone": "Africa/Blantyre"
}
```

### B. Usage row response

**Verified from live response**: array of daily-ish records such as

```json
{
  "serial": "SN-375",
  "name": "SN-375",
  "site": 811,
  "timestamp": "2026-04-02 00:08:46",
  "adjusted_timestamp": "2026-04-01 23:59:59",
  "flow1": 1650,
  "deflow": 550,
  "sensor2": "[0,0,0,0,0,0,0,0]",
  "sensor3": "[0,0,0,0,0,0,0,0]",
  "time_in_use": null,
  "days": 1
}
```

## Important fields actually relied on by SiteMonitor

| Field | Meaning in app | Used for |
|---|---|---|
| `site` | site identifier | requests and joins |
| `serial` | device identifier | requests, labels, synthetic well ID |
| `name` | display name | table and chart labels |
| `location` | country/location text | dashboard filters |
| `latitude`, `longitude` | map coordinates | map display |
| `most_recent_tx` | freshness indicator | recent filters and status |
| `deflow` | daily flow total | total-flow reporting and approximate event volume |
| `flow1` | cumulative meter reading | cumulative-flow chart |
| `sensor2` | JSON-like numeric array | approximate sub-daily depth pattern |
| `time_in_use` | inferred active duration | estimated event flow for screening |
| `adjusted_timestamp` | preferred end-of-day timestamp | ordering and event timing |

## Timestamp handling

### Verified from code and live response
- SonSetLink rows expose `timestamp` and sometimes `adjusted_timestamp` as strings like `2026-04-02 00:08:46`
- The frontend appends `Z` and parses them as UTC-style strings
- The reporting layer then groups them into Malawi local-day logic for display and screening

### Inferred risk
- The raw strings do not include an explicit timezone suffix, so timezone interpretation is somewhat ambiguous
- The app currently assumes a stable conversion path; any upstream timezone change could shift daily boundaries

## Batching and pagination

### Verified from code
- No pagination logic exists in the repo for SonSetLink responses
- The app fetches site inventory in one call, then requests telemetry site-by-site
- In fast mode it returns the first endpoint that yields rows
- In deep mode it scans and merges multiple endpoint variants with deduplication

### Client batching behavior
- Main dashboard batches rendering work across sites
- Pulse report processes filtered sites in chunks of 4 or 8

## Retry and error handling

### Verified from code
- No true retry or backoff is implemented
- Instead, the app performs **endpoint fallback scanning** across several SonSetLink endpoint names
- Some failed endpoint calls are intentionally silenced because 404 or empty responses are expected for many devices
- If all endpoint variants fail, the device simply contributes no rows

## Real-time vs historical suitability

| Use case | Suitability | Reason |
|---|---|---|
| Live operational status | Moderate | freshness and daily totals are helpful |
| Historical trend review | Moderate | daily records support trend screening |
| Pumping-event detection | Weak to moderate | currently inferred from daily totals, not true hourly telemetry |
| Specific-capacity screening | Approximate only | relies on estimated flow and slot-array depth patterns |
| High-resolution hydrogeology | Weak | current interface is not truly high-frequency for most tested devices |

## Limitations, ambiguities, and risks

- Endpoint behavior is device-specific and not fully standardized
- The app must probe several alternate endpoints to find usable tables
- Some rows use stringified arrays rather than explicit structured sensor objects
- Timestamp timezone semantics are not fully explicit in the payload
- The current best available depth detail comes from slot arrays such as `sensor2`, which are useful for screening but not equivalent to timestamped hourly depth telemetry
- The analytics layer correctly flags SonSetLink-derived event rows as approximate daily screening reports

---

# Architectural comparison of the two APIs

| Topic | DCP Water API v2 | SonSetLink Technical API |
|---|---|---|
| Interface style | More conventional REST-style JSON API | PHP endpoint collection with device-specific table variants |
| Auth | Header-based API key | Query-string credentials |
| Data granularity used here | Hourly time series | Mostly daily records plus slot arrays |
| Event-analysis quality | Stronger for Q/S and drawdown | Screening-only approximation |
| Metadata stability | Higher | More heterogeneous |
| Error model in the app | throw and surface error | probe alternate endpoints and tolerate failure |
| Best architectural role | primary analytical telemetry source | complementary monitoring and screening source |

### Main architectural difference

DCP is currently integrated as a structured telemetry source suitable for real analysis. SonSetLink is integrated as a more variable operational source that needs interpretation and fallback handling before it can be used in the same dashboard.

---

# Recommended pattern for documenting future APIs

Every new API should be added as a new registry entry using the same structure:

1. API ID and name
2. Purpose in the product
3. Exact code touchpoints
4. Auth method
5. Base URLs and proxy route, if any
6. Endpoints or interface points used
7. Request structure
8. Response structure with sample fields
9. Important fields actually consumed by the app
10. Timestamp handling and timezone assumptions
11. Batching, pagination, rate limits, and caching
12. Retry and error handling
13. Real-time vs historical suitability
14. Limitations, ambiguities, and risks
15. Evidence label: verified or inferred

That keeps the inventory scalable when more providers are added later.