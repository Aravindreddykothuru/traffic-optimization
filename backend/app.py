"""
Traffic Signal Optimization — Flask REST API
==============================================
Multi-Armed Bandit (UCB1, UCB-V) + Online Convex Optimization (OGD)
with Webster's Delay Formula as the reward/cost model.
"""

import os, math, random, copy, json
from pathlib import Path

import numpy as np
from flask import Flask, jsonify, request, send_from_directory
from flask_cors import CORS

try:
    import pandas as pd
    HAS_PANDAS = True
except ImportError:
    HAS_PANDAS = False

# ──────────────────────────────────────────────
# App setup
# ──────────────────────────────────────────────
STATIC_DIR = Path(__file__).parent / "static"
app = Flask(__name__, static_folder=str(STATIC_DIR), static_url_path="")
CORS(app)

# ──────────────────────────────────────────────
# Configuration constants
# ──────────────────────────────────────────────
ARMS = [20, 35, 50, 65, 80]          # green durations in seconds
K = len(ARMS)
CYCLE_LENGTH = 120                    # total signal cycle (seconds)
SATURATION_FLOW = 1800                # vehicles / hour of green
AGENT_NAMES = ["UCB1", "UCB-V", "OCO-OGD", "FixedTimer", "Random"]

HARDCODED_HOURLY = [
    200, 150, 100, 80, 90, 180, 450, 900,
    1100, 850, 700, 750, 800, 780, 720, 850,
    1050, 1200, 1100, 900, 700, 550, 400, 280,
]

# ──────────────────────────────────────────────
# Load hourly traffic volumes
# ──────────────────────────────────────────────
def load_hourly_volumes() -> list[float]:
    csv_path = Path(__file__).parent / "Metro_Interstate_Traffic_Volume.csv"
    if csv_path.exists() and HAS_PANDAS:
        try:
            df = pd.read_csv(csv_path)
            df["date_time"] = pd.to_datetime(df["date_time"])
            df["hour"] = df["date_time"].dt.hour
            hourly = df.groupby("hour")["traffic_volume"].mean()
            volumes = [float(hourly.get(h, HARDCODED_HOURLY[h])) for h in range(24)]
            return volumes
        except Exception:
            pass
    return list(map(float, HARDCODED_HOURLY))

HOURLY_VOLUMES = load_hourly_volumes()

# ──────────────────────────────────────────────
# Webster's Delay Formula
# ──────────────────────────────────────────────
def websters_delay(green_time: float, volume: float) -> float:
    """
    Compute average vehicle delay (seconds/vehicle) using Webster's formula.
    d = (C(1-λ)^2) / (2(1-λx)) + x^2 / (2q(1-x))  −  0.65*(C/q^2)^(1/3) * x^(2+5λ)
    Simplified two-term version used here for stability.
    """
    C = CYCLE_LENGTH
    lam = green_time / C                           # green ratio
    capacity = SATURATION_FLOW * lam               # capacity (veh/h)
    if capacity <= 0:
        return 999.0
    x = min(volume / capacity, 0.98)               # degree of saturation (cap at 0.98)

    # Uniform delay term
    denom1 = max(1 - lam * x, 0.01)
    d1 = (C * (1 - lam) ** 2) / (2 * denom1)

    # Over-saturation delay term
    denom2 = max(1 - x, 0.02)
    q = max(volume, 1)
    d2 = (x ** 2) / (2 * q * denom2)

    delay = d1 + d2
    return max(delay, 0.0)

def compute_delays_for_hour(hour: int) -> list[float]:
    """Return delay for every arm for a given hour."""
    vol = HOURLY_VOLUMES[hour % 24]
    return [websters_delay(g, vol) for g in ARMS]

# ──────────────────────────────────────────────
# Agent implementations
# ──────────────────────────────────────────────
def _new_agent_state():
    return {
        "counts": [0] * K,
        "sum_rewards": [0.0] * K,
        "sum_sq_rewards": [0.0] * K,
        "total_delay": 0.0,
        "total_steps": 0,
        "cumulative_regret": 0.0,
        "regret_history": [],
        "delay_history": [],
        "arm_history": [],
    }


