# Real data profile of the current telemetry and event system

Date: 2026-04-18

## Scope of this review

This review profiles the real data already available through the existing SiteMonitor system before adding new analytics.

The profile used:

- the current DCP telemetry feeds already used by the live system
- the current SonSetLink feeds already used by the live system
- the current event logic already implemented in the dashboard and experimental review layer
- a recent 90 day operational window as a practical snapshot of current behaviour

The goal here is not to propose new metrics yet. The goal is to understand what the data can actually support now.

---

## Snapshot summary

| Source | Listed sources | Sources with recent telemetry | Sources with real pumping activity | Event-like outputs now available | Hydrogeologic confidence |
|---|---:|---:|---:|---:|---|
| DCP | 21 wells | 10 with both flow and level | 7 with positive flow | about 130 pumping events in the last 90 days | strongest current source |
| SonSetLink | 54 sites | 33 with usage rows | 15 with positive days | 851 daily screening event rows in the last 90 days | screening only |

### Key DCP findings

- Event duration is fairly consistent. Median event duration is about 10 hours and the 95th percentile is about 12 hours.
- Final flow is usually modest. Median final flow is about 0.46 m3/h and the 95th percentile is about 1.89 m3/h.
- Drawdown is measurable for many DCP events, but not all. Median drawdown is about 0.34 m and the 95th percentile is about 4.38 m.
- Specific capacity is available for roughly 75 to 77 events, mainly from a small active subset of wells.
- Real activity is highly concentrated. Roughly 95 percent of detected DCP events are concentrated in Tsachiti, Goneko, and Namulera.

### Key SonSetLink findings

- SonSetLink is useful for operational screening and activity presence or absence.
- Most SonSetLink rows behave like daily summaries rather than true event traces.
- Median apparent duration is 24 hours because the source is usually daily rather than hourly.
- Median estimated flow is very low, around 0.015 m3/h, and most depth-supported rows still show near-zero drawdown.
- Only 6 of the 54 SonSetLink sites showed any days with potentially usable Q over S style estimates in the current window.

---

## What the normalized and cleaned telemetry really looks like

### DCP normalized telemetry

The current DCP feeds are the most analytically useful part of the system.

Observed characteristics from the real data:

- hourly-like spacing is dominant, with a typical interval of about 1 hour on active wells
- timestamps are generally orderly
- the normalized bundle is already close to analysis-ready for active wells
- flow and water level are both available for the same 10 wells in the recent window

### DCP cleaned telemetry

The cleaning layer is useful, but it is not doing heavy reconstruction. It is mostly acting as a quality gate.

Across the recent DCP window the cleaned review found:

- 11791 cleaned flow points
- 11392 cleaned groundwater-level points
- 1 negative flow value that needed clamping to zero
- 18 isolated noisy flow readings adjusted
- 45 timestamp gap flags across all active DCP wells
- 0 duplicate timestamp collapses
- 0 extreme flow removals
- 0 implausible groundwater-level outlier removals

Interpretation:

- the biggest DCP issue is not random corruption
- the bigger issue is uneven source coverage across wells and some sign or interpretation ambiguity in the level response

### SonSetLink normalized and cleaned telemetry

SonSetLink normalization is functioning as intended, but the source itself is much weaker for hydrogeologic analytics.

Observed characteristics from the real data:

- many sites return daily usage rows
- many rows include depth-slot arrays, but these behave like approximate within-day patterns rather than true continuous water-level traces
- most rows produce tiny or zero-like drawdown after normalization
- this makes SonSetLink valuable for operational screening, but weak for drawdown-based hydrogeology

---

## Real behavioural patterns now visible in the boreholes

### 1. Activity is concentrated in a small subset

The live system is not seeing evenly distributed pumping across all listed boreholes.

The clear high-activity DCP wells are:

- Tsachiti PS Well
- Goneko Community PS Well
- Namulera PS Well

Tsachiti and Goneko dominate both event counts and pumped volume. Most other DCP wells are currently low-use, inactive, or have no recent telemetry.

### 2. Short-to-moderate pumping windows are common

The current event engine is mainly detecting pumping windows on the order of hours rather than multi-day abstractions.

This supports:

- event counting
- duration distributions
- total pumped volume by event
- abstraction intensity summaries

### 3. Drawdown is real but not universally stable

There is enough real drawdown signal to support some event-based groundwater interpretation, especially on the most active DCP wells.

But the current data also show caution signs:

- about 42 DCP events showed negative drawdown or level rebound during the same event
- about 56 DCP events were invalid for specific capacity because the drawdown was missing, negative, or too small
- SonSetLink drawdown is usually too small for dependable Q over S interpretation

### 4. Recovery behaviour is visible, but only for a subset

For DCP events with positive measurable drawdown, post-event levels are often available and apparent return toward the start level is often quick.

In the recent DCP profile:

- 75 positive-drawdown events had enough post-event level samples to inspect recovery in the next 24 hours
- those recoveries often appeared within about 1 to 2 hours

This is encouraging, but the very fast apparent recovery and the frequent within-event reversals mean recovery time should still be treated cautiously until sign conventions are fully locked down.

### 5. Missingness is a first-order constraint

Missingness is not evenly spread.

Examples:

- 11 of the 21 DCP wells had no recent flow telemetry at all in the profile window
- some wells had groundwater-level traces but no recent pumping
- SonSetLink coverage is broader in count, but much weaker in hydrogeologic resolution

This means network-wide analytics will be misleading unless they explicitly separate:

- active and telemetry-rich wells
- telemetry-present but inactive wells
- telemetry-poor or unavailable wells

---

## Practical interpretation of the current event tables

The current event tables already support a useful operational view, especially for DCP:

- event count
- duration
- total volume
- last or final flow
- drawdown and maximum drawdown where valid
- simple quality flags

The current event tables are much less reliable for:

- network-wide recovery timing
- fully comparable Q over S across all wells
- hydrogeologic ranking of SonSetLink sites

---

## Bottom line

The real system already contains enough signal to support robust DCP-first operational analytics.

What is strongest now:

- event frequency
- pumping duration
- abstraction volume or intensity
- data-health screening
- resting level baselines for the level-rich DCP subset

What remains fragile now:

- network-wide specific capacity trend analysis
- recovery timing as a decision KPI
- hydrogeologic interpretation from SonSetLink daily-derived data
