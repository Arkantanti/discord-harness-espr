"""
Percolation-style analysis of the RSI acceleration condition.

Background: Cunningham et al. (2026), "The Economics of Recursive
Self-Improvement", show that a self-sustaining acceleration in AI
capabilities occurs iff the dominant eigenvalue of the elasticity
matrix M of the innovation network exceeds 1: rho(M) > 1.

This is the same spectral condition as the epidemic threshold (R0 > 1),
branching-process survival, and directed percolation. Here we treat the
innovation network as a *random* directed graph with random elasticities
and ask two questions:

  Experiment 1 (phase diagram): where is the critical surface, and does
  heavy-tailed heterogeneity in elasticities shift it? We compare a
  lognormal and a Pareto (infinite-variance) weight distribution with
  the SAME mean, sweeping the mean-field loop gain n*p*E[w].

  Experiment 2 (calibration): using the paper's point estimates
  (return-to-research ~ 1, eps_C,A ~ 6.5, eps_R,C ~ 0.09 today,
  threshold 0.154), how far is the current AI feedback loop from
  criticality?

Run: python3 rsi_percolation.py   ->  prints numbers, saves 2 PNGs.
"""

import numpy as np
import matplotlib.pyplot as plt

rng = np.random.default_rng(42)

# ---------------------------------------------------------------- experiment 1

N = 40          # nodes in the innovation network
TRIALS = 200    # Monte Carlo samples per grid point
GAINS = np.linspace(0.2, 2.0, 25)   # mean-field loop gain  g = n * p * E[w]
MEAN_W = 0.05   # mean elasticity per edge; p is chosen from the target gain

PARETO_ALPHA = 1.2  # shape; alpha < 2 => infinite variance (heavy tail)


def sample_weights(dist, size):
    """Random elasticities with mean MEAN_W."""
    if dist == "lognormal":
        sigma = 1.0
        mu = np.log(MEAN_W) - 0.5 * sigma**2   # E = exp(mu + sigma^2/2)
        return rng.lognormal(mu, sigma, size)
    if dist == "pareto":
        xm = MEAN_W * (PARETO_ALPHA - 1) / PARETO_ALPHA  # E = alpha*xm/(alpha-1)
        return xm * (1 + rng.pareto(PARETO_ALPHA, size))
    raise ValueError(dist)


def p_supercritical(dist, gain):
    """P(rho(M) > 1) for random directed graphs at a given mean-field gain."""
    p = gain / (N * MEAN_W)
    hits = 0
    for _ in range(TRIALS):
        M = np.where(rng.random((N, N)) < p, sample_weights(dist, (N, N)), 0.0)
        rho = np.max(np.abs(np.linalg.eigvals(M)))
        hits += rho > 1
    return hits / TRIALS


curves = {d: np.array([p_supercritical(d, g) for g in GAINS])
          for d in ("lognormal", "pareto")}

for d, c in curves.items():
    # first gain where the network is supercritical in >5% of draws
    onset = GAINS[np.argmax(c > 0.05)]
    print(f"{d:9s}: 5% supercritical onset at mean-field gain ~ {onset:.2f}")

# ---------------------------------------------------------------- experiment 2

EPS_CA = 6.5          # capabilities elasticity to algorithmic efficiency (Epoch)
RETURN_TO_RD = 1.0    # g_A / g_R, both ~ ln(3)/yr in the paper's calibration
EPS_RC_TODAY = 0.09   # implied by 4x self-reported uplift over 16 ECI points
EPS_RC_CRIT = 1 / (RETURN_TO_RD * EPS_CA)

gain_today = RETURN_TO_RD * EPS_RC_TODAY * EPS_CA
print(f"critical eps_R,C = {EPS_RC_CRIT:.3f}; today's loop gain rho ~ {gain_today:.2f}"
      f"  ({gain_today:.0%} of criticality)")

# ---------------------------------------------------------------- figures

