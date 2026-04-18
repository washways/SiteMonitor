# Experimental Telemetry Lab

This folder contains the **first isolated experimental telemetry analytics layer** for SiteMonitor.

It is intentionally separated from the production dashboard and pulse-report flow.

## Purpose

This module exists to prove a safe pipeline for borehole telemetry analytics without changing the live user-facing site.

The first build only does the following:

1. fetch raw telemetry through isolated API adapters
2. normalize both existing APIs into one internal format
3. clean telemetry per borehole
4. detect pumping events with a configurable grace period
5. compute event-level metrics
6. export event outputs as CSV or JSON

It does **not** add dashboards, alerts, daily summaries, or ML.

## Safety boundary

This module is isolated in its own page and scripts:

- the main dashboard is untouched
- the pulse report is untouched
- the worker proxy is untouched
- the review page is unlinked from the normal site navigation

## Main review page

Open the hidden review page directly:

- experimental review page: [public/experimental/telemetry-lab.html](telemetry-lab.html)

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
- [public/experimental/js/outputs](js/outputs)
  - isolated output rendering and export helpers
- [public/experimental/tests](tests)
  - synthetic edge-case tests
- [public/experimental/examples](examples)
  - example event outputs

## Major components

### Adapters
The adapter layer is the only place that knows vendor-specific endpoints and fields.

### Normalized telemetry
All providers are converted into a common internal format before analytics begins.

### Cleaning
Cleaning keeps raw and cleaned states separate and adds QC flags rather than silently hiding issues.

### Event engine
The event engine works per borehole on normalized and cleaned telemetry only.

### Outputs
Completed event rows are kept separate from raw data, normalized telemetry, cleaned telemetry, and active event state.

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

## Important note

This experimental module is not yet part of the production workflow. It is a safe review layer only.