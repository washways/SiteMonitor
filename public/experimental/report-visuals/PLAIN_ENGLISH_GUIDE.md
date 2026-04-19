# Simple User Guide to the Experimental Review Pages

This hidden visualization layer is designed to help teams review borehole telemetry in a practical way.

It is for:
- internal review
- prioritising which sites to look at next
- checking whether patterns look stable, stressed, unreliable, or uncertain

It is not meant to replace field judgement.

You do not need to upload data first. The experimental pages share one cached cohort analysis, so once the data are loaded on one page you can switch between the other pages without rerunning.

By default, the hidden review pages start with all available DCP boreholes in Malawi over the last 14 days. This is used as the standard opening view because it is the higher-confidence routine review lane.

---

## Quick start

1. Open one of the hidden review pages.
2. Wait for the loading spinner if the page is pulling fresh telemetry.
3. Start with the default DCP Malawi 14-day view.
4. Open the advanced options only if you need a different provider or tuning.
5. Use the filters to narrow the list.
6. Click a borehole name to open the detailed page.
7. Download CSV or JSON if you want to share or review results offline.

---

## Which page should I use?

### Network overview
Use this when you want a quick picture of the whole set of boreholes.

It helps answer:
- how many sites are active
- which ones look stressed
- which ones are high priority
- which ones have stronger or weaker evidence

### Borehole detail
Use this when you want to understand one site properly.

It helps answer:
- what happened day by day
- whether water levels and pumping look stable
- whether the site may be running near dry
- what action is currently suggested

The top section is now a simple summary list rather than a set of KPI boxes.

### Cross-site comparison
Use this when you want to compare sites against each other.

It helps answer:
- which sites stand out most
- which ones show the biggest stress signals
- which ones have the best supported specific-capacity values
- which ones deserve a closer look first

### Q/S method comparison
Use this when you want to compare the different Q/S calculation approaches for the same sites.

It helps answer:
- how much the methods differ
- which boreholes have stable or unstable Q/S estimates
- whether the chosen method is close to the other candidates

The page is now intentionally simple: one list of all loaded sites with separate columns for each method. Hover over the column headings for a plain-language explanation.

### Field review board
Use this when planning follow-up work.

It helps answer:
- which sites need urgent field visits
- which ones can wait for a planned review
- what the main field-check focus should be

---

## What do the main labels mean?

### Healthy and stable
The recent pattern looks normal, and there are no strong warning signs in the selected period.

### High-use but stable
The borehole is working hard, but the current data do not yet show a clear problem.

### Stressed
The data show warning signs such as higher drawdown, weaker specific capacity, or repeated stress flags.

### Declining performance
The site still works, but the recent pattern looks worse than its own recent baseline.

### Unreliable or possible fault
The data suggest a telemetry issue, power issue, sensor issue, or a site problem that should be checked.

### Insufficient data
There is not enough good recent evidence to make a strong judgement.

---

## Simple explanation of the key questions

### Is the borehole working normally?
Look first at the status label and the suggested action.

### Is it under stress?
Check the drawdown, the selected specific-capacity values, and the stress labels.

### Could the pump be running near dry?
Look for the run-dry or intake-limitation cues on the detailed page.

### Can I trust the result?
Check the evidence-confidence label.
High confidence means the telemetry support is stronger.
Low confidence means you should be more cautious.

### Should I compare DCP and SonSetLink directly?
No, not as if they are equally precise.
DCP is the higher-confidence analytical lane.
SonSetLink is kept as a separate screening lane.

---

## Important caution

These pages are review tools, not automatic diagnoses.

The goal is to help teams answer a simple practical question:

**Where should we look next, and how confident are we about that suggestion?**
