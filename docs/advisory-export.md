# Advisory VE data export

The Results workspace offers CSV and minimal provenance JSON only when a complete
server-owned export snapshot is available. It is an advisory data export, **not a
directly importable ECU/TunerStudio calibration**. It is not engine validated.

The CSV contains one RPM header and 16 MAP rows. The first header is
`MAP_kPa / RPM`; the remaining headers are original RPM axis coordinates. Each
row starts with its original MAP coordinate in kPa, followed by 16 finalized VE
values. Axis order and matrix orientation match the original calibration.
JavaScript's round-trippable number strings preserve the stored binary64 values;
display rounding is not used. Suppressed and unsupported cells remain unchanged.

The worker creates an immutable snapshot only after verifying complete finite
16-by-16 data, original calibration identity, dataset/candidate/fit fingerprints,
finalized cell decisions and bounds. Failure disables export without changing the
investigation outcome. Only the small snapshot survives worker disposal, under
the existing process-local owner authorization, session expiry and job limits.
Downloads do not refit, evaluate, mutate calibration or expose private evidence.

A finalized candidate from an interrupted investigation is labeled **partial** in
the filename, Results and provenance JSON. Holdout evaluation availability/status
is explicit. Existing recordings lack authoritative complete candidate snapshots;
their exports are disabled. Reloading or restarting cannot reconstruct a lost
snapshot from model prose or partial recorded cells.

XML `.table` export is deferred. The importer extracts axes, values, axis names
and selected metadata, but does not preserve the complete source XML structure,
comments, formatting or all attributes. Before implementing XML output, establish
source metadata preservation and independent export/import round-trip tests for
axis orientation, units, numerical values, namespace handling and representative
TunerStudio files. CSV downloads make no compatibility claim for ECU imports.
