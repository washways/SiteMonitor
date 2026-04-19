# Experimental Research Methods for Hidden Review Pages

## Experimental research notice

This document describes the methodology used by the hidden experimental review pages in this repository.

It is **research-only and experimental**.

The outputs are intended for:

- internal review
- QA and debugging
- method development
- cautious hydrogeologic screening

The standard starting workflow on the hidden review pages is now:

- all available DCP boreholes in Malawi
- last 14 days
- loading spinner shown while telemetry and calculations are running
- shared cached report reused across all the experimental review pages once loaded

They are **not** presented as official public reporting, final engineering judgement, or automated operational decision-making.

---

## 1. Overview of the experimental pipeline

The current experimental analytics flow is deliberately staged so that every transformation is inspectable:

1. raw provider fetch
2. provider normalization into a shared schema
3. conservative cleaning and QC flagging
4. pumping-event detection
5. event-level Q/S and drawdown metrics
6. daily summaries
7. trailing 7-day and 30-day summaries
8. borehole-level summaries
9. network-level comparisons
10. interpretation and review labels
11. Q/S method comparison board for cross-checking candidate approaches site by site

This staged design is important because it keeps the calculations auditable and allows later reviewers to inspect where a value came from.

The hidden pages also have distinct roles:

- network overview = whole-network scan
- borehole detail = single-site investigation with a simple readable summary list
- cross-site comparison = side-by-side ranking and comparison
- Q/S method comparison = a compact visual summary plus one all-site method table for cross-checking Q/S values
- field review board = practical action shortlist

The older prototype lab pages have been removed from the retained workflow so the review set now stays focused on these current pages only.

---

## 2. Research scope and confidence lanes

The system currently uses two source lanes:

### DCP
DCP provides the higher-confidence analytical lane because it typically offers hourly flow and groundwater telemetry that can support event-based calculations.

### SonSetLink
SonSetLink remains a screening lane. It can contribute useful operational context, but its derived hydrogeologic parameters are more approximate and are flagged accordingly.

To reduce confusion, the separate SonSetLink screening page has been retired from the main workflow. If SonSetLink needs to be reviewed, it can still be loaded from the advanced provider option on the main experimental pages.

Where the code creates approximate or screening values, those flags are intentionally preserved in the outputs.

The current default opening workflow on the hidden review pages is DCP for Malawi over the last 14 days. This is intended to give users a fast and higher-confidence starting point before they open advanced options.

---

## 3. Shared normalized telemetry schema

All providers are normalized into one internal structure before any analytics begin.

Each point carries:

- source identifier
- provider name
- borehole identifier
- parameter name
- UTC timestamp
- numeric timestamp in milliseconds
- numeric value
- unit
- optional sample span in hours
- quality label
- QC flags
- raw provenance metadata

For the current experimental build, the main normalized parameters are:

- flow
- water level above pump

This means the downstream calculations do not rely on vendor-specific fields directly.

---

## 4. Cleaning and quality control

The cleaning layer is intentionally conservative.

It handles:

- time sorting
- duplicate timestamp collapse
- gap detection
- limited noise adjustment for isolated spikes or dips
- negative-flow clamping to zero where appropriate
- implausible-value filtering
- propagation of approximate-source and data-quality flags

The raw telemetry is not overwritten. The cleaned result is a separate analytical state.

This is important because field telemetry often contains:

- duplicate timestamps
- missed transmissions
- transient zeros
- noisy excursions
- partial post-event recovery windows

Rather than hiding these issues, the experimental layer tries to keep them visible.

---

## 5. Pumping-event detection methodology

Events are detected from cleaned flow telemetry using two main settings:

- flow threshold
- grace period in hours

### 5.1 Event start rule
A pumping event begins when flow rises above the configured flow threshold.

### 5.2 Event continuation rule
Once an event is open, a brief below-threshold interval does not immediately close it. If pumping resumes within the grace window, the same event continues.

### 5.3 Event closure rule
An event closes when the below-threshold quiet period lasts at least as long as the grace period, or when the review window ends.

### 5.4 Event detection flags
The code marks cautionary cases such as:

- sparse event signal
- event contains gap
- window ended while event active

This matters because a poor or truncated event window should not be treated the same as a clean fully observed event.

