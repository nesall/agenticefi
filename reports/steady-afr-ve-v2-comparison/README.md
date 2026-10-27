# Fixed experimental eligibility comparison

All four original logs were evaluated against unchanged V1 and the fixed 2x2 experimental controls. No classifier thresholds were tuned. V2 is not promoted to the dashboard or analytical tools. More accepted samples do not establish better accuracy.

## Accepted coverage

A = adjacent/trailing, B = adjacent/centered, C = windowed/trailing, D = windowed/centered. A and B share the new support and categorical guards and are not V1. Cells are occupied interpolation neighborhoods out of 225, not independent measurements or calibrated corrections.

| Log                     | V1 samples/cells |        A |        B |        C |        D |
| ----------------------- | ---------------: | -------: | -------: | -------: | -------: |
| 2025-04-12_16.16.28.msl |            815/5 |    772/5 |    746/5 |   1328/7 |   1307/7 |
| 2026-07-25_17.56.47.msl |          6042/29 |  5870/29 |  5756/29 |  8679/38 |  8591/36 |
| 2026-08-01_09.45.13.msl |          6805/40 |  6553/39 |  6398/43 | 10588/47 | 10438/49 |
| 2026-08-08_11.19.56.msl |         17745/48 | 17262/45 | 17001/44 | 26467/64 | 26256/67 |

## Operating regions (accepted samples)

The labels describe telemetry, not proven engine operating modes: boost is MAP above recorded Barometer; moderate load is MAP >=70 kPa up to Barometer; idle-like is RPM <1500, TPS <=2%, MAP <70 kPa, and VSS1 <=1 mph when available; cruise-like is MAP <70 kPa, VSS1 >1 mph, TPS >2%. Closed-throttle/non-idle and motion-unverified samples remain separate. April lacks VSS1; do not infer vehicle cruise from its all-zero Vehicle Speed channel. These reporting bands are not eligibility thresholds.

| Log                     | Profile           | Idle-like | Cruise-like | Moderate | Boost | Closed-throttle/non-idle | Motion-unverified |
| ----------------------- | ----------------- | --------: | ----------: | -------: | ----: | -----------------------: | ----------------: |
| 2025-04-12_16.16.28.msl | V1                |       815 |           0 |        0 |     0 |                        0 |                 0 |
| 2025-04-12_16.16.28.msl | adjacent-trailing |       772 |           0 |        0 |     0 |                        0 |                 0 |
| 2025-04-12_16.16.28.msl | adjacent-centered |       746 |           0 |        0 |     0 |                        0 |                 0 |
| 2025-04-12_16.16.28.msl | windowed-trailing |      1308 |           0 |        0 |     0 |                        0 |                20 |
| 2025-04-12_16.16.28.msl | windowed-centered |      1288 |           0 |        0 |     0 |                        0 |                19 |
| 2026-07-25_17.56.47.msl | V1                |      2453 |         628 |      141 |     7 |                     2813 |                 0 |
| 2026-07-25_17.56.47.msl | adjacent-trailing |      2403 |         592 |      133 |     6 |                     2736 |                 0 |
| 2026-07-25_17.56.47.msl | adjacent-centered |      2333 |         558 |      136 |     5 |                     2724 |                 0 |
| 2026-07-25_17.56.47.msl | windowed-trailing |      3269 |         953 |      199 |     8 |                     4250 |                 0 |
| 2026-07-25_17.56.47.msl | windowed-centered |      3192 |         912 |      199 |     7 |                     4281 |                 0 |
| 2026-08-01_09.45.13.msl | V1                |      2221 |        1252 |      561 |   131 |                     2640 |                 0 |
| 2026-08-01_09.45.13.msl | adjacent-trailing |      2172 |        1176 |      524 |   124 |                     2557 |                 0 |
| 2026-08-01_09.45.13.msl | adjacent-centered |      2112 |        1126 |      497 |   126 |                     2537 |                 0 |
| 2026-08-01_09.45.13.msl | windowed-trailing |      3407 |        2265 |      675 |   126 |                     4115 |                 0 |
| 2026-08-01_09.45.13.msl | windowed-centered |      3358 |        2198 |      645 |   127 |                     4110 |                 0 |
| 2026-08-08_11.19.56.msl | V1                |      8218 |        1279 |      292 |    15 |                     7941 |                 0 |
| 2026-08-08_11.19.56.msl | adjacent-trailing |      8082 |        1190 |      275 |    13 |                     7702 |                 0 |
| 2026-08-08_11.19.56.msl | adjacent-centered |      7877 |        1143 |      268 |    13 |                     7700 |                 0 |
| 2026-08-08_11.19.56.msl | windowed-trailing |     10593 |        3170 |      409 |    69 |                    12223 |                 3 |
| 2026-08-08_11.19.56.msl | windowed-centered |     10360 |        3079 |      386 |    77 |                    12352 |                 2 |

