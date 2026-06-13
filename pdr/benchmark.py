"""
Benchmark harness -- reproduces the methodology of Chapter 3 (Table 3.2 /
Figure 3.5-3.6) on your laptop.

The thesis measures, for each problem, the time the *baseline* (F=1) PDR spends
in the SAT solver, then the time PDR-M / PDR-IL spend for F = 2..N, and reports
the ratio:

        slowdown/speedup factor = time(variant, F) / time(baseline)

A factor below 1.0 means the multi-step variant was *faster* than baseline;
above 1.0 means slower. Factors are averaged over the problems in a domain
(only over problems every configuration solved, exactly as the thesis does).

Run:
    python3 -m pdr.benchmark                 # default suite
    python3 -m pdr.benchmark --max-f 5 --time-limit 20 --csv results.csv

Because this uses a (fast) general SAT backend rather than the thesis's bespoke
Lingeling setup, absolute times differ from the thesis -- but the *shape* of the
result (which domains like multi-step, how F affects variance) is reproducible.
"""

from __future__ import annotations

import argparse
import statistics
import time

from .domains import (logistics, blocksworld, fuel_logistics,
                      clumsy_blocksworld, escher_blocksworld)
from .pdr import PDR
from .parallel import PSPDR
from .decomp import PDPDR
from .fond import FONDPDR, reference_answer


def default_suite():
    """A small, laptop-friendly set of instances per domain."""
    return {
        "logistics": [
            logistics(2, 2), logistics(3, 2), logistics(3, 3),
            logistics(4, 2), logistics(4, 3),
        ],
        "blocksworld": [
            blocksworld(3), blocksworld(4), blocksworld(5),
        ],
    }


def _run(prob, variant, F, time_limit):
    pdr = PDR(prob, variant=variant, F=F, time_limit=time_limit)
    t0 = time.perf_counter()
    res = pdr.solve()
    wall = time.perf_counter() - t0
    return res, wall


def run_benchmark(suite=None, variants=("M", "IL"), max_f=4, time_limit=30,
                  metric="sat_time", verbose=True):
    suite = suite or default_suite()
    fs = list(range(2, max_f + 1))
    # results[domain][variant][F] = list of factors over solved instances
    table = {}

    for domain, probs in suite.items():
        rows = []
        for prob in probs:
            base_res, base_wall = _run(prob, "baseline", 1, time_limit)
            base_t = base_res.stats.get(metric, base_wall)
            solved_base = base_res.solvable is not None
            row = {"prob": prob.name, "base": base_t,
                   "base_solvable": base_res.solvable, "factors": {}}
            for variant in variants:
                for F in fs:
                    res, wall = _run(prob, variant, F, time_limit)
                    t = res.stats.get(metric, wall)
                    ok = res.solvable is not None and solved_base
                    # sanity: variants must agree with baseline on solvability
                    agree = (res.solvable == base_res.solvable) if ok else None
                    factor = (t / base_t) if (ok and base_t > 0) else None
                    row["factors"][(variant, F)] = {
                        "factor": factor, "agree": agree,
                        "solvable": res.solvable, "time": t}
            rows.append(row)
            if verbose:
                _print_row(row, variants, fs)
        table[domain] = rows

    if verbose:
        _print_summary(table, variants, fs)
    return table


def _print_row(row, variants, fs):
    print(f"\n  {row['prob']}  (baseline {row['base']*1000:.1f} ms, "
          f"solvable={row['base_solvable']})")
    for variant in variants:
        cells = []
        for F in fs:
            d = row["factors"][(variant, F)]
            f = d["factor"]
            flag = "" if d["agree"] in (True, None) else "!DISAGREE"
            cells.append(f"F{F}={f:.2f}x{flag}" if f is not None else f"F{F}=--")
        print(f"    {variant:4s}: " + "  ".join(cells))


def _print_summary(table, variants, fs):
    print("\n" + "=" * 64)
    print("DOMAIN-AVERAGE SLOWDOWN/SPEEDUP FACTORS (baseline F=1 == 1.00x)")
    print("lower = multi-step is faster;  higher = slower")
    print("=" * 64)
    header = "domain        variant  " + "  ".join(f"F={F}" for F in fs)
    print(header)
    for domain, rows in table.items():
        for variant in variants:
            avgs = []
            for F in fs:
                vals = [r["factors"][(variant, F)]["factor"] for r in rows
                        if r["factors"][(variant, F)]["factor"] is not None]
                avgs.append(statistics.geometric_mean(vals) if vals else None)
            cells = "  ".join(f"{a:4.2f}" if a is not None else " -- " for a in avgs)
            print(f"{domain:13s} {variant:6s}  {cells}")
    print("(geometric mean over instances solved by every configuration)")


