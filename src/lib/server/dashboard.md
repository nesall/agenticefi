# Analytical dashboard

Run `npm run dev`. Runtime preparation bundles the analytical worker and copies the
owner-confirmed August 8 block2 log/VE/AFR assets into private `.demo-assets` files.
April remains bundled as before. August is read lazily; no 66 MB log enters the
client bundle or generated JavaScript. Ship `.demo-assets` and `.analytical-worker`
alongside the Node deployment and start from the project root. Missing August
assets leave April available. No database or new dependencies are required.

## Three-minute demonstration

1. Choose August 8 and load it. The initial chart shows 60 seconds, within the
   existing 8,000-point limit. Full-log data remain available for analysis.
2. Select **Analytical Investigation**, V1 defaults and **Live Muse Spark**.
   The API uses server environment credentials only. Optional bounded retries
   share the same deadline. Click Run; completed tools appear during polling.
3. Inspect findings, AFR neighborhoods, the accepted/suppressed/unsupported VE
   cell table, paired holdout MAE/RMSE, limitations and the trace. Evidence links
   open cited calls; supporting row/time buttons focus the synchronized charts.

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

## Resources and lifecycle

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
