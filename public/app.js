// ====================== CONFIG & STATE ======================
const DCP_BASE = "https://api-dev.dcp.solar/water";
// Malawi bbox filter
const MALAWI_BBOX = { latMin: -17.2, latMax: -9.2, lonMin: 32.5, lonMax: 36.1 };

let map, layerGroup;
let sites = [];
let markersByKey = new Map();

const el = (id) => document.getElementById(id);
const statusEl = el("status");
const detailEl = el("detail");

// ====================== HELPER FUNCTIONS ======================
function logStatus(msg) {
    if (statusEl) statusEl.textContent = msg;
}
function keyOf(s) { return `${s.source}:${s.site_id}:${s.serial || ""}`; }
function markerColor(source) { return (source === "SonSetLink") ? "#2563eb" : "#16a34a"; }

function inMalawiBBox(lat, lon) {
    const la = Number(lat), lo = Number(lon);
    if (!Number.isFinite(la) || !Number.isFinite(lo)) return false;
    return la >= MALAWI_BBOX.latMin && la <= MALAWI_BBOX.latMax && lo >= MALAWI_BBOX.lonMin && lo <= MALAWI_BBOX.lonMax;
}

// ====================== SETTINGS / AUTH ======================
const settingsModal = el("settingsModal");
const btnSettings = el("btnSettings");
const closeSettings = el("closeSettings");
const saveSettings = el("saveSettings");

btnSettings.onclick = () => {
    el("dcpToken").value = localStorage.getItem("dcp_token") || "";
    el("sslUser").value = localStorage.getItem("ssl_user") || "";
    el("sslPass").value = localStorage.getItem("ssl_pass") || "";
    settingsModal.style.display = "block";
};

// Token Debug Helper
el("dcpToken").addEventListener("input", (e) => {
    const len = e.target.value.trim().length;
    const msg = len > 0 ? `Length: ${len} chars` : "";
    let help = el("tokenHelp");
    if (!help) {
        help = document.createElement("small");
        help.id = "tokenHelp";
        help.style.display = "block";
        help.style.color = "#666";
        e.target.parentNode.appendChild(help);
    }

    if (len > 0 && len < 30) {
        help.textContent = `${msg} (Too short? This might be an ID, not the Secret)`;
        help.style.color = "red";
    } else {
        help.textContent = msg;
        help.style.color = "#666";
    }
});

closeSettings.onclick = () => settingsModal.style.display = "none";
window.onclick = (e) => { if (e.target === settingsModal) settingsModal.style.display = "none"; };

