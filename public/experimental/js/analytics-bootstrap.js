(function () {
    const Exp = window.SiteMonitorExperimental || {};
    let dcpAdapter = null;
    let sslAdapter = null;
    let currentAnalyticsReport = null;

    const el = (id) => document.getElementById(id);

    function setStatus(message, isError = false) {
        const target = el("status");
        if (!target) return;
        target.textContent = message;
        target.style.color = isError ? "#b91c1c" : "#334155";
    }

    function ensureModulesReady() {
        if (!Exp.DcpAdapter?.DcpTelemetryAdapter || !Exp.SonSetLinkAdapter?.SonSetLinkTelemetryAdapter || !Exp.CleanBoreholeSeries || !Exp.DetectPumpingEventsExperimental || !Exp.ComputeEventMetrics || !Exp.DailyAnalytics || !Exp.RollingAnalytics || !Exp.BoreholeAnalytics || !Exp.NetworkAnalytics || !Exp.InterpretationOutputs || !Exp.RenderAnalyticsTables) {
            throw new Error("One or more experimental analytics modules failed to load.");
        }
    }

    function getSelectedAdapter() {
        return el("provider")?.value === "SonSetLink" ? sslAdapter : dcpAdapter;
    }

    function getDateWindow() {
        const start = new Date(el("startDate").value);
        const end = new Date(el("endDate").value);
        if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end <= start) {
            throw new Error("Select a valid analysis date window.");
        }
        return { start, end };
    }

    function getSelectedLimit() {
        const raw = Number(el("maxSources")?.value || 8);
        return Number.isFinite(raw) && raw > 0 ? Math.min(54, Math.max(1, Math.round(raw))) : 8;
    }

    async function analyzeSource(sourceRef, options = {}) {
        const adapter = sourceRef?.provider === "SonSetLink" ? sslAdapter : dcpAdapter;
        const raw = await adapter.fetchTelemetry(sourceRef, options.window, { deepScan: false, useProxy: true });
        const normalized = adapter.normalize(raw);
        const cleaned = Exp.CleanBoreholeSeries.cleanBoreholeSeries(normalized, {});
        const detected = Exp.DetectPumpingEventsExperimental.detectPumpingEvents(cleaned, {
            flowThreshold: options.flowThreshold,
            graceHours: options.graceHours
        });
        const eventRows = Exp.ComputeEventMetrics.computeEventMetrics(detected, { minDrawdownM: 0.05 });
        const report = {
            provider: sourceRef.provider,
            raw,
            normalized,
            cleaned,
            detected,
            event_rows: eventRows
        };
        const dailyRows = Exp.DailyAnalytics.computeDailyAnalytics(report, { flowThreshold: options.flowThreshold });
        const rollingRows = Exp.RollingAnalytics.computeRollingAnalytics(dailyRows, dailyRows.event_detail_rows || [], {});
        const boreholeSummary = Exp.BoreholeAnalytics.computeBoreholeAnalytics(normalized.source, dailyRows, rollingRows, {});

        return {
            report,
            daily_rows: dailyRows,
            rolling_rows: rollingRows,
            borehole_summary: boreholeSummary
        };
    }

    function renderNarrative(report = {}) {
        const target = el("plainEnglish");
        if (!target) return;
        const topVolume = [...(report.borehole_summary_table || [])].sort((a, b) => (b.total_volume_m3 || 0) - (a.total_volume_m3 || 0))[0];
        const ready = (report.borehole_summary_table || []).filter((row) => ["A", "B"].includes(row.analysis_readiness_tier)).length;
        const stressedOrDeclining = (report.health_summary_table || []).filter((row) => ["stressed", "declining_performance"].includes(row.status_category)).length;
        const topPriority = (report.priority_ranking_table || [])[0];
        target.innerHTML = `
            <ul>
                <li><strong>${report.network_summary?.site_count || 0}</strong> sources were processed using the real telemetry pipeline.</li>
                <li><strong>${ready}</strong> sources are currently in the stronger analysis-ready tiers.</li>
                <li><strong>${stressedOrDeclining}</strong> boreholes currently fall into the stressed or declining review categories.</li>
                <li>The top observed abstraction source in this run was <strong>${topVolume?.display_name || "n/a"}</strong>.</li>
                <li>The current top review priority is <strong>${topPriority?.display_name || "n/a"}</strong> (${topPriority?.maintenance_priority_label || "routine monitoring"}).</li>
                <li>Any SonSetLink rows shown here should still be interpreted as <strong>screening-level</strong> estimates.</li>
            </ul>`;
    }

    async function runCohortAnalytics() {
        try {
            setStatus("Loading real telemetry sources for the cohort analytics run...");
            const adapter = getSelectedAdapter();
            const window = getDateWindow();
            const flowThreshold = Number(el("flowThreshold")?.value || 0.1);
            const graceHours = Number(el("graceHours")?.value || 2);
            const allSources = await adapter.listSources({ useProxy: true });
            const selected = [...allSources]
                .sort((a, b) => {
                    const aTs = Date.parse(a.metadata?.most_recent_tx || a.metadata?.last_seen || 0) || 0;
                    const bTs = Date.parse(b.metadata?.most_recent_tx || b.metadata?.last_seen || 0) || 0;
                    return bTs - aTs;
                })
                .slice(0, getSelectedLimit());

            if (!selected.length) {
                setStatus("No sources were available for the selected provider.", true);
                return;
            }

            const dailyRows = [];
            const rollingRows = [];
            const boreholeRows = [];
            const sourceReports = [];
            const batchSize = el("provider")?.value === "SonSetLink" ? 3 : 4;

            for (let i = 0; i < selected.length; i += batchSize) {
                const batch = selected.slice(i, i + batchSize);
                const results = await Promise.all(batch.map(async (source) => {
                    try {
                        return await analyzeSource(source, { window, flowThreshold, graceHours });
                    } catch (error) {
                        return { error, source };
                    }
                }));

                results.forEach((result) => {
                    if (!result || result.error) return;
                    dailyRows.push(...(result.daily_rows || []));
                    rollingRows.push(...(result.rolling_rows || []));
                    boreholeRows.push(result.borehole_summary);
                    sourceReports.push(result.report);
                });

                setStatus(`Processed ${Math.min(i + batchSize, selected.length)} of ${selected.length} sources using real telemetry.`);
            }

            const network = Exp.NetworkAnalytics.computeNetworkAnalytics(boreholeRows, {});
            const interpretation = Exp.InterpretationOutputs.computeInterpretationOutputs(boreholeRows, network, {});
            currentAnalyticsReport = {
                exported_at: new Date().toISOString(),
                provider: el("provider")?.value || "DCP",
                date_window: {
                    start: window.start.toISOString(),
                    end: window.end.toISOString()
                },
                analytics_note: "Experimental isolated analytics layer using real normalized telemetry and event outputs.",
                daily_rows: dailyRows.sort((a, b) => `${a.borehole_id}|${a.date}`.localeCompare(`${b.borehole_id}|${b.date}`)),
                rolling_rows: rollingRows.sort((a, b) => `${a.borehole_id}|${a.date}`.localeCompare(`${b.borehole_id}|${b.date}`)),
                borehole_summary_table: boreholeRows.sort((a, b) => String(a.display_name).localeCompare(String(b.display_name))),
                ...network,
                ...interpretation,
                source_reports: sourceReports
            };

            Exp.RenderAnalyticsTables.renderAnalyticsTables({
                summary: el("analyticsSummary"),
                categoryGuide: el("categoryGuide"),
                health: el("healthSummaryTable"),
                priority: el("priorityRankingTable"),
                daily: el("dailySummaryTable"),
                rolling: el("rollingSummaryTable"),
                borehole: el("boreholeSummaryTable"),
                network: el("networkComparisonTable")
            }, currentAnalyticsReport);
            renderNarrative(currentAnalyticsReport);
            if (el("btnJsonAnalytics")) el("btnJsonAnalytics").disabled = false;
            window.SiteMonitorExperimental = window.SiteMonitorExperimental || {};
            window.SiteMonitorExperimental.currentAnalyticsReport = currentAnalyticsReport;
            setStatus(`Completed cohort analytics for ${boreholeRows.length} sources using the real telemetry pipeline.`);
        } catch (error) {
            setStatus(`Analytics failed: ${error.message}`, true);
        }
    }

    function downloadCurrentJson() {
        if (!currentAnalyticsReport) return;
        Exp.ExportJson.downloadJson(currentAnalyticsReport, "experimental_analytics_report.json");
    }

    window.addEventListener("DOMContentLoaded", () => {
        try {
            ensureModulesReady();
            dcpAdapter = new Exp.DcpAdapter.DcpTelemetryAdapter();
            sslAdapter = new Exp.SonSetLinkAdapter.SonSetLinkTelemetryAdapter();
        } catch (error) {
            setStatus(`Initialization failed: ${error.message}`, true);
            if (el("btnRunAnalytics")) el("btnRunAnalytics").disabled = true;
            return;
        }

        const today = new Date();
        const start = new Date();
        start.setDate(today.getDate() - 30);
        el("startDate").value = start.toISOString().split("T")[0];
        el("endDate").value = today.toISOString().split("T")[0];
        el("btnRunAnalytics").addEventListener("click", runCohortAnalytics);
        el("btnJsonAnalytics").addEventListener("click", downloadCurrentJson);
        setStatus("Experimental analytics lab ready. This page remains isolated from the live dashboard.");

        const params = new URLSearchParams(window.location.search);
        if (params.get("provider")) {
            el("provider").value = params.get("provider");
        }
        if (params.get("maxSources")) {
            el("maxSources").value = params.get("maxSources");
        }
        if (params.get("autorun") === "1") {
            runCohortAnalytics();
        }
    });
})();