---

## 6. Event-level Q/S and drawdown calculations

This is the core methodology for the experimental Q/S values.

### 6.1 Event duration
For each completed event:

- duration_hours = (event_end_ms - event_start_ms) / 1 hour

### 6.2 Event pumped volume
The experimental code estimates event volume from all positive-flow points in the event.

If a point already carries an explicit sample span, the code uses:

- contribution = flow × sample_span_hours

Otherwise it uses the time to the next point, capped by a default hourly interval, so that:

- contribution = flow × inferred_hours_until_next_sample

Then:

- total_pumped_volume_m3 = sum of all event point contributions

### 6.3 Start level, end level, and deepest level
The code searches for the nearest groundwater-level observations around the event timeline and stores:

- groundwater level at event start
- groundwater level at last valid non-zero flow
- deepest level reached during the event

### 6.4 Drawdown
The event drawdown is currently calculated as:

- drawdown_m = start_level − level_at_last_valid_non_zero_flow

### 6.5 Maximum drawdown
A second, stronger event indicator is:

- maximum_drawdown_m = start_level − deepest_level_reached

This captures the deepest response observed during the event, not just the value at the last positive-flow point.

### 6.6 Specific capacity, Q/S
The experimental layer now computes several switchable event-level Q/S candidates rather than only one value.

These include:

- current proxy = last valid non-zero flow ÷ end-of-event drawdown
- max stress proxy = maximum observed flow ÷ maximum observed drawdown
- event median proxy = median positive event flow ÷ maximum observed drawdown
- stable-tail proxy = median late-event stable flow ÷ maximum observed drawdown
- late mean proxy = average late-event flow ÷ maximum observed drawdown

All of these are only treated as valid when:

- drawdown is finite
- drawdown is at least the minimum drawdown threshold
- the selected flow statistic is positive

In the current code, the minimum drawdown guard defaults to 0.05 m.

If drawdown is missing, too small, or otherwise unsuitable, the relevant Q/S value is set to null and flagged instead of being forced.

### 6.7 Preferred auto-selection
The current research implementation now supports a **preferred auto** mode that tries to choose the most supported candidate for each event.

The preference order is currently:

1. stable-tail proxy
2. event median proxy
3. current proxy
4. late mean proxy
5. max stress proxy

This gives the pages a more pump-test-like option where the telemetry supports it, while still preserving continuity with the earlier operational proxy.

---

## 7. Event quality flags

Each event row can carry flags such as:

- insufficient_water_level
- invalid_specific_capacity
- approximate_daily_event
- event_contains_gap
- sparse_event_signal
- window_ended_while_event_active

The purpose of these flags is to preserve uncertainty and prevent over-interpretation.

---

## 8. Daily summary calculations

Daily summaries are built from both cleaned telemetry and completed event outputs.

### 8.1 Daily pumped volume
For each day, the code adds the contribution from every positive-flow point:

- daily_pumped_volume_m3 = sum(flow × represented_hours)

### 8.2 Total hours pumped
The same represented spans are also summed as:

- total_hours_pumped = sum(represented_hours for positive-flow periods)

### 8.3 Daily event count
- event_count = number of completed events assigned to that UTC date

### 8.4 Daily drawdown summaries
From the events on that day, the code computes:

- maximum_drawdown_m = maximum of event drawdown values
- median_drawdown_m = median of event drawdown values

### 8.5 Daily specific-capacity summaries
From valid event Q/S values on that day, the code computes:

- median_specific_capacity_m3h_per_m = median valid Q/S
- worst_specific_capacity_m3h_per_m = minimum valid Q/S
- valid_specific_capacity_event_count = count of usable event Q/S values

### 8.6 Estimated daily resting level
The daily resting level is estimated from groundwater-level points whose nearby flow is absent or below threshold.

The code:

1. finds level points on that day
2. looks for the nearest flow point within a rest-search window
3. keeps only points where nearby flow is at or below the threshold
4. takes the median of those candidate levels

At least three supporting rest points are required by default; otherwise the resting level is set to null and flagged.

### 8.7 Daily downtime proxy
A day is marked with a downtime proxy when:

- flow observations exist, but
- the daily pumped volume is zero or effectively zero

