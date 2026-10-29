# Single-VPS Node deployment

This document describes deployment preparation. It does not activate a VPS or
the proposed public access configuration below.

## Build and package

Use Node 22.17 or newer (the local verification runtime is Node 22.23.3). Run
`npm ci` with development dependencies available, then `npm run build`.
The Node adapter creates the standalone `build/` directory. Build-time dependencies
are bundled; any future production dependencies must also be installed on the host.

The existing `prebuild` prepares the analytical worker and private demo assets.
Package these together, preserving their relative paths:

- `build/`, `package.json`, and `package-lock.json`.
- `.analytical-worker/entry.cjs` (compiled Node worker; no TypeScript loader needed).
- `.demo-assets/august8/2026-08-08_11.19.56.msl`.
- `.demo-assets/august8/veTable1_2026-08-08_23.57.53.table`.
- `.demo-assets/august8/AFR_2026-07-30_19.40.54.table`.
- `.demo-assets/recordings/` for the available validated recorded demonstrations.

April data are bundled in the server output. August's confirmed inputs come from
the private `data/logs/block2/` directory during preparation; they and the generated
directories are git-ignored. A repository clone alone does not supply August.
The existing builder permits April-only operation when August is absent: verify
the packaged August files explicitly before releasing the August demonstration.
Preserve the exact calibration association; never substitute other tables.

Run from the directory containing `build/`, `.analytical-worker/` and `.demo-assets/`.
Do not serve the project root as static content. Only the Node adapter should serve
the application; logs, calibration inputs and diagnostics stay private.

## Start and environment

Use `npm start` (equivalent to `node build`) under one supervised Node process.
It runs the built application without rebuilding or installing packages. The
service must set its working directory to the package root.

Inject `META_HACKATHON_API_KEY` into the service environment. `META_API_KEY` remains
the supported fallback alias. Never use a `PUBLIC_` variable for either key.
Production does not load `.env` automatically; `npm run start:env` explicitly uses
Node's `--env-file=.env` when that local-file approach is desired. Use `.env.example`
as a template without committing credentials.

Behind the proposed local reverse proxy, configure:

```text
HOST=127.0.0.1
PORT=3000
PROTOCOL_HEADER=x-forwarded-proto
HOST_HEADER=x-forwarded-host
BODY_SIZE_LIMIT=16K
```

The proxy must overwrite those forwarded headers and send the correct public
HTTPS host and scheme. The Node port must not be directly reachable from the
Internet. Correct origin handling is necessary for the existing Origin checks
and secure owner cookie. For direct local HTTP checks using this header setup,
send `X-Forwarded-Proto: http`, the local forwarded host, and the matching Origin.

Give the service read access to packaged assets and write access to
`.investigation-diagnostics/`. Diagnostics retain at most 160 metadata events per
record and 32 recent files; they contain no credentials or full telemetry.

The UI's **Job ID** identifies `.investigation-diagnostics/<jobId>.json`.
Its internal `runId` identifies the analytical state/evidence, not the dashboard
job. For a provider rejection, inspect `http-end`: `status`, recognized
`providerErrorCode`, `providerErrorType`, `providerErrorParam`,
`providerErrorHint`, and `providerRequestId` when supplied in a recognized format.
Hints classify provider text; they are diagnostic clues, not verified root causes.
Unknown fields and free-form messages are omitted. Error inspection is limited to
16 KiB and 250 ms. `model-request` records continuation presence, submitted tool
name (when returning a tool result), and serialized request bytes, never contents.
These fields apply to new live dashboard investigations; older records cannot be
enriched retroactively. Retry policy and model requests are unchanged.

## Resource and lifecycle requirements

- Start with one process and approximately 4 GiB VPS RAM, then measure actual RSS.
  The existing August benchmark exceeded 1 GiB total RSS. Its worker old-generation
  ceiling is 1024 MiB; April uses 512 MiB. These are not total-process memory limits.
  Global V8 heap flags can override worker limits; do not silently override them.
- Keep the existing one-analytical-run admission limit, two-total-active-run cap,
  eight-session cap and sixteen-retained-job cap. Do not enable a process cluster:
  ownership, sessions and these limits are process-local.
- Sessions/jobs expire after 30 minutes and disappear on restart. The UI permits
  reloading after a permanent 404; it does not pretend to restore server artifacts.
- The analytical deadline is 180 seconds, including recovery and HTTP retries.
  Idle analytical evidence retention is also 180 seconds so a late model response
  does not outlive its candidate evidence. The per-tool worker timeout stays 120 seconds.
  The legacy path can run for 300 seconds. Cancellation aborts provider work and
  disposes the worker. Browser navigation stops polling but is not cancellation.
- Drain active work before service restarts. HTTP connection draining alone does
  not preserve background investigations. No persistence or restart recovery is
  implemented.
- Job creation and polling are short HTTP requests; a 105-second investigation
  runs in the background. Size proxy timeouts for cold demo loading, not to extend
  the independent runner deadline. The proposal uses a conservative 180 seconds.

## Proposed access protection - review before activation

`proposed-nginx.conf` is an inactive example, not an installed server configuration.
It proposes a shared HTTP Basic access gate over HTTPS for the controlled demo,
plus per-IP rate limits on POSTs to the exact investigation-start and demo-loading
paths. Investigation-start limits also cover recorded starts because the same
endpoint handles both. Polling, cancellation and evidence navigation are not
rate-limited by those zones.

Before approval/activation, choose the hostname, TLS certificate paths, access-file
location, credentials and suitable rates for the expected judges/users. The
password file must be outside the web root, created on the VPS separately, and
readable only by the reverse proxy. Do not reuse the Meta API credential. This is
an access gate, not persistent application accounts. Existing Origin/owner checks
and numerical resource limits remain required.

Suggested acceptance check after packaging: start with `npm start`, load April and
August, confirm August Reset loads the supported initial window, inspect a cited
sample, verify a recorded investigation without contacting Meta, and test cancel
and permanent-session-loss handling. A genuine live run is a separate opt-in.

References: [SvelteKit Node adapter](https://svelte.dev/docs/kit/adapter-node),
[Nginx request limiting](https://nginx.org/en/docs/http/ngx_http_limit_req_module.html).
