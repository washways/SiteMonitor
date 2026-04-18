
if (location.hostname === "127.0.0.1") {
    const redirected = location.href.replace("127.0.0.1", "localhost");
    location.replace(redirected);
}

const PROXY_BASE = "https://wash-proxy.washways1.workers.dev";
const IS_LOCAL = !!location.hostname.match(/^(localhost|127\.0\.0\.1)$/);
const FORCE_PROXY = window.location.search.includes("proxy=1") || localStorage.getItem("wash_force_proxy") === "1";
if (window.location.search.includes("proxy=1")) {
    localStorage.setItem("wash_force_proxy", "1");
}
const USE_PROXY = !IS_LOCAL || FORCE_PROXY;
const IS_LIVE = USE_PROXY;
const DCP_BASE = USE_PROXY ? `${PROXY_BASE}/dcp` : "https://api-dev.dcp.solar/water";
const SSL_BASE = USE_PROXY ? `${PROXY_BASE}/ssl` : "https://sonsetlink.org/water/technical";
const CACHE_TTL_MS = 30 * 60 * 1000;

const {
    detectPumpingEvents,
    buildEventSummary,
    buildBoreholeSummaries,
    buildEventCsv
} = window.SiteMonitorEventAnalysis || {};
const el = (id) => document.getElementById(id);
const logEl = el("statusLog");

let allEventRows = [];
let lastDateRange = null;

function round(value, digits = 3) {
    return Number.isFinite(value) ? Number(value.toFixed(digits)) : null;
}

function getSelectedSource() {
    return el("sourceFilter")?.value || "";
}

function getDisplayedEvents() {
    const selectedSource = getSelectedSource();
    const selectedSite = el("boreholeFilter")?.value || "";
    return allEventRows.filter((event) => {
        if (selectedSource && event.source !== selectedSource) return false;
        if (selectedSite && event.well_id !== selectedSite) return false;
        return true;
    });
}

function log(msg) {
    if (!logEl) return;
    logEl.style.display = "block";
    const line = document.createElement("div");
    line.textContent = `[${new Date().toLocaleTimeString()}] ${msg}`;
    logEl.appendChild(line);
    logEl.scrollTop = logEl.scrollHeight;
}

function getKeys() {
    return {
        dcpToken: (localStorage.getItem("dcp_token") || "").trim(),
        sslUser: (localStorage.getItem("ssl_user") || "").trim(),
        sslPass: (localStorage.getItem("ssl_pass") || "").trim()
    };
}

function cacheKey(startStr, endStr) {
    return `siteMonitor_specific_capacity_v3_${startStr}_${endStr}`;
}

function loadCachedEvents(startStr, endStr) {
    try {
        const raw = localStorage.getItem(cacheKey(startStr, endStr));
        if (!raw) return null;
        const parsed = JSON.parse(raw);
        if (!parsed.saved_at || (Date.now() - parsed.saved_at) > CACHE_TTL_MS) return null;
        return parsed;
    } catch {
        return null;
    }
}

function saveCachedEvents(startStr, endStr, events, summary) {
    localStorage.setItem(cacheKey(startStr, endStr), JSON.stringify({
        saved_at: Date.now(),
        events,
        summary
    }));
}

async function fetchJson(url, options = {}) {
    const res = await fetch(url, options);
    const text = await res.text();
    if (!res.ok) {
        throw new Error(`HTTP ${res.status}: ${text.slice(0, 100)}`);
    }
    return text.trim() ? JSON.parse(text) : {};
}

function parseSslTimestamp(rawValue) {
    if (!rawValue) return null;
    const ts = Date.parse(String(rawValue).trim().replace(" ", "T") + "Z");
    return Number.isFinite(ts) ? ts : null;
}

function sslDisplayName(row = {}) {
    return String(row.name || row.site_name || row.serial || (row.site ? `Site ${row.site}` : "Unknown SonSetLink Site"));
}

function getSslDailyFlow(row) {
    const deflow = Number(row?.deflow);
    if (Number.isFinite(deflow)) return deflow;
    const pulse = Number(row?.pulse);
    if (Number.isFinite(pulse)) return pulse;
    return 0;
}

