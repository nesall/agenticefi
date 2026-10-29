# Analytical dashboard

Run `npm run dev`. Runtime preparation bundles the analytical worker and copies the
owner-confirmed August 8 block2 log/VE/AFR assets into private `.demo-assets` files.
April remains bundled as before. August is read lazily; no 66 MB log enters the
client bundle or generated JavaScript. Ship `.demo-assets` and `.analytical-worker`
alongside the Node deployment and start from the project root. Missing August
assets leave April available. No database or new dependencies are required.

## Three-minute demonstration

1. August 8 is selected by default; click Load to parse it explicitly. Initial
   page load fetches only the small dataset catalogue. The initial chart shows 60 seconds, within the
   existing 8,000-point limit. Full-log data remain available for analysis.
2. **Analytical Investigation**, V1 and **Live Muse Spark** are the initial options.
   The Options disclosure retains legacy mode, V2 experimental, recorded source and goal editing.
   The API uses server environment credentials only. Optional bounded retries
   share the same deadline. Click Run; completed tools appear during polling.
3. Telemetry & Screening contains synchronized charts, channel selection, quick
   windows and a compact V1 screening summary. Advisory VE Results contains the
   actual-axis VE delta grid, paired holdout predictions, findings and AFR regions.
   Completion reveals Results only if the user has not switched workspaces during
   the run. A global inspection drawer holds sample pagination, cell details,
   verified facts and the completed tool trace. Supporting row/time buttons return
   to the charts. Adjacent-region samples are representative, not proof of exact
   material influence on a selected cell.

Selecting a dataset and loading it are separate actions. A changed selection is
explicitly marked **not loaded**, and new investigations are blocked until Load
succeeds. After loading, previous chart/result data are cleared. Every job captures
its own log filename, calibration ID, demo ID and row count; result headers display
that run identity rather than inferring it from the current selector. Coverage is
validated against fit support counts; inconsistent evidence is withheld rather
than silently converted to zero. Regression fixtures preserve August V1's five
supported cells and April V1's legitimate zero without hardcoding either in the UI.

For an API-independent presentation choose **Recorded demonstration**. Runtime
preparation copies only successful, model-identified smoke snapshots from the
allowlisted April/August reports. Recordings are validated by dataset, profile,
calibration ID, report schema, citation membership and verification labels.
They are historical server-owned snapshots, not fresh API results or independent
reverification of measurements. Missing details (notably most unsupported cells,
proposed VE values, and supporting rows) are explicitly unavailable; they are
never synthesized to fill out a recording. A missing/invalid recording fails
without making a replacement model call.

The optional read-only `presentation.veAxes` copies original imported VE RPM/MAP
axes, allowing all calibration coordinates to be displayed even for partial
recordings. Missing cell decisions remain unavailable rather than unsupported.
Older projections without axes show retained coordinates only. No interpolation
or numerical fitting is performed in the browser. All values are rounded only
for display. At-bound solutions are labeled "at bound".

## Contracts and scope

- `GET /api/demo` exposes only the two demo IDs, labels and asset availability.
- `POST /api/demo` accepts only `{datasetId?: 'april' | 'august8'}`. Empty remains April.
- `POST /api/investigations` retains legacy inputs, adding `mode`, `profile`,
  `source`, and boolean `resilient`. The server allowlists V1/V2 experimental and
  freezes existing numerical defaults. No arbitrary paths, numerical parameters,
  vectors, masks, tool names or model choices are accepted from the browser.
- `GET /api/investigations/:id` returns owner-scoped state/progress, the bounded
  trace, validated report and typed presentation. There is no raw-artifact route.
- `POST /api/investigations/:id/cancel` requires the owning cookie and same Origin.

All writes retain the existing Origin/owner checks. Worker projection groups only
canonical ready training rows and calls the existing AFR summary implementation;
cell values/statuses come from the existing dataset/fitter/candidate; paired
metrics come from the existing predictor. Display uses `Intl.NumberFormat` only.
The projection is capped at 512 KiB and 256 VE cells; the trace remains bounded by
the six-call, 32,000-byte tool reply limits. Full raw datasets are never copied to
the dashboard. Partial and failed investigations preserve whatever evidence exists.

Chart selection is **inspection only**. Analytical training/holdout always use
the whole frozen log. Charts and the existing eligibility inspector retain V1
screening, explicitly labeled when the analytical profile is V2 experimental.
Server numerical facts and unverified model commentary have distinct badges;
recorded facts additionally carry their historical source label. Predictions are
never presented as measured improvement, and no ECU-write functionality exists.

### Telemetry visualization modes

Combined is the initial view: native SVG curves independently normalized from
finite samples inside the visible window. The normalized Y-axis is not a physical
comparison between channels. Cursor legends report the nearest actual row/time
and its original canonical values/units, including unavailable values rather
than substituting zeros. Server segment boundaries and per-channel missing or
nonfinite values break the curves; isolated valid points remain dots.

