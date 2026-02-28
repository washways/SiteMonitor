
const DCP_BASE = "/api/dcp";

const el = (id) => document.getElementById(id);
const logEl = el("statusLog");

function log(msg) {
    logEl.style.display = "block";
    const line = document.createElement("div");
    line.textContent = `[${new Date().toLocaleTimeString()}] ${msg}`;
    logEl.appendChild(line);
    logEl.scrollTop = logEl.scrollHeight;
    console.log(msg);
}

// ====================== AUTH & CONFIG ======================

function getKeys() {
    return {
        dcpToken: (localStorage.getItem("dcp_token") || "").trim(),
        sslUser: (localStorage.getItem("ssl_user") || "").trim(),
        sslPass: (localStorage.getItem("ssl_pass") || "").trim()
    };
}

// ====================== API HELPERS ======================

async function fetchJson(url, options = {}, silent = false) {
    try {
        const res = await fetch(url, options);
        if (!res.ok) {
            const text = await res.text();
            if (!silent) console.error("API Error Body:", text);
            throw new Error(`HTTP ${res.status}: ${text.slice(0, 100)}`);
        }
        const text = await res.text();
        if (!text.trim()) return {};
        return JSON.parse(text);
    } catch (e) {
        if (!silent) console.warn("Fetch Error:", url, e.message);
        throw e;
    }
}

const MALAWI_BBOX = { latMin: -17.2, latMax: -9.2, lonMin: 32.5, lonMax: 36.1 };

function inMalawiBBox(lat, lon) {
    const la = Number(lat), lo = Number(lon);
    if (!Number.isFinite(la) || !Number.isFinite(lo)) return false;
    return la >= MALAWI_BBOX.latMin && la <= MALAWI_BBOX.latMax && lo >= MALAWI_BBOX.lonMin && lo <= MALAWI_BBOX.lonMax;
}

// --- SONSETLINK ---
async function sslSites(user, pass) {
    const base = "/api/ssl/sites.json.php";
    const url = new URL(base, window.location.origin);
    url.searchParams.set("login", user);
    url.searchParams.set("password", pass);

    try {
        const rows = await fetchJson(url.toString());
        if (!Array.isArray(rows)) return [];
        return rows
            .filter(r => inMalawiBBox(r.latitude, r.longitude)) // Filter for Malawi
            .map(r => ({
                source: "SonSetLink",
                site_id: String(r.site ?? ""),
                serial: String(r.serial ?? ""),
                name: String(r.name ?? r.site ?? "Unknown"),
                lat: Number(r.latitude),
                lon: Number(r.longitude)
            }));
    } catch (e) {
        log(`SSL Sites Error: ${e.message}`);
        return [];
    }
}

async function sslSeries(site, startIso, endIso) {
    const { sslUser, sslPass } = getKeys();
    // Need YYYY-MM-DD HH:MM:SS format
    const format = (dStr) => dStr.replace("T", " ").slice(0, 19);

    // endpoints to check
    // endpoints to check
    const endpoints = ["usage.json.php"]; // usage1_msg.json.php returned 404 in tests

    for (const ep of endpoints) {
        const url = new URL(`/api/ssl/${ep}`, window.location.origin);
        url.searchParams.set("login", sslUser);
        url.searchParams.set("password", sslPass);
        url.searchParams.set("site", site.site_id);
        url.searchParams.set("serial", site.serial);
        url.searchParams.set("start_date", format(startIso));
        url.searchParams.set("end_date", format(endIso));
        url.searchParams.set("feature[]", "decumulation"); // Request daily flow if available

        try {
            const j = await fetchJson(url.toString());
            // Need pulse/flow data. 
            // We want SUM of flow for the day or daily value.
            if (Array.isArray(j) && j.length > 0) return j.map(r => ({
                timestamp: r.timestamp || r.adjusted_timestamp,
                // Use deflow (daily) if available, else flow1 (could be cumulative or raw)
                pulse: Number(r.deflow || r.flow1 || 0)
            }));
        } catch { }
    }
    return [];
}

