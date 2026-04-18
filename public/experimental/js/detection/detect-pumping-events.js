(function (global, factory) {
    const api = factory(global);
    if (typeof module !== "undefined" && module.exports) {
        module.exports = api;
    }
    global.SiteMonitorExperimental = global.SiteMonitorExperimental || {};
    global.SiteMonitorExperimental.DetectPumpingEventsExperimental = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function (global) {
    const Schema = global.SiteMonitorExperimental?.TelemetrySchema;
    const Cleaning = global.SiteMonitorExperimental?.CleanBoreholeSeries;
    const QcFlags = global.SiteMonitorExperimental?.QcFlags;

    if (!Schema || !Cleaning || !QcFlags) {
        throw new Error("TelemetrySchema, CleanBoreholeSeries, and QcFlags must be loaded before DetectPumpingEventsExperimental.");
    }

    function findNearestLevel(levelPoints, timestampMs, maxDiffMs) {
        let best = null;
        let bestDiff = Infinity;
        for (const point of levelPoints || []) {
            const diff = Math.abs(point.timestamp_ms - timestampMs);
            if (diff <= maxDiffMs && diff < bestDiff) {
                best = point;
                bestDiff = diff;
            }
        }
        return best;
    }

    function startEvent(source, point, levelPoints, options, inheritedFlags) {
        const level = findNearestLevel(levelPoints, point.timestamp_ms, options.levelSearchWindowMs);
        return {
            source,
            borehole_id: source?.borehole_id || point.borehole_id,
            well_name: source?.display_name || point.borehole_id,
            provider: source?.provider || point.provider,
            start_ms: point.window_start_ms || point.timestamp_ms,
            last_positive_ms: point.timestamp_ms,
            last_point_ms: point.timestamp_ms,
            points: [point],
            start_level_point: level,
            last_level_point: level,
            last_positive_level_point: level,
            deepest_level_point: level,
            flags: [...(inheritedFlags || [])],
            close_reason: null
        };
    }

    function pushPointIntoEvent(eventState, point, levelPoints) {
        eventState.points.push(point);
        eventState.last_point_ms = point.timestamp_ms;
        const isPositive = Number(point.value) > 0;
        if (isPositive) {
            eventState.last_positive_ms = point.timestamp_ms;
        }
        const level = findNearestLevel(levelPoints, point.timestamp_ms, 2 * 60 * 60 * 1000);
        if (level) {
            eventState.last_level_point = level;
            if (isPositive) {
                eventState.last_positive_level_point = level;
            }
            if (!eventState.deepest_level_point || level.value < eventState.deepest_level_point.value) {
                eventState.deepest_level_point = level;
            }
        }
    }

    function closeEvent(activeState, closeMs, reason) {
        return {
            ...activeState,
            end_ms: closeMs,
            close_reason: reason
        };
    }

    function detectPumpingEvents(cleaningResult, options = {}) {
        const cleanedBundle = cleaningResult?.cleaned_bundle || cleaningResult;
        const source = cleanedBundle?.source || {};
        const flowPoints = cleanedBundle?.series?.[Schema.PARAMETERS.FLOW] || [];
        const levelPoints = cleanedBundle?.series?.[Schema.PARAMETERS.WATER_LEVEL] || [];
        const qcFlags = (cleaningResult?.flags || []).map((flag) => flag.code);
        const flowThreshold = Number.isFinite(Number(options.flowThreshold)) ? Number(options.flowThreshold) : 0.1;
        const graceHours = Number.isFinite(Number(options.graceHours)) ? Number(options.graceHours) : 2;
        const graceMs = graceHours * 60 * 60 * 1000;
        const levelSearchWindowMs = Number.isFinite(Number(options.levelSearchWindowMs)) ? Number(options.levelSearchWindowMs) : 2 * 60 * 60 * 1000;
        const typicalIntervalMs = Cleaning.typicalIntervalMs(flowPoints);
        const closureGapMs = Math.max(graceMs, typicalIntervalMs * 1.5);

        const completedEvents = [];
        let activeEventState = null;

        for (const point of flowPoints) {
            const isPumping = Number(point.value) > flowThreshold;

            if (activeEventState && isPumping) {
                const gapSinceLastPositive = point.timestamp_ms - activeEventState.last_positive_ms;
                if (gapSinceLastPositive > closureGapMs && point.timestamp_ms > activeEventState.last_positive_ms) {
                    completedEvents.push(closeEvent(activeEventState, activeEventState.last_positive_ms + Math.min(graceMs, typicalIntervalMs), "grace_timeout"));
                    activeEventState = null;
                }
            }

            if (isPumping && !activeEventState) {
                activeEventState = startEvent(source, point, levelPoints, { levelSearchWindowMs }, qcFlags);
                continue;
            }

            if (!activeEventState) continue;

            pushPointIntoEvent(activeEventState, point, levelPoints);

            if (!isPumping) {
                const quietMs = point.timestamp_ms - activeEventState.last_positive_ms;
                if (quietMs >= graceMs) {
                    completedEvents.push(closeEvent(activeEventState, point.timestamp_ms, "flow_below_threshold"));
                    activeEventState = null;
                }
            }
        }

        if (activeEventState) {
            completedEvents.push(closeEvent(activeEventState, activeEventState.last_positive_ms + Math.min(graceMs, typicalIntervalMs), "end_of_window"));
            activeEventState = null;
        }

        return {
            source,
            flow_threshold: flowThreshold,
            grace_hours: graceHours,
            completed_events: completedEvents,
            active_event_state: activeEventState
        };
    }

    return {
        detectPumpingEvents
    };
});