A display-only near-flat guard uses `span <= max(0.000001, 0.001 * peak magnitude)`.
Constant/near-flat channels are drawn at 50%, labeled accordingly; physical
readouts retain their original variation. This guard is not a sensor-resolution
claim or an eligibility threshold. Legend buttons temporarily hide curves without
altering the selected channels, fetched data or analysis. Hidden choices survive
view switches; Stacked always shows all selected channels with its existing
independent physical scales. Modes retain the last cursor, selected window and
sample navigation. Changing the fetched window resets the cursor as before and
recomputes visible extrema. No chart dependency or API change is involved.

## Resources and lifecycle

### Failure diagnostics

Live analytical dashboard jobs write a private, best-effort record at
`<AGENTICEFI_DIAGNOSTICS_DIR>/<dashboard-job-id>.json` when configured, otherwise
`.investigation-diagnostics/<dashboard-job-id>.json` under the working directory.
Production uses `/var/lib/agenticefi/investigation-diagnostics`. The progress band displays
that job ID and a specific termination label. This directory is git-ignored,
excluded from formatting, and has no public download API. It must be writable
on the Node deployment; filesystem failure does not interrupt analysis and emits
at most one fixed sanitized server warning per recorder. Existing
failed runs cannot be reconstructed retroactively from these new records.

Records retain at most 160 metadata events each and 32 recent job files. They
include the dashboard/analytical run IDs, model turn, tool name/outcome/duration,
HTTP attempt/status/duration, retry decision/count/delay, remaining runner
deadline, worker lifecycle, and final runner/job category. They exclude goals,
prompts, provider bodies, tool arguments/results, headers, credentials, model
reasoning and telemetry. The UI receives only a small typed termination summary.

The 120-second runner deadline remains primary over provider cancellation errors.

Analytical early final reports are validated against actual analysis, fitting and
same-candidate evaluation evidence before being considered workflow-complete.
If a candidate is finalized but evaluation is missing, the runner may offer one
structured feedback continuation from the final Meta response ID. No completed
tool output is replayed. The same run, settings, candidate, AbortSignal, deadline,
turn limit and tool-call budget remain in force. Recovery fitting is neither
advertised nor executed, and a different candidate reference is rejected locally.
The model retains the choice of analytical tools or an honest partial conclusion.

Recovery is skipped without a finalized candidate, with insufficient budget for
the missing stages plus a final report, or if the adapter cannot continue. A
second incomplete final never receives another feedback opportunity. An unverified
model explanation cannot establish a blocker; private worker availability evidence
is required. Failed recovery retains the original validated partial report and
completed trace. `recovery-offered`, `recovery-skipped`, `recovery-guard` and
`recovery-end` events record bounded metadata without model text. For compatibility,
the existing `completed` runner status still denotes a validated report; its
`incomplete-workflow` termination category means the analytical workflow is partial.
Legacy investigations and all public request/report schemas are unchanged.

Provider HTTP/network/protocol/incomplete-response failures, invalid reports,
worker failures, incomplete model-selected workflows, cancellation and expiry
are distinguishable. A failed poll remains a connection error, not a replacement
backend termination. No tool is forced and no complete investigation is retried.

Dashboard workers attach the existing bounded presentation to successful tool
replies. The latest checkpoint survives a later timeout or worker failure along
with the completed trace. It represents only the completed stages: missing
evaluation metrics remain unavailable. Checkpoint extraction failures preserve
the previous checkpoint and are recorded separately. Full private worker artifacts
still expire and are disposed normally. Recordings and numerical calculations are
unchanged; no additional provider requests are made for diagnostics.

Curated source/context caches hold at most the two demo datasets; parsed contexts
and V1 classifications are shared read-only across independently owned sessions.
Only one analytical dashboard run is admitted at a time, preserving the existing
overall session/run caps. August selects the measured 1024 MiB worker tier; April
retains 512 MiB. Six calls, seven model turns and a 120-second investigation
deadline are fixed server policy. Two optional retries per model turn apply only
to transient HTTP statuses; tools, workflows and ambiguous network failures are
never retried. Numerical thresholds and all fitting/prediction formulas are unchanged.

Completed/failed workers are disposed after the bounded presentation is extracted;
cancellation/expiry abort ongoing requests and terminate their worker. Browser
navigation stops polling; the server deadline still bounds any outstanding job.
Source caches and process-local job history disappear on restart. August needs
more than 1 GiB total RSS including parent/native allocations; this is not an edge
runtime or low-memory deployment. Configure a supported Node adapter for production.

## Verification

`npm test` covers orchestration, owner isolation, cancellation, partial results,
resource capacity, projection values and recording validation. `npm run test:dashboard`
server-renders components to check source/verification labels, escaped model text,
progress/cancel controls, paired prediction labels and display precision. These
tests use scripted models and never contact Meta. `npm run check`, ESLint and
`npm run build` validate the application. Genuine live smoke commands remain
separate opt-ins described in `investigation/analytical.md`.

The full August V1 dashboard path was checked offline with a scripted model:
56,284 parsed rows, all 256 VE cell decisions, 3,780 paired held-out rows. The local
HTTP recorded path returned its retained eight regions/five cell details and
explicitly marked the remaining 251 cell details unavailable. Browser screenshot
verification was blocked by an unavailable browser automation host.
