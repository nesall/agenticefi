# Supported AFR error neighborhoods

This read-only analysis uses the unchanged V1 profile and the default V2 experimental profile (windowed RPM, centered support). No classifier thresholds, application code, tables or UI were changed. AFR delay remains the unimplemented 0 ms placeholder.

Matching calibration is available for April 12 and July 25 (confirmed block1 demo copies) and August 8 (block2 originals). AFR fixture/demo/block2 files have identical SHA256 b6cacdb5bfd644d58b2cce0b799638f841c6ff48f47019d4a445b2e0f8da3eb1. August 1 is omitted because block3 has no associated AFR table available; another table is not assumed to apply.

## Selected neighborhoods

Selection emphasizes substantial V1 support and repeated contiguous accepted intervals, with a moderate-load comparison included to show sensitivity. These samples are correlated, not independent trials. Neighborhood limits are lower-inclusive/upper-exclusive; no coordinates or targets were clamped. Logs are kept separate.

- **A**: 2025-04-12_16.16.28.msl, RPM 800-900, MAP 50-55 kPa; idle-like.
- **B**: 2026-07-25_17.56.47.msl, RPM 1000-1200, MAP 45-50 kPa; mixed idle-like / closed-throttle.
- **C**: 2026-07-25_17.56.47.msl, RPM 4000-5000, MAP 55-60 kPa; cruise-like.
- **D**: 2026-08-08_11.19.56.msl, RPM 3000-3500, MAP 45-50 kPa; cruise-like.
- **E**: 2026-08-08_11.19.56.msl, RPM 2000-2500, MAP 70-80 kPa; moderate load; V2 dispersion warning.

Interpolated targets are calculated at each actual sample RPM/MAP, then summarized. Signed error is measured minus target; a positive value is higher AFR than target. Median error is the median of row errors, not the difference between the measured and target medians. SD is population standard deviation, MAD is unscaled, and IQR is Q75-Q25. All statistics are in AFR units.

| Neighborhood | Profile |    n | Measured mean / median | Target mean / median | Error mean / median | Measured SD | Error SD | Error IQR |
| ------------ | ------- | ---: | ---------------------- | -------------------- | ------------------- | ----------: | -------: | --------: |
| A            | V1      |  327 | 13.249 / 13.200        | 13.211 / 13.204      | +0.037 / -0.002     |       0.153 |    0.154 |     0.134 |
| A            | V2      |  526 | 13.262 / 13.300        | 13.211 / 13.206      | +0.050 / +0.066     |       0.168 |    0.169 |     0.131 |
| B            | V1      | 4219 | 13.400 / 13.400        | 13.446 / 13.454      | -0.047 / -0.067     |       0.183 |    0.188 |     0.199 |
| B            | V2      | 5877 | 13.425 / 13.400        | 13.441 / 13.450      | -0.016 / -0.053     |       0.212 |    0.216 |     0.232 |
| C            | V1      |   86 | 13.788 / 13.800        | 13.909 / 13.908      | -0.120 / -0.108     |       0.078 |    0.075 |     0.100 |
| C            | V2      |   81 | 13.807 / 13.800        | 13.911 / 13.908      | -0.104 / -0.107     |       0.087 |    0.085 |     0.181 |
| D            | V1      |  265 | 14.388 / 14.400        | 14.176 / 14.182      | +0.211 / +0.211     |       0.054 |    0.045 |     0.015 |
| D            | V2      |  328 | 14.395 / 14.400        | 14.178 / 14.182      | +0.217 / +0.211     |       0.061 |    0.053 |     0.029 |
| E            | V1      |   74 | 14.578 / 14.600        | 14.127 / 14.116      | +0.452 / +0.452     |       0.041 |    0.035 |     0.048 |
| E            | V2      |   77 | 14.636 / 14.600        | 14.096 / 14.108      | +0.540 / +0.456     |       0.258 |    0.330 |     0.052 |

## Eligibility changes and temporal support

Gained/lost counts compare valid, grouped contributing rows in the same neighborhood; neither profile is assumed to be ground truth. Contiguous runs require adjacent original row indices and a positive time increment <=0.2 s. Run counts describe neighborhood membership and eligibility together.

