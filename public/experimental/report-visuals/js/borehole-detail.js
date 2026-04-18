(function () {
    const Utils = window.SiteMonitorExperimentalVizUtils;
    const Loader = window.SiteMonitorExperimentalVizLoader;
    const DEFAULT_REPORT_URL = "examples/sample-analytics-report.json";
    let reportIndex = null;

    const el = (id) => document.getElementById(id);

    function setStatus(message, isError = false) {
        Loader.setStatus(el("pageStatus"), message, isError);
    }

    function currentParams() {
        return new URLSearchParams(window.location.search);
    }

    function getSelectedKey() {
        return el("filterBorehole")?.value || currentParams().get("borehole") || "";
    }

    function getRowBySelection(rows = []) {
        const selected = getSelectedKey();
        const provider = currentParams().get("provider") || "";
        return rows.find((row) => (row.borehole_id === selected || Utils.boreholeKey(row) === selected) && (!provider || row.provider === provider)) || rows[0] || null;
    }

    function populateBoreholes(index) {
        const target = el("filterBorehole");
        if (!target) return;
        const rows = index.report.health_summary_table || [];
        target.innerHTML = rows.map((row) => `<option value="${Utils.escapeHtml(row.borehole_id)}">${Utils.escapeHtml(row.display_name || row.borehole_id)}</option>`).join("");
        const selected = currentParams().get("borehole");
        if (selected) target.value = selected;
    }

    function renderHeader(row, dailyRows = []) {
        const latestFlags = Utils.unique(dailyRows.flatMap((item) => item.daily_quality_flags || [])).slice(0, 12);
        el("detailHeader").innerHTML = `
            <div class="detail-header">
                <div class="kpi-card">
                    <div class="label">Borehole</div>
                    <div class="value">${Utils.escapeHtml(row.display_name || row.borehole_id)}</div>
                    <div class="viz-note">${Utils.escapeHtml(row.provider || "Unknown provider")}</div>
                </div>
                <div class="kpi-card"><div class="label">Status</div><div class="value">${Utils.escapeHtml(row.status_label || row.status_category || "—")}</div></div>
                <div class="kpi-card"><div class="label">Readiness</div><div class="value">${Utils.escapeHtml(row.analysis_readiness_tier || "—")}</div></div>
                <div class="kpi-card"><div class="label">Maintenance priority</div><div class="value">${Utils.escapeHtml(row.maintenance_priority_label || "—")}</div></div>
            </div>
            <div class="callout" style="margin-top:0.75rem;">
                <p><strong>Interpretation:</strong> ${Utils.escapeHtml(row.concise_interpretation || "No interpretation available.")}</p>
                <p><strong>Recommended action:</strong> ${Utils.escapeHtml(row.recommended_action || "No action suggested.")}</p>
                <p><strong>Transparent reasons:</strong> ${Utils.escapeHtml((row.transparent_reasons || []).join(", ") || "—")}</p>
                <p><strong>Observed days in current window:</strong> ${dailyRows.length}</p>
                <p><strong>Recent quality flags:</strong> ${Utils.escapeHtml(latestFlags.join(", ") || "—")}</p>
            </div>`;
    }

    function renderVolumeChart(dailyRows) {
        Plotly.newPlot(el("volumeChart"), [{
            type: "bar",
            x: dailyRows.map((row) => row.date),
            y: dailyRows.map((row) => row.daily_pumped_volume_m3),
            marker: { color: dailyRows.map((row) => (row.downtime_indicator ? "#94a3b8" : "#2563eb")) },
            hovertemplate: "%{x}<br>Daily pumped volume: %{y}<extra></extra>"
        }], {
            title: "Daily pumped volume",
            margin: { t: 45, l: 50, r: 20, b: 45 },
            yaxis: { title: "Volume" }
        }, { responsive: true, displayModeBar: false });
    }

    function renderGroundwaterChart(dailyRows) {
        Plotly.newPlot(el("groundwaterChart"), [
            {
                type: "scatter",
                mode: "lines+markers",
                name: "Daily minimum groundwater level",
                x: dailyRows.map((row) => row.date),
                y: dailyRows.map((row) => row.daily_min_groundwater_level_m),
                connectgaps: false,
                line: { color: "#0f766e" }
            },
            {
                type: "scatter",
                mode: "lines+markers",
                name: "Daily maximum groundwater level",
                x: dailyRows.map((row) => row.date),
                y: dailyRows.map((row) => row.daily_max_groundwater_level_m),
                connectgaps: false,
                line: { color: "#0284c7" }
            },
            {
                type: "scatter",
                mode: "lines+markers",
                name: "Estimated resting level",
                x: dailyRows.map((row) => row.date),
                y: dailyRows.map((row) => row.estimated_daily_resting_level_m),
                connectgaps: false,
                line: { color: "#f59e0b", dash: "dot" }
            }
        ], {
            title: "Groundwater level traces including zero and uncertain values",
            margin: { t: 45, l: 60, r: 20, b: 45 },
            yaxis: { title: "Level" }
        }, { responsive: true, displayModeBar: false });
    }

    function renderPerformanceChart(dailyRows) {
        const pumpingDays = dailyRows.filter((row) => (Utils.safeNumber(row.event_count) || 0) > 0 || Utils.safeNumber(row.maximum_drawdown_m) !== null);
        Plotly.newPlot(el("performanceChart"), [
            {
                type: "bar",
                name: "Maximum drawdown",
                x: pumpingDays.map((row) => row.date),
                y: pumpingDays.map((row) => row.maximum_drawdown_m),
                marker: { color: "#dc2626" },
                yaxis: "y1"
            },
            {
                type: "scatter",
                mode: "lines+markers",
                name: "Median valid specific capacity",
                x: pumpingDays.map((row) => row.date),
                y: pumpingDays.map((row) => row.median_specific_capacity_m3h_per_m),
                connectgaps: false,
                marker: { color: "#2563eb", size: 9 },
                line: { color: "#2563eb" },
                yaxis: "y2"
            },
            {
                type: "scatter",
                mode: "markers",
                name: "Invalid or missing Q/S",
                x: pumpingDays.filter((row) => Utils.safeNumber(row.median_specific_capacity_m3h_per_m) === null).map((row) => row.date),
                y: pumpingDays.filter((row) => Utils.safeNumber(row.median_specific_capacity_m3h_per_m) === null).map(() => 0),
                marker: { color: "#7c3aed", symbol: "x", size: 10 },
                yaxis: "y2",
                hovertemplate: "%{x}<br>Specific capacity was null or invalid in the report<extra></extra>"
            }
        ], {
            title: "Drawdown and specific capacity on pumping days only",
            margin: { t: 45, l: 60, r: 60, b: 45 },
            yaxis: { title: "Drawdown", zeroline: true },
            yaxis2: { title: "Specific capacity", overlaying: "y", side: "right", zeroline: true }
        }, { responsive: true, displayModeBar: false });
    }

    function renderRollingChart(rollingRows) {
        Plotly.newPlot(el("rollingChart"), [
            {
                type: "scatter",
                mode: "lines+markers",
                name: "7 day volume",
                x: rollingRows.map((row) => row.date),
                y: rollingRows.map((row) => row.rolling_7d_volume_m3),
                line: { color: "#2563eb" },
                yaxis: "y1"
            },
            {
                type: "scatter",
                mode: "lines+markers",
                name: "30 day Q/S median",
                x: rollingRows.map((row) => row.date),
                y: rollingRows.map((row) => row.rolling_30d_specific_capacity_median),
                connectgaps: false,
                line: { color: "#0f766e" },
                yaxis: "y2"
            },
            {
                type: "scatter",
                mode: "lines+markers",
                name: "30 day resting-level trend",
                x: rollingRows.map((row) => row.date),
                y: rollingRows.map((row) => row.resting_level_trend_30d_m_per_day),
                connectgaps: false,
                line: { color: "#f59e0b", dash: "dot" },
                yaxis: "y2"
            }
        ], {
            title: "Rolling trend view",
            margin: { t: 45, l: 60, r: 60, b: 45 },
            yaxis: { title: "Volume" },
            yaxis2: { title: "Q/S and trend", overlaying: "y", side: "right" }
        }, { responsive: true, displayModeBar: false });
    }

    function renderQualityStrip(dailyRows) {
        const points = dailyRows.map((row) => ({
            date: row.date,
            count: (row.daily_quality_flags || []).length,
            flags: (row.daily_quality_flags || []).join(", ") || "No flags"
        }));
        Plotly.newPlot(el("qualityChart"), [{
            type: "scatter",
            mode: "markers",
            x: points.map((point) => point.date),
            y: points.map(() => 1),
            text: points.map((point) => point.flags),
            marker: {
                size: 16,
                color: points.map((point) => point.count),
                colorscale: "YlOrRd",
                showscale: true,
                colorbar: { title: "Flag count" }
            },
            hovertemplate: "%{x}<br>%{text}<extra></extra>"
        }], {
            title: "Quality-flag strip across time",
            margin: { t: 45, l: 30, r: 30, b: 45 },
            yaxis: { visible: false }
        }, { responsive: true, displayModeBar: false });
    }

    function renderReasons(row, dailyRows) {
        const recurring = Utils.unique(dailyRows.flatMap((item) => item.daily_quality_flags || []));
        el("reasonPanel").innerHTML = `
            <div class="kpi-card">
                <h3>Transparent reasons</h3>
                <div class="quality-list">${(row.transparent_reasons || []).map((item) => `<span class="pill">${Utils.escapeHtml(item)}</span>`).join("") || '<span class="muted">No rule reasons available.</span>'}</div>
            </div>
            <div class="kpi-card">
                <h3>Observed quality flags</h3>
                <div class="quality-list">${recurring.map((item) => `<span class="pill">${Utils.escapeHtml(item)}</span>`).join("") || '<span class="muted">No daily quality flags in the current window.</span>'}</div>
            </div>`;
    }

    function renderAll() {
        const filtered = Loader.applyFilters(reportIndex, Loader.getFilterValues(document));
        const row = getRowBySelection(filtered.healthRows.length ? filtered.healthRows : reportIndex.report.health_summary_table);
        if (!row) {
            setStatus("No borehole is available in the loaded report.", true);
            return;
        }
        const key = Utils.boreholeKey(row);
        const dailyRows = Utils.sortByDate((filtered.dailyRows || []).filter((item) => Utils.boreholeKey(item) === key));
        const rollingRows = Utils.sortByDate((filtered.rollingRows || []).filter((item) => Utils.boreholeKey(item) === key));
        renderHeader(row, dailyRows);
        renderVolumeChart(dailyRows);
        renderGroundwaterChart(dailyRows);
        renderPerformanceChart(dailyRows);
        renderRollingChart(rollingRows);
        renderQualityStrip(dailyRows);
        renderReasons(row, dailyRows);
        setStatus(`Rendered detail view for ${row.display_name || row.borehole_id}.`);
    }

    async function init() {
        try {
            reportIndex = await Loader.loadReport({ defaultUrl: DEFAULT_REPORT_URL, statusTarget: el("pageStatus") });
            populateBoreholes(reportIndex);
            renderAll();
        } catch (error) {
            setStatus(error.message, true);
        }

        el("reportFile")?.addEventListener("change", async (event) => {
            const file = event.target.files?.[0];
            if (!file) return;
            reportIndex = await Loader.readUploadedFile(file);
            populateBoreholes(reportIndex);
            renderAll();
        });

        el("loadReportUrl")?.addEventListener("click", async () => {
            reportIndex = await Loader.loadReport({ url: el("reportUrl")?.value || DEFAULT_REPORT_URL, statusTarget: el("pageStatus") });
            populateBoreholes(reportIndex);
            renderAll();
        });

        document.querySelectorAll(".filters-grid input, .filters-grid select").forEach((node) => node.addEventListener("change", renderAll));
    }

    window.addEventListener("DOMContentLoaded", init);
})();
