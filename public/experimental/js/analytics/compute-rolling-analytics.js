(function (global, factory) {
    const api = factory(global);
    if (typeof module !== "undefined" && module.exports) {
        module.exports = api;
    }
    global.SiteMonitorExperimental = global.SiteMonitorExperimental || {};
    global.SiteMonitorExperimental.RollingAnalytics = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
    const DAY_MS = 24 * 60 * 60 * 1000;

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

    function dateMs(date) {
        return Date.parse(`${date}T00:00:00Z`);
    }

    function linearTrendPerDay(rows, field) {
        const valid = rows
            .map((row) => ({ x: dateMs(row.date), y: Number(row[field]) }))
            .filter((point) => Number.isFinite(point.x) && Number.isFinite(point.y));
        if (valid.length < 2) return null;

        const x0 = valid[0].x;
        const normalized = valid.map((point) => ({ x: (point.x - x0) / DAY_MS, y: point.y }));
        const avgX = normalized.reduce((sum, point) => sum + point.x, 0) / normalized.length;
        const avgY = normalized.reduce((sum, point) => sum + point.y, 0) / normalized.length;
        const numerator = normalized.reduce((sum, point) => sum + ((point.x - avgX) * (point.y - avgY)), 0);
        const denominator = normalized.reduce((sum, point) => sum + ((point.x - avgX) ** 2), 0);
        return denominator > 0 ? round(numerator / denominator, 4) : null;
    }

    function trailingRows(rows, anchorDate, days) {
        const endMs = dateMs(anchorDate);
        const startMs = endMs - ((days - 1) * DAY_MS);
        return rows.filter((row) => {
            const ms = dateMs(row.date);
            return Number.isFinite(ms) && ms >= startMs && ms <= endMs;
        });
    }

    function computeRollingAnalytics(dailyRows = [], eventDetailRows = [], options = {}) {
        const grouped = new Map();
        const eventRows = Array.isArray(eventDetailRows) && eventDetailRows.length
            ? eventDetailRows
            : (dailyRows?.event_detail_rows || []);

        for (const row of (dailyRows || [])) {
            const key = `${row.provider || "Unknown"}:${row.borehole_id || "Unknown"}`;
            if (!grouped.has(key)) grouped.set(key, []);
            grouped.get(key).push(row);
        }

        const output = [];

        grouped.forEach((rows) => {
            const orderedRows = [...rows].sort((a, b) => a.date.localeCompare(b.date));
            const boreholeId = orderedRows[0]?.borehole_id || "Unknown";
            const provider = orderedRows[0]?.provider || "Unknown";
            const scopedEvents = eventRows.filter((row) => row.borehole_id === boreholeId && row.provider === provider);

            orderedRows.forEach((row) => {
                const rows7 = trailingRows(orderedRows, row.date, 7);
                const rows30 = trailingRows(orderedRows, row.date, 30);
                const events7 = scopedEvents.filter((detail) => detail.date >= rows7[0]?.date && detail.date <= row.date);
                const events30 = scopedEvents.filter((detail) => detail.date >= rows30[0]?.date && detail.date <= row.date);

                const qs7 = events7.map((detail) => detail.selected_specific_capacity_m3h_per_m).filter((value) => value !== null && value !== undefined && Number.isFinite(Number(value))).map(Number);
                const qs30 = events30.map((detail) => detail.selected_specific_capacity_m3h_per_m).filter((value) => value !== null && value !== undefined && Number.isFinite(Number(value))).map(Number);
                const dailyQs7 = rows7.map((item) => item.median_specific_capacity_m3h_per_m).filter((value) => value !== null && value !== undefined && Number.isFinite(Number(value))).map(Number);
                const dailyQs30 = rows30.map((item) => item.median_specific_capacity_m3h_per_m).filter((value) => value !== null && value !== undefined && Number.isFinite(Number(value))).map(Number);
                const draw7 = events7.map((detail) => detail.drawdown_m).filter((value) => value !== null && value !== undefined && Number.isFinite(Number(value))).map(Number);
                const draw30 = events30.map((detail) => detail.drawdown_m).filter((value) => value !== null && value !== undefined && Number.isFinite(Number(value))).map(Number);
                const maxFlow7 = rows7.map((item) => item.daily_max_flow_m3h).filter((value) => value !== null && value !== undefined && Number.isFinite(Number(value))).map(Number);
                const maxFlow30 = rows30.map((item) => item.daily_max_flow_m3h).filter((value) => value !== null && value !== undefined && Number.isFinite(Number(value))).map(Number);
                const eventCount7 = rows7.reduce((sum, item) => sum + (Number(item.event_count) || 0), 0);
                const eventCount30 = rows30.reduce((sum, item) => sum + (Number(item.event_count) || 0), 0);
                const stableTailCount7 = rows7.reduce((sum, item) => sum + (Number(item.stable_tail_event_count) || 0), 0);
                const stableTailCount30 = rows30.reduce((sum, item) => sum + (Number(item.stable_tail_event_count) || 0), 0);
                const shortBurstCount7 = rows7.reduce((sum, item) => sum + (Number(item.short_burst_event_count) || 0), 0);
                const shortBurstCount30 = rows30.reduce((sum, item) => sum + (Number(item.short_burst_event_count) || 0), 0);

                output.push({
                    date: row.date,
                    provider,
                    borehole_id: boreholeId,
                    display_name: row.display_name,
                    qs_method: row.active_qs_method || options.qsMethod || "event_median_proxy",
                    rolling_7d_volume_m3: round(rows7.reduce((sum, item) => sum + (Number(item.daily_pumped_volume_m3) || 0), 0)),
                    rolling_30d_volume_m3: round(rows30.reduce((sum, item) => sum + (Number(item.daily_pumped_volume_m3) || 0), 0)),
                    rolling_7d_specific_capacity_median: round(median(qs7.length ? qs7 : dailyQs7)),
                    rolling_30d_specific_capacity_median: round(median(qs30.length ? qs30 : dailyQs30)),
                    rolling_7d_drawdown_median: round(median(draw7)),
                    rolling_30d_drawdown_median: round(median(draw30)),
                    rolling_7d_max_flow_m3h: round(maxFlow7.length ? Math.max(...maxFlow7) : null),
                    rolling_30d_max_flow_m3h: round(maxFlow30.length ? Math.max(...maxFlow30) : null),
                    rolling_7d_stable_tail_share: eventCount7 ? round(stableTailCount7 / eventCount7, 3) : (rows7.some((item) => Number(item.event_count) > 0) ? 0 : null),
                    rolling_30d_stable_tail_share: eventCount30 ? round(stableTailCount30 / eventCount30, 3) : (rows30.some((item) => Number(item.event_count) > 0) ? 0 : null),
                    rolling_7d_short_burst_count: shortBurstCount7,
                    rolling_30d_short_burst_count: shortBurstCount30,
                    resting_level_trend_7d_m_per_day: linearTrendPerDay(rows7, "estimated_daily_resting_level_m"),
                    resting_level_trend_30d_m_per_day: linearTrendPerDay(rows30, "estimated_daily_resting_level_m"),
                    rolling_7d_stress_event_count: rows7.reduce((sum, item) => sum + (Number(item.stress_event_count) || 0), 0),
                    rolling_30d_stress_event_count: rows30.reduce((sum, item) => sum + (Number(item.stress_event_count) || 0), 0),
                    rolling_7d_recovery_weakness_count: rows7.reduce((sum, item) => sum + (Number(item.recovery_weakness_count) || 0), 0),
                    rolling_30d_recovery_weakness_count: rows30.reduce((sum, item) => sum + (Number(item.recovery_weakness_count) || 0), 0),
                    rolling_7d_downtime_days: rows7.reduce((sum, item) => sum + (Number(item.downtime_indicator) || 0), 0),
                    rolling_30d_downtime_days: rows30.reduce((sum, item) => sum + (Number(item.downtime_indicator) || 0), 0),
                    rolling_quality_flags: uniqueFlags([
                        ...(qs7.length ? [] : ["insufficient_7d_specific_capacity_support"]),
                        ...(qs30.length ? [] : ["insufficient_30d_specific_capacity_support"]),
                        ...(rows7.some((item) => (item.daily_quality_flags || []).length) ? ["recent_quality_flags_present"] : []),
                        ...(rows30.some((item) => (item.daily_quality_flags || []).includes("downtime_proxy")) ? ["recent_downtime_proxy_present"] : [])
                    ])
                });
            });
        });

        return output.sort((a, b) => `${a.borehole_id}|${a.date}`.localeCompare(`${b.borehole_id}|${b.date}`));
    }

    return {
        computeRollingAnalytics
    };
});