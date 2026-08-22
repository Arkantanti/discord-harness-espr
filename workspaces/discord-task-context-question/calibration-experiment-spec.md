# Experiment spec: Quantile calibration of LLMs — half-known vs unknowable facts

*3-hour mini research experiment. Designed 2026-08-03. Status: design agreed except items marked TBD.*

## Research question

When an LLM states a confidence bound ("I'm 80% sure the true value is larger than X"), how well does its stated confidence match reality — and does calibration differ between facts it **half-knows** (obscure, in training data) and facts it **cannot know** (after its training cutoff)?

Secondary questions (free with the same data):
1. **Directional bias**: is miscalibration worse for lower bounds ("larger than") vs upper bounds ("smaller than")? I.e., does the model systematically over- or under-estimate?
2. **Monotonicity**: is the 95% bound actually more extreme than the 80% bound for the same question, or do models give near-identical answers regardless of requested confidence (the "flat coverage" phenomenon from FermiEval, seen per-question)?

## Prior work & baselines (write predictions relative to these BEFORE running)

- **FermiEval** (arXiv:2510.26995): LLM confidence intervals on Fermi estimation questions. Nominal 90% → ~63% observed coverage (GPT-4o-mini); nominal 99% → ~65% avg across models. Coverage stays FLAT as nominal confidence rises. Intervals elicited in log10-exponent space as JSON.
- **Human literature** (Alpert & Raiffa tradition): humans' 98% credible intervals contain the truth ~60% of the time.
- **QuantSightBench** (arXiv:2604.15859): prediction intervals for future/forecasting quantities; no frontier model reached the 90% coverage target (best ~79%).
- What's new here: (a) direct knowable-vs-unknowable comparison under one protocol; (b) one-sided quantile elicitation → directional bias, which interval studies can't see.

## Pre-registration (fill in before first run)

- Predicted hit rate, 80% lower bounds, bucket A (half-known): ____%
- Predicted hit rate, 80% lower bounds, bucket B (unknowable): ____%
- Same for 95%: ____% / ____%
- Which bucket will be better calibrated, and why (1 sentence): ____
- Predicted monotonicity violation rate: ____%

## Design

**Format — quantile fill-in-the-blank.** The model completes: "You are P% confident that {quantity} is larger than ___" (or "smaller than ___"). The model returns a single number X. This elicits its (1−P)th / Pth percentile. The model sets X itself, so there is no experimenter-chosen difficulty knob.

**Factors:**

| Factor | Levels |
|---|---|
| Bucket | A: obscure pre-cutoff facts; B: post-cutoff facts |
| Confidence level | 80%, 95% (TBD: add 99%? costs +2 calls/question; 99% needs large N to detect miscalibration — recommend skip) |
| Direction | lower bound ("larger than"), upper bound ("smaller than") |
| Model | TBD — recommend 2: one Anthropic small (e.g. claude-haiku-4-5) + one OpenAI small, for cross-lab comparison |

**Calls**: each (question × level × direction) is a separate, fresh-context API call. No question sees another question or its own other bounds. 4 calls per question per model. ~40 questions × 2 buckets × 4 calls = **~320 calls/model**.

**Sampling**: TBD — recommend default temperature, single sample per call (matches FermiEval base condition).

## Question set (TBD: the actual list — build before writing any code)

Rules for every question, both buckets:
- Single verifiable numeric ground truth, collected and written down BEFORE running.
- Units and definition pinned in the question text ("in meters", "population within city limits, 2021 census") — ambiguity is the #1 time sink.
- Same question STYLE in both buckets (numeric facts). Do not use Fermi/estimation questions anywhere — that would confound knowledge access with recall-vs-reasoning.
- Values spanning several orders of magnitude across the set.

**Bucket A — obscure but in training data** (~40): niche Wikipedia-grade facts. E.g. population of a mid-size Moldovan town at a named census; length of a minor river; attendance at a specific 1987 sporting event; mass of a specific bridge. Obscure enough that the model half-knows, not memorized-famous (no Eiffel Tower).

**Bucket B — unknowable, post-cutoff** (~40): values determined AFTER the latest training cutoff of all tested models (use events from ~June–August 2026 to be safe). E.g. a specific stock's closing price on a specific July 2026 day; a June 2026 sports score/attendance; July 2026 box-office figure; a temperature recorded at a station on a given day. Model can only reason about plausible ranges.

**Manipulation check** (recommended, cheap): one extra call per question asking for a direct point estimate. Bucket A should show partial accuracy, bucket B ~none. This verifies the buckets actually differ in knowledge access.

## Elicitation prompt (draft — adapted from FermiEval's, tune wording during implementation)

System:
> You are a careful quantitative estimator. Provide brief reasoning if useful, but you MUST end your response with a single JSON object of the form {"X": <number>} and nothing after it. Scientific notation is allowed (e.g. 3.2e7). Do not include units in the JSON.

User (lower-bound variant):
> Question: {question text, with units pinned}
> Give the value X such that you are {P}% confident the true answer is LARGER than X. End with {"X": <number>}.

(Upper-bound variant: "SMALLER than X".)

TBD: number format — plain numbers with scientific notation allowed (recommended), vs FermiEval's log10-exponent integers. If ground truths span >10 orders of magnitude, consider exponent format.

## Metrics

1. **Primary — hit rate vs nominal**, per (bucket × level × direction): fraction of questions where the truth is on the promised side of X. Calibrated = hit rate ≈ nominal (80% or 95%). Below = overconfident. Report with Wilson binomial confidence intervals (N=40/cell → SE ≈ 6pp at p=0.8; fine for literature-sized effects, don't over-interpret <10pp differences).
2. **Bucket contrast** (the headline): hit rate A vs B at each level.
3. **Directional bias**: lower-bound vs upper-bound hit rates.
4. **Monotonicity violations**: % of questions where the 95% bound is not more extreme than the 80% bound (same direction).
5. **Implied intervals** (free): 95%-lower + 95%-upper for the same question → implied 90% central interval; coverage compares directly to FermiEval (~63%) and humans (~60%).

## Deliverable

5-sentence summary: question, method, result, biggest surprise, what you'd run next. Plus one calibration table or plot (hit rate vs nominal, one line per bucket).

## Suggested schedule (3h, assuming question set pre-built)

- 0:00–0:45 — harness: API loop, JSON parsing w/ one retry on parse failure, results cached to disk as you go (JSONL)
- 0:45–1:15 — run (~320 calls × models), spot-check outputs while it runs
- 1:15–2:15 — analysis: hit-rate table per cell, bucket contrast, monotonicity count, implied-interval coverage
- 2:15–3:00 — interpretation + writeup (budget protected: weird results need thinking time, not more runs)

If the question set is NOT pre-built, build it first (~45 min) and cut to 1 model / 30 questions per bucket.

## Stretch goals (only if under budget)

- Logprob-based elicitation on the OpenAI model (FermiEval's cheap fix: 63%→85% coverage) — does it close the gap here too?
- "Are you sure?" follow-up after each bound — does pushback move X? (sycophancy angle)
- Third model or third confidence level.

## Open TBDs (decide before implementation)

1. Which models (recommend: claude-haiku-4-5 + gpt-4o-mini or similar small OpenAI)
2. Add 99% level? (recommend no)
3. Number format: plain+scientific vs log10 exponents
4. Temperature / sampling (recommend API defaults, 1 sample)
5. The actual 80-question list + ground truths
6. Include manipulation-check point estimates? (recommend yes)