function sslDepthPoints(rows, scale = 0.1) {
    const pts = [];
    for (const row of (Array.isArray(rows) ? rows : [])) {
        if (!row.sensor2 || String(row.sensor2).toUpperCase() === "NULL") continue;
        let arr;
        try {
            arr = JSON.parse(row.sensor2);
        } catch {
            continue;
        }
        if (!Array.isArray(arr) || !arr.length) continue;

        const endMs = parseSslTimestamp(row.adjusted_timestamp || row.timestamp);
        if (!Number.isFinite(endMs)) continue;
        const slotMs = (24 * 3600 * 1000) / arr.length;
        const startMs = endMs - (24 * 3600 * 1000);

        arr.forEach((value, idx) => {
            const num = Number(value);
            if (!Number.isFinite(num) || num >= 255) return;
            pts.push({
                code: "water_level_above_pump",
                timestamp_ms: startMs + ((idx + 0.5) * slotMs),
                value: num * scale
            });
        });
    }
    return pts;
}

async function sslSites() {
    const { sslUser, sslPass } = getKeys();
    if (!IS_LIVE && (!sslUser || !sslPass)) return [];

    const url = new URL(`${SSL_BASE}/sites.json.php`);
    if (sslUser) url.searchParams.set("login", sslUser);
    if (sslPass) url.searchParams.set("password", sslPass);

    const rows = await fetchJson(url.toString());
    if (!Array.isArray(rows)) return [];

    return rows.map((row) => ({
        source: "SonSetLink",
        site_id: String(row.site ?? ""),
        serial: String(row.serial ?? ""),
        site_name: sslDisplayName(row),
        country: String(row.location ?? ""),
        last_updated: parseSslTimestamp(row.most_recent_tx)
    }));
}

async function sslSeries(siteId, serial, startUtc, endUtc) {
    const { sslUser, sslPass } = getKeys();
    const endpoints = [
        "usage.json.php",
        "status.json.php",
        "diag.json.php",
        "test.json.php",
        "usage1_msg.json.php",
        "usage8_msg.json.php",
        "usage12_msg.json.php"
    ];

    const merged = [];
    const seen = new Set();

    for (const ep of endpoints) {
        const url = new URL(`${SSL_BASE}/${ep}`);
        if (sslUser) url.searchParams.set("login", sslUser);
        if (sslPass) url.searchParams.set("password", sslPass);
        url.searchParams.set("site", siteId);
        url.searchParams.set("serial", serial);
        url.searchParams.set("start_date", startUtc);
        url.searchParams.set("end_date", endUtc);
        url.searchParams.set("feature[]", "backfill");
        url.searchParams.set("feature[]", "decumulation");

        try {
            const rows = await fetchJson(url.toString());
            if (!Array.isArray(rows) || !rows.length) continue;
            for (const row of rows) {
                const key = `${row.adjusted_timestamp || row.timestamp || ""}|${row.flow1 || ""}|${row.deflow || ""}`;
                if (seen.has(key)) continue;
                seen.add(key);
                merged.push({ ...row, _endpoint: ep });
            }
        } catch {
            // Some SonSetLink endpoints are unavailable in some deployments.
        }
    }

    merged.sort((a, b) => (parseSslTimestamp(a.adjusted_timestamp || a.timestamp) || 0) - (parseSslTimestamp(b.adjusted_timestamp || b.timestamp) || 0));
    return { rows: merged };
}

