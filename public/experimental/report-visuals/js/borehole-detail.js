(function () {
    const Utils = window.SiteMonitorExperimentalVizUtils;
    const Loader = window.SiteMonitorExperimentalVizLoader;
    const DEFAULT_REPORT_URL = "";
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

    function syncQsControls(method) {
        const selectedMethod = method || reportIndex?.report?.qs_method_selected || el("analysisQsMethod")?.value || "event_median_proxy";
        if (el("analysisQsMethod")) el("analysisQsMethod").value = selectedMethod;
        if (el("detailQsMethod")) el("detailQsMethod").value = selectedMethod;
    }

    function buildSharedAxisLayout(dailyRows = [], rollingRows = []) {
        return Utils.buildDateAxis([...(dailyRows || []), ...(rollingRows || [])]);
    }

    function populateBoreholes(index, preferredSelection = "") {
        const target = el("filterBorehole");
        if (!target) return;
        const rows = index.report.health_summary_table || [];
        target.innerHTML = rows.map((row) => `<option value="${Utils.escapeHtml(row.borehole_id)}">${Utils.escapeHtml(row.display_name || row.borehole_id)}</option>`).join("");
        const selected = preferredSelection || target.value || currentParams().get("borehole");
        if (selected) target.value = selected;

        syncQsControls(index.report.qs_method_selected);
    }

    function renderHeader(row, dailyRows = []) {
        const latestFlags = Utils.unique(dailyRows.flatMap((item) => item.daily_quality_flags || [])).slice(0, 12);
        const summaryItems = [
            ["Provider", row.provider || "Unknown provider"],
            ["Status", row.status_label || row.status_category || "—"],
            ["Readiness", row.analysis_readiness_tier || "—"],
            ["Maintenance priority", row.maintenance_priority_label || "—"],
            ["Q/S mode", String(el("detailQsMethod")?.value || reportIndex?.report?.qs_method_selected || row.qs_method_used || "event_median_proxy").replace(/_/g, " ")],
            ["Flow profile", String(row.flow_behavior_profile || "—").replace(/_/g, " ")],
            ["Latest resting level", Utils.formatNumber(row.latest_resting_level_m, 2)],
            ["Latest dynamic level", Utils.formatNumber(row.latest_dynamic_level_m, 2)],
            ["Evidence confidence", row.evidence_confidence_label || "—"],
            ["Evidence lane", row.evidence_lane_label || "—"],
            ["Field check focus", row.field_check_focus || "—"]
        ];

        el("detailHeader").innerHTML = `
            <div class="summary-list-card">
                <h3>${Utils.escapeHtml(row.display_name || row.borehole_id)}</h3>
                <dl class="summary-list">
                    ${summaryItems.map(([label, value]) => `
                        <div class="summary-item">
                            <dt>${Utils.escapeHtml(String(label))}</dt>
                            <dd>${Utils.escapeHtml(String(value))}</dd>
                        </div>`).join("")}
                </dl>
            </div>
            <div class="callout" style="margin-top:0.75rem;">
                <p><strong>Interpretation:</strong> ${Utils.escapeHtml(row.concise_interpretation || "No interpretation available.")}</p>
                <p><strong>Recommended action:</strong> ${Utils.escapeHtml(row.recommended_action || "No action suggested.")}</p>
                <p><strong>Operational bucket:</strong> ${Utils.escapeHtml(row.operational_bucket || "—")}</p>
                <p><strong>Transparent reasons:</strong> ${Utils.escapeHtml((row.transparent_reasons || []).join(", ") || "—")}</p>
                <p><strong>Observed days in current window:</strong> ${dailyRows.length}</p>
                <p><strong>Possible run-dry candidate share:</strong> ${Utils.formatPercent(row.run_dry_candidate_event_share || 0, 0)}</p>
                <p><strong>Recent quality flags:</strong> ${Utils.escapeHtml(latestFlags.join(", ") || "—")}</p>
            </div>`;
    }

    function renderVolumeChart(dailyRows, dateAxis) {
        Plotly.newPlot(el("volumeChart"), [
            {
                type: "bar",
                name: "Daily pumped volume",
                x: dailyRows.map((row) => row.date),
                y: dailyRows.map((row) => row.daily_pumped_volume_m3),
                customdata: dailyRows.map((row) => [row.daily_max_flow_m3h, row.median_event_flow_m3h, row.event_count]),
                marker: { color: dailyRows.map((row) => (row.downtime_indicator ? "#94a3b8" : "#2563eb")) },
                hovertemplate: "%{x}<br>Daily pumped volume: %{y}<br>Daily max flow: %{customdata[0]}<br>Median event flow: %{customdata[1]}<br>Events: %{customdata[2]}<extra></extra>",
                yaxis: "y1"
            },
            {
                type: "scatter",
                mode: "lines+markers",
                name: "Daily max flow",
                x: dailyRows.map((row) => row.date),
                y: dailyRows.map((row) => row.daily_max_flow_m3h),
                connectgaps: false,
                line: { color: "#0f766e" },
                yaxis: "y2",
                hovertemplate: "%{x}<br>Daily max flow: %{y}<extra></extra>"
            }
        ], {
            title: "Daily pumped volume and flow proxy",
            margin: { t: 45, l: 50, r: 60, b: 45 },
            xaxis: { ...dateAxis },
            yaxis: { title: "Volume" },
            yaxis2: { title: "Flow", overlaying: "y", side: "right" }
        }, { responsive: true, displayModeBar: false });
    }

    function renderGroundwaterChart(dailyRows, dateAxis) {
        Plotly.newPlot(el("groundwaterChart"), [
            {
                type: "scatter",
                mode: "lines+markers",
                name: "Daily maximum level",
                x: dailyRows.map((row) => row.date),
                y: dailyRows.map((row) => row.daily_max_groundwater_level_m),
                connectgaps: false,
                line: { color: "#0284c7" }
            },
            {
                type: "scatter",
                mode: "lines+markers",
                name: "Dynamic level proxy (daily minimum)",
                x: dailyRows.map((row) => row.date),
                y: dailyRows.map((row) => row.daily_min_groundwater_level_m),
                connectgaps: false,
                fill: "tonexty",
                line: { color: "#0f766e" }
            },
            {
                type: "scatter",
                mode: "lines+markers",
                name: "Resting level (static proxy)",
                x: dailyRows.map((row) => row.date),
                y: dailyRows.map((row) => row.estimated_daily_resting_level_m),
                connectgaps: false,
                line: { color: "#f59e0b", dash: "dot" }
            }
        ], {
            title: "Resting (static proxy) and dynamic groundwater level traces",
            margin: { t: 45, l: 60, r: 20, b: 45 },
            xaxis: { ...dateAxis },
            yaxis: { title: "Level" }
        }, { responsive: true, displayModeBar: false });
    }

    function renderPerformanceChart(dailyRows, dateAxis) {
        const pumpingDays = dailyRows.filter((row) => (Utils.safeNumber(row.event_count) || 0) > 0 || Utils.safeNumber(row.maximum_drawdown_m) !== null || Utils.safeNumber(row.daily_max_flow_m3h) !== null);
        Plotly.newPlot(el("performanceChart"), [
            {
                type: "bar",
                name: "Maximum drawdown",
                x: pumpingDays.map((row) => row.date),
                y: pumpingDays.map((row) => row.maximum_drawdown_m),
                customdata: pumpingDays.map((row) => [row.daily_max_flow_m3h, row.median_event_flow_m3h, row.active_qs_method, row.run_dry_candidate_event_count]),
                marker: { color: pumpingDays.map((row) => (row.run_dry_candidate_event_count ? "#ea580c" : "#dc2626")) },
                yaxis: "y1",
                hovertemplate: "%{x}<br>Maximum drawdown: %{y}<br>Daily max flow: %{customdata[0]}<br>Median event flow: %{customdata[1]}<br>Q/S method: %{customdata[2]}<br>Run-dry candidate events: %{customdata[3]}<extra></extra>"
            },
            {
                type: "scatter",
                mode: "lines+markers",
                name: "Selected Q/S",
                x: pumpingDays.map((row) => row.date),
                y: pumpingDays.map((row) => row.median_specific_capacity_m3h_per_m),
                connectgaps: false,
                customdata: pumpingDays.map((row) => [row.daily_max_flow_m3h, row.median_event_flow_m3h, row.active_qs_method]),
                marker: { color: "#2563eb", size: 9 },
                line: { color: "#2563eb" },
                yaxis: "y2",
                hovertemplate: "%{x}<br>Selected Q/S: %{y}<br>Daily max flow: %{customdata[0]}<br>Median event flow: %{customdata[1]}<br>Method: %{customdata[2]}<extra></extra>"
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
            title: "Drawdown and selected Q/S on pumping days",
            margin: { t: 45, l: 60, r: 60, b: 45 },
            xaxis: { ...dateAxis },
            yaxis: { title: "Drawdown", zeroline: true },
            yaxis2: { title: "Specific capacity", overlaying: "y", side: "right", zeroline: true }
        }, { responsive: true, displayModeBar: false });
    }

    function renderRollingChart(rollingRows, dateAxis) {
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
                name: "30 day selected Q/S",
                x: rollingRows.map((row) => row.date),
                y: rollingRows.map((row) => row.rolling_30d_specific_capacity_median),
                connectgaps: false,
                line: { color: "#0f766e" },
                yaxis: "y2"
            },
            {
                type: "scatter",
                mode: "lines+markers",
                name: "30 day stable-tail share",
                x: rollingRows.map((row) => row.date),
                y: rollingRows.map((row) => row.rolling_30d_stable_tail_share),
                connectgaps: false,
                line: { color: "#ea580c", dash: "dot" },
                yaxis: "y2"
            }
        ], {
            title: "Rolling trend view for volume, Q/S support, and stability",
            margin: { t: 45, l: 60, r: 60, b: 45 },
            xaxis: { ...dateAxis },
            yaxis: { title: "Volume" },
            yaxis2: { title: "Q/S and support share", overlaying: "y", side: "right" }
        }, { responsive: true, displayModeBar: false });
    }

    function renderQualityStrip(dailyRows, dateAxis) {
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
            xaxis: { ...dateAxis },
            yaxis: { visible: false }
        }, { responsive: true, displayModeBar: false });
    }

    async function applyDetailQsMethod() {
        if (!reportIndex) return;
        const selectedMethod = el("detailQsMethod")?.value || "event_median_proxy";
        const selectedBorehole = el("filterBorehole")?.value || currentParams().get("borehole") || "";
        if (el("analysisQsMethod")) el("analysisQsMethod").value = selectedMethod;
        setStatus(`Refreshing the shared analysis using ${selectedMethod.replace(/_/g, " ")}...`);
        try {
            reportIndex = await Loader.runLiveAnalysis({ root: document, statusTarget: el("pageStatus") });
            populateBoreholes(reportIndex, selectedBorehole);
            syncQsControls(selectedMethod);
            renderAll();
        } catch (error) {
            setStatus(error.message, true);
        }
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
            </div>
            <div class="kpi-card">
                <h3>Run-dry / intake-limitation cues</h3>
                <p><strong>Flow profile:</strong> ${Utils.escapeHtml(String(row.flow_behavior_profile || "—").replace(/_/g, " "))}</p>
                <p><strong>Possible run-dry candidate share:</strong> ${Utils.formatPercent(row.run_dry_candidate_event_share || 0, 0)}</p>
                <p><strong>Possible intake-limitation share:</strong> ${Utils.formatPercent(row.possible_intake_limitation_event_share || 0, 0)}</p>
            </div>`;
    }

    function getCurrentSelectionData() {
        const filtered = Loader.applyFilters(reportIndex, Loader.getFilterValues(document));
        const row = getRowBySelection(filtered.healthRows.length ? filtered.healthRows : reportIndex.report.health_summary_table);
        if (!row) return { filtered, row: null, dailyRows: [], rollingRows: [] };
        const key = Utils.boreholeKey(row);
        return {
            filtered,
            row,
            dailyRows: Utils.sortByDate((filtered.dailyRows || []).filter((item) => Utils.boreholeKey(item) === key)),
            rollingRows: Utils.sortByDate((filtered.rollingRows || []).filter((item) => Utils.boreholeKey(item) === key))
        };
    }

    function downloadCurrentSelectionCsv() {
        const { row, dailyRows, rollingRows } = getCurrentSelectionData();
        if (!row) {
            setStatus("No borehole is available for export.", true);
            return;
        }
        const exportRows = [
            ...dailyRows.map((item) => ({ series_type: "daily", ...item })),
            ...rollingRows.map((item) => ({ series_type: "rolling", ...item }))
        ];
        const fileName = `${String(row.display_name || row.borehole_id || "borehole").replace(/[^a-z0-9]+/gi, "_").toLowerCase()}_detail.csv`;
        Utils.downloadCsv(fileName, exportRows);
        setStatus(`Downloaded ${fileName}.`);
    }

    function downloadCurrentSelectionJson() {
        const { row, dailyRows, rollingRows } = getCurrentSelectionData();
        if (!row) {
            setStatus("No borehole is available for export.", true);
            return;
        }
        const fileName = `${String(row.display_name || row.borehole_id || "borehole").replace(/[^a-z0-9]+/gi, "_").toLowerCase()}_detail.json`;
        Utils.downloadJson(fileName, {
            exported_at: new Date().toISOString(),
            borehole_summary: row,
            daily_rows: dailyRows,
            rolling_rows: rollingRows
        });
        setStatus(`Downloaded ${fileName}.`);
    }

    function renderAll() {
        const { row, dailyRows, rollingRows } = getCurrentSelectionData();
        if (!row) {
            setStatus("No borehole is available in the loaded report.", true);
            return;
        }
        const dateAxis = buildSharedAxisLayout(dailyRows, rollingRows);
        renderHeader(row, dailyRows);
        renderVolumeChart(dailyRows, dateAxis);
        renderGroundwaterChart(dailyRows, dateAxis);
        renderPerformanceChart(dailyRows, dateAxis);
        renderRollingChart(rollingRows, dateAxis);
        renderQualityStrip(dailyRows, dateAxis);
        renderReasons(row, dailyRows);
        Utils.attachExpandButtons();
        setStatus(`Rendered detail view for ${row.display_name || row.borehole_id}.`);
    }

    async function init() {
        Loader.populateAnalysisControls(document);

        try {
            reportIndex = await Loader.loadReport({
                defaultUrl: DEFAULT_REPORT_URL,
                statusTarget: el("pageStatus"),
                root: document,
                runLiveIfMissing: true
            });
            populateBoreholes(reportIndex);
            renderAll();
        } catch (error) {
            setStatus(error.message, true);
        }

        el("btnRunLiveAnalysis")?.addEventListener("click", async () => {
            try {
                reportIndex = await Loader.runLiveAnalysis({ root: document, statusTarget: el("pageStatus") });
                populateBoreholes(reportIndex);
                renderAll();
            } catch (error) {
                setStatus(error.message, true);
            }
        });

        el("reportFile")?.addEventListener("change", async (event) => {
            const file = event.target.files?.[0];
            if (!file) return;
            reportIndex = await Loader.readUploadedFile(file);
            populateBoreholes(reportIndex);
            renderAll();
        });

        el("loadReportUrl")?.addEventListener("click", async () => {
            reportIndex = await Loader.loadReport({ url: el("reportUrl")?.value || "", statusTarget: el("pageStatus") });
            populateBoreholes(reportIndex);
            renderAll();
        });

        document.querySelectorAll("input[id^='filter'], select[id^='filter']").forEach((node) => node.addEventListener("change", renderAll));
        el("detailQsMethod")?.addEventListener("change", (event) => syncQsControls(event.target.value));
        el("analysisQsMethod")?.addEventListener("change", (event) => syncQsControls(event.target.value));
        el("btnApplyDetailQsMethod")?.addEventListener("click", applyDetailQsMethod);
        el("btnDownloadDetailCsv")?.addEventListener("click", downloadCurrentSelectionCsv);
        el("btnDownloadDetailJson")?.addEventListener("click", downloadCurrentSelectionJson);
    }

    window.addEventListener("DOMContentLoaded", init);
})();
