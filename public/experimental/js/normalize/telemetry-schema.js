(function (global, factory) {
    const api = factory();
    if (typeof module !== "undefined" && module.exports) {
        module.exports = api;
    }
    global.SiteMonitorExperimental = global.SiteMonitorExperimental || {};
    global.SiteMonitorExperimental.TelemetrySchema = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
    const SCHEMA_VERSION = "1.0.0";
    const PARAMETERS = Object.freeze({
        FLOW: "flow",
        WATER_LEVEL: "water_level_above_pump"
    });

    function toFiniteNumber(value) {
        const n = Number(value);
        return Number.isFinite(n) ? n : null;
    }

    function toTimestampMs(value) {
        if (typeof value === "number" && Number.isFinite(value)) return value;
        const ts = Date.parse(String(value || ""));
        return Number.isFinite(ts) ? ts : null;
    }

    function toIsoString(timestampMs) {
        return Number.isFinite(timestampMs) ? new Date(timestampMs).toISOString() : null;
    }

    function uniqueFlags(flags) {
        return [...new Set((Array.isArray(flags) ? flags : []).filter(Boolean).map(String))];
    }

    function createSourceDescriptor(input = {}) {
        const metadata = input.metadata && typeof input.metadata === "object" ? { ...input.metadata } : {};
        return {
            source_id: String(input.source_id || `${input.provider || "unknown"}:${input.borehole_id || input.site_id || "unknown"}`),
            api_id: String(input.api_id || "unknown"),
            provider: String(input.provider || "unknown"),
            site_id: String(input.site_id || input.borehole_id || ""),
            borehole_id: String(input.borehole_id || input.site_id || ""),
            display_name: String(input.display_name || input.borehole_id || input.site_id || "Unknown source"),
            country: String(input.country || "Unknown"),
            lat: toFiniteNumber(input.lat),
            lon: toFiniteNumber(input.lon),
            granularity: String(input.granularity || metadata.granularity || "unknown"),
            confidence_class: String(input.confidence_class || metadata.confidence_class || "screening"),
            metadata
        };
    }

    function createTelemetryPoint(input = {}) {
        const timestampMs = toTimestampMs(input.timestamp_ms ?? input.timestamp_utc ?? input.timestamp);
        const sampleSpanHours = toFiniteNumber(input.sample_span_hours);
        const windowStartMs = toTimestampMs(input.window_start_ms);

        return {
            source_id: String(input.source_id || ""),
            borehole_id: String(input.borehole_id || ""),
            provider: String(input.provider || "unknown"),
            parameter: String(input.parameter || "unknown"),
            timestamp_utc: input.timestamp_utc || toIsoString(timestampMs),
            timestamp_ms: timestampMs,
            window_start_ms: windowStartMs,
            sample_span_hours: sampleSpanHours,
            value: toFiniteNumber(input.value),
            unit: String(input.unit || ""),
            quality: String(input.quality || "observed"),
            flags: uniqueFlags(input.flags),
            raw_ref: input.raw_ref && typeof input.raw_ref === "object" ? { ...input.raw_ref } : {},
            meta: input.meta && typeof input.meta === "object" ? { ...input.meta } : {}
        };
    }

    function groupPointsByParameter(points = []) {
        const series = {};
        for (const point of points) {
            if (!point || !point.parameter) continue;
            if (!series[point.parameter]) series[point.parameter] = [];
            series[point.parameter].push(createTelemetryPoint(point));
        }
        Object.keys(series).forEach((key) => {
            series[key].sort((a, b) => (a.timestamp_ms || 0) - (b.timestamp_ms || 0));
        });
        return series;
    }

    function createBundle(input = {}) {
        const source = createSourceDescriptor(input.source || {});
        const series = input.series || groupPointsByParameter(input.points || []);
        return {
            schema_version: SCHEMA_VERSION,
            source,
            raw_series: input.raw_series || {},
            series,
            quality_summary: {
                missing_parameters: Array.isArray(input.quality_summary?.missing_parameters) ? [...input.quality_summary.missing_parameters] : [],
                has_gaps: !!input.quality_summary?.has_gaps,
                has_duplicates: !!input.quality_summary?.has_duplicates,
                has_noise: !!input.quality_summary?.has_noise,
                is_approximate: !!input.quality_summary?.is_approximate,
                notes: Array.isArray(input.quality_summary?.notes) ? [...input.quality_summary.notes] : []
            },
            metadata: input.metadata && typeof input.metadata === "object" ? { ...input.metadata } : {}
        };
    }

    return {
        SCHEMA_VERSION,
        SCHEMA_VERSION,
        PARAMETERS,
        toFiniteNumber,
        toTimestampMs,
        toIsoString,
        uniqueFlags,
        createSourceDescriptor,
        createTelemetryPoint,
        groupPointsByParameter,
        createBundle
    };
});