# Investigation test harness

Run `npm run test:agent` to exercise the deterministic tools, bounded runner, and
scripted investigation against the real log and VE/AFR fixtures. No network calls,
API credentials, new packages, or running SvelteKit server are required.

The real-data test prints its evidence IDs and report. Its model substitute picks
three tools using previous tool outputs. It verifies the protocol, not autonomous
reasoning quality. The injected `InvestigationModel` interface is the boundary for
the server-side Muse Spark adapter.

The tools expose original channel units and validated mappings. Window bounds are
inclusive parsed seconds; row references are zero-based parsed sample indices.
Missing/unresolved samples contribute to unavailable counts, never to zero-valued
statistics. Empty-window statistics are null. Invalid times cannot be assigned to
a time window and are reported as a log-wide excluded count. Neither calibration
lookups nor eligibility classification are performed by this initial harness.

The runner validates tool arguments and report citations, caps calls/iterations,
limits response sizes, and supports cancellation and a model-wait timeout. A
successful citation establishes provenance; it does not prove model prose is true.
The timeout cannot interrupt synchronous calculations or a model adapter blocking
the JavaScript event loop. Adapters should honor the provided AbortSignal.

Calibration association is explicitly supplied by the fixture loader. The parser
can skip malformed rows and adjust the first timestamp without original-row
diagnostics; these limitations are included in every completed report.

The file loader decodes log bytes as strict UTF-8, falling back to Windows-1252
when UTF-8 is invalid. `describe_log.logEncoding` records the choice, and fallback
use appears as an explicit assumption in report limitations. This preserves legacy
`°F`/`°C` units; temperature statistics normalize to Celsius. Already decoded
strings are marked `provided-string` and cannot recover bytes replaced upstream.

## Live Meta test

Export `META_HACKATHON_API_KEY` in your shell, then run
`npm run test:agent:live`. In MSYS2, `export META_HACKATHON_API_KEY` exports an
already assigned shell variable; no key needs to be written to project files.
The test reads the process environment, not a `.env` file. Missing credentials
produce a clear failure.

This explicit command makes real API requests to `https://api.meta.ai/v1/responses`
using `muse-spark-1.3-contributor`, with at most six tool calls, nine model turns,
4096 output tokens per response, and a five-minute runner timeout. No retries are
performed. Tool outputs, channel metadata, and the goal are sent to Meta; raw log
samples are not uploaded. Responses are stored by Meta to support
`previous_response_id`. Authentication headers and provider error bodies are not
printed.

The adapter translates native function calls into runner requests and returns each
result with its originating `call_id` and evidence ID. It repeats instructions on
every request. A fresh adapter instance is required for each investigation.

The live test prints the complete local tool trace and validated report. It fails
on API/protocol errors, missing requested tools, invalid citations, or execution
limits. It does not assert exact model prose or prove the truth of its conclusions.
Normal `npm test` and `npm run test:agent` remain offline even when a key is set;
the separate live config is the only one that includes `tests/live/*.live.ts`.

Protocol reference: https://dev.meta.ai/docs/tool-calling
