(function (global, factory) {
    const api = factory(global);
    if (typeof module !== "undefined" && module.exports) {
        module.exports = api;
    }
    global.SiteMonitorExperimental = global.SiteMonitorExperimental || {};
    global.SiteMonitorExperimental.ComputeEventMetrics = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function (global) {
    const Schema = global.SiteMonitorExperimental?.TelemetrySchema;

    if (!Schema) {
        throw new Error("TelemetrySchema must be loaded before ComputeEventMetrics.");
    }

    const HOUR_MS = 60 * 60 * 1000;

    function round(value, digits = 3) {
        return Number.isFinite(value) ? Number(value.toFixed(digits)) : null;
    }

    function buildQualityFlags(eventState, drawdown, options) {
        const flags = new Set(eventState.flags || []);
        if (!eventState.start_level_point || !eventState.last_level_point) {
            flags.add("insufficient_water_level");
        }
        if (!Number.isFinite(drawdown) || drawdown < (options.minDrawdownM || 0.05)) {
            flags.add("invalid_specific_capacity");
        }
        if (eventState.provider === "SonSetLink") {
            flags.add("approximate_daily_event");
        }
        return [...flags];
    }

    function estimateTotalVolume(flowPoints = []) {
        if (!flowPoints.length) return 0;
        let total = 0;
        for (let i = 0; i < flowPoints.length; i++) {
            const point = flowPoints[i];
            if (!(Number(point.value) > 0)) continue;

            const spanHours = Number(point.sample_span_hours);
            if (Number.isFinite(spanHours) && spanHours > 0) {
                total += Number(point.value) * spanHours;
                continue;
            }

            const next = flowPoints[i + 1];
            const deltaMs = next ? Math.max(0, next.timestamp_ms - point.timestamp_ms) : HOUR_MS;
            total += Number(point.value) * (deltaMs / HOUR_MS || 1);
        }
        return total;
    }

    function computeEventMetrics(detectionResult, options = {}) {
        const rows = [];
        const completedEvents = detectionResult?.completed_events || [];
        const minDrawdownM = Number.isFinite(Number(options.minDrawdownM)) ? Number(options.minDrawdownM) : 0.05;

        completedEvents.forEach((eventState, index) => {
            const positiveFlowPoints = (eventState.points || []).filter((point) => Number(point.value) > (detectionResult.flow_threshold || 0.1));
            if (!positiveFlowPoints.length) return;

            const lastPositivePoint = positiveFlowPoints[positiveFlowPoints.length - 1];
            const startLevel = eventState.start_level_point?.value ?? null;
            const endLevel = eventState.last_positive_level_point?.value ?? null;
            const deepestLevel = eventState.deepest_level_point?.value ?? null;
            const drawdown = (Number.isFinite(startLevel) && Number.isFinite(endLevel)) ? (startLevel - endLevel) : null;
            const maximumDrawdown = (Number.isFinite(startLevel) && Number.isFinite(deepestLevel)) ? (startLevel - deepestLevel) : null;
            const totalVolume = estimateTotalVolume(positiveFlowPoints);
            const durationHours = (eventState.end_ms - eventState.start_ms) / HOUR_MS;
            const lastValidNonZeroFlow = Number(lastPositivePoint.value);
            const specificCapacity = (Number.isFinite(drawdown) && drawdown >= minDrawdownM && lastValidNonZeroFlow > 0)
                ? (lastValidNonZeroFlow / drawdown)
                : null;
            const qualityFlags = buildQualityFlags(eventState, drawdown, { minDrawdownM });

            rows.push({
                borehole_id: eventState.borehole_id,
                event_index: index + 1,
                provider: eventState.provider,
                event_start: new Date(eventState.start_ms).toISOString(),
                event_end: new Date(eventState.end_ms).toISOString(),
                duration_hours: round(durationHours, 2),
                total_pumped_volume_m3: round(totalVolume, 3),
                groundwater_level_at_event_start_m: round(startLevel, 3),
                groundwater_level_at_last_valid_non_zero_flow_m: round(endLevel, 3),
                drawdown_m: round(drawdown, 3),
                last_valid_non_zero_flow_m3h: round(lastValidNonZeroFlow, 3),
                specific_capacity_m3h_per_m: round(specificCapacity, 3),
                deepest_level_reached_m: round(deepestLevel, 3),
                maximum_drawdown_m: round(maximumDrawdown, 3),
                quality_flags: qualityFlags
            });
        });

        return rows;
    }

    return {
        computeEventMetrics
    };
});