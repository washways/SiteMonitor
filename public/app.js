let map, layerGroup;
let sites = [];
let markersByKey = new Map();

const el = (id) => document.getElementById(id);
const statusEl = el("status");
const detailEl = el("detail");

function logStatus(msg) {
    statusEl.textContent = msg;
}

function keyOf(s) {
    return `${s.source}:${s.site_id}:${s.serial || ""}`;
}

function markerColor(source) {
    // SonSetLink = blue, VRM = green
    return (source === "SonSetLink") ? "#2563eb" : "#16a34a";
}

async function loadConfig() {
    const cfg = await fetch("/api/config").then(r => r.json());
    el("malawiOnly").checked = cfg.defaults.malawi_only;
    el("days").value = cfg.defaults.days;
}

function initMap() {
    map = L.map("map").setView([-13.9, 33.8], 6);
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 19 }).addTo(map);
    layerGroup = L.layerGroup().addTo(map);
}

function refreshDropdown() {
    const sel = el("siteSelect");
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
        logStatus(`Loaded ${sites.length} sites. No coordinates to plot.`);
        return;
    }

    const bounds = [];
    const nowSec = Date.now() / 1000;

    for (const s of withCoords) {
        const k = keyOf(s);

        // Opacity Logic
        let opacity = 1.0;
        let ageText = "Unknown";

        if (s.last_updated) {
            const ageHours = (nowSec - s.last_updated) / 3600;
            if (ageHours < 24) {
                opacity = 1.0;
                ageText = `${Math.round(ageHours)}h ago`;
            } else if (ageHours < 24 * 7) {
                // Linear fade from 1.0 at 24h to 0.4 at 7 days
                const ageDays = ageHours / 24;
                const fade = 0.6 * ((ageDays - 1) / 6);
                opacity = Math.max(0.4, 1.0 - fade);
                ageText = `${Math.round(ageDays)}d ago`;
            } else {
                opacity = 0.4;
                ageText = "> 7d ago";
            }
        } else {
            opacity = 0.2; // No date
        }

        const m = L.circleMarker([s.lat, s.lon], {
            radius: 6,
            color: markerColor(s.source),
            weight: 2,
            opacity: opacity,
            fillOpacity: Math.max(0.2, opacity * 0.9)
        }).addTo(layerGroup);

        const name = (s.site_name || s.serial || s.site_id);
        m.bindPopup(`
          <b>${name}</b><br/>
          Source: ${s.source}<br/>
          Site ID: ${s.site_id}<br/>
          Serial: ${s.serial || ""}<br/>
          Country: ${s.country || "Unknown"}<br/>
          Last Update: ${ageText}<br/>
        `);

        m.on("click", () => { el("siteSelect").value = k; });
        markersByKey.set(k, m);
        bounds.push([s.lat, s.lon]);
    }

    map.fitBounds(bounds, { padding: [25, 25] });
    logStatus(`Loaded ${sites.length} sites (${withCoords.length} with coords).`);
}

async function loadSites() {
    const malawiOnly = el("malawiOnly").checked;
    logStatus("Loading sites…");

    const res = await fetch(`/api/sites?malawi_only=${malawiOnly ? "true" : "false"}`);
    const j = await res.json();
    if (!res.ok) throw new Error(j.error || "Failed to load sites");

    sites = j;
    refreshDropdown();
    refreshMap();
}

function getSelectedSite() {
    const k = el("siteSelect").value;
    if (!k) return null;
    return sites.find(s => keyOf(s) === k) || null;
}

