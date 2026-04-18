(function (global, factory) {
    const api = factory();
    if (typeof module !== "undefined" && module.exports) {
        module.exports = api;
    }
    global.SiteMonitorExperimental = global.SiteMonitorExperimental || {};
    global.SiteMonitorExperimental.ExportJson = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
    function buildEventJson(report = {}) {
        return JSON.stringify({
            exported_at: new Date().toISOString(),
            source: report?.normalized?.source || report?.source || null,
            qc_summary: report?.cleaned?.qc_summary || report?.qc_summary || null,
            active_event_state: report?.detected?.active_event_state || null,
            completed_event_outputs: report?.event_rows || report?.completed_event_outputs || [],
            daily_rows: report?.daily_rows || [],
            rolling_rows: report?.rolling_rows || [],
            borehole_summary_table: report?.borehole_summary_table || [],
            health_summary_table: report?.health_summary_table || [],
            priority_ranking_table: report?.priority_ranking_table || [],
            category_summary_table: report?.category_summary_table || [],
            interpretation_note: report?.interpretation_note || null,
            network_summary: report?.network_summary || null,
            network_comparison_table: report?.network_comparison_table || []
        }, null, 2);
    }

    function downloadJson(report = {}, filename = "experimental_telemetry_events.json") {
        const content = buildEventJson(report);
        const blob = new Blob([content], { type: "application/json;charset=utf-8" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    }

    return {
        buildEventJson,
        downloadJson
    };
});