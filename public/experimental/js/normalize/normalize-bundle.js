(function (global, factory) {
    const api = factory(global);
    if (typeof module !== "undefined" && module.exports) {
        module.exports = api;
    }
    global.SiteMonitorExperimental = global.SiteMonitorExperimental || {};
    global.SiteMonitorExperimental.NormalizeBundle = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function (global) {
    const Schema = global.SiteMonitorExperimental?.TelemetrySchema;

    function buildNormalizedBundle({ source, points = [], raw_series = {}, metadata = {}, quality_summary = {} }) {
        if (!Schema) {
            throw new Error("TelemetrySchema must be loaded before NormalizeBundle.");
        }

        const normalizedPoints = points
            .map((point) => Schema.createTelemetryPoint(point))
            .filter((point) => Number.isFinite(point.timestamp_ms) && point.value !== null);

        const bundle = Schema.createBundle({
            source,
            points: normalizedPoints,
            raw_series,
            metadata,
            quality_summary
        });

        const required = [Schema.PARAMETERS.FLOW, Schema.PARAMETERS.WATER_LEVEL];
        for (const parameter of required) {
            if (!bundle.series[parameter] || !bundle.series[parameter].length) {
                if (!bundle.quality_summary.missing_parameters.includes(parameter)) {
                    bundle.quality_summary.missing_parameters.push(parameter);
                }
            }
        }

        return bundle;
    }

    function summarizeBundle(bundle) {
        const flowCount = bundle?.series?.flow?.length || 0;
        const levelCount = bundle?.series?.water_level_above_pump?.length || 0;
        return {
            source_id: bundle?.source?.source_id || "",
            borehole_id: bundle?.source?.borehole_id || "",
            flow_points: flowCount,
            level_points: levelCount,
            missing_parameters: bundle?.quality_summary?.missing_parameters || [],
            is_approximate: !!bundle?.quality_summary?.is_approximate
        };
    }

    return {
        buildNormalizedBundle,
        summarizeBundle
    };
});