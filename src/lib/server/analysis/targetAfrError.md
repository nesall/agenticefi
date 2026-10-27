# Deterministic target AFR error analysis

`analyzeTargetAfrError({ session, targetAfrTable, veTable, eligibility })` is a pure,
offline analysis. It accepts the existing V1 or experimental V2 result without
rerunning either classifier. Defaults, thresholds, analytical tool interfaces and
dashboard behavior remain unchanged. Shared output contracts are in
`src/lib/shared/types/targetAfrError.ts`.

Each calibration input extends `TunerStudioTableMetadata` from the existing XML
importer with explicit semantics and a source identifier:

```ts
const targetAfrTable = {
	...importTunerStudioXml(targetXml),
	sourceId: 'block1/AFR calibration',
	xQuantity: 'engineSpeed',
	xUnit: 'rpm',
	yQuantity: 'manifoldPressure',
	yUnit: 'kPa',
	valueUnit: 'AFR'
} satisfies AnalysisCalibration<'AFR'>;
// Bind the imported VE table the same way, using valueUnit: 'VE'.
```

Axis labels such as `afrload1` and `fuelload` are preserved but are not inferred
to mean MAP. The caller must confirm their semantics and calibration association.
RPM, MAP and measured AFR use existing channel normalization, with original
resolution/unit evidence retained. Lambda is not substituted for measured AFR.

## Strict interpolation and status

Target lookup uses bilinear weights on the target table's own axes. VE membership
uses the VE table's axes independently. Both require at least two finite,
increasing breakpoints per axis. Configuration errors fail early.

The numerical lookup does not call or change `Table2D.sample()`, whose clamping
behavior remains available elsewhere. Minimum and maximum coordinates are
inclusive. Any coordinate beyond an axis returns an explicit out-of-bounds
result, including the queried value and offending axis limits. No extrapolation,
clamping, padding or tolerance expansion is performed.

Coordinate status is `ok`, `missing-input`, or `out-of-bounds`. Target value status
is separate: `available`, `not-looked-up`, `missing-cells`, `invalid-target-afr`, or
`nonfinite-result`. Thus an in-bounds coordinate can still have unavailable target
data. All four corner indices, values and weights are retained for in-bounds
queries. Only strictly positive weights require finite, positive target AFR;
missing or invalid zero-weight neighbors do not invalidate an exact knot or edge.
Unavailable values are JSON-safe `null`, never zero.

An internal knot belongs to the interval above it; an outer maximum belongs to
the final interval with fraction one. Neighborhoods are row-major MAP by RPM.
VE values are not needed for this geometric grouping; this analysis performs no
VE-value interpolation or correction. Missing target values remain unavailable.

## Errors, aggregation and coverage

Per-row error is **measured AFR minus interpolated target AFR**. A positive error
means higher AFR than target. Computable errors on excluded samples are retained
for diagnostics, with original eligibility status and reason codes. Such rows do
not contribute to summary statistics.

A contributor must be eligible, have a valid measured AFR/target/error, and lie
within a VE neighborhood. Each contributes once to exactly one neighborhood,
without splitting its error among VE corner vertices. The overall statistics
summarize these same contributors; eligible errors outside the VE domain remain
visible in counts and rows but are not included in those statistics.

Every neighborhood, including empty ones, reports:

- Considered, eligible, excluded, valid-error, eligible-valid-error and grouped
  counts, plus target/VE/error status counts. Diagnostic valid-error counts may
  include excluded rows; grouped counts never do.
- Eligible/considered, eligible-valid-error/eligible and grouped/eligible fractions.
  A zero denominator produces `null`. Counts in neighborhoods cover only rows
  whose coordinates are inside the VE grid; overall counts also include outside
  and missing-coordinate rows.
- Mean, median, population standard deviation, Q25/Q75, IQR, unscaled MAD and
  minimum/maximum error. Each sample has equal weight; quantiles interpolate at
  `(n-1)p`. Empty statistics are `null`; a singleton has zero dispersion.
- Original supporting row indices for minimum, maximum and nearest median error;
  ties resolve to the lowest row index. Full telemetry/lookup evidence is retained
  in the per-row results.

Grid coverage is occupied neighborhoods / all VE neighborhoods. Neither grid nor
sample coverage establishes accuracy, statistical independence or confidence.
Samples and overlapping eligibility windows can be strongly correlated.

## Delay and limitations

`afrSensorDelayMsToImplementLater(rpm, mapKpa)` always returns zero. Results label
this as `unimplemented-zero-placeholder`; no interpolation in time, sample shifts
or compensation are performed. Implementing a validated delay model is later work.

V1 uses its complete row domain; V2 respects its original partition and row
indices. Analysis checks partition completeness, unique ordered indices and
matching parsed timestamps. Existing eligibility contracts lack session identity,
so the caller must provide results from the same unchanged session; timestamp
matching alone cannot prove identical telemetry. Source identifiers likewise
describe caller-supplied calibration provenance, not independently verified hashes.

Finite but unrepresentable numerical results become explicit unavailable values;
statistics that overflow their representable range are `null`. Calibration target
error alone does not establish the cause of a fueling difference. Delay, sensor
accuracy, ECU target switching and other operating effects remain unvalidated.
No VE corrections, tuning predictions, classifier changes or UI changes are included.

Numerical tests cover irregular axes, all corners/edges, strict outside bounds,
weighted and zero-weight missing cells, invalid targets, exact knot membership,
statistics, ties, empty domains, V1/V2 alignment and non-mutation. Existing AFR/VE
XML fixtures exercise their distinct axes, and the associated April block1 log is
checked with both classifiers.
