(function () {
    const Utils = window.SiteMonitorExperimentalVizUtils;
    const Loader = window.SiteMonitorExperimentalVizLoader;
    const DEFAULT_REPORT_URL = "";
    let reportIndex = null;
    let sortState = { key: "maintenance_priority_score", direction: "desc" };

    const el = (id) => document.getElementById(id);

    function setStatus(message, isError = false) {
        Loader.setStatus(el("pageStatus"), message, isError);
    }

    function currentReportParam() {
        const params = new URLSearchParams(window.location.search);
        return params.get("report") || "";
    }

    function boreholeUrl(row) {
        const params = new URLSearchParams();
        params.set("borehole", row.borehole_id || row.display_name || "");
        if (row.provider) params.set("provider", row.provider);
        if (currentReportParam()) params.set("report", currentReportParam());
        return `borehole-detail.html?${params.toString()}`;
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
    }

    function getFiltered() {
        return Loader.applyFilters(reportIndex, Loader.getFilterValues(document));
    }

    function renderKpis(filtered) {
        const rows = filtered.healthRows.length ? filtered.healthRows : filtered.baseRows;
        const totalSites = rows.length;
        const activeSites = rows.filter((row) => (Utils.safeNumber(row.active_day_share) || 0) > 0).length;
        const telemetryReady = rows.filter((row) => ["A", "B"].includes(row.analysis_readiness_tier)).length;
        const stressed = rows.filter((row) => ["stressed", "declining_performance"].includes(row.status_category) || row.stress_flag).length;
        const possibleRunDry = rows.filter((row) => (Number(row.run_dry_candidate_event_share) || 0) >= 0.3 || row.flow_behavior_profile === "possible_intake_limited").length;
        const totalVolume = rows.reduce((sum, row) => sum + (Utils.safeNumber(row.total_volume_m3) || 0), 0);

        el("kpiCards").innerHTML = `
            <div class="kpi-grid">
                <div class="kpi-card"><div class="label">Total sites</div><div class="value">${totalSites}</div></div>
                <div class="kpi-card"><div class="label">Active sites</div><div class="value">${activeSites}</div></div>
                <div class="kpi-card"><div class="label">Telemetry-ready</div><div class="value">${telemetryReady}</div></div>
                <div class="kpi-card"><div class="label">Stressed sites</div><div class="value">${stressed}</div></div>
                <div class="kpi-card"><div class="label">Possible intake-limited</div><div class="value">${possibleRunDry}</div></div>
                <div class="kpi-card"><div class="label">Observed volume</div><div class="value">${Utils.formatNumber(totalVolume, 1)}</div></div>
            </div>`;
    }

    function renderStatusChart(filtered) {
        const rows = filtered.healthRows;
        const labels = Utils.unique(rows.map((row) => row.status_label || row.status_category));
        const counts = labels.map((label) => rows.filter((row) => (row.status_label || row.status_category) === label).length);
        Plotly.newPlot(el("statusChart"), [{
            type: "bar",
            x: labels,
            y: counts,
            marker: { color: labels.map((label) => Utils.statusColor((rows.find((row) => (row.status_label || row.status_category) === label) || {}).status_category)) }
        }], {
            title: "Status / category breakdown",
            margin: { t: 45, l: 40, r: 20, b: 90 },
            xaxis: { tickangle: -25 },
            yaxis: { title: "Sites" }
        }, { responsive: true, displayModeBar: false });
    }

    function renderReadinessChart(filtered) {
        const rows = filtered.healthRows;
        const tiers = ["A", "B", "C", "D"];
        const counts = tiers.map((tier) => rows.filter((row) => row.analysis_readiness_tier === tier).length);
        Plotly.newPlot(el("readinessChart"), [{
            type: "bar",
            x: tiers,
            y: counts,
            marker: { color: ["#16a34a", "#0284c7", "#f59e0b", "#94a3b8"] }
        }], {
            title: "Readiness tier distribution",
            margin: { t: 45, l: 40, r: 20, b: 50 },
            yaxis: { title: "Sites" }
        }, { responsive: true, displayModeBar: false });
    }

    function renderConfidenceChart(filtered) {
        const rows = filtered.healthRows;
        const labels = Utils.unique(rows.map((row) => row.evidence_confidence_label || "limited evidence support"));
        const counts = labels.map((label) => rows.filter((row) => (row.evidence_confidence_label || "limited evidence support") === label).length);
        Plotly.newPlot(el("confidenceChart"), [{
            type: "bar",
            x: labels,
            y: counts,
            marker: { color: ["#16a34a", "#0284c7", "#f59e0b", "#94a3b8"] }
        }], {
            title: "Evidence confidence support",
            margin: { t: 45, l: 40, r: 20, b: 80 },
            xaxis: { tickangle: -20 },
            yaxis: { title: "Sites" }
        }, { responsive: true, displayModeBar: false });
    }

    function renderPriorityChart(filtered) {
        const rows = [...filtered.priorityRows].sort((a, b) => (b.maintenance_priority_score || 0) - (a.maintenance_priority_score || 0)).slice(0, 12);
        Plotly.newPlot(el("priorityChart"), [{
            type: "bar",
            orientation: "h",
            x: rows.map((row) => row.maintenance_priority_score || 0).reverse(),
            y: rows.map((row) => row.display_name || row.borehole_id).reverse(),
            marker: { color: rows.map((row) => Utils.statusColor(row.status_category)).reverse() },
            text: rows.map((row) => row.maintenance_priority_label || "").reverse(),
            hovertemplate: "%{y}<br>Priority score: %{x}<br>%{text}<extra></extra>"
        }], {
            title: "Maintenance priority ranking",
            margin: { t: 45, l: 120, r: 20, b: 40 },
            xaxis: { title: "Priority score" }
        }, { responsive: true, displayModeBar: false });
    }

    function renderBubbleScatter(filtered) {
        const rows = filtered.healthRows;
        const xValues = rows.map((row) => {
            const qs = Utils.safeNumber(row.median_valid_specific_capacity_m3h_per_m);
            return qs === null ? -0.1 : qs;
        });
        Plotly.newPlot(el("bubbleScatter"), [{
            type: "scatter",
            mode: "markers",
            x: xValues,
            y: rows.map((row) => Utils.safeNumber(row.downtime_proxy_share) || 0),
            text: rows.map((row) => `${row.display_name || row.borehole_id}<br>Flow profile: ${row.flow_behavior_profile || "—"}<br>Possible run-dry share: ${Utils.formatPercent(row.run_dry_candidate_event_share || 0, 0)}<br>Resting level: ${Utils.formatNumber(row.latest_resting_level_m, 2)}<br>Dynamic level: ${Utils.formatNumber(row.latest_dynamic_level_m, 2)}`),
            customdata: rows,
            marker: {
                size: rows.map((row) => Math.max(12, Math.sqrt(Utils.safeNumber(row.total_volume_m3) || 0) * 2 + 12)),
                color: rows.map((row) => Utils.statusColor(row.status_category)),
                symbol: rows.map((row) => Utils.safeNumber(row.median_valid_specific_capacity_m3h_per_m) === null ? "x" : "circle"),
                line: { color: "#1e293b", width: 1 },
                opacity: 0.85
            },
            hovertemplate: "%{text}<br>Median valid Q/S: %{x}<br>Downtime proxy share: %{y:.2f}<br>Click for detail<extra></extra>"
        }], {
            title: "Performance vs downtime bubble scatter",
            margin: { t: 45, l: 60, r: 20, b: 55 },
            xaxis: { title: "Median valid specific capacity (missing shown at -0.1)", zeroline: true },
            yaxis: { title: "Downtime proxy share", range: [0, 1.05] }
        }, { responsive: true, displayModeBar: false });

        el("bubbleScatter").on("plotly_click", (event) => {
            const row = event.points?.[0]?.customdata;
            if (row) window.location.href = boreholeUrl(row);
        });
    }

    function renderSparklines(filtered) {
        const grouped = Utils.groupBy(filtered.dailyRows, Utils.boreholeKey);
        const cards = filtered.healthRows.map((row) => {
            const daily = Utils.sortByDate(grouped.get(Utils.boreholeKey(row)) || []);
            const restingSpark = Utils.sparklineSvg(daily.map((item) => item.estimated_daily_resting_level_m), { stroke: "#f59e0b" });
            const dynamicSpark = Utils.sparklineSvg(daily.map((item) => item.daily_min_groundwater_level_m), { stroke: "#0f766e" });
            return `
                <div class="kpi-card">
                    <div><strong><a href="${boreholeUrl(row)}">${Utils.escapeHtml(row.display_name || row.borehole_id)}</a></strong></div>
                    <div class="viz-note">${Utils.escapeHtml(row.status_label || row.status_category || "")}</div>
                    <div class="viz-note">Resting level</div>
                    <div>${restingSpark}</div>
                    <div class="viz-note">Dynamic level proxy</div>
                    <div>${dynamicSpark}</div>
                </div>`;
        }).join("");
        el("boreholeSparklines").innerHTML = `<div class="viz-grid">${cards}</div>`;
    }

    function compareValues(a, b, key, direction) {
        const aValue = a[key];
        const bValue = b[key];
        const aNum = Utils.safeNumber(aValue);
        const bNum = Utils.safeNumber(bValue);
        let result = 0;
        if (aNum !== null && bNum !== null) {
            result = aNum - bNum;
        } else {
            result = String(aValue ?? "").localeCompare(String(bValue ?? ""));
        }
        return direction === "asc" ? result : -result;
    }

    function renderTable(filtered) {
        const grouped = Utils.groupBy(filtered.dailyRows, Utils.boreholeKey);
        const rows = [...filtered.healthRows].sort((a, b) => compareValues(a, b, sortState.key, sortState.direction));
        const html = `
            <table class="viz-table">
                <thead>
                    <tr>
                        <th><button data-sort="display_name">Borehole</button></th>
                        <th><button data-sort="status_label">Status</button></th>
                        <th><button data-sort="analysis_readiness_tier">Tier</button></th>
                        <th><button data-sort="typology_group">Typology</button></th>
                        <th><button data-sort="maintenance_priority_score">Priority</button></th>
                        <th><button data-sort="total_volume_m3">Volume</button></th>
                        <th><button data-sort="median_valid_specific_capacity_m3h_per_m">Median Q/S</button></th>
                        <th><button data-sort="downtime_proxy_share">Downtime</button></th>
                        <th><button data-sort="latest_resting_level_m">Resting</button></th>
                        <th><button data-sort="latest_dynamic_level_m">Dynamic</button></th>
                        <th><button data-sort="evidence_confidence_score">Evidence</button></th>
                        <th>Daily sparkline</th>
                        <th>Interpretation</th>
                    </tr>
                </thead>
                <tbody>
                    ${rows.map((row) => {
                        const daily = Utils.sortByDate(grouped.get(Utils.boreholeKey(row)) || []);
                        return `<tr>
                            <td><a href="${boreholeUrl(row)}">${Utils.escapeHtml(row.display_name || row.borehole_id)}</a></td>
                            <td>${Utils.escapeHtml(row.status_label || row.status_category || "—")}</td>
                            <td>${Utils.escapeHtml(row.analysis_readiness_tier || "—")}</td>
                            <td>${Utils.escapeHtml(row.typology_group || "—")}</td>
                            <td>${Utils.escapeHtml(row.maintenance_priority_label || "—")}</td>
                            <td>${Utils.formatNumber(row.total_volume_m3, 1)}</td>
                            <td>${Utils.safeNumber(row.median_valid_specific_capacity_m3h_per_m) === null ? "No valid Q/S" : Utils.formatNumber(row.median_valid_specific_capacity_m3h_per_m, 3)}</td>
                            <td>${Utils.formatPercent(row.downtime_proxy_share, 0)}</td>
                            <td>${Utils.formatNumber(row.latest_resting_level_m, 2)}</td>
                            <td>${Utils.formatNumber(row.latest_dynamic_level_m, 2)}</td>
                            <td>${Utils.escapeHtml(row.evidence_confidence_label || "—")}</td>
                            <td>${Utils.sparklineSvg(daily.map((item) => item.daily_pumped_volume_m3))}</td>
                            <td>${Utils.escapeHtml(row.concise_interpretation || "—")}</td>
                        </tr>`;
                    }).join("")}
                </tbody>
            </table>`;
        el("comparisonTable").innerHTML = `<div class="table-wrap">${html}</div>`;
        el("comparisonTable").querySelectorAll("button[data-sort]").forEach((button) => {
            button.addEventListener("click", () => {
                const key = button.dataset.sort;
                if (sortState.key === key) {
                    sortState.direction = sortState.direction === "asc" ? "desc" : "asc";
                } else {
                    sortState.key = key;
                    sortState.direction = "desc";
                }
                renderAll();
            });
        });
    }

    function downloadFilteredSummaryCsv() {
        const filtered = getFiltered();
        Utils.downloadCsv("network_overview_filtered_summary.csv", filtered.healthRows || []);
        setStatus(`Downloaded filtered summary for ${filtered.healthRows.length} boreholes.`);
    }

    function downloadFullReportJson() {
        Utils.downloadJson("network_overview_report.json", reportIndex?.report || {});
        setStatus("Downloaded the current report JSON.");
    }

    function renderAll() {
        const filtered = getFiltered();
        if (!filtered.healthRows.length) {
            el("kpiCards").innerHTML = "<p>No boreholes match the current filters.</p>";
            return;
        }
        renderKpis(filtered);
        renderStatusChart(filtered);
        renderReadinessChart(filtered);
        renderConfidenceChart(filtered);
        renderPriorityChart(filtered);
        renderBubbleScatter(filtered);
        renderSparklines(filtered);
        renderTable(filtered);
        Utils.attachExpandButtons();
        setStatus(`Rendered overview for ${filtered.healthRows.length} boreholes from the current report.`);
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
            setStatus(`Loaded report from ${file.name}.`);
        });

        el("loadReportUrl")?.addEventListener("click", async () => {
            const url = el("reportUrl")?.value || "";
            reportIndex = await Loader.loadReport({ url, statusTarget: el("pageStatus") });
            populateFilters(reportIndex);
            renderAll();
        });

        document.querySelectorAll("input[id^='filter'], select[id^='filter']").forEach((node) => {
            node.addEventListener("change", renderAll);
        });
        el("btnDownloadNetworkCsv")?.addEventListener("click", downloadFilteredSummaryCsv);
        el("btnDownloadNetworkJson")?.addEventListener("click", downloadFullReportJson);
    }

    window.addEventListener("DOMContentLoaded", init);
})();
