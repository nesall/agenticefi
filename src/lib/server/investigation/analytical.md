# Caller-enabled analytical investigations

Legacy `runInvestigation(InvestigationContext, model, options)` retains its existing
tools and report contract. The dashboard now offers a separate explicit analytical
mode; see [dashboard integration](../dashboard.md). Independent analytical runs are
explicit server-side opt-ins:

```ts
const run = new AnalyticalRun({
	contextId: 'owner-authorized-log',
	logName: 'rx7.msl',
	logContent: decodeMsl(logBytes).content,
	calibrationId: 'confirmed-block1',
	calibrationSemantics: 'rpm-map-kpa-afr',
	veXml,
	afrXml,
	profile: { version: 'steady-afr-ve-v2-experimental' }
});
try {
	const result = await runInvestigation(run, new MetaResponsesModel(), {
		goal: 'Investigate supported AFR deviations and advisory VE candidates.',
		timeoutMs: 120000
	});
	// Server-side only, after authorizing the caller:
	for (const ref of result.analytical?.evidenceRefs ?? []) {
		const fullEvidence = await run.getEvidence(ref);
		// Review/persist under a caller-owned bounded retention policy.
	}
} finally {
	await run.dispose();
}
```

The caller selects one eligibility profile, preparation policy and fitting
configuration per run. Optional `preparation`, `fitting` and lowered `limits` are
caller-only settings, validated and frozen at construction. Defaults come from
the existing numerical modules. Log/XML strings are detached snapshots, parsed
inside the worker with the existing categorical sidecar. Changing caller objects
later cannot change the run. Profile comparison requires separate runs.

Missing XML or unconfirmed RPM/MAP-kPa/AFR semantics produce a verified
`unavailable` fact without substitutions. Malformed supplied XML is an error.
Calibration association remains caller-confirmed; axis names do not establish it.

## Tools and autonomy

Analytical mode exposes existing `describe_log`, `assess_data_quality` and
`summarize_window` inspections alongside:

| Tool                    | Arguments                                                                          | Behavior                                                                                                                                             |
| ----------------------- | ---------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `analyze_afr_error`     | Optional `neighborhoods` (1-8 VE interpolation neighborhoods), `rowIndices` (1-12) | Training-only summaries, counts, supporting original rows and `analysisRef`. Explicit training-row inspection can include excluded rows and reasons. |
| `fit_ve_candidate`      | Optional `analysisRef`, `cells` (1-8 VE vertices)                                  | Lazily prepares canonical evidence; fits once from ready training rows. Repeated calls inspect the cached fit.                                       |
| `evaluate_ve_candidate` | Required `candidateRef`; optional `neighborhoods`, `rowIndices`                    | Requires a finalized candidate; evaluates all fixed ready holdout rows once.                                                                         |

Selections change presentation, never fitting masks or evaluation membership.
There are no threshold, vector, profile, table-path or optimizer arguments.
Runtime validation rejects unknown keys, invalid/duplicate actual-axis indices,
oversized inputs and cross-run references. No data is cropped/resampled to fit
limits. The model may inspect regions, request omitted cells, discuss hypotheses,
and identify limitations. No-correction and worsened heldout results are valid.

The V1-only legacy `assess_sample_eligibility` is not advertised in analytical
mode; selected V1/V2 settings and evidence come from the canonical analytical
tools. Legacy investigations retain all four original tools.

Preparation, fitting and paired prediction reuse the existing deterministic
modules. AFR summaries call the same implementation through a read-only export.
Only filtering, grouping and presentation occur in the adapter; numerical
formulas, classifier defaults and fitting algorithms are unchanged. Default
regions are chosen by training coverage, not error magnitude or holdout outcome.

## Facts, commentary and provenance

Replies contain concise summaries, typed server-rendered `facts` and a
`fullEvidenceRef`. Full immutable datasets, all cell decisions, solver/fold
diagnostics and paired row membership remain in the private server worker.
Fitting replies list every non-unsupported cell index plus bounded details.
Truncated presentation has explicit omission counts; full evidence is retained.

