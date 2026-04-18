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
- missing-parameter flags
- approximate-source flags

The cleaning layer does not destroy the raw inputs. It produces a cleaned bundle and a QC summary.

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

## 8. Intended use of this first build

This first build is intended for:

- isolated review
- method validation
- synthetic testing
- adapter and schema proving

It is **not yet** intended to replace or modify the production dashboard workflow.