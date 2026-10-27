# VE evaluation, Phase A

This offline module prepares immutable evidence and predicts the conditional
effects of **manually supplied** correction vectors. It does not fit or select
corrections, implement an optimizer, change classifiers, modify calibration
inputs, export an ECU tune, or change the dashboard.

```ts
const dataset = prepareVeEvaluationDataset({
	session,
	targetAfrTable, // AnalysisCalibration<'AFR'> from the existing XML importer
	veTable, // AnalysisCalibration<'VE'>; caller confirms RPM / MAP-kPa semantics
	eligibilityProfile: { version: 'steady-afr-ve-v1' },
	categorical // original session-bound raw flags; needed by default V2 guards
});
const baseline = createManualVeCandidate(dataset, []);
const baselineEvaluation = evaluateVeCorrectionCandidate(dataset, baseline);

// Only if this specific cell passes training evidence gates:
const manual = createManualVeCandidate(dataset, [{ rpmIndex: 3, mapIndex: 4, percent: 1.5 }]);
const prediction = evaluateVeCorrectionCandidate(dataset, manual); // holdout
```

V2 is selected with `version: 'steady-afr-ve-v2-experimental'`. Optional `config`
and V2 `baseConfig` explicitly override the existing classifier configuration;
omitting them preserves existing defaults. Preparing a dataset runs fresh existing
classifiers, avoiding acceptance of a detached eligibility result from a different
session. V1 and V2 should be evaluated separately with frozen choices.

## Contracts and identity

Shared contracts are in `src/lib/shared/types/veEvaluation.ts`. Dataset, candidate
and evaluation outputs are deeply readonly in TypeScript and recursively frozen
at runtime. They contain detached plain JSON-compatible snapshots, not mutable
`Table2D` or `LogSession` references. Original inputs remain mutable and unchanged.

The dataset records original target/VE axes, values, source identifiers and unit
bindings; full classifier configurations; per-row AFR/eligibility evidence;
strict VE interpolation; episodes/partitions; and training-only cell evidence.
Session and table SHA256 fingerprints and a complete dataset content ID bind the
artifacts. The session fingerprint includes telemetry, units, mapping, time index,
discontinuities and raw categorical evidence. Nonfinite source numbers are hashed
distinctly. Candidate IDs bind the dataset, percentages, vector and resulting table.

Prediction verifies fingerprints and reconstructs serialized candidate contents
to recheck bounds, support and table/vector consistency. These are content checks,
not signatures or independent verification of calibration association. JSON
round-trips are supported; modified artifacts are rejected. Do not treat these
server-side objects as an untrusted public API without additional input validation.

## Strict VE interpolation and model

At each eligible observation, original interpolated VE and its row-level relative
cell influences are:

```text
V_i = sum_j(w_ij * V_j)
a_ij = w_ij * V_j / V_i
```

The four `w_ij` are the usual bilinear weights from actual VE axes; `a_ij` are
relative fuel influences, which differ when corner VE values differ. Both are
retained. In bounds, the outer edges are inclusive and internal knots use the
upper neighborhood. There is no extrapolation, clamping, grid resampling or
epsilon expansion. Every positive-weight original VE corner must be finite and
positive. Missing zero-weight corners are visible but unused.

Manual percentages define fractional changes `delta_j = percent_j / 100`:

```text
V'_j = V_j * (1 + delta_j)
V'_i = sum_j(w_ij * V'_j)
predicted_AFR_i = measured_AFR_i * V_i / V'_i
```

Thus a shared cell affects all adjacent interpolation neighborhoods. Predictions
use the actual candidate table, without distributing a neighborhood's AFR error
independently to its four corners. Zero changes reproduce baseline AFR exactly.
Omitted cells and unsupported cells retain their original values, including
missing cells. Nonzero changes to unsupported cells, duplicate cell entries,
invalid indices, nonfinite percentages and out-of-bound changes are rejected;
percentages are never silently clipped or rounded to ECU precision.

The model assumes unchanged air mass and other fueling factors, with delivered
fuel proportional to interpolated VE. Its outputs are **predictions**, never
measured AFR improvements. AFR sensor/transport delay remains explicitly
unimplemented at zero; no observation is time shifted.

## Episodes and leakage

Episodes are formed from full-log eligibility before fitting or inspecting AFR
error magnitude. A complete contiguous accepted run is never split just to meet
a training fraction. Nearby runs are merged within the same time-integrity segment,
irrespective of RPM/MAP neighborhood. Invalid timestamps, high-water reversals,
stitches and excessive raw observation gaps prevent episode merging.

