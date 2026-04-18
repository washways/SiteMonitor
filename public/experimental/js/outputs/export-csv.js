(function (global, factory) {
    const api = factory();
    if (typeof module !== "undefined" && module.exports) {
        module.exports = api;
    }
    global.SiteMonitorExperimental = global.SiteMonitorExperimental || {};
    global.SiteMonitorExperimental.ExportCsv = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
    const COLUMNS = [
        "borehole_id",
        "event_start",
        "event_end",
        "duration_hours",
        "total_pumped_volume_m3",
        "groundwater_level_at_event_start_m",
        "groundwater_level_at_last_valid_non_zero_flow_m",
        "drawdown_m",
        "last_valid_non_zero_flow_m3h",
        "specific_capacity_m3h_per_m",
        "deepest_level_reached_m",
        "maximum_drawdown_m",
        "quality_flags"
    ];

    function escapeCsv(value) {
        const text = Array.isArray(value) ? value.join(";") : String(value ?? "");
        return `"${text.replace(/"/g, '""')}"`;
    }

    function buildEventCsv(rows = []) {
        const header = COLUMNS.join(",");
        const body = rows.map((row) => COLUMNS.map((column) => escapeCsv(row[column])).join(","));
        return [header, ...body].join("\n");
    }

    function downloadCsv(rows = [], filename = "experimental_telemetry_events.csv") {
        const content = buildEventCsv(rows);
        const blob = new Blob([content], { type: "text/csv;charset=utf-8" });
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
        buildEventCsv,
        downloadCsv
    };
});