// --- DCP ---
async function dcpWells(headers) {
    const j = await fetchJson(DCP_BASE + "/v1/wells", { headers });
    if (!Array.isArray(j)) return [];
    return j.map(r => ({
        source: "DCP",
        site_id: String(r.well_id),
        name: String(r.name ?? "Unknown"),
    }));
}

async function dcpSeries(site, headers, startIso, endIso) {
    try {
        const url = new URL(DCP_BASE + "/v1/wells/" + site.site_id + "/timeseries", window.location.origin);
        url.searchParams.set("parameter", "flow");
        url.searchParams.set("from", startIso);
        url.searchParams.set("to", endIso);
        
        const payload = await fetchJson(url.toString(), { headers });
        const values = payload.time_series?.values || [];
        
        const points = values.filter(v => v.value !== undefined && v.value !== null).map(v => ({
            timestamp: new Date(v.time).toISOString(),
            pulse: Number(v.value) // using pulse to map to existing logic
        }));
        
        if (points.length > 0) {
            site.status = "OK";
        } else {
            site.status = "No Data";
        }
        return points;

    } catch (e) {
        log("[DCP] Graph Error " + site.site_id + ": " + e.message);
        site.status = "Error";
        return [];
    }
}

// ====================== LOGIC ======================

let allReportRows = [];

async function generateReport() {
    const btn = el("btnGenerate");
    btn.disabled = true;
    allReportRows = [];
    el("reportTable").querySelector("tbody").innerHTML = "";
    logEl.innerHTML = "";

    const startStr = el("startDate").value; // YYYY-MM-DD
    const endStr = el("endDate").value;

    if (!startStr || !endStr) {
        alert("Please select dates.");
        btn.disabled = false;
        return;
    }

    // Prepare ISO strings for APIs
    const startDate = new Date(startStr);
    const endDate = new Date(endStr);
    // Add one day to end date to include it fully if it's just a date string
    const endExclusive = new Date(endDate);
    endExclusive.setDate(endExclusive.getDate() + 1);

    const startIso = startDate.toISOString(); // 2025-01-01T00:00:00.000Z
    const endIso = endExclusive.toISOString();

    log(`Starting report from ${startStr} to ${endStr}...`);

    const { dcpToken, sslUser, sslPass } = getKeys();

    // 1. Fetch Sites
    const sites = [];
    if (sslUser && sslPass) {
        log("Fetching SSL Sites...");
        const s = await sslSites(sslUser, sslPass);
        sites.push(...s);
        log(`Found ${s.length} SSL sites.`);
    }
    if (dcpToken) {
        log("Fetching DCP Sites...");
        const dcpHeaders = { "X-API-Key": dcpToken, "Accept": "application/json" };
        const v = await dcpWells(dcpHeaders);
        // store headers on site object for ease
        v.forEach(s => s.dcpHeaders = dcpHeaders);
        sites.push(...v);
        log("Found " + v.length + " DCP sites.");

        // 2. Fetch Data per Site
        let processed = 0;

        // Process one by one to prevent timeouts completely
        const CHUNK_SIZE = 1;
        for (let i = 0; i < sites.length; i += CHUNK_SIZE) {
            const chunk = sites.slice(i, i + CHUNK_SIZE);
            await Promise.all(chunk.map(s => processSite(s, startIso, endIso)));
            processed += chunk.length;
            log(`Processed ${processed}/${sites.length} sites...`);
            // Add a longer delay
            await new Promise(r => setTimeout(r, 1000));
        }

        log("Done!");
        btn.disabled = false;
        el("btnExport").disabled = false;
    }

    async function processSite(site, startIso, endIso) {
        try {
            // -----------------------------------------
            // 4. Process Site Data (Period Summary)
            // -----------------------------------------
            // Fetch full range data
            let points = [];
            if (site.source === "DCP") {
                const startEpoch = Math.floor(new Date(startIso).getTime() / 1000);
                const endEpoch = Math.floor(new Date(endIso).getTime() / 1000);
                points = await dcpSeries(site, site.dcpHeaders, startIso, endIso);
            } else {
                points = await sslSeries(site, startIso, endIso);
            }

            // Calculate Stats & Sparkline Data
            let totalFlow = 0;
            let sparkData = [];
            let sparkLabel = "Flow"; // Default label

            if (points.length > 0) {
                // We have actual flow data
                if (site.source === "VRM") {
                    const vals = points.map(p => p.pulse);
                    if (vals.length > 0) {
                        const min = Math.min(...vals);
                        const max = Math.max(...vals);
                        totalFlow = max - min;
                        sparkData = vals;
                    }
                } else {
                    // SSL
                    totalFlow = points.reduce((acc, p) => acc + p.pulse, 0);
                    sparkData = points.map(p => p.pulse);
                }
            } else if (false) {
                // FALLBACK: User insists data exists. Let's find *something* to plot (Solar or Battery)
                // We need to re-fetch a backup trend just for the sparkline to prove "Site Activity"
                
            }

            // Status Logic Update for SSL
            if (site.source === "SonSetLink" && points.length > 0) site.status = "OK";
            if (site.source === "SonSetLink" && points.length === 0) site.status = "No Data";

            // Render Sparkline
            const sparkSvg = renderSparkline(sparkData);

            const tbody = el("reportTable").querySelector("tbody");
            const tr = document.createElement("tr");
            tr.innerHTML = `
                <td>${site.source}</td>
                <td>${site.site_id}</td>
                <td>${site.name}</td>
                <td>${startIso} to ${endIso}</td>
                <td>${Math.round(totalFlow * 100) / 100}</td>
                <td>${sparkSvg}</td>
                <td style="color:${site.status && (site.status === 'OK' || site.status.startsWith('OK')) ? 'green' : 'red'}">${site.status || 'OK'}</td>
            `;
            tbody.appendChild(tr);

            allReportRows.push({
                source: site.source,
                sysId: site.site_id,
                name: site.name,
                period: `${startIso}:${endIso}`,
                total: totalFlow,
                status: site.status || 'OK'
            });

        } catch (e) {
            console.error(`Error processing ${site.site_id}`, e);
        }
    }

    function renderSparkline(data) {
        if (!data || data.length < 2) return `<span style="color:#ccc; font-size:0.8em">No Trend</span>`;

        const width = 100;
        const height = 30;
        const min = Math.min(...data);
        const max = Math.max(...data);
        const range = max - min;

        if (range === 0) return `<svg width="${width}" height="${height}" style="background:#fcfcfc"><path d="M0,${height / 2} L${width},${height / 2}" stroke="#999" stroke-width="1" fill="none"/></svg>`;

        const step = width / (data.length - 1);
        const pts = data.map((val, i) => {
            const x = i * step;
            const y = height - ((val - min) / range) * height; // Invert Y
            return `${x.toFixed(1)},${y.toFixed(1)}`;
        });

        return `<svg width="${width}" height="${height}" style="background:#fcfcfc; border:1px solid #eee">
              <path d="M${pts.join(' L')}" stroke="#007bff" stroke-width="1.5" fill="none" />
            </svg>`;
    }

    // Expose rows for export (optional, already global)
}

