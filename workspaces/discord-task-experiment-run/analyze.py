#!/usr/bin/env python3
"""Analysis for the quantile-calibration experiment.

Reads results.jsonl, prints hit-rate tables (Wilson CIs), bucket contrast,
directional bias, monotonicity violations, implied 90% interval coverage,
and manipulation-check accuracy. Writes calibration_plot.png.
"""
import json, math, sys
from collections import defaultdict
from pathlib import Path

WORKDIR = Path(__file__).parent


def wilson(k, n, z=1.96):
    if n == 0:
        return (float("nan"), float("nan"), float("nan"))
    p = k / n
    denom = 1 + z * z / n
    center = (p + z * z / (2 * n)) / denom
    half = z * math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / denom
    return p, center - half, center + half


def fmt_cell(k, n):
    p, lo, hi = wilson(k, n)
    return f"{100*p:5.1f}% [{100*lo:4.1f},{100*hi:5.1f}] (n={n})"


def main():
    path = Path(sys.argv[1]) if len(sys.argv) > 1 else WORKDIR / "results.jsonl"
    recs = [json.loads(l) for l in path.read_text().splitlines() if l.strip()]
    # keep last record per key (retries/reruns append)
    by_key = {}
    for r in recs:
        by_key[(r["model"], r["qid"], r["level"], r["direction"])] = r
    recs = list(by_key.values())
    models = sorted({r["model"] for r in recs})

    for model in models:
        mr = [r for r in recs if r["model"] == model]
        quant = [r for r in mr if r["direction"] in ("lower", "upper") and r.get("X") is not None]
        pts = [r for r in mr if r["direction"] == "point"]
        failed = [r for r in mr if r.get("X") is None]
        print(f"\n{'='*70}\nMODEL: {model}   ({len(mr)} records, {len(failed)} parse failures)\n{'='*70}")

        def hit(r):
            return r["truth"] > r["X"] if r["direction"] == "lower" else r["truth"] < r["X"]

        # 1. hit rate per (bucket, level, direction)
        print("\nHit rate vs nominal (per cell):")
        print(f"{'bucket':>6} {'level':>5} {'dir':>6}   observed")
        for b in ("A", "B"):
            for lv in (80, 95):
                for d in ("lower", "upper"):
                    cell = [r for r in quant if r["bucket"] == b and r["level"] == lv and r["direction"] == d]
                    k = sum(hit(r) for r in cell)
                    print(f"{b:>6} {lv:>5} {d:>6}   {fmt_cell(k, len(cell))}")

        # 2. bucket contrast (directions pooled)
        print("\nBucket contrast (pooled over direction):")
        for lv in (80, 95):
            for b in ("A", "B"):
                cell = [r for r in quant if r["bucket"] == b and r["level"] == lv]
                k = sum(hit(r) for r in cell)
                print(f"  nominal {lv}%  bucket {b}: {fmt_cell(k, len(cell))}")

        # 3. directional bias (buckets pooled)
        print("\nDirectional bias (pooled over bucket):")
        for lv in (80, 95):
            for d in ("lower", "upper"):
                cell = [r for r in quant if r["level"] == lv and r["direction"] == d]
                k = sum(hit(r) for r in cell)
                print(f"  nominal {lv}%  {d}: {fmt_cell(k, len(cell))}")

        # 4. monotonicity: 95% bound should be more extreme than 80% bound
        idx = {(r["qid"], r["level"], r["direction"]): r["X"] for r in quant}
        viol = tot = 0
        viol_by_bucket = defaultdict(lambda: [0, 0])
        for r in quant:
            if r["level"] != 80:
                continue
            x95 = idx.get((r["qid"], 95, r["direction"]))
            if x95 is None:
                continue
            tot += 1
            bad = (x95 > r["X"]) if r["direction"] == "lower" else (x95 < r["X"])
            viol += bad
            viol_by_bucket[r["bucket"]][0] += bad
            viol_by_bucket[r["bucket"]][1] += 1
        if tot:
            print(f"\nMonotonicity violations (95% not more extreme than 80%): "
                  f"{viol}/{tot} = {100*viol/tot:.1f}%")
            for b in ("A", "B"):
                v, n = viol_by_bucket[b]
                if n:
                    print(f"  bucket {b}: {v}/{n} = {100*v/n:.1f}%")

        # 5. implied 90% central interval from 95-lower & 95-upper
        print("\nImplied 90% central interval coverage (vs FermiEval ~63%, humans ~60%):")
        for b in ("A", "B", None):
            k = n = 0
            for r in quant:
                if r["level"] != 95 or r["direction"] != "lower":
                    continue
                if b and r["bucket"] != b:
                    continue
                hi = idx.get((r["qid"], 95, "upper"))
                if hi is None:
                    continue
                n += 1
                k += (r["X"] < r["truth"] < hi)
            label = f"bucket {b}" if b else "overall "
            print(f"  {label}: {fmt_cell(k, n)}")

        # 6. manipulation check: point-estimate log error by bucket
        print("\nManipulation check (point estimates, median |log10(est/truth)|):")
        for b in ("A", "B"):
            errs = []
            for r in pts:
                if r["bucket"] != b or r.get("X") in (None, 0) or r["truth"] <= 0:
                    continue
                if r["X"] <= 0:
                    continue
                errs.append(abs(math.log10(r["X"] / r["truth"])))
            if errs:
                errs.sort()
                med = errs[len(errs) // 2]
                within = sum(e < math.log10(2) for e in errs)
                print(f"  bucket {b}: median={med:.2f} OoM; within 2x of truth: "
                      f"{within}/{len(errs)} = {100*within/len(errs):.0f}%")

    # plot (last model)
    try:
        import matplotlib
        matplotlib.use("Agg")
        import matplotlib.pyplot as plt
        fig, ax = plt.subplots(figsize=(6.4, 4.4), dpi=150)
        colors = {"A": "#4269d0", "B": "#efb118"}
        labels = {"A": "A: half-known (pre-cutoff)", "B": "B: unknowable (post-cutoff)"}
        for b in ("A", "B"):
            xs, ys, los, his = [], [], [], []
            for lv in (80, 95):
                cell = [r for r in quant if r["bucket"] == b and r["level"] == lv]
                k = sum(hit(r) for r in cell)
                p, lo, hi = wilson(k, len(cell))
                xs.append(lv); ys.append(100*p); los.append(100*(p-lo)); his.append(100*(hi-p))
            ax.errorbar(xs, ys, yerr=[los, his], marker="o", capsize=4,
                        color=colors[b], label=labels[b])
        ax.plot([75, 100], [75, 100], "--", color="#9498a0", lw=1, label="perfect calibration")
        ax.set_xlabel("Nominal confidence (%)")
        ax.set_ylabel("Observed hit rate (%)")
        ax.set_title(f"Quantile calibration — {models[-1]}")
        ax.set_xticks([80, 95]); ax.set_xlim(75, 100); ax.set_ylim(40, 102)
        ax.legend(loc="lower right", fontsize=8)
        ax.grid(alpha=0.25)
        fig.tight_layout()
        out = WORKDIR / "calibration_plot.png"
        fig.savefig(out)
        print(f"\nplot -> {out}")
    except Exception as e:
        print(f"(plot skipped: {e})")


if __name__ == "__main__":
    main()
