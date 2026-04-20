(function (global, factory) {
    const api = factory(global);
    if (typeof module !== "undefined" && module.exports) {
        module.exports = api;
    }
    global.SiteMonitorExperimental = global.SiteMonitorExperimental || {};
    global.SiteMonitorExperimental.BaseAdapter = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function (global) {
    const DEFAULT_PROXY_BASE = "https://wash-proxy.washways1.workers.dev";
    const REQUEST_TIMEOUT_MS = 60000;

    class BaseTelemetryAdapter {
        constructor({ id, label, provider }) {
            this.id = id;
            this.label = label;
            this.provider = provider;
        }

        canHandle() {
            return true;
        }

        async listSources() {
            throw new Error("listSources() not implemented");
        }

        async fetchTelemetry() {
            throw new Error("fetchTelemetry() not implemented");
        }

        normalize() {
            throw new Error("normalize() not implemented");
        }
    }

    function getStoredCredentials(overrides = {}) {
        try {
            const local = {
                dcpToken: (global.localStorage?.getItem("dcp_token") || "").trim(),
                sslUser: (global.localStorage?.getItem("ssl_user") || "").trim(),
                sslPass: (global.localStorage?.getItem("ssl_pass") || "").trim()
            };
            return {
                dcpToken: String(overrides.dcpToken ?? local.dcpToken ?? "").trim(),
                sslUser: String(overrides.sslUser ?? local.sslUser ?? "").trim(),
                sslPass: String(overrides.sslPass ?? local.sslPass ?? "").trim()
            };
        } catch {
            return {
                dcpToken: String(overrides.dcpToken || "").trim(),
                sslUser: String(overrides.sslUser || "").trim(),
                sslPass: String(overrides.sslPass || "").trim()
            };
        }
    }

    function getRuntimeContext(overrides = {}) {
        const locationRef = global.location || { hostname: "", search: "" };
        const isLocal = /^(localhost|127\.0\.0\.1)$/i.test(locationRef.hostname || "");
        const forceProxy = String(locationRef.search || "").includes("proxy=1") || (() => {
            try {
                return global.localStorage?.getItem("wash_force_proxy") === "1";
            } catch {
                return false;
            }
        })();
        const useProxy = overrides.useProxy ?? (!isLocal || forceProxy);
        const proxyBase = overrides.proxyBase || DEFAULT_PROXY_BASE;
        return {
            PROXY_BASE: proxyBase,
            IS_LOCAL: isLocal,
            FORCE_PROXY: forceProxy,
            USE_PROXY: useProxy,
            IS_LIVE: useProxy,
            DCP_BASE: useProxy ? `${proxyBase}/dcp` : "https://api-dev.dcp.solar/water",
            SSL_BASE: useProxy ? `${proxyBase}/ssl` : "https://sonsetlink.org/water/technical"
        };
    }

    function validateWindow(window = {}) {
        const start = new Date(window.start);
        const end = new Date(window.end);
        if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
            throw new Error("A valid analysis start and end time are required.");
        }
        if (end <= start) {
            throw new Error("The analysis end time must be later than the start time.");
        }
        return { start, end };
    }

    async function fetchJson(url, options = {}, timeoutMs = REQUEST_TIMEOUT_MS) {
        const controller = typeof AbortController !== "undefined" ? new AbortController() : null;
        const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;
        try {
            const res = await fetch(url, controller ? { ...options, signal: controller.signal } : options);
            const text = await res.text();
            if (!res.ok) {
                throw new Error(`HTTP ${res.status}: ${text.slice(0, 150)}`);
            }
            return text.trim() ? JSON.parse(text) : {};
        } catch (error) {
            if (error?.name === "AbortError") {
                throw new Error(`Request timed out after ${timeoutMs} ms`);
            }
            throw error;
        } finally {
            if (timer) clearTimeout(timer);
        }
    }

    function formatDcpIso(dateValue) {
        const iso = new Date(dateValue).toISOString();
        return iso.includes(".") ? `${iso.split(".")[0]}Z` : iso;
    }

    function formatSslDateTime(dateValue) {
        return new Date(dateValue).toISOString().replace("T", " ").slice(0, 19);
    }

    return {
        DEFAULT_PROXY_BASE,
        BaseTelemetryAdapter,
        getStoredCredentials,
        getRuntimeContext,
        fetchJson,
        validateWindow,
        formatDcpIso,
        formatSslDateTime,
        REQUEST_TIMEOUT_MS
    };
});