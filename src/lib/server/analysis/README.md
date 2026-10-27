# Steady-state AFR/VE sample screening

`classifySampleEligibility(session, overrides)` is deterministic and does not mutate
the session. It returns version `steady-afr-ve-v1`, the complete applied profile,
channel resolutions, per-sample check states, structured reasons/thresholds/evidence,
and counts. References are zero-based **parsed rows**, not original file lines.

Status precedence is `hard-excluded`, `heuristic-excluded`, `indeterminate`, then
`eligible`. Reasons are retained even when another category wins. Per-reason counts
overlap; the four status counts partition all rows. Missing quantities never become
zero. Enabled checks with insufficient evidence are `unassessed`, not passed. A
sample is eligible only if all enabled checks pass, including steady-history time.

## Hard exclusions

- Time must be resolved in explicitly declared seconds, and finite.
- RPM, manifold pressure (kPa), and measured AFR must be resolved, finite, positive.
  Zero RPM is unusable engine-stopped evidence, not a fuel-cut diagnosis. Lambda
  cannot stand in for AFR without an explicit fuel-specific conversion convention.
- Finite timestamps must exceed the maximum preceding finite timestamp. Duplicates,
  reversals, and samples still behind that high-water mark are excluded.
- A known `StitchPoint` boundary is excluded. Derivatives/history cannot cross it.

## Configurable initial profile

These are engineering starting points, **not universal validity or safety limits**.
Validate/tune them against the engine, sample rate, sensor noise, and investigation.
This task did not fit thresholds to maximize coverage of the supplied logs.

| Key                               | Initial value      | Passing condition                                    |
| --------------------------------- | ------------------ | ---------------------------------------------------- |
| `minCoolantC`                     | 70 °C              | Coolant ≥ minimum                                    |
| `maxWarmupCorrectionDeviationPct` | 1 percentage point | Absolute deviation from 100% ≤ limit                 |
| `maxAbsTpsRatePctPerSec`          | 5 %/s              | Absolute TPS rate ≤ limit                            |
| `maxAbsMapRateKpaPerSec`          | 10 kPa/s           | Absolute MAP rate ≤ limit                            |
| `maxAbsRpmRatePerSec`             | 200 rpm/s          | Absolute RPM rate ≤ limit                            |
| `maxGapSec`                       | 0.5 s              | Adjacent interval ≤ limit                            |
| `steadyWindowSec`                 | 1 s                | Duration of a contiguous passing run ≥ limit         |
| `possibleFuelCutMaxPulseWidthMs`  | 0.1 ms             | Exclude only when PW ≤ this, RPM ≥ 1200 and TPS ≤ 2% |
| `possibleFuelCutMinRpm`           | 1200 rpm           | Configures the possible-cut conjunction              |
| `possibleFuelCutMaxTpsPct`        | 2%                 | Configures the possible-cut conjunction              |

Nullable thresholds set to `null` disable their check. `steadyWindowSec: 0` disables
the dwell check. Disabling a check means the evidence was not required; it does not
prove that operating condition was acceptable. Hard exclusions cannot be disabled.
Configuration keys, nullability, finite values, and nonnegative duration/rate limits
are validated. The gap limit must be positive when enabled.

Rates use logged TPSdot/MAPdot where available **and** backward differences of
normalized TPS/MAP/RPM with actual elapsed seconds. Either available rate can fail
its check. If one source is missing, the other can support the check. No source
means unassessed. RPM rate is derived; RPMdot aliases are not silently assumed.
No differences are taken across invalid core samples, time-order breaks, stitch
seams, or configured gaps. Logged rate samples can still be reported at those rows,
but boundary exclusions remain. Rate evidence distinguishes logged measurements
from derived values and includes the previous row/value and elapsed seconds.

Any hard failure, heuristic failure, or unassessed check resets steady history.
The dwell check itself does not reset it. History starts at the first subsequent
sample passing all other checks; the first sample can lack derivative evidence.
At a seam this intentionally costs an additional sample before history starts.
Only past/current data are used; requested tool windows do not truncate history.

Possible fuel cut is a **hypothesis** based on primary PW, RPM and TPS, never lean
AFR alone. Missing support is unassessed. No ECU status bitfield is decoded without
its documented meaning, and secondary/staged injection prevents claiming primary
PW alone confirms total fuel delivery. Sensor saturation/accuracy, AFR transport
delay, afterstart enrichment, and other correction channels are not yet screened.

`LogSession` gap detection uses a different heuristic; its `DroppedFrames` labels
are not silently promoted to hard exclusions here. The classifier applies the
explicit `maxGapSec` profile instead. Existing parser timestamp repair and skipped
malformed rows still lack original-file provenance. Thus eligible is a screening
candidate, not validated steady-state evidence or a VE recommendation.

## Analytical tool

`assess_sample_eligibility({startSec,endSec,maxSamples?})` uses
`InvestigationContext.eligibilityProfile`. Threshold changes belong to the caller,
not model arguments. It returns the applied config, full-log/window counts, mappings,
and at most 20 sample details within a 32 KB detail budget. Omitted details are
counted; classification counts include every selected row. Invalid-time rows cannot
be located in a window and are separately counted. Classification runs over the
entire log before selecting inclusive parsed-time bounds. No VE corrections or UI
changes are included.

Run targeted checks with `npm test -- tests/sampleEligibility.test.ts
tests/sampleEligibility.real.test.ts tests/investigation/eligibilityTool.test.ts`.
Real-log checks verify coverage accounting, observed warmup corrections, and engine
stops; they do not establish ground-truth steady-state labels or optimal thresholds.
