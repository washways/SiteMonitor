(function (global, factory) {
    const api = factory(global);
    if (typeof module !== "undefined" && module.exports) {
        module.exports = api;
    }
    global.SiteMonitorExperimentalVizLoader = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function (global) {
    const Utils = global.SiteMonitorExperimentalVizUtils;
    const STORAGE_KEY = "sitemonitor.experimental.visualReport";

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

    function getQueryReportUrl() {
        const params = new URLSearchParams(window.location.search);
        return params.get("report") || "";
    }

    async function loadReport(options = {}) {
        const statusTarget = options.statusTarget || null;
        const requestedUrl = options.url || getQueryReportUrl() || options.defaultUrl || "";

        try {
            setStatus(statusTarget, "Loading report JSON...");
            let report = null;
            let sourceLabel = "browser storage";

            if (requestedUrl) {
                report = await fetchJson(requestedUrl);
                sourceLabel = requestedUrl;
            } else {
                report = safeStorageGet();
                if (!report && options.defaultUrl) {
                    report = await fetchJson(options.defaultUrl);
                    sourceLabel = options.defaultUrl;
                }
            }

            if (!report) {
                throw new Error("No report JSON is available yet. Load a saved analytics report file or provide a report URL.");
            }

            safeStorageSet(report);
            setStatus(statusTarget, `Loaded report successfully from ${sourceLabel}.`);
            return buildIndex(report);
        } catch (error) {
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
        loadReport,
        readUploadedFile,
        getFilterValues,
        applyFilters,
        buildIndex,
        setStatus
    };
});
