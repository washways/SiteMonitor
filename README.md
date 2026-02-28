# 💧 WASH Dashboard — Water Access & Sanitation Monitoring

A **static, browser-based dashboard** for monitoring UNICEF WASH water-pump sites across Malawi. No server required; built for deployment on GitHub Pages.

[![Deploy to GitHub Pages](https://github.com/washways/SiteMonitor/actions/workflows/deploy.yml/badge.svg)](https://github.com/washways/SiteMonitor/actions/workflows/deploy.yml)

**Live Site →** [washways.github.io/SiteMonitor/login.html](https://washways.github.io/SiteMonitor/login.html)

---

## Features at a Glance

| Feature | Detail |
|---------|--------|
| **Dual data sources** | DCP Water API + SonSetLink API |
| **Flow Report Table** | Configurable day range (default 7 days) — total flow (m³), sparkline trend, status |
| **Interactive Map** | Leaflet map with colour-coded markers; click a marker to open site charts |
| **Dual-axis Site Chart** | Aggregated Flow (m³/h) as blue bars on left axis + Water Level Above Pump (m) as amber line on right axis |
| **Malawi filter** | One-click toggle to show only sites within the Malawi bounding box |
| **CSV Export** | Download summarised flow data for the selected period with one click |
| **Login gate** | SHA-256 client-side password check; no credentials sent to any server |
| **Fully static** | No Node.js, no backend; runs entirely in the browser and deploys to GitHub Pages |
| **Responsive** | Usable on desktop and phone |

---

## Architecture

```
wash-dashboard/
├── public/                   ← deployed to GitHub Pages
│   ├── login.html            ← login gate (SHA-256 password check)
│   ├── index.html            ← main dashboard
│   ├── app.js                ← all frontend logic
│   └── styles.css            ← styling & responsive layout
├── .github/workflows/
│   └── deploy.yml            ← GitHub Actions auto-deploy on push to main
├── .gitignore                ← excludes .env, server.js, test scripts
└── README.md
```

**Data flow:**
```
Browser → DCP Water API  (https://api-dev.dcp.solar/water)
       → SonSetLink API  (https://sonsetlink.org/water/technical)
```
All API requests are made directly from the browser. Credentials are stored in `localStorage` per device and never committed to the repository.

---

## Data Sources

### 1 — DCP Water API

| Endpoint | Used for |
|----------|----------|
| `GET /v1/wells` | List all wells (name, location, ID) |
| `GET /v1/wells/{id}/timeseries?parameter=flow` | Hourly aggregated flow (m³/h) |
| `GET /v1/wells/{id}/timeseries?parameter=water_level_above_pump` | Hourly water level above pump (m) |

- Authentication: `X-Api-Key` header
- Dates: ISO-8601 UTC, aligned to midnight (`YYYY-MM-DDT00:00:00Z`)
- Values: hourly aggregated; `null` means no measurement in that hour

### 2 — SonSetLink API

| Endpoint | Used for |
|----------|----------|
| `GET /sites.json.php` | List all monitoring sites |
| `GET /usage.json.php` | Daily flow totals (`deflow`) and cumulative meter (`flow1`) |

- Authentication: `login` + `password` query parameters
- The dashboard cycles through `/usage.json.php`, `/usage1_msg.json.php`, `/usage8_msg.json.php`, `/usage12_msg.json.php` to find which table a given device stores data in (some return 404 — this is expected and silenced)

---

## Setting Up

### 1. First-time access — enter your API credentials

1. Open the dashboard and sign in (default credentials below)
2. Click **⚙️ Settings** in the header
3. Enter:
   - **DCP API Key** — your key from `api-dev.dcp.solar`
   - **SonSetLink User** — e.g. `unicef`
   - **SonSetLink Password** — your SonSetLink password
4. Click **Save & Reload**

Credentials are saved only in your browser's `localStorage`. They are **never** sent to GitHub or any third-party service other than the two APIs above.

---

### 2. Login credentials (dashboard access)

Default credentials for the login gate:

| Username | Password |
|----------|----------|
| `wash` | `Malawi2024!` |

Share these verbally with anyone who needs access. To change them:

1. Open `public/login.html`
2. Find the line:
   ```js
   HASH_TABLE.push(await sha256("wash:Malawi2024!"));
   ```
3. Replace `wash` and `Malawi2024!` with your preferred username and password
4. Commit and push

The password is checked client-side using the browser's native **WebCrypto SHA-256** — never stored in plain text.

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

Pushes to `main` automatically deploy via GitHub Actions (`.github/workflows/deploy.yml`). The `public/` folder is served as the GitHub Pages site root.

**Manual trigger:** Go to *Actions → Deploy to GitHub Pages → Run workflow*.

**GitHub Pages settings:**
- *Settings → Pages → Source → GitHub Actions*

---

## Security Notes

- API keys live only in `localStorage` — they are **never** in the source code or committed to git
- `.env` is listed in `.gitignore` and will never be pushed
- The login password is stored as a **SHA-256 hash** in `login.html` — it cannot be reversed to reveal the plaintext password
- SonSetLink credentials are visible inside network requests if devtools are open — this is unavoidable for a fully browser-based static app. Consider the sensitivity of these credentials accordingly.

---

## Known Limitations

- **CORS**: The browser must accept CORS responses from `api-dev.dcp.solar` and `sonsetlink.org`. Both APIs currently allow cross-origin requests.
- **Null flow values**: DCP wells that are offline or have inactive sensors will return hourly buckets with `value: null` — shown as `No Data` in the table.
- **SonSetLink 404s**: The fallback endpoint loop produces 404 responses for some devices. These are silenced in the code and are expected behaviour.
- **Session auth only**: The login gate persists for the browser session only. Closing and reopening the browser tab requires re-login.

---

## Licence

Internal tool — UNICEF Malawi WASH programme.
