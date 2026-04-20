(function () {
    const Utils = window.SiteMonitorExperimentalVizUtils;
    const Loader = window.SiteMonitorExperimentalVizLoader;
    const DEFAULT_REPORT_URL = "";
    let reportIndex = null;

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
        addOptions(el("filterPriority"), rows.map((row) => row.maintenance_priority_label), "All priorities");
        addOptions(el("filterConfidence"), rows.map((row) => row.evidence_confidence_label), "All confidence levels");
        addOptions(el("filterOperationalBucket"), rows.map((row) => row.operational_bucket), "All review buckets");
    }

    function getFiltered() {
        return Loader.applyFilters(reportIndex, Loader.getFilterValues(document));
    }

    function renderKpis(filtered) {
        const rows = filtered.healthRows.length ? filtered.healthRows : filtered.baseRows;
        const urgent = rows.filter((row) => row.operational_bucket === "urgent field visit").length;
        const planned = rows.filter((row) => row.operational_bucket === "planned field review").length;
        const highEvidence = rows.filter((row) => row.evidence_confidence_label === "high evidence support").length;
        const possibleRunDry = rows.filter((row) => (Number(row.run_dry_candidate_event_share) || 0) >= 0.3).length;
        const unreliable = rows.filter((row) => row.status_category === "unreliable_or_possible_fault").length;

        el("reviewKpis").innerHTML = `
            <div class="kpi-grid">
                <div class="kpi-card"><div class="label">Urgent field visits</div><div class="value">${urgent}</div></div>
                <div class="kpi-card"><div class="label">Planned field reviews</div><div class="value">${planned}</div></div>
                <div class="kpi-card"><div class="label">High evidence support</div><div class="value">${highEvidence}</div></div>
                <div class="kpi-card"><div class="label">Possible run-dry patterns</div><div class="value">${possibleRunDry}</div></div>
                <div class="kpi-card"><div class="label">Possible sensor / fault cases</div><div class="value">${unreliable}</div></div>
            </div>`;
    }

    function renderBucketChart(filtered) {
        const rows = filtered.healthRows;
        const labels = Utils.unique(rows.map((row) => row.operational_bucket || "routine watch"));
        const counts = labels.map((label) => rows.filter((row) => (row.operational_bucket || "routine watch") === label).length);
        Plotly.newPlot(el("bucketChart"), [{
            type: "bar",
            x: labels,
            y: counts,
            marker: { color: ["#dc2626", "#ea580c", "#0284c7", "#16a34a"] }
        }], {
            title: "Operational review buckets",
            margin: { t: 45, l: 45, r: 20, b: 80 },
            xaxis: { tickangle: -18 },
            yaxis: { title: "Boreholes" }
        }, { responsive: true, displayModeBar: false });
    }

    function renderReviewScatter(filtered) {
        const rows = filtered.healthRows;
        Plotly.newPlot(el("reviewScatter"), [{
            type: "scatter",
            mode: "markers",
            x: rows.map((row) => row.evidence_confidence_score || 0),
            y: rows.map((row) => row.maintenance_priority_score || 0),
            text: rows.map((row) => `${row.display_name || row.borehole_id}<br>${row.field_check_focus || "—"}`),
            customdata: rows,
            marker: {
                size: rows.map((row) => Math.max(12, Math.sqrt(Utils.safeNumber(row.total_volume_m3) || 0) * 2 + 10)),
                color: rows.map((row) => Utils.statusColor(row.status_category)),
                line: { color: "#1e293b", width: 1 },
                opacity: 0.85
            },
            hovertemplate: "%{text}<br>Evidence confidence: %{x}<br>Priority score: %{y}<extra></extra>"
        }], {
            title: "Priority versus evidence confidence",
            margin: { t: 45, l: 55, r: 20, b: 55 },
            xaxis: { title: "Evidence confidence score", range: [0, 100] },
            yaxis: { title: "Maintenance priority score", range: [0, 100] }
        }, { responsive: true, displayModeBar: false });

        el("reviewScatter").on("plotly_click", (event) => {
            const row = event.points?.[0]?.customdata;
            if (row) window.location.href = boreholeUrl(row);
        });
    }

    function renderTable(filtered) {
        const rows = [...filtered.healthRows]
            .sort((a, b) => ((b.maintenance_priority_score || 0) - (a.maintenance_priority_score || 0)) || ((b.evidence_confidence_score || 0) - (a.evidence_confidence_score || 0)));

        const html = `
            <table class="viz-table">
                <thead>
                    <tr>
                        <th>Borehole</th>
                        <th>Status</th>
                        <th>Priority</th>
                        <th>Evidence</th>
                        <th>Review bucket</th>
                        <th>Field focus</th>
                        <th>Run-dry share</th>
                        <th>Action</th>
                    </tr>
                </thead>
                <tbody>
                    ${rows.map((row) => `
                        <tr>
                            <td><a href="${boreholeUrl(row)}">${Utils.escapeHtml(row.display_name || row.borehole_id)}</a></td>
                            <td>${Utils.escapeHtml(row.status_label || row.status_category || "—")}</td>
                            <td>${Utils.escapeHtml(row.maintenance_priority_label || "—")}</td>
                            <td>${Utils.escapeHtml(row.evidence_confidence_label || "—")}</td>
                            <td>${Utils.escapeHtml(row.operational_bucket || "—")}</td>
                            <td>${Utils.escapeHtml(row.field_check_focus || "—")}</td>
                            <td>${Utils.formatPercent(row.run_dry_candidate_event_share || 0, 0)}</td>
                            <td>${Utils.escapeHtml(row.recommended_action || "—")}</td>
                        </tr>`).join("")}
                </tbody>
            </table>`;

        el("reviewTable").innerHTML = `<div class="table-wrap">${html}</div>`;
    }

    function downloadReviewCsv() {
        const filtered = getFiltered();
        Utils.downloadCsv("field_review_board.csv", filtered.healthRows || []);
        setStatus(`Downloaded review CSV for ${filtered.healthRows.length} boreholes.`);
    }

    function downloadReviewJson() {
        Utils.downloadJson("field_review_report.json", reportIndex?.report || {});
        setStatus("Downloaded the current report JSON.");
    }

    function renderAll() {
        const filtered = getFiltered();
        if (!filtered.healthRows.length) {
            el("reviewKpis").innerHTML = "<p>No boreholes match the current filters.</p>";
            setStatus("No boreholes match the current filters.", true);
            return;
        }
        renderKpis(filtered);
        renderBucketChart(filtered);
        renderReviewScatter(filtered);
        renderTable(filtered);
        Utils.attachExpandButtons();
        setStatus(`Rendered field review board for ${filtered.healthRows.length} boreholes.`);
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
        el("btnDownloadReviewCsv")?.addEventListener("click", downloadReviewCsv);
        el("btnDownloadReviewJson")?.addEventListener("click", downloadReviewJson);
    }

    window.addEventListener("DOMContentLoaded", init);
})();
