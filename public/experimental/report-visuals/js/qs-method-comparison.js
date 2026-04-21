(function () {
    const Utils = window.SiteMonitorExperimentalVizUtils;
    const Loader = window.SiteMonitorExperimentalVizLoader;
    const DEFAULT_REPORT_URL = "";
    let reportIndex = null;

    const el = (id) => document.getElementById(id);
    const METHOD_LABELS = {
        event_median_proxy: "Event median",
        stable_tail_proxy: "Stable-tail",
        current_proxy: "Last flow",
        late_mean_proxy: "Late mean",
        max_stress_proxy: "Max flow"
    };
    const METHOD_DESCRIPTIONS = {
        event_median_proxy: "Median pumping flow during the event divided by maximum drawdown. Default method.",
        stable_tail_proxy: "Late stable pumping flow divided by maximum drawdown. Best when the event tail is well supported.",
        current_proxy: "Last non-zero flow near the event end divided by end-of-event drawdown.",
        late_mean_proxy: "Average late-event flow divided by maximum drawdown.",
        max_stress_proxy: "Maximum observed event flow divided by maximum observed drawdown. This is the most stress-oriented proxy.",
        spread: "Difference between the highest and lowest available Q/S method values for that site. Larger spread means lower method agreement."
    };
    const METHOD_ORDER = ["event_median_proxy", "stable_tail_proxy", "current_proxy", "late_mean_proxy", "max_stress_proxy"];

    function setStatus(message, isError = false) {
        Loader.setStatus(el("pageStatus"), message, isError);
    }

    function median(values = []) {
        const valid = values.filter((value) => Number.isFinite(Number(value))).map(Number).sort((a, b) => a - b);
        if (!valid.length) return null;
        const mid = Math.floor(valid.length / 2);
        return valid.length % 2 ? valid[mid] : (valid[mid - 1] + valid[mid]) / 2;
    }

    function populateFilters(index) {
        const rows = index.report.health_summary_table || [];
        const addOptions = (target, values, placeholder) => {
            if (!target) return;
            target.innerHTML = `<option value="">${placeholder}</option>` + Utils.unique(values).sort().map((value) => `<option value="${Utils.escapeHtml(value)}">${Utils.escapeHtml(value)}</option>`).join("");
        };

        addOptions(el("filterBorehole"), rows.map((row) => Utils.boreholeKey(row)), "All boreholes");
        addOptions(el("filterStatus"), rows.map((row) => row.status_category), "All status categories");
    }

    function collectEventRows() {
        const directRows = Array.isArray(reportIndex?.report?.event_rows) ? reportIndex.report.event_rows : [];
        if (directRows.length) return directRows;
        return (reportIndex?.report?.source_reports || []).flatMap((sourceReport) => Array.isArray(sourceReport?.event_rows) ? sourceReport.event_rows : []);
    }

    function buildComparisonRows(filtered) {
        const allowedKeys = filtered.allowedKeys || new Set();
        const summaryRows = filtered.healthRows.length ? filtered.healthRows : (reportIndex?.report?.health_summary_table || []);
        const healthByKey = new Map(summaryRows.map((row) => [Utils.boreholeKey(row), row]));
        const grouped = new Map();

        summaryRows.forEach((summary) => {
            const key = Utils.boreholeKey(summary);
            if (allowedKeys.size && !allowedKeys.has(key)) return;
            grouped.set(key, {
                key,
                provider: summary.provider,
                borehole_id: summary.borehole_id,
                display_name: summary.display_name || summary.borehole_id,
                status_label: summary.status_label || summary.status_category || "—",
                maintenance_priority_label: summary.maintenance_priority_label || "—",
                summary,
                valid_event_count: 0,
                event_median_proxy: [],
                stable_tail_proxy: [],
                current_proxy: [],
                late_mean_proxy: [],
                max_stress_proxy: []
            });
        });

        collectEventRows().forEach((eventRow) => {
            const key = Utils.boreholeKey(eventRow);
            if (allowedKeys.size && !allowedKeys.has(key)) return;
            const summary = healthByKey.get(key) || {};
            if (!grouped.has(key)) {
                grouped.set(key, {
                    key,
                    provider: eventRow.provider || summary.provider,
                    borehole_id: eventRow.borehole_id || summary.borehole_id,
                    display_name: summary.display_name || eventRow.display_name || eventRow.borehole_id,
                    status_label: summary.status_label || summary.status_category || "—",
                    maintenance_priority_label: summary.maintenance_priority_label || "—",
                    summary,
                    valid_event_count: 0,
                    event_median_proxy: [],
                    stable_tail_proxy: [],
                    current_proxy: [],
                    late_mean_proxy: [],
                    max_stress_proxy: []
                });
            }
            const target = grouped.get(key);
            const candidates = eventRow.specific_capacity_candidates || {};
            METHOD_ORDER.forEach((method) => {
                if (Number.isFinite(Number(candidates[method]))) {
                    target[method].push(Number(candidates[method]));
                }
            });
            if (Number.isFinite(Number(eventRow.selected_specific_capacity_m3h_per_m || candidates.event_median_proxy))) {
                target.valid_event_count += 1;
            }
        });

        return [...grouped.values()].map((row) => {
            const summary = row.summary || {};
            const eventMedian = median(row.event_median_proxy);
            const stableTail = median(row.stable_tail_proxy);
            const current = median(row.current_proxy);
            const lateMean = median(row.late_mean_proxy);
            const maxFlow = median(row.max_stress_proxy);
            const fallbackQs = Number.isFinite(Number(summary.median_valid_specific_capacity_m3h_per_m)) ? Number(summary.median_valid_specific_capacity_m3h_per_m) : null;
            const methodValues = [eventMedian ?? fallbackQs, stableTail, current, lateMean, maxFlow].filter((value) => Number.isFinite(Number(value)));
            const spread = methodValues.length > 1 ? Math.max(...methodValues) - Math.min(...methodValues) : null;
            const supportDays = (filtered.dailyRows || []).filter((item) => Utils.boreholeKey(item) === row.key).reduce((sum, item) => sum + (Number(item.event_count) || 0), 0);
            return {
                provider: row.provider || summary.provider || "—",
                borehole_id: row.borehole_id || summary.borehole_id,
                display_name: row.display_name || summary.display_name,
                status_label: row.status_label || "—",
                maintenance_priority_label: row.maintenance_priority_label || "—",
                valid_event_count: row.valid_event_count || supportDays,
                event_median_qs: eventMedian ?? fallbackQs,
                stable_tail_qs: stableTail,
                current_proxy_qs: current,
                late_mean_qs: lateMean,
                max_flow_qs: maxFlow,
                qs_method_spread: spread
            };
        }).sort((a, b) => String(a.display_name || a.borehole_id).localeCompare(String(b.display_name || b.borehole_id)));
    }

    function renderKpis(rows) {
        const spreadValues = rows.map((row) => row.qs_method_spread).filter((value) => Number.isFinite(Number(value)));
        const supported = rows.filter((row) => row.valid_event_count > 0).length;
        const strongAgreement = rows.filter((row) => Number.isFinite(Number(row.qs_method_spread)) && Number(row.qs_method_spread) <= 0.5).length;
        el("qsComparisonKpis").innerHTML = `
            <div class="kpi-grid">
                <div class="kpi-card"><div class="label">Sites in table</div><div class="value">${rows.length}</div></div>
                <div class="kpi-card"><div class="label">Sites with valid Q/S</div><div class="value">${supported}</div></div>
                <div class="kpi-card"><div class="label">Median method spread</div><div class="value">${Utils.formatNumber(median(spreadValues), 2)}</div></div>
                <div class="kpi-card"><div class="label">Sites with close agreement</div><div class="value">${strongAgreement}</div></div>
            </div>`;
    }

    function renderVisuals(rows) {
        const heatmapTarget = el("qsHeatmapChart");
        const spreadTarget = el("qsSpreadChart");
        if (!window.Plotly || !heatmapTarget || !spreadTarget) return;

        const columns = [
            { label: METHOD_LABELS.event_median_proxy, key: "event_median_qs" },
            { label: METHOD_LABELS.stable_tail_proxy, key: "stable_tail_qs" },
            { label: METHOD_LABELS.current_proxy, key: "current_proxy_qs" },
            { label: METHOD_LABELS.late_mean_proxy, key: "late_mean_qs" },
            { label: METHOD_LABELS.max_stress_proxy, key: "max_flow_qs" }
        ];

        const yLabels = rows.map((row) => row.display_name || row.borehole_id);
        const zValues = rows.map((row) => columns.map((column) => {
            const value = row[column.key];
            return Number.isFinite(Number(value)) ? Number(value) : null;
        }));

        Plotly.newPlot(heatmapTarget, [{
            type: "heatmap",
            x: columns.map((column) => column.label),
            y: yLabels,
            z: zValues,
            colorscale: "YlGnBu",
            hovertemplate: "%{y}<br>%{x}: %{z:.3f}<extra></extra>",
            colorbar: { title: "Q/S" }
        }], {
            title: "Q/S values by site and method",
            margin: { t: 50, l: 140, r: 40, b: 70 },
            height: Math.max(360, rows.length * 28 + 150)
        }, { responsive: true, displayModeBar: false });

        const spreadRows = rows
            .filter((row) => Number.isFinite(Number(row.qs_method_spread)))
            .sort((a, b) => Number(b.qs_method_spread) - Number(a.qs_method_spread))
            .slice(0, 20)
            .reverse();

        Plotly.newPlot(spreadTarget, [{
            type: "bar",
            orientation: "h",
            y: spreadRows.map((row) => row.display_name || row.borehole_id),
            x: spreadRows.map((row) => row.qs_method_spread),
            marker: { color: "#2563eb" },
            hovertemplate: "%{y}<br>Method spread: %{x:.3f}<extra></extra>"
        }], {
            title: "Sites with the biggest method differences",
            margin: { t: 50, l: 140, r: 20, b: 50 },
            height: Math.max(360, spreadRows.length * 24 + 120),
            xaxis: { title: "Q/S spread" },
            yaxis: { title: "Site" }
        }, { responsive: true, displayModeBar: false });
    }

    function renderTable(rows) {
        const helpHeader = (label, description) => `<span title="${Utils.escapeHtml(description)}">${Utils.escapeHtml(label)} ⓘ</span>`;
        const html = `
            <table class="viz-table">
                <thead>
                    <tr>
                        <th>Borehole</th>
                        <th>Status</th>
                        <th>Event support</th>
                        <th>${helpHeader(METHOD_LABELS.event_median_proxy, METHOD_DESCRIPTIONS.event_median_proxy)}</th>
                        <th>${helpHeader(METHOD_LABELS.stable_tail_proxy, METHOD_DESCRIPTIONS.stable_tail_proxy)}</th>
                        <th>${helpHeader(METHOD_LABELS.current_proxy, METHOD_DESCRIPTIONS.current_proxy)}</th>
                        <th>${helpHeader(METHOD_LABELS.late_mean_proxy, METHOD_DESCRIPTIONS.late_mean_proxy)}</th>
                        <th>${helpHeader(METHOD_LABELS.max_stress_proxy, METHOD_DESCRIPTIONS.max_stress_proxy)}</th>
                        <th>${helpHeader("Spread", METHOD_DESCRIPTIONS.spread)}</th>
                    </tr>
                </thead>
                <tbody>
                    ${rows.map((row) => `
                        <tr>
                            <td>${Utils.escapeHtml(row.display_name || row.borehole_id)}</td>
                            <td>${Utils.escapeHtml(row.status_label || "—")}</td>
                            <td>${Utils.escapeHtml(String(row.valid_event_count || 0))}</td>
                            <td>${Utils.formatNumber(row.event_median_qs, 3)}</td>
                            <td>${Utils.formatNumber(row.stable_tail_qs, 3)}</td>
                            <td>${Utils.formatNumber(row.current_proxy_qs, 3)}</td>
                            <td>${Utils.formatNumber(row.late_mean_qs, 3)}</td>
                            <td>${Utils.formatNumber(row.max_flow_qs, 3)}</td>
                            <td>${Utils.formatNumber(row.qs_method_spread, 3)}</td>
                        </tr>`).join("")}
                </tbody>
            </table>`;
        el("qsComparisonTable").innerHTML = `<div class="table-wrap">${html}</div>`;
    }

    function downloadComparisonCsv(rows) {
        Utils.downloadCsv("qs_method_comparison.csv", rows);
        setStatus(`Downloaded Q/S comparison CSV for ${rows.length} sites.`);
    }

    function downloadComparisonJson(rows) {
        Utils.downloadJson("qs_method_comparison.json", {
            exported_at: new Date().toISOString(),
            comparison_rows: rows,
            report: reportIndex?.report || {}
        });
        setStatus("Downloaded the Q/S comparison JSON.");
    }

    function renderAll() {
        const filtered = Loader.applyFilters(reportIndex, Loader.getFilterValues(document));
        const rows = buildComparisonRows(filtered);
        if (!rows.length) {
            setStatus("No Q/S comparison rows are available for the current filters.", true);
            el("qsComparisonTable").innerHTML = "<p>No Q/S rows available.</p>";
            return;
        }
        renderKpis(rows);
        renderVisuals(rows);
        renderTable(rows);
        Utils.attachExpandButtons();
        const csvButton = el("btnDownloadQsComparisonCsv");
        const jsonButton = el("btnDownloadQsComparisonJson");
        if (csvButton) csvButton.onclick = () => downloadComparisonCsv(rows);
        if (jsonButton) jsonButton.onclick = () => downloadComparisonJson(rows);
        setStatus(`Rendered Q/S comparison for ${rows.length} sites.`);
    }

    async function init() {
        Loader.populateAnalysisControls(document);

        try {
            reportIndex = await Loader.loadInitialReport({
                defaultUrl: DEFAULT_REPORT_URL,
                statusTarget: el("pageStatus"),
                root: document
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
    }

    window.addEventListener("DOMContentLoaded", init);
})();
