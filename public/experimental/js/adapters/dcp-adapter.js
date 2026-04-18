(function (global, factory) {
    const api = factory(global);
    if (typeof module !== "undefined" && module.exports) {
        module.exports = api;
    }
    global.SiteMonitorExperimental = global.SiteMonitorExperimental || {};
    global.SiteMonitorExperimental.DcpAdapter = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function (global) {
    const Base = global.SiteMonitorExperimental?.BaseAdapter;
    const Schema = global.SiteMonitorExperimental?.TelemetrySchema;
    const Normalize = global.SiteMonitorExperimental?.NormalizeBundle;

    if (!Base || !Schema || !Normalize) {
        throw new Error("BaseAdapter, TelemetrySchema, and NormalizeBundle must be loaded before DcpAdapter.");
    }

    class DcpTelemetryAdapter extends Base.BaseTelemetryAdapter {
        constructor() {
            super({ id: "API-001", label: "DCP Water API v2", provider: "DCP" });
        }

        canHandle(config = {}) {
            return !config.provider || String(config.provider).toLowerCase() === "dcp";
        }

        async listSources(context = {}) {
            const runtime = Base.getRuntimeContext(context);
            const { dcpToken } = Base.getStoredCredentials(context.credentials || {});
            const headers = dcpToken
                ? { "X-Api-Key": dcpToken, Accept: "application/json" }
                : { Accept: "application/json" };

            const rows = await Base.fetchJson(`${runtime.DCP_BASE}/v2/wells`, { headers });
            if (!Array.isArray(rows)) return [];

            return rows.map((row) => Schema.createSourceDescriptor({
                source_id: `DCP:${row.well_id}`,
                api_id: this.id,
                provider: this.provider,
                site_id: String(row.well_id || ""),
                borehole_id: String(row.well_id || ""),
                display_name: String(row.name || row.well_id || "Unknown DCP borehole"),
                country: "Unknown",
                lat: Number(row.location?.lat),
                lon: Number(row.location?.lon),
                granularity: "hourly",
                confidence_class: "analytical",
                metadata: {
                    last_seen: row.last_seen || null,
                    commissioned_date: row.commissioned_date || null,
                    parameter_support: ["flow", "water_level_above_pump"]
                }
            }));
        }

        async fetchTelemetry(sourceRef, window, context = {}) {
            const runtime = Base.getRuntimeContext(context);
            const { start, end } = Base.validateWindow(window);
            const { dcpToken } = Base.getStoredCredentials(context.credentials || {});
            const headers = dcpToken
                ? { "X-Api-Key": dcpToken, Accept: "application/json" }
                : { Accept: "application/json" };

            const boreholeId = String(sourceRef?.borehole_id || sourceRef?.site_id || sourceRef?.well_id || "");
            if (!boreholeId) {
                throw new Error("A DCP borehole ID is required.");
            }

            const fetchParameter = async (parameter) => {
                const url = new URL(`${runtime.DCP_BASE}/v2/wells/${boreholeId}/timeseries`);
                url.searchParams.set("parameter", parameter);
                url.searchParams.set("from", Base.formatDcpIso(start));
                url.searchParams.set("to", Base.formatDcpIso(end));
                return Base.fetchJson(url.toString(), { headers });
            };

            const [flowPayload, levelPayload] = await Promise.all([
                fetchParameter("flow"),
                fetchParameter("water_level_above_pump")
            ]);

            return {
                api_id: this.id,
                provider: this.provider,
                source: sourceRef,
                raw: {
                    flow: flowPayload,
                    water_level_above_pump: levelPayload
                }
            };
        }

        normalize(adapterResult) {
            const sourceRef = adapterResult?.source || {};
            const source = Schema.createSourceDescriptor({
                source_id: sourceRef.source_id || `DCP:${sourceRef.borehole_id || sourceRef.site_id || "unknown"}`,
                api_id: this.id,
                provider: this.provider,
                site_id: sourceRef.site_id || sourceRef.borehole_id || "",
                borehole_id: sourceRef.borehole_id || sourceRef.site_id || "",
                display_name: sourceRef.display_name || sourceRef.borehole_id || "Unknown DCP borehole",
                country: sourceRef.country || "Unknown",
                lat: sourceRef.lat,
                lon: sourceRef.lon,
                granularity: sourceRef.granularity || "hourly",
                confidence_class: sourceRef.confidence_class || "analytical",
                metadata: sourceRef.metadata || {}
            });

            const flowValues = adapterResult?.raw?.flow?.time_series?.values || [];
            const levelValues = adapterResult?.raw?.water_level_above_pump?.time_series?.values || [];
            const points = [];

            for (const row of flowValues) {
                points.push(Schema.createTelemetryPoint({
                    source_id: source.source_id,
                    borehole_id: source.borehole_id,
                    provider: this.provider,
                    parameter: Schema.PARAMETERS.FLOW,
                    timestamp_utc: row.time,
                    value: row.value,
                    unit: "m3/h",
                    sample_span_hours: 1,
                    quality: "observed",
                    raw_ref: { api: this.id, field: "flow.time_series.values" }
                }));
            }

            for (const row of levelValues) {
                points.push(Schema.createTelemetryPoint({
                    source_id: source.source_id,
                    borehole_id: source.borehole_id,
                    provider: this.provider,
                    parameter: Schema.PARAMETERS.WATER_LEVEL,
                    timestamp_utc: row.time,
                    value: row.value,
                    unit: "m",
                    sample_span_hours: 1,
                    quality: "observed",
                    raw_ref: { api: this.id, field: "water_level_above_pump.time_series.values" }
                }));
            }

            return Normalize.buildNormalizedBundle({
                source,
                points,
                raw_series: adapterResult?.raw || {},
                metadata: {
                    adapter_id: this.id,
                    approximate: false
                },
                quality_summary: {
                    is_approximate: false,
                    notes: ["Normalized from DCP hourly telemetry"]
                }
            });
        }
    }

    return {
        DcpTelemetryAdapter
    };
});