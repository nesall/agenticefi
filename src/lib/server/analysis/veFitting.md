# Deterministic VE joint fitting, Phase B

`fitVeCorrections(dataset, config?)` consumes the immutable Phase A dataset and
returns an immutable fit report plus a bounded candidate accepted by Phase A's
existing predictor. `fitAndEvaluateVeCorrections(dataset, config?)` first completes
and freezes fitting, then calls that predictor on the original holdout rows.
There is no feedback from evaluation into fitting or selection.

```ts
const fit = fitVeCorrections(dataset);
// Review fit.cells, fit.passes, fit.bounds and fit.limitations.
const evaluation = evaluateVeCorrectionCandidate(dataset, fit.candidate);
// Or: const { fit, evaluation } = fitAndEvaluateVeCorrections(dataset);
```

The shared report contract is `src/lib/shared/types/veFitting.ts`. No classifier
defaults, Phase A formulas, preparation/evidence gates, original tables, or
dashboard behavior are changed. The existing candidate artifact has a historical
`manual-ve-candidate-v1` version; Phase B uses its validation factory to publish a
fitted vector with identical bounds/unsupported-cell protections.

## Objective and shared cell influence

For ready **training** observation i, use Phase A's relative cell influence:

```text
a_ij = w_ij * V_j / V_i
b_i  = measured_AFR_i / target_AFR_i - 1
r_i  = sum_j(a_ij * delta_j) - b_i
```

Cell changes `delta_j` are fractions: 0.02 means +2%. Unsupported or suppressed
cells are fixed at zero. Their influence is not renormalized onto other cells.
All positive influence terms participate, including those below Phase A's
material-evidence threshold. That threshold remains solely an evidence gate.

For E training episodes and n_e ready rows in episode e, each row has weight
`q_i = 1 / (E * n_e)`. Thus duplicating samples within one episode does not increase
that episode's total weight. With m currently active cells, minimize:

```text
sum_i q_i * Huber_h(r_i) + (lambda / m) * sum_j(delta_j^2)

Huber_h(r) = 0.5*r^2                  when abs(r) <= h
             h*(abs(r) - 0.5*h)       otherwise

abs(delta_j) <= effectiveMaxPct / 100
```

The effective bound is the smaller of the requested fitting bound and the locked
Phase A dataset bound. Both and their intersection are reported explicitly.
Regularization shrinks corrections toward zero; it cannot establish evidence or
identifiability. This objective uses relative fueling residuals, not holdout AFR
error or a claim of measured engine improvement.

The solver is deterministic projected accelerated gradient descent with monotone
restart. A conservative gradient Lipschitz bound is computed from the weighted
row norms plus the ridge Hessian. Projection enforces the box **during** solving;
an unconstrained completed vector is never clipped afterward. It stops on
`max(abs(x - project(x - gradient))) <= gradientTolerance`. An iteration limit or
numerical failure suppresses the unfinished active fit. Inputs and outputs remain
unrounded floating-point values, not ECU-quantized calibration writes.

## Conditioning before regularization

Active cells sharing any positive row influence form connected groups. For each
group, construct `G = A' Q A` without ridge. Normalize its columns using
`D_jj = sqrt(G_jj)` and inspect `C = D^-1 G D^-1`. Zero columns remain zero.

Symmetric cyclic Jacobi eigenvalues provide:

- Rank: count eigenvalues greater than
  `maxEigenvalue * relativeRankTolerance^2` and greater than zero.
- Design condition number: `sqrt(maxEigenvalue / minEigenvalue)`, when full rank.
  This is the condition of the column-normalized weighted design, not its Gram
  matrix's condition number.

The eigen solver uses a fixed 1e-12 off-diagonal tolerance and at most 50 sweeps;
failure is reported and suppresses the group. A rank-deficient or ill-conditioned
group is suppressed as a whole. No cells are selected arbitrarily from its null
space, and ridge is excluded from this diagnostic. This conservative policy can
reject useful aggregate evidence that does not distinguish individual cells.

## Stability, freezing and refitting

Each pass checks the active groups and solves the full training objective. Zero
and sub-minimum proposals are frozen. For remaining proposals, omit each ready
training episode in turn, rebalance the remaining episode weights, recheck
conditioning, and solve the same bounded objective from zero.

