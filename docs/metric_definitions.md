# Metric definitions for the next analytics layer

Date: 2026-04-18

## Notes on interpretation

- DCP metrics are the primary analytical metrics.
- SonSetLink metrics should be labelled as screening where they depend on daily-derived signals.
- Any metric with weak support should be hidden, greyed out, or labelled as caveated rather than shown as if it were fully trusted.

---

## Event-level metrics

| Metric | Purpose | Formula or logic | Required inputs | Aggregation level | Interpretation | Caveats |
|---|---|---|---|---|---|---|
| Event start and end | Define one pumping window | existing event engine start and close timestamps | cleaned flow series, event threshold | Event | one distinct pumping episode | sensitive to threshold and gap logic |
| Event duration hours | Measure how long the event lasted | event end minus event start | event timestamps | Event | longer duration suggests sustained use | not equal to service adequacy |
| Event pumped volume | Estimate water abstracted during the event | sum of positive flow times interval across the event | positive flow samples, sample span or interval | Event | direct abstraction estimate | stronger for DCP than SonSetLink |
| Event hours pumped | Quantify active pumping time | sum of time steps with flow above threshold | flow series, threshold | Event | helps separate short bursts from long pumping | depends on sample resolution |
| Event final flow | Capture end-of-event delivery rate | last valid non-zero flow in the event | event flow points | Event | useful for comparing yield at shutdown | single-point metric, not a full capacity measure |
| Event average flow | Capture mean delivery rate | event pumped volume divided by event hours pumped | event volume and duration | Event | operational yield during the event | affected by sparse sampling |
| Event drawdown | Measure groundwater response during the event | groundwater level at event start minus groundwater level at last valid non-zero flow | level support around event start and during event | Event | larger positive values suggest stronger response to pumping | sign conventions must stay consistent |
| Event maximum drawdown | Measure worst level excursion during the event | groundwater level at event start minus deepest level reached during the event | event level points | Event | better than simple end drawdown when rebound occurs within the event | still depends on level quality |
| Event specific capacity | Estimate borehole performance during one event | last valid non-zero flow divided by event drawdown | valid flow and valid drawdown greater than threshold | Event | higher values suggest better delivery per unit drawdown | only valid for a subset of DCP events |
| Event recovery time | Estimate post-event rebound speed | time from event end until level returns within a tolerance of the pre-event or resting level | post-event levels for several hours after closure | Event | faster recovery can indicate less persistent stress | currently a caveated review metric |
| Event quality flag set | Preserve trust information | inherited flag list from cleaning and event metrics | QC flags, event flags | Event | tells the user how much caution is needed | should be shown alongside the metric, not hidden |

---

## Daily metrics

| Metric | Purpose | Formula or logic | Required inputs | Aggregation level | Interpretation | Caveats |
|---|---|---|---|---|---|---|
| Daily pumped volume | Quantify total abstraction by day | sum of event volumes on the day, or sum of positive flow times interval; for SonSetLink use converted daily usage total | event rows or flow traces | Daily | strongest daily demand metric now available | cross-source comparisons need source labels |
| Daily hours pumped | Estimate how long the borehole was active on that day | sum of event hours within the day, or count of positive-flow intervals times interval | flow traces or event rows | Daily | good for operational demand pattern tracking | SonSetLink uses coarse activity duration where available |
| Daily event count | Count starts or completed events per day | number of event starts or closures in the day | event rows | Daily | distinguishes bursty use from steady use | depends on event segmentation rules |
| Daily active flag | Mark days with observed pumping | 1 if daily pumped volume is above a minimal threshold, else 0 | daily volume or event count | Daily | useful for activity-share and uptime-proxy views | not a true failure diagnosis |
| Daily median event duration | Summarize within-day pumping pattern | median of event durations for that day | event rows | Daily | longer median suggests fewer sustained runs | unstable if only one event occurs |
| Daily resting water level estimate | Approximate the non-pumping level for that day | median groundwater level from low-flow or out-of-event timestamps | level series and low-flow mask | Daily | useful baseline for groundwater-response tracking | only for the DCP subset with good level support |
| Daily valid Q over S median | Summarize event performance within the day | median of valid event specific-capacity values on the day | event specific-capacity rows | Daily | helps detect short-term changes in performance | many days will have no valid values |
| Daily stress flag | Simple review indicator | true when drawdown or low Q over S exceeds site-specific review thresholds on that day | daily event stats and rolling baselines | Daily | identifies dates needing attention | should remain transparent and rule-based |

