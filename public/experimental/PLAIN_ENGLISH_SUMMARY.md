# Plain-English summary of the experimental analytics layer

## Experimental research notice

This material is experimental and research-oriented.

It is intended to explain what the hidden review pages are doing and how their outputs should be interpreted. It should not be read as final public reporting or a definitive engineering diagnosis.

This experimental layer tries to answer practical questions that field teams and reviewers often ask.

## What the new metrics mean in practice

### Daily pumped volume
How much water the borehole appears to have delivered on that day.

### Hours pumped
How long the borehole appears to have been actively pumping during the day.

### Number of pumping events
How many separate pumping episodes were detected, rather than one long continuous run.

### Drawdown
How much the groundwater level appeared to fall during pumping.
A larger drawdown can indicate that the borehole is working harder to deliver water.

### Specific capacity
A simple performance measure that compares flow to drawdown.
Higher values usually suggest better delivery for the amount of groundwater response observed.

### Resting level
An estimate of the groundwater level when the borehole is not actively pumping.
This can help show whether background conditions are shifting over time.

### Recovery time
How quickly the groundwater level seems to return toward its pre-pumping state after an event ends.
This is useful, but still a cautious metric in the current data.

### Downtime indicator
A practical proxy showing days when telemetry was present but no pumping was observed.
This is not the same as confirmed mechanical failure.

### Stress flag
A transparent review flag raised when the recent combination of drawdown, low specific capacity, weak recovery, or repeated quality-limited events suggests the site deserves closer attention.

## What the health categories mean

### Healthy and stable
The borehole currently looks normal enough for routine monitoring only.

### High-use but stable
The borehole is busy and important operationally, but it is not yet showing the main warning signs.

### Stressed
The borehole is showing warning signs such as stronger drawdown or weaker performance and deserves closer review.

### Declining performance
The recent pattern looks worse than the borehole's own recent baseline, so it should move up the review queue.

### Unreliable or possible fault
The telemetry pattern suggests a possible data, power, communications, or asset problem that should be checked.

### Insufficient data
There is not enough trustworthy recent evidence to judge the borehole confidently.

## Suggested actions in practice

- healthy and stable: keep routine monitoring
- high-use but stable: keep under regular watch because it is operationally important
- stressed: review pumping conditions and plan a field check
- declining performance: prioritize investigation against earlier periods
- unreliable or possible fault: inspect telemetry, power, and site condition soon
- insufficient data: improve coverage before drawing strong conclusions

## Important caution

Not every site supports every metric equally well.

- DCP provides the stronger event-based analytics.
- SonSetLink provides useful screening information, but most of its deeper hydrogeologic metrics remain approximate.
- Any metric marked approximate or caveated should be treated as a review aid rather than a final diagnosis.
