# API capabilities in plain English

This note explains the current SiteMonitor integrations in practical terms for product, operations, and monitoring teams.

Last reviewed: 2026-04-18

---

## Overview

SiteMonitor currently uses two external monitoring APIs:

1. **DCP Water API v2**
2. **SonSetLink Technical API**

They are both useful, but they are not equal in structure or analytical strength.

---

## 1. DCP Water API v2 — the stronger analytical source

### What it gives the system

DCP provides the cleaner, more structured telemetry source in this repo.

In practice, the dashboard uses it for:
- borehole and site inventory
- map locations
- recent activity indicators
- hourly flow history
- hourly water-level-above-pump history
- event-based drawdown and specific-capacity calculations

### Why it matters

Because DCP gives both discharge and groundwater-response data on a proper time series, it is the better fit for:
- historical review
- trend charts
- pumping-event detection
- drawdown analysis
- specific-capacity screening

### Best way to think about it

If the question is **How did the borehole behave while pumping?**, DCP is the API the current architecture trusts most.

### Main cautions

- the frontend still makes many per-well calls, which can get slow at larger scale
- there is no automatic retry logic yet
- the current implementation only uses a small subset of the available parameter catalog

---

## 2. SonSetLink Technical API — the useful screening source

### What it gives the system

SonSetLink currently provides:
- site and device inventory
- country and location text
- recency or freshness indicators
- daily flow totals
- cumulative flow counters
- slot-array sensor values that can be interpreted as coarse depth patterns

### Why it matters

This API is valuable for:
- seeing whether sites are active
- checking whether water is still being produced
- comparing use between sites
- spotting devices that may need follow-up
- adding more field coverage to the dashboard

### Best way to think about it

If the question is **Which sites look active, inactive, or unusual?**, SonSetLink is very useful.

If the question is **What exactly happened hour by hour during pumping?**, it is much less reliable than DCP in the current setup.

### Main cautions

- endpoint behavior is still device-specific
- some devices only respond on one of several fallback tables
- timestamps are less explicit
- depth information is approximate rather than truly hourly
- event rows derived from SonSetLink should be treated as screening outputs, not formal hydrogeological evidence

---

## The biggest architectural difference

### DCP
- behaves more like a normal telemetry API
- cleaner for code and analytics
- better for event detection and groundwater response interpretation

### SonSetLink
- behaves more like a family of device-specific technical endpoints
- requires fallback probing and more inference
- better for broad operational coverage than for rigorous event analytics

---

## How the current system uses them together

The architecture already follows a sensible split:

- **DCP** is the primary analytical source
- **SonSetLink** is the complementary operational and screening source

That is why the dashboard can combine both in one view without pretending they have the same resolution or certainty.

---

## Recommended common structure for future APIs

Any future API added to SiteMonitor should be documented in the same pattern:

### For each new API, record:
- what it is for
- how auth works
- which exact endpoints the app uses
- what request parameters are sent
- what the response shape looks like
- which fields matter to the product
- how timestamps and timezones behave
- whether it is good for real-time use, historical analysis, or both
- what its limitations and risks are
- which parts of the code depend on it

### Practical rule

A future API should not just be described as “connected.” It should be classified as one of these:

- **inventory source**
- **operational status source**
- **historical telemetry source**
- **event-analysis source**
- **screening-only source**

That makes it much easier to add more providers later without confusing their roles.

---

## Recommended operating principle

When future APIs are added:

- keep the same documentation template
- label inferred behavior clearly when formal docs are missing
- separate “high-confidence analysis sources” from “screening-only sources”
- document the exact code touchpoints immediately, not later

This will keep the system understandable as the integration count grows.