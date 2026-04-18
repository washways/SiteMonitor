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
            source: report?.normalized?.source || null,
            qc_summary: report?.cleaned?.qc_summary || null,
            active_event_state: report?.detected?.active_event_state || null,
            completed_event_outputs: report?.event_rows || []
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