References bind run/context/settings IDs, artifact kind and SHA256, dataset ID,
and candidate ID where applicable. `getEvidence` checks the private reference map
and full checksum and returns a detached frozen object. Foreign/wrong-kind
references fail. These are content checks, not authentication signatures: the
caller must authorize ownership before sharing a run handle. There is no new
public raw evidence route or global lookup. The dashboard obtains a bounded,
owner-scoped read-only projection inside the worker rather than full artifacts.

The model sees bounded summaries and trace snapshots, never raw logs, full
artifacts or API keys. Numerical facts bind successful trace evidence IDs to
their artifacts; fact IDs and trace evidence IDs differ. Trace mutation cannot
rewrite stored facts. Analytical final responses use:

```json
{
	"kind": "final",
	"factIds": ["returned server fact ID"],
	"commentary": [
		{
			"kind": "hypothesis",
			"text": "An explanation requiring additional evidence.",
			"evidenceIds": ["evidence-1"]
		}
	]
}
```

The runner renders authoritative findings only from known server facts, labeled
`server-numerical`. Model commentary is separate, labeled
`unverified-model-commentary`, and requires successful citations. Commentary may
be a hypothesis, limitation or interpretation; the label does not prove its truth.
Future consumers must preserve that distinction and cannot treat commentary as
authorization or measured evidence.

Missing-calibration, fit-status and complete paired MAE/RMSE facts are included
automatically when available, so a model cannot hide a zero candidate or select
only a favorable metric. Invented facts and model-authored authoritative claims
are rejected. Reports are `advisoryOnly`, include server-owned numerical
limitations, and authorize neither ECU writes nor automatic table application.
There are no ECU/write tools. AFR delay remains unimplemented at 0 ms.

## Resource bounds and cancellation

Caller limits may only lower these ceilings:

The response budget must remain at least 1024 bytes so bounded validation errors
can be returned. Error text and tool names are length-limited too; rejected calls
beyond the call ceiling do not grow retained timing metadata.

| Resource                                  |               Ceiling |
| ----------------------------------------- | --------------------: |
| Log / each XML bytes                      |       64 MiB / 64 KiB |
| Parsed rows / channels                    |          60,000 / 300 |
| Cells per table                           |                   256 |
| Training episodes / supported cells       |               64 / 32 |
| Fitting iterations                        |                 5,000 |
| Retained serialized evidence per run      |               128 MiB |
| Tool response / model turn or arguments   | 32,000 / 20,000 bytes |
| Calls per run                             |                    20 |
| Per-job timeout / idle evidence retention |     120 / 120 seconds |
| Resident workers per process              |                     2 |
| Worker old / young JS heap                |          512 / 32 MiB |

The old-generation worker heap defaults to 512 MiB. A caller can explicitly select
the bounded 1024 MiB tier with `workerHeapMb: 1024` on `AnalyticalRun`; only 512 and
1024 are accepted. The chosen tier is frozen into run settings and provenance.
The young-generation limit stays 32 MiB. This resource option does not change
classifier, preparation, fitting, artifact-byte or timeout limits. With two live
workers, the 1 GiB tier may reserve more than 2 GiB plus parent/native overhead;
it is a per-worker JS limit, not a process RSS cap.

Oversized work is rejected, not numerically weakened. Resource exhaustion,
timeout and cancellation do not trigger replacement fits or threshold changes.
Cancellation/job deadlines terminate the worker. Failures or disposal make its
evidence unavailable. Dispose completed runs after review; retained workers can
otherwise exhaust the two-worker capacity until expiry.

The analytical runner defaults to 60 seconds overall, up to 300 seconds by caller
request. Its model/iteration/call limits remain separate from per-job limits.
Legacy runner limits and behavior are unchanged.

## Benchmark and build

Workers were introduced only after synchronous benchmarks exceeded a 250 ms
event-loop budget: April V1 took about 0.766 s, July V2 about 7.368 s. Isolated
runs took about 0.971 s and 8.402 s including startup/parsing/preparation/fitting/
evaluation. Main-loop 10 ms heartbeat maximum gaps were about 20.5 ms and 19.4 ms.
These local timings are not deployment guarantees. JSON records are retained in
`reports/analytical-tools`; set `WRITE_ANALYTICAL_BENCHMARK=1` when running the
analytical test file to refresh isolated measurements.

