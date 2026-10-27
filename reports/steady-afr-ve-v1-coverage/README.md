# VE-neighborhood coverage findings

Source code and classifier thresholds were not changed. Classifier SHA-256: 3d8a5b6fbd8595c19a4e2d3e3b8ef3510d0fee3c2a7c8ff0e9dae3e8b90b71eb. All classifications used the stored steady-afr-ve-v1 defaults, with no overrides.

## Sources and association

Block1 uses the preserved VE export at src/lib/server/demo/ve.table (the July 30 export originally provided with that block). Block2 and block3 use their own .table files. All three exports share the same axes. Later export dates alone do not prove the calibration was active during a drive; this analysis uses the supplied grids and makes no VE correction.

RPM axis: 700, 800, 900, 1000, 1200, 1500, 2000, 2500, 3000, 3500, 4000, 5000, 6000, 7000, 8000, 9000.
MAP axis (kPa): 30, 40, 45, 50, 55, 60, 65, 70, 80, 90, 100, 125, 150, 175, 200, 260.

## Files

- neighborhood-counts.csv: all 225 interpolation neighborhoods for each of four logs, including zeros (900 records). Each accepted sample is counted once in its containing neighborhood, not once per corner. Bounds are lower-inclusive/upper-exclusive except the final interval, which includes the upper endpoint. Outside-axis samples use edge-clamped neighborhood assignment and are counted in accepted_clamped. Eleven August 1 accepted samples are below 30 kPa; do not mistake these for observations within 30-40 kPa.
- band-counts.csv: separate RPM/MAP bands at every actual breakpoint, plus underflow/overflow bands. n counts positive-RPM/MAP samples assigned to that band; accepted counts reconcile to classifier totals.
- findings.json: thresholds, region definitions, counts, diagnostic comparisons, and representative parsed-row/time evidence.

## Region assumptions

Running finite RPM/MAP/TPS. Boost: MAP > recorded Barometer. Moderate load: 70 kPa <= MAP <= Barometer. Idle-like: RPM < 1500, TPS <= 2%, MAP < 70 kPa, VSS1 <= 1 mph when available. Cruise-like: VSS1 > 1 mph, TPS > 2%, MAP < 70 kPa. Other low-load/closed-throttle samples remain separate. Vehicle Speed is all zero and is not used.

These descriptive bins are not classifier changes or proof of ECU idle/cruise state. VSS1 is unavailable in April; the all-zero Vehicle Speed channel is not used to assert stationary operation. Cruise-like movement cannot be verified in that log. Barometer is 99.1 kPa in April and August 8, and 98.8 kPa in July and August 1.

## Exclusion audit

History-only rows pass all other enabled checks. RPM-only direct exclusion disregards the downstream unassessed steady window, but requires every other check to pass.

Non-idle means a running finite RPM/MAP/TPS sample outside the stated idle-like definition; it includes closed-throttle moving samples. Group percentages therefore are not a direct estimate of useful tuning-data loss. Counts of history-only rows indicate otherwise-passing current checks, not validated samples that should be admitted. RPM-only rows pass all independent checks except RPM rate, disregarding the downstream unavailable steady window. Both kinds can reset or delay history.

Raw status: Fuel Cut and status: Overrun Fuel Cut columns are Inactive throughout all four logs. The current parser converts these text labels to NaN, so the classifier cannot consume them as flags. Its numeric PW/RPM/TPS prerequisites are nevertheless available for every sample and no FUEL_CUT_UNASSESSED reason occurs. Zero possible-cut hits arise because the numeric conjunction is never satisfied, not because those three inputs are missing. PW2=0 alone is not fuel-cut evidence (it is zero throughout the April log while primary PW stays positive).

Times and row references are parsed log values. July contains negative source times; no rebasing was performed. First-timestamp repair and malformed-row skipping are existing parser limitations. Samples are temporally correlated; counts are not independent experiments or sufficient tuning evidence.
