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

    function mean(values = []) {
        const valid = values.filter((value) => Number.isFinite(Number(value))).map(Number);
        if (!valid.length) return null;
        return valid.reduce((sum, value) => sum + value, 0) / valid.length;
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
        const avg = mean(valid);
        if (!Number.isFinite(avg) || avg === 0) return null;
        const variance = valid.reduce((sum, value) => sum + ((value - avg) ** 2), 0) / valid.length;
        return Math.sqrt(variance) / avg;
    }

    function computeSpecificCapacity(flow, drawdown, minDrawdownM) {
        return (Number.isFinite(flow) && flow > 0 && Number.isFinite(drawdown) && drawdown >= minDrawdownM)
            ? (flow / drawdown)
            : null;
    }

    function determineTailWindow(flowPoints = [], options = {}) {
        if (!flowPoints.length) return [];
        const minTailPoints = Number.isFinite(Number(options.minStableTailPoints)) ? Number(options.minStableTailPoints) : 3;
        const tailFraction = Number.isFinite(Number(options.stableTailFraction)) ? Number(options.stableTailFraction) : 0.3;
        const tailCount = Math.min(flowPoints.length, Math.max(minTailPoints, Math.ceil(flowPoints.length * tailFraction)));
        return flowPoints.slice(-tailCount);
    }

    function determineEventProfile(metrics = {}, options = {}) {
        const shortBurstHours = Number.isFinite(Number(options.shortBurstHours)) ? Number(options.shortBurstHours) : 0.75;
        const durationHours = Number(metrics.durationHours) || 0;
        const positiveCount = Number(metrics.positiveCount) || 0;
        const tailFlowCv = Number(metrics.tailFlowCv);
        const maxFlow = Number(metrics.maxFlow);
        const lastFlow = Number(metrics.lastFlow);

        if (positiveCount <= 2 || durationHours < shortBurstHours) {
            return "short_burst";
        }
        if (metrics.stableTailSupported && Number.isFinite(tailFlowCv) && tailFlowCv <= (options.stableTailCvThreshold || 0.2) && durationHours >= 1) {
            return "stable_sustained";
        }
        if (Number.isFinite(maxFlow) && maxFlow > 0 && Number.isFinite(lastFlow) && lastFlow < (maxFlow * 0.75)) {
            return "tapering_or_drawdown_limited";
        }
        return "variable_sustained";
    }

    function computeRunDryRisk(metrics = {}, options = {}) {
        const severeDrawdownM = Number.isFinite(Number(options.severeDrawdownM)) ? Number(options.severeDrawdownM) : 2.5;
        const collapseRatioThreshold = Number.isFinite(Number(options.runDryCollapseRatioThreshold)) ? Number(options.runDryCollapseRatioThreshold) : 0.55;
        let score = 0;

        if (metrics.eventProfile === "tapering_or_drawdown_limited") score += 35;
        if (Number.isFinite(metrics.flowCollapseRatio) && metrics.flowCollapseRatio <= collapseRatioThreshold) score += 25;
        if (Number.isFinite(metrics.maximumDrawdown) && metrics.maximumDrawdown >= severeDrawdownM) score += 20;
        if (!metrics.stableTailSupported && Number.isFinite(metrics.tailFlowCv) && metrics.tailFlowCv > (options.stableTailCvThreshold || 0.2)) score += 10;
        if (Number.isFinite(metrics.drawdown) && Number.isFinite(metrics.maximumDrawdown) && metrics.maximumDrawdown > Math.max(metrics.drawdown * 1.15, metrics.drawdown + 0.2)) score += 10;

        return Math.max(0, Math.min(100, Math.round(score)));
    }

    function buildQualityFlags(eventState, metrics, options) {
        const flags = new Set(eventState.flags || []);
        const minDrawdownM = Number.isFinite(Number(options.minDrawdownM)) ? Number(options.minDrawdownM) : 0.05;
        const minStableTailPoints = Number.isFinite(Number(options.minStableTailPoints)) ? Number(options.minStableTailPoints) : 3;
        const stableTailCvThreshold = Number.isFinite(Number(options.stableTailCvThreshold)) ? Number(options.stableTailCvThreshold) : 0.2;

        if (!eventState.start_level_point || !eventState.last_positive_level_point) {
            flags.add("insufficient_water_level");
        }
        if (!Number.isFinite(metrics.drawdown) || metrics.drawdown < minDrawdownM) {
            flags.add("invalid_specific_capacity");
        }
        if ((metrics.stableTailSupportCount || 0) < minStableTailPoints) {
            flags.add("limited_stable_tail_support");
        }
        if (Number.isFinite(metrics.tailFlowCv) && metrics.tailFlowCv > stableTailCvThreshold) {
            flags.add("unstable_tail_flow");
        }
        if (metrics.eventProfile === "short_burst") {
            flags.add("short_burst_event");
        }
        if (metrics.eventProfile === "tapering_or_drawdown_limited") {
            flags.add("tapering_flow_pattern");
        }
        if (metrics.possibleIntakeLimitationFlag) {
            flags.add("possible_intake_limitation");
        }
        if (metrics.possibleRunDryFlag) {
            flags.add("possible_run_dry_event");
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

    function resolvePreferredMethod(candidates = {}) {
        if (Number.isFinite(Number(candidates.stable_tail_proxy))) return "stable_tail_proxy";
        if (Number.isFinite(Number(candidates.event_median_proxy))) return "event_median_proxy";
        if (Number.isFinite(Number(candidates.current_proxy))) return "current_proxy";
        if (Number.isFinite(Number(candidates.late_mean_proxy))) return "late_mean_proxy";
        if (Number.isFinite(Number(candidates.max_stress_proxy))) return "max_stress_proxy";
        return "current_proxy";
    }

    function getSpecificCapacityByMethod(rowOrCandidates = {}, method = "preferred") {
        const candidates = rowOrCandidates?.specific_capacity_candidates || rowOrCandidates || {};
        const preferredMethod = rowOrCandidates?.preferred_specific_capacity_method || resolvePreferredMethod(candidates);
        const selectedMethod = method === "preferred" ? preferredMethod : method;
        const value = candidates[selectedMethod];
        if (Number.isFinite(Number(value))) return round(Number(value), 3);
        const fallbackValue = candidates[preferredMethod];
        return Number.isFinite(Number(fallbackValue)) ? round(Number(fallbackValue), 3) : null;
    }

    function computeEventMetrics(detectionResult, options = {}) {
        const rows = [];
        const completedEvents = detectionResult?.completed_events || [];
        const minDrawdownM = Number.isFinite(Number(options.minDrawdownM)) ? Number(options.minDrawdownM) : 0.05;
        const stableTailCvThreshold = Number.isFinite(Number(options.stableTailCvThreshold)) ? Number(options.stableTailCvThreshold) : 0.2;
        const minStableTailPoints = Number.isFinite(Number(options.minStableTailPoints)) ? Number(options.minStableTailPoints) : 3;
        const requestedQsMethod = String(options.qsMethod || "preferred");

        completedEvents.forEach((eventState, index) => {
            const positiveFlowPoints = (eventState.points || []).filter((point) => Number(point.value) > (detectionResult.flow_threshold || 0.1));
            if (!positiveFlowPoints.length) return;

            const positiveFlows = positiveFlowPoints.map((point) => Number(point.value)).filter((value) => Number.isFinite(value) && value > 0);
            const tailPoints = determineTailWindow(positiveFlowPoints, options);
            const tailFlows = tailPoints.map((point) => Number(point.value)).filter((value) => Number.isFinite(value) && value > 0);
            const lastPositivePoint = positiveFlowPoints[positiveFlowPoints.length - 1];
            const startLevel = eventState.start_level_point?.value ?? null;
            const endLevel = eventState.last_positive_level_point?.value ?? null;
            const deepestLevel = eventState.deepest_level_point?.value ?? null;
            const drawdown = (Number.isFinite(startLevel) && Number.isFinite(endLevel)) ? (startLevel - endLevel) : null;
            const maximumDrawdown = (Number.isFinite(startLevel) && Number.isFinite(deepestLevel)) ? (startLevel - deepestLevel) : null;
            const totalVolume = estimateTotalVolume(positiveFlowPoints);
            const durationHours = (eventState.end_ms - eventState.start_ms) / HOUR_MS;
            const lastValidNonZeroFlow = Number(lastPositivePoint.value);
            const maxFlow = positiveFlows.length ? Math.max(...positiveFlows) : null;
            const medianPositiveFlow = median(positiveFlows);
            const meanPositiveFlow = mean(positiveFlows);
            const stableTailMedianFlow = median(tailFlows);
            const stableTailMeanFlow = mean(tailFlows);
            const tailFlowCv = coefficientOfVariation(tailFlows);
            const stableTailSupported = tailFlows.length >= minStableTailPoints && Number.isFinite(tailFlowCv) && tailFlowCv <= stableTailCvThreshold;
            const flowCollapseRatio = (Number.isFinite(maxFlow) && maxFlow > 0 && Number.isFinite(lastValidNonZeroFlow)) ? (lastValidNonZeroFlow / maxFlow) : null;
            const eventProfile = determineEventProfile({
                durationHours,
                positiveCount: positiveFlowPoints.length,
                tailFlowCv,
                maxFlow,
                lastFlow: lastValidNonZeroFlow,
                stableTailSupported
            }, options);
            const runDryRiskScore = computeRunDryRisk({
                eventProfile,
                flowCollapseRatio,
                maximumDrawdown,
                drawdown,
                stableTailSupported,
                tailFlowCv
            }, {
                severeDrawdownM: options.severeDrawdownM,
                runDryCollapseRatioThreshold: options.runDryCollapseRatioThreshold,
                stableTailCvThreshold
            });
            const possibleRunDryFlag = runDryRiskScore >= 50;
            const possibleIntakeLimitationFlag = possibleRunDryFlag || (eventProfile === "tapering_or_drawdown_limited" && Number.isFinite(maximumDrawdown) && maximumDrawdown >= 1.5);

            const specificCapacityCandidates = {
                current_proxy: computeSpecificCapacity(lastValidNonZeroFlow, drawdown, minDrawdownM),
                max_stress_proxy: computeSpecificCapacity(maxFlow, maximumDrawdown, minDrawdownM),
                event_median_proxy: computeSpecificCapacity(medianPositiveFlow, maximumDrawdown, minDrawdownM),
                stable_tail_proxy: stableTailSupported ? computeSpecificCapacity(stableTailMedianFlow, maximumDrawdown, minDrawdownM) : null,
                late_mean_proxy: tailFlows.length >= minStableTailPoints ? computeSpecificCapacity(stableTailMeanFlow, maximumDrawdown, minDrawdownM) : null
            };
            const preferredSpecificCapacityMethod = resolvePreferredMethod(specificCapacityCandidates);
            const requestedSpecificCapacityMethod = requestedQsMethod === "preferred" ? preferredSpecificCapacityMethod : requestedQsMethod;
            const selectedSpecificCapacity = getSpecificCapacityByMethod({
                specific_capacity_candidates: specificCapacityCandidates,
                preferred_specific_capacity_method: preferredSpecificCapacityMethod
            }, requestedQsMethod);
            const selectedSpecificCapacityMethod = Number.isFinite(Number(specificCapacityCandidates[requestedSpecificCapacityMethod]))
                ? requestedSpecificCapacityMethod
                : preferredSpecificCapacityMethod;
            const qualityFlags = buildQualityFlags(eventState, {
                drawdown,
                maximumDrawdown,
                stableTailSupportCount: tailFlows.length,
                tailFlowCv,
                eventProfile,
                possibleRunDryFlag,
                possibleIntakeLimitationFlag
            }, {
                minDrawdownM,
                stableTailCvThreshold,
                minStableTailPoints
            });

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
                late_event_drawdown_m: round(drawdown, 3),
                deepest_level_reached_m: round(deepestLevel, 3),
                maximum_drawdown_m: round(maximumDrawdown, 3),
                last_valid_non_zero_flow_m3h: round(lastValidNonZeroFlow, 3),
                max_flow_m3h: round(maxFlow, 3),
                mean_positive_flow_m3h: round(meanPositiveFlow, 3),
                median_positive_flow_m3h: round(medianPositiveFlow, 3),
                stable_tail_flow_median_m3h: round(stableTailMedianFlow, 3),
                stable_tail_flow_mean_m3h: round(stableTailMeanFlow, 3),
                stable_tail_support_count: tailFlows.length,
                has_stable_tail_support: stableTailSupported,
                flow_stability_cv: round(tailFlowCv, 3),
                flow_collapse_ratio: round(flowCollapseRatio, 3),
                flow_behavior_profile: eventProfile,
                run_dry_risk_score: runDryRiskScore,
                possible_run_dry_flag: possibleRunDryFlag,
                possible_intake_limitation_flag: possibleIntakeLimitationFlag,
                specific_capacity_m3h_per_m: round(specificCapacityCandidates.current_proxy, 3),
                preferred_specific_capacity_method: preferredSpecificCapacityMethod,
                preferred_specific_capacity_m3h_per_m: getSpecificCapacityByMethod({
                    specific_capacity_candidates: specificCapacityCandidates,
                    preferred_specific_capacity_method: preferredSpecificCapacityMethod
                }, "preferred"),
                selected_specific_capacity_method: selectedSpecificCapacityMethod,
                selected_specific_capacity_m3h_per_m: selectedSpecificCapacity,
                specific_capacity_candidates: Object.fromEntries(
                    Object.entries(specificCapacityCandidates).map(([key, value]) => [key, round(value, 3)])
                ),
                quality_flags: qualityFlags
            });
        });

        return rows;
    }

    return {
        computeEventMetrics,
        getSpecificCapacityByMethod,
        resolvePreferredMethod
    };
});