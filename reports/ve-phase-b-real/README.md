# Default Phase B evaluation on real RX-7 logs

The existing pipeline was run once per log/profile with **no configuration overrides**. V2 means the unchanged default experimental windowed/centered profile. No thresholds, calibration tables, classifiers, prediction formulas or fitting algorithms were modified. No winning profile is selected from holdout outcomes.

All six runs passed assertions that preparation, classifier and fitting configurations equal their defaults, paired row IDs exactly match ready holdout rows, baseline/candidate counts match, prediction failures are zero, and all six classifier/preparation/fitting/prediction source hashes remain unchanged. Numerical fitting completes before holdout evaluation. Source hashes, source/table bindings, fixed configurations, row IDs, per-cell evidence and full pass/fold diagnostics are retained in findings.json.

## Calibration availability

- April 12 and July 25 use the retained, owner-confirmed block1 AFR/VE copies in src/lib/server/demo. The original block1 table files are no longer in data/logs/block1.
- August 8 uses the original AFR and VE tables in data/logs/block2.
- August 1 / block3: **unavailable**. A VE table exists, but its associated AFR table is absent; no other AFR calibration is substituted.
- March 28 CSV: **unsupported telemetry**. Its comma-separated MAP/port-state header lacks Time, RPM and measured AFR. The existing analysis pipeline cannot evaluate it; no calibration association is inferred.

## Episodes and eligible coverage

Global eligible is the unchanged full-log classifier count. Partition eligible is the classifier-eligible count within the selected partition (V2 is recomputed within partitions). Ready counts additionally require valid in-bounds AFR/VE observations and the evaluator support audit. Only ready training rows fit the table, and only ready holdout rows enter paired metrics. Episode counts below are both assigned and usable counts; they match in every run. Every split preserves complete episodes.

| Log                 | Profile | Global eligible / parsed | Train / holdout episodes | Train eligible -> ready | Holdout eligible -> ready | Actual embargo gap s |
| ------------------- | ------- | -----------------------: | ------------------------ | ----------------------- | ------------------------- | -------------------: |
| 2025-04-12_16.16.28 | V1      |               815 / 2859 | 2 / 2                    | 616 -> 607              | 199 -> 183                |               14.605 |
| 2025-04-12_16.16.28 | V2      |              1307 / 2859 | 2 / 2                    | 985 -> 985              | 296 -> 296                |               11.004 |
| 2026-07-25_17.56.47 | V1      |             6042 / 18990 | 23 / 8                   | 3237 -> 3235            | 2805 -> 2800              |               20.136 |
| 2026-07-25_17.56.47 | V2      |             8591 / 18990 | 17 / 7                   | 4998 -> 4993            | 3557 -> 3557              |               11.802 |
| 2026-08-08_11.19.56 | V1      |            17745 / 56284 | 45 / 28                  | 13961 -> 13950          | 3784 -> 3780              |               13.403 |
| 2026-08-08_11.19.56 | V2      |            26256 / 56284 | 33 / 21                  | 20128 -> 20128          | 6100 -> 6091              |               12.676 |

No complete episodes were embargoed in these runs; the selected between-episode gaps already met the 10 s requirement. Individual rows in those gaps remain excluded. The requested 70% chronological training allocation does not promise 70% of accepted samples. For example, the July holdout is dominated by idle/closed-throttle operation. Actual row bounds, parsed times and episodes are in findings.json.

## Cell decisions

Every VE table has 256 vertices. Supported means Phase A training evidence passed. Accepted and suppressed partition those supported cells. Unsupported cells are not numerically fitted and remain unchanged. Reason counts overlap.

