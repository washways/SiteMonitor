(function (global, factory) {
    const api = factory();
    if (typeof module !== "undefined" && module.exports) {
        module.exports = api;
    }
    global.SiteMonitorExperimental = global.SiteMonitorExperimental || {};
    global.SiteMonitorExperimental.QcFlags = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
    function createFlag(code, message, severity = "info", meta = {}) {
        return {
            code: String(code || "unknown_flag"),
            message: String(message || ""),
            severity: String(severity || "info"),
            meta: meta && typeof meta === "object" ? { ...meta } : {}
        };
    }

    function addFlag(list, code, message, severity = "info", meta = {}) {
        const bucket = Array.isArray(list) ? list : [];
        const exists = bucket.some((flag) => flag.code === code);
        if (!exists) {
            bucket.push(createFlag(code, message, severity, meta));
        }
        return bucket;
    }

    function flagCodes(list = []) {
        return list.map((flag) => flag.code);
    }

    return {
        createFlag,
        addFlag,
        flagCodes
    };
});