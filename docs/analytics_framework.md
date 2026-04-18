# Analytics framework for the next SiteMonitor layer

Date: 2026-04-18

## Objective

This document defines the next analytics layer to sit on top of the existing event engine.

It is built around the real-data review already completed:

- DCP is the main analytical source for robust borehole metrics
- SonSetLink remains valuable for operational screening, but not for high-confidence hydrogeologic interpretation
- the event engine is already the correct backbone for the next layer
- the next phase should prioritize transparent, conservative metrics rather than broad but fragile scoring

---

## Design principles

### 1. Robust-first design

Only elevate metrics that are well-supported by the current real telemetry.

### 2. Event-engine-first design

The existing event engine remains the core analytical unit. Daily, rolling, site, and network metrics should mostly be derived from:

- cleaned flow and groundwater-level telemetry
- detected pumping events
- event quality flags

### 3. Separate DCP and SonSetLink confidence lanes

The framework should never imply that DCP and SonSetLink have the same analytical strength.

- DCP supports full event-based operational analytics and a subset of hydrogeologic metrics
- SonSetLink supports screening analytics for abstraction and activity, with limited drawdown interpretation

### 4. Explicit metric gating

Every advanced metric should have minimum support thresholds before it is displayed or used in comparisons.

### 5. Transparent interpretation

No black-box score should be introduced without clear formulas, thresholds, and contributing components.

---

## Analytics categories

### 1. Borehole functionality and reliability

Purpose:

Describe whether the borehole appears active, observable, and consistently available from the telemetry now in hand.

Core questions:

- Is telemetry present and recent?
- Is pumping being detected?
- Are there long inactivity periods?
- Are event flags or data gaps limiting trust?

Key metric families:

- telemetry coverage
- active days share
- observed pumping availability
- inactivity streaks
- event flag rates
- analysis readiness tier

### 2. Abstraction and demand patterns

Purpose:

Describe how much the borehole is being used and how usage varies through time.

Core questions:

- how much water is being pumped?
- how many hours per day is the borehole active?
- how many pumping starts occur?
- is demand steady, intermittent, or spiky?

Key metric families:

- daily pumped volume
- daily hours pumped
- daily event count
- rolling weekly or monthly volume
- peak day and peak week load
- activity class such as high-use, low-use, or intermittent

### 3. Borehole performance

Purpose:

Describe how efficiently the borehole delivers water during pumping events.

Core questions:

- how much drawdown occurs during use?
- how does yield compare with drawdown?
- is performance stable or declining?

Key metric families:

- event drawdown
- maximum drawdown
- event specific capacity
- rolling specific-capacity statistics
- drawdown at comparable flow
- performance decline flags

### 4. Groundwater response and sustainability

Purpose:

Describe how the groundwater system appears to respond to pumping and whether there are signs of strain.

Core questions:

- what is the likely resting level between events?
- how quickly does the level return after pumping?
- is drawdown increasing through time?
- are there early signs of stress?

Key metric families:

- resting water level estimates
- rolling resting-level trend
- recovery time statistics
- repeated high-drawdown flags
- low specific-capacity flags
- groundwater-stress review flags

### 5. Cross-site comparison and ranking

Purpose:

Support fair, transparent comparison across boreholes without overstating certainty.

Core questions:

- which sites are most active?
- which sites are most telemetry-ready?
- which appear most stressed among comparable DCP wells?
- which should move to the top of an operational review queue?

Key metric families:

- percentile rankings for safe metrics
- readiness tiers
- activity tiers
- stress review queues
- peer-group comparison tables

---

## Aggregation model

The next analytics layer should be structured into five levels.

### Event-level

Event-level metrics describe one detected pumping event.

Examples:

- duration
- total pumped volume
- event drawdown
- maximum drawdown
- specific capacity
- event quality flags

### Daily

Daily metrics summarize all pumping activity occurring within one day.

Examples:

- daily pumped volume
- hours pumped
- number of pumping events
- daily median resting level
- daily valid-event count

### Rolling-window

Rolling metrics summarize recent behaviour over windows such as 7, 30, or 90 days.

Examples:

- rolling 7 day volume
- rolling 30 day event frequency
- rolling median drawdown
- rolling median specific capacity
- rolling flag share
- rolling resting-level slope

