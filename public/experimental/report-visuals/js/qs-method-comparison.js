(function () {
    const Utils = window.SiteMonitorExperimentalVizUtils;
    const Loader = window.SiteMonitorExperimentalVizLoader;
    const DEFAULT_REPORT_URL = "";
    let reportIndex = null;

    const el = (id) => document.getElementById(id);
    const METHOD_LABELS = {
        preferred: "Preferred auto",
        stable_tail_proxy: "Stable-tail",
        event_median_proxy: "Event median",
        current_proxy: "Last flow",
        late_mean_proxy: "Late mean",
        max_stress_proxy: "Max flow"
    };
    const METHOD_ORDER = ["preferred", "stable_tail_proxy", "event_median_proxy", "current_proxy", "late_mean_proxy", "max_stress_proxy"];

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

    function buildComparisonRows(filtered) {
        const allowedKeys = filtered.allowedKeys || new Set();
        const healthByKey = new Map((filtered.healthRows || []).map((row) => [Utils.boreholeKey(row), row]));
        const grouped = new Map();

        (reportIndex?.report?.source_reports || []).forEach((sourceReport) => {
            (sourceReport?.event_rows || []).forEach((eventRow) => {
                const key = Utils.boreholeKey(eventRow);
                if (allowedKeys.size && !allowedKeys.has(key)) return;
                const summary = healthByKey.get(key) || {};
                if (!grouped.has(key)) {
                    grouped.set(key, {
                        key,
                        provider: eventRow.provider || summary.provider,
                        borehole_id: eventRow.borehole_id || summary.borehole_id,
                        display_name: summary.display_name || eventRow.borehole_id,
                        status_label: summary.status_label || summary.status_category || "—",
                        maintenance_priority_label: summary.maintenance_priority_label || "—",
                        valid_event_count: 0,
                        preferred: [],
                        stable_tail_proxy: [],
                        event_median_proxy: [],
                        current_proxy: [],
                        late_mean_proxy: [],
                        max_stress_proxy: []
                    });
                }
                const target = grouped.get(key);
                if (Number.isFinite(Number(eventRow.preferred_specific_capacity_m3h_per_m))) {
                    target.preferred.push(Number(eventRow.preferred_specific_capacity_m3h_per_m));
                }
                const candidates = eventRow.specific_capacity_candidates || {};
                METHOD_ORDER.slice(1).forEach((method) => {
                    if (Number.isFinite(Number(candidates[method]))) {
                        target[method].push(Number(candidates[method]));
                    }
                });
                if (Number.isFinite(Number(eventRow.selected_specific_capacity_m3h_per_m))) {
                    target.valid_event_count += 1;
                }
            });
        });

        return [...grouped.values()].map((row) => {
            const methodValues = METHOD_ORDER.map((method) => median(row[method])).filter((value) => Number.isFinite(Number(value)));
            const spread = methodValues.length ? Math.max(...methodValues) - Math.min(...methodValues) : null;
            return {
                provider: row.provider,
                borehole_id: row.borehole_id,
                display_name: row.display_name,
                status_label: row.status_label,
                maintenance_priority_label: row.maintenance_priority_label,
                valid_event_count: row.valid_event_count,
                preferred_auto_qs: median(row.preferred),
                stable_tail_qs: median(row.stable_tail_proxy),
                event_median_qs: median(row.event_median_proxy),
                current_proxy_qs: median(row.current_proxy),
                late_mean_qs: median(row.late_mean_proxy),
                max_flow_qs: median(row.max_stress_proxy),
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


    function renderTable(rows) {
        const html = `
            <table class="viz-table">
                <thead>
                    <tr>
                        <th>Borehole</th>
                        <th>Status</th>
                        <th>Valid events</th>
                        <th>Preferred auto</th>
                        <th>Stable-tail</th>
                        <th>Event median</th>
                        <th>Last flow</th>
                        <th>Late mean</th>
                        <th>Max flow</th>
                        <th>Spread</th>
                    </tr>
                </thead>
                <tbody>
                    ${rows.map((row) => `
                        <tr>
                            <td>${Utils.escapeHtml(row.display_name || row.borehole_id)}</td>
                            <td>${Utils.escapeHtml(row.status_label || "—")}</td>
                            <td>${Utils.escapeHtml(String(row.valid_event_count || 0))}</td>
                            <td>${Utils.formatNumber(row.preferred_auto_qs, 3)}</td>
                            <td>${Utils.formatNumber(row.stable_tail_qs, 3)}</td>
                            <td>${Utils.formatNumber(row.event_median_qs, 3)}</td>
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
        renderTable(rows);
        Utils.attachExpandButtons();
        el("btnDownloadQsComparisonCsv")?.onclick = () => downloadComparisonCsv(rows);
        el("btnDownloadQsComparisonJson")?.onclick = () => downloadComparisonJson(rows);
        setStatus(`Rendered Q/S comparison for ${rows.length} sites.`);
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
    }

    window.addEventListener("DOMContentLoaded", init);
})();