// Attach listener when DOM is ready
window.addEventListener('DOMContentLoaded', () => {
    // Set default dates
    const today = new Date();
    const lastMonth = new Date();
    lastMonth.setDate(today.getDate() - 30);

    const startInput = el("startDate");
    const endInput = el("endDate");

    if (startInput) startInput.value = lastMonth.toISOString().split("T")[0];
    if (endInput) endInput.value = today.toISOString().split("T")[0];

    const btn = el("btnGenerate");
    if (btn) btn.onclick = generateReport;

    const btnExp = el("btnExport");
    if (btnExp) {
        btnExp.onclick = () => {
            if (!allReportRows || !allReportRows.length) {
                alert("No data to export.");
                return;
            }
            let csv = "Source,System ID,Site Name,Date,Pulse Value\n";
            csv += allReportRows.map(r => `${r.source},"${r.sysId}","${r.name}",${r.date},${r.count}`).join("\n");

            const blob = new Blob([csv], { type: "text/csv" });
            const url = URL.createObjectURL(blob);
            const a = document.createElement("a");
            a.href = url;
            a.download = "pulse_report.csv";
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
        };
    }

    // Initial check
    if (!getKeys().dcpToken && !getKeys().sslUser) {
        log("⚠️ No API Keys found. Please configure them in the main dashboard first.");
    }
});
