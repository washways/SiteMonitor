(function () {
    const Exp = window.SiteMonitorExperimental || {};
    const dcpAdapter = new Exp.DcpAdapter.DcpTelemetryAdapter();
    const sslAdapter = new Exp.SonSetLinkAdapter.SonSetLinkTelemetryAdapter();
    let currentReport = null;

    const el = (id) => document.getElementById(id);

    function getSelectedAdapter() {
        return el("provider").value === "SonSetLink" ? sslAdapter : dcpAdapter;
    }

    function setStatus(message, isError = false) {
        const target = el("status");
        if (!target) return;
        target.textContent = message;
        target.style.color = isError ? "#b91c1c" : "#334155";
    }

    function updateInputHints() {
        const provider = el("provider").value;
        const label = el("sourceLabel");
        const serialWrap = el("serialWrap");
        if (provider === "SonSetLink") {
            label.textContent = "Site ID";
            serialWrap.style.display = "block";
            el("sourceId").placeholder = "Example: 811";
            el("serial").placeholder = "Example: SN-375";
        } else {
            label.textContent = "Borehole ID";
            serialWrap.style.display = "none";
            el("sourceId").placeholder = "Example: 500936";
        }
    }

    async function fillFirstAvailable() {
        try {
            setStatus("Fetching the first available source for the selected provider...");
            const adapter = getSelectedAdapter();
            const sources = await adapter.listSources({});
            if (!sources.length) {
                setStatus("No sources were returned by the selected provider.", true);
                return;
            }
            const first = sources[0];
            el("sourceId").value = first.site_id || first.borehole_id || "";
            if (el("provider").value === "SonSetLink") {
                el("serial").value = first.metadata?.serial || first.borehole_id || "";
            }
            setStatus(`Loaded a sample source: ${first.display_name}`);
        } catch (error) {
            setStatus(`Failed to fetch sample source: ${error.message}`, true);
        }
    }

    function buildSourceRef() {
        const provider = el("provider").value;
        const sourceId = String(el("sourceId").value || "").trim();
        const serial = String(el("serial").value || "").trim();
        if (!sourceId) {
            throw new Error(provider === "SonSetLink" ? "Enter a site ID." : "Enter a borehole ID.");
        }
        if (provider === "SonSetLink" && !serial) {
            throw new Error("Enter a SonSetLink serial value.");
        }
        return provider === "SonSetLink"
            ? {
                source_id: `SSL:${serial}`,
                api_id: "API-002",
                provider,
                site_id: sourceId,
                borehole_id: serial,
                display_name: serial,
                metadata: { serial }
            }
            : {
                source_id: `DCP:${sourceId}`,
                api_id: "API-001",
                provider,
                site_id: sourceId,
                borehole_id: sourceId,
                display_name: sourceId,
                metadata: {}
            };
    }

    function renderDiagnostics(report) {
        const diag = el("diagnostics");
        if (!diag || !report) return;
        const rawFlowCount = report.provider === "DCP"
            ? (report.raw?.raw?.flow?.time_series?.values || []).length
            : (report.raw?.raw?.rows || []).length;
        const levelCount = report.normalized?.series?.water_level_above_pump?.length || 0;
        const cleanedFlags = (report.cleaned?.flags || []).map((flag) => `${flag.severity}: ${flag.message}`);
        diag.textContent = JSON.stringify({
            source: report.normalized?.source,
            raw_flow_count: rawFlowCount,
            normalized_flow_count: report.normalized?.series?.flow?.length || 0,
            normalized_level_count: levelCount,
            cleaned_flags: cleanedFlags,
            active_event_state: report.detected?.active_event_state,
            completed_event_count: report.event_rows?.length || 0
        }, null, 2);
    }

    function renderReport(report) {
        currentReport = report;
        window.SiteMonitorExperimental.currentReport = report;
        const rawFlowCount = report.provider === "DCP"
            ? (report.raw?.raw?.flow?.time_series?.values || []).length
            : (report.raw?.raw?.rows || []).length;
        const cleanedFlowCount = report.cleaned?.cleaned_bundle?.series?.flow?.length || 0;
        Exp.RenderReviewTable.renderReviewTable(el("results"), report.event_rows || [], {
            sourceName: report.normalized?.source?.display_name,
            rawFlowCount,
            cleanedFlowCount
        });
        renderDiagnostics(report);
        el("btnCsv").disabled = !report.event_rows?.length;
        el("btnJson").disabled = !report.event_rows?.length;
    }

    async function runAnalysis() {
        try {
            setStatus("Running isolated experimental telemetry analysis...");
            const adapter = getSelectedAdapter();
            const sourceRef = buildSourceRef();
            const start = new Date(el("startDate").value);
            const end = new Date(el("endDate").value);
            if (!(start instanceof Date) || Number.isNaN(start.getTime()) || !(end instanceof Date) || Number.isNaN(end.getTime())) {
                throw new Error("Select a valid date window.");
            }

            const raw = await adapter.fetchTelemetry(sourceRef, { start, end }, { deepScan: false });
            const normalized = adapter.normalize(raw);
            const cleaned = Exp.CleanBoreholeSeries.cleanBoreholeSeries(normalized, {});
            const detected = Exp.DetectPumpingEventsExperimental.detectPumpingEvents(cleaned, {
                flowThreshold: Number(el("flowThreshold").value || 0.1),
                graceHours: Number(el("graceHours").value || 2)
            });
            const eventRows = Exp.ComputeEventMetrics.computeEventMetrics(detected, {
                minDrawdownM: 0.05
            });

            renderReport({
                provider: sourceRef.provider,
                raw,
                normalized,
                cleaned,
                detected,
                event_rows: eventRows
            });
            setStatus(`Completed isolated analysis. ${eventRows.length} event rows were produced.`);
        } catch (error) {
            setStatus(`Analysis failed: ${error.message}`, true);
            el("results").innerHTML = `<p class="error">${error.message}</p>`;
        }
    }

    function downloadCurrentCsv() {
        if (!currentReport?.event_rows?.length) return;
        Exp.ExportCsv.downloadCsv(currentReport.event_rows);
    }

    function downloadCurrentJson() {
        if (!currentReport) return;
        Exp.ExportJson.downloadJson(currentReport);
    }

    window.addEventListener("DOMContentLoaded", () => {
        const today = new Date();
        const start = new Date();
        start.setDate(today.getDate() - 30);
        el("startDate").value = start.toISOString().split("T")[0];
        el("endDate").value = today.toISOString().split("T")[0];
        el("provider").addEventListener("change", updateInputHints);
        el("btnSample").addEventListener("click", fillFirstAvailable);
        el("btnRun").addEventListener("click", runAnalysis);
        el("btnCsv").addEventListener("click", downloadCurrentCsv);
        el("btnJson").addEventListener("click", downloadCurrentJson);
        updateInputHints();
        setStatus("Experimental telemetry lab ready. This page is isolated from the live dashboard.");
    });
})();