saveSettings.onclick = () => {
    let raw = el("dcpToken").value;
    // Remove " or ' or spaces
    let clean = raw.replace(/["'\s]/g, "");

    localStorage.setItem("dcp_token", clean);
    localStorage.setItem("ssl_user", el("sslUser").value.trim());
    localStorage.setItem("ssl_pass", el("sslPass").value.trim());
    settingsModal.style.display = "none";
    loadSites(); // Reload with new keys
};

function getKeys() {
    return {
        dcpToken: (localStorage.getItem("dcp_token") || "").trim(),
        sslUser: (localStorage.getItem("ssl_user") || "").trim(),
        sslPass: (localStorage.getItem("ssl_pass") || "").trim()
    };
}

// ====================== API LOGIC (PORTED FROM SERVER.JS) ======================

async function fetchJson(url, options = {}, silent = false) {
    const res = await fetch(url, options);
    const text = await res.text();
    if (!res.ok) {
        if (!silent) console.error(`HTTP ${res.status}: ${text.slice(0, 100)}`);
        throw new Error(`HTTP ${res.status}`);
    }
    if (!text.trim()) return {};
    try { return JSON.parse(text); }
    catch { throw new Error(`Expected JSON, got: ${text.slice(0, 50)}`); }
}

// --- SONSETLINK ---
async function sslSites() {
    // Note: This URL might fail CORS.
    const { sslUser, sslPass } = getKeys();
    const base = "https://sonsetlink.org/water/technical";
    if (!sslUser || !sslPass) return [];

    const url = new URL(`${base}/sites.json.php`);
    url.searchParams.set("login", sslUser);
    url.searchParams.set("password", sslPass);

    try {
        const rows = await fetchJson(url.toString());
        if (!Array.isArray(rows)) return [];
        return rows.map(r => {
            let ts = null;
            if (r.most_recent_tx) {
                const iso = String(r.most_recent_tx).trim().replace(" ", "T") + "Z";
                const t = Date.parse(iso);
                if (!isNaN(t)) ts = t / 1000;
            }
            return {
                source: "SonSetLink",
                site_id: String(r.site ?? ""),
                serial: String(r.serial ?? ""),
                site_name: String(r.name ?? ""),
                country: String(r.location ?? ""),
                last_updated: ts,
                flow_total: Number(r.flow_total),
                flow_unit: r.flow_unit,
                lat: Number(r.latitude),
                lon: Number(r.longitude)
            };
        });
    } catch (e) {
        console.warn("SonSetLink Error (CORS?):", e);
        return [];
    }
}

async function sslSeries(siteId, serial, startUtc, endUtc) {
    const { sslUser, sslPass } = getKeys();
    const base = "https://sonsetlink.org/water/technical";
    const endpoints = ["usage.json.php", "usage1_msg.json.php", "usage8_msg.json.php", "usage12_msg.json.php"]; // usage1 is most common

    for (const ep of endpoints) {
        const url = new URL(`${base}/${ep}`);
        url.searchParams.set("login", sslUser);
        url.searchParams.set("password", sslPass);
        url.searchParams.set("site", siteId);
        url.searchParams.set("serial", serial);
        url.searchParams.set("start_date", startUtc);
        url.searchParams.set("end_date", endUtc);
        url.searchParams.set("feature[]", "backfill");
        url.searchParams.set("feature[]", "decumulation");

        try {
            const j = await fetchJson(url.toString(), {}, true); // silent=true to hide expected 404s
            if (Array.isArray(j) && j.length) return { rows: j };
        } catch { }
    }
    return { rows: [] };
}

// --- DCP WATER ---
async function dcpWells(headers) {
    const j = await fetchJson(DCP_BASE + "/v1/wells", { headers });
    if (!Array.isArray(j)) return [];

    return j.map(r => {
        let lat = null, lon = null;
        if (r.location && typeof r.location === 'object') {
            lat = Number(r.location.latitude ?? r.location.lat);
            lon = Number(r.location.longitude ?? r.location.lon);
        } else if (typeof r.location === 'string') {
            const parts = r.location.split(',');
            if (parts.length === 2) {
                lat = Number(parts[0]);
                lon = Number(parts[1]);
            }
        }
        return {
            source: "DCP",
            site_id: String(r.well_id),
            site_name: String(r.name),
            last_updated: r.commissioned_date ? (new Date(r.commissioned_date).getTime() / 1000) : null,
            lat: lat, lon: lon, stats: {},
            country: ""
        };
    });
}

async function dcpSeries(headers, wellId, startIso, endIso) {
    const fetchParam = async (paramId) => {
        try {
            const url = new URL(DCP_BASE + "/v1/wells/" + wellId + "/timeseries");
            url.searchParams.set("parameter", paramId);
            const fmtIso = (iso) => iso.includes('.') ? iso.split('.')[0] + 'Z' : iso;
            url.searchParams.set("from", fmtIso(startIso));
            url.searchParams.set("to", fmtIso(endIso));

            const payload = await fetchJson(url.toString(), { headers });
            const values = payload.time_series?.values || [];

            return values.filter(v => v.value !== undefined && v.value !== null).map(v => ({
                code: paramId,
                value: Number(v.value),
                timestamp_ms: new Date(v.time).getTime()
            }));
        } catch (e) {
            console.warn("Failed to fetch param " + paramId + " for well " + wellId, e);
            return [];
        }
    };

    const [flowPts, wlPts] = await Promise.all([
        fetchParam("flow"),
        fetchParam("water_level_above_pump")
    ]);

    return [...flowPts, ...wlPts];
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

// ====================== APP LOGIC ======================

function initMap() {
    map = L.map("map").setView([-13.9, 33.8], 6);
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 19 }).addTo(map);
    layerGroup = L.layerGroup().addTo(map);
}

function refreshDropdown() {
    const sel = el("siteSelect");
    if (!sel) return; // Dropdown was removed in unified view
    const prev = sel.value;
    sel.innerHTML = `<option value="">Select a site…</option>`;
    const opts = sites.map(s => {
        const label = `[${s.source}] ${s.site_name || s.serial || s.site_id} (#${s.site_id})`;
        return { label, value: keyOf(s) };
    });
    opts.sort((a, b) => a.label.localeCompare(b.label));
    for (const o of opts) {
        const opt = document.createElement("option");
        opt.value = o.value;
        opt.textContent = o.label;
        sel.appendChild(opt);
    }
    if ([...sel.options].some(o => o.value === prev)) sel.value = prev;
}

function refreshMap() {
    layerGroup.clearLayers();
    markersByKey.clear();
    const withCoords = sites.filter(s => Number.isFinite(s.lat) && Number.isFinite(s.lon));

    if (!withCoords.length) {
        // If we have sites but no coords, warn. If no sites, don't warn unless loading finished.
        if (sites.length > 0) logStatus(`Loaded ${sites.length} sites. No coordinates to plot.`);
        return;
    }

    const bounds = [];
    const nowSec = Date.now() / 1000;

    for (const s of withCoords) {
        const k = keyOf(s);
        let opacity = 1.0;
        let ageText = "Unknown";
        if (s.last_updated) {
            const ageHours = (nowSec - s.last_updated) / 3600;
            if (ageHours < 24) { opacity = 1.0; ageText = `${Math.round(ageHours)}h ago`; }
            else if (ageHours < 168) { opacity = 0.6; ageText = `${Math.round(ageHours / 24)}d ago`; }
            else { opacity = 0.4; ageText = "> 7d ago"; }
        } else { opacity = 0.2; }

        const m = L.circleMarker([s.lat, s.lon], {
            radius: 6, color: markerColor(s.source), weight: 2, opacity, fillOpacity: opacity * 0.9
        }).addTo(layerGroup);

        m.bindPopup(`<b>${s.site_name}</b><br/>${s.source}<br/>${ageText}`);
        m.on("click", () => {
            const sel = el("siteSelect");
            if (sel) sel.value = k;
            loadSeriesFromCache(s);
        });
        markersByKey.set(k, m);
        bounds.push([s.lat, s.lon]);
    }
    if (bounds.length) map.fitBounds(bounds, { padding: [25, 25] });
    logStatus(`Loaded ${sites.length} sites (${withCoords.length} on map).`);
}

// Global auth headers


async function loadSites() {
    const vrm = getKeys().dcpToken;
    const ssl = getKeys().sslUser;

    if ((!vrm || !vrm.trim()) && (!ssl || !ssl.trim())) {
        // Prompt for settings if BOTH are empty
        logStatus("Please configure API keys in Settings.");
        settingsModal.style.display = "block";
        return;
    }

    logStatus("Loading sites...");
    const malawiOnly = el("malawiOnly").checked;

    // Parallel Fetch
    const promises = [];
    const allSites = [];

    // DCP
    const dcpToken = vrm; // mapped from getKeys().dcpToken above
    if (dcpToken) {
        promises.push((async () => {
            try {
                const headers = { "X-API-Key": dcpToken, "Accept": "application/json" };
                const wells = await dcpWells(headers);
                allSites.push(...wells);
            } catch (e) {
                console.error("DCP Load Error", e);
                logStatus("DCP Error: " + e.message);
            }
        })());
    }

    // SSL
    if (getKeys().sslUser) {
        promises.push(sslSites().then(res => allSites.push(...res)));
    }

    await Promise.all(promises);

    // Filter
    sites = allSites.filter(s => {
        if (!malawiOnly) return true;
        const c = (s.country || "").toLowerCase();
        return c === "malawi" || inMalawiBBox(s.lat, s.lon);
    });

    logStatus(`Done. Found ${sites.length} sites.`);
    refreshDropdown();
    refreshMap();
    renderTable();
}

async function loadSeries() {
    const k = el("siteSelect").value;
    const s = sites.find(x => keyOf(x) === k);
    if (!s) return;

    const days = Number(el("days").value || 30);
    const end = new Date();
    const start = new Date(end.getTime() - days * 24 * 3600 * 1000);
    const chartContainer = el("chart");
    chartContainer.innerHTML = "";
    detailEl.textContent = "Loading data...";

    let rows = [];

    if (s.source === "DCP") {
        const { dcpToken } = getKeys();
        const headers = { "X-API-Key": dcpToken, "Accept": "application/json" };
        rows = await dcpSeries(headers, s.site_id, start.toISOString(), end.toISOString());
    } else if (s.source === "SonSetLink") {
        // Need to format dates as YYYY-MM-DD HH:MM:SS
        const fmt = (d) => d.toISOString().replace("T", " ").slice(0, 19);
        const res = await sslSeries(s.site_id, s.serial, fmt(start), fmt(end));
        rows = res.rows;
    }

    if (!rows.length) { detailEl.textContent = "No data found."; return; }

    detailEl.textContent = `Loaded ${rows.length} points.`;
    renderCharts(s, rows, s.source);
}

function renderCharts(site, rows, source) {
    const chartContainer = el("chart");

    if (source === "SonSetLink") {
        const tKey = rows[0].timestamp ? "timestamp" : "adjusted_timestamp";
        const x = rows.map(r => new Date(r[tKey] || r.timestamp));
        const div = document.createElement("div");
        div.id = "c_ssl"; div.style.height = "350px"; div.style.marginBottom = "20px";
        chartContainer.appendChild(div);
        const traces = [];
        if (rows[0].flow1) traces.push({ x, y: rows.map(r => Number(r.flow1)), mode: "lines", name: "Total Flow", line: { color: "#2563eb" } });
        if (rows[0].deflow) traces.push({ x, y: rows.map(r => Number(r.deflow)), mode: "lines", name: "Daily Flow", line: { color: "#16a34a" } });
        if (traces.length) Plotly.newPlot("c_ssl", traces, { title: `${site.site_name} – Flow`, margin: { t: 50, b: 40, l: 60, r: 20 }, hovermode: "x unified" });

    } else if (source === "DCP") {
        // Group by code
        const byCode = {};
        for (const r of rows) {
            if (!byCode[r.code]) byCode[r.code] = [];
            byCode[r.code].push(r);
        }

        const flowPts = (byCode["flow"] || []).sort((a, b) => a.timestamp_ms - b.timestamp_ms);
        const wlPts = (byCode["water_level_above_pump"] || []).sort((a, b) => a.timestamp_ms - b.timestamp_ms);

        // Single dual-axis chart
        const div = document.createElement("div");
        div.id = "c_dcp"; div.style.height = "400px"; div.style.marginBottom = "20px";
        chartContainer.appendChild(div);

        const traces = [];
        if (flowPts.length) {
            traces.push({
                x: flowPts.map(p => new Date(p.timestamp_ms)),
                y: flowPts.map(p => p.value),
                name: "Aggregated Flow (m³/h)",
                type: "bar",
                yaxis: "y1",
                marker: { color: "#2563eb", opacity: 0.7 }
            });
        }
        if (wlPts.length) {
            traces.push({
                x: wlPts.map(p => new Date(p.timestamp_ms)),
                y: wlPts.map(p => p.value),
                name: "Water Level Above Pump (m)",
                mode: "lines",
                yaxis: "y2",
                line: { color: "#f59e0b", width: 2 }
            });
        }

        const layout = {
            title: `${site.site_name} – Flow & Water Level`,
            hovermode: "x unified",
            margin: { t: 55, b: 45, l: 65, r: 75 },
            legend: { orientation: "h", y: 1.12 },
            yaxis: { title: "Flow (m³/h)", side: "left", showgrid: true },
            yaxis2: { title: "Water Level (m)", side: "right", overlaying: "y", showgrid: false }
        };

        Plotly.newPlot("c_dcp", traces, layout);
    }
}

function setupCSVExport(site, rows, type) {
    // Re-impl simple CSV dump
    const btn = el("loadSeries"); // Hack: Just overwrite functionality or append? 
    // Plan: keep it simple. Allow user to click "Export CSV" button (add if missing)
    let btnExp = document.getElementById("btnExportCSV");
    if (!btnExp) {
        btnExp = document.createElement("button");
        btnExp.id = "btnExportCSV";
        btnExp.textContent = "Download CSV";
        el("siteSelect").parentElement.appendChild(btnExp);
    }
    btnExp.onclick = () => {
        let csv = "Timestamp,Code,Value\n";
        if (type === "DCP") {
            csv += rows.map(r => `${new Date(r.timestamp_ms).toISOString()},${r.code},${r.value}`).join("\n");
        } else {
            const keys = Object.keys(rows[0]);
            csv = keys.join(",") + "\n" + rows.map(r => keys.map(k => r[k]).join(",")).join("\n");
        }
        const a = document.createElement("a");
        a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
        a.download = `site_${site.site_id}.csv`;
        a.click();
    };
}


// COPY PASTE OLD TABLE LOGIC FOR RENDER TABLE ...

async function fetchSeriesForSite(s, days) {
    // Use midnight UTC boundaries (same as Python script) to ensure consistent day coverage
    const endDay = new Date();
    endDay.setUTCHours(0, 0, 0, 0);
    const end = new Date(endDay.getTime() + 24 * 3600 * 1000); // midnight tomorrow (exclusive)
    const start = new Date(endDay.getTime() - days * 24 * 3600 * 1000); // midnight N days ago

    let rows = [];
    if (s.source === "DCP") {
        const { dcpToken } = getKeys();
        const headers = { "X-API-Key": dcpToken, "Accept": "application/json" };
        const fmtIso = (d) => d.toISOString().replace('.000Z', 'Z');
        rows = await dcpSeries(headers, s.site_id, fmtIso(start), fmtIso(end));
    } else if (s.source === "SonSetLink") {
        const fmt = (d) => d.toISOString().replace("T", " ").slice(0, 19);
        const res = await sslSeries(s.site_id, s.serial, fmt(start), fmt(end));
        rows = res.rows;
    }
    return rows;
}

let allReportRows = [];

async function renderTable() {
    const days = Number(el("days").value || 7);
    el("daysLabel").textContent = days;
    const tbody = el("reportTable").querySelector("tbody");
    tbody.innerHTML = "<tr><td colspan='6'>Loading data...</td></tr>";

    allReportRows = [];

    const sorted = [...sites].sort((a, b) => (b.site_name || "").localeCompare(a.site_name || ""));

    // Batch process to avoid hitting API limits/browser freezing
    const BATCH_SIZE = 5;
    for (let i = 0; i < sorted.length; i += BATCH_SIZE) {
        const batch = sorted.slice(i, i + BATCH_SIZE);
        logStatus(`Fetching data... ${i + batch.length} / ${sorted.length}`);

        await Promise.all(batch.map(async (s) => {
            const points = await fetchSeriesForSite(s, days);

            let totalFlow = 0;
            let sparkData = [];

            if (s.source === "DCP") {
                // filter just flow for sparklines
                const flowPts = points.filter(p => p.code === "flow").sort((a, b) => a.timestamp_ms - b.timestamp_ms);
                if (flowPts.length > 0) {
                    const vals = flowPts.map(p => Number(p.value) || 0);
                    totalFlow = vals.reduce((acc, val) => acc + val, 0); // periodic flow is aggregated via sum
                    sparkData = vals;
                }
            } else if (s.source === "SonSetLink") {
                totalFlow = points.reduce((acc, p) => acc + Number(p.deflow || p.flow1 || 0), 0);
                sparkData = points.map(p => Number(p.deflow || p.flow1 || 0)).reverse(); // Assuming descending order from SSL, reverse to ascending
            }

            s.points = points;
            s.totalFlow = totalFlow;
            s.sparkData = sparkData;
            s.status = points.length > 0 ? "OK" : "No Data";
            console.log(`Site ${s.site_name} (${s.source}): Loaded ${points.length} pts. Flow=${totalFlow}`);
        }));
    }

    logStatus(`Done. Loaded ${sites.length} sites.`);

    // Render the table
    tbody.innerHTML = "";
    for (const s of sorted) {
        const tr = document.createElement("tr");
        const sparkSvg = renderSparkline(s.sparkData);
        const color = s.status === 'OK' ? 'green' : 'red';

        tr.innerHTML = `
            <td style="padding:8px; border-bottom:1px solid #ddd;">${s.source}</td>
            <td style="padding:8px; border-bottom:1px solid #ddd;">${s.site_name}</td>
            <td style="padding:8px; border-bottom:1px solid #ddd;">${s.site_id}</td>
            <td style="padding:8px; border-bottom:1px solid #ddd;">${Math.round(s.totalFlow * 100) / 100}</td>
            <td style="padding:8px; border-bottom:1px solid #ddd;">${sparkSvg}</td>
            <td style="padding:8px; border-bottom:1px solid #ddd; color:${color}">${s.status}</td>
        `;

        tr.style.cursor = "pointer";
        tr.onclick = () => {
            // Open details
            const sel = el("siteSelect");
            if (sel) sel.value = keyOf(s);
            const m = markersByKey.get(keyOf(s));
            if (m) { m.openPopup(); map.setView(m.getLatLng(), 12); }
            loadSeriesFromCache(s);
        };

        tbody.appendChild(tr);

        allReportRows.push({
            source: s.source,
            sysId: s.site_id,
            name: s.site_name,
            total: s.totalFlow,
            status: s.status
        });
    }
}

function loadSeriesFromCache(s) {
    el("detailSection").style.display = "block";
    el("detailTitle").textContent = `Details for ${s.site_name}`;
    const chartContainer = el("chart");
    chartContainer.innerHTML = "";

    if (!s.points || !s.points.length) {
        detailEl.textContent = "No data available in this timeframe.";
        return;
    }

    detailEl.textContent = `Rendering ${s.points.length} points...`;
    renderCharts(s, s.points, s.source);
}


function main() {
    initMap();
    if (el("btnViewMap")) el("btnViewMap").style.display = 'none';
    if (el("btnViewTable")) el("btnViewTable").style.display = 'none';
    el("reload").onclick = loadSites;
    // Hide old series buttons as they are now global settings
    if (el("loadSeries")) el("loadSeries").style.display = 'none';
    if (el("siteSelect")) el("siteSelect").parentElement.style.display = 'none';

    // Wire both CSV export buttons
    function doExportCSV() {
        if (!allReportRows || !allReportRows.length) { alert("No data to export."); return; }
        const days = el("days").value || 7;
        let csv = `Source,System ID,Site Name,Total Flow (m³)\n`;
        csv += allReportRows.map(r => `${r.source},"${r.sysId}","${r.name}",${r.total}`).join("\n");
        const blob = new Blob([csv], { type: "text/csv" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `wash_flow_${days}d.csv`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    }
    if (el("btnExportCSV")) el("btnExportCSV").onclick = doExportCSV;
    if (el("btnExportCSV2")) el("btnExportCSV2").onclick = doExportCSV;

    // Auto load if keys exist
    if (getKeys().dcpToken || getKeys().sslUser) {
        loadSites();
    } else {
        logStatus("Welcome. Click Settings to enter API keys.");
    }
}

main();
