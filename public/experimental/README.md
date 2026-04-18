# Experimental Telemetry Lab

This folder contains the **isolated experimental telemetry and analytics layer** for SiteMonitor.

It is intentionally separated from the production dashboard and pulse-report flow.

## Purpose

This module exists to prove a safe pipeline for borehole telemetry analytics without changing the live user-facing site.

The current experimental build does the following:

1. fetch raw telemetry through isolated API adapters
2. normalize both existing APIs into one internal format
3. clean telemetry per borehole
4. detect pumping events with a configurable grace period
5. compute event-level metrics
6. compute daily summary rows
7. compute rolling 7-day and 30-day summary rows
8. compute borehole-level review summaries and typology labels
9. compute cross-site network comparison tables
10. export review outputs as CSV or JSON

It does **not** change the production dashboard, add live alerts, or add ML.

## Safety boundary

This module is isolated in its own page and scripts:

- the main dashboard is untouched
- the pulse report is untouched
- the worker proxy is untouched
- the review page is unlinked from the normal site navigation
- no production page imports any script from this folder

### Critical review result

The current placement is safe because the experimental files live entirely under the experimental folder and are not referenced by the production entry points. The live-sensitive files that must remain protected are:

- index.html
- app.js
- pulse-report.html
- report.js
- cloudflare-worker/worker.js

## Main review pages

Open the hidden review pages directly:

- event review page: [public/experimental/telemetry-lab.html](telemetry-lab.html)
- analytics review page: [public/experimental/analytics-lab.html](analytics-lab.html)
- plain-English summary: [public/experimental/PLAIN_ENGLISH_SUMMARY.md](PLAIN_ENGLISH_SUMMARY.md)

## Folder structure

- [public/experimental/js/adapters](js/adapters)
  - one adapter per API
- [public/experimental/js/normalize](js/normalize)
  - common internal telemetry schema
- [public/experimental/js/cleaning](js/cleaning)
  - duplicate handling, gap detection, and noise handling
- [public/experimental/js/detection](js/detection)
  - pumping-event detection
- [public/experimental/js/metrics](js/metrics)
  - event-level calculations
- [public/experimental/js/analytics](js/analytics)
  - daily, rolling, borehole, and network-level calculations
- [public/experimental/js/outputs](js/outputs)
  - isolated event and analytics rendering plus export helpers
- [public/experimental/tests](tests)
  - synthetic edge-case tests
- [public/experimental/examples](examples)
  - example event and analytics outputs

## Major components

### Adapters
The adapter layer is the only place that knows vendor-specific endpoints and fields.

### Normalized telemetry
All providers are converted into a common internal format before analytics begins.

#### Normalized schema quick reference

Every normalized bundle carries:

- schema version
- source descriptor
- raw series snapshot
- grouped normalized series by parameter
- quality summary
- metadata

Every normalized point carries:

- source ID
- borehole ID
- provider
- parameter
- UTC timestamp and timestamp in milliseconds
- optional sampling span
- numeric value and unit
- quality label
- flags
- raw reference and provenance metadata

### Cleaning
Cleaning keeps raw and cleaned states separate and adds QC flags rather than silently hiding issues.

### Event engine
The event engine works per borehole on normalized and cleaned telemetry only.

### Outputs
Completed event rows, daily rows, rolling rows, borehole summaries, and network comparison tables are kept separate from raw data, normalized telemetry, cleaned telemetry, and active event state.

## Dependency surface

This first build intentionally uses a very small dependency surface:

- browser-native fetch
- browser-native localStorage
- the existing shared proxy path
- no build step
- no package manager dependencies
- no production routing changes

That keeps the review layer easy to audit and lowers the risk of accidental impact on the live site.

## Maintainer rules

If future maintainers extend this experimental layer:

1. add new APIs only through a new adapter file
2. normalize new provider payloads before any cleaning or analytics
3. do not let vendor-specific fields leak into detection or metrics modules
4. keep this page unlinked until the work is explicitly signed off
5. do not edit production files unless a separate review decides to promote the experiment

## Tests
A browser-run synthetic test page is included here:

- [public/experimental/tests/test-runner.html](tests/test-runner.html)

These tests cover:
- irregular intervals
- duplicate timestamps
- noisy readings
- grace-period bridging
- missing water levels
- event metric calculations
- daily analytics calculations
- rolling analytics windows
- borehole and network ranking summaries

## Important note

This experimental module is not yet part of the production workflow. It is a safe review layer only.