(function (global, factory) {
    const api = factory(global);
    if (typeof module !== "undefined" && module.exports) {
        module.exports = api;
    }
    global.SiteMonitorExperimentalVizLoader = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function (global) {
    const Utils = global.SiteMonitorExperimentalVizUtils;
    const STORAGE_KEY = "sitemonitor.experimental.visualReport";
    const SETTINGS_KEY = "sitemonitor.experimental.visualSettings";
    const RUN_STATE_KEY = "sitemonitor.experimental.visualReportRunState";
    const DEFAULT_MAX_SOURCES = 54;
    let dcpAdapter = null;
    let sslAdapter = null;

    function normalizeReport(report = {}) {
        return {
            ...report,
            daily_rows: Array.isArray(report.daily_rows) ? report.daily_rows : [],
            rolling_rows: Array.isArray(report.rolling_rows) ? report.rolling_rows : [],
            borehole_summary_table: Array.isArray(report.borehole_summary_table) ? report.borehole_summary_table : [],
            health_summary_table: Array.isArray(report.health_summary_table) ? report.health_summary_table : [],
            priority_ranking_table: Array.isArray(report.priority_ranking_table) ? report.priority_ranking_table : [],
            network_comparison_table: Array.isArray(report.network_comparison_table) ? report.network_comparison_table : [],
            category_summary_table: Array.isArray(report.category_summary_table) ? report.category_summary_table : []
        };
    }

    async function fetchJson(url) {
        const response = await fetch(url, { cache: "no-store" });
        if (!response.ok) {
            throw new Error(`Could not load report JSON from ${url}`);
        }
        return normalizeReport(await response.json());
    }

    function safeStorageSet(report) {
        try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(report));
        } catch (error) {
            // ignore quota issues in the experimental layer
        }
    }

    function safeStorageGet() {
        try {
            const raw = localStorage.getItem(STORAGE_KEY);
            return raw ? normalizeReport(JSON.parse(raw)) : null;
        } catch (error) {
            return null;
        }
    }

    function safeSettingsSet(settings) {
        try {
            localStorage.setItem(SETTINGS_KEY, JSON.stringify({
                ...settings,
                startDate: Utils.toDateString(settings.window?.start || settings.startDate),
                endDate: Utils.toDateString(settings.window?.end || settings.endDate)
            }));
        } catch (error) {
            // ignore storage issues in the experimental layer
        }
    }

    function safeSettingsGet() {
        try {
            const raw = localStorage.getItem(SETTINGS_KEY);
            return raw ? JSON.parse(raw) : null;
        } catch (error) {
            return null;
        }
    }

    function safeRunStateSet(state) {
        try {
            localStorage.setItem(RUN_STATE_KEY, JSON.stringify(state));
        } catch (error) {
            // ignore storage issues in the experimental layer
        }
    }

    function safeRunStateGet() {
        try {
            const raw = localStorage.getItem(RUN_STATE_KEY);
            return raw ? JSON.parse(raw) : null;
        } catch (error) {
            return null;
        }
    }

    function buildIndex(report) {
        const baseRows = report.health_summary_table.length
            ? report.health_summary_table
            : (report.network_comparison_table.length ? report.network_comparison_table : report.borehole_summary_table);

        return {
            report,
            baseRows,
            dailyByKey: Utils.groupBy(report.daily_rows, Utils.boreholeKey),
            rollingByKey: Utils.groupBy(report.rolling_rows, Utils.boreholeKey),
            healthByKey: Utils.groupBy(report.health_summary_table, Utils.boreholeKey),
            priorityByKey: Utils.groupBy(report.priority_ranking_table, Utils.boreholeKey),
            comparisonByKey: Utils.groupBy(report.network_comparison_table, Utils.boreholeKey)
        };
    }

    function setStatus(target, message, isError) {
        if (!target) return;
        target.textContent = message;
        target.style.color = isError ? "#b91c1c" : "#334155";
    }

    function getQueryParams() {
        return new URLSearchParams(global.location?.search || "");
    }

    function getQueryReportUrl() {
        return getQueryParams().get("report") || "";
    }

    function buildDefaultAnalysisSettings() {
        const params = getQueryParams();
        const today = new Date();
        const start = new Date();
        start.setDate(today.getDate() - 30);
        const saved = safeSettingsGet() || {};

        return {
            provider: params.get("provider") || saved.provider || "DCP",
            startDate: params.get("startDate") || saved.startDate || Utils.toDateString(start),
            endDate: params.get("endDate") || saved.endDate || Utils.toDateString(today),
            maxSources: Math.min(54, Math.max(Number(params.get("maxSources") || saved.maxSources || DEFAULT_MAX_SOURCES) || DEFAULT_MAX_SOURCES, DEFAULT_MAX_SOURCES)),
            flowThreshold: Number(params.get("flowThreshold") || saved.flowThreshold || 0.1),
            graceHours: Number(params.get("graceHours") || saved.graceHours || 2)
        };
    }

    function populateAnalysisControls(root = document) {
        const byId = (id) => root.getElementById(id);
        const defaults = buildDefaultAnalysisSettings();
        if (byId("analysisProvider")) byId("analysisProvider").value = defaults.provider;
        if (byId("analysisStartDate")) byId("analysisStartDate").value = defaults.startDate;
        if (byId("analysisEndDate")) byId("analysisEndDate").value = defaults.endDate;
        if (byId("analysisMaxSources")) byId("analysisMaxSources").value = defaults.maxSources;
        if (byId("analysisFlowThreshold")) byId("analysisFlowThreshold").value = defaults.flowThreshold;
        if (byId("analysisGraceHours")) byId("analysisGraceHours").value = defaults.graceHours;
    }

    function getAnalysisSettings(root = document) {
        const byId = (id) => root.getElementById(id);
        const startDate = byId("analysisStartDate")?.value || "";
        const endDate = byId("analysisEndDate")?.value || "";
        const start = new Date(startDate);
        const end = new Date(endDate);
        if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end <= start) {
            throw new Error("Select a valid analysis date window.");
        }

        return {
            provider: byId("analysisProvider")?.value || "DCP",
            maxSources: Math.min(54, Math.max(1, Math.round(Number(byId("analysisMaxSources")?.value || 8) || 8))),
            flowThreshold: Number(byId("analysisFlowThreshold")?.value || 0.1),
            graceHours: Number(byId("analysisGraceHours")?.value || 2),
            window: { start, end }
        };
    }

    function ensureAnalyticsModulesReady() {
        const Exp = global.SiteMonitorExperimental || {};
        if (!Exp.DcpAdapter?.DcpTelemetryAdapter || !Exp.SonSetLinkAdapter?.SonSetLinkTelemetryAdapter || !Exp.CleanBoreholeSeries || !Exp.DetectPumpingEventsExperimental || !Exp.ComputeEventMetrics || !Exp.DailyAnalytics || !Exp.RollingAnalytics || !Exp.BoreholeAnalytics || !Exp.NetworkAnalytics || !Exp.InterpretationOutputs) {
            throw new Error("The live analytics modules are not available on this page.");
        }
        return Exp;
    }

    function getAdapters(Exp) {
        if (!dcpAdapter) dcpAdapter = new Exp.DcpAdapter.DcpTelemetryAdapter();
        if (!sslAdapter) sslAdapter = new Exp.SonSetLinkAdapter.SonSetLinkTelemetryAdapter();
        return { dcpAdapter, sslAdapter };
    }

    async function analyzeSource(Exp, sourceRef, options = {}) {
        const { dcpAdapter: dcp, sslAdapter: ssl } = getAdapters(Exp);
        const adapter = sourceRef?.provider === "SonSetLink" ? ssl : dcp;
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

    async function runLiveAnalysis(options = {}) {
        const root = options.root || document;
        const statusTarget = options.statusTarget || null;
        const settings = options.settings || getAnalysisSettings(root);
        const Exp = ensureAnalyticsModulesReady();
        const { dcpAdapter: dcp, sslAdapter: ssl } = getAdapters(Exp);
        const adapter = settings.provider === "SonSetLink" ? ssl : dcp;
        const runId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

        try {
            setStatus(statusTarget, "Loading real telemetry sources for the cohort analysis...");
            safeSettingsSet(settings);
            safeRunStateSet({
                status: "running",
                run_id: runId,
                started_at: new Date().toISOString(),
                provider: settings.provider,
                requested_max_sources: settings.maxSources
            });

            const allSources = await adapter.listSources({ useProxy: true });
            const selected = [...allSources]
                .sort((a, b) => {
                    const aTs = Date.parse(a.metadata?.most_recent_tx || a.metadata?.last_seen || 0) || 0;
                    const bTs = Date.parse(b.metadata?.most_recent_tx || b.metadata?.last_seen || 0) || 0;
                    return bTs - aTs;
                })
                .slice(0, settings.maxSources);

            if (!selected.length) {
                throw new Error("No sources were available for the selected provider.");
            }

            const dailyRows = [];
            const rollingRows = [];
            const boreholeRows = [];
            const sourceReports = [];
            const batchSize = settings.provider === "SonSetLink" ? 3 : 4;

            for (let i = 0; i < selected.length; i += batchSize) {
                const batch = selected.slice(i, i + batchSize);
                const results = await Promise.all(batch.map(async (source) => {
                    try {
                        return await analyzeSource(Exp, source, settings);
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

                setStatus(statusTarget, `Processed ${Math.min(i + batchSize, selected.length)} of ${selected.length} sources using real telemetry.`);
            }

            if (!boreholeRows.length) {
                throw new Error("No telemetry could be processed for the selected cohort.");
            }

            const network = Exp.NetworkAnalytics.computeNetworkAnalytics(boreholeRows, {});
            const interpretation = Exp.InterpretationOutputs.computeInterpretationOutputs(boreholeRows, network, {});
            const report = {
                exported_at: new Date().toISOString(),
                provider: settings.provider,
                cohort_request: {
                    requested_max_sources: settings.maxSources,
                    load_scope: settings.maxSources >= DEFAULT_MAX_SOURCES ? "full_available_cohort" : "limited_subset"
                },
                date_window: {
                    start: settings.window.start.toISOString(),
                    end: settings.window.end.toISOString()
                },
                analytics_note: "Experimental isolated analytics layer using real normalized telemetry and event outputs.",
                daily_rows: dailyRows.sort((a, b) => `${a.borehole_id}|${a.date}`.localeCompare(`${b.borehole_id}|${b.date}`)),
                rolling_rows: rollingRows.sort((a, b) => `${a.borehole_id}|${a.date}`.localeCompare(`${b.borehole_id}|${b.date}`)),
                borehole_summary_table: boreholeRows.sort((a, b) => String(a.display_name).localeCompare(String(b.display_name))),
                ...network,
                ...interpretation,
                source_reports: sourceReports
            };

            safeStorageSet(report);
            safeRunStateSet({
                status: "ready",
                run_id: runId,
                completed_at: new Date().toISOString(),
                provider: settings.provider,
                requested_max_sources: settings.maxSources,
                loaded_site_count: boreholeRows.length
            });
            const scopeLabel = settings.maxSources >= DEFAULT_MAX_SOURCES ? "full available cohort" : `${settings.maxSources}-source cohort`;
            setStatus(statusTarget, `Completed ${scopeLabel} analysis for ${boreholeRows.length} sources using the real telemetry pipeline.`);
            return buildIndex(report);
        } catch (error) {
            safeRunStateSet({
                status: "error",
                run_id: runId,
                message: error.message,
                failed_at: new Date().toISOString(),
                provider: settings.provider,
                requested_max_sources: settings.maxSources
            });
            throw error;
        }
    }

    async function waitForSharedReport(options = {}) {
        const statusTarget = options.statusTarget || null;
        const timeoutMs = options.timeoutMs || 120000;
        const startMs = Date.now();
        setStatus(statusTarget, "A full cohort load is already running in another page. Waiting to reuse it here...");

        while ((Date.now() - startMs) < timeoutMs) {
            const report = safeStorageGet();
            if (report?.cohort_request?.load_scope === "full_available_cohort") {
                const loadedCount = report.network_summary?.site_count || report.health_summary_table?.length || report.borehole_summary_table?.length || 0;
                setStatus(statusTarget, `Loaded cached cohort for ${loadedCount} boreholes from browser storage. Switching pages will reuse this same report.`);
                return buildIndex(report);
            }

            const runState = safeRunStateGet();
            if (runState?.status === "error") {
                throw new Error(runState.message || "The shared cohort load failed in another page.");
            }

            await new Promise((resolve) => setTimeout(resolve, 1000));
        }

        throw new Error("The shared cohort load is taking longer than expected. Please wait a moment and try again.");
    }

    async function loadReport(options = {}) {
        const statusTarget = options.statusTarget || null;
        const requestedUrl = options.url || getQueryReportUrl() || options.defaultUrl || "";

        try {
            setStatus(statusTarget, "Loading report data...");
            let report = null;
            let sourceLabel = "browser storage";

            if (requestedUrl) {
                report = await fetchJson(requestedUrl);
                sourceLabel = requestedUrl;
            } else {
                report = safeStorageGet();
            }

            const shouldSeedFullCohort = !!(
                options.runLiveIfMissing
                && !requestedUrl
                && (!report || report.cohort_request?.load_scope !== "full_available_cohort")
            );

            if (shouldSeedFullCohort) {
                const runState = safeRunStateGet();
                if (runState?.status === "running") {
                    return await waitForSharedReport({ statusTarget });
                }
                return await runLiveAnalysis({ root: options.root || document, statusTarget, settings: options.settings });
            }

            if (!report) {
                throw new Error("No report is loaded yet. Run the live analysis above or optionally load a saved report.");
            }

            safeStorageSet(report);
            const loadedCount = report.network_summary?.site_count || report.health_summary_table?.length || report.borehole_summary_table?.length || 0;
            const sourceMessage = sourceLabel === "browser storage"
                ? `Loaded cached cohort for ${loadedCount} boreholes from browser storage. Switching pages will reuse this same report.`
                : `Loaded report successfully from ${sourceLabel}.`;
            setStatus(statusTarget, sourceMessage);
            return buildIndex(report);
        } catch (error) {
            safeRunStateSet({
                status: "error",
                message: error.message,
                failed_at: new Date().toISOString()
            });
            setStatus(statusTarget, error.message, true);
            throw error;
        }
    }

    async function readUploadedFile(file) {
        const text = await file.text();
        const report = normalizeReport(JSON.parse(text));
        safeStorageSet(report);
        return buildIndex(report);
    }

    function getFilterValues(root = document) {
        const byId = (id) => root.getElementById(id);
        return {
            provider: byId("filterProvider")?.value || "",
            boreholeKey: byId("filterBorehole")?.value || "",
            status: byId("filterStatus")?.value || "",
            readinessTier: byId("filterReadiness")?.value || "",
            typology: byId("filterTypology")?.value || "",
            priority: byId("filterPriority")?.value || "",
            stressedOnly: !!byId("filterStressedOnly")?.checked,
            activeOnly: !!byId("filterActiveOnly")?.checked,
            validQsOnly: !!byId("filterValidQsOnly")?.checked,
            startDate: byId("filterStartDate")?.value || "",
            endDate: byId("filterEndDate")?.value || ""
        };
    }

    function matchesRow(row, filters) {
        if (filters.provider && row.provider !== filters.provider) return false;
        if (filters.boreholeKey && Utils.boreholeKey(row) !== filters.boreholeKey && row.borehole_id !== filters.boreholeKey && row.display_name !== filters.boreholeKey) return false;
        if (filters.status && row.status_category !== filters.status) return false;
        if (filters.readinessTier && row.analysis_readiness_tier !== filters.readinessTier) return false;
        if (filters.typology && row.typology_group !== filters.typology) return false;
        if (filters.priority && row.maintenance_priority_label !== filters.priority) return false;
        if (filters.stressedOnly && !row.stress_flag && row.status_category !== "stressed" && row.status_category !== "declining_performance") return false;
        if (filters.activeOnly && (Utils.safeNumber(row.active_day_share) || 0) <= 0) return false;
        if (filters.validQsOnly && Utils.safeNumber(row.median_valid_specific_capacity_m3h_per_m) === null) return false;
        return true;
    }

    function matchesDate(row, filters) {
        const date = Utils.toDateString(row.date);
        if (!date) return true;
        if (filters.startDate && date < filters.startDate) return false;
        if (filters.endDate && date > filters.endDate) return false;
        return true;
    }

    function applyFilters(index, filters = {}) {
        const healthRows = (index.report.health_summary_table || []).filter((row) => matchesRow(row, filters));
        const baseRows = (healthRows.length ? healthRows : index.baseRows).filter((row) => matchesRow(row, filters));
        const allowedKeys = new Set(baseRows.map(Utils.boreholeKey));

        return {
            report: index.report,
            baseRows,
            healthRows: (index.report.health_summary_table || []).filter((row) => allowedKeys.has(Utils.boreholeKey(row))),
            priorityRows: (index.report.priority_ranking_table || []).filter((row) => allowedKeys.has(Utils.boreholeKey(row))),
            comparisonRows: (index.report.network_comparison_table || []).filter((row) => allowedKeys.has(Utils.boreholeKey(row))),
            dailyRows: (index.report.daily_rows || []).filter((row) => allowedKeys.has(Utils.boreholeKey(row)) && matchesDate(row, filters)),
            rollingRows: (index.report.rolling_rows || []).filter((row) => allowedKeys.has(Utils.boreholeKey(row)) && matchesDate(row, filters)),
            categoryRows: index.report.category_summary_table || [],
            allowedKeys
        };
    }

    return {
        STORAGE_KEY,
        SETTINGS_KEY,
        RUN_STATE_KEY,
        loadReport,
        runLiveAnalysis,
        readUploadedFile,
        getFilterValues,
        getAnalysisSettings,
        populateAnalysisControls,
        applyFilters,
        buildIndex,
        setStatus
    };
});
