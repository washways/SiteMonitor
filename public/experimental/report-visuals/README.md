# Experimental Report Visualizations

This folder contains a **separate visualization layer** for the existing experimental borehole analytics report.

It does **not** modify the live dashboard flow.

## Purpose

These pages read the exported analytics report JSON directly and turn the existing report structures into charts and decision-support views.

The visualization layer uses the current report schema, including:

- daily rows
- rolling rows
- network summary
- health summary table
- category summary table
- network comparison table
- maintenance priority ranking
- readiness tier
- typology group
- status labels
- interpretations
- quality flags

## Pages

- network-overview.html
- borehole-detail.html
- cross-site-comparison.html

## Isolation review

The visualization layer is isolated because:

- all files live under this separate experimental folder
- no live page imports these files
- no production routes or shared runtime configs were changed
- only static HTML, CSS, and JavaScript are used
- Plotly is loaded only by these experimental pages for chart rendering

## Loading a report

These pages can use:

- the included sample report JSON in this folder
- a saved exported analytics report JSON loaded through the file picker
- a report URL passed through the query string

The visual layer is for review only until explicitly promoted.