Phase A's full-training sample and episode gates are never weakened. A leave-out
fold is a stress test of previously qualified cells, not a fresh candidate dataset;
it requires `minLooRemainingEpisodes` qualifying episodes per active cell instead
of reapplying the original three-episode gate to a two-episode fold. Missing fold
support suppresses the affected cells; unidentifiable fold groups are suppressed
as groups. An unfinished fold solve suppresses the active fit.

Complete folds must all have the same nonzero sign as the full-training proposal.
Their percentage-point range must not exceed `maxLooRangePct`. Fold minimum,
maximum, range and individual omitted-episode estimates are retained. These are
descriptive sensitivity diagnostics, not confidence intervals or a measured
probability of improvement.

Every suppression is permanent within a fit. Freeze it at zero and rerun the full
conditioning, optimization and leave-out checks on the remaining cells. This also
updates the ridge denominator m. Cells are never resurrected to improve coverage;
termination takes at most one accepted pass plus the number of initially active
cells. No final vector is accepted until its complete last-pass checks succeed.

## Initial configurable numerical policy

| Option                    |                          Default |
| ------------------------- | -------------------------------: |
| `maxCorrectionPct`        |                               3% |
| `huberThreshold`          | 0.02 fractional fueling residual |
| `ridgePenalty`            |                             0.01 |
| `maxConditionNumber`      |                             1000 |
| `relativeRankTolerance`   |                             1e-6 |
| `minCorrectionPct`        |                             0.5% |
| `maxLooRangePct`          |              2 percentage points |
| `minLooRemainingEpisodes` |                                2 |
| `maxIterations`           |                             5000 |
| `gradientTolerance`       |                            1e-10 |

These are explicit initial engineering/numerical choices, not validated engine
limits. They are not optimized from coverage or holdout outcomes. Ridge may be
explicitly set to zero for numerical experiments; the default is regularized.
Invalid settings are rejected. A valid fit can propose no changes.

## Diagnostics and holdout isolation

Every original cell reports accepted/suppressed/unsupported status; sample count,
qualifying episode IDs and influence mass; reasons; final percentage; and its
last full-training proposal/pass and bound flag. The final percentage is zero for
all unsupported or suppressed cells. `atBound` refers to the last full-training
proposal, including proposals subsequently suppressed. Each pass records its
active cells, conditioning, solver iterations/objective/projected gradient, fold
failures and frozen cells. Stability refers to that proposal pass; incomplete
folds retain null/unavailable estimates rather than fabricated ranges.

The fitting path selects only ready training rows. It does not call the predictor
or read holdout AFR for numerical decisions. Dataset fingerprint verification
necessarily reads the artifact to validate identity; this is not statistical use
of holdout outcomes. The separate `trainingFingerprint` records the mathematical
training inputs, masks, tables and configurations. Changing only valid holdout AFR
leaves it, fitted values, selection and numerical diagnostics unchanged, although
the Phase A dataset/candidate IDs necessarily change.

The one-way wrapper evaluates the final frozen candidate with Phase A's predictor,
on exactly the same holdout rows as the unchanged-table baseline. Prediction or
metric failures retain Phase A's explicit handling. Unchanged and worsened rows
remain included. Holdout outcomes never decide which proposal to keep or how to
adjust a threshold. Repeated manual choices based on the results consume the
holdout and require a new final evaluation period.

## Verification and limitations

Synthetic tests cover analytic ridge solutions, shared-cell coupled systems,
episode balancing, Huber outliers, active bounds, frozen influence, rank and
conditioning failures, loss of rank in leave-out folds, direction/range
suppression, refitting after freezing, solver iteration limits, unchanged Phase A
gates and holdout isolation. Real April and July block1 logs are smoke-tested with
their associated calibration under both unchanged V1 and V2 profiles. No smoke
test requires a nonzero proposal or treats acceptance as evidence of accuracy.

The proportional fueling model, zero/unimplemented AFR delay, sensor/ECU behavior,
calibration association and temporal correlation limitations from Phase A still
apply. Stable, identifiable numerical fits can still be physically wrong. There
is no automatic calibration application, ECU write, classifier/UI change, or
claim of measured improvement.