class UCB1Agent:
    C = 2.0

    @staticmethod
    def select(state, t):
        for a in range(K):
            if state["counts"][a] == 0:
                return a
        vals = []
        for a in range(K):
            n = state["counts"][a]
            mu = state["sum_rewards"][a] / n
            bonus = UCB1Agent.C * math.sqrt(math.log(t) / n)
            vals.append(mu + bonus)
        return int(np.argmax(vals))

    @staticmethod
    def ucb_values(state, t):
        """Return per-arm UCB details."""
        out = []
        for a in range(K):
            n = state["counts"][a]
            if n == 0:
                out.append({"arm": a, "green": ARMS[a], "count": 0,
                            "mean_reward": 0, "bonus": float("inf"), "ucb": float("inf")})
            else:
                mu = state["sum_rewards"][a] / n
                bonus = UCB1Agent.C * math.sqrt(math.log(max(t, 1)) / n)
                out.append({"arm": a, "green": ARMS[a], "count": n,
                            "mean_reward": round(mu, 4), "bonus": round(bonus, 4),
                            "ucb": round(mu + bonus, 4)})
        return out


class UCBVAgent:
    C = 1.0
    b = 1.0

    @staticmethod
    def select(state, t):
        for a in range(K):
            if state["counts"][a] == 0:
                return a
        vals = []
        for a in range(K):
            n = state["counts"][a]
            mu = state["sum_rewards"][a] / n
            var = state["sum_sq_rewards"][a] / n - mu ** 2
            var = max(var, 0.0)
            bonus = math.sqrt(2 * var * math.log(t) / n) + 3 * UCBVAgent.b * math.log(t) / n
            vals.append(mu + bonus)
        return int(np.argmax(vals))

    @staticmethod
    def ucb_values(state, t):
        out = []
        for a in range(K):
            n = state["counts"][a]
            if n == 0:
                out.append({"arm": a, "green": ARMS[a], "count": 0,
                            "mean_reward": 0, "variance": 0, "bonus": float("inf"), "ucb": float("inf")})
            else:
                mu = state["sum_rewards"][a] / n
                var = state["sum_sq_rewards"][a] / n - mu ** 2
                var = max(var, 0.0)
                bonus = math.sqrt(2 * var * math.log(max(t, 1)) / n) + 3 * UCBVAgent.b * math.log(max(t, 1)) / n
                out.append({"arm": a, "green": ARMS[a], "count": n,
                            "mean_reward": round(mu, 4), "variance": round(var, 4),
                            "bonus": round(bonus, 4), "ucb": round(mu + bonus, 4)})
        return out


class OCOAgent:
    C = 0.5

    @staticmethod
    def _project_simplex(x):
        """Project vector x onto the probability simplex."""
        n = len(x)
        u = sorted(x, reverse=True)
        cssv = np.cumsum(u) - 1.0
        rho = max(j for j in range(n) if u[j] > cssv[j] / (j + 1))
        theta = cssv[rho] / (rho + 1)
        return [max(xi - theta, 0.0) for xi in x]

    @staticmethod
    def select(state, t):
        if "weights" not in state:
            state["weights"] = [1.0 / K] * K
        # sample arm from distribution
        return int(np.random.choice(K, p=state["weights"]))

    @staticmethod
    def update_weights(state, t, delays):
        eta = OCOAgent.C / math.sqrt(max(t, 1))
        w = state.get("weights", [1.0 / K] * K)
        # gradient = delays (we want to minimize delay)
        w_new = [w[a] - eta * delays[a] for a in range(K)]
        state["weights"] = OCOAgent._project_simplex(w_new)


class FixedTimerAgent:
    @staticmethod
    def select(state, t):
        return 2  # always arm index 2 → 50s green

class RandomAgent:
    @staticmethod
    def select(state, t):
        return random.randint(0, K - 1)


AGENT_CLASSES = {
    "UCB1": UCB1Agent,
    "UCB-V": UCBVAgent,
    "OCO-OGD": OCOAgent,
    "FixedTimer": FixedTimerAgent,
    "Random": RandomAgent,
}

# ──────────────────────────────────────────────
# Simulation state (in-memory)
# ──────────────────────────────────────────────
def _initial_state():
    return {name: _new_agent_state() for name in AGENT_NAMES}

sim = {
    "t": 0,
    "agents": _initial_state(),
}