function buildSslEvents(site, rows) {
    const events = [];
    let index = 0;

    for (const row of (Array.isArray(rows) ? rows : [])) {
        const totalVolume = getSslDailyFlow(row);
        if (!(totalVolume > 0.1)) continue;

        const depthPoints = sslDepthPoints([row], 0.1).sort((a, b) => a.timestamp_ms - b.timestamp_ms);
        const startMs = depthPoints[0]?.timestamp_ms ?? parseSslTimestamp(row.timestamp);
        const endMs = depthPoints[depthPoints.length - 1]?.timestamp_ms ?? parseSslTimestamp(row.adjusted_timestamp || row.timestamp) ?? startMs;
        const startLevel = depthPoints.length ? depthPoints[0].value : null;
        const endLevel = depthPoints.length ? depthPoints[depthPoints.length - 1].value : null;
        const minLevel = depthPoints.length ? Math.min(...depthPoints.map((p) => p.value)) : null;
        const rawDrawdown = (startLevel !== null && endLevel !== null) ? (startLevel - endLevel) : null;
        const maxDrawdown = (startLevel !== null && minLevel !== null) ? (startLevel - minLevel) : null;
        const effectiveDrawdown = Number.isFinite(rawDrawdown) && rawDrawdown > 0.05
            ? rawDrawdown
            : maxDrawdown;
        const recovery = (maxDrawdown !== null && rawDrawdown !== null) ? (maxDrawdown - rawDrawdown) : null;

        const timeInUse = Number(row.time_in_use);
        const activeHours = Number.isFinite(timeInUse) && timeInUse > 0
            ? (timeInUse > 24 ? timeInUse / 60 : timeInUse)
            : 24;
        const estimatedFlow = totalVolume / Math.max(activeHours, 0.25);
        const invalidSpecificCapacity = !Number.isFinite(effectiveDrawdown) || effectiveDrawdown < 0.05;

        events.push({
            well_id: site.serial ? `SSL-${site.serial}` : `SSL-${site.site_id}`,
            well_name: site.site_name || sslDisplayName(site),
            source: "SonSetLink",
            event_index: ++index,
            event_start_ms: startMs,
            event_end_ms: endMs,
            duration_hours: round(Number.isFinite(startMs) && Number.isFinite(endMs) ? (endMs - startMs) / (60 * 60 * 1000) : activeHours, 2),
            total_volume_m3: round(totalVolume, 3),
            final_flow_m3h: round(estimatedFlow, 3),
            avg_flow_m3h: round(estimatedFlow, 3),
            start_level_m: round(startLevel, 3),
            end_level_m: round(endLevel, 3),
            min_level_m: round(minLevel, 3),
            drawdown_m: round(effectiveDrawdown, 3),
            max_drawdown_m: round(maxDrawdown, 3),
            recovery_m: round(recovery, 3),
            specific_capacity_m3h_per_m: !invalidSpecificCapacity ? round(estimatedFlow / effectiveDrawdown, 3) : null,
            quality_score: Math.max(0, 75 - (depthPoints.length ? 0 : 25) - (invalidSpecificCapacity ? 20 : 0)),
            anomaly_count: 0,
            gap_count: 0,
            has_flow_anomalies: false,
            has_timestamp_gaps: false,
            flags: {
                approximate_daily_event: true,
                insufficient_water_level: depthPoints.length === 0,
                invalid_specific_capacity: invalidSpecificCapacity,
                flow_anomaly: false,
                timestamp_gap: false,
                ongoing_event: false,
                level_recovered_during_event: Number.isFinite(rawDrawdown) && rawDrawdown < 0
            }
        });
    }

    return events;
}

async function dcpWells(headers) {
    const rows = await fetchJson(`${DCP_BASE}/v2/wells`, headers ? { headers } : {});
    if (!Array.isArray(rows)) return [];

    return rows.map((row) => ({
        source: "DCP",
        site_id: String(row.well_id),
        site_name: String(row.name || row.well_id || "Unknown Borehole")
    }));
}

async function dcpSeries(headers, wellId, parameter, startIso, endIso) {
    const url = new URL(`${DCP_BASE}/v2/wells/${wellId}/timeseries`);
    const fmtIso = (iso) => iso.includes(".") ? `${iso.split(".")[0]}Z` : iso;
    url.searchParams.set("parameter", parameter);
    url.searchParams.set("from", fmtIso(startIso));
    url.searchParams.set("to", fmtIso(endIso));

    const payload = await fetchJson(url.toString(), headers ? { headers } : {});
    const values = payload.time_series?.values || [];

    return values
        .filter((entry) => entry.value !== undefined && entry.value !== null)
        .map((entry) => ({
            code: parameter,
            value: Number(entry.value),
            timestamp_ms: new Date(entry.time).getTime()
        }));
}