---

## Rolling-window metrics

| Metric | Purpose | Formula or logic | Required inputs | Aggregation level | Interpretation | Caveats |
|---|---|---|---|---|---|---|
| Rolling 7 day pumped volume | Track short-term demand | sum of daily pumped volume over the trailing 7 days | daily volume series | Rolling | shows weekly demand pressure | sensitive to missing days |
| Rolling 30 day pumped volume | Track monthly demand | sum of daily pumped volume over the trailing 30 days | daily volume series | Rolling | useful for comparing sustained abstraction across sites | compare only among similar confidence lanes |
| Rolling event frequency | Track how often pumping episodes occur | sum of daily event counts over the trailing window | daily event counts | Rolling | highlights high-use versus low-use sites | more meaningful than single-day counts |
| Rolling median event duration | Track pumping style changes | median event duration over the trailing window | event duration rows | Rolling | upward shifts may suggest changing use behaviour | small-event windows can be unstable |
| Rolling median drawdown | Track groundwater response changes | median valid event drawdown over the trailing window | event drawdown rows | Rolling | rising values may indicate stress | only meaningful where valid event counts are sufficient |
| Rolling maximum drawdown | Flag high-excursion periods | maximum event maximum-drawdown in the trailing window | event maximum-drawdown rows | Rolling | useful for review queues | one extreme event can dominate |
| Rolling median specific capacity | Track performance stability | median valid Q over S across the trailing window | valid event specific-capacity rows | Rolling | lower values may signal decline | requires minimum valid-event counts |
| Rolling resting-level trend | Track background groundwater movement | slope or median change in daily resting-level estimates over 30 or 90 days | daily resting-level series | Rolling | useful for sustainability screening | sign meaning depends on level convention |
| Rolling recovery-time median | Track post-pumping rebound behaviour | median valid event recovery time over the trailing window | event recovery rows | Rolling | slower recovery may suggest greater stress | should remain caveated in the first release |
| Rolling flagged-event share | Track data and interpretation risk | flagged events divided by all events in the window | event quality flags | Rolling | useful trust metric and review trigger | high values may reflect data limitations rather than true hydraulic problems |

---

## Site-level metrics

| Metric | Purpose | Formula or logic | Required inputs | Aggregation level | Interpretation | Caveats |
|---|---|---|---|---|---|---|
| Telemetry coverage percent | Measure observation completeness | days with usable telemetry divided by expected days in the review window | timestamps by source and parameter | Site | indicates whether the site is analytics-ready | should be tracked separately for flow and level |
| Active-day share | Estimate observed operational use | days with daily active flag divided by telemetry days | daily active flag and telemetry coverage | Site | useful for low-use versus high-use classification | not equal to asset uptime |
| Mean and median daily volume | Summarize typical demand | average and median of daily pumped volume | daily volume series | Site | simple demand benchmark | use medians where outliers are present |
| Mean and median daily hours pumped | Summarize use intensity | average and median of daily pumped hours | daily hours series | Site | indicates operational intensity | can be biased if sampling is sparse |
| Event frequency per week | Describe pumping pattern | total events divided by weeks observed | event rows and window length | Site | stable comparison across sites | needs enough observation days |
| Median event drawdown | Summarize hydraulic response | median of valid event drawdown values | event drawdown rows | Site | good first performance summary | interpret only on the DCP subset |
| Maximum drawdown observed | Flag severe response | largest valid event maximum-drawdown in the review window | event maximum-drawdown rows | Site | helpful for risk review | not sufficient alone for diagnosis |
| Median valid Q over S | Summarize borehole performance | median of valid event specific-capacity values | valid event Q over S rows | Site | strongest single performance statistic now available | use only when enough valid events exist |
| Valid-event count | Show confidence support | count of events with valid drawdown and valid Q over S | event rows and QC rules | Site | gives context for all hydrogeologic summaries | critical gating metric |
| Inactivity streak days | Highlight non-use periods | longest run of telemetry-present days with no pumping | daily active flags and telemetry coverage | Site | helpful for functionality review | may reflect low demand, not failure |
| Observed downtime proxy | Screening view of service interruption risk | share of telemetry-present days with no pumping and unusually low recent activity | daily active flags, rolling history | Site | useful for operational review | must be labelled as a proxy, not true downtime |
| Analysis readiness tier | Indicate what analytics are trustworthy | rule-based tier from coverage, activity, and valid-event support | coverage, events, valid metrics | Site | helps users know what to trust | should stay simple and transparent |
| Stress review flag | Put sites into a review queue | triggered when multiple stress criteria are met | rolling drawdown, Q over S, resting level, flag share | Site | prioritization aid for human review | not a diagnosis |
| Performance decline flag | Identify deterioration relative to site history | true when rolling median Q over S falls and drawdown rises versus baseline under comparable flows | rolling Q over S, drawdown, flow bands | Site | useful for early warning | only for wells with a long enough history |

