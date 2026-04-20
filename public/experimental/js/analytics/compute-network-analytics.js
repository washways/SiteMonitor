(function (global, factory) {
    const api = factory(global);
    if (typeof module !== "undefined" && module.exports) {
        module.exports = api;
    }
    global.SiteMonitorExperimental = global.SiteMonitorExperimental || {};
    global.SiteMonitorExperimental.NetworkAnalytics = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
    function round(value, digits = 3) {
        return Number.isFinite(value) ? Number(value.toFixed(digits)) : null;
    }

    function percentile(values = [], q = 0.5) {
        const valid = values.filter((value) => Number.isFinite(Number(value))).map(Number).sort((a, b) => a - b);
        if (!valid.length) return null;
        if (valid.length === 1) return valid[0];
        const idx = (valid.length - 1) * q;
        const lo = Math.floor(idx);
        const hi = Math.ceil(idx);
        if (lo === hi) return valid[lo];
        const frac = idx - lo;
        return valid[lo] * (1 - frac) + valid[hi] * frac;
    }

    function stableRank(rows, comparator) {
        const ranked = [...rows].sort(comparator);
        const map = new Map();
        ranked.forEach((row, index) => map.set(`${row.provider}:${row.borehole_id}`, index + 1));
        return map;
    }

    function assignTypology(row, cohort = {}) {
        if (row.analysis_readiness_tier === "D") return "insufficient_data";
        if ((row.active_day_share || 0) <= 0.02) return "inactive_or_rest_only";
        if (row.stress_flag) return "stressed_review";
        if ((row.total_volume_m3 || 0) >= (cohort.volumeP75 || 200)) return "high_use";
        if ((row.data_unreliability_index || 0) >= (cohort.unreliabilityP75 || 0.5)) return "unreliable_data";
        if ((row.intermittency_index || 0) >= (cohort.intermitP75 || 1.5) || (row.downtime_proxy_share || 0) >= 0.3) return "intermittent";
        return "moderate_use";
    }

    function computeNetworkAnalytics(boreholeRows = [], options = {}) {
        const rows = (boreholeRows || []).map((row) => ({ ...row }));
        const volumeP75 = percentile(rows.map((row) => row.total_volume_m3), 0.75) || 0;
        const intermitP75 = percentile(rows.map((row) => row.intermittency_index), 0.75) || 0;
        const unreliabilityP75 = percentile(rows.map((row) => row.data_unreliability_index), 0.75) || 0.5;
        const cohort = { volumeP75, intermitP75, unreliabilityP75 };

        rows.forEach((row) => {
            row.typology_group = assignTypology(row, cohort);
        });

        const byVolume = stableRank(rows, (a, b) => {
            const totalDiff = (Number(b.total_volume_m3) || 0) - (Number(a.total_volume_m3) || 0);
            if (totalDiff !== 0) return totalDiff;
            return (Number(b.median_daily_volume_m3) || 0) - (Number(a.median_daily_volume_m3) || 0);
        });
        const byStress = stableRank(rows, (a, b) => {
            const stressA = [(Number(a.stress_component_count) || 0), (Number(a.max_drawdown_observed_m) || 0), -(Number(a.median_valid_specific_capacity_m3h_per_m) || 0)];
            const stressB = [(Number(b.stress_component_count) || 0), (Number(b.max_drawdown_observed_m) || 0), -(Number(b.median_valid_specific_capacity_m3h_per_m) || 0)];
            for (let i = 0; i < stressA.length; i++) {
                if (stressB[i] !== stressA[i]) return stressB[i] - stressA[i];
            }
            return String(a.display_name || a.borehole_id).localeCompare(String(b.display_name || b.borehole_id));
        });
        const bySpecificCapacity = stableRank(rows, (a, b) => (Number(b.median_valid_specific_capacity_m3h_per_m) || -Infinity) - (Number(a.median_valid_specific_capacity_m3h_per_m) || -Infinity));
        const byDecline = stableRank(rows, (a, b) => {
            const ratioA = Number.isFinite(Number(a.performance_decline_ratio_7d_vs_30d)) ? Number(a.performance_decline_ratio_7d_vs_30d) : Infinity;
            const ratioB = Number.isFinite(Number(b.performance_decline_ratio_7d_vs_30d)) ? Number(b.performance_decline_ratio_7d_vs_30d) : Infinity;
            return ratioA - ratioB;
        });
        const byDowntime = stableRank(rows, (a, b) => (Number(b.downtime_proxy_share) || 0) - (Number(a.downtime_proxy_share) || 0));
        const byUnreliable = stableRank(rows, (a, b) => (Number(b.data_unreliability_index) || 0) - (Number(a.data_unreliability_index) || 0));

        const comparisonTable = rows.map((row) => ({
            ...row,
            rank_highest_volume: byVolume.get(`${row.provider}:${row.borehole_id}`) || null,
            rank_most_stressed: byStress.get(`${row.provider}:${row.borehole_id}`) || null,
            rank_best_specific_capacity: bySpecificCapacity.get(`${row.provider}:${row.borehole_id}`) || null,
            rank_largest_decline: byDecline.get(`${row.provider}:${row.borehole_id}`) || null,
            rank_most_downtime: byDowntime.get(`${row.provider}:${row.borehole_id}`) || null,
            rank_most_unreliable_data: byUnreliable.get(`${row.provider}:${row.borehole_id}`) || null
        })).sort((a, b) => (a.rank_highest_volume || 9999) - (b.rank_highest_volume || 9999));

        const readinessCounts = {};
        const typologyCounts = {};
        comparisonTable.forEach((row) => {
            readinessCounts[row.analysis_readiness_tier] = (readinessCounts[row.analysis_readiness_tier] || 0) + 1;
            typologyCounts[row.typology_group] = (typologyCounts[row.typology_group] || 0) + 1;
        });

        return {
            network_summary: {
                site_count: comparisonTable.length,
                active_site_count: comparisonTable.filter((row) => (row.active_day_share || 0) > 0).length,
                telemetry_ready_site_count: comparisonTable.filter((row) => ["A", "B"].includes(row.analysis_readiness_tier)).length,
                stressed_site_count: comparisonTable.filter((row) => row.stress_flag).length,
                stable_tail_capable_site_count: comparisonTable.filter((row) => (row.stable_tail_event_share || 0) > 0).length,
                short_burst_dominant_site_count: comparisonTable.filter((row) => (row.short_burst_event_share || 0) >= 0.6).length,
                qs_method_used: comparisonTable[0]?.qs_method_used || options.qsMethod || "event_median_proxy",
                total_observed_volume_m3: round(comparisonTable.reduce((sum, row) => sum + (Number(row.total_volume_m3) || 0), 0)),
                readiness_counts: readinessCounts,
                typology_counts: typologyCounts
            },
            network_comparison_table: comparisonTable,
            typology_summary_table: Object.entries(typologyCounts)
                .map(([typology_group, site_count]) => ({ typology_group, site_count }))
                .sort((a, b) => b.site_count - a.site_count)
        };
    }

    return {
        computeNetworkAnalytics
    };
});