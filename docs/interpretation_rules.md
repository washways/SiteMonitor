# Interpretation rules for the experimental borehole health layer

Date: 2026-04-18

## Purpose

This document defines the transparent, rule-based interpretation layer that sits on top of the experimental analytics outputs.

It is designed for operational understanding, not black-box prediction.

This layer remains separate from the live production flow unless it is explicitly approved for promotion.

---

## Design principles

1. Use only the real telemetry-derived analytics already present in the experimental pipeline.
2. Keep every category rule visible and explainable.
3. Do not use machine learning at this stage.
4. Treat SonSetLink rows as screening-level support unless stronger evidence is available.
5. Use the outputs to support review and prioritization, not final diagnosis.

---

## Main interpretation categories

### 1. Healthy and stable

Meaning:
- no major recent warning signs are visible
- telemetry is recent enough to support a basic interpretation
- the borehole does not currently show strong stress or decline triggers

Suggested action:
- continue routine monitoring
- no immediate maintenance escalation needed

### 2. High-use but stable

Meaning:
- the borehole is carrying a relatively heavy operational load
- usage is high, but the current indicators do not yet show the main stress pattern

Suggested action:
- continue monitoring closely
- keep it in the normal operational review cycle because high-use sites are important even when stable

### 3. Stressed

Meaning:
- one or more recent metrics suggest the borehole is working hard or responding poorly
- common triggers include high drawdown, low specific capacity, or repeated stress flags

Suggested action:
- review pumping pattern and recent operating conditions
- consider field inspection or closer operational review

### 4. Declining performance

Meaning:
- the borehole still appears active, but recent performance looks worse than its recent baseline
- this is intended as an early warning rather than a final diagnosis

Suggested action:
- prioritize comparison against earlier periods
- investigate possible mechanical or hydrogeologic change

### 5. Unreliable or possible fault

Meaning:
- the telemetry pattern is unreliable enough to raise concern about the borehole, pump, power, sensor, or communications path
- this can also reflect repeated downtime-like behaviour or data-health issues

Suggested action:
- check telemetry integrity first
- then inspect field conditions, power, communications, and pump status

### 6. Insufficient data

Meaning:
- there is not enough recent trustworthy activity to support a confident interpretation
- the borehole may be inactive, telemetry-poor, or simply not analyzable in the current window

Suggested action:
- avoid over-interpretation
- improve telemetry coverage or collect more field evidence before drawing conclusions

---

## Rule order

The current interpretation layer applies categories in this general order:

1. insufficient data
2. unreliable or possible fault
3. declining performance
4. stressed
5. high-use but stable
6. healthy and stable

This ordering keeps stronger caution states from being hidden by a simpler label.

---

## Main rule inputs

The interpretation logic currently uses the following inputs from the experimental analytics pipeline:

- analysis readiness tier
- active-day share
- total observed abstraction volume
- event frequency
- median valid specific capacity
- maximum observed drawdown
- downtime proxy share
- data unreliability index
- stress flag and stress reasons
- performance decline flag

---

## Transparent decision logic

### Insufficient data

Assign when:
- the site falls into the lowest readiness tier, or
- there is essentially no recent activity and no reliable recent evidence for interpretation

### Unreliable or possible fault

Assign when:
- the unreliability index is high, or
- the downtime proxy share is very high in the current review window

### Declining performance

Assign when:
- the performance decline flag is active based on the rolling comparison with the recent baseline

### Stressed

Assign when:
- the stress flag is active, or
- maximum drawdown is elevated, or
- valid specific capacity is weak even though the site is still active

### High-use but stable

Assign when:
- abstraction load or active-day share is high, but
- the site is not currently classified as stressed, declining, unreliable, or insufficient-data

### Healthy and stable

Assign when:
- the site has enough support for interpretation, and
- none of the higher-warning categories are triggered

---

## Maintenance and investigation priority

A simple priority score is also produced from transparent factors such as:

- category severity
- observed load
- downtime proxy share
- unreliability index
- elevated drawdown
- low specific capacity
- performance decline flag

This score is used only to help order the review queue.

Priority labels are:
- urgent investigation
- planned review
- watch list
- routine monitoring

---

## Important caution

These outputs are practical review aids.

They do **not** prove pump failure, aquifer damage, or service adequacy on their own. They should always be interpreted alongside local operational knowledge and field context.
