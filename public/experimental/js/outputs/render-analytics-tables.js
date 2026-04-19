(function (global, factory) {
    const api = factory();
    if (typeof module !== "undefined" && module.exports) {
        module.exports = api;
    }
    global.SiteMonitorExperimental = global.SiteMonitorExperimental || {};
    global.SiteMonitorExperimental.RenderAnalyticsTables = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
    function escapeHtml(value) {
        return String(value ?? "")
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/\"/g, "&quot;")
            .replace(/'/g, "&#39;");
    }

    function humanize(value) {
        return String(value ?? "—").replace(/_/g, " ");
    }

    function renderTable(target, rows = [], columns = [], emptyMessage = "No rows available.") {
        if (!target) return;
        if (!rows.length) {
            target.innerHTML = `<p>${escapeHtml(emptyMessage)}</p>`;
            return;
        }

        const head = columns.map((column) => `<th>${escapeHtml(column.label)}</th>`).join("");
        const body = rows.map((row) => `<tr>${columns.map((column) => {
            const value = typeof column.value === "function" ? column.value(row) : row[column.key];
            return `<td>${escapeHtml(value ?? "—")}</td>`;
        }).join("")}</tr>`).join("");

        target.innerHTML = `<table class="exp-table"><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>`;
    }

    function renderCategoryGuide(target, rows = []) {
        if (!target) return;
        if (!rows.length) {
            target.innerHTML = "<p>Run the analytics to populate the interpretation categories.</p>";
            return;
        }

        target.innerHTML = rows.map((row) => `
            <div class="panel" style="margin:0 0 0.75rem 0; padding:0.75rem;">
                <strong>${escapeHtml(row.status_label || row.status_category || "Category")}</strong>
                ${row.site_count !== undefined ? `<div><em>Sites in current run: ${escapeHtml(row.site_count)}</em></div>` : ""}
                <div>${escapeHtml(row.meaning || "")}</div>
                <div><strong>Suggested action:</strong> ${escapeHtml(row.suggested_action || "")}</div>
            </div>`).join("");
    }

    function renderAnalyticsTables(targets = {}, analytics = {}) {
        const summaryTarget = targets.summary;
        if (summaryTarget) {
            const summary = analytics.network_summary || {};
            summaryTarget.innerHTML = `
                <div class="exp-summary">
                    <div><strong>Sites analysed:</strong> ${escapeHtml(summary.site_count || 0)}</div>
                    <div><strong>Active sites:</strong> ${escapeHtml(summary.active_site_count || 0)}</div>
                    <div><strong>Telemetry-ready:</strong> ${escapeHtml(summary.telemetry_ready_site_count || 0)}</div>
                    <div><strong>Stress-review sites:</strong> ${escapeHtml(summary.stressed_site_count || 0)}</div>
                    <div><strong>Stable-tail capable sites:</strong> ${escapeHtml(summary.stable_tail_capable_site_count || 0)}</div>
                    <div><strong>Short-burst dominant sites:</strong> ${escapeHtml(summary.short_burst_dominant_site_count || 0)}</div>
                    <div><strong>Q/S mode:</strong> ${escapeHtml(analytics.qs_method_label || summary.qs_method_used || "preferred")}</div>
                    <div><strong>Total observed volume:</strong> ${escapeHtml(summary.total_observed_volume_m3 || 0)}</div>
                </div>`;
        }

        renderCategoryGuide(targets.categoryGuide, analytics.category_summary_table || analytics.category_definitions || []);

        renderTable(targets.health, analytics.health_summary_table || [], [
            { label: "Borehole", value: (row) => row.display_name || row.borehole_id },
            { label: "Status", value: (row) => row.status_label || row.status_category },
            { label: "Priority", key: "maintenance_priority_label" },
            { label: "Interpretation", key: "concise_interpretation" },
            { label: "Suggested action", key: "recommended_action" },
            { label: "Reasons", value: (row) => (row.transparent_reasons || []).join(", ") }
        ], "No borehole interpretation rows were produced.");

        renderTable(targets.priority, analytics.priority_ranking_table || [], [
            { label: "Rank", key: "priority_rank" },
            { label: "Borehole", value: (row) => row.display_name || row.borehole_id },
            { label: "Status", value: (row) => row.status_label || row.status_category },
            { label: "Priority score", key: "maintenance_priority_score" },
            { label: "Priority band", key: "maintenance_priority_label" },
            { label: "Suggested action", key: "recommended_action" }
        ], "No maintenance priority rows were produced.");

        renderTable(targets.daily, analytics.daily_rows || [], [
            { label: "Date", key: "date" },
            { label: "Borehole", value: (row) => row.display_name || row.borehole_id },
            { label: "Provider", key: "provider" },
            { label: "Q/S Method", value: (row) => humanize(row.active_qs_method) },
            { label: "Daily Volume", key: "daily_pumped_volume_m3" },
            { label: "Hours Pumped", key: "total_hours_pumped" },
            { label: "Events", key: "event_count" },
            { label: "Max Flow", key: "daily_max_flow_m3h" },
            { label: "Max Drawdown", key: "maximum_drawdown_m" },
            { label: "Selected Q/S", key: "median_specific_capacity_m3h_per_m" },
            { label: "Stable-tail Events", key: "stable_tail_event_count" },
            { label: "Resting Level", key: "estimated_daily_resting_level_m" },
            { label: "Flags", value: (row) => (row.daily_quality_flags || []).join(", ") }
        ], "No daily summary rows were produced.");

        renderTable(targets.rolling, analytics.rolling_rows || [], [
            { label: "Date", key: "date" },
            { label: "Borehole", value: (row) => row.display_name || row.borehole_id },
            { label: "Q/S Method", value: (row) => humanize(row.qs_method) },
            { label: "7d Volume", key: "rolling_7d_volume_m3" },
            { label: "30d Volume", key: "rolling_30d_volume_m3" },
            { label: "7d Q/S", key: "rolling_7d_specific_capacity_median" },
            { label: "30d Q/S", key: "rolling_30d_specific_capacity_median" },
            { label: "30d Max Flow", key: "rolling_30d_max_flow_m3h" },
            { label: "30d Stable-tail Share", key: "rolling_30d_stable_tail_share" },
            { label: "7d Rest Trend", key: "resting_level_trend_7d_m_per_day" },
            { label: "30d Rest Trend", key: "resting_level_trend_30d_m_per_day" },
            { label: "30d Stress Count", key: "rolling_30d_stress_event_count" },
            { label: "30d Downtime", key: "rolling_30d_downtime_days" }
        ], "No rolling summary rows were produced.");

        renderTable(targets.borehole, analytics.borehole_summary_table || [], [
            { label: "Borehole", value: (row) => row.display_name || row.borehole_id },
            { label: "Provider", key: "provider" },
            { label: "Tier", key: "analysis_readiness_tier" },
            { label: "Typology", value: (row) => humanize(row.typology_group) },
            { label: "Q/S Method", value: (row) => humanize(row.qs_method_used) },
            { label: "Flow Profile", value: (row) => humanize(row.flow_behavior_profile) },
            { label: "Total Volume", key: "total_volume_m3" },
            { label: "Active Day Share", key: "active_day_share" },
            { label: "Stable-tail Share", key: "stable_tail_event_share" },
            { label: "Downtime Days", key: "downtime_proxy_days" },
            { label: "Median Q/S", key: "median_valid_specific_capacity_m3h_per_m" },
            { label: "Max Drawdown", key: "max_drawdown_observed_m" },
            { label: "Stress", value: (row) => row.stress_flag ? "Review" : "OK" }
        ], "No borehole summary rows were produced.");

        renderTable(targets.network, analytics.network_comparison_table || [], [
            { label: "Borehole", value: (row) => row.display_name || row.borehole_id },
            { label: "Typology", key: "typology_group" },
            { label: "Rank Vol", key: "rank_highest_volume" },
            { label: "Rank Stress", key: "rank_most_stressed" },
            { label: "Rank Q/S", key: "rank_best_specific_capacity" },
            { label: "Rank Decline", key: "rank_largest_decline" },
            { label: "Rank Downtime", key: "rank_most_downtime" },
            { label: "Rank Data", key: "rank_most_unreliable_data" }
        ], "No network comparison rows were produced.");
    }

    return {
        renderAnalyticsTables
    };
});