## Isolation of the two factors

| Log                     | Change                                 | Retained | Gained | Lost |
| ----------------------- | -------------------------------------- | -------: | -----: | ---: |
| 2025-04-12_16.16.28.msl | adjacent-trailing -> windowed-trailing |      772 |    556 |    0 |
| 2025-04-12_16.16.28.msl | adjacent-centered -> windowed-centered |      746 |    561 |    0 |
| 2025-04-12_16.16.28.msl | adjacent-trailing -> adjacent-centered |      486 |    260 |  286 |
| 2025-04-12_16.16.28.msl | windowed-trailing -> windowed-centered |     1105 |    202 |  223 |
| 2026-07-25_17.56.47.msl | adjacent-trailing -> windowed-trailing |     5867 |   2812 |    3 |
| 2026-07-25_17.56.47.msl | adjacent-centered -> windowed-centered |     5753 |   2838 |    3 |
| 2026-07-25_17.56.47.msl | adjacent-trailing -> adjacent-centered |     4706 |   1050 | 1164 |
| 2026-07-25_17.56.47.msl | windowed-trailing -> windowed-centered |     7879 |    712 |  800 |
| 2026-08-01_09.45.13.msl | adjacent-trailing -> windowed-trailing |     6552 |   4036 |    1 |
| 2026-08-01_09.45.13.msl | adjacent-centered -> windowed-centered |     6396 |   4042 |    2 |
| 2026-08-01_09.45.13.msl | adjacent-trailing -> adjacent-centered |     5001 |   1397 | 1552 |
| 2026-08-01_09.45.13.msl | windowed-trailing -> windowed-centered |     9128 |   1310 | 1460 |
| 2026-08-08_11.19.56.msl | adjacent-trailing -> windowed-trailing |    17262 |   9205 |    0 |
| 2026-08-08_11.19.56.msl | adjacent-centered -> windowed-centered |    17001 |   9255 |    0 |
| 2026-08-08_11.19.56.msl | adjacent-trailing -> adjacent-centered |    14127 |   2874 | 3135 |
| 2026-08-08_11.19.56.msl | windowed-trailing -> windowed-centered |    24229 |   2027 | 2238 |

Windowed RPM accepts bounded local variation that fragmented adjacent-rate runs. This accounts for much more coverage than changing alignment. Centered windows shift both accepted leading and trailing edges: their total accepted counts are lower than trailing counts in all four logs despite recovering some earlier samples. Wider RPM/MAP coverage is not monotonic with sample count (August 1/8 centered windows cover more neighborhoods than trailing).

## Exclusions

Counts overlap. Hard exclusions remain 0, 2, 345 and 8 in every experimental control, exactly matching V1. Unsupported windows are indeterminate rather than failed steady-state evidence. Unknown required categorical states also remain indeterminate.