An earliest-training/latest-holdout boundary is selected nearest the requested
chronological fraction, with ties choosing the earlier boundary. The boundary
score is distance between the requested time and the midpoint of the training-end /
holdout-start gap. Whole intermediate episodes are embargoed when necessary.
Actual ranges and the actual gap are returned. A single episode, or no admissible
separated episodes, yields `insufficient-separated-episodes`; no row or cell is
forced into training/holdout support.

V2 is recomputed using its existing partition interface, and actual support rows
(including backward derivative predecessors) are checked against that partition.
V1 remains unchanged and causal: the evaluator requires an internal predecessor
and a full configured steady-history duration elapsed inside the partition before
admitting a row. Boundary exclusions are recorded as `PARTITION_SUPPORT_LEAKAGE`;
they do not rewrite classifier results. The full-log timestamp high-water audit
is retained for both profiles. Rows are never sorted, rebased or imputed.

This grouping and embargo reduce direct leakage; they do not prove that episodes
are independent. Freeze the partition and manual vector before inspecting holdout
metrics. Repeated manual edits based on holdout outcomes consume that holdout as
development data and require a new final evaluation period.

## Configurable initial evidence gates

`config` passed to preparation overrides these defaults; all values are recorded
in the immutable dataset. These are engineering starting points, not validated
universal engine limits. No thresholds are adjusted automatically for coverage.

| Control                      | Default |
| ---------------------------- | ------: |
| `trainingFraction`           |     0.7 |
| `episodeMergeGapSec`         |    10 s |
| `embargoSec`                 |    10 s |
| `maxObservationGapSec`       |   0.5 s |
| `maxCorrectionPct`           |      3% |
| `minTrainingSamplesPerCell`  |      50 |
| `minTrainingEpisodesPerCell` |       3 |
| `minEpisodeSupportSec`       |     2 s |
| `minRelativeInfluence`       |    0.10 |

Only **ready training rows** contribute to cell evidence. A materially influenced
sample has `a_ij >= minRelativeInfluence`. A qualifying episode supplies a
continuous run of material samples lasting at least `minEpisodeSupportSec`;
duration is not inferred from a first-to-last span across missing/excluded rows.
All nonzero training influences also contribute to reported influence mass.
Unsupported status lists specific invalid-value/sample/episode reasons. Holdout
coverage cannot qualify a cell. Support describes coverage, not identifiability,
confidence or proof that a correction is appropriate. Rank/conditioning checks,
robust fitting and leave-one-episode-out fitted correction intervals belong to Phase B.

## Paired evaluation and coverage

Prediction accepts `partition: 'holdout'` by default, or explicit `'training'` for
training diagnostics. It always uses **all ready rows** in that partition, including
unchanged and worsened rows. Baseline AFR is the original measured AFR. Both errors
use the same per-row interpolated target:

```text
baseline_error = measured_AFR - target_AFR
candidate_error = predicted_AFR - target_AFR
```

Results include paired MAE/RMSE and signed error statistics, candidate-minus-baseline
metric differences, an additional affected-only view, and episode/neighborhood
breakdowns. Counts, training evidence, support ranges, and explicit exclusions are
retained. Every neighboring interpolation region touched by a changed cell is
reported; regions lacking affected evaluation observations are `unassessed`.
Descriptive dispersion and episode variation are not confidence intervals.

Numerical prediction failures retain their rows and original denominators. If
any prediction in a group fails, that group's candidate metrics and paired deltas
are unavailable rather than computed on a selectively reduced subset. Baseline
metrics remain visible. Empty partitions return explicit empty metrics, not zeros.

## Verification and remaining limitations

Tests cover hand-calculated weights and shared influence, all boundaries, missing
and invalid corners, uniform/single-cell corrections, bounded manual vectors,
zero baseline, unsupported and holdout-only cells, whole-episode splitting,
embargo, V1/V2 support audits, snapshots/content binding, worse predictions,
unaffected observations, numerical failures and representative April telemetry.

Closed-loop compensation, injector staging/dead time, active ECU table selection,
AFR delay, sensor bias and calibration mismatch can invalidate the proportional
fueling model. Unsupported and unobserved neighboring regions remain uncertain.
There is no optimizer, automatic correction fitting or selection, confidence
estimation, calibration write, dashboard integration or claim of measured benefit.
Phase B can consume ready training rows, `a_ij`, and frozen cell-support masks to
fit a bounded vector, then reuse this unchanged prediction and holdout interface.