# ---------------------------------------------------------------------------
# Cross-solver comparison (Ch 4/5 style: coverage + wall time per solver)
# ---------------------------------------------------------------------------
def compare_solvers(time_limit=15.0):
    instances = [logistics(2, 2), logistics(3, 2), logistics(3, 3),
                 logistics(4, 3), blocksworld(3), blocksworld(4),
                 blocksworld(5), fuel_logistics(2)]
    solvers = {
        "PDR-baseline": lambda p: PDR(p, time_limit=time_limit),
        "PDR-M(F=3)":   lambda p: PDR(p, variant="M", F=3, time_limit=time_limit),
        "PS-PDR(M=4)":  lambda p: PSPDR(p, n_workers=4, time_limit=time_limit),
        "PD-PDR":       lambda p: PDPDR(p, time_limit=time_limit),
    }
    print(f"\n{'instance':22s} " + "".join(f"{k:>16s}" for k in solvers))
    cover = {k: 0 for k in solvers}
    for prob in instances:
        row = f"{prob.name:22s} "
        for name, mk in solvers.items():
            t0 = time.perf_counter()
            r = mk(prob).solve()
            wall = time.perf_counter() - t0
            ok = r.solvable is not None
            cover[name] += int(ok)
            row += f"{(f'{wall*1000:.0f}ms' if ok else 'TIMEOUT'):>16s}"
        print(row)
    print(f"{'coverage':22s} " + "".join(f"{cover[k]:>13d}/{len(instances)}" for k in solvers))


def fond_benchmark(time_limit=60.0):
    instances = [clumsy_blocksworld(3), clumsy_blocksworld(4),
                 escher_blocksworld(3), escher_blocksworld(4)]
    print(f"\n{'instance':20s} {'truth':>7s} {'FOND-PDR':>10s} {'decided-by':>22s} "
          f"{'k':>3s} {'states':>7s} {'time':>9s}")
    for prob in instances:
        truth, _ = reference_answer(prob)
        t0 = time.perf_counter()
        r = FONDPDR(prob, time_limit=time_limit).solve()
        wall = time.perf_counter() - t0
        print(f"{prob.name:20s} {str(truth):>7s} {str(r.has_policy):>10s} "
              f"{r.stats['decided_by']:>22s} {r.stats['k']:>3d} "
              f"{r.stats['states']:>7d} {wall*1000:>7.0f}ms")


def main():
    ap = argparse.ArgumentParser(description="PDR benchmarks")
    ap.add_argument("--mode", default="speedup",
                    choices=["speedup", "compare", "fond"])
    ap.add_argument("--max-f", type=int, default=4)
    ap.add_argument("--time-limit", type=float, default=30.0)
    ap.add_argument("--variants", default="M,IL")
    ap.add_argument("--metric", default="sat_time", choices=["sat_time"])
    ap.add_argument("--csv", default=None)
    args = ap.parse_args()

    if args.mode == "compare":
        compare_solvers(time_limit=args.time_limit)
        return
    if args.mode == "fond":
        fond_benchmark(time_limit=args.time_limit)
        return

    variants = tuple(v.strip() for v in args.variants.split(",") if v.strip())
    table = run_benchmark(variants=variants, max_f=args.max_f,
                          time_limit=args.time_limit, metric=args.metric)
    if args.csv:
        _write_csv(table, variants, args.csv)
        print(f"\nwrote {args.csv}")


def _write_csv(table, variants, path):
    import csv
    with open(path, "w", newline="") as fh:
        w = csv.writer(fh)
        w.writerow(["domain", "problem", "variant", "F", "factor",
                    "variant_time_s", "solvable", "agrees_with_baseline"])
        for domain, rows in table.items():
            for r in rows:
                for (variant, F), d in r["factors"].items():
                    w.writerow([domain, r["prob"], variant, F,
                                d["factor"], d["time"], d["solvable"], d["agree"]])


if __name__ == "__main__":
    main()
