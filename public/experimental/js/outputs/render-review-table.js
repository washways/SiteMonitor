(function (global, factory) {
    const api = factory();
    if (typeof module !== "undefined" && module.exports) {
        module.exports = api;
    }
    global.SiteMonitorExperimental = global.SiteMonitorExperimental || {};
    global.SiteMonitorExperimental.RenderReviewTable = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
    function escapeHtml(value) {
        return String(value ?? "")
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/\"/g, "&quot;")
            .replace(/'/g, "&#39;");
    }

    function renderReviewTable(target, eventRows = [], meta = {}) {
        if (!target) return;
        const parts = [];
        parts.push(`<div class="exp-summary">`);
        parts.push(`<div><strong>Source:</strong> ${escapeHtml(meta.sourceName || "Unknown")}</div>`);
        parts.push(`<div><strong>Raw flow points:</strong> ${escapeHtml(meta.rawFlowCount || 0)}</div>`);
        parts.push(`<div><strong>Cleaned flow points:</strong> ${escapeHtml(meta.cleanedFlowCount || 0)}</div>`);
        parts.push(`<div><strong>Completed events:</strong> ${escapeHtml(eventRows.length)}</div>`);
        parts.push(`</div>`);

        if (!eventRows.length) {
            parts.push(`<p>No completed pumping events were detected for the current selection.</p>`);
            target.innerHTML = parts.join("");
            return;
        }

        parts.push(`<table class="exp-table"><thead><tr>
            <th>Borehole ID</th>
            <th>Event start</th>
            <th>Event end</th>
            <th>Duration (h)</th>
            <th>Total pumped volume</th>
            <th>Start GW level</th>
            <th>GW level at last non-zero flow</th>
            <th>Drawdown</th>
            <th>Last valid non-zero flow</th>
            <th>Specific capacity</th>
            <th>Deepest level reached</th>
            <th>Maximum drawdown</th>
            <th>Quality flags</th>
        </tr></thead><tbody>`);

        eventRows.forEach((row) => {
            parts.push(`<tr>
                <td>${escapeHtml(row.borehole_id)}</td>
                <td>${escapeHtml(row.event_start)}</td>
                <td>${escapeHtml(row.event_end)}</td>
                <td>${escapeHtml(row.duration_hours)}</td>
                <td>${escapeHtml(row.total_pumped_volume_m3)}</td>
                <td>${escapeHtml(row.groundwater_level_at_event_start_m)}</td>
                <td>${escapeHtml(row.groundwater_level_at_last_valid_non_zero_flow_m)}</td>
                <td>${escapeHtml(row.drawdown_m)}</td>
                <td>${escapeHtml(row.last_valid_non_zero_flow_m3h)}</td>
                <td>${escapeHtml(row.specific_capacity_m3h_per_m)}</td>
                <td>${escapeHtml(row.deepest_level_reached_m)}</td>
                <td>${escapeHtml(row.maximum_drawdown_m)}</td>
                <td>${escapeHtml((row.quality_flags || []).join(", "))}</td>
            </tr>`);
        });

        parts.push(`</tbody></table>`);
        target.innerHTML = parts.join("");
    }

    return {
        renderReviewTable
    };
});