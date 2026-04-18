(function () {
    const Exp = window.SiteMonitorExperimental || {};
    const results = [];

    function assert(condition, message) {
        if (!condition) {
            throw new Error(message);
        }
    }

    function iso(baseMs, hours) {
        return new Date(baseMs + (hours * 60 * 60 * 1000)).toISOString();
    }

    function makeBundle({ boreholeId, flowPoints = [], levelPoints = [], approximate = false }) {
        const source = Exp.TelemetrySchema.createSourceDescriptor({
            source_id: `TEST:${boreholeId}`,
            api_id: "TEST",
            provider: approximate ? "SonSetLink" : "DCP",
            site_id: boreholeId,
            borehole_id: boreholeId,
            display_name: boreholeId,
            country: "Test"
        });
        return Exp.NormalizeBundle.buildNormalizedBundle({
            source,
            points: [...flowPoints, ...levelPoints],
            quality_summary: {
                is_approximate: approximate,
                notes: approximate ? ["synthetic approximate source"] : []
            }
        });
    }

    function runTest(name, fn) {
        try {
            fn();
            results.push({ name, status: "PASS" });
        } catch (error) {
            results.push({ name, status: "FAIL", message: error.message });
        }
    }

    function runSuite() {
        const baseMs = Date.parse("2026-01-01T00:00:00Z");

        runTest("duplicate timestamps and noisy spike handling", () => {
            const flow = [
                Exp.TelemetrySchema.createTelemetryPoint({ borehole_id: "BH-1", source_id: "TEST:BH-1", provider: "DCP", parameter: "flow", timestamp_utc: iso(baseMs, 0), value: 1, sample_span_hours: 1, unit: "m3/h" }),
                Exp.TelemetrySchema.createTelemetryPoint({ borehole_id: "BH-1", source_id: "TEST:BH-1", provider: "DCP", parameter: "flow", timestamp_utc: iso(baseMs, 1), value: 1.1, sample_span_hours: 1, unit: "m3/h" }),
                Exp.TelemetrySchema.createTelemetryPoint({ borehole_id: "BH-1", source_id: "TEST:BH-1", provider: "DCP", parameter: "flow", timestamp_utc: iso(baseMs, 1), value: 1.2, sample_span_hours: 1, unit: "m3/h" }),
                Exp.TelemetrySchema.createTelemetryPoint({ borehole_id: "BH-1", source_id: "TEST:BH-1", provider: "DCP", parameter: "flow", timestamp_utc: iso(baseMs, 2), value: 15, sample_span_hours: 1, unit: "m3/h" }),
                Exp.TelemetrySchema.createTelemetryPoint({ borehole_id: "BH-1", source_id: "TEST:BH-1", provider: "DCP", parameter: "flow", timestamp_utc: iso(baseMs, 3), value: 1.1, sample_span_hours: 1, unit: "m3/h" })
            ];
            const levels = [
                Exp.TelemetrySchema.createTelemetryPoint({ borehole_id: "BH-1", source_id: "TEST:BH-1", provider: "DCP", parameter: "water_level_above_pump", timestamp_utc: iso(baseMs, 0), value: 10, sample_span_hours: 1, unit: "m" })
            ];
            const bundle = makeBundle({ boreholeId: "BH-1", flowPoints: flow, levelPoints: levels });
            const cleaned = Exp.CleanBoreholeSeries.cleanBoreholeSeries(bundle, {});
            assert(cleaned.qc_summary.has_duplicates, "Expected duplicate timestamps to be flagged.");
            assert(cleaned.qc_summary.has_noise, "Expected noisy readings to be adjusted.");
        });

        runTest("grace period bridges a short pause", () => {
            const flow = [
                Exp.TelemetrySchema.createTelemetryPoint({ borehole_id: "BH-2", source_id: "TEST:BH-2", provider: "DCP", parameter: "flow", timestamp_utc: iso(baseMs, 0), value: 3, sample_span_hours: 1, unit: "m3/h" }),
                Exp.TelemetrySchema.createTelemetryPoint({ borehole_id: "BH-2", source_id: "TEST:BH-2", provider: "DCP", parameter: "flow", timestamp_utc: iso(baseMs, 1), value: 3, sample_span_hours: 1, unit: "m3/h" }),
                Exp.TelemetrySchema.createTelemetryPoint({ borehole_id: "BH-2", source_id: "TEST:BH-2", provider: "DCP", parameter: "flow", timestamp_utc: iso(baseMs, 2), value: 0, sample_span_hours: 1, unit: "m3/h" }),
                Exp.TelemetrySchema.createTelemetryPoint({ borehole_id: "BH-2", source_id: "TEST:BH-2", provider: "DCP", parameter: "flow", timestamp_utc: iso(baseMs, 2.5), value: 2.8, sample_span_hours: 1, unit: "m3/h" })
            ];
            const levels = [
                Exp.TelemetrySchema.createTelemetryPoint({ borehole_id: "BH-2", source_id: "TEST:BH-2", provider: "DCP", parameter: "water_level_above_pump", timestamp_utc: iso(baseMs, 0), value: 10, unit: "m" }),
                Exp.TelemetrySchema.createTelemetryPoint({ borehole_id: "BH-2", source_id: "TEST:BH-2", provider: "DCP", parameter: "water_level_above_pump", timestamp_utc: iso(baseMs, 2.5), value: 9, unit: "m" })
            ];
            const bundle = makeBundle({ boreholeId: "BH-2", flowPoints: flow, levelPoints: levels });
            const cleaned = Exp.CleanBoreholeSeries.cleanBoreholeSeries(bundle, {});
            const detected = Exp.DetectPumpingEventsExperimental.detectPumpingEvents(cleaned, { flowThreshold: 0.1, graceHours: 2 });
            assert(detected.completed_events.length === 1, `Expected 1 event, got ${detected.completed_events.length}.`);
        });

        runTest("missing water levels stay flagged", () => {
            const flow = [
                Exp.TelemetrySchema.createTelemetryPoint({ borehole_id: "BH-3", source_id: "TEST:BH-3", provider: "DCP", parameter: "flow", timestamp_utc: iso(baseMs, 0), value: 4, sample_span_hours: 1, unit: "m3/h" }),
                Exp.TelemetrySchema.createTelemetryPoint({ borehole_id: "BH-3", source_id: "TEST:BH-3", provider: "DCP", parameter: "flow", timestamp_utc: iso(baseMs, 1), value: 4, sample_span_hours: 1, unit: "m3/h" })
            ];
            const bundle = makeBundle({ boreholeId: "BH-3", flowPoints: flow, levelPoints: [] });
            const cleaned = Exp.CleanBoreholeSeries.cleanBoreholeSeries(bundle, {});
            const detected = Exp.DetectPumpingEventsExperimental.detectPumpingEvents(cleaned, { flowThreshold: 0.1, graceHours: 1 });
            const rows = Exp.ComputeEventMetrics.computeEventMetrics(detected, {});
            assert(rows.length === 1, "Expected one event row.");
            assert(rows[0].quality_flags.includes("insufficient_water_level"), "Expected insufficient water level flag.");
        });

        runTest("event metrics compute drawdown and specific capacity correctly", () => {
            const flow = [
                Exp.TelemetrySchema.createTelemetryPoint({ borehole_id: "BH-4", source_id: "TEST:BH-4", provider: "DCP", parameter: "flow", timestamp_utc: iso(baseMs, 0), value: 5, sample_span_hours: 1, unit: "m3/h" }),
                Exp.TelemetrySchema.createTelemetryPoint({ borehole_id: "BH-4", source_id: "TEST:BH-4", provider: "DCP", parameter: "flow", timestamp_utc: iso(baseMs, 1), value: 5, sample_span_hours: 1, unit: "m3/h" }),
                Exp.TelemetrySchema.createTelemetryPoint({ borehole_id: "BH-4", source_id: "TEST:BH-4", provider: "DCP", parameter: "flow", timestamp_utc: iso(baseMs, 2), value: 0, sample_span_hours: 1, unit: "m3/h" })
            ];
            const levels = [
                Exp.TelemetrySchema.createTelemetryPoint({ borehole_id: "BH-4", source_id: "TEST:BH-4", provider: "DCP", parameter: "water_level_above_pump", timestamp_utc: iso(baseMs, 0), value: 10, unit: "m" }),
                Exp.TelemetrySchema.createTelemetryPoint({ borehole_id: "BH-4", source_id: "TEST:BH-4", provider: "DCP", parameter: "water_level_above_pump", timestamp_utc: iso(baseMs, 1), value: 9, unit: "m" }),
                Exp.TelemetrySchema.createTelemetryPoint({ borehole_id: "BH-4", source_id: "TEST:BH-4", provider: "DCP", parameter: "water_level_above_pump", timestamp_utc: iso(baseMs, 2), value: 8, unit: "m" })
            ];
            const bundle = makeBundle({ boreholeId: "BH-4", flowPoints: flow, levelPoints: levels });
            const cleaned = Exp.CleanBoreholeSeries.cleanBoreholeSeries(bundle, {});
            const detected = Exp.DetectPumpingEventsExperimental.detectPumpingEvents(cleaned, { flowThreshold: 0.1, graceHours: 0.5 });
            const rows = Exp.ComputeEventMetrics.computeEventMetrics(detected, { minDrawdownM: 0.05 });
            assert(rows.length === 1, "Expected one event row.");
            assert(rows[0].drawdown_m === 1, `Expected drawdown 1, got ${rows[0].drawdown_m}.`);
            assert(rows[0].maximum_drawdown_m === 2, `Expected maximum drawdown 2, got ${rows[0].maximum_drawdown_m}.`);
            assert(rows[0].specific_capacity_m3h_per_m === 5, `Expected specific capacity 5, got ${rows[0].specific_capacity_m3h_per_m}.`);
        });

        runTest("negative flow is clamped and flagged during cleaning", () => {
            const flow = [
                Exp.TelemetrySchema.createTelemetryPoint({ borehole_id: "BH-5", source_id: "TEST:BH-5", provider: "DCP", parameter: "flow", timestamp_utc: iso(baseMs, 0), value: -2, sample_span_hours: 1, unit: "m3/h" }),
                Exp.TelemetrySchema.createTelemetryPoint({ borehole_id: "BH-5", source_id: "TEST:BH-5", provider: "DCP", parameter: "flow", timestamp_utc: iso(baseMs, 1), value: 2, sample_span_hours: 1, unit: "m3/h" })
            ];
            const bundle = makeBundle({ boreholeId: "BH-5", flowPoints: flow, levelPoints: [] });
            const cleaned = Exp.CleanBoreholeSeries.cleanBoreholeSeries(bundle, {});
            assert(cleaned.qc_summary.negative_flow_clamped_count === 1, "Expected one negative flow reading to be clamped.");
        });

        runTest("long gaps split events and remain flagged", () => {
            const flow = [
                Exp.TelemetrySchema.createTelemetryPoint({ borehole_id: "BH-6", source_id: "TEST:BH-6", provider: "DCP", parameter: "flow", timestamp_utc: iso(baseMs, 0), value: 2, sample_span_hours: 1, unit: "m3/h" }),
                Exp.TelemetrySchema.createTelemetryPoint({ borehole_id: "BH-6", source_id: "TEST:BH-6", provider: "DCP", parameter: "flow", timestamp_utc: iso(baseMs, 1), value: 2, sample_span_hours: 1, unit: "m3/h" }),
                Exp.TelemetrySchema.createTelemetryPoint({ borehole_id: "BH-6", source_id: "TEST:BH-6", provider: "DCP", parameter: "flow", timestamp_utc: iso(baseMs, 8), value: 2, sample_span_hours: 1, unit: "m3/h" }),
                Exp.TelemetrySchema.createTelemetryPoint({ borehole_id: "BH-6", source_id: "TEST:BH-6", provider: "DCP", parameter: "flow", timestamp_utc: iso(baseMs, 9), value: 0, sample_span_hours: 1, unit: "m3/h" })
            ];
            const levels = [
                Exp.TelemetrySchema.createTelemetryPoint({ borehole_id: "BH-6", source_id: "TEST:BH-6", provider: "DCP", parameter: "water_level_above_pump", timestamp_utc: iso(baseMs, 0), value: 12, unit: "m" }),
                Exp.TelemetrySchema.createTelemetryPoint({ borehole_id: "BH-6", source_id: "TEST:BH-6", provider: "DCP", parameter: "water_level_above_pump", timestamp_utc: iso(baseMs, 8), value: 11, unit: "m" })
            ];
            const bundle = makeBundle({ boreholeId: "BH-6", flowPoints: flow, levelPoints: levels });
            const cleaned = Exp.CleanBoreholeSeries.cleanBoreholeSeries(bundle, {});
            const detected = Exp.DetectPumpingEventsExperimental.detectPumpingEvents(cleaned, { flowThreshold: 0.1, graceHours: 1 });
            const rows = Exp.ComputeEventMetrics.computeEventMetrics(detected, { minDrawdownM: 0.05 });
            assert(cleaned.qc_summary.has_gaps, "Expected large timestamp gaps to be flagged.");
            assert(rows.length >= 1, "Expected at least one event row after the gap split.");
        });

        runTest("daily analytics summarize real event outputs into daily metrics", () => {
            assert(!!Exp.DailyAnalytics?.computeDailyAnalytics, "Daily analytics module is not loaded.");
            const flow = [
                Exp.TelemetrySchema.createTelemetryPoint({ borehole_id: "BH-7", source_id: "TEST:BH-7", provider: "DCP", parameter: "flow", timestamp_utc: iso(baseMs, 0), value: 2, sample_span_hours: 1, unit: "m3/h" }),
                Exp.TelemetrySchema.createTelemetryPoint({ borehole_id: "BH-7", source_id: "TEST:BH-7", provider: "DCP", parameter: "flow", timestamp_utc: iso(baseMs, 1), value: 2, sample_span_hours: 1, unit: "m3/h" }),
                Exp.TelemetrySchema.createTelemetryPoint({ borehole_id: "BH-7", source_id: "TEST:BH-7", provider: "DCP", parameter: "flow", timestamp_utc: iso(baseMs, 2), value: 0, sample_span_hours: 1, unit: "m3/h" })
            ];
            const levels = [
                Exp.TelemetrySchema.createTelemetryPoint({ borehole_id: "BH-7", source_id: "TEST:BH-7", provider: "DCP", parameter: "water_level_above_pump", timestamp_utc: iso(baseMs, 0), value: 10, unit: "m" }),
                Exp.TelemetrySchema.createTelemetryPoint({ borehole_id: "BH-7", source_id: "TEST:BH-7", provider: "DCP", parameter: "water_level_above_pump", timestamp_utc: iso(baseMs, 1), value: 9, unit: "m" }),
                Exp.TelemetrySchema.createTelemetryPoint({ borehole_id: "BH-7", source_id: "TEST:BH-7", provider: "DCP", parameter: "water_level_above_pump", timestamp_utc: iso(baseMs, 2), value: 10.1, unit: "m" })
            ];
            const bundle = makeBundle({ boreholeId: "BH-7", flowPoints: flow, levelPoints: levels });
            const cleaned = Exp.CleanBoreholeSeries.cleanBoreholeSeries(bundle, {});
            const detected = Exp.DetectPumpingEventsExperimental.detectPumpingEvents(cleaned, { flowThreshold: 0.1, graceHours: 0.5 });
            const rows = Exp.ComputeEventMetrics.computeEventMetrics(detected, { minDrawdownM: 0.05 });
            const daily = Exp.DailyAnalytics.computeDailyAnalytics({ normalized: bundle, cleaned, detected, event_rows: rows }, {});
            assert(daily.length === 1, `Expected one daily row, got ${daily.length}.`);
            assert(daily[0].event_count === 1, `Expected 1 event, got ${daily[0].event_count}.`);
            assert(daily[0].daily_pumped_volume_m3 === 4, `Expected 4 m3, got ${daily[0].daily_pumped_volume_m3}.`);
        });

        runTest("rolling analytics compute trailing summaries", () => {
            assert(!!Exp.RollingAnalytics?.computeRollingAnalytics, "Rolling analytics module is not loaded.");
            const dailyRows = Array.from({ length: 8 }, (_, i) => ({
                date: new Date(baseMs + (i * 24 * 60 * 60 * 1000)).toISOString().slice(0, 10),
                provider: "DCP",
                borehole_id: "BH-8",
                daily_pumped_volume_m3: i + 1,
                estimated_resting_level_m: 10 - (i * 0.1),
                daily_quality_flags: [],
                stress_event_count: i % 2,
                recovery_weakness_count: 0,
                downtime_indicator: i === 7 ? 1 : 0
            }));
            const rolling = Exp.RollingAnalytics.computeRollingAnalytics(dailyRows, [], {});
            assert(rolling.length === 8, `Expected 8 rolling rows, got ${rolling.length}.`);
            assert(rolling[7].rolling_7d_volume_m3 === 35, `Expected trailing 7d volume 35, got ${rolling[7].rolling_7d_volume_m3}.`);
        });

        runTest("borehole and network analytics summarize and rank sites", () => {
            assert(!!Exp.BoreholeAnalytics?.computeBoreholeAnalytics, "Borehole analytics module is not loaded.");
            assert(!!Exp.NetworkAnalytics?.computeNetworkAnalytics, "Network analytics module is not loaded.");
            const boreholeA = Exp.BoreholeAnalytics.computeBoreholeAnalytics({ source: { borehole_id: "BH-A", provider: "DCP", display_name: "Well A" } }, [
                { date: "2026-01-01", daily_pumped_volume_m3: 5, total_hours_pumped: 3, event_count: 2, daily_quality_flags: [], estimated_resting_level_m: 10 },
                { date: "2026-01-02", daily_pumped_volume_m3: 0, total_hours_pumped: 0, event_count: 0, daily_quality_flags: ["downtime_proxy"], estimated_resting_level_m: 10.1 }
            ], [
                { date: "2026-01-02", rolling_30d_specific_capacity_median: 1.5, rolling_30d_stress_event_count: 0, rolling_30d_downtime_days: 1, resting_level_trend_30d_m_per_day: -0.02 }
            ], {});
            const boreholeB = { ...boreholeA, borehole_id: "BH-B", display_name: "Well B", median_daily_volume_m3: 10, stress_flag: true, analysis_readiness_tier: "A", median_valid_specific_capacity_m3h_per_m: 2.5 };
            const network = Exp.NetworkAnalytics.computeNetworkAnalytics([boreholeA, boreholeB], {});
            assert(network.network_comparison_table.length === 2, `Expected 2 ranked sites, got ${network.network_comparison_table.length}.`);
            assert(network.network_comparison_table[0].borehole_id === "BH-B", "Expected BH-B to rank first by volume.");
        });

        runTest("interpretation outputs classify boreholes and prioritize action", () => {
            assert(!!Exp.InterpretationOutputs?.computeInterpretationOutputs, "Interpretation outputs module is not loaded.");
            const rows = [
                {
                    provider: "DCP",
                    borehole_id: "BH-H",
                    display_name: "Healthy Well",
                    analysis_readiness_tier: "A",
                    typology_group: "moderate_use",
                    active_day_share: 0.5,
                    total_volume_m3: 100,
                    median_valid_specific_capacity_m3h_per_m: 1.2,
                    max_drawdown_observed_m: 0.7,
                    stress_flag: false,
                    performance_decline_flag: false,
                    downtime_proxy_share: 0.05,
                    data_unreliability_index: 0.1,
                    stress_reasons: []
                },
                {
                    provider: "DCP",
                    borehole_id: "BH-S",
                    display_name: "Stressed Well",
                    analysis_readiness_tier: "A",
                    typology_group: "stressed_review",
                    active_day_share: 0.8,
                    total_volume_m3: 220,
                    median_valid_specific_capacity_m3h_per_m: 0.2,
                    max_drawdown_observed_m: 5,
                    stress_flag: true,
                    performance_decline_flag: true,
                    downtime_proxy_share: 0.2,
                    data_unreliability_index: 0.15,
                    stress_reasons: ["high_drawdown_observed", "low_specific_capacity_summary"]
                }
            ];
            const interpreted = Exp.InterpretationOutputs.computeInterpretationOutputs(rows, {});
            assert(interpreted.health_summary_table.length === 2, `Expected 2 health rows, got ${interpreted.health_summary_table.length}.`);
            assert(interpreted.health_summary_table.some((row) => row.status_category === "healthy_and_stable"), "Expected a healthy_and_stable category.");
            assert(interpreted.priority_ranking_table[0].borehole_id === "BH-S", "Expected stressed well to rank first for attention.");
        });

        const passed = results.filter((result) => result.status === "PASS").length;
        window.SyntheticTestResults = { total: results.length, passed, failed: results.length - passed, results };
        const target = document.getElementById("testOutput");
        if (target) {
            const summary = document.createElement("div");
            summary.innerHTML = `<strong>${passed}/${results.length} tests passed</strong>`;
            target.appendChild(summary);
            const list = document.createElement("ul");
            results.forEach((result) => {
                const item = document.createElement("li");
                item.textContent = result.status === "PASS"
                    ? `PASS: ${result.name}`
                    : `FAIL: ${result.name} — ${result.message}`;
                item.style.color = result.status === "PASS" ? "#166534" : "#b91c1c";
                list.appendChild(item);
            });
            target.appendChild(list);
        }
    }

    window.addEventListener("DOMContentLoaded", runSuite);
})();