| Log                 | Profile | Supported | Accepted | Suppressed | Unsupported | Unsupported: samples / episodes | Fitting suppression                                                          |
| ------------------- | ------- | --------: | -------: | ---------: | ----------: | ------------------------------- | ---------------------------------------------------------------------------- |
| 2025-04-12_16.16.28 | V1      |         0 |        0 |          0 |         256 | 249 / 256                       | none                                                                         |
| 2025-04-12_16.16.28 | V2      |         0 |        0 |          0 |         256 | 249 / 256                       | none                                                                         |
| 2026-07-25_17.56.47 | V1      |         6 |        4 |          2 |         250 | 232 / 250                       | BELOW_MINIMUM_PROPOSAL: 2                                                    |
| 2026-07-25_17.56.47 | V2      |         6 |        3 |          3 |         250 | 225 / 250                       | BELOW_MINIMUM_PROPOSAL: 1; LOO_DIRECTION_UNSTABLE: 1; LOO_EXCESSIVE_RANGE: 2 |
| 2026-08-08_11.19.56 | V1      |         5 |        4 |          1 |         251 | 234 / 251                       | BELOW_MINIMUM_PROPOSAL: 1                                                    |
| 2026-08-08_11.19.56 | V2      |        11 |        8 |          3 |         245 | 213 / 245                       | BELOW_MINIMUM_PROPOSAL: 1; LOO_EXCESSIVE_RANGE: 2; LOO_DIRECTION_UNSTABLE: 1 |

April has only two training episodes under either profile. Consequently all cells fail the default three-qualifying-episode gate, even if their raw sample counts are large. Conditioning, convergence and leave-out stability are **not assessed**, rather than failed, for those unfitted cells.

## All accepted corrections

These are conditional experimental model candidates, not tune changes to apply. Cell coordinates are table **vertices**, not interpolation-neighborhood averages. Neighbors share influence. Samples below meet the material influence threshold; qualifying episodes meet the continuous-duration gate. Bounds are +/-3%. A starred change hits a bound.

| Log                 | Profile | RPM / MAP kPa | Original -> candidate VE |   Change % | Material training rows | Qualifying episodes | LOO min..max %       |
| ------------------- | ------- | ------------- | ------------------------ | ---------: | ---------------------: | ------------------: | -------------------- |
| 2026-07-25_17.56.47 | V1      | 1200 / 40     | 42.3000 -> 41.2236       |  -2.544678 |                    309 |                   4 | -2.713659..-0.996694 |
| 2026-07-25_17.56.47 | V1      | 1000 / 45     | 39.3000 -> 40.4790       | +3.000000* |                   1047 |                   4 | +2.147227..+3.000000 |
| 2026-07-25_17.56.47 | V1      | 1500 / 45     | 38.8000 -> 38.4504       |  -0.901078 |                    183 |                   3 | -1.026272..-0.663262 |
| 2026-07-25_17.56.47 | V1      | 1200 / 50     | 39.5000 -> 38.7525       |  -1.892367 |                   1778 |                  11 | -2.713507..-0.997952 |
| 2026-07-25_17.56.47 | V2      | 1200 / 40     | 42.3000 -> 41.2065       |  -2.585051 |                    436 |                   4 | -2.796188..-1.021302 |
| 2026-07-25_17.56.47 | V2      | 1000 / 45     | 39.3000 -> 40.2365       |  +2.382919 |                   1768 |                   5 | +1.253181..+2.977464 |
| 2026-07-25_17.56.47 | V2      | 1500 / 45     | 38.8000 -> 38.4144       |  -0.993880 |                    279 |                   3 | -1.065320..-0.691841 |
| 2026-08-08_11.19.56 | V1      | 1000 / 45     | 38.9000 -> 39.6778       |  +1.999375 |                  10097 |                  22 | +1.467490..+2.188234 |
| 2026-08-08_11.19.56 | V1      | 1200 / 45     | 38.1000 -> 37.5395       |  -1.471000 |                   9638 |                  22 | -1.686158..-1.084301 |
| 2026-08-08_11.19.56 | V1      | 1200 / 50     | 39.1000 -> 39.7187       |  +1.582264 |                  11737 |                  27 | +1.207163..+2.399462 |
| 2026-08-08_11.19.56 | V1      | 3500 / 50     | 51.9000 -> 52.9070       |  +1.940183 |                    464 |                   4 | +1.318134..+2.059229 |
| 2026-08-08_11.19.56 | V2      | 1200 / 40     | 38.6000 -> 37.4420       | -3.000000* |                    917 |                   4 | -3.000000..-3.000000 |
| 2026-08-08_11.19.56 | V2      | 1000 / 45     | 38.9000 -> 39.6995       |  +2.055366 |                  13348 |                  22 | +1.398844..+2.470426 |
| 2026-08-08_11.19.56 | V2      | 1200 / 45     | 38.1000 -> 37.3899       |  -1.863796 |                  13263 |                  22 | -2.143357..-1.316434 |
| 2026-08-08_11.19.56 | V2      | 3000 / 45     | 50.6000 -> 51.2032       |  +1.192187 |                    336 |                   3 | +0.423845..+1.451810 |
| 2026-08-08_11.19.56 | V2      | 3500 / 45     | 49.2000 -> 49.9167       |  +1.456662 |                    355 |                   3 | +1.100139..+1.701897 |
| 2026-08-08_11.19.56 | V2      | 1200 / 50     | 39.1000 -> 40.2730       | +3.000000* |                  15747 |                  24 | +2.926129..+3.000000 |
| 2026-08-08_11.19.56 | V2      | 3500 / 50     | 51.9000 -> 52.9027       |  +1.931891 |                    611 |                   5 | +0.973474..+2.121355 |
| 2026-08-08_11.19.56 | V2      | 3000 / 55     | 53.4000 -> 54.5307       |  +2.117442 |                    380 |                   4 | +0.826002..+2.399229 |