| Log                     | Control           | Hard | Heuristic | Indeterminate | Most frequent reasons                                                                                                                   |
| ----------------------- | ----------------- | ---: | --------: | ------------: | --------------------------------------------------------------------------------------------------------------------------------------- |
| 2025-04-12_16.16.28.msl | adjacent-trailing |    0 |      1053 |          1034 | STABILITY_SUPPORT_UNASSESSED: 1033; RPM_TRANSIENT: 880; MAP_TRANSIENT: 718; RPM_JUMP_BOUNDARY: 396; TPS_TRANSIENT: 187                  |
| 2025-04-12_16.16.28.msl | adjacent-centered |    0 |      1053 |          1060 | STABILITY_SUPPORT_UNASSESSED: 1059; RPM_TRANSIENT: 880; MAP_TRANSIENT: 718; RPM_JUMP_BOUNDARY: 396; TPS_TRANSIENT: 187                  |
| 2025-04-12_16.16.28.msl | windowed-trailing |    0 |       829 |           702 | MAP_TRANSIENT: 718; STABILITY_SUPPORT_UNASSESSED: 702; RPM_JUMP_BOUNDARY: 396; TPS_TRANSIENT: 187                                       |
| 2025-04-12_16.16.28.msl | windowed-centered |    0 |       829 |           723 | STABILITY_SUPPORT_UNASSESSED: 723; MAP_TRANSIENT: 718; RPM_JUMP_BOUNDARY: 396; TPS_TRANSIENT: 187                                       |
| 2026-07-25_17.56.47.msl | adjacent-trailing |    2 |      7233 |          5885 | STABILITY_SUPPORT_UNASSESSED: 5883; RPM_TRANSIENT: 4998; MAP_TRANSIENT: 4851; TPS_TRANSIENT: 2454; RPM_JUMP_BOUNDARY: 1901              |
| 2026-07-25_17.56.47.msl | adjacent-centered |    2 |      7233 |          5999 | STABILITY_SUPPORT_UNASSESSED: 5997; RPM_TRANSIENT: 4998; MAP_TRANSIENT: 4851; TPS_TRANSIENT: 2454; RPM_JUMP_BOUNDARY: 1901              |
| 2026-07-25_17.56.47.msl | windowed-trailing |    2 |      5967 |          4342 | MAP_TRANSIENT: 4851; STABILITY_SUPPORT_UNASSESSED: 4342; TPS_TRANSIENT: 2454; RPM_JUMP_BOUNDARY: 1901; RPM_WINDOW_SPREAD: 359           |
| 2026-07-25_17.56.47.msl | windowed-centered |    2 |      5966 |          4431 | MAP_TRANSIENT: 4851; STABILITY_SUPPORT_UNASSESSED: 4431; TPS_TRANSIENT: 2454; RPM_JUMP_BOUNDARY: 1901; RPM_WINDOW_SPREAD: 358           |
| 2026-08-01_09.45.13.msl | adjacent-trailing |  345 |     12664 |         10088 | STABILITY_SUPPORT_UNASSESSED: 10082; MAP_TRANSIENT: 8944; RPM_TRANSIENT: 7280; TPS_TRANSIENT: 4324; RPM_JUMP_BOUNDARY: 2670             |
| 2026-08-01_09.45.13.msl | adjacent-centered |  345 |     12664 |         10243 | STABILITY_SUPPORT_UNASSESSED: 10237; MAP_TRANSIENT: 8944; RPM_TRANSIENT: 7280; TPS_TRANSIENT: 4324; RPM_JUMP_BOUNDARY: 2670             |
| 2026-08-01_09.45.13.msl | windowed-trailing |  345 |     10677 |          8040 | MAP_TRANSIENT: 8944; STABILITY_SUPPORT_UNASSESSED: 8040; TPS_TRANSIENT: 4324; RPM_JUMP_BOUNDARY: 2670; WARMUP_CORRECTION_ACTIVE: 761    |
| 2026-08-01_09.45.13.msl | windowed-centered |  345 |     10692 |          8175 | MAP_TRANSIENT: 8944; STABILITY_SUPPORT_UNASSESSED: 8175; TPS_TRANSIENT: 4324; RPM_JUMP_BOUNDARY: 2670; WARMUP_CORRECTION_ACTIVE: 761    |
| 2026-08-08_11.19.56.msl | adjacent-trailing |    8 |     22212 |         16802 | STABILITY_SUPPORT_UNASSESSED: 16799; RPM_TRANSIENT: 14877; MAP_TRANSIENT: 12238; TPS_TRANSIENT: 6412; RPM_JUMP_BOUNDARY: 5849           |
| 2026-08-08_11.19.56.msl | adjacent-centered |    8 |     22212 |         17063 | STABILITY_SUPPORT_UNASSESSED: 17060; RPM_TRANSIENT: 14877; MAP_TRANSIENT: 12238; TPS_TRANSIENT: 6412; RPM_JUMP_BOUNDARY: 5849           |
| 2026-08-08_11.19.56.msl | windowed-trailing |    8 |     18325 |         11484 | MAP_TRANSIENT: 12238; STABILITY_SUPPORT_UNASSESSED: 11484; TPS_TRANSIENT: 6412; RPM_JUMP_BOUNDARY: 5849; WARMUP_CORRECTION_ACTIVE: 3407 |
| 2026-08-08_11.19.56.msl | windowed-centered |    8 |     18344 |         11676 | MAP_TRANSIENT: 12238; STABILITY_SUPPORT_UNASSESSED: 11676; TPS_TRANSIENT: 6412; RPM_JUMP_BOUNDARY: 5849; WARMUP_CORRECTION_ACTIVE: 3407 |

Both raw categorical cut channels are present and Inactive on every row of these four logs. Neither active-cut rule triggers. The retained numeric PW/RPM/TPS conjunction also never triggers: inactive categorical guards do not disable it. Active, unknown and absent categorical cases are covered synthetically.

## Representative changed intervals

Longest gained/lost intervals for D relative to V1 are shown below. Full structured reasons, thresholds, endpoint support and representative rows for all controls are in findings.json. Times are original parsed seconds; July retains negative times. Ranges are measured telemetry, not predicted outcomes.