---

## Network-level metrics

| Metric | Purpose | Formula or logic | Required inputs | Aggregation level | Interpretation | Caveats |
|---|---|---|---|---|---|---|
| Active-site count | Show network activity footprint | number of sites with at least one active day in the window | site daily activity | Network | quick network pulse measure | source coverage changes can affect the count |
| Telemetry-ready site count | Show analysis capacity | number of sites above a coverage threshold | site coverage metrics | Network | helps quantify how much of the fleet is analyzable | should be split by source |
| High-use site ranking | Compare abstraction intensity | rank by rolling 30 day volume or median daily volume | daily volume series | Network | identifies operationally important sites | compare only among similar source types |
| Event-frequency ranking | Compare operational cadence | percentile rank of events per week | event frequency stats | Network | distinguishes frequent-use sites | more meaningful for DCP |
| Performance benchmark rank | Compare performance among peers | percentile rank of median valid Q over S within the DCP cohort | site Q over S summaries | Network | transparent peer comparison | requires enough valid events |
| Drawdown benchmark rank | Compare hydraulic response | percentile rank of median or maximum valid drawdown | site drawdown summaries | Network | helps highlight review candidates | should be paired with Q over S and flow context |
| Stress review queue | Prioritize site investigation | sorted list of sites with transparent stress flags and evidence columns | site stress flags, coverage, event stats | Network | best practical ranking for action | not a black-box total score |
| Readiness distribution | Show what the network can support analytically | counts by readiness tier | site readiness tiers | Network | useful for planning the rollout of advanced metrics | purely operational, not hydrogeologic |

---

## Metrics that require metadata not yet consistently available

These should be designed for later, not forced into the first release.

| Metric | Why it is desirable | Missing metadata |
|---|---|---|
| True uptime and downtime | best reliability view | expected service hours, confirmed outage logs, maintenance logs |
| Service adequacy | compares use to need | served population, daily demand targets, queueing or access expectations |
| Pump submergence safety margin | important for pump protection | pump intake depth, installation geometry |
| Safe-yield exceedance | important for sustainability | design yield, aquifer reference limits, pumping test metadata |
| Per-capita abstraction | useful for demand context | population served or users per site |
| Efficiency versus design capacity | useful for asset management | pump model, expected duty cycle, rated production |

---

## Recommended rule thresholds for the first release

Suggested minimum supports:

- show site-level abstraction metrics when at least 14 telemetry days are available in the review window
- show resting-level trends when at least 20 low-flow level observations are available across at least 10 days
- show site-level Q over S when at least 5 valid events are available in the selected rolling window
- show performance decline flags only when a current window can be compared with a longer baseline for the same borehole
- never combine DCP and SonSetLink into one unlabelled performance leaderboard
