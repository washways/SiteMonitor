# Experimental Telemetry Methods

This document explains the methods used in the first isolated experimental telemetry analytics layer.

## 1. Separation of states

The pipeline keeps these states logically separate:

1. **Raw source data**
   - direct adapter fetch results from the upstream API

2. **Normalized telemetry**
   - provider-specific payloads converted into a shared internal schema

3. **Cleaned telemetry**
   - duplicate handling, gap detection, and simple noise adjustment applied

4. **Active event state**
   - temporary in-memory event assembly while scanning a borehole time series

5. **Completed event outputs**
   - one finalized output row per event

This separation makes the workflow easier to audit and safer to extend.

---

## 2. Normalized telemetry schema

Each telemetry point is normalized into a common structure with:

- source identifier
- borehole identifier
- provider name
- parameter name
- UTC timestamp
- numeric timestamp in milliseconds
- value
- unit
- optional sample span
- quality label
- quality flags
- raw reference metadata

For the first build, the normalized parameter set is intentionally narrow:

- flow
- water level above pump

### Source descriptor fields

| Field | Meaning |
|---|---|
| source_id | unique source key for the normalized provider and borehole |
| api_id | adapter or provider ID |
| provider | DCP or SonSetLink |
| site_id | provider site identifier |
| borehole_id | borehole or serial identifier used by the analytics layer |
| display_name | human-readable label |
| country | country or location grouping value |
| lat / lon | optional coordinate values |
| granularity | expected resolution such as hourly or daily-screening |
| confidence_class | analytical or screening confidence |
| metadata | provider-specific metadata retained for traceability |

### Normalized telemetry point fields

| Field | Meaning |
|---|---|
| timestamp_utc | canonical UTC timestamp string |
| timestamp_ms | numeric sortable timestamp |
| window_start_ms | optional start of the sample window |
| sample_span_hours | optional duration represented by the point |
| value | numeric reading after normalization |
| unit | normalized display unit |
| quality | observed or derived |
| flags | QC or provenance tags |
| raw_ref | pointer to the adapter field of origin |
| meta | additional derived context such as raw units or daily totals |

---

## 3. API-specific handling

### DCP
DCP flow and groundwater-level readings are normalized from hourly time-series records and treated as the higher-confidence analytical source.

### SonSetLink
SonSetLink usage rows are normalized into approximate flow and level signals:

- daily totals are converted into estimated flow rates
- slot-array depth values are converted into approximate water-level points
- derived records are explicitly flagged as approximate

This allows one event engine to process both providers without pretending the sources have the same certainty.

---

## 4. Cleaning rules

Cleaning is done per borehole.

The first pass handles:

- sorting by timestamp
- duplicate timestamp collapse
- gap detection based on typical interval
- simple isolated-noise adjustment for extreme flow spikes or dips
- negative flow clamping to zero
- removal of implausible outlier level values
- missing-parameter flags
- approximate-source flags

The cleaning layer does not destroy the raw inputs. It produces a cleaned bundle and a QC summary.

### Why this matters for field telemetry

Real field telemetry is often messy. Sensors can:

- report duplicate timestamps
- skip expected intervals
- send brief negative or zero anomalies
- produce isolated spikes that do not represent real pumping behavior

The cleaning stage is therefore designed to be conservative: it flags issues, makes small defensible corrections, and keeps uncertainty visible for later interpretation.

---

## 5. Pumping-event detection

Pumping events are detected from cleaned normalized flow records using:

- a configurable flow threshold
- a configurable grace period

### Grace period logic
A short pause or brief below-threshold reading does not necessarily close an event immediately. If pumping resumes within the grace window, the event stays open.

This makes the detector more tolerant of:

- irregular sampling
- transient dropouts
- brief zero-flow interruptions

### Additional hardening logic

The detector also carries event-level caution flags when it sees:

- sparse event signals with very few positive samples
- large gaps inside an event window
- windows that appear to end before the event naturally closed

---

## 6. Event metrics

One output row is computed per completed event.

The row includes:

- borehole ID
- event start
- event end
- duration
- total pumped volume
- groundwater level at event start
- groundwater level at last valid non-zero flow
- drawdown
- last valid non-zero flow
- specific capacity
- deepest level reached
- maximum drawdown
- quality flags

### Specific capacity
The experimental calculation uses:

$$
Q/S = \frac{\text{last valid non-zero flow}}{\text{drawdown}}
$$

with the usual safeguard that very small or invalid drawdown values are flagged rather than treated as reliable results.

---

## 7. Quality flags

Quality flags are carried through the event output whenever the engine detects potential issues such as:

- missing water level
- duplicate timestamps
- timestamp gaps
- approximate source
- noisy readings adjusted
- invalid specific capacity

These flags are intended to preserve interpretability rather than hide uncertainty.

---

## 8. Maintainer guidance

If a future maintainer adds another provider, the safe rule is:

1. build a new adapter first
2. normalize into the common schema second
3. only then allow the cleaning, detection, and metrics layers to process the new telemetry

No future provider should bypass the normalized telemetry contract.

---

## 9. Intended use of this first build

This first build is intended for:

- isolated review
- method validation
- synthetic testing
- adapter and schema proving

It is **not yet** intended to replace or modify the production dashboard workflow.