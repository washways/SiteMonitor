# Priority metrics for version 1 of the next analytics layer

Date: 2026-04-18

## Aim of version 1

Version 1 should be small, strong, and clearly defensible from the current real data.

It should avoid speculative hydrogeology and instead deliver a solid operational and performance package using the analytics that already have the best real-world support.

---

## Version 1 package recommendation

## Package 1: Borehole functionality and reliability

This should be the first panel because it tells the user which sites can actually be trusted for deeper analysis.

Include:

- telemetry coverage percent for flow and level
- active-day share
- inactivity streak days
- flagged-event share
- analysis readiness tier

Why this belongs in version 1:

- it is strongly supported by the current data
- it prevents users from overinterpreting telemetry-poor sites
- it helps distinguish inactive wells from unavailable or noisy wells

## Package 2: Abstraction and demand patterns

This should be the strongest operational layer.

Include:

- daily pumped volume
- daily hours pumped
- daily pumping-event count
- rolling 7 day and 30 day pumped volume
- rolling event frequency
- high-use, moderate-use, and low-use site classification

Why this belongs in version 1:

- it is robust for DCP and still useful as screening for SonSetLink
- it directly reflects how the system is being used
- it supports cross-site operational prioritization without overreaching

## Package 3: Borehole performance for the DCP subset

This should be the first hydrogeologic performance layer, but only for the wells with enough valid events.

Include:

- event drawdown statistics
- maximum drawdown statistics
- valid-event count
- median valid specific capacity
- rolling median specific capacity for wells with enough support

Why this belongs in version 1:

- the current DCP data support it on the best-instrumented wells
- it is more defensible than recovery or aquifer-parameter modeling
- it provides immediate practical value for comparing Tsachiti, Goneko, and similar wells

## Package 4: Groundwater response screening

This should be included carefully and only where the data pass the support gates.

Include:

- daily or rolling resting water level estimate
- recovery time as a caveated review metric
- transparent stress review flags

Why this belongs in version 1:

- there is enough DCP evidence to support a cautious screening layer
- the outputs can help prioritize attention without claiming more precision than the data support

## Package 5: Cross-site comparison board

This should provide peer comparison among comparable DCP wells and a separate SonSetLink screening board.

Include:

- volume ranking
- event-frequency ranking
- telemetry-readiness ranking
- median valid Q over S ranking for the DCP subset
- stress review queue

Why this belongs in version 1:

- the user needs a practical comparison view across the network
- transparent rank tables are more defensible than opaque scores

---

## Explicit version 1 metric list

### Safe to implement in version 1

| Metric | Source support | Notes |
|---|---|---|
| Telemetry coverage percent | DCP and SonSetLink | show separately for flow and level where possible |
| Active-day share | DCP and SonSetLink | useful as an observed-use indicator |
| Daily pumped volume | DCP strong, SonSetLink screening | core operational metric |
| Daily hours pumped | DCP strong, SonSetLink caveated | stronger for DCP |
| Number of pumping events | DCP strong | screening only for SonSetLink if derived from daily activity |
| Rolling 7 day and 30 day volume | DCP strong, SonSetLink screening | supports demand pattern monitoring |
| Event duration statistics | DCP strong | already supported by event engine |
| Event drawdown statistics | DCP moderate to strong on active subset | show only with valid-event counts |
| Event specific-capacity statistics | DCP moderate on best wells | quality filtered only |
| Analysis readiness tier | DCP and SonSetLink | transparent rule-based tier |
| Cross-site volume ranking | DCP and SonSetLink in separate lanes | do not mix confidence lanes invisibly |

### Include with caveats in version 1

| Metric | Conditions for use | Caveat |
|---|---|---|
| Resting water level estimate | enough non-pumping level points on DCP wells | sign convention and inactive-site context still matter |
| Recovery time | enough post-event levels after valid events | keep labelled as review-only |
| Stress review flag | transparent rule-based trigger with enough valid events | must not be presented as a diagnosis |
| Performance decline flag | only where a current window can be compared with a meaningful site baseline | not enough support on sparse or low-use wells |

### Defer from version 1

| Metric | Why deferred |
|---|---|
| True downtime and uptime | needs expected service hours or confirmed outage metadata |
| Safe-yield or aquifer-test style interpretation | current event layer is not a pumping-test dataset |
| Cross-source hydrogeologic ranking | DCP and SonSetLink are not equivalent in confidence |
| Population-normalized demand metrics | served population metadata is missing |
| Pump submergence or intake risk | intake depth metadata is missing |

---

## Transparent composite rules for version 1

Version 1 should use only simple, interpretable composite indicators.

## 1. Analysis readiness tier

Suggested rules:

- Tier A: high telemetry coverage and at least 5 valid hydrogeologic events in the recent window
- Tier B: high telemetry coverage with pumping activity but too few valid hydrogeologic events for trend work
- Tier C: telemetry present but inactive, low-use, or review-needed
- Tier D: insufficient telemetry for meaningful analytics

## 2. Stress review flag

Suggested rule:

Raise the flag when any two of the following are true:

- rolling median drawdown is materially above the site’s recent baseline
- rolling median valid specific capacity is materially below baseline
- flagged-event share is high
- resting water level estimate shifts unfavourably

This is intentionally not a weighted score. It is a clear review trigger.

## 3. Cross-borehole benchmarking

Use percentile rankings, not opaque composite scores.

Recommended ranking views:

- abstraction intensity percentile
- event-frequency percentile
- telemetry-readiness percentile
- valid specific-capacity percentile for DCP wells with enough valid events
- stress-review queue sorted by evidence columns

---

## Proposed version 1 outputs by audience need

### For operations teams

- which sites are active
- how much water is being pumped
- which sites are inactive or telemetry-poor
- which sites need review now

### For performance review

- event drawdown distributions
- valid specific-capacity summaries
- change from recent baseline on the best-supported wells

### For network oversight

- active-site count
- analyzable-site count
- top abstraction sites
- DCP performance comparison table
- SonSetLink screening summary kept separate

---

## Practical recommendation

If version 1 must stay minimal, the strongest subset is:

1. daily pumped volume
2. daily hours pumped
3. number of pumping events
4. telemetry coverage and readiness tier
5. event drawdown statistics
6. median valid specific capacity on qualified DCP wells
7. cross-site DCP comparison table

That package is small enough to be robust, but strong enough to be genuinely useful.
