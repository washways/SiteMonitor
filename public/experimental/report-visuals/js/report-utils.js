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
        const stroke = options.stroke || "#2563eb";
        const dotFill = options.dotFill || stroke;
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
        points.forEach((point) => {
            if (point.y === null) return;
            path += `${path ? " L" : "M"}${point.x.toFixed(1)} ${point.y.toFixed(1)}`;
        });

        const circles = points
            .filter((point) => point.y !== null)
            .map((point) => `<circle cx="${point.x.toFixed(1)}" cy="${point.y.toFixed(1)}" r="1.8" fill="${dotFill}"></circle>`)
            .join("");

        return `<svg viewBox="0 0 ${width} ${height}" class="sparkline" aria-hidden="true"><path d="${path}" fill="none" stroke="${stroke}" stroke-width="2"></path>${circles}</svg>`;
    }

    function statusColor(statusCategory) {
        return STATUS_COLORS[statusCategory] || "#475569";
    }

    function toDateString(value) {
        if (!value) return "";
        if (value instanceof Date) {
            return value.toISOString().split("T")[0];
        }
        const raw = String(value);
        if (/^\d{4}-\d{2}-\d{2}/.test(raw)) {
            return raw.slice(0, 10);
        }
        const parsed = new Date(raw);
        return Number.isNaN(parsed.getTime()) ? "" : parsed.toISOString().split("T")[0];
    }

    function getSharedDateRange(rows = [], filters = {}) {
        const explicitStart = toDateString(filters.startDate);
        const explicitEnd = toDateString(filters.endDate);
        if (explicitStart && explicitEnd) {
            return [explicitStart, explicitEnd];
        }

        const dates = (rows || [])
            .map((row) => toDateString(row?.date || row))
            .filter(Boolean)
            .sort();

        if (!dates.length && !(explicitStart || explicitEnd)) return null;
        return [explicitStart || dates[0], explicitEnd || dates[dates.length - 1]];
    }

    function buildDateAxis(rows = [], filters = {}, extra = {}) {
        const range = getSharedDateRange(rows, filters);
        return {
            type: "date",
            tickformat: "%d %b",
            tickangle: -30,
            automargin: true,
            showgrid: true,
            ...(range ? { range } : {}),
            ...extra
        };
    }

    function downloadCsv(filename = "export.csv", rows = []) {
        if (!rows.length) return;
        const columns = unique(rows.flatMap((row) => Object.keys(row || {})));
        const escapeCsv = (value) => {
            const text = String(value ?? "");
            return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
        };
        const csv = [
            columns.join(","),
            ...rows.map((row) => columns.map((column) => escapeCsv(row?.[column])).join(","))
        ].join("\n");
        const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = url;
        link.download = filename;
        document.body.appendChild(link);
        link.click();
        link.remove();
        URL.revokeObjectURL(url);
    }

    function downloadJson(filename = "export.json", payload = {}) {
        const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json;charset=utf-8;" });
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = url;
        link.download = filename;
        document.body.appendChild(link);
        link.click();
        link.remove();
        URL.revokeObjectURL(url);
    }

    function ensurePlotlyModal() {
        let backdrop = document.getElementById("plotlyChartModalBackdrop");
        if (backdrop) return backdrop;
        backdrop = document.createElement("div");
        backdrop.id = "plotlyChartModalBackdrop";
        backdrop.className = "plot-modal-backdrop";
        backdrop.innerHTML = `
            <div class="plot-modal">
                <div class="plot-modal-header">
                    <strong id="plotlyChartModalTitle">Expanded chart</strong>
                    <button type="button" id="plotlyChartModalClose" class="secondary">Close</button>
                </div>
                <div id="plotlyChartModalBody" class="plot-modal-body"></div>
            </div>`;
        backdrop.addEventListener("click", (event) => {
            if (event.target === backdrop) backdrop.classList.remove("open");
        });
        backdrop.querySelector("#plotlyChartModalClose")?.addEventListener("click", () => backdrop.classList.remove("open"));
        document.body.appendChild(backdrop);
        return backdrop;
    }

    function attachExpandButtons() {
        document.querySelectorAll(".chart-box").forEach((box) => {
            if (box.querySelector(".expand-chart-btn")) return;
            const plotTarget = box.querySelector("div[id]");
            if (!plotTarget) return;
            const button = document.createElement("button");
            button.type = "button";
            button.className = "expand-chart-btn secondary";
            button.textContent = "Expand";
            button.addEventListener("click", (event) => {
                event.preventDefault();
                event.stopPropagation();
                const backdrop = ensurePlotlyModal();
                const modalTitle = backdrop.querySelector("#plotlyChartModalTitle");
                const modalBody = backdrop.querySelector("#plotlyChartModalBody");
                if (modalTitle) {
                    modalTitle.textContent = plotTarget.layout?.title?.text || plotTarget.id || "Expanded chart";
                }
                if (modalBody) {
                    modalBody.innerHTML = "<div id=\"plotlyExpandedChart\" style=\"width:100%;height:100%;min-height:520px;\"></div>";
                    const expanded = modalBody.querySelector("#plotlyExpandedChart");
                    if (expanded && globalThis.Plotly && plotTarget.data) {
                        const data = JSON.parse(JSON.stringify(plotTarget.data));
                        const layout = JSON.parse(JSON.stringify(plotTarget.layout || {}));
                        globalThis.Plotly.newPlot(expanded, data, layout, { responsive: true, displayModeBar: true });
                    }
                }
                backdrop.classList.add("open");
            });
            box.appendChild(button);
        });
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
        toDateString,
        getSharedDateRange,
        buildDateAxis,
        downloadCsv,
        downloadJson,
        attachExpandButtons
    };
});
