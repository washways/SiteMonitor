# 💧 WASH Dashboard — Water Access & Sanitation Monitoring

A **static, browser-based dashboard** for monitoring solar-powered and hand-pump waterpoints across Malawi. Deployed on GitHub Pages with a Cloudflare Worker CORS proxy for live API access.

[![Deploy to GitHub Pages](https://github.com/washways/SiteMonitor/actions/workflows/deploy.yml/badge.svg)](https://github.com/washways/SiteMonitor/actions/workflows/deploy.yml)

**Live Site →** [washways.org/SiteMonitor](https://washways.org/SiteMonitor/login.html)

---

## Features at a Glance

| Feature | Detail |
|---------|--------|
| **Dual data sources** | DCP Water API (v2) + SonSetLink API |
| **Flow Report Table** | Configurable day range (default 7 days) — total flow (m³), sparkline trend, status |
| **Interactive Map** | Leaflet map with colour-coded markers; click a marker to open site charts |
| **Dual-axis Site Chart** | Aggregated Flow (m³/h) as blue bars on left axis + Water Level Above Pump (m) as amber line on right axis |
| **Malawi filter** | One-click toggle to show only sites within the Malawi bounding box |
| **CSV Export** | Download summarised flow data for the selected period with one click |
| **Event-based Q/S analysis** | Detects pumping episodes, calculates drawdown, maximum drawdown, pumped volume, and specific capacity per event |
| **Grouped borehole analytics** | Summary table and trend charts for comparing boreholes over time |
| **Login gate** | SHA-256 client-side password check with session-based page protection |
| **CORS Proxy** | Cloudflare Worker routes API calls to avoid browser CORS restrictions |
| **Fully static** | No backend required; runs entirely in the browser on GitHub Pages |
| **Responsive** | Usable on desktop and phone |

---

## Architecture

```
wash-dashboard/
├── public/                        ← deployed to GitHub Pages
│   ├── login.html                 ← login gate (SHA-256 password check)
│   ├── index.html                 ← main dashboard
│   ├── app.js                     ← all frontend logic
│   ├── report.js                  ← pulse-report logic
│   ├── pulse-report.html          ← pulse report page
│   └── styles.css                 ← styling & responsive layout
├── cloudflare-worker/
│   └── worker.js                  ← CORS proxy (deployed to Cloudflare Workers)
├── .github/workflows/
│   └── deploy.yml                 ← GitHub Actions auto-deploy on push to main
├── .gitignore                     ← excludes .env, server.js, test scripts
├── server.js                      ← local dev server with built-in proxy (optional)
├── start_dashboard.bat            ← local dev launcher (Windows)
└── README.md
```

### Data Flow

**Live site (GitHub Pages):**
```
Browser  →  Cloudflare Worker (wash-proxy.washways1.workers.dev)
                ├── /dcp/*  →  api.dcp.solar/water/*
                └── /ssl/*  →  sonsetlink.org/water/technical/*
```

**Local development:**
```
Browser  →  Direct API calls (using Chrome with CORS disabled via start_dashboard.bat)
```

The Cloudflare Worker acts as a transparent CORS proxy — it forwards API requests server-side (where CORS doesn't apply), then returns responses with proper `Access-Control-Allow-Origin` headers.

---

## Data Sources

### 1 — DCP Water API (v2)

| Endpoint | Used for |
|----------|----------|
| `GET /v2/wells` | List all wells (name, location, ID, last_seen) |
| `GET /v2/wells/{id}/timeseries?parameter=flow` | Hourly flow (m³/h) — summed to volume over the selected window |
| `GET /v2/wells/{id}/timeseries?parameter=water_level_above_pump` | Hourly water level above pump (m) |
| `GET /v2/sites` | Sites with wells, components, and last_seen |
| `GET /v2/parameters` | Parameter catalog (labels + units) |

- Authentication: `X-Api-Key` header
- Dates: ISO-8601 UTC
- Values: hourly buckets; `null` means no measurement in that hour
- Docs: `https://api.dcp.solar/water/openapi.json`

### 2 — SonSetLink API

| Endpoint | Used for |
|----------|----------|
| `GET /sites.json.php` | List all monitoring sites |
| `GET /usage.json.php` | Daily flow totals (`deflow`) and cumulative meter (`flow1`) |

- Authentication: `login` + `password` query parameters
- The dashboard cycles through multiple endpoint variants (`usage.json.php`, `usage1_msg.json.php`, `usage8_msg.json.php`, `usage12_msg.json.php`) to find which table a given device stores data in (some return 404 — this is expected and silenced)

---

## Getting Started

### 1. First-time access — enter your API credentials

1. Open the dashboard and sign in (credentials are shared privately with authorised users)
2. Click **⚙️ Settings** in the header
3. Enter:
   - **DCP API Key** — your key for `api.dcp.solar/water` (v2)
   - **SonSetLink User** — your SonSetLink username
   - **SonSetLink Password** — your SonSetLink password
4. Click **Save & Reload**

Credentials are saved only in your browser's `localStorage`. They are **never** sent to GitHub or any third-party service other than the two APIs above.

---

### 2. Changing the login password

To change the dashboard login password, open `public/login.html` and update the entry inside `initHashes()`:

```js
HASH_TABLE.push(await sha256("newusername:newpassword"));
```

Commit and push after changing. The password is checked client-side using the browser's native **WebCrypto SHA-256** — never stored in plain text.

---

## Using the Dashboard

### Flow Report Table

- Loads on startup once credentials are configured
- Shows **Total Flow (m³)** over the selected period and a **sparkline trend chart**
- **Status: OK** = at least one data point found; **No Data** = API returned only null/zero values for the period (offline sensor or inactive pump)
- Click any row to open the detailed site chart below the map

### Map

- Blue markers = SonSetLink sites; Green markers = DCP sites
- Marker **opacity** indicates data freshness (bright = recent, faded = stale or unknown)
- Click a marker to open the popup and load the site's detail chart

### Detail Chart (appears on row/marker click)

- **DCP sites**: dual-axis Plotly chart — blue bars (flow, left axis) + amber line (water level, right axis)
- **SonSetLink sites**: line chart of total flow and daily flow

**Depth sampling rationale:** Night-time (03:00–05:00 Malawi time) readings approximate static groundwater levels (minimal pumping) and are downsampled for trends.

### Controls

| Control | Description |
|---------|-------------|
| **Days** input | Number of past days to fetch (default: 7) |
| **▶ Load** | Refresh all sites and the table |
| **Malawi only** checkbox | Filter to Malawi geographic bounding box |
| **⬇ CSV** | Download a CSV of name, flow total and status for all loaded sites |
| **⚙️** | Open API settings modal |

---

## Deployment

### GitHub Pages (automatic)

Pushes to `main` automatically deploy via GitHub Actions (`.github/workflows/deploy.yml`). The `public/` folder is served as the GitHub Pages site root.

**Manual trigger:** Go to *Actions → Deploy to GitHub Pages → Run workflow*.

**GitHub Pages settings:** *Settings → Pages → Source → GitHub Actions*

### Cloudflare Worker (CORS proxy)

The CORS proxy is deployed separately on Cloudflare Workers. To update it:

1. Log in to [dash.cloudflare.com](https://dash.cloudflare.com)
2. Go to **Workers & Pages** → select `wash-proxy`
3. Click **Edit Code**, paste updated `cloudflare-worker/worker.js`, click **Deploy**

The Worker URL is configured in `public/app.js` as `PROXY_BASE`.

### Local Development

Run `start_dashboard.bat` — this starts a local Python HTTP server and opens the site on `http://localhost:3000`. Localhost is now the preferred development origin because the CORS proxy explicitly allows it.

---

## Event-Based Specific Capacity Methodology

The new analytics page estimates borehole specific capacity $Q/S$ for each detected pumping event. The method is designed for operational monitoring rather than formal aquifer test interpretation, so it emphasises repeatable event detection and quality flagging.

### Purpose

Specific capacity is calculated to answer a simple operational question:

$$
Q/S = \frac{\text{final pumping flow}}{\text{drawdown during the event}}
$$

where:

- $Q$ = the last valid non-zero flow reading during the pumping episode in m³/h
- $S$ = the drawdown between the groundwater level at the start of pumping and the groundwater level at the end of pumping in m

### Event detection logic

For every monitored DCP borehole:

1. **Read hourly flow series** from the DCP Water API.
2. **Mark pumping as active** whenever flow is greater than $0.1$ m³/h.
3. **Start a new event** at the first above-threshold reading.
4. **Store the initial groundwater level** from the nearest `water_level_above_pump` reading.
5. **Keep the event open** while flow remains above threshold.
6. **Accumulate pumped volume** using flow × elapsed time between readings.
7. **Track the latest groundwater level** and the lowest groundwater level reached.
8. **Close the event** when flow returns to zero or below the threshold.
9. **Use the last non-zero flow** as the closing discharge for the event.

### Metrics produced per event

Each event row includes:

- event start and end timestamps
- event duration in hours
- total pumped volume in m³
- start and end groundwater level
- drawdown in m
- **maximum drawdown** reached during the event
- recovery depth estimate
- specific capacity in m³/h/m
- quality score and diagnostic flags

### Quality flags

To prevent misleading results, the workflow flags events when:

- groundwater level data is missing
- drawdown is too small to compute a stable ratio
- time gaps suggest incomplete telemetry
- flow spikes or dips indicate noisy data
- the event was still pumping when the report ended

These flagged events are still shown, but they are marked for review and may not represent reliable hydrogeological performance.

### Borehole summary and trends

The event page also groups results by borehole and shows:

- number of detected pumping events
- number of valid specific-capacity events
- total pumped volume over the chosen period
- average specific capacity per borehole
- average drawdown and maximum drawdown
- trend charts for comparing performance through time

### Interpretation note

The values generated here are **screening indicators**. They are very useful for spotting declining performance, boreholes with abnormal drawdown, or assets that need maintenance. They are **not a substitute** for a controlled constant-rate pumping test.

---

## CORS and GitHub Pages Sharing Methodology

The shared deployment uses a Cloudflare Worker as a CORS bridge between the browser and the upstream APIs.

### How it works

$$
\text{Browser} \rightarrow \text{GitHub Pages / washways.org} \rightarrow \text{Cloudflare Worker} \rightarrow \text{DCP or SonSetLink API}
$$

The Worker:

- accepts requests only from approved origins
- forwards the request server-side
- injects API secrets when needed
- returns the response with matching `Access-Control-Allow-Origin` headers

### Allowed shared origins

The project is configured for these public origins:

- `https://washways.org`
- `https://www.washways.org`
- `https://washways.github.io`

For local development, use:

- `http://localhost:3000`

### Important local rule

Use **localhost**, not `127.0.0.1`, for local testing. The proxy compares origins exactly, and a mismatch will trigger a browser CORS failure.

### Sharing workflow

1. Push the repository updates to `main`
2. GitHub Actions deploys the `public` folder to GitHub Pages
3. The live site loads through the Worker proxy
4. Authorised users sign in through the login gate and can access both the main dashboard and the event analytics page

---

## Security Notes

- API keys live only in `localStorage` or in Cloudflare Worker secrets for the shared deployment
- `.env` is listed in `.gitignore` and will never be pushed
- The login password is stored as a **SHA-256 hash** in `login.html` and enforced with session-based page checks
- The Cloudflare Worker only accepts requests from whitelisted origins (`washways.org`, `washways.github.io`, and local testing origins)
- SonSetLink credentials are visible inside network requests if devtools are open — this is unavoidable for a fully browser-based static app

---

## Known Limitations

- **CORS**: API calls on the live site are routed through a Cloudflare Worker CORS proxy. Direct browser-to-API calls will fail due to missing CORS headers on both API servers.
- **Null flow values**: DCP wells that are offline or have inactive sensors return hourly buckets with `value: null` — shown as `No Data` in the table.
- **SonSetLink 404s**: The fallback endpoint loop produces 404 responses for some devices. These are silenced in the code and are expected behaviour.
- **Session auth only**: The login gate persists for the browser session only. Closing and reopening the browser tab requires re-login.

---

## Licence

MIT — WASHways water monitoring project.