function updateSummary(summary, boreholeCount, cached = false) {
    const dcpCount = allEventRows.filter((event) => event.source === "DCP").length;
    const sslCount = allEventRows.filter((event) => event.source === "SonSetLink").length;
    el("summaryBoreholes").textContent = boreholeCount || 0;
    el("summaryEvents").textContent = summary.total_events || 0;
    if (el("summaryDcp")) el("summaryDcp").textContent = dcpCount;
    if (el("summarySsl")) el("summarySsl").textContent = sslCount;
    el("summaryValid").textContent = summary.valid_events || 0;
    el("summaryAvgQs").textContent = Number.isFinite(summary.average_specific_capacity)
        ? summary.average_specific_capacity.toFixed(2)
        : "—";
    el("summaryFlagged").textContent = summary.flagged_events || 0;
    const selectedSource = getSelectedSource();
    const filterNote = selectedSource ? ` Filtered to ${selectedSource}.` : "";
    el("cacheStatus").textContent = (cached
        ? "Showing cached analysis from local storage."
        : "Showing fresh analysis.") + filterNote;
}

function formatDateTime(ts) {
    return ts ? new Date(ts).toLocaleString() : "—";
}

function formatFlags(flags) {
    const labelMap = {
        approximate_daily_event: "daily screening report",
        insufficient_water_level: "insufficient water level",
        invalid_specific_capacity: "invalid specific capacity",
        flow_anomaly: "flow anomaly",
        timestamp_gap: "timestamp gap",
        ongoing_event: "ongoing event",
        level_recovered_during_event: "level recovered during event"
    };
    const active = Object.entries(flags || {})
        .filter(([, value]) => !!value)
        .map(([key]) => labelMap[key] || key.replace(/_/g, " "));
    return active.length ? active.join(", ") : "OK";
}

function renderRows(events) {
    const tbody = el("reportTable").querySelector("tbody");
    tbody.innerHTML = "";

    if (!events.length) {
        const tr = document.createElement("tr");
        tr.innerHTML = `<td colspan="12" style="text-align:center;color:#666;">No report rows detected for the selected period and source filter.</td>`;
        tbody.appendChild(tr);
        return;
    }

    const ordered = [...events].sort((a, b) => b.event_start_ms - a.event_start_ms);
    for (const event of ordered) {
        const tr = document.createElement("tr");
        const meaningfulIssues = Object.entries(event.flags || {}).some(([key, value]) => value && key !== "approximate_daily_event");
        const isScreening = !!event.flags?.approximate_daily_event;
        const status = isScreening ? "Screening" : (event.flags.invalid_specific_capacity ? "Invalid" : (meaningfulIssues ? "Review" : "Valid"));
        tr.className = status === "Invalid"
            ? "status-invalid"
            : (status === "Review" ? "status-review" : (status === "Screening" ? "status-screening" : "status-valid"));
        tr.innerHTML = `
            <td>${event.well_name || event.well_id}<br><small>${event.source || ""}</small></td>
            <td>${formatDateTime(event.event_start_ms)}<br><small>to ${formatDateTime(event.event_end_ms)}</small></td>
            <td>${event.duration_hours ?? "—"}</td>
            <td>${event.total_volume_m3 ?? "—"}</td>
            <td>${event.final_flow_m3h ?? "—"}</td>
            <td>${event.start_level_m ?? "—"}</td>
            <td>${event.end_level_m ?? "—"}</td>
            <td>${event.drawdown_m ?? "—"}</td>
            <td>${event.max_drawdown_m ?? "—"}</td>
            <td>${event.specific_capacity_m3h_per_m ?? "—"}</td>
            <td>${event.quality_score ?? 0}</td>
            <td><strong>${status}</strong><br><small>${formatFlags(event.flags)}</small></td>
        `;
        tbody.appendChild(tr);
    }
}

