# Visualization Methods

This visualization layer reads the **existing analytics report JSON directly** and adds only a thin transformation layer for charting and filtering.

## What is reused directly from the report

The pages use the existing report structures, including:

- network summary
- category summary table
- health summary table
- maintenance priority table
- network comparison table
- daily rows
- rolling rows
- readiness tiers
- typology groups
- status labels
- transparent interpretations and reasons
- daily quality flags

## Visualization design choices

### Network overview
- KPI cards use the existing network and health summary fields.
- The bubble scatter uses median valid specific capacity, downtime proxy share, total volume, and status category.
- Missing specific-capacity values are not hidden; they are shown explicitly as missing in the chart and tables.

### Borehole detail
- Daily pumped volume comes from the daily rows exactly as exported.
- Groundwater level traces use daily minimum, daily maximum, and estimated resting level directly from the report.
- Drawdown and specific-capacity charts preserve nulls, negative drawdown values, zero groundwater values, and flagged days.
- A quality-strip view shows daily flags without suppressing uncertainty.

### Cross-site comparison
- The heatmap and scatter views use the existing ranked and health-summary metrics.
- Ranked tables expose stress, downtime, decline, unreliability, and best specific capacity separately.
- Typology and status are always shown as distinct concepts.

## Isolation review

This visualization layer is tightened for safety because:

- it is entirely under its own experimental subfolder
- it introduces no new routes into the live dashboard
- it does not import the live dashboard scripts
- it does not change worker logic, app logic, or production pages
- it uses only static HTML, CSS, and JavaScript plus Plotly on the experimental pages themselves

## Uncertainty handling

The pages intentionally keep poor support visible. They do not hide:

- null values
- invalid specific capacity
- negative drawdown
- zero groundwater values
- downtime proxies
- recovery-not-observed flags
- insufficient-data classifications

That is deliberate so the visual layer remains operationally honest.
