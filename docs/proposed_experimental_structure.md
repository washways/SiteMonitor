# Proposed experimental structure

Last reviewed: 2026-04-18

## Goal

Define exactly where the new experimental borehole telemetry analytics work should live so it is isolated from the current production pages.

---

## Recommended repo layout

```text
SiteMonitor/
├── docs/
│   ├── api_inventory.md
│   ├── api_capabilities_plain_english.md
│   ├── proposed_architecture.md
│   └── proposed_experimental_structure.md
├── public/
│   ├── index.html                     # existing live dashboard — do not touch first
│   ├── app.js                         # existing live dashboard logic — do not touch first
│   ├── pulse-report.html              # existing live analytics page — do not touch first
│   ├── report.js                      # existing live report logic — do not touch first
│   ├── event-analysis.js              # existing live event engine reference
│   └── experimental/
│       ├── telemetry-lab.html         # hidden review page, not linked in main nav
│       ├── styles/
│       │   └── telemetry-lab.css      # page-specific styling only
│       └── js/
│           ├── bootstrap.js           # page bootstrapping and UI wiring
│           ├── adapters/
│           │   ├── base-adapter.js
│           │   ├── dcp-adapter.js
│           │   └── sonsetlink-adapter.js
│           ├── normalize/
│           │   ├── telemetry-schema.js
│           │   └── normalize-bundle.js
│           ├── cleaning/
│           │   ├── qc-flags.js
│           │   └── clean-borehole-series.js
│           ├── detection/
│           │   └── detect-pumping-events.js
│           ├── metrics/
│           │   └── compute-event-metrics.js
│           └── outputs/
│               ├── render-review-table.js
│               ├── export-csv.js
│               └── export-json.js
```

---

## Why this structure is safe

### 1. It keeps production code intact
The current live pages remain in place and are not asked to load the new module.

### 2. It isolates responsibilities clearly
- adapters deal with upstream APIs
- normalization defines the internal contract
- cleaning handles QC and corrections
- detection finds events
- metrics computes event values
- outputs display or export the results

### 3. It scales as more APIs are added
A third or fourth provider can be added by placing another adapter file under the adapter folder without changing the downstream analytics modules.

---

## Exact recommendations for each area

## 1. Hidden experimental page

### Recommended location
- `public/experimental/telemetry-lab.html`

### Purpose
- manual review page for the new experimental workflow
- direct URL access only
- not linked from the dashboard, pulse report, or methodology page until approved

### Rule
- if the page is not signed off, it stays unlinked

---

## 2. Adapter modules

### Recommended location
- `public/experimental/js/adapters/`

### Files
- `base-adapter.js`
- `dcp-adapter.js`
- `sonsetlink-adapter.js`

### Rule
Each file handles one provider only.

No downstream file should contain vendor-specific endpoint names or vendor field names.

---

## 3. Normalized telemetry layer

### Recommended location
- `public/experimental/js/normalize/`

### Files
- `telemetry-schema.js`
- `normalize-bundle.js`

### Purpose
Define the internal telemetry shape and ensure all adapters convert into it.

---

## 4. Cleaning layer

### Recommended location
- `public/experimental/js/cleaning/`

### Files
- `qc-flags.js`
- `clean-borehole-series.js`

### Purpose
Standardize ordering, flag quality issues, and prepare clean per-borehole bundles for the detector.

---

## 5. Event detection layer

### Recommended location
- `public/experimental/js/detection/`

### Files
- `detect-pumping-events.js`

### Purpose
Identify pumping windows from normalized telemetry only.

This layer should remain independent from raw DCP and SonSetLink payloads.

---

## 6. Event metrics layer

### Recommended location
- `public/experimental/js/metrics/`

### Files
- `compute-event-metrics.js`

### Purpose
Compute duration, volume, drawdown, maximum drawdown, recovery, and specific capacity from detected events.

---

## 7. Output layer

### Recommended location
- `public/experimental/js/outputs/`

### Files
- `render-review-table.js`
- `export-csv.js`
- `export-json.js`

### Purpose
Keep all experimental presentation and export logic away from the live dashboard and pulse-report rendering code.

---

## What can be reused safely

### Reuse candidates
- existing proxy base and credential pattern
- the current event-analysis logic as a reference baseline
- shared CSS only for basic visual consistency
- CSV and JSON export ideas from the live report code

### Reuse with caution
- any code copied from `public/report.js` should be moved into the experimental structure and cleaned up there
- do not import the live production script wholesale into the experimental page unless the dependency surface is intentionally minimal

---

## What should remain untouched at first

- `public/index.html`
- `public/app.js`
- `public/pulse-report.html`
- `public/report.js`
- `cloudflare-worker/worker.js`
- dashboard navigation and public links

These are the no-touch areas for the first build.

---

## Recommended implementation sequence

1. create the hidden review page and empty module folders
2. implement the base adapter contract
3. implement DCP adapter normalization
4. implement SonSetLink adapter normalization and approximate flags
5. implement the common cleaning functions
6. implement event detection from normalized series
7. implement event metrics from detected events
8. implement review-table and CSV or JSON export only
9. test with a small set of boreholes first
10. review before any production integration decision

---

## Risks and mitigations

### Risk: hidden page accidentally becomes public-facing
Mitigation:
- do not add links from the existing pages
- treat the page as review-only until sign-off

### Risk: production behavior drifts from experimental logic
Mitigation:
- keep the experiment isolated for now
- document all decisions before discussing migration into live pages

### Risk: future APIs create schema sprawl
Mitigation:
- require every new provider to normalize into the same internal telemetry schema
- do not let provider-specific flags leak past the adapter layer except as metadata

### Risk: SonSetLink confidence is overstated
Mitigation:
- preserve approximate flags end-to-end
- clearly distinguish analytical-grade and screening-grade outputs

---

## Assumptions still needing validation

- a hidden page under `public/experimental/` is acceptable for review use
- current proxy behavior is sufficient for the first experimental connector set
- the narrow first build should focus on single-borehole or small filtered analysis rather than full fleet scale
- event thresholds and QC rules will still need user review once the first isolated prototype exists

---

## Short note for future APIs

Every future API should fit this same structure:

- one adapter file under the adapter folder
- one normalization mapping into the common schema
- no direct use of raw payloads inside cleaning, detection, metrics, or outputs

That keeps the architecture scalable while protecting the production site.