The worker bundle uses existing Vite tooling, with no package installation.
`npm test`, `npm run test:agent`, `npm run dev` and `npm run build` build
`.analytical-worker/entry.cjs` first. Direct Vitest calls require
`npm run build:analytical-worker` after worker-source edits. Production must ship
this generated directory alongside the Node application and start from the
application root. No runtime TS loader or source-tree import is needed. A missing
bundle fails explicitly.

## Verification and deployment risks

### Explicit single live smoke with dataset/profile selection

`npm run test:agent:analytical:live` builds the worker and runs only
`tests/live/analyticalAgent.live.ts`. This makes real requests using the server
environment credential (`META_HACKATHON_API_KEY`, or fallback `META_API_KEY`).
Normal tests remain offline; the older live command still runs only its legacy test.
The default remains April V1. Select one dataset and profile per invocation:

```sh
npm run test:agent:analytical:live -- --dataset july --profile v1
npm run test:agent:analytical:live -- --dataset july --profile v2
npm run test:agent:analytical:live -- --dataset august --profile v1
npm run test:agent:analytical:live -- --dataset july --profile v1 --resilient
npm run test:agent:analytical:live -- --dataset august --profile v1 --resilient --worker-heap-mb 1024
npm run test:agent:analytical:live -- --help
```

| Dataset                             | Log        | Calibration                          |
| ----------------------------------- | ---------- | ------------------------------------ |
| `april`                             | 2025-04-12 | Bundled, confirmed block1 VE and AFR |
| `july`                              | 2026-07-25 | Confirmed block1 VE and AFR          |
| `august` (aliases `aug`, `august8`) | 2026-08-08 | Associated block2 VE and AFR         |
| `august1`                           | 2026-08-01 | Block3 VE only; AFR unavailable      |

July/August logs and block2/3 tables must exist in their original `data/logs`
directories. Missing sources (including the absent August 1 AFR calibration)
produce a `dataset-unavailable` report and failing test **before any API request**;
no other calibration is substituted. Unknown selectors and malformed CLI flags
also fail before network access. The launcher consumes `--dataset`/`--profile`
rather than forwarding unsupported flags to Vitest. V2 means the experimental
profile, with no comparison-based promotion or automatic profile selection.

The smoke launcher's `--worker-heap-mb auto|512|1024` defaults to `auto`: August 8
uses 1024 MiB; other selections use 512 MiB. The full August V1 preparation/fitting
path exhausted 512 MiB in an offline reproduction, while 1024 MiB completed fitting,
evaluation, and full evidence checksum checks in about 30–38 seconds. Phase-boundary
RSS samples reached approximately 1.05 GiB including the parent and retained evidence.
Measurements are saved in `reports/analytical-tools/august-memory-benchmark.json`;
they are not live model results or guarantees for V2/other machines. Explicit August
512 selection fails before loading or API access with `resource-limit`, rather than
entering the known failing configuration. The same August command without a heap
flag now selects the measured 1 GiB tier automatically.

Numerical preparation/fitting and selected classifier defaults remain unchanged. Limits are six tool
calls, seven model turns, 120 seconds overall, and the adapter's existing 4096
output tokens per response. The default diagnostic mode makes no retries: at most
seven HTTP attempts and 28672 output tokens across responses.

`--resilient` enables smoke-only retries for HTTP 429/500/502/503/504, at most two
per model turn (21 HTTP attempts / 86016 maximum output tokens across responses).
All attempts and waits share the original runner AbortSignal and 120-second
deadline; neither a model turn, tool call, nor whole investigation is restarted.
Backoff uses exponential delays with jitter (250–500 ms, then 500–1000 ms).
Valid `Retry-After` seconds or HTTP dates impose a minimum wait. If that minimum
exceeds the 10-second per-wait cap, the response fails immediately without retrying
earlier than requested. Authentication, other HTTP statuses, protocol errors,
ambiguous network failures, and deterministic tool failures are not retried.
The existing adapter and dashboard retry behavior are unchanged. Retrying POSTs
can consume resources or incur charges more than once; usage on failed attempts
may be unavailable, and this mode does not guarantee completion.