function renderGroupedSummary(events) {
    const tbody = el("boreholeSummaryTable").querySelector("tbody");
    tbody.innerHTML = "";

    const rows = buildBoreholeSummaries(events);
    const sourceByWell = new Map(events.map((event) => [event.well_id, event.source]));
    if (!rows.length) {
        const tr = document.createElement("tr");
        tr.innerHTML = `<td colspan="8" style="text-align:center;color:#666;">No site summaries available yet.</td>`;
        tbody.appendChild(tr);
        return rows;
    }

    for (const row of rows) {
        const tr = document.createElement("tr");
        tr.innerHTML = `
            <td><button class="summary-link" data-well-id="${row.well_id}">${row.well_name}</button><br><small>${sourceByWell.get(row.well_id) || ""}</small></td>
            <td>${row.event_count}</td>
            <td>${row.valid_event_count}</td>
            <td>${row.total_volume_m3 ?? "—"}</td>
            <td>${row.avg_specific_capacity ?? "—"}</td>
            <td>${row.avg_drawdown_m ?? "—"}</td>
            <td>${row.max_drawdown_m ?? "—"}</td>
            <td>${row.flagged_event_count}</td>
        `;
        tbody.appendChild(tr);
    }

    tbody.querySelectorAll(".summary-link").forEach((button) => {
        button.addEventListener("click", () => {
            el("boreholeFilter").value = button.dataset.wellId;
            refreshView();
        });
    });

    return rows;
}

function populateBoreholeFilter(events) {
    const select = el("boreholeFilter");
    const rows = buildBoreholeSummaries(events);
    const current = select.value;

    select.innerHTML = `<option value="">All sites</option>`;
    for (const row of rows) {
        const option = document.createElement("option");
        option.value = row.well_id;
        option.textContent = row.well_name;
        select.appendChild(option);
    }

    if (rows.some((row) => row.well_id === current)) {
        select.value = current;
    } else {
        select.value = "";
    }
}

function renderCharts(events) {
    const summaryRows = buildBoreholeSummaries(events);
    const barTarget = el("qsBarChart");
    const trendTarget = el("eventTrendChart");
    const selectedWellId = el("boreholeFilter").value;
    const selectedEvents = selectedWellId ? events.filter((event) => event.well_id === selectedWellId) : events;
    const orderedEvents = [...selectedEvents].sort((a, b) => a.event_start_ms - b.event_start_ms);

    if (!window.Plotly) {
        barTarget.innerHTML = "Charting library unavailable.";
        trendTarget.innerHTML = "Charting library unavailable.";
        return;
    }

    if (!summaryRows.length) {
        Plotly.purge(barTarget);
        Plotly.purge(trendTarget);
        barTarget.innerHTML = "No chart data yet.";
        trendTarget.innerHTML = "No chart data yet.";
        return;
    }

    const validSummary = summaryRows.filter((row) => Number.isFinite(row.avg_specific_capacity));
    if (validSummary.length) {
        Plotly.newPlot(barTarget, [{
            type: "bar",
            x: validSummary.map((row) => row.well_name),
            y: validSummary.map((row) => row.avg_specific_capacity),
            marker: { color: "#2563eb" },
            hovertemplate: "%{x}<br>Average Q/S: %{y:.2f}<extra></extra>"
        }], {
            title: "Average specific capacity by site",
            margin: { t: 40, r: 20, b: 120, l: 60 },
            xaxis: { tickangle: -35 },
            yaxis: { title: "Q/S" }
        }, { responsive: true, displayModeBar: false });
    } else {
        Plotly.purge(barTarget);
        barTarget.innerHTML = "No valid Q/S values are available for the selected period.";
    }

    if (!orderedEvents.length) {
        Plotly.purge(trendTarget);
        trendTarget.innerHTML = "No event trend data yet.";
        return;
    }

    const wellLabel = selectedWellId
        ? (orderedEvents[0]?.well_name || selectedWellId)
        : "All sites";

    Plotly.newPlot(trendTarget, [
        {
            type: "scatter",
            mode: "lines+markers",
            name: "Specific Capacity",
            x: orderedEvents.map((event) => new Date(event.event_start_ms)),
            y: orderedEvents.map((event) => event.specific_capacity_m3h_per_m),
            marker: { color: "#0f766e", size: 8 },
            line: { color: "#0f766e" },
            connectgaps: false,
            hovertemplate: "%{x}<br>Q/S: %{y:.2f}<extra></extra>"
        },
        {
            type: "scatter",
            mode: "lines+markers",
            name: "Max Drawdown",
            x: orderedEvents.map((event) => new Date(event.event_start_ms)),
            y: orderedEvents.map((event) => event.max_drawdown_m),
            yaxis: "y2",
            marker: { color: "#f59e0b", size: 7 },
            line: { color: "#f59e0b", dash: "dot" },
            connectgaps: false,
            hovertemplate: "%{x}<br>Max drawdown: %{y:.2f} m<extra></extra>"
        }
    ], {
        title: `Event trend for ${wellLabel}`,
        margin: { t: 40, r: 60, b: 50, l: 60 },
        xaxis: { title: "Event date" },
        yaxis: { title: "Specific Capacity (m³/h/m)" },
        yaxis2: {
            title: "Max Drawdown (m)",
            overlaying: "y",
            side: "right"
        },
        legend: { orientation: "h" }
    }, { responsive: true, displayModeBar: false });
}

