# Pre-registration — quantile calibration experiment

Recorded 2026-08-03 ~14:10 UTC, BEFORE any experimental calls were made.
Model under test: claude-haiku-4-5 (via claude CLI, default sampling, tools disabled).

## Assistant's predictions (Claude, experiment operator)

- Predicted hit rate, 80% lower bounds, bucket A (half-known): **62%**
- Predicted hit rate, 80% lower bounds, bucket B (unknowable): **72%**
- Predicted hit rate, 95% lower bounds, bucket A: **72%**
- Predicted hit rate, 95% lower bounds, bucket B: **82%**
- Which bucket better calibrated + why: **B — on facts it half-remembers the model anchors hard on a noisy recalled value and gives narrow bounds; on unknowable facts it knows it doesn't know and widens.**
- Predicted monotonicity violation rate: **12%**
- (Directional prior: expect worse calibration on upper bounds — models seem more reluctant to name very large numbers than very small ones.)

## arkantanti's predictions

- (awaiting reply in Discord thread; will be pasted here verbatim on arrival —
  still pre-registered as long as it lands before results are analyzed)
