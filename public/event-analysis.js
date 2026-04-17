(function (global, factory) {
    const api = factory();
    if (typeof module !== "undefined" && module.exports) {
        module.exports = api;
    }
    if (typeof window !== "undefined") {
        window.SiteMonitorEventAnalysis = api;
    }
})(this, function () {
    const HOUR_MS = 60 * 60 * 1000;

    function toFiniteNumber(value) {
        const n = Number(value);
        return Number.isFinite(n) ? n : null;
    }

    function round(value, digits = 3) {
        return Number.isFinite(value) ? Number(value.toFixed(digits)) : null;
    }

    function sortPoints(points, code) {
        if (!Array.isArray(points)) return [];
        return points
            .filter((p) => (!code || p.code === code) && Number.isFinite(Number(p.timestamp_ms)))
            .map((p) => ({
                ...p,
                value: toFiniteNumber(p.value),
                timestamp_ms: Number(p.timestamp_ms)
            }))
            .filter((p) => p.value !== null)
            .sort((a, b) => a.timestamp_ms - b.timestamp_ms);
    }

    function median(values) {
        if (!values.length) return null;
        const sorted = [...values].sort((a, b) => a - b);
        const mid = Math.floor(sorted.length / 2);
        return sorted.length % 2 === 0
            ? (sorted[mid - 1] + sorted[mid]) / 2
            : sorted[mid];
    }

    function typicalIntervalMs(points) {
        if (!Array.isArray(points) || points.length < 2) return HOUR_MS;
        const diffs = [];
        for (let i = 1; i < points.length; i++) {
            const diff = points[i].timestamp_ms - points[i - 1].timestamp_ms;
            if (diff > 0) diffs.push(diff);
        }
        return median(diffs) || HOUR_MS;
    }

    function findNearestLevel(levelPoints, timestampMs, maxDiffMs) {
        if (!levelPoints.length) return null;

        let best = null;
        let bestDiff = Infinity;

        for (const point of levelPoints) {
            const diff = Math.abs(point.timestamp_ms - timestampMs);
            if (diff <= maxDiffMs && diff < bestDiff) {
                best = point;
                bestDiff = diff;
            }
            if (point.timestamp_ms > timestampMs && diff > bestDiff) break;
        }

        return best;
    }

    function detectFlowAnomalies(flowValues) {
        if (!Array.isArray(flowValues) || flowValues.length < 3) return 0;
        const positive = flowValues.filter((v) => v > 0);
        if (positive.length < 3) return 0;

        const med = median(positive) || 0;
        if (med <= 0) return 0;

        let anomalyCount = 0;
        for (let i = 0; i < positive.length; i++) {
            const value = positive[i];
            const prev = positive[Math.max(0, i - 1)];
            const next = positive[Math.min(positive.length - 1, i + 1)];
            const neighborAvg = (prev + next) / 2 || med;
            const isSpike = value > Math.max(med * 2.5, neighborAvg * 2.5);
            const isDip = value < Math.min(med * 0.25, neighborAvg * 0.25);
            if (isSpike || isDip) anomalyCount++;
        }
        return anomalyCount;
    }

    function finalizeEvent(activeEvent, stopTimestampMs, options) {
        const stopTime = Number.isFinite(stopTimestampMs) ? stopTimestampMs : activeEvent.last_flow_timestamp_ms + activeEvent.default_interval_ms;
        const startLevel = activeEvent.start_level_m;
        const endLevel = activeEvent.end_level_m;
        const minLevel = activeEvent.min_level_m;

        const drawdown = (startLevel !== null && endLevel !== null) ? (startLevel - endLevel) : null;
        const maxDrawdown = (startLevel !== null && minLevel !== null) ? (startLevel - minLevel) : null;
        const recovery = (maxDrawdown !== null && drawdown !== null) ? (maxDrawdown - drawdown) : null;

        activeEvent.duration_hours = round((stopTime - activeEvent.event_start_ms) / HOUR_MS, 2);
        activeEvent.event_end_ms = stopTime;
        activeEvent.drawdown_m = round(drawdown, 3);
        activeEvent.max_drawdown_m = round(maxDrawdown, 3);
        activeEvent.recovery_m = round(recovery, 3);
        activeEvent.avg_flow_m3h = activeEvent.flow_readings.length
            ? round(activeEvent.flow_readings.reduce((sum, v) => sum + v, 0) / activeEvent.flow_readings.length, 3)
            : null;

        activeEvent.anomaly_count = detectFlowAnomalies(activeEvent.flow_readings);
        activeEvent.has_flow_anomalies = activeEvent.anomaly_count > 0;
        activeEvent.has_timestamp_gaps = activeEvent.gap_count > 0;

        if (activeEvent.drawdown_m === null) {
            activeEvent.flags.insufficient_water_level = true;
        }
        if (activeEvent.drawdown_m === null || activeEvent.drawdown_m < (options.minDrawdownM || 0.05)) {
            activeEvent.flags.invalid_specific_capacity = true;
        }
        if (activeEvent.drawdown_m !== null && activeEvent.drawdown_m < 0) {
            activeEvent.flags.level_recovered_during_event = true;
        }
        if (activeEvent.has_flow_anomalies) {
            activeEvent.flags.flow_anomaly = true;
        }
        if (activeEvent.has_timestamp_gaps) {
            activeEvent.flags.timestamp_gap = true;
        }

        activeEvent.specific_capacity_m3h_per_m = (!activeEvent.flags.invalid_specific_capacity && activeEvent.final_flow_m3h)
            ? round(activeEvent.final_flow_m3h / activeEvent.drawdown_m, 3)
            : null;

        let qualityScore = 100;
        if (activeEvent.flags.insufficient_water_level) qualityScore -= 35;
        if (activeEvent.flags.invalid_specific_capacity) qualityScore -= 25;
        if (activeEvent.has_flow_anomalies) qualityScore -= Math.min(20, activeEvent.anomaly_count * 8);
        if (activeEvent.has_timestamp_gaps) qualityScore -= Math.min(20, activeEvent.gap_count * 10);
        if (activeEvent.flags.ongoing_event) qualityScore -= 10;
        activeEvent.quality_score = Math.max(0, qualityScore);

        return activeEvent;
    }

    function detectPumpingEvents(flowPoints, waterLevelPoints, meta = {}, options = {}) {
        const settings = {
            flowThreshold: 0.1,
            minDrawdownM: 0.05,
            levelSearchWindowMs: 2 * HOUR_MS,
            ...options
        };

        const flows = sortPoints(flowPoints, "flow");
        const levels = sortPoints(waterLevelPoints, "water_level_above_pump");
        const intervalMs = typicalIntervalMs(flows);
        const gapThresholdMs = Math.max(intervalMs * 1.75, 2 * HOUR_MS);

        const events = [];
        let activeEvent = null;

        for (const point of flows) {
            const isPumping = point.value > settings.flowThreshold;
            const nearestLevel = findNearestLevel(levels, point.timestamp_ms, settings.levelSearchWindowMs);
            const levelValue = nearestLevel ? nearestLevel.value : null;

            if (isPumping && !activeEvent) {
                activeEvent = {
                    well_id: meta.wellId || "",
                    well_name: meta.wellName || meta.siteName || "",
                    source: meta.source || "DCP",
                    event_index: events.length + 1,
                    event_start_ms: point.timestamp_ms,
                    event_end_ms: null,
                    start_level_m: levelValue,
                    end_level_m: levelValue,
                    min_level_m: levelValue,
                    final_flow_m3h: point.value,
                    avg_flow_m3h: null,
                    total_volume_m3: 0,
                    duration_hours: 0,
                    drawdown_m: null,
                    max_drawdown_m: null,
                    recovery_m: null,
                    specific_capacity_m3h_per_m: null,
                    quality_score: 100,
                    flow_readings: [point.value],
                    last_flow_m3h: point.value,
                    last_flow_timestamp_ms: point.timestamp_ms,
                    last_level_timestamp_ms: nearestLevel ? nearestLevel.timestamp_ms : null,
                    default_interval_ms: intervalMs,
                    gap_count: 0,
                    anomaly_count: 0,
                    has_flow_anomalies: false,
                    has_timestamp_gaps: false,
                    flags: {
                        insufficient_water_level: levelValue === null,
                        invalid_specific_capacity: false,
                        flow_anomaly: false,
                        timestamp_gap: false,
                        ongoing_event: false,
                        level_recovered_during_event: false
                    }
                };
                continue;
            }

            if (!activeEvent) continue;

            const deltaMs = point.timestamp_ms - activeEvent.last_flow_timestamp_ms;
            if (deltaMs > gapThresholdMs) {
                activeEvent.gap_count += 1;
            }

            if (isPumping) {
                if (deltaMs > 0) {
                    activeEvent.total_volume_m3 += activeEvent.last_flow_m3h * (deltaMs / HOUR_MS);
                }
                activeEvent.last_flow_m3h = point.value;
                activeEvent.final_flow_m3h = point.value;
                activeEvent.last_flow_timestamp_ms = point.timestamp_ms;
                activeEvent.flow_readings.push(point.value);

                if (levelValue !== null) {
                    activeEvent.end_level_m = levelValue;
                    activeEvent.min_level_m = activeEvent.min_level_m === null
                        ? levelValue
                        : Math.min(activeEvent.min_level_m, levelValue);
                    activeEvent.last_level_timestamp_ms = nearestLevel.timestamp_ms;
                }
            } else {
                const stopDeltaMs = Math.max(intervalMs, deltaMs > 0 ? deltaMs : intervalMs);
                activeEvent.total_volume_m3 += activeEvent.last_flow_m3h * (stopDeltaMs / HOUR_MS);
                const closed = finalizeEvent(activeEvent, point.timestamp_ms, settings);
                closed.total_volume_m3 = round(closed.total_volume_m3, 3);
                events.push(closed);
                activeEvent = null;
            }
        }

        if (activeEvent) {
            activeEvent.total_volume_m3 += activeEvent.last_flow_m3h * (activeEvent.default_interval_ms / HOUR_MS);
            activeEvent.flags.ongoing_event = true;
            const closed = finalizeEvent(activeEvent, activeEvent.last_flow_timestamp_ms + activeEvent.default_interval_ms, settings);
            closed.total_volume_m3 = round(closed.total_volume_m3, 3);
            events.push(closed);
        }

        return events;
    }

    function formatEventRow(event) {
        const flags = Object.entries(event.flags || {})
            .filter(([, enabled]) => !!enabled)
            .map(([name]) => name)
            .join(";");

        return {
            well_id: event.well_id || "",
            well_name: event.well_name || "",
            source: event.source || "",
            event_index: event.event_index,
            event_start: event.event_start_ms ? new Date(event.event_start_ms).toISOString() : "",
            event_end: event.event_end_ms ? new Date(event.event_end_ms).toISOString() : "",
            duration_hours: event.duration_hours,
            total_volume_m3: event.total_volume_m3,
            final_flow_m3h: event.final_flow_m3h,
            avg_flow_m3h: event.avg_flow_m3h,
            start_level_m: event.start_level_m,
            end_level_m: event.end_level_m,
            minimum_level_m: event.min_level_m,
            drawdown_m: event.drawdown_m,
            max_drawdown_m: event.max_drawdown_m,
            recovery_m: event.recovery_m,
            specific_capacity_m3h_per_m: event.specific_capacity_m3h_per_m,
            quality_score: event.quality_score,
            anomaly_count: event.anomaly_count || 0,
            gap_count: event.gap_count || 0,
            flags
        };
    }

    function buildEventSummary(events) {
        const rows = Array.isArray(events) ? events : [];
        const validQs = rows.filter((e) => Number.isFinite(e.specific_capacity_m3h_per_m));
        const avgQs = validQs.length
            ? validQs.reduce((sum, e) => sum + e.specific_capacity_m3h_per_m, 0) / validQs.length
            : null;

        return {
            total_events: rows.length,
            boreholes: new Set(rows.map((e) => e.well_id).filter(Boolean)).size,
            valid_events: validQs.length,
            invalid_events: rows.length - validQs.length,
            flagged_events: rows.filter((e) => Object.values(e.flags || {}).some(Boolean)).length,
            average_specific_capacity: round(avgQs, 3)
        };
    }

    function buildBoreholeSummaries(events) {
        const grouped = new Map();
        for (const event of (Array.isArray(events) ? events : [])) {
            const key = event.well_id || event.well_name || "Unknown";
            if (!grouped.has(key)) {
                grouped.set(key, {
                    well_id: event.well_id || "",
                    well_name: event.well_name || event.well_id || "Unknown Borehole",
                    event_count: 0,
                    valid_event_count: 0,
                    flagged_event_count: 0,
                    total_volume_m3: 0,
                    avg_specific_capacity: null,
                    avg_drawdown_m: null,
                    max_drawdown_m: null,
                    latest_event_ms: null,
                    drawdown_count: 0
                });
            }

            const row = grouped.get(key);
            row.event_count += 1;
            row.total_volume_m3 += Number(event.total_volume_m3) || 0;
            if (Object.values(event.flags || {}).some(Boolean)) row.flagged_event_count += 1;
            if (Number.isFinite(event.specific_capacity_m3h_per_m)) {
                row.valid_event_count += 1;
                row.avg_specific_capacity = (row.avg_specific_capacity || 0) + event.specific_capacity_m3h_per_m;
            }
            if (Number.isFinite(event.drawdown_m)) {
                row.drawdown_count += 1;
                row.avg_drawdown_m = (row.avg_drawdown_m || 0) + event.drawdown_m;
            }
            if (Number.isFinite(event.max_drawdown_m)) {
                row.max_drawdown_m = row.max_drawdown_m === null
                    ? event.max_drawdown_m
                    : Math.max(row.max_drawdown_m, event.max_drawdown_m);
            }
            if (!row.latest_event_ms || event.event_start_ms > row.latest_event_ms) {
                row.latest_event_ms = event.event_start_ms;
            }
        }

        return Array.from(grouped.values()).map((row) => ({
            ...row,
            total_volume_m3: round(row.total_volume_m3, 3),
            avg_specific_capacity: row.valid_event_count ? round(row.avg_specific_capacity / row.valid_event_count, 3) : null,
            avg_drawdown_m: row.drawdown_count ? round(row.avg_drawdown_m / row.drawdown_count, 3) : null,
            max_drawdown_m: round(row.max_drawdown_m, 3)
        })).sort((a, b) => a.well_name.localeCompare(b.well_name));
    }

    function buildEventCsv(events) {
        const rows = (Array.isArray(events) ? events : []).map(formatEventRow);
        const headers = [
            "well_id", "well_name", "source", "event_index", "event_start", "event_end",
            "duration_hours", "total_volume_m3", "final_flow_m3h", "avg_flow_m3h",
            "start_level_m", "end_level_m", "minimum_level_m", "drawdown_m",
            "max_drawdown_m", "recovery_m", "specific_capacity_m3h_per_m",
            "quality_score", "anomaly_count", "gap_count", "flags"
        ];

        const escapeCsv = (value) => {
            if (value === null || value === undefined) return "";
            const text = String(value);
            return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
        };

        const lines = [headers.join(",")];
        for (const row of rows) {
            lines.push(headers.map((key) => escapeCsv(row[key])).join(","));
        }
        return lines.join("\n");
    }

    return {
        detectPumpingEvents,
        formatEventRow,
        buildEventSummary,
        buildBoreholeSummaries,
        buildEventCsv
    };
});
