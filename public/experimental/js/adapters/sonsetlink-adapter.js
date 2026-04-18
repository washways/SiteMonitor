(function (global, factory) {
    const api = factory(global);
    if (typeof module !== "undefined" && module.exports) {
        module.exports = api;
    }
    global.SiteMonitorExperimental = global.SiteMonitorExperimental || {};
    global.SiteMonitorExperimental.SonSetLinkAdapter = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function (global) {
    const Base = global.SiteMonitorExperimental?.BaseAdapter;
    const Schema = global.SiteMonitorExperimental?.TelemetrySchema;
    const Normalize = global.SiteMonitorExperimental?.NormalizeBundle;

    if (!Base || !Schema || !Normalize) {
        throw new Error("BaseAdapter, TelemetrySchema, and NormalizeBundle must be loaded before SonSetLinkAdapter.");
    }

    function parseSslTimestamp(rawValue) {
        if (!rawValue) return null;
        const ts = Date.parse(String(rawValue).trim().replace(" ", "T") + "Z");
        return Number.isFinite(ts) ? ts : null;
    }

    function parseNumericArray(rawValue) {
        if (!rawValue || String(rawValue).toUpperCase() === "NULL") return [];
        try {
            const arr = JSON.parse(rawValue);
            return Array.isArray(arr) ? arr.map((v) => Number(v)).filter((v) => Number.isFinite(v) && v < 255) : [];
        } catch {
            return [];
        }
    }

    function flowToM3(value, unit) {
        const n = Number(value);
        if (!Number.isFinite(n)) return null;
        const normalizedUnit = String(unit || "").toLowerCase();
        if (normalizedUnit === "l" || normalizedUnit === "liters" || normalizedUnit === "litres") {
            return n / 1000;
        }
        return n;
    }

    class SonSetLinkTelemetryAdapter extends Base.BaseTelemetryAdapter {
        constructor() {
            super({ id: "API-002", label: "SonSetLink Technical API", provider: "SonSetLink" });
        }

        canHandle(config = {}) {
            return !config.provider || String(config.provider).toLowerCase() === "sonsetlink";
        }

        async listSources(context = {}) {
            const runtime = Base.getRuntimeContext(context);
            const { sslUser, sslPass } = Base.getStoredCredentials(context.credentials || {});
            const url = new URL(`${runtime.SSL_BASE}/sites.json.php`);
            if (sslUser) url.searchParams.set("login", sslUser);
            if (sslPass) url.searchParams.set("password", sslPass);

            const rows = await Base.fetchJson(url.toString());
            if (!Array.isArray(rows)) return [];

            return rows.map((row) => Schema.createSourceDescriptor({
                source_id: `SSL:${row.serial || row.site}`,
                api_id: this.id,
                provider: this.provider,
                site_id: String(row.site || ""),
                borehole_id: String(row.serial || row.site || ""),
                display_name: String(row.name || row.serial || row.site || "Unknown SonSetLink site"),
                country: String(row.location || "Unknown"),
                lat: Number(row.latitude),
                lon: Number(row.longitude),
                granularity: "daily-screening",
                confidence_class: "screening",
                metadata: {
                    serial: String(row.serial || ""),
                    most_recent_tx: row.most_recent_tx || null,
                    flow_unit: row.flow_unit || null,
                    parameter_support: ["flow", "water_level_above_pump (approximate)"]
                }
            }));
        }

        async fetchTelemetry(sourceRef, window, context = {}) {
            const runtime = Base.getRuntimeContext(context);
            const { start, end } = Base.validateWindow(window);
            const { sslUser, sslPass } = Base.getStoredCredentials(context.credentials || {});
            const siteId = String(sourceRef?.site_id || sourceRef?.site || "");
            const serial = String(sourceRef?.metadata?.serial || sourceRef?.serial || sourceRef?.borehole_id || "");
            if (!siteId || !serial) {
                throw new Error("SonSetLink requires both site ID and serial.");
            }

            const endpoints = [
                "usage.json.php",
                "status.json.php",
                "diag.json.php",
                "test.json.php",
                "usage1_msg.json.php",
                "usage8_msg.json.php",
                "usage12_msg.json.php"
            ];

            const mergedRows = [];
            const seen = new Set();
            let successfulEndpoint = null;
            const deepScan = !!context.deepScan;

            for (const endpoint of endpoints) {
                const url = new URL(`${runtime.SSL_BASE}/${endpoint}`);
                if (sslUser) url.searchParams.set("login", sslUser);
                if (sslPass) url.searchParams.set("password", sslPass);
                url.searchParams.set("site", siteId);
                url.searchParams.set("serial", serial);
                url.searchParams.set("start_date", Base.formatSslDateTime(start));
                url.searchParams.set("end_date", Base.formatSslDateTime(end));
                url.searchParams.set("feature[]", "backfill");
                url.searchParams.set("feature[]", "decumulation");

                try {
                    const rows = await Base.fetchJson(url.toString());
                    if (!Array.isArray(rows) || !rows.length) continue;

                    successfulEndpoint = successfulEndpoint || endpoint;
                    if (!deepScan) {
                        return {
                            api_id: this.id,
                            provider: this.provider,
                            source: sourceRef,
                            endpoint_used: endpoint,
                            raw: { rows }
                        };
                    }

                    for (const row of rows) {
                        const key = `${row.adjusted_timestamp || row.timestamp || ""}|${row.deflow || ""}|${row.flow1 || ""}|${endpoint}`;
                        if (seen.has(key)) continue;
                        seen.add(key);
                        mergedRows.push({ ...row, _endpoint: endpoint });
                    }
                } catch {
                    // Endpoint variability is expected across devices.
                }
            }

            return {
                api_id: this.id,
                provider: this.provider,
                source: sourceRef,
                endpoint_used: successfulEndpoint,
                raw: { rows: mergedRows }
            };
        }

        normalize(adapterResult) {
            const sourceRef = adapterResult?.source || {};
            const serial = sourceRef?.metadata?.serial || sourceRef.serial || sourceRef.borehole_id || sourceRef.site_id || "";
            const source = Schema.createSourceDescriptor({
                source_id: sourceRef.source_id || `SSL:${serial}`,
                api_id: this.id,
                provider: this.provider,
                site_id: sourceRef.site_id || sourceRef.site || "",
                borehole_id: serial,
                display_name: sourceRef.display_name || serial || "Unknown SonSetLink site",
                country: sourceRef.country || "Unknown",
                lat: sourceRef.lat,
                lon: sourceRef.lon,
                granularity: sourceRef.granularity || "daily-screening",
                confidence_class: sourceRef.confidence_class || "screening",
                metadata: {
                    ...(sourceRef.metadata || {}),
                    endpoint_used: adapterResult?.endpoint_used || null
                }
            });

            const rows = Array.isArray(adapterResult?.raw?.rows) ? adapterResult.raw.rows : [];
            const points = [];

            for (const row of rows) {
                const endMs = parseSslTimestamp(row.adjusted_timestamp || row.timestamp);
                if (!Number.isFinite(endMs)) continue;

                const unit = row.flow_unit || source.metadata.flow_unit || "L";
                const dailyVolumeM3 = flowToM3(Number(row.deflow ?? row.pulse), unit);
                const timeInUse = Number(row.time_in_use);
                const activeHours = Number.isFinite(timeInUse) && timeInUse > 0
                    ? (timeInUse > 24 ? timeInUse / 60 : timeInUse)
                    : 24;
                const estimatedFlowM3h = Number.isFinite(dailyVolumeM3)
                    ? dailyVolumeM3 / Math.max(activeHours, 0.25)
                    : null;
                const windowStartMs = endMs - (activeHours * 60 * 60 * 1000);

                if (Number.isFinite(estimatedFlowM3h)) {
                    points.push(Schema.createTelemetryPoint({
                        source_id: source.source_id,
                        borehole_id: source.borehole_id,
                        provider: this.provider,
                        parameter: Schema.PARAMETERS.FLOW,
                        timestamp_ms: endMs,
                        window_start_ms: windowStartMs,
                        sample_span_hours: activeHours,
                        value: estimatedFlowM3h,
                        unit: "m3/h",
                        quality: "derived",
                        flags: ["approximate_source", "derived_from_daily_total"],
                        raw_ref: { api: this.id, field: row._endpoint || adapterResult?.endpoint_used || "usage.json.php" },
                        meta: {
                            daily_volume_m3: dailyVolumeM3,
                            raw_unit: unit
                        }
                    }));
                }

                const slots = parseNumericArray(row.sensor2);
                if (slots.length) {
                    const slotMs = (24 * 60 * 60 * 1000) / slots.length;
                    const slotStart = endMs - (24 * 60 * 60 * 1000);
                    slots.forEach((value, idx) => {
                        points.push(Schema.createTelemetryPoint({
                            source_id: source.source_id,
                            borehole_id: source.borehole_id,
                            provider: this.provider,
                            parameter: Schema.PARAMETERS.WATER_LEVEL,
                            timestamp_ms: slotStart + ((idx + 0.5) * slotMs),
                            sample_span_hours: slotMs / (60 * 60 * 1000),
                            value: value * 0.1,
                            unit: "m",
                            quality: "derived",
                            flags: ["approximate_source", "derived_from_sensor_slots"],
                            raw_ref: { api: this.id, field: "sensor2" }
                        }));
                    });
                }
            }

            return Normalize.buildNormalizedBundle({
                source,
                points,
                raw_series: adapterResult?.raw || {},
                metadata: {
                    adapter_id: this.id,
                    approximate: true
                },
                quality_summary: {
                    is_approximate: true,
                    notes: ["Normalized from SonSetLink daily totals and slot-based depth arrays"]
                }
            });
        }
    }

    return {
        SonSetLinkTelemetryAdapter,
        parseSslTimestamp
    };
});