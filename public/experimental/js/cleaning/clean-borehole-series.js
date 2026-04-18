(function (global, factory) {
    const api = factory(global);
    if (typeof module !== "undefined" && module.exports) {
        module.exports = api;
    }
    global.SiteMonitorExperimental = global.SiteMonitorExperimental || {};
    global.SiteMonitorExperimental.CleanBoreholeSeries = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function (global) {
    const Schema = global.SiteMonitorExperimental?.TelemetrySchema;
    const QcFlags = global.SiteMonitorExperimental?.QcFlags;

    if (!Schema || !QcFlags) {
        throw new Error("TelemetrySchema and QcFlags must be loaded before CleanBoreholeSeries.");
    }

    function median(values = []) {
        if (!values.length) return null;
        const sorted = [...values].sort((a, b) => a - b);
        const mid = Math.floor(sorted.length / 2);
        return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
    }

    function typicalIntervalMs(points = []) {
        const diffs = [];
        for (let i = 1; i < points.length; i++) {
            const diff = points[i].timestamp_ms - points[i - 1].timestamp_ms;
            if (diff > 0) diffs.push(diff);
        }
        return median(diffs) || (60 * 60 * 1000);
    }

    function dedupeSeries(points, qc, parameter) {
        const sorted = [...points]
            .map((point) => Schema.createTelemetryPoint(point))
            .filter((point) => Number.isFinite(point.timestamp_ms) && point.value !== null)
            .sort((a, b) => a.timestamp_ms - b.timestamp_ms);

        const deduped = [];
        let duplicates = 0;
        for (const point of sorted) {
            const prev = deduped[deduped.length - 1];
            if (prev && prev.timestamp_ms === point.timestamp_ms) {
                duplicates += 1;
                prev.value = point.value;
                prev.quality = point.quality || prev.quality;
                prev.flags = Schema.uniqueFlags([...(prev.flags || []), ...(point.flags || []), "duplicate_timestamp_collapsed"]);
                if (Number.isFinite(point.sample_span_hours)) prev.sample_span_hours = point.sample_span_hours;
                continue;
            }
            deduped.push({ ...point });
        }

        if (duplicates > 0) {
            qc.has_duplicates = true;
            qc.duplicate_count += duplicates;
            QcFlags.addFlag(qc.flags, "duplicate_timestamps", `${duplicates} duplicate ${parameter} timestamps were collapsed.`, "warn");
        }

        return deduped;
    }

    function smoothFlowNoise(points, qc) {
        if (!points.length) return points;
        const positive = points.map((point) => Number(point.value)).filter((value) => value > 0);
        const med = median(positive);
        if (!Number.isFinite(med) || med <= 0) return points;

        const adjusted = points.map((point) => ({ ...point, flags: [...(point.flags || [])] }));
        for (let i = 1; i < adjusted.length - 1; i++) {
            const prev = adjusted[i - 1];
            const curr = adjusted[i];
            const next = adjusted[i + 1];
            if (![prev, curr, next].every((point) => Number.isFinite(point.value))) continue;
            const neighborAvg = (prev.value + next.value) / 2;
            const spike = curr.value > Math.max(med * 4, neighborAvg * 4);
            const dip = curr.value > 0 && curr.value < Math.min(med * 0.1, neighborAvg * 0.1) && prev.value > 0 && next.value > 0;
            if (spike || dip) {
                curr.value = Number(neighborAvg.toFixed(4));
                curr.flags = Schema.uniqueFlags([...(curr.flags || []), "noise_adjusted"]);
                qc.has_noise = true;
                qc.noise_adjusted_count += 1;
            }
        }

        if (qc.noise_adjusted_count > 0) {
            QcFlags.addFlag(qc.flags, "noisy_readings_adjusted", `${qc.noise_adjusted_count} isolated noisy flow readings were adjusted.`, "warn");
        }

        return adjusted;
    }

    function detectGaps(points, qc, parameter) {
        if (points.length < 2) return points;
        const interval = typicalIntervalMs(points);
        const gapThresholdMs = Math.max(interval * 1.75, 2 * 60 * 60 * 1000);
        const output = points.map((point) => ({ ...point, flags: [...(point.flags || [])] }));

        for (let i = 1; i < output.length; i++) {
            const diff = output[i].timestamp_ms - output[i - 1].timestamp_ms;
            if (diff > gapThresholdMs) {
                qc.has_gaps = true;
                qc.gap_count += 1;
                output[i].flags = Schema.uniqueFlags([...(output[i].flags || []), "timestamp_gap_after_previous"]);
            }
        }

        if (qc.gap_count > 0) {
            QcFlags.addFlag(qc.flags, "timestamp_gaps", `${qc.gap_count} timestamp gaps were detected in ${parameter}.`, "warn");
        }

        return output;
    }

    function cleanParameterSeries(parameter, points, qc) {
        let cleaned = dedupeSeries(points, qc, parameter);
        if (parameter === Schema.PARAMETERS.FLOW) {
            cleaned = smoothFlowNoise(cleaned, qc);
        }
        cleaned = detectGaps(cleaned, qc, parameter);
        return cleaned;
    }

    function cleanBoreholeSeries(bundle, options = {}) {
        const source = bundle?.source || {};
        const rawSeries = bundle?.series || {};
        const qc = {
            has_duplicates: !!bundle?.quality_summary?.has_duplicates,
            has_gaps: !!bundle?.quality_summary?.has_gaps,
            has_noise: !!bundle?.quality_summary?.has_noise,
            is_approximate: !!bundle?.quality_summary?.is_approximate,
            duplicate_count: 0,
            gap_count: 0,
            noise_adjusted_count: 0,
            flags: []
        };

        if (!rawSeries[Schema.PARAMETERS.FLOW]?.length) {
            QcFlags.addFlag(qc.flags, "missing_flow", "No normalized flow records were available.", "error");
        }
        if (!rawSeries[Schema.PARAMETERS.WATER_LEVEL]?.length) {
            QcFlags.addFlag(qc.flags, "missing_water_level", "No normalized groundwater-level records were available.", "warn");
        }
        if (qc.is_approximate) {
            QcFlags.addFlag(qc.flags, "approximate_source", "This source contains approximate or derived telemetry.", "info");
        }

        const cleanedSeries = {};
        Object.keys(rawSeries).forEach((parameter) => {
            cleanedSeries[parameter] = cleanParameterSeries(parameter, rawSeries[parameter] || [], qc);
        });

        const cleanedBundle = Schema.createBundle({
            source,
            series: cleanedSeries,
            raw_series: bundle?.raw_series || {},
            metadata: {
                ...(bundle?.metadata || {}),
                cleaning_options: { ...options }
            },
            quality_summary: {
                missing_parameters: [...(bundle?.quality_summary?.missing_parameters || [])],
                has_gaps: qc.has_gaps,
                has_duplicates: qc.has_duplicates,
                has_noise: qc.has_noise,
                is_approximate: qc.is_approximate,
                notes: qc.flags.map((flag) => flag.message)
            }
        });

        return {
            source,
            raw_bundle: bundle,
            cleaned_bundle: cleanedBundle,
            qc_summary: qc,
            flags: qc.flags
        };
    }

    return {
        cleanBoreholeSeries,
        typicalIntervalMs
    };
});