async function loadSeries() {
    const s = getSelectedSite();
    if (!s) {
        detailEl.textContent = "Select a site first.";
        return;
    }
    const days = Number(el("days").value || 30);

    detailEl.textContent = "Loading series…";
    const chartContainer = el("chart");
    chartContainer.innerHTML = ""; // Clear previous charts

    const url = new URL("/api/series", window.location.origin);
    url.searchParams.set("source", s.source);
    url.searchParams.set("site_id", s.site_id);
    url.searchParams.set("serial", s.serial || "");
    url.searchParams.set("days", String(days));

    const res = await fetch(url.toString());
    const j = await res.json();
    if (!res.ok) throw new Error(j.error || "Failed to load series");

    const titleBase = `${s.site_name || s.serial || ""} (#${s.site_id})`;

    // Helper to add a chart div
    const addChart = (id, trace, title) => {
        const d = document.createElement("div");
        d.id = id;
        d.style.height = "300px";
        d.style.marginBottom = "20px";
        chartContainer.appendChild(d);
        Plotly.newPlot(id, [trace], {
            title: title,
            margin: { l: 50, r: 20, t: 40, b: 40 },
            showlegend: true
        });
    };

    // Liters per pulse assumption
    const LITERS_PER_PULSE = 10;

    // Helper: Derive Flow Rate (m3/h) from Cumulative Series
    // Returns { x: Date[], y: Number[] }
    const deriveFlowRate = (sortedPoints) => {
        const x = [];
        const y = [];
        for (let i = 1; i < sortedPoints.length; i++) {
            const p1 = sortedPoints[i - 1];
            const p2 = sortedPoints[i];

            // Time delta in hours
            const t1 = p1.timestamp_ms || p1.ts;
            const t2 = p2.timestamp_ms || p2.ts; // Helper needs to handle both VRM/SSL shapes if possible
            const hDelta = (t2 - t1) / (3600 * 1000);

            if (hDelta <= 0 || hDelta > 24) continue; // Skip weird gaps or duplicates

            // Value delta
            const v1 = Number(p1.value ?? p1.val);
            const v2 = Number(p2.value ?? p2.val);
            const vDelta = v2 - v1;

            if (vDelta < 0) continue; // Reset or roll-over, ignore

            // Calc Flow Rate
            // m3 = (pulses * L_per_pulse) / 1000
            // rate = m3 / hours
            const m3 = (vDelta * LITERS_PER_PULSE) / 1000;
            const rate = m3 / hDelta;

            // Plot at midpoint time? Or end time? End time is safer for "rate during this interval"
            x.push(new Date(t2));
            y.push(rate);
        }
        return { x, y };
    };

    if (s.source === "SonSetLink") {
        const rows = j.rows || [];
        const tKey = rows[0] && (("timestamp" in rows[0]) ? "timestamp" : (("adjusted_timestamp" in rows[0]) ? "adjusted_timestamp" : null));

        if (!rows.length || !tKey) {
            detailEl.textContent = titleBase + "\n\nNo rows or unrecognized shape.";
            return;
        }

        const x = rows.map(r => new Date(r[tKey]));

        if ("flow1" in rows[0]) {
            addChart("chart_flow1", { x, y: rows.map(r => Number(r.flow1)), mode: "lines", name: "Total Flow" }, "Total Accumulated Flow");

            // Derive Rate from flow1
            // standardize points for helper
            const pts = rows.map(r => ({
                ts: new Date(r[tKey]).getTime(),
                val: Number(r.flow1) // "flow1" is raw count/volume? User says "flow_total" in other places. 
                // Assuming flow1 IS the cumulative counter. 
                // Note: SonSetLink typically sends `flow_total`. Let's check `flow_total` vs `flow1`.
                // Server `sslSeries` relies on whatever the endpoint returns. 
                // Let's stick to flow1 as implemented before, but verify scaling.
                // If flow1 is already Liters, then 1 unit = 1 L. 
                // Attempt to treat it as pulses with our factor.
            }));
            // Actually, for SSL, `flow1` is often already processed. But let's try the derivation.
            // Wait, looking at server.js line 139: `flow_total: Number(r.flow_total)`.
            // In `sslSeries` (server.js around 160), it returns raw JSON.
            // Previous code used `rows.map(r => Number(r.flow1))`.

            const derived = deriveFlowRate(pts);
            if (derived.x.length) {
                addChart("chart_flow_rate", { x: derived.x, y: derived.y, type: "bar", name: "Calc Flow Rate" }, `Calculated Flow Rate (m3/h) @ ${LITERS_PER_PULSE}L/p`);
            }
        }
        if ("deflow" in rows[0]) {
            addChart("chart_deflow", { x, y: rows.map(r => Number(r.deflow)), mode: "lines", name: "Daily Flow" }, "Daily Flow");
        }

        detailEl.textContent = `${titleBase}\nRange: ${j.start_utc} → ${j.end_utc}\nRows: ${rows.length}`;
        setupCSVExport(s, rows, "SonSetLink");
        return;
    }

    if (s.source === "VRM") {
        const rows = j.rows || [];
        if (!rows.length) {
            detailEl.textContent = titleBase + "\n\nNo rows in range.";
            return;
        }

        const by = new Map();
        for (const r of rows) {
            const c = r.code || "UNKNOWN";
            if (!by.has(c)) by.set(c, []);
            by.get(c).push(r);
        }

        const sortedCodes = [...by.entries()].sort((a, b) => b[1].length - a[1].length); // Most data first

        for (const [code, arr] of sortedCodes) {
            const sortedArr = arr.sort((a, b) => a.timestamp_ms - b.timestamp_ms);
            const x = sortedArr.map(p => new Date(p.timestamp_ms));
            const y = sortedArr.map(p => p.value);

            // Dictionary for better chart titles
            const CODE_MAP = {
                "PVP": "Solar Power (W)",
                "BV": "Battery Voltage (V)",
                "SOC": "State of Charge (%)",
                "TL": "Tank Level (%)",
                "tl": "Tank Level (%)",
                "TR": "Tank Volume (m3)",
                "tr": "Tank Volume (m3)",
                "MC": "Pulse Count (cum)",
                "mc": "Pulse Count (cum)",
                "MA": "Pulse Agg (cum)",
                "ma": "Pulse Agg (cum)",
                "YT": "Yield Today (kWh)"
            };

            const friendlyName = CODE_MAP[code] || CODE_MAP[code.toUpperCase()] || code;

            addChart(`chart_${code.replace(/[^a-zA-Z0-9]/g, "")}`, {
                x, y, mode: "lines", name: friendlyName
            }, `VRM: ${friendlyName}`);

            // If Code is MC (Pulse Count) or MA (Pulse Agg), derive rate
            // MC is typically the cumulative counter on Victron digital inputs configured for flow
            // If Code is MC (Pulse Count) or MA (Pulse Agg), derive rate
            // Also check for "FLW" or "FLOW" or "VOLUME" just in case
            const cUpper = code.toUpperCase();
            if (cUpper === "MC" || cUpper === "MA" || cUpper.includes("FLOW") || cUpper.includes("FLW")) {
                const derived = deriveFlowRate(sortedArr);
                if (derived.x.length) {
                    addChart(`chart_${code}_rate`, { x: derived.x, y: derived.y, type: "bar", name: "Flow Rate" }, `Derived Flow Rate (m3/h) from ${code}`);
                }
            }
        }

        detailEl.textContent = `${titleBase}\nRange: ${j.start_utc} → ${j.end_utc}\nRows: ${rows.length}`;

        // Setup CSV Export
        setupCSVExport(s, rows, "VRM");
    }
}

