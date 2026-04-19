(function () {
    const Utils = window.SiteMonitorExperimentalVizUtils;
    const Loader = window.SiteMonitorExperimentalVizLoader;
    const DEFAULT_REPORT_URL = "";
    let reportIndex = null;

    const el = (id) => document.getElementById(id);

    function setStatus(message, isError = false) {
        Loader.setStatus(el("pageStatus"), message, isError);
    }

    function boreholeUrl(row) {
        const params = new URLSearchParams();
        params.set("borehole", row.borehole_id || row.display_name || "");
        if (row.provider) params.set("provider", row.provider);
        window.location.href = `borehole-detail.html?${params.toString()}`;
    }

    function forceSonSetLinkDefaults() {
        if (el("analysisProvider")) el("analysisProvider").value = "SonSetLink";
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
        addOptions(el("filterEvidenceLane"), rows.map((row) => row.evidence_lane_label), "All evidence lanes");

        if (el("filterProvider") && !el("filterProvider").value) {
            el("filterProvider").value = rows.some((row) => row.provider === "SonSetLink") ? "SonSetLink" : "";
        }
        if (el("filterEvidenceLane") && !el("filterEvidenceLane").value) {
            el("filterEvidenceLane").value = rows.some((row) => row.evidence_lane_label === "screening lane") ? "screening lane" : "";
        }

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
        const activeSites = rows.filter((row) => (Utils.safeNumber(row.active_day_share) || 0) > 0).length;
        const lowEvidence = rows.filter((row) => ["low evidence support", "limited evidence support"].includes(row.evidence_confidence_label)).length;
        const stressed = rows.filter((row) => ["stressed", "declining_performance", "unreliable_or_possible_fault"].includes(row.status_category)).length;
        const totalVolume = rows.reduce((sum, row) => sum + (Utils.safeNumber(row.total_volume_m3) || 0), 0);

        el("screeningKpis").innerHTML = `
            <div class="kpi-grid">
                <div class="kpi-card"><div class="label">Sites in screening view</div><div class="value">${rows.length}</div></div>
                <div class="kpi-card"><div class="label">Active sites</div><div class="value">${activeSites}</div></div>
                <div class="kpi-card"><div class="label">Screening-only evidence</div><div class="value">${rows.filter((row) => row.evidence_lane_label === "screening lane").length}</div></div>
                <div class="kpi-card"><div class="label">Low or limited evidence</div><div class="value">${lowEvidence}</div></div>
                <div class="kpi-card"><div class="label">Stress-review candidates</div><div class="value">${stressed}</div></div>
                <div class="kpi-card"><div class="label">Observed volume</div><div class="value">${Utils.formatNumber(totalVolume, 1)}</div></div>
            </div>`;

        el("screeningNote").innerHTML = `<p><strong>Screening note:</strong> This page is for SonSetLink operational screening. Use it for activity, load, and caution flags, not direct hydrogeologic ranking against the DCP analytical lane.</p>`;
    }

    function renderStatusChart(filtered) {
        const rows = filtered.healthRows;
        const labels = Utils.unique(rows.map((row) => row.status_label || row.status_category));
        const counts = labels.map((label) => rows.filter((row) => (row.status_label || row.status_category) === label).length);
        Plotly.newPlot(el("screeningStatusChart"), [{
            type: "bar",
            x: labels,
            y: counts,
            marker: { color: labels.map((label) => Utils.statusColor((rows.find((row) => (row.status_label || row.status_category) === label) || {}).status_category)) }
        }], {
            title: "Screening status breakdown",
            margin: { t: 45, l: 45, r: 20, b: 90 },
            xaxis: { tickangle: -20 },
            yaxis: { title: "Sites" }
        }, { responsive: true, displayModeBar: false });
    }

    function renderScatter(filtered) {
        const rows = filtered.healthRows;
        Plotly.newPlot(el("screeningScatter"), [{
            type: "scatter",
            mode: "markers",
            x: rows.map((row) => Utils.safeNumber(row.active_day_share) || 0),
            y: rows.map((row) => Utils.safeNumber(row.total_volume_m3) || 0),
            text: rows.map((row) => `${row.display_name || row.borehole_id}<br>${row.evidence_confidence_label || "—"}<br>${row.field_check_focus || "—"}`),
            customdata: rows,
            marker: {
                size: rows.map((row) => Math.max(12, (Utils.safeNumber(row.maintenance_priority_score) || 0) / 4 + 10)),
                color: rows.map((row) => Utils.statusColor(row.status_category)),
                line: { color: "#1e293b", width: 1 },
                opacity: 0.85
            },
            hovertemplate: "%{text}<br>Active-day share: %{x:.2f}<br>Total volume: %{y}<extra></extra>"
        }], {
            title: "Activity versus volume screening view",
            margin: { t: 45, l: 55, r: 20, b: 55 },
            xaxis: { title: "Active-day share", range: [0, 1.05] },
            yaxis: { title: "Observed volume" }
        }, { responsive: true, displayModeBar: false });

        el("screeningScatter").on("plotly_click", (event) => {
            const row = event.points?.[0]?.customdata;
            if (row) boreholeUrl(row);
        });
    }

    function renderTable(filtered) {
        const rows = [...filtered.healthRows].sort((a, b) => ((b.maintenance_priority_score || 0) - (a.maintenance_priority_score || 0)) || ((b.total_volume_m3 || 0) - (a.total_volume_m3 || 0)));
        const html = `
            <table class="viz-table">
                <thead>
                    <tr>
                        <th>Borehole</th>
                        <th>Status</th>
                        <th>Readiness</th>
                        <th>Evidence</th>
                        <th>Active-day share</th>
                        <th>Observed volume</th>
                        <th>Review focus</th>
                        <th>Comparison lane</th>
                    </tr>
                </thead>
                <tbody>
                    ${rows.map((row) => `
                        <tr>
                            <td><a href="borehole-detail.html?borehole=${encodeURIComponent(row.borehole_id || row.display_name || "")}&provider=${encodeURIComponent(row.provider || "")}">${Utils.escapeHtml(row.display_name || row.borehole_id)}</a></td>
                            <td>${Utils.escapeHtml(row.status_label || row.status_category || "—")}</td>
                            <td>${Utils.escapeHtml(row.analysis_readiness_tier || "—")}</td>
                            <td>${Utils.escapeHtml(row.evidence_confidence_label || "—")}</td>
                            <td>${Utils.formatPercent(row.active_day_share || 0, 0)}</td>
                            <td>${Utils.formatNumber(row.total_volume_m3 || 0, 1)}</td>
                            <td>${Utils.escapeHtml(row.field_check_focus || "—")}</td>
                            <td>${Utils.escapeHtml(row.comparison_lane_label || "—")}</td>
                        </tr>`).join("")}
                </tbody>
            </table>`;
        el("screeningTable").innerHTML = `<div class="table-wrap">${html}</div>`;
    }

    function downloadScreeningCsv() {
        const filtered = getFiltered();
        Utils.downloadCsv("sonsetlink_screening_board.csv", filtered.healthRows || []);
        setStatus(`Downloaded screening CSV for ${filtered.healthRows.length} boreholes.`);
    }

    function downloadScreeningJson() {
        Utils.downloadJson("sonsetlink_screening_report.json", reportIndex?.report || {});
        setStatus("Downloaded the current report JSON.");
    }

    function renderAll() {
        const filtered = getFiltered();
        if (!filtered.healthRows.length) {
            el("screeningKpis").innerHTML = "<p>No boreholes match the current filters.</p>";
            setStatus("No SonSetLink screening rows match the current filters.", true);
            return;
        }
        renderKpis(filtered);
        renderStatusChart(filtered);
        renderScatter(filtered);
        renderTable(filtered);
        Utils.attachExpandButtons();
        setStatus(`Rendered screening board for ${filtered.healthRows.length} boreholes.`);
    }

    async function loadPreferredReport() {
        try {
            reportIndex = await Loader.loadReport({
                defaultUrl: DEFAULT_REPORT_URL,
                statusTarget: el("pageStatus"),
                root: document,
                runLiveIfMissing: false,
                provider: "SonSetLink"
            });
            if ((reportIndex?.report?.provider || "") !== "SonSetLink") {
                reportIndex = await Loader.runLiveAnalysis({ root: document, statusTarget: el("pageStatus") });
            }
        } catch (error) {
            reportIndex = await Loader.runLiveAnalysis({ root: document, statusTarget: el("pageStatus") });
        }
    }

    async function init() {
        Loader.populateAnalysisControls(document);
        forceSonSetLinkDefaults();

        try {
            await loadPreferredReport();
            populateFilters(reportIndex);
            renderAll();
        } catch (error) {
            setStatus(error.message, true);
        }

        el("btnRunLiveAnalysis")?.addEventListener("click", async () => {
            try {
                forceSonSetLinkDefaults();
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
            forceSonSetLinkDefaults();
            reportIndex = await Loader.loadReport({ url: el("reportUrl")?.value || "", statusTarget: el("pageStatus"), provider: "SonSetLink" });
            populateFilters(reportIndex);
            renderAll();
        });

        document.querySelectorAll("input[id^='filter'], select[id^='filter']").forEach((node) => node.addEventListener("change", renderAll));
        el("btnDownloadScreeningCsv")?.addEventListener("click", downloadScreeningCsv);
        el("btnDownloadScreeningJson")?.addEventListener("click", downloadScreeningJson);
    }

    window.addEventListener("DOMContentLoaded", init);
})();
