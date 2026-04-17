# SiteMonitor Methodology

## Purpose

This document explains how the WASH SiteMonitor dashboard collects, processes, and presents operational borehole monitoring data. It is intended for project teams, engineers, hydrogeologists, implementers, and donors who need a clear description of the reporting logic behind the dashboard and the event-based specific-capacity analysis.

The system is designed to answer four practical questions:

1. Is a borehole currently active and sending recent telemetry?
2. How much water is being pumped over a selected period?
3. How does groundwater level respond during pumping?
4. Is borehole performance stable, improving, or deteriorating over time?

The methodology supports routine monitoring and decision-making. It is not intended to replace a formal constant-rate pumping test or a full hydrogeological investigation.

---

## 1. System Overview

SiteMonitor is a static web application hosted on GitHub Pages. It has no database and no custom backend application server. All analytics are performed in the browser after the page retrieves data from external telemetry services.

### Main components

- **Main dashboard page**: summary table, map, and site charts
- **Event analysis page**: pumping-event detection and specific-capacity analytics
- **Cloudflare Worker proxy**: enables browser access to third-party APIs by adding the required CORS headers
- **Browser local storage**: stores optional credentials, recent cached results, and login-session state

### Why this architecture was chosen

- low hosting cost
- easy sharing through a public URL
- simple deployment through GitHub
- no server maintenance burden
- quick iteration for monitoring workflows

---

## 2. Data Sources

The dashboard combines two telemetry systems.

### 2.1 DCP Water API

The DCP source is used for the detailed borehole event analysis because it provides the hourly flow and groundwater-level data needed for pumping-event detection.

Key datasets used:

- well list and metadata
- hourly flow time series
- hourly water-level-above-pump time series
- site and parameter metadata

### 2.2 SonSetLink API

The SonSetLink source is used primarily for dashboard reporting, daily usage summaries, and high-level site monitoring where those devices are available.

Key datasets used:

- site inventory
- daily usage totals
- flow counters and related summary measurements

### Data harmonisation principle

Even though the two APIs expose different schemas, the dashboard maps them into a common reporting structure with:

- site name
- site identifier
- source platform
- reporting period
- flow totals
- trend/status indicators

---

## 3. Units and Field Interpretation

The event analysis page uses the following practical interpretations.

| Variable | Meaning | Typical Unit |
|---|---|---|
| Flow | Pump discharge during an hourly interval | m³/h |
| Total volume | Accumulated pumped water over an event | m³ |
| Water level above pump | Height of water column above the pump reference | m |
| Drawdown | Reduction in water level above pump during pumping | m |
| Specific capacity | Pumping rate divided by drawdown | m³/h/m |

### Sign convention

Because the source parameter is **water level above pump**, a lower value during pumping means more drawdown. For that reason:

**drawdown = start level - end level**

If the water level drops during pumping, drawdown is positive.

---

## 4. Main Dashboard Methodology

The main dashboard presents operational monitoring information for all available sites in the selected date range.

### 4.1 Flow totals

For each site, the dashboard reads the available flow series over the requested period and aggregates the values into a total reported flow volume for that period.

This provides a practical answer to:

- how much the site produced in the last few days
- whether the site appears active or inactive
- whether the trend is stable, rising, or declining

### 4.2 Trends

Small trend graphics are displayed in the report table so a reviewer can quickly spot whether water production is:

- consistent
- highly variable
- recently reduced
- absent for several days

### 4.3 Map freshness logic

Marker appearance on the map is tied to data freshness. A more visible marker indicates recent telemetry, while a faded marker indicates stale or uncertain status.

This is intended as a visual maintenance aid rather than a formal alarm system.

---

## 5. Event-Based Borehole Analysis Methodology

The event analysis page turns hourly telemetry into individual pumping episodes. Each event represents one continuous period of pumping for a given borehole.

This is the core method used to estimate operational specific capacity.

### 5.1 Objective

For each borehole, the routine estimates how much drawdown occurs while the borehole is pumping and compares that to the pumping rate.

Specific capacity is calculated as:

SC = Q / s

where:

- **SC** is specific capacity
- **Q** is the final valid pumping flow during the event
- **s** is event drawdown

A higher value typically suggests that the borehole is delivering more water per metre of drawdown. A falling value over time may indicate clogging, pump issues, source stress, or seasonal decline.

---

## 6. Event Detection Logic

The event routine processes each monitored borehole independently.

### Step 1: Read the hourly flow series

The algorithm loads the DCP hourly flow time series for the selected analysis period.

### Step 2: Apply a pumping threshold

A borehole is treated as actively pumping when flow is greater than **0.1 m³/h**.

This threshold is intentionally small so the routine captures real pumping while filtering out minor noise and telemetry drift around zero.

### Step 3: Open an event

When flow crosses above the threshold after previously being at or below the threshold, the routine opens a new event and records:

- event start time
- borehole identifier and name
- first valid groundwater level near the start of the event

### Step 4: Keep the event open while pumping continues

As long as the next hourly readings remain above the threshold, the event stays open.

During this phase the code continuously updates:

- running duration
- accumulated pumped volume
- latest non-zero flow
- end groundwater level
- lowest groundwater level reached during the event

### Step 5: Close the event

The event closes when flow falls back to or below the threshold, or when the time window ends.

The final non-zero pumping value before shutdown is used as the event discharge for the specific-capacity estimate.

---

## 7. Volume Calculation

For each interval within an event, the routine estimates pumped volume using the hourly flow rate and the time elapsed since the previous reading.

Operationally this can be thought of as:

volume for an interval = flow × hours elapsed

Those interval volumes are then summed over the event.

This gives a practical estimate of how much water was abstracted during that continuous pumping episode.

---

## 8. Water-Level and Drawdown Calculation

The groundwater response is taken from the hourly **water_level_above_pump** series.

### 8.1 Start level

The algorithm stores the first valid water level available at the beginning of the event.

### 8.2 End level

The end level is the latest valid water level associated with the pumping event before it closes.

### 8.3 Event drawdown

Event drawdown is computed as:

drawdown = start level - end level

If the water level above the pump decreases during pumping, the drawdown value becomes positive.

### 8.4 Maximum drawdown

The routine also identifies the lowest water level reached at any time during the event. From this it computes:

maximum drawdown = start level - minimum level during event

This is important because some events partially recover before the last reading, so the final level alone may understate the worst stress experienced during the event.

---

## 9. Specific Capacity Calculation

The specific-capacity estimate for each event is based on the final valid pumping rate and the event drawdown.

### Formula

specific capacity = final flow / drawdown

### Why final flow is used

The final non-zero flow near the end of the event is a practical operational approximation of the pumping condition after drawdown has had time to develop.

This is not identical to a controlled step-drawdown or constant-rate pumping test. However, it is useful for routine telemetry-based screening, especially when events are compared over time for the same borehole.

### Interpretation

- **Higher specific capacity**: more water delivered for each metre of drawdown
- **Lower specific capacity**: less efficient response or greater aquifer/pump stress
- **Sharp drops over time**: possible maintenance issue, clogging, seasonal source decline, or emerging failure risk

---

## 10. Recovery Estimate

Where the data allow, the routine also records a recovery-related indicator after the event. This helps identify whether the groundwater level rebounds normally after pumping stops.

Recovery is helpful for trend interpretation because two events with similar drawdown may behave differently after shutdown:

- one may recover quickly and fully
- another may remain depressed for longer

That difference can be an early warning sign of worsening borehole performance.

---

## 11. Quality Flags and Event Screening

Not every detected event should be treated as equally reliable. The system therefore applies event-level quality flags.

Typical flags include:

- missing groundwater level values
- very small drawdown that would make the ratio unstable
- incomplete or irregular timestamps
- noisy telemetry patterns
- event still open at the edge of the analysis period
- invalid specific-capacity result

### Why flagged events are still shown

Flagged events are not hidden because they still provide operational context. Instead, they are marked so the user can decide whether to include them in interpretation.

This supports transparency and avoids falsely suggesting that the dataset is cleaner than it really is.

---

## 12. Borehole Summary Methodology

After all events are computed, the event page groups them by borehole and reports summary statistics such as:

- number of detected events
- number of valid specific-capacity events
- total pumped volume over the selected period
- average specific capacity
- average drawdown
- maximum drawdown recorded
- count of flagged events

This grouped view makes it easier to compare boreholes and identify the sites that most likely need attention.

---

## 13. Caching and Performance

The browser stores recent event results in local storage for a short period. This reduces repeat API requests and makes it faster to reopen the same date range.

### Benefits

- quicker reloads
- lower API burden
- better usability on slower connections

### Important note

Cached results are temporary. A forced refresh can be used to pull fresh telemetry and rerun the analysis.

---

## 14. Exports

The event page supports both CSV and JSON export.

### CSV export

Useful for:

- spreadsheet review
- donor reporting
- sending summary results to field teams
- quick graphing outside the dashboard

### JSON export

Useful for:

- integration with other tools
- archiving detailed event objects
- additional custom analytics

---

## 15. Security and Access Method

The shared site uses a lightweight client-side login gate based on a SHA-256 check stored in the browser session.

This is intended to prevent casual public access to the protected monitoring pages. It is suitable for light sharing and access control but should not be treated as a high-security enterprise authentication system.

API credentials are stored locally in the user’s browser and are not committed into the repository.

---

## 16. CORS and Public Sharing

Because browsers block many cross-origin API requests by default, the project uses a Cloudflare Worker as a proxy for live deployment.

### Proxy purpose

The proxy:

- forwards the request to the source API
- receives the upstream response server-side
- adds the required CORS headers
- returns the result to the browser

This makes it possible for the static GitHub Pages site to access telemetry data without running its own backend server.

---

## 17. Limitations

This methodology is intentionally practical and lightweight. Users should keep the following limitations in mind.

### Operational limitations

- telemetry gaps can distort event boundaries
- noisy sensors can affect calculated drawdown
- irregular sampling can affect volume estimation
- borehole performance is influenced by season, usage intensity, and maintenance condition

### Hydrogeological limitations

The event-based specific-capacity results are **screening indicators**, not formal aquifer-test outputs. They should not be interpreted as transmissivity or sustainable yield without additional field evidence.

---

## 18. Recommended Use

This workflow is best used for:

- monthly or weekly operational review
- identifying boreholes with declining efficiency
- prioritising site visits
- comparing before-and-after maintenance performance
- spotting abnormal drawdown behaviour early

It is especially valuable when trends are tracked over time rather than relying on a single event in isolation.

---

## 19. Summary

In simple terms, the dashboard:

1. loads telemetry from the monitoring platforms
2. turns the raw series into understandable site-level indicators
3. identifies continuous pumping events for each borehole
4. calculates drawdown, maximum drawdown, pumped volume, and specific capacity
5. flags uncertain results for review
6. presents the outputs in tables, charts, and downloadable files

This gives the WASH team a practical, repeatable, and shareable method for monitoring borehole behaviour remotely.
