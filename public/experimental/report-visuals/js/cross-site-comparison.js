(function () {
    const Utils = window.SiteMonitorExperimentalVizUtils;
    const Loader = window.SiteMonitorExperimentalVizLoader;
    const DEFAULT_REPORT_URL = "";
    let reportIndex = null;

    const el = (id) => document.getElementById(id);
    const METRICS = {
        total_volume_m3: "Total observed volume",
        active_day_share: "Active-day share",
        median_valid_specific_capacity_m3h_per_m: "Median valid specific capacity",
        max_drawdown_observed_m: "Maximum drawdown",
        latest_resting_level_m: "Latest resting level",
        latest_dynamic_level_m: "Latest dynamic level",
        run_dry_candidate_event_share: "Possible run-dry event share",
        downtime_proxy_share: "Downtime proxy share",
        data_unreliability_index: "Data unreliability index",
        maintenance_priority_score: "Maintenance priority score",
        evidence_confidence_score: "Evidence confidence score"
    };

    function setStatus(message, isError = false) {
        Loader.setStatus(el("pageStatus"), message, isError);
    }

    function populateFilters(index) {
        const rows = index.report.health_summary_table || [];
        const addOptions = (target, values, placeholder) => {
            if (!target) return;
            target.innerHTML = `<option value="">${placeholder}</option>` + Utils.unique(values).sort().map((value) => `<option value="${Utils.escapeHtml(value)}">${Utils.escapeHtml(value)}</option>`).join("");
        };
        addOptions(el("filterProvider"), rows.map((row) => row.provider), "All providers");
        addOptions(el("filterBorehole"), rows.map((row) => Utils.boreholeKey(row)), "All boreholes");
        addOptions(el("filterStatus"), rows.map((row) => row.status_category), "All status categories");
        addOptions(el("filterReadiness"), rows.map((row) => row.analysis_readiness_tier), "All readiness tiers");
        addOptions(el("filterTypology"), rows.map((row) => row.typology_group), "All typologies");
        addOptions(el("filterPriority"), rows.map((row) => row.maintenance_priority_label), "All priorities");
        const dates = (index.report.daily_rows || []).map((row) => row.date).filter(Boolean).sort();
        if (dates.length) {
            if (el("filterStartDate") && !el("filterStartDate").value) el("filterStartDate").value = dates[0];
            if (el("filterEndDate") && !el("filterEndDate").value) el("filterEndDate").value = dates[dates.length - 1];
        }
        const metricOptions = Object.entries(METRICS).map(([key, label]) => `<option value="${key}">${Utils.escapeHtml(label)}</option>`).join("");
        el("metricX").innerHTML = metricOptions;
        el("metricY").innerHTML = metricOptions;
        el("metricX").value = "median_valid_specific_capacity_m3h_per_m";
        el("metricY").value = "downtime_proxy_share";
    }

    function renderHeatmap(filtered) {
        const rows = filtered.healthRows;
        const metrics = Object.keys(METRICS);
        const z = metrics.map((metric) => rows.map((row) => Utils.safeNumber(row[metric])));
        const text = metrics.map((metric) => rows.map((row) => {
            const value = Utils.safeNumber(row[metric]);
            return value === null ? "—" : value.toFixed(2);
        }));
        Plotly.newPlot(el("heatmapChart"), [{
            type: "heatmap",
            z,
            x: rows.map((row) => row.display_name || row.borehole_id),
            y: metrics.map((metric) => METRICS[metric]),
            text,
            texttemplate: "%{text}",
            colorscale: "Blues",
            hovertemplate: "%{y}<br>%{x}: %{text}<extra></extra>"
        }], {
            title: "Heatmap of key metrics by borehole",
            margin: { t: 45, l: 150, r: 20, b: 80 }
        }, { responsive: true, displayModeBar: false });
    }

    function renderScatter(filtered) {
        const rows = filtered.healthRows;
        const xMetric = el("metricX").value;
        const yMetric = el("metricY").value;
        Plotly.newPlot(el("metricScatter"), [{
            type: "scatter",
            mode: "markers+text",
            x: rows.map((row) => Utils.safeNumber(row[xMetric]) === null ? -0.1 : Utils.safeNumber(row[xMetric])),
            y: rows.map((row) => Utils.safeNumber(row[yMetric]) === null ? -0.1 : Utils.safeNumber(row[yMetric])),
            text: rows.map((row) => row.display_name || row.borehole_id),
            textposition: "top center",
            marker: {
                size: rows.map((row) => Math.max(12, (Utils.safeNumber(row.maintenance_priority_score) || 0) / 5 + 8)),
                color: rows.map((row) => Utils.statusColor(row.status_category)),
                symbol: rows.map((row) => (Utils.safeNumber(row[xMetric]) === null || Utils.safeNumber(row[yMetric]) === null) ? "x" : "circle")
            },
            customdata: rows,
            hovertemplate: "%{text}<br>X: %{x}<br>Y: %{y}<extra></extra>"
        }], {
            title: "Selectable cross-site comparison scatter",
            margin: { t: 45, l: 55, r: 20, b: 55 },
            xaxis: { title: `${METRICS[xMetric]} (missing shown at -0.1)` },
            yaxis: { title: `${METRICS[yMetric]} (missing shown at -0.1)` },
            shapes: [
                { type: "line", x0: 0, x1: 0, y0: -0.1, y1: 1.1, line: { color: "#94a3b8", dash: "dot" } },
                { type: "line", x0: -0.1, x1: 1.5, y0: 0.3, y1: 0.3, line: { color: "#94a3b8", dash: "dot" } }
            ]
        }, { responsive: true, displayModeBar: false });

        el("metricScatter").on("plotly_click", (event) => {
            const row = event.points?.[0]?.customdata;
            if (row) {
                const params = new URLSearchParams();
                params.set("borehole", row.borehole_id);
                if (row.provider) params.set("provider", row.provider);
                window.location.href = `borehole-detail.html?${params.toString()}`;
            }
        });
    }

    function renderBreakdown(filtered) {
        const rows = filtered.healthRows;
        const statuses = Utils.unique(rows.map((row) => row.status_label || row.status_category));
        const statusCounts = statuses.map((status) => rows.filter((row) => (row.status_label || row.status_category) === status).length);
        const typologies = Utils.unique(rows.map((row) => row.typology_group));
        const typologyCounts = typologies.map((item) => rows.filter((row) => row.typology_group === item).length);
        Plotly.newPlot(el("breakdownChart"), [
            { type: "bar", x: statuses, y: statusCounts, name: "Status" },
            { type: "bar", x: typologies, y: typologyCounts, name: "Typology" }
        ], {
            title: "Typology and status breakdown",
            barmode: "group",
            margin: { t: 45, l: 40, r: 20, b: 90 },
            xaxis: { tickangle: -25 }
        }, { responsive: true, displayModeBar: false });
    }

    function rankedTable(title, rows, columns) {
        return `
            <div class="kpi-card">
                <h3>${Utils.escapeHtml(title)}</h3>
                <div class="table-wrap">
                    <table class="viz-table">
                        <thead><tr>${columns.map((column) => `<th>${Utils.escapeHtml(column.label)}</th>`).join("")}</tr></thead>
                        <tbody>
                            ${rows.map((row) => `<tr>${columns.map((column) => `<td>${Utils.escapeHtml(typeof column.value === "function" ? column.value(row) : row[column.key] ?? "—")}</td>`).join("")}</tr>`).join("")}
                        </tbody>
                    </table>
                </div>
            </div>`;
    }

    function renderRankedTables(filtered) {
        const byStress = [...filtered.comparisonRows].sort((a, b) => (a.rank_most_stressed || 999) - (b.rank_most_stressed || 999)).slice(0, 8);
        const byDowntime = [...filtered.healthRows].sort((a, b) => (b.downtime_proxy_share || 0) - (a.downtime_proxy_share || 0)).slice(0, 8);
        const byDecline = [...filtered.healthRows].filter((row) => row.status_category === "declining_performance" || row.performance_decline_flag).sort((a, b) => (b.maintenance_priority_score || 0) - (a.maintenance_priority_score || 0));
        const byUnreliable = [...filtered.healthRows].sort((a, b) => (b.data_unreliability_index || 0) - (a.data_unreliability_index || 0)).slice(0, 8);
        const byQs = [...filtered.healthRows].sort((a, b) => (b.median_valid_specific_capacity_m3h_per_m || -999) - (a.median_valid_specific_capacity_m3h_per_m || -999)).slice(0, 8);
        const byRunDry = [...filtered.healthRows].sort((a, b) => (b.run_dry_candidate_event_share || 0) - (a.run_dry_candidate_event_share || 0)).slice(0, 8);
        const byFieldReview = [...filtered.healthRows]
            .filter((row) => (row.operational_bucket || "") !== "routine watch")
            .sort((a, b) => ((b.maintenance_priority_score || 0) - (a.maintenance_priority_score || 0)) || ((b.evidence_confidence_score || 0) - (a.evidence_confidence_score || 0)))
            .slice(0, 8);

        el("rankedTables").innerHTML = `
            <div class="viz-grid">
                ${rankedTable("Stress ranking", byStress, [{ label: "Borehole", value: (row) => row.display_name || row.borehole_id }, { label: "Rank", key: "rank_most_stressed" }, { label: "Status", value: (row) => row.status_label || row.status_category }])}
                ${rankedTable("Field review shortlist", byFieldReview, [{ label: "Borehole", value: (row) => row.display_name || row.borehole_id }, { label: "Bucket", key: "operational_bucket" }, { label: "Focus", key: "field_check_focus" }])}
                ${rankedTable("Possible run-dry ranking", byRunDry, [{ label: "Borehole", value: (row) => row.display_name || row.borehole_id }, { label: "Candidate share", value: (row) => Utils.formatPercent(row.run_dry_candidate_event_share, 0) }, { label: "Flow profile", value: (row) => row.flow_behavior_profile || "—" }])}
                ${rankedTable("Downtime ranking", byDowntime, [{ label: "Borehole", value: (row) => row.display_name || row.borehole_id }, { label: "Downtime", value: (row) => Utils.formatPercent(row.downtime_proxy_share, 0) }, { label: "Status", value: (row) => row.status_label || row.status_category }])}
                ${rankedTable("Decline ranking", byDecline, [{ label: "Borehole", value: (row) => row.display_name || row.borehole_id }, { label: "Priority", key: "maintenance_priority_label" }, { label: "Reasons", value: (row) => (row.transparent_reasons || []).join(", ") }])}
                ${rankedTable("Unreliability ranking", byUnreliable, [{ label: "Borehole", value: (row) => row.display_name || row.borehole_id }, { label: "Index", key: "data_unreliability_index" }, { label: "Status", value: (row) => row.status_label || row.status_category }])}
                ${rankedTable("Best valid specific capacity", byQs, [{ label: "Borehole", value: (row) => row.display_name || row.borehole_id }, { label: "Median Q/S", value: (row) => Utils.safeNumber(row.median_valid_specific_capacity_m3h_per_m) === null ? "No valid Q/S" : Utils.formatNumber(row.median_valid_specific_capacity_m3h_per_m, 3) }, { label: "Status", value: (row) => row.status_label || row.status_category }])}
            </div>`;
    }

    function downloadComparisonCsv() {
        const filtered = Loader.applyFilters(reportIndex, Loader.getFilterValues(document));
        Utils.downloadCsv("cross_site_comparison.csv", filtered.healthRows || []);
        setStatus(`Downloaded comparison CSV for ${filtered.healthRows.length} boreholes.`);
    }

    function downloadComparisonJson() {
        Utils.downloadJson("cross_site_report.json", reportIndex?.report || {});
        setStatus("Downloaded the current report JSON.");
    }

    function renderAll() {
        const filtered = Loader.applyFilters(reportIndex, Loader.getFilterValues(document));
        if (!filtered.healthRows.length) {
            setStatus("No boreholes match the current filters.", true);
            return;
        }
        renderHeatmap(filtered);
        renderScatter(filtered);
        renderBreakdown(filtered);
        renderRankedTables(filtered);
        Utils.attachExpandButtons();
        setStatus(`Rendered cross-site comparison for ${filtered.healthRows.length} boreholes.`);
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
            populateFilters(reportIndex);
            renderAll();
        } catch (error) {
            setStatus(error.message, true);
        }

        el("btnRunLiveAnalysis")?.addEventListener("click", async () => {
            try {
                reportIndex = await Loader.runLiveAnalysis({ root: document, statusTarget: el("pageStatus") });
                populateFilters(reportIndex);
                renderAll();
            } catch (error) {
                setStatus(error.message, true);
            }
        });

        el("reportFile")?.addEventListener("change", async (event) => {
            const file = event.target.files?.[0];
            if (!file) return;
            reportIndex = await Loader.readUploadedFile(file);
            populateFilters(reportIndex);
            renderAll();
        });

        el("loadReportUrl")?.addEventListener("click", async () => {
            reportIndex = await Loader.loadReport({ url: el("reportUrl")?.value || "", statusTarget: el("pageStatus") });
            populateFilters(reportIndex);
            renderAll();
        });

        document.querySelectorAll("input[id^='filter'], select[id^='filter']").forEach((node) => node.addEventListener("change", renderAll));
        el("btnDownloadComparisonCsv")?.addEventListener("click", downloadComparisonCsv);
        el("btnDownloadComparisonJson")?.addEventListener("click", downloadComparisonJson);
    }

    window.addEventListener("DOMContentLoaded", init);
})();