# ──────────────────────────────────────────────
# Simulation step logic
# ──────────────────────────────────────────────
def run_step():
    sim["t"] += 1
    t = sim["t"]
    hour = t % 24
    delays = compute_delays_for_hour(hour)
    best_delay = min(delays)

    noise_std = 0.5  # small noise for stochastic setting

    for name in AGENT_NAMES:
        state = sim["agents"][name]
        cls = AGENT_CLASSES[name]

        # select arm
        arm = cls.select(state, t)

        # noisy delay observation
        observed_delay = delays[arm] + random.gauss(0, noise_std)
        observed_delay = max(observed_delay, 0.0)

        # reward = negative delay (higher is better for UCB)
        reward = -observed_delay

        # update statistics
        state["counts"][arm] += 1
        state["sum_rewards"][arm] += reward
        state["sum_sq_rewards"][arm] += reward ** 2
        state["total_delay"] += observed_delay
        state["total_steps"] += 1
        state["cumulative_regret"] += (observed_delay - best_delay)
        state["regret_history"].append(round(state["cumulative_regret"], 4))
        state["delay_history"].append(round(state["total_delay"] / state["total_steps"], 4))
        state["arm_history"].append(arm)

        # OCO weight update
        if name == "OCO-OGD":
            OCOAgent.update_weights(state, t, delays)

    return t

# ──────────────────────────────────────────────
# API Routes
# ──────────────────────────────────────────────

@app.route("/api/config", methods=["GET"])
def get_config():
    return jsonify({
        "arms": ARMS,
        "agents": AGENT_NAMES,
        "hourly_volumes": HOURLY_VOLUMES,
        "cycle_length": CYCLE_LENGTH,
        "saturation_flow": SATURATION_FLOW,
    })


@app.route("/api/reset", methods=["POST"])
def reset():
    sim["t"] = 0
    sim["agents"] = _initial_state()
    return jsonify({"status": "ok", "t": 0})


@app.route("/api/step", methods=["POST"])
def step():
    body = request.get_json(silent=True) or {}
    n = int(body.get("n_steps", 1))
    n = min(max(n, 1), 500)
    for _ in range(n):
        run_step()
    return jsonify(_summary_payload())


@app.route("/api/run_full", methods=["POST"])
def run_full():
    # reset first
    sim["t"] = 0
    sim["agents"] = _initial_state()
    body = request.get_json(silent=True) or {}
    T = int(body.get("T", 500))
    T = min(max(T, 1), 10000)
    for _ in range(T):
        run_step()
    return jsonify(_summary_payload())


@app.route("/api/summary", methods=["GET"])
def summary():
    return jsonify(_summary_payload())


@app.route("/api/ucb_state", methods=["GET"])
def ucb_state():
    t = sim["t"]
    ucb1_state = sim["agents"]["UCB1"]
    ucbv_state = sim["agents"]["UCB-V"]
    return jsonify({
        "t": t,
        "UCB1": UCB1Agent.ucb_values(ucb1_state, max(t, 1)),
        "UCB-V": UCBVAgent.ucb_values(ucbv_state, max(t, 1)),
    })


def _summary_payload():
    t = sim["t"]
    agents_summary = {}
    for name in AGENT_NAMES:
        s = sim["agents"][name]
        agents_summary[name] = {
            "cumulative_regret": round(s["cumulative_regret"], 4),
            "average_delay": round(s["total_delay"] / max(s["total_steps"], 1), 4),
            "arm_counts": s["counts"][:],
            "regret_history": s["regret_history"],
            "delay_history": s["delay_history"],
        }
    return {
        "t": t,
        "agents": agents_summary,
    }


# ──────────────────────────────────────────────
# Serve React frontend (catch-all for SPA)
# ──────────────────────────────────────────────
@app.route("/", defaults={"path": ""})
@app.route("/<path:path>")
def serve_frontend(path):
    # If the file exists in static dir, serve it
    file_path = STATIC_DIR / path
    if path and file_path.exists():
        return send_from_directory(str(STATIC_DIR), path)
    # Otherwise serve index.html (SPA routing)
    return send_from_directory(str(STATIC_DIR), "index.html")


# ──────────────────────────────────────────────
if __name__ == "__main__":
    import subprocess, sys

    # Auto-build frontend if static/index.html doesn't exist
    if not (STATIC_DIR / "index.html").exists():
        frontend_dir = Path(__file__).parent.parent / "frontend"
        if frontend_dir.exists():
            print("Building frontend...")
            subprocess.run(["npm", "install", "--silent"], cwd=str(frontend_dir), shell=True)
            subprocess.run(["npm", "run", "build"], cwd=str(frontend_dir), shell=True)
            print("Frontend build complete!")
        else:
            print("WARNING: frontend/ directory not found. API-only mode.")

    print("\n  App running at: http://localhost:5000\n")
    app.run(debug=True, port=5000)
