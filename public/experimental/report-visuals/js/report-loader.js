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
    const RUN_STATE_STALE_MS = 180000;

    function scopedKey(baseKey, provider = "shared") {
        return `${baseKey}.${String(provider || "shared").toLowerCase()}`;
    }
    const DEFAULT_MAX_SOURCES = null;
    const MAX_SOURCE_LIMIT = 500;
    const DEFAULT_PROVIDER = "DCP";
    const DEFAULT_LOOKBACK_DAYS = 42;
    const DEFAULT_COUNTRY_SCOPE = "Malawi";
    const QS_METHOD_LABELS = {
        event_median_proxy: "Event median / max drawdown",
        stable_tail_proxy: "Stable-tail median / max drawdown",
        current_proxy: "Last flow / end drawdown",
        late_mean_proxy: "Late mean / max drawdown",
        max_stress_proxy: "Max flow / max drawdown"
    };
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
            category_summary_table: Array.isArray(report.category_summary_table) ? report.category_summary_table : [],
            event_rows: Array.isArray(report.event_rows) ? report.event_rows : [],
            source_reports: Array.isArray(report.source_reports) ? report.source_reports : []
        };
    }

    async function fetchJson(url) {
        const response = await fetch(url, { cache: "no-store" });
        if (!response.ok) {
            throw new Error(`Could not load report JSON from ${url}`);
        }
        return normalizeReport(await response.json());
    }

    function compactReportForStorage(report = {}) {
        const normalized = normalizeReport(report);
        return {
            ...normalized,
            source_reports: [],
            cache_variant: "compact_browser_storage"
        };
    }

    function safeStorageSet(report, provider = report?.provider) {
        try {
            const compactReport = compactReportForStorage(report);
            const serialized = JSON.stringify(compactReport);
            localStorage.setItem(STORAGE_KEY, serialized);
            localStorage.setItem(scopedKey(STORAGE_KEY, provider), serialized);
        } catch (error) {
            // ignore quota issues in the experimental layer
        }
    }

    function safeStorageGet(provider) {
        try {
            if (provider && provider !== "shared") {
                const scopedRaw = localStorage.getItem(scopedKey(STORAGE_KEY, provider));
                if (scopedRaw) return normalizeReport(JSON.parse(scopedRaw));
            }
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

    function safeRunStateSet(state, provider = state?.provider) {
        try {
            localStorage.setItem(RUN_STATE_KEY, JSON.stringify(state));
            localStorage.setItem(scopedKey(RUN_STATE_KEY, provider), JSON.stringify(state));
        } catch (error) {
            // ignore storage issues in the experimental layer
        }
    }

    function safeRunStateGet(provider) {
        try {
            if (provider && provider !== "shared") {
                const scopedRaw = localStorage.getItem(scopedKey(RUN_STATE_KEY, provider));
                if (scopedRaw) return JSON.parse(scopedRaw);
            }
            const raw = localStorage.getItem(RUN_STATE_KEY);
            return raw ? JSON.parse(raw) : null;
        } catch (error) {
            return null;
        }
    }

    function safeRunStateClear(provider) {
        try {
            localStorage.removeItem(RUN_STATE_KEY);
            if (provider && provider !== "shared") {
                localStorage.removeItem(scopedKey(RUN_STATE_KEY, provider));
            }
        } catch (error) {
            // ignore storage issues in the experimental layer
        }
    }

    function getActiveRunState(provider) {
        const runState = safeRunStateGet(provider);
        if (!runState || runState.status !== "running") return runState;

        const activityAtMs = Date.parse(runState.updated_at || runState.started_at || "") || 0;
        if (!activityAtMs || (Date.now() - activityAtMs) > RUN_STATE_STALE_MS) {
            safeRunStateClear(provider);
            return null;
        }

        return runState;
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

    function getReportLoadedCount(report = {}) {
        return report.network_summary?.site_count || report.health_summary_table?.length || report.borehole_summary_table?.length || 0;
    }

    function ensureLoadingOverlay(root = document) {
        const doc = root?.ownerDocument || root || document;
        let overlay = doc.getElementById("pageLoadingOverlay");
        if (overlay) return overlay;

        overlay = doc.createElement("div");
        overlay.id = "pageLoadingOverlay";
        overlay.className = "page-loading-overlay";
        overlay.innerHTML = `
            <div class="page-loading-card" role="status" aria-live="polite" aria-busy="true">
                <div class="page-loading-spinner"></div>
                <div id="pageLoadingMessage">Loading data…</div>
            </div>`;
        doc.body.appendChild(overlay);
        return overlay;
    }

    function setLoading(root = document, isLoading, message = "Loading data…") {
        const overlay = ensureLoadingOverlay(root);
        const label = overlay.querySelector("#pageLoadingMessage");
        if (label) label.textContent = message || "Loading data…";
        overlay.classList.toggle("open", !!isLoading);
    }

    function setStatus(target, message, isError) {
        if (!target) return;
        target.textContent = message;
        target.style.color = isError ? "#b91c1c" : "#334155";
        const overlay = ensureLoadingOverlay(target.ownerDocument || document);
        const label = overlay.querySelector("#pageLoadingMessage");
        if (label && overlay.classList.contains("open")) {
            label.textContent = message || "Loading data…";
        }
    }

    function getQueryParams() {
        return new URLSearchParams(global.location?.search || "");
    }

    function getQueryReportUrl() {
        return getQueryParams().get("report") || "";
    }

    function formatQsMethodLabel(method) {
        return QS_METHOD_LABELS[method] || method || "Event median / max drawdown";
    }

    function humanizeLoadError(error, provider = DEFAULT_PROVIDER) {
        const raw = String(error?.message || error || "").trim();
        if (!raw) {
            return `Could not load ${provider} telemetry for ${DEFAULT_COUNTRY_SCOPE}. Please wait and try again.`;
        }
        if (/failed to fetch|http 403|timed out/i.test(raw)) {
            return `Could not load live ${provider} telemetry for ${DEFAULT_COUNTRY_SCOPE} right now. Please wait and try again.`;
        }
        return raw;
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

    function isMalawiSource(source = {}) {
        const countryText = [
            source?.country,
            source?.metadata?.country,
            source?.metadata?.location,
            source?.metadata?.site_name
        ].filter(Boolean).join(" ").toLowerCase();

        if (!countryText) return true;
        return countryText.includes("malawi") || countryText === "unknown" || countryText.includes("mw");
    }

    function normalizeMaxSources(value) {
        if (value === null || value === undefined || value === "") return null;
        const parsed = Math.round(Number(value));
        if (!Number.isFinite(parsed) || parsed <= 0) return null;
        return Math.min(parsed, MAX_SOURCE_LIMIT);
    }

    function getSettingsDateRange(settings = {}) {
        return {
            startDate: Utils.toDateString(settings.window?.start || settings.startDate),
            endDate: Utils.toDateString(settings.window?.end || settings.endDate)
        };
    }

    function reportMatchesRequestedDefaultCohort(report, settings = {}) {
        if (!report) return false;

        const { startDate, endDate } = getSettingsDateRange(settings);
        const reportStartDate = Utils.toDateString(report.date_window?.start);
        const reportEndDate = Utils.toDateString(report.date_window?.end);
        const loadedCount = getReportLoadedCount(report);

        return (
            report.cohort_request?.load_scope === "full_available_cohort"
            && (report.cohort_request?.provider_scope || report.provider) === (settings.provider || DEFAULT_PROVIDER)
            && report.cohort_request?.country_scope === DEFAULT_COUNTRY_SCOPE
            && String(report.cohort_request?.requested_max_sources || "all_available") === "all_available"
            && !String(report.cohort_request?.borehole_filter || "").trim()
            && !String(settings.boreholeFilter || "").trim()
            && loadedCount > 1
            && reportStartDate === startDate
            && reportEndDate === endDate
        );
    }

    function isNoTelemetryProcessedError(error) {
        return /No telemetry could be processed for the selected cohort/i.test(String(error?.message || error || ""));
    }

    function buildDefaultAnalysisSettings() {
        const params = getQueryParams();
        const today = new Date();
        const start = new Date();
        start.setDate(today.getDate() - DEFAULT_LOOKBACK_DAYS);
        const saved = safeSettingsGet() || {};

        return {
            provider: params.get("provider") || DEFAULT_PROVIDER,
            startDate: params.get("startDate") || Utils.toDateString(start),
            endDate: params.get("endDate") || Utils.toDateString(today),
            maxSources: normalizeMaxSources(params.get("maxSources") || DEFAULT_MAX_SOURCES),
            flowThreshold: Number(params.get("flowThreshold") || saved.flowThreshold || 0.1),
            graceHours: Number(params.get("graceHours") || saved.graceHours || 2),
            qsMethod: params.get("qsMethod") || saved.qsMethod || "event_median_proxy",
            boreholeFilter: params.get("analysisBorehole") || ""
        };
    }

    function populateAnalysisControls(root = document) {
        const byId = (id) => root.getElementById(id);
        const defaults = buildDefaultAnalysisSettings();
        if (byId("analysisProvider")) byId("analysisProvider").value = defaults.provider;
        if (byId("analysisStartDate")) byId("analysisStartDate").value = defaults.startDate;
        if (byId("analysisEndDate")) byId("analysisEndDate").value = defaults.endDate;
        if (byId("analysisMaxSources")) byId("analysisMaxSources").value = defaults.maxSources ?? "";
        if (byId("analysisFlowThreshold")) byId("analysisFlowThreshold").value = defaults.flowThreshold;
        if (byId("analysisGraceHours")) byId("analysisGraceHours").value = defaults.graceHours;
        if (byId("analysisQsMethod")) byId("analysisQsMethod").value = defaults.qsMethod;
        if (byId("analysisBoreholeFilter")) byId("analysisBoreholeFilter").value = defaults.boreholeFilter;
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
            provider: byId("analysisProvider")?.value || DEFAULT_PROVIDER,
            maxSources: normalizeMaxSources(byId("analysisMaxSources")?.value || ""),
            flowThreshold: Number(byId("analysisFlowThreshold")?.value || 0.1),
            graceHours: Number(byId("analysisGraceHours")?.value || 2),
            qsMethod: byId("analysisQsMethod")?.value || "event_median_proxy",
            boreholeFilter: String(byId("analysisBoreholeFilter")?.value || "").trim(),
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

    async function listSourcesForProvider(settings, adapters) {
        const context = { useProxy: true };
        if (settings.provider === "DCP") {
            return await adapters.dcp.listSources(context);
        }
        if (settings.provider === "SonSetLink") {
            return await adapters.ssl.listSources(context);
        }
        const [dcpSources, sslSources] = await Promise.all([
            adapters.dcp.listSources(context),
            adapters.ssl.listSources(context)
        ]);
        return [...dcpSources, ...sslSources];
    }

    async function runLiveAnalysis(options = {}) {
        const root = options.root || document;
        const statusTarget = options.statusTarget || null;
        const settings = options.settings || getAnalysisSettings(root);
        const Exp = ensureAnalyticsModulesReady();
        const { dcpAdapter: dcp, sslAdapter: ssl } = getAdapters(Exp);
        const runId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

        try {
            setLoading(root, true, `Loading ${settings.provider} ${DEFAULT_COUNTRY_SCOPE} data and running calculations...`);
            setStatus(statusTarget, "Loading real telemetry sources for the cohort analysis...");
            safeSettingsSet(settings);
            const filterQuery = String(settings.boreholeFilter || "").trim().toLowerCase();
            const loadScope = filterQuery
                ? "borehole_filtered_subset"
                : (settings.maxSources ? "limited_subset" : "full_available_cohort");

            safeRunStateSet({
                status: "running",
                run_id: runId,
                started_at: new Date().toISOString(),
                updated_at: new Date().toISOString(),
                provider: settings.provider,
                requested_max_sources: settings.maxSources || "all_available",
                borehole_filter: settings.boreholeFilter || "",
                load_scope: loadScope
            }, settings.provider);

            const allSources = await listSourcesForProvider(settings, { dcp, ssl });
            const malawiSources = allSources.filter((source) => isMalawiSource(source));
            const filteredSources = filterQuery ? malawiSources.filter((source) => matchesBoreholeFilter(source, filterQuery)) : malawiSources;
            const selected = [...filteredSources]
                .sort((a, b) => {
                    const aTs = Date.parse(a.metadata?.most_recent_tx || a.metadata?.last_seen || 0) || 0;
                    const bTs = Date.parse(b.metadata?.most_recent_tx || b.metadata?.last_seen || 0) || 0;
                    return bTs - aTs;
                })
                .slice(0, settings.maxSources || filteredSources.length);

            if (!selected.length) {
                throw new Error(filterQuery ? `No Malawi sources matched the borehole filter "${filterQuery}".` : "No Malawi sources were available for the selected provider scope.");
            }

            const dailyRows = [];
            const rollingRows = [];
            const boreholeRows = [];
            const eventRows = [];
            const sourceReports = [];
            const batchSize = filterQuery ? 1 : (settings.provider === "SonSetLink" ? 3 : 4);

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
                    eventRows.push(...(result.report?.event_rows || []));
                    sourceReports.push(result.report);
                });

                safeRunStateSet({
                    status: "running",
                    run_id: runId,
                    started_at: safeRunStateGet(settings.provider)?.started_at || new Date().toISOString(),
                    updated_at: new Date().toISOString(),
                    provider: settings.provider,
                    requested_max_sources: settings.maxSources || "all_available",
                    borehole_filter: settings.boreholeFilter || "",
                    load_scope: loadScope,
                    processed_source_count: Math.min(i + batchSize, selected.length),
                    selected_source_count: selected.length
                }, settings.provider);
                setStatus(statusTarget, `Processed ${Math.min(i + batchSize, selected.length)} of ${selected.length} sources using ${formatQsMethodLabel(settings.qsMethod)}${filterQuery ? ` for borehole filter \"${filterQuery}\"` : ""}.`);
            }

            if (!boreholeRows.length) {
                throw new Error("No telemetry could be processed for the selected cohort.");
            }

            const network = Exp.NetworkAnalytics.computeNetworkAnalytics(boreholeRows, { qsMethod: settings.qsMethod });
            const interpretation = Exp.InterpretationOutputs.computeInterpretationOutputs(boreholeRows, network, {});
            const report = {
                exported_at: new Date().toISOString(),
                provider: settings.provider,
                cohort_request: {
                    requested_max_sources: settings.maxSources || "all_available",
                    load_scope: loadScope,
                    provider_scope: settings.provider,
                    country_scope: DEFAULT_COUNTRY_SCOPE,
                    borehole_filter: settings.boreholeFilter || ""
                },
                date_window: {
                    start: settings.window.start.toISOString(),
                    end: settings.window.end.toISOString()
                },
                analytics_note: `Experimental isolated analytics layer using real normalized telemetry and event outputs for ${DEFAULT_COUNTRY_SCOPE} sites over the last 6 weeks (${DEFAULT_LOOKBACK_DAYS} days) by default. Active Q/S mode: ${formatQsMethodLabel(settings.qsMethod)}.`,
                qs_method_selected: settings.qsMethod,
                qs_method_label: formatQsMethodLabel(settings.qsMethod),
                event_rows: eventRows,
                daily_rows: dailyRows.sort((a, b) => `${a.borehole_id}|${a.date}`.localeCompare(`${b.borehole_id}|${b.date}`)),
                rolling_rows: rollingRows.sort((a, b) => `${a.borehole_id}|${a.date}`.localeCompare(`${b.borehole_id}|${b.date}`)),
                borehole_summary_table: boreholeRows.sort((a, b) => String(a.display_name).localeCompare(String(b.display_name))),
                ...network,
                ...interpretation,
                source_reports: sourceReports
            };

            safeStorageSet(report, settings.provider);
            safeRunStateSet({
                status: "ready",
                run_id: runId,
                completed_at: new Date().toISOString(),
                provider: settings.provider,
                requested_max_sources: settings.maxSources || "all_available",
                borehole_filter: settings.boreholeFilter || "",
                load_scope: loadScope,
                loaded_site_count: boreholeRows.length
            }, settings.provider);
            const scopeLabel = filterQuery
                ? `borehole-filtered ${DEFAULT_COUNTRY_SCOPE} subset`
                : (settings.maxSources ? `${settings.maxSources}-source ${DEFAULT_COUNTRY_SCOPE} subset` : `all available DCP boreholes in ${DEFAULT_COUNTRY_SCOPE}`);
            setStatus(statusTarget, `Completed ${scopeLabel} analysis for ${boreholeRows.length} sources using ${formatQsMethodLabel(settings.qsMethod)}.`);
            return buildIndex(report);
        } catch (error) {
            const message = humanizeLoadError(error, settings.provider);
            safeRunStateSet({
                status: "error",
                run_id: runId,
                message,
                failed_at: new Date().toISOString(),
                provider: settings.provider,
                requested_max_sources: settings.maxSources || "all_available",
                borehole_filter: settings.boreholeFilter || "",
                load_scope: String(settings.boreholeFilter || "").trim() ? "borehole_filtered_subset" : (settings.maxSources ? "limited_subset" : "full_available_cohort")
            }, settings.provider);
            throw new Error(message);
        } finally {
            setLoading(root, false);
        }
    }

    async function waitForSharedReport(options = {}) {
        const statusTarget = options.statusTarget || null;
        const timeoutMs = options.timeoutMs || 120000;
        const provider = options.provider || "shared";
        const expectedSettings = options.settings || buildDefaultAnalysisSettings();
        const startMs = Date.now();
        setLoading(options.root || document, true, "A full cohort load is already running in another page. Waiting to reuse it here...");
        setStatus(statusTarget, "A full cohort load is already running in another page. Waiting to reuse it here...");

        while ((Date.now() - startMs) < timeoutMs) {
            const report = safeStorageGet(provider);
            if (reportMatchesRequestedDefaultCohort(report, expectedSettings)) {
                const loadedCount = getReportLoadedCount(report);
                setStatus(statusTarget, `Loaded cached cohort for ${loadedCount} boreholes from browser storage. Switching pages will reuse this same report.`);
                return buildIndex(report);
            }

            const runState = getActiveRunState(provider);
            if (runState?.status === "error") {
                throw new Error(runState.message || "The shared cohort load failed in another page.");
            }
            if (!runState) {
                return null;
            }

            await new Promise((resolve) => setTimeout(resolve, 1000));
        }

        throw new Error("The shared cohort load is taking longer than expected. Please wait a moment and try again.");
    }

    async function loadReport(options = {}) {
        const statusTarget = options.statusTarget || null;
        const requestedUrl = options.url || getQueryReportUrl() || options.defaultUrl || "";
        const expectedSettings = options.settings || buildDefaultAnalysisSettings();
        const requestedProvider = options.provider || options.root?.getElementById?.("analysisProvider")?.value || expectedSettings.provider || DEFAULT_PROVIDER;

        try {
            setLoading(options.root || document, true, "Loading report data...");
            setStatus(statusTarget, "Loading report data...");
            let report = null;
            let sourceLabel = "browser storage";

            if (requestedUrl) {
                report = await fetchJson(requestedUrl);
                sourceLabel = requestedUrl;
            } else {
                report = safeStorageGet(requestedProvider);
            }

            const reportMissingMethodSupport = !Array.isArray(report?.event_rows)
                || (!report?.event_rows?.length && (report?.health_summary_table || []).some((row) => (Number(row.active_day_share) || 0) > 0));
            const reportMatchesDefaultCohort = reportMatchesRequestedDefaultCohort(report, expectedSettings);

            const shouldSeedFullCohort = !!(
                options.runLiveIfMissing
                && !requestedUrl
                && (!report || !reportMatchesDefaultCohort || reportMissingMethodSupport)
            );

            if (shouldSeedFullCohort) {
                const runState = getActiveRunState(requestedProvider);
                if (runState?.status === "running") {
                    const sharedReport = await waitForSharedReport({ statusTarget, provider: requestedProvider, root: options.root || document, settings: expectedSettings });
                    if (sharedReport) {
                        return sharedReport;
                    }
                    setStatus(statusTarget, "A previous cohort load lock expired. Starting a fresh shared analysis now.");
                }

                try {
                    return await runLiveAnalysis({ root: options.root || document, statusTarget, settings: expectedSettings });
                } catch (error) {
                    if (!isNoTelemetryProcessedError(error)) {
                        throw error;
                    }

                    setStatus(statusTarget, "The first shared cohort attempt returned no telemetry. Checking for a reusable shared report and retrying automatically...");

                    const cachedReport = safeStorageGet(requestedProvider);
                    if (reportMatchesRequestedDefaultCohort(cachedReport, expectedSettings)) {
                        setStatus(statusTarget, "Recovered by reusing the shared cohort report already loaded in browser storage.");
                        return buildIndex(cachedReport);
                    }

                    const sharedReport = await waitForSharedReport({
                        statusTarget,
                        provider: requestedProvider,
                        root: options.root || document,
                        settings: expectedSettings,
                        timeoutMs: 15000
                    }).catch(() => null);
                    if (sharedReport) {
                        return sharedReport;
                    }

                    setStatus(statusTarget, "Retrying the shared cohort load automatically...");
                    return await runLiveAnalysis({ root: options.root || document, statusTarget, settings: expectedSettings });
                }
            }

            if (!report) {
                throw new Error("No report is loaded yet. Run the live analysis above or optionally load a saved report.");
            }

            safeStorageSet(report, requestedProvider);
            const loadedCount = getReportLoadedCount(report);
            const sourceMessage = sourceLabel === "browser storage"
                ? `Loaded cached cohort for ${loadedCount} boreholes from browser storage. All experimental pages will reuse this same report until you rerun the analysis.`
                : `Loaded report successfully from ${sourceLabel}.`;
            setStatus(statusTarget, sourceMessage);
            return buildIndex(report);
        } catch (error) {
            const message = humanizeLoadError(error, requestedProvider);
            safeRunStateSet({
                status: "error",
                message,
                failed_at: new Date().toISOString()
            });
            setStatus(statusTarget, message, true);
            throw new Error(message);
        } finally {
            setLoading(options.root || document, false);
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
            evidenceConfidence: byId("filterConfidence")?.value || "",
            evidenceLane: byId("filterEvidenceLane")?.value || "",
            operationalBucket: byId("filterOperationalBucket")?.value || "",
            stressedOnly: !!byId("filterStressedOnly")?.checked,
            activeOnly: !!byId("filterActiveOnly")?.checked,
            validQsOnly: !!byId("filterValidQsOnly")?.checked
        };
    }

    function matchesRow(row, filters) {
        if (filters.provider && row.provider !== filters.provider) return false;
        if (filters.boreholeKey && Utils.boreholeKey(row) !== filters.boreholeKey && row.borehole_id !== filters.boreholeKey && row.display_name !== filters.boreholeKey) return false;
        if (filters.status && row.status_category !== filters.status) return false;
        if (filters.readinessTier && row.analysis_readiness_tier !== filters.readinessTier) return false;
        if (filters.typology && row.typology_group !== filters.typology) return false;
        if (filters.priority && row.maintenance_priority_label !== filters.priority) return false;
        if (filters.evidenceConfidence && row.evidence_confidence_label !== filters.evidenceConfidence) return false;
        if (filters.evidenceLane && row.evidence_lane_label !== filters.evidenceLane) return false;
        if (filters.operationalBucket && row.operational_bucket !== filters.operationalBucket) return false;
        if (filters.stressedOnly && !row.stress_flag && row.status_category !== "stressed" && row.status_category !== "declining_performance") return false;
        if (filters.activeOnly && (Utils.safeNumber(row.active_day_share) || 0) <= 0) return false;
        if (filters.validQsOnly && Utils.safeNumber(row.median_valid_specific_capacity_m3h_per_m) === null) return false;
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
            dailyRows: (index.report.daily_rows || []).filter((row) => allowedKeys.has(Utils.boreholeKey(row))),
            rollingRows: (index.report.rolling_rows || []).filter((row) => allowedKeys.has(Utils.boreholeKey(row))),
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