| Neighborhood | Retained | Gained by V2 | Lost by V2 | V1 runs (>=1 s) | V2 runs (>=1 s) | V1 reasons on gained rows                                                            | V2 reasons on lost rows                                 |
| ------------ | -------: | -----------: | ---------: | --------------- | --------------- | ------------------------------------------------------------------------------------ | ------------------------------------------------------- |
| A            |      254 |          272 |         73 | 43 (6)          | 49 (10)         | INSUFFICIENT_STEADY_HISTORY: 259; RPM_TRANSIENT: 13; STEADY_WINDOW_UNASSESSED: 13    | STABILITY_SUPPORT_UNASSESSED: 73                        |
| B            |     4029 |         1848 |        190 | 156 (58)        | 138 (59)        | INSUFFICIENT_STEADY_HISTORY: 1716; RPM_TRANSIENT: 132; STEADY_WINDOW_UNASSESSED: 132 | STABILITY_SUPPORT_UNASSESSED: 189; RPM_WINDOW_SPREAD: 1 |
| C            |       70 |           11 |         16 | 2 (2)           | 3 (2)           | INSUFFICIENT_STEADY_HISTORY: 11                                                      | STABILITY_SUPPORT_UNASSESSED: 16                        |
| D            |      240 |           88 |         25 | 10 (6)          | 8 (6)           | RPM_TRANSIENT: 9; STEADY_WINDOW_UNASSESSED: 9; INSUFFICIENT_STEADY_HISTORY: 79       | STABILITY_SUPPORT_UNASSESSED: 25                        |
| E            |       58 |           19 |         16 | 2 (2)           | 3 (2)           | INSUFFICIENT_STEADY_HISTORY: 19                                                      | STABILITY_SUPPORT_UNASSESSED: 16                        |

Gains mainly remove the V1 trailing-history requirement or recover bounded RPM variation. Losses mainly result from centered/support boundaries. V2 is not a strict superset of V1.

| Neighborhood | Profile | Longest accepted interval: original rows | Time seconds      | Samples |
| ------------ | ------- | ---------------------------------------- | ----------------- | ------: |
| A            | V1      | 128-168                                  | 8.433-11.101      |      41 |
| A            | V2      | 87-182                                   | 5.700-12.034      |      96 |
| B            | V1      | 17507-17816                              | 295.213-315.813   |     310 |
| B            | V2      | 16935-17854                              | 257.073-318.348   |     920 |
| C            | V1      | 9914-9975                                | -211.125--207.057 |      62 |
| C            | V2      | 9910-9967                                | -211.392--207.595 |      58 |
| D            | V1      | 27700-27764                              | 1846.891-1851.159 |      65 |
| D            | V2      | 27642-27761                              | 1843.031-1850.958 |     120 |
| E            | V1      | 6385-6428                                | 425.654-428.515   |      44 |
| E            | V2      | 6378-6420                                | 425.191-427.987   |      43 |

## Findings and cautions

- **D is the clearest repeated non-idle offset** in this selection: mean error +0.211 (V1) / +0.217 (V2), error SD 0.045 / 0.053, and 265 / 328 samples across 10 / 8 intervals. All contributing rows are cruise-like by VSS1/TPS/MAP. This is a measured deviation from the supplied calibration, not proof of a VE error.
- **C has a small negative offset** with low dispersion: mean error -0.120 / -0.104. Most support comes from two multi-second intervals, so 86 / 81 samples do not represent that many independent operating episodes.
- **A and B have substantial low-RPM support**, but B mixes idle-like and closed-throttle/non-idle telemetry; a pooled low-RPM mean is not a universal idle or cruise conclusion. A has 327 / 526 idle-like samples and near-zero median error under V1.
- **E is a sensitivity warning.** V2 retains 58, gains 19 and loses 16 samples. Its error SD rises from 0.035 to 0.330 while median error stays +0.452 / +0.456. Five V2-only rows 27256-27260 (1817.303-1817.555 s) include measured AFR up to 15.6 and error up to +1.788. Those five rows form a short neighborhood visit, although their classifier support window is longer. Increased acceptance is not evidence of improved accuracy.
- None of these selected neighborhoods is in boost. There is insufficient repeated boost support here to present boost as comparably well supported.

## Coverage/provenance

| Log                     | V1 eligible / grouped | V2 eligible / grouped |
| ----------------------- | --------------------: | --------------------: |
| 2025-04-12_16.16.28.msl |             815 / 815 |           1307 / 1307 |
| 2026-07-25_17.56.47.msl |           6042 / 6042 |           8591 / 8586 |
| 2026-08-08_11.19.56.msl |         17745 / 17745 |         26256 / 26247 |

Five July and nine August 8 V2-eligible rows are not grouped because their coordinates fall outside the target AFR domain; they are not padded or clamped. findings.json retains source/table hashes, unchanged profile configurations, global availability counts, all populated neighborhood statistics, gained/lost evidence, representative supporting rows and their actual interpolation corners/weights. neighborhood-statistics.csv is the flat export for all populated neighborhoods and both profiles.

Limitations: zero/unimplemented AFR delay compensation; quantized measured AFR; autocorrelated samples and windows; categorical cut channels record Inactive in these logs; target table association is supplied calibration, not independently observed ECU target switching. No causal fueling conclusion, correction factor, VE change or prediction is produced.
