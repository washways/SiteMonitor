(function (global, factory) {
    const api = factory();
    if (typeof module !== "undefined" && module.exports) {
        module.exports = api;
    }
    global.SiteMonitorExperimental = global.SiteMonitorExperimental || {};
    global.SiteMonitorExperimental.InterpretationOutputs = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
    const CATEGORY_DEFINITIONS = [
        {
            status_category: "healthy_and_stable",
            status_label: "healthy and stable",
            meaning: "Recent telemetry looks stable, with no major stress or reliability warnings in the selected window.",
            suggested_action: "Keep routine monitoring and no immediate intervention."
        },
        {
            status_category: "high_use_but_stable",
            status_label: "high-use but stable",
            meaning: "The borehole is carrying a relatively heavy operational load, but the current indicators do not show a clear stress pattern.",
            suggested_action: "Maintain normal service, but watch loading and review again regularly."
        },
        {
            status_category: "stressed",
            status_label: "stressed",
            meaning: "The recent pattern shows elevated drawdown, weak specific capacity, or repeated stress flags that merit operational review.",
            suggested_action: "Review pumping conditions during the next planned operational check and confirm the pattern."
        },
        {
            status_category: "declining_performance",
            status_label: "declining performance",
            meaning: "The borehole still appears functional, but the recent performance trend looks worse than its recent baseline.",
            suggested_action: "Schedule a planned review and compare against earlier operating periods before escalating."
        },
        {
            status_category: "unreliable_or_possible_fault",
            status_label: "unreliable or possible fault",
            meaning: "The telemetry contains enough downtime or reliability signals that the borehole or instrumentation may need attention.",
            suggested_action: "Check communications, power, sensor health, and field condition soon."
        },
        {
            status_category: "insufficient_data",
            status_label: "insufficient data",
            meaning: "There is not enough recent, trustworthy activity to make a confident health interpretation.",
            suggested_action: "Do not over-interpret this site yet; improve telemetry coverage or collect more observations."
        }
    ];

    function round(value, digits = 2) {
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

    function uniqueStrings(values = []) {
        return [...new Set((values || []).filter(Boolean).map(String))];
    }

    function getCategoryDefinition(statusCategory) {
        return CATEGORY_DEFINITIONS.find((item) => item.status_category === statusCategory) || CATEGORY_DEFINITIONS[CATEGORY_DEFINITIONS.length - 1];
    }

    function hasStrongBaseline(row = {}) {
        const telemetryDays = Number(row.telemetry_days_observed) || 0;
        const reviewWindowDays = Number(row.review_window_days) || telemetryDays;
        const validEvents = Number(row.valid_specific_capacity_event_count) || 0;
        return reviewWindowDays >= 60 || (telemetryDays >= 45 && validEvents >= 8);
    }

    function isEarlyLifeContext(row = {}) {
        return !hasStrongBaseline(row);
    }

    function determineStatusCategory(row, cohort = {}) {
        const readiness = String(row.analysis_readiness_tier || "D");
        const activeShare = Number(row.active_day_share) || 0;
        const totalVolume = Number(row.total_volume_m3) || 0;
        const eventFrequency = Number(row.event_frequency_per_week) || 0;
        const unreliableIndex = Number(row.data_unreliability_index) || 0;
        const downtimeShare = Number(row.downtime_proxy_share) || 0;
        const maxDrawdown = Number(row.max_drawdown_observed_m) || 0;
        const medianQs = Number(row.median_valid_specific_capacity_m3h_per_m);
        const earlyLife = isEarlyLifeContext(row);
        const moderateLowQs = Number.isFinite(medianQs) && medianQs > 0 && medianQs <= cohort.lowQsThreshold;
        const severeLowQs = Number.isFinite(medianQs) && medianQs > 0 && medianQs <= Math.min(0.25, cohort.lowQsThreshold);
        const stressSignals = row.stress_flag || maxDrawdown >= cohort.drawdownReviewThreshold || moderateLowQs;
        const severeStressSignals = maxDrawdown >= cohort.severeDrawdownThreshold || severeLowQs || (downtimeShare >= 0.5 && activeShare >= 0.25);
        const severeReliabilityConcern = downtimeShare >= 0.85 || (unreliableIndex >= cohort.unreliabilityThreshold && activeShare <= 0.2);

        if (readiness === "D" || (activeShare <= 0.02 && totalVolume <= 0 && !row.stress_flag)) {
            return "insufficient_data";
        }

        if (severeReliabilityConcern) {
            return "unreliable_or_possible_fault";
        }

        if (row.performance_decline_flag && hasStrongBaseline(row) && (severeStressSignals || stressSignals || activeShare >= 0.4)) {
            return "declining_performance";
        }

        if (stressSignals) {
            if (earlyLife && !severeStressSignals && downtimeShare < 0.4 && activeShare >= 0.5) {
                return "high_use_but_stable";
            }
            return "stressed";
        }

        if (activeShare >= 0.6 || totalVolume >= cohort.highUseVolumeThreshold || eventFrequency >= 3) {
            return "high_use_but_stable";
        }

        return "healthy_and_stable";
    }

    function determineReasons(row, statusCategory, cohort = {}) {
        const reasons = [];
        const activeShare = Number(row.active_day_share) || 0;
        const totalVolume = Number(row.total_volume_m3) || 0;
        const unreliableIndex = Number(row.data_unreliability_index) || 0;
        const downtimeShare = Number(row.downtime_proxy_share) || 0;
        const maxDrawdown = Number(row.max_drawdown_observed_m) || 0;
        const medianQs = Number(row.median_valid_specific_capacity_m3h_per_m);

        if (activeShare >= 0.6 || totalVolume >= cohort.highUseVolumeThreshold) reasons.push("high_use_observed");
        if (row.performance_decline_flag && hasStrongBaseline(row)) reasons.push("recent_performance_decline");
        if (row.stress_flag) reasons.push(...(row.stress_reasons || []));
        if (maxDrawdown >= cohort.drawdownReviewThreshold) reasons.push("elevated_drawdown");
        if (Number.isFinite(medianQs) && medianQs > 0 && medianQs <= cohort.lowQsThreshold) reasons.push("low_specific_capacity");
        if (downtimeShare >= 0.3) reasons.push("repeated_non_pumping_days");
        if (unreliableIndex >= cohort.unreliabilityThreshold) reasons.push("data_or_sensor_limits");
        if (isEarlyLifeContext(row)) reasons.push("short_baseline_newer_installation_context");
        if (statusCategory === "insufficient_data") reasons.push("limited_recent_support");
        if (row.approximate) reasons.push("screening_level_source");

        return uniqueStrings(reasons);
    }

    function computePriorityScore(row, statusCategory, cohort = {}) {
        let score = 0;
        const activeShare = Number(row.active_day_share) || 0;
        const totalVolume = Number(row.total_volume_m3) || 0;
        const unreliableIndex = Number(row.data_unreliability_index) || 0;
        const downtimeShare = Number(row.downtime_proxy_share) || 0;
        const maxDrawdown = Number(row.max_drawdown_observed_m) || 0;
        const medianQs = Number(row.median_valid_specific_capacity_m3h_per_m);
        const earlyLife = isEarlyLifeContext(row);

        if (statusCategory === "healthy_and_stable") score += 10;
        if (statusCategory === "high_use_but_stable") score += 25;
        if (statusCategory === "stressed") score += 45;
        if (statusCategory === "declining_performance") score += 55;
        if (statusCategory === "unreliable_or_possible_fault") score += 70;
        if (statusCategory === "insufficient_data") score += 15;

        score += Math.min(8, activeShare * 10);
        score += Math.min(10, downtimeShare * 15);
        score += Math.min(12, unreliableIndex * 18);
        if (totalVolume >= cohort.highUseVolumeThreshold) score += 4;
        if (maxDrawdown >= cohort.drawdownReviewThreshold) score += 8;
        if (maxDrawdown >= cohort.severeDrawdownThreshold) score += 8;
        if (Number.isFinite(medianQs) && medianQs > 0 && medianQs <= cohort.lowQsThreshold) score += 8;
        if (Number.isFinite(medianQs) && medianQs > 0 && medianQs <= Math.min(0.25, cohort.lowQsThreshold)) score += 8;
        if (row.performance_decline_flag && !earlyLife) score += 6;
        if (earlyLife && statusCategory !== "unreliable_or_possible_fault") score -= 10;
        if (earlyLife && statusCategory === "stressed" && !(maxDrawdown >= cohort.severeDrawdownThreshold || (Number.isFinite(medianQs) && medianQs > 0 && medianQs <= Math.min(0.25, cohort.lowQsThreshold)))) {
            score = Math.min(score, 60);
        }

        return Math.max(0, Math.min(100, Math.round(score)));
    }

    function priorityLabel(score) {
        if (score >= 85) return "urgent investigation";
        if (score >= 60) return "planned review";
        if (score >= 35) return "watch list";
        return "routine monitoring";
    }

    function buildInterpretationText(row, statusCategory) {
        const label = getCategoryDefinition(statusCategory).status_label;
        const drawdown = Number(row.max_drawdown_observed_m) || 0;
        const qs = Number(row.median_valid_specific_capacity_m3h_per_m);
        const volume = Number(row.total_volume_m3) || 0;
        const earlyLife = isEarlyLifeContext(row);

        if (statusCategory === "healthy_and_stable") {
            return `Recent telemetry suggests this borehole is ${label}, with no strong warning signals in the current review window.`;
        }
        if (statusCategory === "high_use_but_stable") {
            return earlyLife
                ? `This borehole is active and carrying load (${round(volume, 1)} m³ observed), but the installation baseline is still short so it should be watched rather than escalated.`
                : `This borehole is carrying a relatively high operational load (${round(volume, 1)} m³ observed) but is not currently showing the main stress triggers.`;
        }
        if (statusCategory === "stressed") {
            return earlyLife
                ? `Some early-life telemetry signals merit review, but this is not yet strong evidence of a confirmed long-term decline.`
                : `This borehole shows a stressed pattern, with recent drawdown reaching about ${round(drawdown, 2)} m${Number.isFinite(qs) ? ` and median Q/S near ${round(qs, 3)}` : ""}.`;
        }
        if (statusCategory === "declining_performance") {
            return `The recent pattern suggests declining performance relative to the borehole's own recent baseline and should be investigated.`;
        }
        if (statusCategory === "unreliable_or_possible_fault") {
            return `The recent telemetry pattern looks unreliable enough to suggest a possible borehole, power, sensor, or communications issue.`;
        }
        return "There is not enough recent trustworthy evidence to make a confident health judgement for this borehole.";
    }

    function computeInterpretationOutputs(boreholeRows = [], network = {}, options = {}) {
        const rows = Array.isArray(boreholeRows) ? boreholeRows.map((row) => ({ ...row })) : [];
        const highUseVolumeThreshold = Number.isFinite(Number(options.highUseVolumeThreshold))
            ? Number(options.highUseVolumeThreshold)
            : Math.max(150, percentile(rows.map((row) => row.total_volume_m3), 0.75) || 150);
        const drawdownReviewThreshold = Number.isFinite(Number(options.drawdownReviewThreshold))
            ? Number(options.drawdownReviewThreshold)
            : Math.max(2.5, percentile(rows.map((row) => row.max_drawdown_observed_m), 0.8) || 2.5);
        const unreliabilityThreshold = Number.isFinite(Number(options.unreliabilityThreshold))
            ? Number(options.unreliabilityThreshold)
            : Math.max(0.8, percentile(rows.map((row) => row.data_unreliability_index), 0.9) || 0.8);
        const lowQsThreshold = Number.isFinite(Number(options.lowQsThreshold))
            ? Number(options.lowQsThreshold)
            : Math.max(0.25, Math.min(0.5, percentile(rows.map((row) => row.median_valid_specific_capacity_m3h_per_m), 0.25) || 0.4));
        const severeDrawdownThreshold = Math.max(4, drawdownReviewThreshold * 1.75);
        const cohort = { highUseVolumeThreshold, drawdownReviewThreshold, unreliabilityThreshold, lowQsThreshold, severeDrawdownThreshold };

        const healthSummaryTable = rows.map((row) => {
            const statusCategory = determineStatusCategory(row, cohort);
            const definition = getCategoryDefinition(statusCategory);
            const transparentReasons = determineReasons(row, statusCategory, cohort);
            const maintenancePriorityScore = computePriorityScore(row, statusCategory, cohort);
            return {
                ...row,
                status_category: statusCategory,
                status_label: definition.status_label,
                category_meaning: definition.meaning,
                recommended_action: definition.suggested_action,
                transparent_reasons: transparentReasons,
                concise_interpretation: buildInterpretationText(row, statusCategory),
                maintenance_priority_score: maintenancePriorityScore,
                maintenance_priority_label: priorityLabel(maintenancePriorityScore)
            };
        });

        const priorityRankingTable = [...healthSummaryTable]
            .sort((a, b) => {
                const scoreDiff = (b.maintenance_priority_score || 0) - (a.maintenance_priority_score || 0);
                if (scoreDiff !== 0) return scoreDiff;
                return (b.total_volume_m3 || 0) - (a.total_volume_m3 || 0);
            })
            .map((row, index) => ({
                priority_rank: index + 1,
                ...row
            }));

        const categoryCounts = {};
        healthSummaryTable.forEach((row) => {
            categoryCounts[row.status_category] = (categoryCounts[row.status_category] || 0) + 1;
        });

        return {
            health_summary_table: healthSummaryTable,
            priority_ranking_table: priorityRankingTable,
            category_summary_table: CATEGORY_DEFINITIONS.map((definition) => ({
                status_category: definition.status_category,
                status_label: definition.status_label,
                site_count: categoryCounts[definition.status_category] || 0,
                meaning: definition.meaning,
                suggested_action: definition.suggested_action
            })).sort((a, b) => b.site_count - a.site_count),
            category_definitions: CATEGORY_DEFINITIONS,
            interpretation_note: "Rule-based interpretation only. These categories are operational review aids and are not machine-learning outputs or final diagnoses.",
            cohort_thresholds: cohort,
            network_reference: network?.network_summary || null
        };
    }

    return {
        CATEGORY_DEFINITIONS,
        computeInterpretationOutputs
    };
});