| Log                     | Change | Rows         | Time s             | RPM        | MAP kPa    | TPS %      | AFR        | V1 midpoint reasons         | V2 midpoint reasons          |
| ----------------------- | ------ | ------------ | ------------------ | ---------- | ---------- | ---------- | ---------- | --------------------------- | ---------------------------- |
| 2025-04-12_16.16.28.msl | gained | 904..959     | 60.176..63.844     | 831..894   | 48.9..52.8 | 0.8..0.8   | 13.2..13.3 | INSUFFICIENT_STEADY_HISTORY | none                         |
| 2025-04-12_16.16.28.msl | lost   | 328..335     | 21.767..22.235     | 849..871   | 50.3..51   | 0.5..0.5   | 13.2..13.2 | none                        | STABILITY_SUPPORT_UNASSESSED |
| 2026-07-25_17.56.47.msl | gained | 2083..2140   | -733.268..-729.470 | 1066..1162 | 46.5..49.2 | 1.4..1.4   | 13.7..13.9 | INSUFFICIENT_STEADY_HISTORY | none                         |
| 2026-07-25_17.56.47.msl | lost   | 2461..2468   | -708.065..-707.599 | 1100..1114 | 48.4..48.8 | 1.3..1.3   | 13.8..13.8 | none                        | STABILITY_SUPPORT_UNASSESSED |
| 2026-08-01_09.45.13.msl | gained | 17668..17754 | 1177.949..1183.683 | 3871..3960 | 44.3..46.9 | 19..19.8   | 14.2..14.3 | INSUFFICIENT_STEADY_HISTORY | none                         |
| 2026-08-01_09.45.13.msl | lost   | 3818..3825   | 254.472..254.938   | 1067..1081 | 48.6..49.2 | 1.2..1.2   | 13.9..14   | none                        | STABILITY_SUPPORT_UNASSESSED |
| 2026-08-08_11.19.56.msl | gained | 45592..45709 | 3039.975..3047.767 | 4001..4099 | 45.2..47.4 | 19.3..19.9 | 13.6..14.1 | INSUFFICIENT_STEADY_HISTORY | none                         |
| 2026-08-08_11.19.56.msl | lost   | 3723..3730   | 248.166..248.626   | 1065..1104 | 46..46.8   | 1.2..1.2   | 13.4..13.4 | none                        | STABILITY_SUPPORT_UNASSESSED |

## Thresholds, provenance and limitations

All controls: 1 s support; >=9 observations; <=0.2 s adjacent observation gap; <=0.1 s endpoint bracketing; numerical jump boundary >50 rpm; both categorical guards required. Windowed RPM: absolute all-pair Theil-Sen slope <=200 rpm/s, Q90-Q10 <=100 rpm, full range <=150 rpm. Adjacent controls: absolute adjacent rate <=200 rpm/s throughout support. Base V1 thresholds remain unchanged. See the implementation documentation for every configurable field and boundary policy.

VE axes come from the matching real calibration tables. Block1 uses the retained original demo VE table copy; blocks2/3 use the original tables in their log directories. All share RPM [700,800,900,1000,1200,1500,2000,2500,3000,3500,4000,5000,6000,7000,8000,9000] and MAP kPa [30,40,45,50,55,60,65,70,80,90,100,125,150,175,200,260]. Neighborhoods use lower-inclusive/upper-exclusive bounds, last bound inclusive. Out-of-range inputs are assigned to the clamped edge neighborhood and separately counted. Neighborhood counts do not allocate bilinear weights or imply adequate tuning evidence.

findings.json records source hashes, full V1 output fingerprints, all status/reason counts, V1 transitions, paired-factor transitions, clamped counts, exact axes and representative changed intervals. neighborhood-counts.csv includes zero-count neighborhoods; band-counts.csv and region-counts.csv provide marginal coverage.

Recommendations: retain V1 as the default; review gained and lost intervals independently, especially closed-throttle and boost evidence; use time-separated validation partitions before considering promotion. The extra samples are strongly weighted toward idle and closed throttle. Boost acceptance remains sparse. Smooth acceleration outside the explicit stability limits is rejected, but bounded drift can pass; this experiment does not prove combustion/fueling equilibrium. No AFR delay compensation, VE correction, sensor-lag validation or UI changes were performed.

Regression checks compare complete V1 outputs before/after all four controls and fixed historical status counts. The V1 source SHA256 is 3d8a5b6fbd8595c19a4e2d3e3b8ef3510d0fee3c2a7c8ff0e9dae3e8b90b71eb. Regenerate findings.json using the opt-in environment variable documented in src/lib/server/analysis/sampleEligibilityV2.md; the Markdown and CSV files are review artifacts for this fixed run.
