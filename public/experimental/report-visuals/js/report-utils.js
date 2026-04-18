(function (global, factory) {
    const api = factory();
    if (typeof module !== "undefined" && module.exports) {
        module.exports = api;
    }
    global.SiteMonitorExperimentalVizUtils = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
    const STATUS_COLORS = {
        healthy_and_stable: "#16a34a",
        high_use_but_stable: "#0284c7",
        stressed: "#dc2626",
        declining_performance: "#ea580c",
        unreliable_or_possible_fault: "#7c3aed",
        insufficient_data: "#64748b"
    };

    function safeNumber(value) {
        if (value === null || value === undefined || value === "") return null;
        const num = Number(value);
        return Number.isFinite(num) ? num : null;
    }

    function formatNumber(value, digits = 2, fallback = "—") {
        const num = safeNumber(value);
        return num === null ? fallback : num.toFixed(digits);
    }

    function formatPercent(value, digits = 1) {
        const num = safeNumber(value);
        return num === null ? "—" : `${(num * 100).toFixed(digits)}%`;
    }

    function escapeHtml(value) {
        return String(value ?? "")
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/\"/g, "&quot;")
            .replace(/'/g, "&#39;");
    }

    function unique(values = []) {
        return [...new Set((values || []).filter(Boolean))];
    }

    function boreholeKey(row = {}) {
        return `${row.provider || "Unknown"}::${row.borehole_id || row.display_name || "Unknown"}`;
    }

    function groupBy(rows = [], keyFn = (item) => item) {
        const map = new Map();
        (rows || []).forEach((row) => {
            const key = keyFn(row);
            if (!map.has(key)) map.set(key, []);
            map.get(key).push(row);
        });
        return map;
    }

    function sortByDate(rows = []) {
        return [...rows].sort((a, b) => String(a.date || "").localeCompare(String(b.date || "")));
    }

    function sparklineSvg(values = [], options = {}) {
        const width = options.width || 120;
        const height = options.height || 28;
        const pad = 2;
        const finite = values.map(safeNumber);
        const present = finite.filter((value) => value !== null);
        if (!present.length) {
            return '<span class="muted">No series</span>';
        }

        const min = Math.min(...present);
        const max = Math.max(...present);
        const span = Math.max(max - min, 1);
        const points = finite.map((value, index) => {
            const x = pad + ((width - (pad * 2)) * (finite.length === 1 ? 0.5 : (index / (finite.length - 1))));
            const y = value === null
                ? null
                : height - pad - (((value - min) / span) * (height - (pad * 2)));
            return { x, y };
        });

        let path = "";
        points.forEach((point, index) => {
            if (point.y === null) return;
            path += `${path ? " L" : "M"}${point.x.toFixed(1)} ${point.y.toFixed(1)}`;
        });

        const circles = points
            .filter((point) => point.y !== null)
            .map((point) => `<circle cx="${point.x.toFixed(1)}" cy="${point.y.toFixed(1)}" r="1.8" fill="#2563eb"></circle>`)
            .join("");

        return `<svg viewBox="0 0 ${width} ${height}" class="sparkline" aria-hidden="true"><path d="${path}" fill="none" stroke="#2563eb" stroke-width="2"></path>${circles}</svg>`;
    }

    function statusColor(statusCategory) {
        return STATUS_COLORS[statusCategory] || "#475569";
    }

    function toDateString(value) {
        if (!value) return "";
        return String(value).slice(0, 10);
    }

    return {
        STATUS_COLORS,
        safeNumber,
        formatNumber,
        formatPercent,
        escapeHtml,
        unique,
        boreholeKey,
        groupBy,
        sortByDate,
        sparklineSvg,
        statusColor,
        toDateString
    };
});
