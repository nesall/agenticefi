# Dashboard demo

`rx7.msl` is the 2025-04-12 RX-7 log, losslessly transcoded from the supplied
Windows-1252 original into UTF-8. The two table files are copies of the associated
block1 calibration confirmed by the dataset owner. Measurements are unchanged.

Vite bundles these assets through server-only `?raw` imports. Production does not
read from `tests/` or depend on the working directory. The log and tables are not
emitted as public static assets.

The dashboard supports this one curated demo. Uploading arbitrary data is outside
the current UI. All normalization and eligibility classification use the existing
server modules, with one cached classification per stored session. The UI receives
normalized numbers/nulls and structured screening results, never server classes.

Sessions expire after 30 minutes and are isolated by an HttpOnly, SameSite=Strict
owner cookie. The process stores at most eight sessions and sixteen runs, with at
most two simultaneous runs globally and one per session. Restarting the process
discards this state; it is not a durable or multi-instance store. This personal
demo does not add user accounts or public-deployment access control.

API routes:

- `POST /api/demo` creates/reuses the browser's demo session.
- `GET /api/sessions/:id/telemetry` takes `slots`, `startSec`, `endSec`.
- `GET /api/sessions/:id/eligibility` takes the time window, `status`, `reason`,
  `offset`, `limit`, optional `focusRow`, and `includeInvalidTime=true`.
- `POST /api/investigations` takes `sessionId`, `goal`, `startSec`, `endSec`.
- `GET /api/investigations/:id` polls the run state and completed trace/report.

All POST requests require a matching Origin. JSON responses use `no-store`.
Missing or expired sessions/runs return 404; invalid input returns 400; capacity
limits return 429. The server requires `META_HACKATHON_API_KEY` for live
investigations. Offline inspection remains usable without it. Model requests use
the existing Meta adapter with bounded calls/iterations and a five-minute timeout.
The dashboard does not make API calls until the user starts an investigation.

The chart component uses native SVG because registry access prevented installing
uPlot in this environment. Its rendering is isolated for a future replacement.
Only display scaling, selection, formatting, and navigation run in the browser.
Time-series responses preserve original row IDs, split on non-monotonic/invalid
times and known discontinuities, and use null for unavailable measurements. Missing
values break SVG paths. Windows above 8,000 points are rejected with a prompt to
narrow the window; no samples are silently sorted, merged, or downsampled.

Chart hover synchronizes cursors. Click or use arrow keys to inspect samples;
drag a chart or use numeric controls to select an inclusive time window. The
eligibility inspector pages over full-resolution classifications and can inspect
invalid-time rows separately. Profile settings are read-only in the UI.

Investigations run asynchronously. The first version shows a running indicator
and exposes the full trace once completed. It does not stream intermediate model
reasoning or tool events. Findings link to tool evidence, trace windows, and sample
rows. A valid citation establishes provenance, not truth or tuning safety.

Run with `npm run dev`. Verify backend behavior with `npm test -- tests/dashboard.test.ts`.