Bound hits: July V1 (1000 rpm,45 kPa) +3%; August 8 V2 (1200,40) -3% and (1200,50) +3%. All August 8 V2 leave-out estimates at (1200,40) equal -3%; zero range here reflects saturation at the constraint and is not evidence of a precisely estimated unconstrained correction.

## All supported-but-suppressed cells

Every suppressed final correction is zero. Last proposal and leave-out diagnostics explain why it was frozen; they are not applied corrections. Small proposals are removed before leave-out fitting, so their LOO result is not assessed.

| Log                 | Profile | RPM / MAP kPa | Last proposal % | Material rows / qualifying episodes | Reason                                      | LOO min..max %, range pp       |
| ------------------- | ------- | ------------- | --------------: | ----------------------------------- | ------------------------------------------- | ------------------------------ |
| 2026-07-25_17.56.47 | V1      | 1200 / 45     |       -0.067812 | 1758 / 10                           | BELOW_MINIMUM_PROPOSAL                      | not assessed                   |
| 2026-07-25_17.56.47 | V1      | 1000 / 50     |       +0.057902 | 1224 / 8                            | BELOW_MINIMUM_PROPOSAL                      | not assessed                   |
| 2026-07-25_17.56.47 | V2      | 1200 / 45     |       -0.374886 | 2671 / 10                           | BELOW_MINIMUM_PROPOSAL                      | not assessed                   |
| 2026-07-25_17.56.47 | V2      | 1000 / 50     |       +0.726001 | 2187 / 9                            | LOO_DIRECTION_UNSTABLE, LOO_EXCESSIVE_RANGE | -0.442476..+1.957101; 2.399577 |
| 2026-07-25_17.56.47 | V2      | 1200 / 50     |       -1.412336 | 2886 / 12                           | LOO_EXCESSIVE_RANGE                         | -2.617460..-0.266113; 2.351347 |
| 2026-08-08_11.19.56 | V1      | 1000 / 50     |       +0.060383 | 9342 / 22                           | BELOW_MINIMUM_PROPOSAL                      | not assessed                   |
| 2026-08-08_11.19.56 | V2      | 1000 / 50     |       -0.022028 | 12752 / 18                          | BELOW_MINIMUM_PROPOSAL                      | not assessed                   |
| 2026-08-08_11.19.56 | V2      | 3000 / 50     |       +1.853072 | 385 / 3                             | LOO_EXCESSIVE_RANGE                         | +0.100045..+2.185269; 2.085224 |
| 2026-08-08_11.19.56 | V2      | 3500 / 55     |       +2.290993 | 293 / 4                             | LOO_DIRECTION_UNSTABLE, LOO_EXCESSIVE_RANGE | -0.047288..+3.000000; 3.047288 |

