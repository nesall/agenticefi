# Experimental steady AFR/VE eligibility

`classifyExperimentalEligibility(session, { categorical, config, baseConfig, partition })`
returns `steady-afr-ve-v2-experimental`. It is an opt-in offline classifier. The
dashboard, analytical tools, numeric parser and `steady-afr-ve-v1` remain unchanged.
`parseMslWithEligibilityEvidence(decodedContent, sourcePath)` returns the ordinary
parsed session plus a session-bound categorical sidecar. Decode legacy files with
`decodeMsl` first. Do not supply evidence from a cropped, stitched or different session;
the sidecar must be rebuilt/aligned for that session.

## Fixed initial experiment

These engineering defaults need engine/logger/sensor validation; they are not
universal steady-state limits. Every threshold is configurable and returned with
the result. Base thresholds retain V1 defaults (coolant 70°C, warmup correction
within 1 percentage point of 100%, TPS rate 5%/s, MAP rate 10 kPa/s, time gap 0.5 s,
numeric possible cut PW ≤0.1 ms AND RPM ≥1200 AND TPS ≤2%). Nullable V1 base checks
can still be disabled explicitly. The V1 dwell setting is recorded but not used by V2.

| Experimental control            | Initial value |
| ------------------------------- | ------------- |
| `rpmMethod`                     | `windowed`    |
| `windowAlignment`               | `centered`    |
| `windowSec`                     | 1 s           |
| `maxAbsSlopeRpmPerSec`          | 200 rpm/s     |
| `maxCentralSpreadRpm`           | 100 rpm       |
| `maxRangeRpm`                   | 150 rpm       |
| `maxAdjacentJumpRpm`            | 50 rpm        |
| `minObservations`               | 9             |
| `maxObservationGapSec`          | 0.2 s         |
| `maxEndpointBracketSec`         | 0.1 s         |
| `requireFuelCutEvidence`        | true          |
| `requireOverrunFuelCutEvidence` | true          |

The 2×2 comparison crosses adjacent/windowed RPM with trailing/centered support.
All four controls use the same support, pointwise boundary and categorical guards.
The adjacent controls require each support point's V1 RPM check to pass (absolute
backward rate ≤200 rpm/s by default). They are **not V1**: V1 is an additional,
untouched reference with its original trailing dwell and evidence requirements.

For a windowed control, compute the median of **all** pairwise RPM/time slopes
(Theil–Sen), Q90−Q10 of RPM, and max−min RPM. Quantiles use linear interpolation at
index `(n−1)p`. All three magnitudes must satisfy their limits, inclusively. A
consistent 300 rpm/s acceleration/deceleration fails; a good line fit alone never
establishes stability. Small drift within the explicit limits may pass.

Requested support is `[t−1,t]` or `[t−0.5,t+0.5]`. Include the nearest real
observation at/before the start and at/after the end, each within 0.1 s. Report
requested and actual endpoints, row indices, observation count, and metrics. Do
not pad, interpolate observations, shrink edge windows, or add a second dwell.
Insufficient support is indeterminate. Centered support is retrospective and
cannot be used as a causal online decision.

## Boundaries and evidence

Reuse V1's core, normalized units, warmup, TPS/MAP, numeric possible cut, global
timestamp high-water and stitch checks. Required missing evidence blocks support.
Invalid timestamps, gaps, excluded operating transitions, active categorical cuts,
required unknown cuts, and numerical RPM jumps partition support. A jump is a
finite positive RPM pair differing by **more than** 50 rpm across a supported time
interval; missing RPM never becomes a jump. `RPM_JUMP_BOUNDARY` remains on that
sample even though no window can be formed there.

Partitions use inclusive `startRow`, exclusive `endRowExclusive`; outputs retain
original row indices. Derivatives cannot use observations before the partition.
The global V1 high-water audit still detects pre-partition timestamp inversions.
Windows cannot cross partition bounds. To avoid backward derivative evidence from
an excluded predecessor, the first point after a blocked transition cannot serve
as support. Segmentation uses fixed pointwise rules, never neighboring window
results, so window failures do not recursively erase the log.

Raw `status: Fuel Cut` and `status: Overrun Fuel Cut` are preserved separately,
including raw token and original source line. Recognized tokens are case-insensitive
`Active` / `Inactive`; other tokens (including empty cells) are unknown. Missing
channels or omitted sidecars are absent. Duplicate named categorical channels are
rejected. Sidecar extraction follows the numeric parser's metadata, marker,
wrong-width and empty-cell row acceptance and checks alignment.

- Active: heuristic exclusion and support boundary, even when not required.
- Inactive: clears only that categorical guard. It does not override warmup,
  transients, numeric possible fuel cut, or another guard.
- Unknown/absent and required: indeterminate and support boundary.
- Unknown/absent and optional: explicitly unassessed, nonblocking; never a pass.

Base reasons retain original structured thresholds/evidence. Experimental reasons
have a category, blocking flag and evidence; full configurations accompany every
result. Categorical observations also remain present for inactive/pass cases.
Reason counts overlap; statuses partition the samples. A base heuristic failure
outranks unsupported window evidence, and a hard exclusion outranks both.

## Verification and scope

`npm test` includes mathematical/synthetic tests, V1 regressions, and the four-log
2×2 comparison. The existing large parser fixture check has a 30-second test budget;
its deep-equality assertion is not a parser performance benchmark. The four original logs under `data/logs`
and their VE tables must be available. No packages are required beyond existing dependencies.

To regenerate the comparison artifact in PowerShell:

```powershell
$env:WRITE_ELIGIBILITY_V2_REPORT = '1'
npx vitest run tests/sampleEligibilityV2.real.test.ts
Remove-Item Env:WRITE_ELIGIBILITY_V2_REPORT
```

See `reports/steady-afr-ve-v2-comparison` for actual axes, per-neighborhood and
band coverage, status/reason counts, V1 transition matrices, 2×2 factor comparisons,
representative changed intervals and complete V1 output fingerprints.

Eligibility is screening, not demonstrated accuracy. No VE corrections, AFR delay
compensation, frontend analysis or dashboard changes are included. Primary PW
alone cannot establish all injector/ECU states. Skipped malformed rows and the
existing parser's first-time repair remain limitations of numeric provenance.
Do not promote the experiment or tune thresholds to maximize acceptance without
independent reviewed intervals and time-separated validation.
