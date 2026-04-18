# Analytics readiness assessment based on the real data now in the system

Date: 2026-04-18

## Purpose

This document separates what is robust enough to implement now from what is only partly supportable and what still needs better data or metadata.

This is intentionally conservative.

---

## Readiness summary

| Requested analytic area | Readiness now | Why |
|---|---|---|
| Event counts and pumping frequency | Safe now | The DCP event signal is clear and already operating on real hourly data |
| Pumping duration patterns | Safe now | DCP event durations cluster consistently and are well populated |
| Abstraction intensity | Safe now | Event counts, duration, and pumped volume are already available from DCP, with daily screening support from SonSetLink |
| Resting level trends | Possible with caveats | Strong only on the 10 DCP wells with good concurrent flow and level data |
| Specific capacity trends | Possible with caveats | Repeated valid Q over S exists mainly on a small DCP subset, not network-wide |
| Stress indicators | Possible with caveats | Drawdown and low-yield screening are feasible on the DCP subset, but sign ambiguity and sparse activity limit confidence |
| Recovery times | Possible with caveats | Some DCP events show enough post-event levels, but current behaviour suggests caution before turning this into a KPI |
| Downtime | Needs more metadata | Zero flow does not mean failure, and no maintenance or demand context is available |

---

## Metrics safe to implement now

These are the strongest candidates because they are already supported by the current real data with limited interpretive risk.

### 1. DCP pumping-event frequency

Safe because:

- the event engine already finds a clear active subset
- the event counts are not dependent on fragile drawdown estimates
- this is useful for comparing high-use and low-use boreholes

Recommended outputs:

- events per week or month
- active versus inactive boreholes
- rolling event count trend

### 2. DCP pumping duration and total pumped volume

Safe because:

- duration is populated on essentially all DCP events
- total pumped volume is directly estimated from the event flow traces
- these are operationally meaningful and easy to explain

Recommended outputs:

- median duration by borehole
- total volume by borehole and month
- short versus long event share

### 3. Abstraction intensity screening

Safe because:

- repeated flow is present on the active DCP wells
- SonSetLink also provides coarse daily usage totals for screening

Recommended outputs:

- daily or weekly abstraction volume class
- high-use versus moderate-use versus low-use tiering
- sudden drops or surges in use

### 4. Data-health and telemetry-availability dashboards

Safe because:

- missingness is one of the clearest real constraints in the system
- the user needs to know which wells are analyzable and which are not

Recommended outputs:

- telemetry-rich, telemetry-poor, and no-data counts
- recent gap flags
- wells with no positive pumping detected in the review window

---

## Metrics possible with caveats

These are worth pursuing, but only if they are explicitly filtered to the subset of wells where the data are good enough.

### 1. Resting level trends

Current evidence:

- several DCP wells have hundreds of non-pumping level points in the recent 90 day window
- this is enough for coarse baseline trend tracking on the telemetry-rich subset

Caveats:

- many wells have no recent telemetry at all
- some wells are effectively inactive, so trend interpretation may be operational rather than hydrogeologic

Conservative implementation rule:

Only compute resting-level trends for wells with sustained concurrent flow and level data and a substantial count of low-flow timestamps.

### 2. Specific capacity trends

Current evidence:

- about 75 to 77 DCP events currently produce valid Q over S values
- these valid values are concentrated mainly in Tsachiti and Goneko, with a smaller contribution from Namulera

Caveats:

- about 56 DCP events were invalid for Q over S because drawdown was too small, missing, or negative
- about 42 DCP events showed level recovery during the event itself, which is a warning sign for sign convention or timing interpretation
- SonSetLink Q over S remains screening-only and should not be mixed with DCP as if it had the same certainty

Conservative implementation rule:

Allow specific-capacity trend plots only for the DCP wells with repeated valid events and show clear quality filtering.

### 3. Recovery times

Current evidence:

- DCP post-event level support exists for the valid-drawdown subset
- apparent return toward the start level often occurs quickly, often within roughly 1 to 2 hours

Caveats:

- current recovery evidence is still sensitive to sign convention and event boundary choice
- the current live system tracks within-event recovery better than full post-event aquifer recovery time

Conservative implementation rule:

Treat recovery time as an experimental or review metric first, not as a core operational KPI.

### 4. Stress indicators

Current evidence:

- Goneko stands out as a likely high-drawdown, lower-Q over S borehole compared with Tsachiti
- repeated drawdown behaviour is visible in the DCP subset

Caveats:

- the active sample is small
- negative drawdown events remain too common for a network-wide stress ranking

Conservative implementation rule:

Use stress indicators only as screening flags on telemetry-rich DCP wells, not as definitive borehole health scores.

---

## Metrics that need more data or metadata first

### 1. Downtime as a true reliability metric

Not safe yet because:

- zero flow can mean low demand, not a fault
- missing telemetry can mean communications issues, not downtime
- the system lacks confirmed outage, maintenance, or dispatch metadata

### 2. Network-wide hydrogeologic comparison across all sources

Not safe yet because:

- DCP is hourly and analytical
- SonSetLink is daily and approximate
- mixing them into one single hydrogeologic ranking would overstate comparability

### 3. Strong recovery-curve or aquifer-parameter estimation

Not safe yet because:

- the current event outputs are designed for operational summaries, not full aquifer-test interpretation
- event windows are relatively short and sometimes show internal rebound

### 4. Failure attribution or cause diagnosis

Not safe yet because:

- there is no asset state, maintenance log, or user-demand context in the current data model

---

## Requested metric-by-metric assessment

| Metric | Current support | Recommendation |
|---|---|---|
| Resting level trends | Moderate on DCP subset | Proceed only on telemetry-rich DCP wells |
| Recovery times | Moderate but fragile | Keep experimental for now |
| Specific capacity trends | Moderate on a few DCP wells | Implement only with strong quality filters |
| Downtime | Weak | Do not implement as a firm outage metric yet |
| Abstraction intensity | Strong | Safe to implement now |
| Stress indicators | Moderate screening only | Use as a flag, not a final diagnosis |

---

## Conservative priority list for the next analytics phase

1. DCP borehole activity and abstraction summary
2. Event-frequency and duration trends by borehole
3. Data-health coverage panels showing which wells are analysis-ready
4. Resting-level baseline and trend plots for the good DCP subset
5. Quality-filtered specific-capacity trends only for the best-supported DCP wells

What should wait:

- network-wide downtime KPIs
- network-wide hydrogeologic ranking across DCP and SonSetLink together
- high-confidence recovery-time KPIs
- any metric that treats SonSetLink daily-derived depth data as equivalent to DCP hourly level telemetry