## Identical-row heldout comparison

MAE/RMSE are in AFR units. Each baseline uses observed AFR with the original table; each candidate uses the Phase A conditional proportional-fueling prediction. Both use the same per-row interpolated target and **exactly the same row IDs within that run**. Unchanged and worsened rows are retained. There are no prediction failures. V1 and V2 use different episodes and accepted row sets, so their absolute metrics are not a controlled profile ranking.

| Log                 | Profile | Paired rows | Affected rows | MAE baseline -> candidate | RMSE baseline -> candidate | Predicted delta MAE / RMSE |
| ------------------- | ------- | ----------: | ------------: | ------------------------- | -------------------------- | -------------------------- |
| 2025-04-12_16.16.28 | V1      |         183 |             0 | 0.159216 -> 0.159216      | 0.198311 -> 0.198311       | +0.000000 / +0.000000      |
| 2025-04-12_16.16.28 | V2      |         296 |             0 | 0.191787 -> 0.191787      | 0.252810 -> 0.252810       | +0.000000 / +0.000000      |
| 2026-07-25_17.56.47 | V1      |        2800 |          2787 | 0.151318 -> 0.151370      | 0.199082 -> 0.189210       | +0.000052 / -0.009872      |
| 2026-07-25_17.56.47 | V2      |        3557 |          3493 | 0.163395 -> 0.181344      | 0.229202 -> 0.228240       | +0.017949 / -0.000961      |
| 2026-08-08_11.19.56 | V1      |        3780 |          3572 | 0.199663 -> 0.160589      | 0.262920 -> 0.233809       | -0.039074 / -0.029111      |
| 2026-08-08_11.19.56 | V2      |        6091 |          5580 | 0.240095 -> 0.188106      | 0.350643 -> 0.325087       | -0.051989 / -0.025556      |

July V1 slightly worsens heldout model-based MAE while lowering RMSE. July V2 worsens MAE and only slightly lowers RMSE. Both August candidates reduce their own heldout MAE/RMSE under the simplifying model. April is exactly unchanged because no corrections are supported. These outcomes do not select a winning profile or demonstrate measured engine improvement.

## Conditioning, convergence and stability

| Log                 | Profile | Active cells per pass | Full-fit iterations per pass | Max full/fold condition | Max full/fold iterations | Max projected gradient |
| ------------------- | ------- | --------------------- | ---------------------------- | ----------------------: | -----------------------: | ---------------------: |
| 2025-04-12_16.16.28 | V1      | not fitted            | not assessed                 |            not assessed |             not assessed |           not assessed |
| 2025-04-12_16.16.28 | V2      | not fitted            | not assessed                 |            not assessed |             not assessed |           not assessed |
| 2026-07-25_17.56.47 | V1      | 6, 4                  | 110, 52                      |                6.257183 |                      110 |              9.505e-11 |
| 2026-07-25_17.56.47 | V2      | 6, 5, 3               | 141, 79, 19                  |                4.907767 |                      141 |              9.989e-11 |
| 2026-08-08_11.19.56 | V1      | 5, 4                  | 134, 93                      |                4.826678 |                      134 |              9.994e-11 |
| 2026-08-08_11.19.56 | V2      | 11, 10, 8             | 219, 185, 108                |                4.983300 |                      219 |              9.991e-11 |

All tested full/fold groups were full rank and below the default condition limit 1000. No conditioning suppression occurred in these real runs. Every attempted full fit and LOO solve converged (limit 5000 iterations, projected-gradient tolerance 1e-10). Suppression came from the minimum 0.5% proposal gate and, for V2, direction instability or a LOO range above 2 percentage points. Frozen cells were refitted out of the system; the final candidates were not post-fit clipped. Folds require two remaining qualifying episodes, preserving the original full-training evidence gates.

A well-conditioned, converged fit is numerically identifiable under this model; it does not establish physical causality. Episodes and overlapping classifier windows remain correlated. LOO envelopes describe sensitivity, not confidence intervals. Whole connected groups could be suppressed conservatively in other datasets, although none were here.

## Non-idle and load coverage

