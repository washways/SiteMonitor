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
const LOCAL_TEST_DCP_TOKEN = "0rlv0amn04vfojogn1523w43ujgk0k";
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

function log(msg) {
    if (!logEl) return;
    logEl.style.display = "block";
    const line = document.createElement("div");
    line.textContent = `[${new Date().toLocaleTimeString()}] ${msg}`;
    logEl.appendChild(line);
    logEl.scrollTop = logEl.scrollHeight;
}

function getKeys() {
    const savedToken = (localStorage.getItem("dcp_token") || "").trim();
    return {
        dcpToken: savedToken || (IS_LOCAL ? LOCAL_TEST_DCP_TOKEN : "")
    };
}

function cacheKey(startStr, endStr) {
    return `siteMonitor_specific_capacity_${startStr}_${endStr}`;
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

async function dcpWells(headers) {
    const opts = headers ? { headers } : {};
    const rows = await fetchJson(`${DCP_BASE}/v2/wells`, opts);
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
    el("summaryBoreholes").textContent = boreholeCount || 0;
    el("summaryEvents").textContent = summary.total_events || 0;
    el("summaryValid").textContent = summary.valid_events || 0;
    el("summaryAvgQs").textContent = Number.isFinite(summary.average_specific_capacity)
        ? summary.average_specific_capacity.toFixed(2)
        : "—";
    el("summaryFlagged").textContent = summary.flagged_events || 0;
    el("cacheStatus").textContent = cached
        ? "Showing cached analysis from local storage."
        : "Showing fresh analysis.";
}

function formatDateTime(ts) {
    return ts ? new Date(ts).toLocaleString() : "—";
}

function formatFlags(flags) {
    const active = Object.entries(flags || {})
        .filter(([, value]) => !!value)
        .map(([key]) => key.replace(/_/g, " "));
    return active.length ? active.join(", ") : "OK";
}

function renderRows(events) {
    const tbody = el("reportTable").querySelector("tbody");
    tbody.innerHTML = "";

    if (!events.length) {
        const tr = document.createElement("tr");
        tr.innerHTML = `<td colspan="12" style="text-align:center;color:#666;">No pumping events detected for the selected period.</td>`;
        tbody.appendChild(tr);
        return;
    }

    const ordered = [...events].sort((a, b) => b.event_start_ms - a.event_start_ms);
    for (const event of ordered) {
        const tr = document.createElement("tr");
        const hasIssues = Object.values(event.flags || {}).some(Boolean);
        const status = event.flags.invalid_specific_capacity ? "Invalid" : (hasIssues ? "Review" : "Valid");
        tr.className = status === "Invalid" ? "status-invalid" : (status === "Review" ? "status-review" : "status-valid");
        tr.innerHTML = `
            <td>${event.well_name || event.well_id}</td>
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
    if (!rows.length) {
        const tr = document.createElement("tr");
        tr.innerHTML = `<td colspan="8" style="text-align:center;color:#666;">No borehole summaries available yet.</td>`;
        tbody.appendChild(tr);
        return rows;
    }

    for (const row of rows) {
        const tr = document.createElement("tr");
        tr.innerHTML = `
            <td><button class="summary-link" data-well-id="${row.well_id}">${row.well_name}</button></td>
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
            renderCharts(allEventRows);
        });
    });

    return rows;
}

function populateBoreholeFilter(events) {
    const select = el("boreholeFilter");
    const rows = buildBoreholeSummaries(events);
    const current = select.value;

    select.innerHTML = `<option value="">All boreholes</option>`;
    for (const row of rows) {
        const option = document.createElement("option");
        option.value = row.well_id;
        option.textContent = row.well_name;
        select.appendChild(option);
    }

    if (rows.some((row) => row.well_id === current)) {
        select.value = current;
    } else if (rows.length) {
        select.value = rows[0].well_id;
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
            title: "Average specific capacity by borehole",
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
        : "All boreholes";

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
            renderRows(allEventRows);
            renderGroupedSummary(allEventRows);
            populateBoreholeFilter(allEventRows);
            renderCharts(allEventRows);
            updateSummary(cached.summary || buildEventSummary(allEventRows), new Set(allEventRows.map((e) => e.well_id)).size, true);
            log(`Loaded ${allEventRows.length} cached pumping events.`);
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

    const { dcpToken } = getKeys();
    if (!IS_LIVE && !dcpToken) {
        alert("Add a DCP API key in the main dashboard settings before running this report locally.");
        btn.disabled = false;
        return;
    }

    try {
        log("Fetching monitored DCP boreholes...");
        const headers = dcpToken ? { "X-Api-Key": dcpToken, "Accept": "application/json" } : { "Accept": "application/json" };
        const wells = await dcpWells(headers);
        log(`Found ${wells.length} boreholes. Analysing pumping events...`);

        allEventRows = [];
        const chunkSize = 4;
        for (let i = 0; i < wells.length; i += chunkSize) {
            const chunk = wells.slice(i, i + chunkSize);
            const batch = await Promise.all(chunk.map(async (well) => {
                try {
                    return await analyzeWell(well, headers, startIso, endIso);
                } catch (error) {
                    log(`Skipped ${well.site_name}: ${error.message}`);
                    return [];
                }
            }));
            batch.forEach((events) => allEventRows.push(...events));
            log(`Processed ${Math.min(i + chunkSize, wells.length)} of ${wells.length} boreholes.`);
        }

        const summary = buildEventSummary(allEventRows);
        renderRows(allEventRows);
        renderGroupedSummary(allEventRows);
        populateBoreholeFilter(allEventRows);
        renderCharts(allEventRows);
        updateSummary(summary, wells.length, false);
        saveCachedEvents(startStr, endStr, allEventRows, summary);
        log(`Finished. Detected ${summary.total_events} pumping events.`);

        el("btnExport").disabled = allEventRows.length === 0;
        el("btnExportJson").disabled = allEventRows.length === 0;
    } catch (error) {
        log(`Report failed: ${error.message}`);
        alert(`Report failed: ${error.message}`);
    } finally {
        btn.disabled = false;
    }
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
    el("boreholeFilter").addEventListener("change", () => renderCharts(allEventRows));
    populateBoreholeFilter([]);
    renderGroupedSummary([]);
    renderCharts([]);

    if (!getKeys().dcpToken && !IS_LIVE) {
        log("No local DCP key detected yet. Add one from the main dashboard settings if needed.");
    }
});