S = dict(surface="#1a1a19", ink="#ffffff", ink2="#c3c2b7", muted="#898781",
         grid="#2c2c2a", axis="#383835", blue="#3987e5", orange="#d95926")

plt.rcParams.update({
    "figure.facecolor": S["surface"], "axes.facecolor": S["surface"],
    "savefig.facecolor": S["surface"], "font.family": "sans-serif",
    "text.color": S["ink2"], "axes.labelcolor": S["ink2"],
    "xtick.color": S["muted"], "ytick.color": S["muted"],
    "axes.edgecolor": S["axis"], "axes.linewidth": 1.0,
    "axes.grid": True, "grid.color": S["grid"], "grid.linewidth": 0.8,
    "axes.spines.top": False, "axes.spines.right": False,
    "font.size": 11,
})

# --- figure 1: phase diagram
fig, ax = plt.subplots(figsize=(8, 5), dpi=150)
ax.axvline(1.0, color=S["axis"], lw=1.2, ls=(0, (4, 4)))
ax.text(1.02, 0.03, "mean-field critical point", color=S["muted"], fontsize=9)
ax.plot(GAINS, curves["lognormal"], color=S["blue"], lw=2, label="lognormal weights")
ax.plot(GAINS, curves["pareto"], color=S["orange"], lw=2,
        label=f"Pareto weights (α={PARETO_ALPHA}, same mean)")
ax.annotate("lognormal", (GAINS[16], curves["lognormal"][16]),
            xytext=(8, -14), textcoords="offset points", color=S["blue"])
ax.annotate("Pareto (heavy tail)", (GAINS[8], curves["pareto"][8]),
            xytext=(8, 6), textcoords="offset points", color=S["orange"])
ax.set_xlabel("mean-field loop gain  n·p·E[w]")
ax.set_ylabel("P( ρ(M) > 1 )   —  fraction of networks supercritical")
ax.set_title("Acceleration as a percolation transition on random innovation networks",
             color=S["ink"], fontsize=12, pad=12)
ax.legend(frameon=False, labelcolor=S["ink2"], loc="upper left")
ax.set_ylim(-0.02, 1.02)
fig.tight_layout()
fig.savefig("fig1_phase_diagram.png")

# --- figure 2: calibrated loop gain
eps = np.linspace(0, 0.25, 200)
gain = RETURN_TO_RD * EPS_CA * eps

fig, ax = plt.subplots(figsize=(8, 5), dpi=150)
ax.axhline(1.0, color=S["axis"], lw=1.2, ls=(0, (4, 4)))
ax.text(0.002, 1.03, "criticality: ρ = 1  (self-sustaining acceleration)",
        color=S["muted"], fontsize=9)
ax.plot(eps, gain, color=S["blue"], lw=2)
for x, label, dy in ((EPS_RC_TODAY, f"today?  ε≈{EPS_RC_TODAY}, ρ≈{gain_today:.2f}", -26),
                     (EPS_RC_CRIT, f"threshold  ε≈{EPS_RC_CRIT:.3f}", 14)):
    y = RETURN_TO_RD * EPS_CA * x
    ax.plot([x], [y], "o", ms=8, color=S["orange"],
            markeredgecolor=S["surface"], markeredgewidth=2)
    ax.annotate(label, (x, y), xytext=(10, dy), textcoords="offset points",
                color=S["ink"], fontsize=10)
ax.set_xlabel("ε_R,C  —  extra R&D effort per unit of AI capability (ECI)")
ax.set_ylabel("loop gain  ρ  =  (return to R&D) · ε_R,C · ε_C,A")
ax.set_title("The AI feedback loop is at ≈60% of criticality (paper's calibration)",
             color=S["ink"], fontsize=12, pad=12)
fig.tight_layout()
fig.savefig("fig2_loop_gain.png")

print("saved fig1_phase_diagram.png, fig2_loop_gain.png")