This is a useful operational proxy, but it is **not** proof of mechanical failure.

---

## 9. Recovery-time calculation

For each event, the code searches the post-event groundwater-level points within a fixed recovery window.

The event is considered recovered when the water level returns to within a small tolerance of the event start level.

So, in words:

- recovery_time_h = time from event end until the first post-event level that is sufficiently close to the start level

If recovery is not observed within the review window, the value is left null and flagged.

This is why some events carry:

- recovery_not_observed_within_window
- insufficient_post_event_level_support

---

## 10. Rolling 7-day and 30-day metrics

For each anchor day and borehole, the code computes trailing windows.

### 10.1 Rolling volume
- rolling_7d_volume_m3 = sum of daily pumped volume over the trailing 7 days
- rolling_30d_volume_m3 = sum of daily pumped volume over the trailing 30 days

### 10.2 Rolling Q/S medians
- rolling_7d_specific_capacity_median = median of valid event Q/S values in the trailing 7 days
- rolling_30d_specific_capacity_median = median of valid event Q/S values in the trailing 30 days

### 10.3 Rolling drawdown medians
- rolling_7d_drawdown_median = median event drawdown over the trailing 7 days
- rolling_30d_drawdown_median = median event drawdown over the trailing 30 days

### 10.4 Resting-level trend
The resting-level trend is estimated using a simple linear trend in metres per day across the trailing daily resting-level series.

This is not a forecast model; it is only a descriptive slope over the chosen window.

### 10.5 Rolling stress and downtime counts
The code also tracks trailing counts for:

- stress events
- recovery weakness
- downtime-proxy days

---

## 11. Borehole summary methodology

The borehole summary condenses the daily and rolling outputs into one row per site.

Key metrics include:

### 11.1 Telemetry coverage percent
- telemetry_coverage_percent = telemetry_days_observed ÷ review_window_days × 100

### 11.2 Active-day share
- active_day_share = active_days ÷ review_window_days

### 11.3 Event frequency per week
- event_frequency_per_week = total_events ÷ (review_window_days ÷ 7)

### 11.4 Intermittency index
- intermittency_index = total_events ÷ active_days

### 11.5 Data unreliability index
The code builds a simple combined unreliability proxy from:

- the share of flagged days, plus
- the share of missing days inside the review window

This value is capped at 1.

### 11.6 Performance decline flag
The current research logic checks whether recent performance looks weaker than the recent baseline using rolling Q/S and rolling drawdown comparisons.

This is intentionally heuristic and should be interpreted cautiously for new installations with short baselines.

### 11.7 Readiness tiers
The current readiness tiers are:

- Tier A: at least 20 telemetry days and at least 5 valid Q/S-supporting events
- Tier B: at least 20 telemetry days and at least 1 detected event
- Tier C: at least 10 telemetry days
- Tier D: less support than the above

These tiers are used to communicate analytical support, not borehole quality.

---

## 12. Network comparison methodology

The network layer compares sites using observable quantities rather than black-box scores.

It ranks boreholes by things like:

- observed abstraction volume
- stress intensity
- valid specific capacity
- downtime share
- data unreliability

This is designed to help reviewers decide where to look next, while still keeping the evidence transparent.

---

## 13. Interpretation and maintenance-priority logic

The interpretation layer produces labels such as:

- healthy and stable
- high-use but stable
- stressed
- declining performance
- unreliable or possible fault
- insufficient data

These are **research heuristics**, not definitive diagnoses.

The priority labels currently map to approximate review bands such as:

- routine monitoring
- watch list
- planned review
- urgent investigation

The newer logic is intentionally conservative for newly installed wells and short telemetry baselines so that the system does not over-escalate normal early-life behaviour.

---

## 14. Important limitations

1. Q/S values are only as good as the available drawdown support.
2. Short review windows can exaggerate apparent decline.
3. Screening-source rows should not be treated the same as full analytical event traces.
4. Downtime proxies are not the same as confirmed failures.
5. These pages remain experimental and are best used to guide investigation, not replace it.

---

## 15. Intended use

This build is intended for:

- research
- internal review
- QA
- method development
- cautious prioritisation for follow-up

It is **not yet** intended to replace the production dashboard workflow.