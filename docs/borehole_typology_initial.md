# Initial borehole typology based on the current real data

Date: 2026-04-18

## Important note

This is an initial operational typology, not a final hydrogeologic judgement.

It groups boreholes by how they are behaving in the real telemetry now and by how reliable their current analytics support looks.

---

## DCP boreholes

### 1. High-use and analytically useful

These are the strongest current candidates for near-term operational analytics.

| Borehole | Current pattern | Likely category | Why it matters |
|---|---|---|---|
| Tsachiti PS Well | very frequent pumping, moderate drawdown, repeated valid Q over S | High-use active | strong event history and enough valid events for filtered trend work |
| Goneko Community PS Well | very frequent pumping, higher drawdown, lower median Q over S than Tsachiti | High-use and possibly stressed | high operational importance and a likely stress-screening candidate |

### 2. Intermittent, noisy, or interpretation-sensitive

| Borehole | Current pattern | Likely category | Why it matters |
|---|---|---|---|
| Namulera PS Well | moderate event count but many flagged events and negative or unstable drawdown behaviour | Intermittent and review-needed | useful operationally, but the hydrogeologic interpretation is not yet stable enough for a clean KPI |

### 3. Low-use or rare-event boreholes

| Borehole | Current pattern | Likely category | Why it matters |
|---|---|---|---|
| Dzoole HC Well | only one short event in the review window | Low-use | activity is too sparse for trend analytics |
| Mbalame PS Well | one short event and no valid Q over S | Low-use | useful for activity presence or absence only |
| Mchekeni PS Well | one isolated event with incomplete level support | Low-use and partially unreliable | currently too sparse for trend work |
| Nthondo PS Well | one short event and one negative flow value observed in cleaning | Low-use and minor sensor concern | operational screening only for now |

### 4. Telemetry present but currently not pumping

| Borehole | Current pattern | Likely category | Why it matters |
|---|---|---|---|
| Chakhadza HC Well | steady level and flow timestamps but no positive pumping in the review window | Rest-only or inactive | could support baseline level tracking but not event analytics |
| Nalunga HP Well | strong timestamp coverage but no pumping detected | Rest-only or inactive | useful for resting level monitoring, not event metrics |
| Mkazomba PS Well | level support exists but no recent pumping | Rest-only or inactive | suitable only for inactivity or baseline tracking |

### 5. No recent telemetry or effectively unavailable

These wells should be separated from the analytic cohort until data return.

| Borehole | Likely category |
|---|---|
| Chapita PS Well 1 | No recent telemetry |
| Chapita PS Well 2 | No recent telemetry |
| Dziwe HC and PS Well 1 | No recent telemetry |
| Dziwe HC and PS Well 2 | No recent telemetry |
| Katuta PS Well | No recent telemetry |
| Madziabango HC Well 2 | No recent telemetry |
| Madziabango PS Well 1 | No recent telemetry |
| Mmanga PS Well | No recent telemetry |
| Mpembamoyo PS Well | No recent telemetry |
| Mtemeiti PS Well | No recent telemetry |
| Therere PS Well | No recent telemetry |

---

## SonSetLink source typology

SonSetLink should be grouped more conservatively because the source is daily-derived and screening-oriented.

### A. Good operational screening sources

Representative examples:

- SN-819
- SN-822
- SN-810
- Oreta
- Kalimon

These sites show repeated positive daily activity and often include depth-slot arrays. They are useful for use-intensity screening, activity presence, and broad operational change detection.

### B. Active but hydrogeologically weak

A large share of SonSetLink sites fall into this group.

Typical pattern:

- usage is present
- depth arrays may be present
- drawdown is usually tiny or zero-like
- Q over S is therefore weak or unstable

This group should stay in the screening layer, not the main hydrogeologic trend layer.

### C. Usage present but depth support weak or absent

Representative example:

- SN-809

These sites can still support activity screening and daily abstraction summaries, but not drawdown-based interpretation.

### D. No recent useful activity

The remaining low-return SonSetLink sites should be treated as inactive, telemetry-poor, or out of scope for current hydrogeologic analytics.

---

## Initial implications for analytics design

This typology suggests a very practical rollout path:

- use Tsachiti and Goneko as the first boreholes for higher-confidence DCP trend analytics
- keep Namulera in the review set but label it as interpretation-sensitive
- treat the low-use DCP boreholes as activity-screening assets rather than trend assets
- keep no-telemetry wells out of performance comparisons
- keep SonSetLink in a clearly labelled screening lane unless stronger metadata or higher-resolution telemetry becomes available

---

## Bottom line

The current network is not one uniform analytical population.

It already separates into:

- a small high-value DCP subset that can support stronger analytics now
- a few intermittent or review-needed wells
- several low-use or inactive wells
- a large no-data or low-confidence remainder

That separation should be built into any future analytics from the start.
