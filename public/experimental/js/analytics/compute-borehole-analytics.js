(function (global, factory) {
    const api = factory(global);
    if (typeof module !== "undefined" && module.exports) {
        module.exports = api;
    }
    global.SiteMonitorExperimental = global.SiteMonitorExperimental || {};
    global.SiteMonitorExperimental.BoreholeAnalytics = api;
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

    function coefficientOfVariation(values = []) {
        const valid = values.filter((value) => Number.isFinite(Number(value))).map(Number);
        if (valid.length < 2) return null;
        const mean = valid.reduce((sum, value) => sum + value, 0) / valid.length;
        if (!mean) return null;
        const variance = valid.reduce((sum, value) => sum + ((value - mean) ** 2), 0) / valid.length;
        return Math.sqrt(variance) / mean;
    }

    function uniqueFlags(flags = []) {
        return [...new Set((flags || []).filter(Boolean).map(String))];
    }

    function longestStreak(rows = [], predicate = () => false) {
        let best = 0;
        let current = 0;
        rows.forEach((row) => {
            if (predicate(row)) {
                current += 1;
                best = Math.max(best, current);
            } else {
                current = 0;
            }
        });
        return best;
    }

    function determineReadiness({ telemetryDaysObserved, validEventCount, totalEvents }) {
        if (telemetryDaysObserved >= 20 && validEventCount >= 5) return "A";
        if (telemetryDaysObserved >= 20 && totalEvents >= 1) return "B";
        if (telemetryDaysObserved >= 10) return "C";
        return "D";
    }

    function determineTypology(summary) {
        if (summary.analysis_readiness_tier === "D") return "insufficient_data";
        if ((summary.active_day_share || 0) <= 0.02) return "inactive_or_rest_only";
        if (summary.stress_flag) return "stressed_review";
        if ((summary.total_volume_m3 || 0) >= 200 || (summary.event_frequency_per_week || 0) >= 3) return "high_use";
        if (summary.data_unreliability_index >= 0.5) return "unreliable_data";
        if ((summary.intermittency_index || 0) >= 1.5 || (summary.downtime_proxy_share || 0) >= 0.3) return "intermittent";
        return "moderate_use";
    }

    function computeBoreholeAnalytics(reportOrSource = {}, dailyRows = [], rollingRows = [], options = {}) {
        const source = reportOrSource?.source || reportOrSource?.normalized?.source || reportOrSource || {};
        const provider = source?.provider || dailyRows[0]?.provider || "Unknown";
        const boreholeId = source?.borehole_id || dailyRows[0]?.borehole_id || "Unknown";
        const displayName = source?.display_name || dailyRows[0]?.display_name || boreholeId;
        const orderedDaily = [...(dailyRows || [])].sort((a, b) => a.date.localeCompare(b.date));
        const orderedRolling = [...(rollingRows || [])].sort((a, b) => a.date.localeCompare(b.date));
        const telemetryDaysObserved = orderedDaily.length;
        const reviewWindowDays = telemetryDaysObserved > 1
            ? Math.max(1, Math.round((Date.parse(`${orderedDaily[telemetryDaysObserved - 1].date}T00:00:00Z`) - Date.parse(`${orderedDaily[0].date}T00:00:00Z`)) / DAY_MS) + 1)
            : telemetryDaysObserved;
        const activeDays = orderedDaily.filter((row) => Number(row.daily_pumped_volume_m3) > 0).length;
        const totalVolume = orderedDaily.reduce((sum, row) => sum + (Number(row.daily_pumped_volume_m3) || 0), 0);
        const totalEvents = orderedDaily.reduce((sum, row) => sum + (Number(row.event_count) || 0), 0);
        const validEventCount = orderedDaily.reduce((sum, row) => sum + (Number(row.valid_specific_capacity_event_count) || 0), 0);
        const downtimeDays = orderedDaily.reduce((sum, row) => sum + (Number(row.downtime_indicator) || 0), 0);
        const dataQualityFlagSet = new Set([
            "approximate_source",
            "insufficient_resting_level_support",
            "invalid_specific_capacity",
            "quality_limited_event",
            "event_contains_gap",
            "sparse_event_signal",
            "timestamp_gap_after_previous",
            "noisy_readings_adjusted",
            "noise_adjusted",
            "recovery_not_observed_within_window",
            "insufficient_post_event_level_support"
        ]);
        const flaggedDays = orderedDaily.filter((row) => (row.daily_quality_flags || []).some((flag) => dataQualityFlagSet.has(flag))).length;
        const latestRolling = orderedRolling[orderedRolling.length - 1] || {};

        const summary = {
            provider,
            borehole_id: boreholeId,
            display_name: displayName,
            approximate: provider === "SonSetLink" || source?.confidence_class === "screening",
            telemetry_days_observed: telemetryDaysObserved,
            review_window_days: reviewWindowDays,
            telemetry_coverage_percent: reviewWindowDays ? round((telemetryDaysObserved / reviewWindowDays) * 100, 1) : 0,
            active_days: activeDays,
            active_day_share: reviewWindowDays ? round(activeDays / reviewWindowDays, 3) : 0,
            total_volume_m3: round(totalVolume),
            median_daily_volume_m3: round(median(orderedDaily.map((row) => Number(row.daily_pumped_volume_m3)).filter(Number.isFinite))),
            max_daily_volume_m3: round(Math.max(0, ...orderedDaily.map((row) => Number(row.daily_pumped_volume_m3) || 0))),
            median_hours_pumped_per_active_day: round(median(orderedDaily.filter((row) => Number(row.total_hours_pumped) > 0).map((row) => Number(row.total_hours_pumped))), 2),
            event_frequency_per_week: reviewWindowDays ? round(totalEvents / Math.max(reviewWindowDays / 7, 1), 2) : 0,
            total_events: totalEvents,
            valid_specific_capacity_event_count: validEventCount,
            median_valid_specific_capacity_m3h_per_m: round(median(orderedDaily.map((row) => row.median_specific_capacity_m3h_per_m).filter((value) => value !== null && value !== undefined && Number.isFinite(Number(value))).map(Number))),
            median_event_drawdown_m: round(median(orderedDaily.map((row) => row.median_drawdown_m).filter((value) => value !== null && value !== undefined && Number.isFinite(Number(value))).map(Number))),
            max_drawdown_observed_m: round(Math.max(...orderedDaily.map((row) => row.maximum_drawdown_m).filter((value) => value !== null && value !== undefined && Number.isFinite(Number(value))).map(Number), 0)),
            median_recovery_time_h: round(median(orderedDaily.map((row) => row.median_recovery_time_h).filter((value) => value !== null && value !== undefined && Number.isFinite(Number(value))).map(Number)), 2),
            recovery_weakness_share: totalEvents ? round(orderedDaily.reduce((sum, row) => sum + (Number(row.recovery_weakness_count) || 0), 0) / totalEvents, 3) : 0,
            downtime_proxy_days: downtimeDays,
            downtime_proxy_share: reviewWindowDays ? round(downtimeDays / reviewWindowDays, 3) : 0,
            longest_inactivity_streak_days: longestStreak(orderedDaily, (row) => Number(row.daily_pumped_volume_m3) <= 0),
            observed_uptime_proxy_percent: reviewWindowDays ? round((1 - (downtimeDays / reviewWindowDays)) * 100, 1) : null,
            intermittency_index: activeDays ? round(totalEvents / activeDays, 2) : 0,
            daily_volume_cv: round(coefficientOfVariation(orderedDaily.filter((row) => Number(row.daily_pumped_volume_m3) > 0).map((row) => Number(row.daily_pumped_volume_m3))), 3),
            flagged_day_share: reviewWindowDays ? round(flaggedDays / reviewWindowDays, 3) : 0,
            data_unreliability_index: reviewWindowDays
                ? round(Math.min(1, (flaggedDays / reviewWindowDays) + ((reviewWindowDays - telemetryDaysObserved) / reviewWindowDays)), 3)
                : 1,
            performance_decline_ratio_7d_vs_30d: null,
            performance_decline_flag: false,
            stress_component_count: 0,
            stress_reasons: [],
            stress_flag: false,
            analysis_readiness_tier: "D",
            typology_group: "insufficient_data",
            summary_quality_flags: []
        };

        const qs7 = Number(latestRolling.rolling_7d_specific_capacity_median);
        const qs30 = Number(latestRolling.rolling_30d_specific_capacity_median);
        const draw7 = Number(latestRolling.rolling_7d_drawdown_median);
        const draw30 = Number(latestRolling.rolling_30d_drawdown_median);
        if (Number.isFinite(qs7) && Number.isFinite(qs30) && qs30 > 0) {
            summary.performance_decline_ratio_7d_vs_30d = round(qs7 / qs30, 3);
        }

        summary.performance_decline_flag = !!(
            (Number.isFinite(summary.performance_decline_ratio_7d_vs_30d) && summary.performance_decline_ratio_7d_vs_30d < 0.8) ||
            (Number.isFinite(draw7) && Number.isFinite(draw30) && draw30 > 0 && draw7 > (draw30 * 1.25))
        );

        if ((latestRolling.rolling_30d_stress_event_count || 0) >= 2) summary.stress_reasons.push("repeated_recent_stress_events");
        if ((summary.max_drawdown_observed_m || 0) >= 2) summary.stress_reasons.push("high_drawdown_observed");
        if (Number.isFinite(summary.median_valid_specific_capacity_m3h_per_m) && summary.median_valid_specific_capacity_m3h_per_m <= 0.5) summary.stress_reasons.push("low_specific_capacity_summary");
        if (Number.isFinite(latestRolling.resting_level_trend_30d_m_per_day) && latestRolling.resting_level_trend_30d_m_per_day < -0.02) summary.stress_reasons.push("falling_resting_level_trend");
        if ((latestRolling.rolling_30d_recovery_weakness_count || 0) >= 2) summary.stress_reasons.push("recovery_weakness_observed");

        summary.stress_reasons = uniqueFlags(summary.stress_reasons);
        summary.stress_component_count = summary.stress_reasons.length;
        summary.stress_flag = summary.stress_component_count >= 2;
        summary.analysis_readiness_tier = determineReadiness({
            telemetryDaysObserved,
            validEventCount,
            totalEvents
        });
        summary.typology_group = determineTypology(summary);
        summary.summary_quality_flags = uniqueFlags([
            ...(summary.approximate ? ["approximate_source"] : []),
            ...(summary.performance_decline_flag ? ["performance_decline_flag"] : []),
            ...(summary.stress_flag ? ["stress_flag"] : []),
            ...(summary.analysis_readiness_tier === "D" ? ["limited_analysis_readiness"] : [])
        ]);

        return summary;
    }

    return {
        computeBoreholeAnalytics
    };
});