### Site-level

Site-level metrics summarize the current state of one borehole over a chosen review window.

Examples:

- telemetry coverage percentage
- active-day share
- median daily volume
- event-frequency class
- valid Q over S count
- analysis readiness tier

### Network-level

Network-level metrics compare sites and summarize the overall fleet.

Examples:

- share of sites that are active
- share of sites with enough data for performance analytics
- top abstraction sites
- top stress-review candidates
- ranking tables for peer comparison

---

## Proposed data flow

1. use the current cleaned telemetry and current event engine outputs
2. derive event-level metrics for every completed event
3. aggregate event results and flow traces into daily summaries
4. compute rolling windows from the daily and event layers
5. summarize by site and by network
6. display only the metrics that pass the required data gates

---

## Source-specific handling

### DCP lane

DCP should be the main analytical lane for:

- event-based functionality metrics
- daily and rolling abstraction metrics
- drawdown and specific-capacity statistics
- resting-level baselines
- recovery and stress review metrics
- cross-site benchmarking among DCP peers

### SonSetLink lane

SonSetLink should remain a clearly labelled screening lane for:

- daily activity present or absent
- daily pumped volume estimates
- active-day share
- rough demand pattern summaries
- cross-site operational screening

SonSetLink should not drive high-confidence hydrogeologic ranking in the first analytical release.

---

## Metric gating rules

Before showing or benchmarking a metric, the system should check whether the support is sufficient.

Recommended minimum rules:

- event metrics require a detected event and a valid event window
- drawdown metrics require valid start and end groundwater-level support
- specific capacity metrics require valid drawdown of at least 0.05 m and a non-zero flow estimate
- resting-level trends require repeated low-flow timestamps and enough non-pumping level observations
- recovery metrics require post-event level observations after the event closes
- network rankings should only compare boreholes in the same confidence lane and similar readiness tier

---

## Transparent composite concepts

A small number of transparent composite indicators are justified if they stay fully explainable.

### Analysis readiness tier

Purpose:

Tell the user whether a borehole has enough recent data for advanced analytics.

Suggested logic:

- Tier A: strong telemetry coverage and repeated valid events
- Tier B: good telemetry but limited valid hydrogeologic events
- Tier C: telemetry present but inactive or review-needed
- Tier D: insufficient data for analysis

### Stress review flag

Purpose:

Prioritize wells for human review without pretending to diagnose aquifer failure.

Suggested logic:

Raise a review flag when two or more of the following are true within the recent window:

- median drawdown is elevated versus that site’s own history
- median valid specific capacity has fallen materially
- flagged-event share is high
- resting level appears to shift unfavourably

This should remain a review trigger, not a black-box score.

---

## Minimal strong first analytics package

The first production-worthy package should focus on what the real data support best.

### Package A: functionality and abstraction

- telemetry coverage
- active-day share
- daily pumped volume
- hours pumped
- number of pumping events
- 7 day and 30 day abstraction summaries

### Package B: event performance for the good DCP subset

- event drawdown
- maximum drawdown
- valid-event count
- median specific capacity
- quality-flag share

### Package C: groundwater response screening

- daily or rolling resting water level estimate
- recovery time as a caveated review metric
- transparent stress review flags

### Package D: cross-site comparison

- top active sites
- top telemetry-ready sites
- highest drawdown review candidates
- best-supported performance comparison table for DCP wells only

---

## Metrics that depend on additional metadata

The following analytics should be designed for later phases because they need metadata not yet consistently available:

- true service downtime, which needs expected service hours or confirmed outage records
- pump submergence and intake risk, which needs pump intake depth
- demand-per-capita metrics, which need served population or user counts
- safe-yield comparison, which needs design yield or hydrogeologic reference values
- service adequacy metrics, which need local demand expectations and operating policy metadata

---

## Recommended rollout order

1. DCP functionality and abstraction layer
2. DCP event-performance layer
3. DCP resting-level and stress-review layer
4. DCP cross-site comparison board
5. SonSetLink screening board kept separate from the DCP performance board

This sequence matches the real evidence already present in the data and avoids overpromising precision where the coverage is weak.