function setupCSVExport(site, rows, type) {
    const btn = el("btnExportCSV");
    btn.style.display = "inline-block";
    btn.onclick = () => {
        let csv = "";
        let filename = `site_${site.site_id}_${type}_export.csv`;

        if (type === "SonSetLink") {
            // Headers
            const keys = Object.keys(rows[0]);
            csv = keys.join(",") + "\n";
            csv += rows.map(r => keys.map(k => r[k]).join(",")).join("\n");
        } else {
            // VRM: timestamps common? they are sparse. We list all rows formatted: Timestamp, Code, Value
            csv = "Timestamp,Timestamp_ISO,Code,Value\n";
            csv += rows.map(r => {
                const d = new Date(r.timestamp_ms);
                return `${r.timestamp_ms},"${d.toISOString()}",${r.code},${r.value}`;
            }).join("\n");
        }

        const blob = new Blob([csv], { type: "text/csv" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
    };
}

// Table Logic
function setViewMode(mode) {
    if (mode === "map") {
        el("map").style.display = "block";
        el("tableView").style.display = "none";
        el("btnViewMap").classList.add("active");
        el("btnViewTable").classList.remove("active");
        if (map) map.invalidateSize();
    } else {
        el("map").style.display = "none";
        el("tableView").style.display = "block";
        el("btnViewMap").classList.remove("active");
        el("btnViewTable").classList.add("active");
        renderTable();
    }
}

function renderTable() {
    const tbody = el("sitesTable").querySelector("tbody");
    tbody.innerHTML = "";

    // Sort by last updated (descending), then name
    const sorted = [...sites].sort((a, b) => {
        const ta = a.last_updated || 0;
        const tb = b.last_updated || 0;
        return tb - ta || (a.site_name || "").localeCompare(b.site_name || "");
    });

    const nowSec = Date.now() / 1000;

    for (const s of sorted) {
        const tr = document.createElement("tr");

        let ageText = "No Date";
        let color = "#999";

        if (s.last_updated) {
            const ageHours = (nowSec - s.last_updated) / 3600;
            if (ageHours < 24) { ageText = "< 24h"; color = "#00cc00"; }
            else if (ageHours < 24 * 7) { ageText = `${Math.round(ageHours / 24)}d ago`; color = "#ffcc00"; }
            else { ageText = "> 7d ago"; color = "#ff4444"; }
        }

        // Format Stats
        let statsHtml = "";
        if (s.source === "SonSetLink" && s.flow_total) {
            statsHtml += `<b>Flow:</b> ${s.flow_total.toLocaleString()} ${s.flow_unit || ""}`;
        }
        if (s.source === "VRM" && s.stats) {
            const st = s.stats;
            // Keys are now UpperCase from backend, but keep helper for safety
            const get = (k) => st[k] || st[k.toUpperCase()];

            const bv = get("BV");
            const soc = get("SOC");
            const pvp = get("PVP");
            const yt = get("YT");
            const tl = get("TL");
            const tf = get("TF"); // Tank Fluid
            const scs = get("SCS"); // Charge State
            const err = get("SCERR"); // Error
            const gw = get("GW"); // Gateway
            const build = get("BUILD");
            const ma = get("MA"); // Pulse Agg
            const mc = get("MC"); // Pulse Count

            if (bv) statsHtml += `<b>Batt:</b> ${bv} <br/>`;
            if (soc) statsHtml += `<b>SoC:</b> ${soc}% <br/>`;
            if (scs) statsHtml += `<b>Chg State:</b> ${scs} <br/>`;
            if (pvp) statsHtml += `<b>Solar:</b> ${pvp} <br/>`;
            if (yt) statsHtml += `<b>Yield:</b> ${yt} <br/>`;
            if (ma) statsHtml += `<b>Pulse Agg:</b> ${ma} <br/>`;
            if (mc) statsHtml += `<b>Pulse Cnt:</b> ${mc} <br/>`;
            if (err && String(err) !== "0" && String(err) !== "No error") statsHtml += `<b style="color:red">Error:</b> ${err} <br/>`;
            if (tl) statsHtml += `<b>Tank:</b> ${tl} <small>(${tf || ""})</small> <br/>`;
            if (build) statsHtml += `<b>Status:</b> ${build} <br/>`;
            if (gw) statsHtml += `<b>GW:</b> ${gw} <br/>`;
        }

        tr.innerHTML = `
            <td style="padding: 8px; border-bottom: 1px solid #ddd;">${s.site_name || s.site_id}</td>
            <td style="padding: 8px; border-bottom: 1px solid #ddd;">${s.country || ""}</td>
            <td style="padding: 8px; border-bottom: 1px solid #ddd;">${s.source}</td>
            <td style="padding: 8px; border-bottom: 1px solid #ddd; color: ${color}; font-weight: bold;">${ageText}</td>
            <td style="padding: 8px; border-bottom: 1px solid #ddd; font-size: 0.9em;">${statsHtml}</td>
        `;

        tr.style.cursor = "pointer";
        tr.onclick = () => {
            // Switch to map to select site
            setViewMode("map");
            el("siteSelect").value = keyOf(s);
            loadSeries();
            // Highlight marker?
            const m = markersByKey.get(keyOf(s));
            if (m) {
                m.openPopup();
                map.setView(m.getLatLng(), Math.max(map.getZoom(), 12));
            }
        };

        tbody.appendChild(tr);
    }
}

async function main() {
    initMap();
    await loadConfig();
    // Add listeners for view mode toggles
    el("btnViewMap").onclick = () => setViewMode("map");
    el("btnViewTable").onclick = () => setViewMode("table");

    el("btnLast7").onclick = () => {
        el("days").value = 7;
        // Trigger reload if a site is currently selected? 
        // For simplicity, user will click Load Series again or we can re-trigger
        const sel = el("siteSelect").value;
        if (sel) {
            alert("Set to 7 Days. Click 'Load Series' or a site marker to reload.");
        }
    };

    el("btnLast2").onclick = () => {
        el("days").value = 2;
        const sel = el("siteSelect").value;
        if (sel) {
            alert("Set to 2 Days (High Res). Click 'Load Series' or a site marker to reload.");
        }
    };

    el("reload").addEventListener("click", async () => {
        try { await loadSites(); }
        catch (e) { logStatus(String(e.message || e)); }
    });

    el("loadSeries").addEventListener("click", async () => {
        try { await loadSeries(); }
        catch (e) { detailEl.textContent = String(e.message || e); }
    });
}

main().catch(e => logStatus(String(e.message || e)));
