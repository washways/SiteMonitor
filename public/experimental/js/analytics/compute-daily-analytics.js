(function (global, factory) {
    const api = factory(global);
    if (typeof module !== "undefined" && module.exports) {
        module.exports = api;
    }
    global.SiteMonitorExperimental = global.SiteMonitorExperimental || {};
    global.SiteMonitorExperimental.DailyAnalytics = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function (global) {
    const Schema = global.SiteMonitorExperimental?.TelemetrySchema;

    if (!Schema) {
        throw new Error("TelemetrySchema must be loaded before DailyAnalytics.");
    }

    const HOUR_MS = 60 * 60 * 1000;

    function round(value, digits = 3) {
        return Number.isFinite(value) ? Number(value.toFixed(digits)) : null;
    }

    function median(values = []) {
        const valid = values.filter((value) => Number.isFinite(Number(value))).map(Number).sort((a, b) => a - b);
        if (!valid.length) return null;
        const mid = Math.floor(valid.length / 2);
        return valid.length % 2 === 0 ? (valid[mid - 1] + valid[mid]) / 2 : valid[mid];
    }

    function uniqueFlags(flags = []) {
        return [...new Set((flags || []).filter(Boolean).map(String))];
    }

    function getSpecificCapacityForMethod(row = {}, requestedMethod = "preferred") {
        const candidates = row?.specific_capacity_candidates || {};
        const preferredMethod = row?.preferred_specific_capacity_method || "current_proxy";
        const selectedMethod = requestedMethod === "preferred" ? preferredMethod : requestedMethod;
        const directValue = candidates[selectedMethod];
        if (Number.isFinite(Number(directValue))) {
            return { method: selectedMethod, value: Number(directValue) };
        }
        const fallbackValue = Number(row?.preferred_specific_capacity_m3h_per_m ?? row?.specific_capacity_m3h_per_m);
        return {
            method: preferredMethod,
            value: Number.isFinite(fallbackValue) ? fallbackValue : null
        };
    }

    function utcDayKey(value) {
        const ms = Number(value);
        return Number.isFinite(ms) ? new Date(ms).toISOString().slice(0, 10) : "";
    }

    function typicalIntervalMs(points = []) {
        if (points.length < 2) return HOUR_MS;
        const diffs = [];
        for (let i = 1; i < points.length; i++) {
            const diff = points[i].timestamp_ms - points[i - 1].timestamp_ms;
            if (diff > 0) diffs.push(diff);
        }
        return median(diffs) || HOUR_MS;
    }

    function estimateSpanHours(points, index, defaultIntervalMs) {
        const point = points[index];
        if (!point) return 0;
        const explicit = Number(point.sample_span_hours);
        if (Number.isFinite(explicit) && explicit > 0) return explicit;
        const next = points[index + 1];
        const diffMs = next && next.timestamp_ms > point.timestamp_ms
            ? Math.min(next.timestamp_ms - point.timestamp_ms, Math.max(defaultIntervalMs, 6 * HOUR_MS))
            : defaultIntervalMs;
        return diffMs / HOUR_MS;
    }

    function findNearestPoint(points, timestampMs, maxDiffMs = 2 * HOUR_MS) {
        let best = null;
        let bestDiff = Infinity;
        for (const point of points || []) {
            const diff = Math.abs(point.timestamp_ms - timestampMs);
            if (diff <= maxDiffMs && diff < bestDiff) {
                best = point;
                bestDiff = diff;
            }
            if (point.timestamp_ms > timestampMs && diff > bestDiff) break;
        }
        return best;
    }

    function computeRecoveryTimeHours(levelPoints, eventState, options = {}) {
        const toleranceM = Number.isFinite(Number(options.recoveryToleranceM)) ? Number(options.recoveryToleranceM) : 0.05;
        const recoveryWindowHours = Number.isFinite(Number(options.recoveryWindowHours)) ? Number(options.recoveryWindowHours) : 24;
        const startLevel = Number(eventState?.start_level_point?.value);
        const endMs = Number(eventState?.end_ms);

        if (!Number.isFinite(startLevel) || !Number.isFinite(endMs)) {
            return { recovery_time_h: null, flags: ["insufficient_recovery_support"] };
        }

        const postLevels = (levelPoints || []).filter((point) => point.timestamp_ms > endMs && point.timestamp_ms <= (endMs + (recoveryWindowHours * HOUR_MS)));
        if (postLevels.length < 2) {
            return { recovery_time_h: null, flags: ["insufficient_post_event_level_support"] };
        }

        const recoveryTarget = startLevel - toleranceM;
        const recoveredPoint = postLevels.find((point) => Number(point.value) >= recoveryTarget);
        if (!recoveredPoint) {
            return { recovery_time_h: null, flags: ["recovery_not_observed_within_window"] };
        }

        return {
            recovery_time_h: round((recoveredPoint.timestamp_ms - endMs) / HOUR_MS, 2),
            flags: []
        };
    }

    function buildEventDetailRows(report, options = {}) {
        const cleanedBundle = report?.cleaned?.cleaned_bundle || report?.cleaned_bundle || report?.normalized || {};
        const levelPoints = cleanedBundle?.series?.[Schema.PARAMETERS.WATER_LEVEL] || [];
        const completedEvents = report?.detected?.completed_events || [];
        const eventRows = Array.isArray(report?.event_rows) ? report.event_rows : [];
        const highDrawdownThresholdM = Number.isFinite(Number(options.highDrawdownThresholdM)) ? Number(options.highDrawdownThresholdM) : 2;
        const lowSpecificCapacityThreshold = Number.isFinite(Number(options.lowSpecificCapacityThreshold)) ? Number(options.lowSpecificCapacityThreshold) : 0.25;
        const weakRecoveryHoursThreshold = Number.isFinite(Number(options.weakRecoveryHoursThreshold)) ? Number(options.weakRecoveryHoursThreshold) : 8;
        const qsMethod = String(options.qsMethod || "preferred");

        return eventRows.map((row, index) => {
            const eventState = completedEvents[index] || {};
            const recovery = computeRecoveryTimeHours(levelPoints, eventState, options);
            const selectedQs = getSpecificCapacityForMethod(row, qsMethod);
            const flags = uniqueFlags([...(row.quality_flags || []), ...(recovery.flags || [])]);
            const stressReasons = [];
            const drawdown = Number(row.maximum_drawdown_m ?? row.drawdown_m);
            const specificCapacity = Number(selectedQs.value);

            if (drawdown >= highDrawdownThresholdM) stressReasons.push("high_drawdown_event");
            if (Number.isFinite(specificCapacity) && specificCapacity <= lowSpecificCapacityThreshold) stressReasons.push("low_specific_capacity_event");
            if (Number.isFinite(recovery.recovery_time_h) && recovery.recovery_time_h >= weakRecoveryHoursThreshold) stressReasons.push("slow_recovery_event");
            if ((recovery.flags || []).includes("recovery_not_observed_within_window")) stressReasons.push("recovery_not_observed");
            if ((row.flow_behavior_profile || "") === "short_burst") stressReasons.push("short_burst_profile");
            if (flags.some((flag) => ["invalid_specific_capacity", "insufficient_water_level", "event_contains_gap", "sparse_event_signal"].includes(flag))) {
                stressReasons.push("quality_limited_event");
            }

            return {
                ...row,
                date: String(row.event_start || "").slice(0, 10),
                active_qs_method: selectedQs.method,
                selected_specific_capacity_method: selectedQs.method,
                selected_specific_capacity_m3h_per_m: round(selectedQs.value),
                event_profile: row.flow_behavior_profile || "unclassified",
                recovery_time_h: recovery.recovery_time_h,
                stress_event: stressReasons.length > 0,
                stress_reasons: uniqueFlags(stressReasons),
                quality_flags: flags
            };
        });
    }

    function estimateRestingLevel(levelPoints, flowPoints, date, flowThreshold, options = {}) {
        const minRestPoints = Number.isFinite(Number(options.minRestPoints)) ? Number(options.minRestPoints) : 3;
        const restWindowMs = Number.isFinite(Number(options.restWindowHours)) ? Number(options.restWindowHours) * HOUR_MS : 2 * HOUR_MS;
        const dayLevelPoints = (levelPoints || []).filter((point) => utcDayKey(point.timestamp_ms) === date);
        const candidates = [];

        for (const levelPoint of dayLevelPoints) {
            const nearestFlow = findNearestPoint(flowPoints, levelPoint.timestamp_ms, restWindowMs);
            if (!nearestFlow || Number(nearestFlow.value) <= flowThreshold) {
                candidates.push(Number(levelPoint.value));
            }
        }

        return {
            estimated_daily_resting_level_m: candidates.length >= minRestPoints ? round(median(candidates)) : null,
            rest_support_count: candidates.length,
            flags: candidates.length >= minRestPoints ? [] : ["insufficient_resting_level_support"]
        };
    }

    function ensureDailyRow(map, source, date) {
        if (!map.has(date)) {
            map.set(date, {
                date,
                provider: source?.provider || "Unknown",
                borehole_id: source?.borehole_id || source?.site_id || "Unknown",
                display_name: source?.display_name || source?.borehole_id || source?.site_id || "Unknown",
                approximate: source?.confidence_class === "screening",
                daily_pumped_volume_m3: 0,
                total_hours_pumped: 0,
                event_count: 0,
                maximum_drawdown_m: null,
                median_drawdown_m: null,
                median_specific_capacity_m3h_per_m: null,
                worst_specific_capacity_m3h_per_m: null,
                daily_min_groundwater_level_m: null,
                daily_max_groundwater_level_m: null,
                estimated_daily_resting_level_m: null,
                median_recovery_time_h: null,
                stress_event_count: 0,
                recovery_weakness_count: 0,
                valid_specific_capacity_event_count: 0,
                daily_max_flow_m3h: null,
                median_event_flow_m3h: null,
                stable_tail_event_count: 0,
                short_burst_event_count: 0,
                active_qs_method: null,
                flow_observation_count: 0,
                level_observation_count: 0,
                downtime_indicator: 0,
                daily_quality_flags: [],
                _flowFlags: [],
                _eventDetails: []
            });
        }
        return map.get(date);
    }

    function computeDailyAnalytics(report, options = {}) {
        const cleanedBundle = report?.cleaned?.cleaned_bundle || report?.cleaned_bundle || report?.normalized || report?.bundle || {};
        const source = cleanedBundle?.source || report?.normalized?.source || report?.source || {};
        const flowPoints = cleanedBundle?.series?.[Schema.PARAMETERS.FLOW] || [];
        const levelPoints = cleanedBundle?.series?.[Schema.PARAMETERS.WATER_LEVEL] || [];
        const qcSummary = report?.cleaned?.qc_summary || report?.qc_summary || {};
        const flowThreshold = Number.isFinite(Number(options.flowThreshold))
            ? Number(options.flowThreshold)
            : Number(report?.detected?.flow_threshold || 0.1);
        const qsMethod = String(options.qsMethod || "preferred");
        const defaultIntervalMs = typicalIntervalMs(flowPoints);
        const dayMap = new Map();
        const eventDetails = buildEventDetailRows(report, { ...options, qsMethod });

        [...flowPoints, ...levelPoints].forEach((point) => {
            const date = utcDayKey(point.timestamp_ms);
            if (date) ensureDailyRow(dayMap, source, date);
        });
        eventDetails.forEach((row) => {
            if (row.date) ensureDailyRow(dayMap, source, row.date);
        });

        flowPoints.forEach((point, index) => {
            const date = utcDayKey(point.timestamp_ms);
            if (!date) return;
            const row = ensureDailyRow(dayMap, source, date);
            row.flow_observation_count += 1;
            row._flowFlags.push(...(point.flags || []));
            if (Number(point.value) > flowThreshold) {
                const spanHours = estimateSpanHours(flowPoints, index, defaultIntervalMs);
                row.daily_pumped_volume_m3 += Number(point.value) * spanHours;
                row.total_hours_pumped += spanHours;
            }
        });

        levelPoints.forEach((point) => {
            const date = utcDayKey(point.timestamp_ms);
            if (!date) return;
            const row = ensureDailyRow(dayMap, source, date);
            row.level_observation_count += 1;
            const value = Number(point.value);
            if (row.daily_min_groundwater_level_m === null || value < row.daily_min_groundwater_level_m) {
                row.daily_min_groundwater_level_m = value;
            }
            if (row.daily_max_groundwater_level_m === null || value > row.daily_max_groundwater_level_m) {
                row.daily_max_groundwater_level_m = value;
            }
            row._flowFlags.push(...(point.flags || []));
        });

        eventDetails.forEach((eventDetail) => {
            const row = ensureDailyRow(dayMap, source, eventDetail.date);
            row.event_count += 1;
            row._eventDetails.push(eventDetail);
        });

        const dailyRows = Array.from(dayMap.values())
            .sort((a, b) => a.date.localeCompare(b.date))
            .map((row) => {
                const drawdowns = row._eventDetails
                    .map((detail) => detail.drawdown_m)
                    .filter((value) => value !== null && value !== undefined && Number.isFinite(Number(value)))
                    .map(Number);
                const specificCapacities = row._eventDetails
                    .map((detail) => detail.selected_specific_capacity_m3h_per_m)
                    .filter((value) => value !== null && value !== undefined && Number.isFinite(Number(value)))
                    .map(Number);
                const recoveries = row._eventDetails
                    .map((detail) => detail.recovery_time_h)
                    .filter((value) => value !== null && value !== undefined && Number.isFinite(Number(value)))
                    .map(Number);
                const eventFlows = row._eventDetails
                    .map((detail) => detail.median_positive_flow_m3h)
                    .filter((value) => value !== null && value !== undefined && Number.isFinite(Number(value)))
                    .map(Number);
                const maxFlows = row._eventDetails
                    .map((detail) => detail.max_flow_m3h)
                    .filter((value) => value !== null && value !== undefined && Number.isFinite(Number(value)))
                    .map(Number);
                const restEstimate = estimateRestingLevel(levelPoints, flowPoints, row.date, flowThreshold, options);

                row.maximum_drawdown_m = round(drawdowns.length ? Math.max(...drawdowns) : null);
                row.median_drawdown_m = round(median(drawdowns));
                row.median_specific_capacity_m3h_per_m = round(median(specificCapacities));
                row.worst_specific_capacity_m3h_per_m = round(specificCapacities.length ? Math.min(...specificCapacities) : null);
                row.valid_specific_capacity_event_count = specificCapacities.length;
                row.median_recovery_time_h = round(median(recoveries), 2);
                row.daily_max_flow_m3h = round(maxFlows.length ? Math.max(...maxFlows) : null);
                row.median_event_flow_m3h = round(median(eventFlows));
                row.stress_event_count = row._eventDetails.filter((detail) => detail.stress_event).length;
                row.recovery_weakness_count = row._eventDetails.filter((detail) => (detail.stress_reasons || []).includes("slow_recovery_event") || (detail.stress_reasons || []).includes("recovery_not_observed")).length;
                row.stable_tail_event_count = row._eventDetails.filter((detail) => detail.has_stable_tail_support).length;
                row.short_burst_event_count = row._eventDetails.filter((detail) => detail.event_profile === "short_burst").length;
                row.active_qs_method = row._eventDetails.find((detail) => detail.selected_specific_capacity_method)?.selected_specific_capacity_method || qsMethod;
                row.estimated_daily_resting_level_m = restEstimate.estimated_daily_resting_level_m;
                row.downtime_indicator = row.flow_observation_count > 0 && row.daily_pumped_volume_m3 <= 0 ? 1 : 0;

                row.daily_quality_flags = uniqueFlags([
                    ...(row.approximate ? ["approximate_source"] : []),
                    ...(qcSummary.is_approximate ? ["approximate_source"] : []),
                    ...(row.downtime_indicator ? ["downtime_proxy"] : []),
                    ...(row._eventDetails.flatMap((detail) => detail.quality_flags || [])),
                    ...(row._eventDetails.flatMap((detail) => detail.stress_reasons || [])),
                    ...(restEstimate.flags || []),
                    ...row._flowFlags
                ]);

                row.daily_pumped_volume_m3 = round(row.daily_pumped_volume_m3);
                row.total_hours_pumped = round(row.total_hours_pumped, 2);
                row.daily_min_groundwater_level_m = round(row.daily_min_groundwater_level_m);
                row.daily_max_groundwater_level_m = round(row.daily_max_groundwater_level_m);

                delete row._flowFlags;
                delete row._eventDetails;
                return row;
            });

        dailyRows.event_detail_rows = eventDetails;
        dailyRows.source = source;
        return dailyRows;
    }

    return {
        computeDailyAnalytics,
        buildEventDetailRows,
        computeRecoveryTimeHours
    };
});