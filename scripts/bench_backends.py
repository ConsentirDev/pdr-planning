#!/usr/bin/env python3
"""
Benchmark the SAT engines pysat bundles, on the PDR workload, to justify the
default fast backend (Lingeling). Run:  python3 scripts/bench_backends.py

PDR fires *many small assumption-based incremental* SAT calls, so the engine that
"scales hardest" here is not necessarily the strongest in a one-shot SAT
competition — it's the one whose extra inprocessing reduces the *number* of PDR
iterations. On this author's M-series Mac, Lingeling wins (~1.5x faster and ~half
the SAT calls of minisat/glucose/cadical on real IPC logistics-10-0).

By default this benchmarks the built-in blocksworld(7) (no downloads). Pass a
domain.pddl + problem.pddl to benchmark a real instance:
    python3 scripts/bench_backends.py path/to/domain.pddl path/to/problem.pddl
"""

import sys
import time
import pathlib

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))

import pdr.sat as sat
from pdr.pdr import PDR
from pdr.planning import validate_plan

ENGINES = ["minisat22", "glucose42", "cadical153", "cadical195", "lingeling", "mergesat3"]


def build():
    if len(sys.argv) >= 3:
        from pdr.pddl import parse_problem
        dom = open(sys.argv[1]).read()
        prob = open(sys.argv[2]).read()
        return parse_problem(dom, prob), f"{pathlib.Path(sys.argv[2]).stem}"
    from pdr.domains import blocksworld
    return blocksworld(7), "blocksworld(7)"


def main():
    if not sat.have_pysat():
        print("python-sat not installed; nothing to benchmark.")
        return
    default_engine = sat.pysat_solver_name()
    _, label = build()
    print(f"PDR-M F=3 on {label} — per-engine (assumption-based incremental):\n")
    print(f"{'engine':12s}{'time':>9}{'sat_calls':>11}{'plan':>6}{'valid':>7}")
    rows = []
    for eng in ENGINES:
        sat.set_pysat_solver(eng)
        prob, _ = build()
        t0 = time.perf_counter()
        r = PDR(prob, variant="M", F=3, time_limit=120).solve()
        dt = time.perf_counter() - t0
        ok = bool(r.solvable and validate_plan(prob, r.plan))
        rows.append((eng, dt, r.stats["sat_calls"], ok))
        st = "TIMEOUT" if r.solvable is None else f"{dt:.2f}s"
        print(f"{eng:12s}{st:>9}{r.stats['sat_calls']:>11}"
              f"{(len(r.plan) if r.plan else 0):>6}{str(ok):>7}")
    sat.set_pysat_solver(default_engine)         # restore
    best = min((r for r in rows if r[3]), key=lambda r: r[1], default=None)
    if best:
        print(f"\nfastest correct: {best[0]}  ({best[1]:.2f}s).  "
              f"default is '{default_engine}'.")
        print("(small/easy instances barely differ — the Lingeling win is at scale;"
              " pass a real domain.pddl + problem.pddl to see it.)")


if __name__ == "__main__":
    main()
