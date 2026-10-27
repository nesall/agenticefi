# MSL regression fixtures

Place real `.msl` files here (subdirectories are supported). The fixture suite fails
with an actionable message when no logs are present. No synthetic log is included
as a substitute for real telemetry.

Run `npm test` for all tests or `npm test -- tests/MegasquirtCsvParser.test.ts`
for the self-contained unit tests. Run `npm run test:watch` while developing.

The real-file suite checks successful parsing, nonempty samples, channel alignment,
and repeatability. It cannot establish numerical correctness by itself. For a
manually verified log excerpt, add explicit expected metadata, sample counts, and
selected channel values in a dedicated regression test. Review logs for sensitive
metadata before committing them.
