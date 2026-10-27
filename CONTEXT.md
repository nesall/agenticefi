# AgenticEFI — Project Context

## Vision

Build an autonomous, evidence-driven EFI datalog investigator that helps engine tuners understand fueling problems and evaluate potential VE table improvements.

**Core differentiator:** An AI agent that knows when NOT to trust the data.

## Hackathon

Meta Global AI Developer Hackathon 2026 — Indie Developer track.

- Development: October 27 – November 4, 2026.
- Submission deadline: November 4, 9 PM EST.
- Theme: Build for Your World.
- Runtime AI: Meta Muse Spark through Meta Model API [potentially pluggable Meta models with a choice].
- The submission must demonstrate genuinely new functionality built during the hackathon.

## Input Data

- MegaSquirt `.msl` datalogs.
- Existing VE table.
- Existing target AFR table.
- Available real-world data: one approximately one-hour Mazda RX-7 drive log and several shorter 2–5-minute logs.

Actual telemetry channels, units, table formats, and sample rates must be discovered from the provided files rather than assumed.

## Core Capabilities

1. Import and inspect datalogs and tuning tables.
2. Visualize telemetry with synchronized time-series charts.
3. Detect potentially interesting operating conditions and anomalies using deterministic analysis.
4. Allow Muse Spark to investigate data through structured analytical tools.
5. Distinguish steady-state samples from transients and other unreliable evidence.
6. Evaluate bounded VE correction candidates using trustworthy samples.
7. Compare agent-driven recommendations against a deterministic baseline.
8. Produce an evidence-backed report with charts, tool traces, exclusions, confidence indicators, and advisory recommendations.

## Agent Responsibilities

Muse Spark should:

- Decide which analytical tools to call.
- Investigate anomalies and formulate testable hypotheses.
- Request additional evidence when appropriate.
- Identify limitations and insufficient data.
- Explain conclusions using actual telemetry evidence.

Muse Spark must not fabricate sensor values or perform numerical tuning calculations itself when deterministic tools are available.

## Evaluation

- Use time-separated training and held-out log data.
- Compare baseline and agent using consistent sample eligibility and coverage reporting.
- Report sample counts, AFR error metrics, and uncertainty.
- Distinguish predicted AFR improvements from real-world validation.
- Do not claim improved engine performance without a subsequent measured test.

## User Experience

A browser-based engineering dashboard featuring:

- Datalog upload and a built-in demo log.
- Telemetry timeline and event markers.
- AFR/VE analysis heatmaps.
- Visible agent investigation steps.
- Evidence-linked findings and recommendations.
- Advisory report/export.

## Non-Goals

- Direct ECU communication or writing.
- Fully automated vehicle tuning.
- Guaranteed engine safety or performance improvements.
- A generic AI chatbot.
- Reimplementation of the existing Phenix LogView application.

## Prior Work

The developer previously created Phenix LogView, an independent C++ MegaSquirt datalog analysis application.

AgenticEFI is a new hackathon project focused on autonomous, tool-driven investigation. Its implementation and new contributions must be clearly distinguished from prior work.

## Deployment

- Development: Windows MERTUN, MSYS2 UCRT64.
- Production: Node.js on a VPS.
- Meta API credentials remain server-side.
- Provide a reliable demo dataset and a clearly labeled recorded demonstration fallback.

## MVP Success

A real RX-7 log is loaded; Muse Spark autonomously investigates suspicious behavior using analytical tools, identifies unsuitable evidence, evaluates defensible VE adjustments, and produces an explainable report with measurable predictive evaluation.