function downloadText(content, filename, type) {
    const blob = new Blob([content], { type });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

function exportCsv() {
    if (!allEventRows.length) {
        alert("No pumping-event rows are available yet.");
        return;
    }
    downloadText(buildEventCsv(allEventRows), "specific_capacity_events.csv", "text/csv;charset=utf-8");
}

function exportJson() {
    if (!allEventRows.length) {
        alert("No pumping-event rows are available yet.");
        return;
    }

    const payload = {
        exported_at: new Date().toISOString(),
        timezone: "UTC+2 (Africa/Blantyre)",
        date_range: lastDateRange,
        summary: buildEventSummary(allEventRows),
        events: allEventRows
    };

    downloadText(JSON.stringify(payload, null, 2), "specific_capacity_events.json", "application/json;charset=utf-8");
}

async function analyzeWell(well, headers, startIso, endIso) {
    const [flowPoints, levelPoints] = await Promise.all([
        dcpSeries(headers, well.site_id, "flow", startIso, endIso),
        dcpSeries(headers, well.site_id, "water_level_above_pump", startIso, endIso)
    ]);

    return detectPumpingEvents(flowPoints, levelPoints, {
        wellId: well.site_id,
        wellName: well.site_name,
        source: "DCP"
    });
}

async function analyzeSslSite(site, startIso, endIso) {
    const fmt = (value) => new Date(value).toISOString().replace("T", " ").slice(0, 19);
    const res = await sslSeries(site.site_id, site.serial, fmt(startIso), fmt(endIso));
    return buildSslEvents(site, res.rows || []);
}

async function generateReport(forceRefresh = false) {
    if (!detectPumpingEvents || !buildEventSummary || !buildBoreholeSummaries || !buildEventCsv) {
        alert("The event analysis module failed to load.");
        return;
    }

    const btn = el("btnGenerate");
    btn.disabled = true;
    el("btnExport").disabled = true;
    el("btnExportJson").disabled = true;
    logEl.innerHTML = "";

    const startStr = el("startDate").value;
    const endStr = el("endDate").value;
    if (!startStr || !endStr) {
        alert("Please select a start and end date.");
        btn.disabled = false;
        return;
    }

    lastDateRange = { start: startStr, end: endStr };

    if (!forceRefresh) {
        const cached = loadCachedEvents(startStr, endStr);
        if (cached) {
            allEventRows = cached.events || [];
            populateBoreholeFilter(allEventRows.filter((event) => !getSelectedSource() || event.source === getSelectedSource()));
            refreshView(new Set(allEventRows.map((e) => e.well_id)).size, true);
            const dcpCount = allEventRows.filter((event) => event.source === "DCP").length;
            const sslCount = allEventRows.filter((event) => event.source === "SonSetLink").length;
            log(`Loaded ${allEventRows.length} cached report rows (${dcpCount} DCP, ${sslCount} SonSetLink).`);
            el("btnExport").disabled = allEventRows.length === 0;
            el("btnExportJson").disabled = allEventRows.length === 0;
            btn.disabled = false;
            return;
        }
    }

    const startIso = new Date(startStr).toISOString();
    const endDate = new Date(endStr);
    endDate.setDate(endDate.getDate() + 1);
    const endIso = endDate.toISOString();

    const { dcpToken, sslUser, sslPass } = getKeys();
    const hasLocalSslCreds = !!(sslUser && sslPass);
    if (!IS_LIVE && !dcpToken && !hasLocalSslCreds) {
        alert("Add a DCP API key or SonSetLink credentials in the main dashboard settings before running this report locally.");
        btn.disabled = false;
        return;
    }

    try {
        log("Fetching monitored DCP and SonSetLink sites...");
        const headers = dcpToken ? { "X-Api-Key": dcpToken, "Accept": "application/json" } : { "Accept": "application/json" };
        const [dcpSites, sslSiteList] = await Promise.all([
            (IS_LIVE || dcpToken) ? dcpWells(headers) : Promise.resolve([]),
            (IS_LIVE || hasLocalSslCreds) ? sslSites() : Promise.resolve([])
        ]);
        const monitoredSites = [...dcpSites, ...sslSiteList];
        log(`Found ${dcpSites.length} DCP boreholes and ${sslSiteList.length} SonSetLink sites. Analysing events...`);

        allEventRows = [];
        const chunkSize = 4;
        for (let i = 0; i < monitoredSites.length; i += chunkSize) {
            const chunk = monitoredSites.slice(i, i + chunkSize);
            const batch = await Promise.all(chunk.map(async (site) => {
                try {
                    return site.source === "SonSetLink"
                        ? await analyzeSslSite(site, startIso, endIso)
                        : await analyzeWell(site, headers, startIso, endIso);
                } catch (error) {
                    log(`Skipped ${site.site_name}: ${error.message}`);
                    return [];
                }
            }));
            batch.forEach((events) => allEventRows.push(...events));
            log(`Processed ${Math.min(i + chunkSize, monitoredSites.length)} of ${monitoredSites.length} sites.`);
        }

        const summary = buildEventSummary(allEventRows);
        populateBoreholeFilter(allEventRows.filter((event) => !getSelectedSource() || event.source === getSelectedSource()));
        refreshView(monitoredSites.length, false);
        saveCachedEvents(startStr, endStr, allEventRows, summary);
        const dcpCount = allEventRows.filter((event) => event.source === "DCP").length;
        const sslCount = allEventRows.filter((event) => event.source === "SonSetLink").length;
        log(`Finished. Detected ${summary.total_events} report rows across both data sources (${dcpCount} DCP, ${sslCount} SonSetLink).`);

        el("btnExport").disabled = allEventRows.length === 0;
        el("btnExportJson").disabled = allEventRows.length === 0;
    } catch (error) {
        log(`Report failed: ${error.message}`);
        alert(`Report failed: ${error.message}`);
    } finally {
        btn.disabled = false;
    }
}

function refreshView(totalSiteCount = new Set(allEventRows.map((event) => event.well_id)).size, cached = false) {
    const displayedEvents = getDisplayedEvents();
    renderRows(displayedEvents);
    renderGroupedSummary(displayedEvents);
    renderCharts(displayedEvents);
    updateSummary(buildEventSummary(allEventRows), totalSiteCount, cached);
}

window.addEventListener("DOMContentLoaded", () => {
    const today = new Date();
    const lastMonth = new Date();
    lastMonth.setDate(today.getDate() - 30);

    el("startDate").value = lastMonth.toISOString().split("T")[0];
    el("endDate").value = today.toISOString().split("T")[0];
    updateSummary({ total_events: 0, valid_events: 0, average_specific_capacity: null, flagged_events: 0 }, 0, false);

    el("btnGenerate").addEventListener("click", () => generateReport(false));
    el("btnRefresh").addEventListener("click", () => generateReport(true));
    el("btnExport").addEventListener("click", exportCsv);
    el("btnExportJson").addEventListener("click", exportJson);
    el("sourceFilter").addEventListener("change", () => {
        populateBoreholeFilter(allEventRows.filter((event) => !getSelectedSource() || event.source === getSelectedSource()));
        refreshView();
    });
    el("boreholeFilter").addEventListener("change", () => refreshView());
    populateBoreholeFilter([]);
    renderGroupedSummary([]);
    renderCharts([]);

    if (!getKeys().dcpToken && !IS_LIVE) {
        log("No local DCP key detected yet. Add one from the main dashboard settings if needed.");
    }
});