The model selects native calls and regions. Success requires all three analytical
tools, verified retained artifact checksums/identities, and a final report with
server facts separate from cited unverified model commentary. April V1's zero supported
cells, no-supported-proposal, and unchanged paired candidate are expected outcomes.
Other selections allow bounded supported corrections, suppressed/zero candidates,
worsened predictions, or empty holdout coverage. The test does not demand improved
metrics. Resource ceilings remain unchanged; larger August logs may hit existing
memory/artifact/time budgets and will not be cropped or weakened to pass.
Deterministic negative argument controls are explicitly separate from model calls.
Sanitized actual provider messages/calls, deterministic trace/facts, usage, timing,
and checks are written to `reports/analytical-tools/<dataset>-<profile>-live-smoke.json` even when
the run fails (e.g. `july-v1-live-smoke.json`, `august-v2-live-smoke.json`). This stable
path holds the latest result. Every execution also writes an exclusive archive
`<dataset>-<profile>-live-smoke-<UTC timestamp>-<report UUID>.json`, preserving prior
failures and successes even within one millisecond. Archives are not automatically
deleted; manage their disk usage locally. The earlier `april-live-smoke.json`
is left untouched.

The launcher also supervises the Vitest subprocess. If it exits without writing
the matching report UUID (including a fatal heap abort), the launcher writes a
`harness-process-failure` archive/latest report with exit status and signal. API
activity, usage, and exact cause are unknown in that fallback; no results are
invented and an older success cannot masquerade as the current execution. This
does not cover the OS killing the launcher itself or unavailable report storage.

`actualModelResponses` records each HTTP attempt with logical `modelTurn`, attempt
number, status, timing, retry decision/delay, and any allowlisted request/trace IDs
and valid `Retry-After`. Those IDs are absent if the provider does not send them.
Only the final attempt of each model turn determines terminal HTTP success; any
recovered errors remain visible in history and resilience counters. Provider
reasoning, request bodies/headers, secrets, and provider error bodies are not
recorded. Response headers are restricted to diagnostic IDs and `Retry-After`.

Usage sums retain all known input/output/cached/reasoning counts even if a later
attempt has no usage. `usage.status` is `complete`, `partial`, or `unavailable`;
per-field reporting/missing-attempt counts explain coverage. Partial totals are
observed usage, not complete billing estimates; absent values stay null and no
price is assumed. Validation checks have `passed`, `failed`, or `not-run` status:
an API interruption leaves dependent checks unexecuted rather than listing each
as another failure. Missing model-selected steps in a completed workflow still
fail validation. The console distinguishes `failedChecks` from `notRunChecks`.
Authentication/access, API/protocol failure and incomplete model workflows are
reported separately. Tool summaries and supporting telemetry excerpts are sent
to Meta; the existing adapter uses stored-response continuation. This integration
check neither validates tuning accuracy nor authorizes ECU writes.

Tests use real bundled workers and mocked Muse protocol responses. They cover
validation, lazy fitting/caching, missing calibration/semantics, no corrections,
worsened holdout metrics, cross-run references, checksums, settings snapshots,
fact tampering, unverified commentary, cancellation, resource limits, expiry,
capacity and legacy regressions. This is not a live Muse API validation.

Node worker threads/filesystem access are required; edge runtimes are unsupported.
JS heap limits do not bound total RSS: parsing, cloning and native allocations
add overhead. Multi-process deployments multiply per-process limits and do not
share evidence. Large/hour-long logs may exceed memory/evidence/time limits;
the system will not weaken numerical gates to make them fit.

Full evidence retrieval copies/checksums large objects on the main thread and is
intended for controlled server review, not model payloads or unrestricted public
downloads. The proportional-fueling model, calibration association, sensor/ECU
behavior, zero AFR delay and correlated-episode limitations remain unchanged.
