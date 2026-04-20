(function () {
    const Exp = window.SiteMonitorExperimental || {};
    let dcpAdapter = null;
    let sslAdapter = null;
    let currentAnalyticsReport = null;

    const el = (id) => document.getElementById(id);
    const QS_METHODS = {
        event_median_proxy: {
            label: "Event median / max drawdown",
            description: "Uses the median positive flow across the whole event divided by the maximum observed drawdown."
        },
        stable_tail_proxy: {
            label: "Stable-tail median / max drawdown",
            description: "Uses the median late-event stable flow divided by the maximum observed drawdown for the event."
        },
        current_proxy: {
            label: "Last flow / end drawdown",
            description: "Uses the last valid non-zero event flow divided by the end-of-event drawdown to preserve continuity with the earlier proxy."
        },
        late_mean_proxy: {
            label: "Late mean / max drawdown",
            description: "Uses the average late-event flow divided by the maximum observed drawdown."
        },
        max_stress_proxy: {
            label: "Max flow / max drawdown",
            description: "Uses the maximum observed flow and maximum drawdown as a stress-test Q/S proxy."
        }
    };

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

    function getSelectedQsMethod() {
        return String(el("qsMethod")?.value || "event_median_proxy");
    }

    function formatQsMethodLabel(method) {
        return QS_METHODS[method]?.label || method || "Event median / max drawdown";
    }

    function setQsMethodNote() {
        const target = el("qsMethodNote");
        if (!target) return;
        target.textContent = QS_METHODS[getSelectedQsMethod()]?.description || QS_METHODS.event_median_proxy.description;
    }

    function getBoreholeFilterText() {
        return String(el("boreholeFilter")?.value || "").trim().toLowerCase();
    }

    function matchesBoreholeFilter(source = {}, query = "") {
        if (!query) return true;
        return [
            source?.borehole_id,
            source?.site_id,
            source?.display_name,
            source?.api_id,
            source?.metadata?.serial,
            source?.metadata?.site_name,
            source?.metadata?.name
        ].filter(Boolean).some((value) => String(value).toLowerCase().includes(query));
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
        const eventRows = Exp.ComputeEventMetrics.computeEventMetrics(detected, {
            minDrawdownM: 0.05,
            qsMethod: options.qsMethod
        });
        const report = {
            provider: sourceRef.provider,
            raw,
            normalized,
            cleaned,
            detected,
            event_rows: eventRows
        };
        const dailyRows = Exp.DailyAnalytics.computeDailyAnalytics(report, {
            flowThreshold: options.flowThreshold,
            qsMethod: options.qsMethod
        });
        const rollingRows = Exp.RollingAnalytics.computeRollingAnalytics(dailyRows, dailyRows.event_detail_rows || [], {
            qsMethod: options.qsMethod
        });
        const boreholeSummary = Exp.BoreholeAnalytics.computeBoreholeAnalytics(normalized.source, dailyRows, rollingRows, {
            qsMethod: options.qsMethod
        });

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
        const qsMethodLabel = report.qs_method_label || "Event median / max drawdown";
        const stableTailSites = report.network_summary?.stable_tail_capable_site_count || 0;
        const shortBurstSites = report.network_summary?.short_burst_dominant_site_count || 0;
        target.innerHTML = `
            <ul>
                <li><strong>${report.network_summary?.site_count || 0}</strong> sources were processed using the real telemetry pipeline.</li>
                <li><strong>${ready}</strong> sources are currently in the stronger analysis-ready tiers.</li>
                <li>The active Q/S mode for this run was <strong>${qsMethodLabel}</strong>.</li>
                <li><strong>${stableTailSites}</strong> sources showed stable-tail event support, while <strong>${shortBurstSites}</strong> were dominated by short burst usage.</li>
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
            const qsMethod = getSelectedQsMethod();
            const qsMethodLabel = formatQsMethodLabel(qsMethod);
            const boreholeFilter = getBoreholeFilterText();
            const flowThreshold = Number(el("flowThreshold")?.value || 0.1);
            const graceHours = Number(el("graceHours")?.value || 2);
            const allSources = await adapter.listSources({ useProxy: true });
            const filteredSources = boreholeFilter
                ? allSources.filter((source) => matchesBoreholeFilter(source, boreholeFilter))
                : allSources;
            const selected = [...filteredSources]
                .sort((a, b) => {
                    const aTs = Date.parse(a.metadata?.most_recent_tx || a.metadata?.last_seen || 0) || 0;
                    const bTs = Date.parse(b.metadata?.most_recent_tx || b.metadata?.last_seen || 0) || 0;
                    return bTs - aTs;
                })
                .slice(0, getSelectedLimit());

            if (!selected.length) {
                setStatus(boreholeFilter ? `No sources matched the borehole filter "${boreholeFilter}".` : "No sources were available for the selected provider.", true);
                return;
            }

            const dailyRows = [];
            const rollingRows = [];
            const boreholeRows = [];
            const sourceReports = [];
            const batchSize = boreholeFilter ? 1 : (el("provider")?.value === "SonSetLink" ? 3 : 4);

            for (let i = 0; i < selected.length; i += batchSize) {
                const batch = selected.slice(i, i + batchSize);
                const results = await Promise.all(batch.map(async (source) => {
                    try {
                        return await analyzeSource(source, { window, flowThreshold, graceHours, qsMethod });
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

                setStatus(`Processed ${Math.min(i + batchSize, selected.length)} of ${selected.length} sources using ${qsMethodLabel}${boreholeFilter ? ` for borehole filter \"${boreholeFilter}\"` : ""}.`);
            }

            if (!boreholeRows.length) {
                setStatus("No telemetry could be processed for the selected cohort.", true);
                return;
            }

            const network = Exp.NetworkAnalytics.computeNetworkAnalytics(boreholeRows, { qsMethod });
            const interpretation = Exp.InterpretationOutputs.computeInterpretationOutputs(boreholeRows, network, {});
            currentAnalyticsReport = {
                exported_at: new Date().toISOString(),
                provider: el("provider")?.value || "DCP",
                date_window: {
                    start: window.start.toISOString(),
                    end: window.end.toISOString()
                },
                analytics_note: `Experimental isolated analytics layer using real normalized telemetry and event outputs. Active Q/S mode: ${qsMethodLabel}.`,
                qs_method_selected: qsMethod,
                qs_method_label: qsMethodLabel,
                borehole_filter: boreholeFilter || null,
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
            setStatus(`Completed cohort analytics for ${boreholeRows.length} sources using ${qsMethodLabel}.`);
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
        el("qsMethod")?.addEventListener("change", setQsMethodNote);
        setQsMethodNote();
        setStatus("Experimental analytics lab ready. You can optionally filter to a borehole before running the heavier analysis.");

        const params = new URLSearchParams(window.location.search);
        if (params.get("provider")) {
            el("provider").value = params.get("provider");
        }
        if (params.get("maxSources")) {
            el("maxSources").value = params.get("maxSources");
        }
        if (params.get("qsMethod")) {
            el("qsMethod").value = params.get("qsMethod");
            setQsMethodNote();
        }
        if (params.get("borehole")) {
            el("boreholeFilter").value = params.get("borehole");
        }
        if (params.get("autorun") === "1") {
            runCohortAnalytics();
        }
    });
})();