Cruise-like means VSS1>1 mph, TPS>2% and MAP<70 kPa; moderate load is MAP>=70 kPa up to recorded barometric pressure; boost is MAP above barometric pressure. These descriptive reporting bands do not change eligibility. Other low-load rows are separated into idle-like, closed-throttle/non-idle, or motion-unverified. April lacks VSS1 and is not claimed as validated cruise.

| Log                 | Profile | Cruise ready train / holdout | Moderate ready train / holdout | Boost ready train / holdout |
| ------------------- | ------- | ---------------------------- | ------------------------------ | --------------------------- |
| 2025-04-12_16.16.28 | V1      | 0 / 0                        | 0 / 0                          | 0 / 0                       |
| 2025-04-12_16.16.28 | V2      | 0 / 0                        | 0 / 0                          | 0 / 0                       |
| 2026-07-25_17.56.47 | V1      | 617 / 11                     | 141 / 0                        | 7 / 0                       |
| 2026-07-25_17.56.47 | V2      | 882 / 17                     | 199 / 0                        | 7 / 0                       |
| 2026-08-08_11.19.56 | V1      | 893 / 382                    | 241 / 51                       | 0 / 15                      |
| 2026-08-08_11.19.56 | V2      | 2032 / 1036                  | 342 / 44                       | 60 / 17                     |

- **Useful low-load non-idle evidence is present in August.** V1 accepts the 3500 rpm / 50 kPa vertex using 464 materially influenced training samples across four qualifying episodes. V2 accepts 3000/45 (336 samples, three episodes), 3500/45 (355, three), 3500/50 (611, five), and 3000/55 (380, four). These vertices affect neighboring cruise neighborhoods. Several V2 neighboring vertices are explicitly suppressed for LOO instability, so this is partial support, not a uniformly supported high-RPM region.
- **Moderate-load rows are present but no moderate-load cell correction is supported.** July has 141/199 moderate-load training rows but none in holdout. August has 241/342 training and 51/44 holdout rows (V1/V2), spread across neighborhoods with insufficient qualifying per-cell episodes. Accepted vertices are all at MAP<=55 kPa and affect only neighborhoods up to 60 kPa. Consequently moderate-load and boost evaluation rows remain unchanged by these candidates.
- **Boost remains unsupported for fitting.** Available boost samples are sparse and concentrated in few episodes. Their presence is not evidence for recommending a boost-region correction.

| Log                 | Profile | Changed neighborhoods with affected holdout rows | Changed but unassessed neighborhoods |
| ------------------- | ------- | -----------------------------------------------: | -----------------------------------: |
| 2025-04-12_16.16.28 | V1      |                                                0 |                                    0 |
| 2025-04-12_16.16.28 | V2      |                                                0 |                                    0 |
| 2026-07-25_17.56.47 | V1      |                                                5 |                                    7 |
| 2026-07-25_17.56.47 | V2      |                                                4 |                                    6 |
| 2026-08-08_11.19.56 | V1      |                                                8 |                                    4 |
| 2026-08-08_11.19.56 | V2      |                                               15 |                                    6 |

Shared interpolation means changed vertices affect neighboring coordinates even where no eligible holdout observations exist. Those effects remain unassessed; this run does not authorize applying the candidate to an ECU.

## Files, verification and limitations

- findings.json: six complete run reports, source hashes, defaults, episodes, all 256 cells per run, original/candidate tables, full conditioning and fold diagnostics, exact evaluation row IDs and paired metrics.
- cell-decisions.csv: every original VE cell with evidence, correction, suppression and stability fields.
- coverage-and-metrics.csv: one summary per log/profile.
- Six read-only pipeline checks passed in 102.50 s. The temporary execution harness was removed afterward. Only analysis reports were added.

All runs retain zero/unimplemented AFR sensor/transport delay. Predictions assume unchanged air mass and other fueling factors, proportional fuel response to VE, valid calibration association and active ECU table behavior. Closed-loop corrections, injector behavior, sensor bias and target switching may invalidate that model. No measured improvements, profile promotion, threshold optimization or automatic tuning application are claimed.
