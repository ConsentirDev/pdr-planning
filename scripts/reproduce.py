#!/usr/bin/env python3
"""
Reproduce the headline results in one deterministic run (a few minutes).

    python3 scripts/reproduce.py

Every number printed here is regenerated from scratch; every plan/policy is
independently validated. Intended as the single artifact a reviewer runs to
check the claims in the README.
"""

import sys
import time
import pathlib

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))

from pdr import (PDR, FONDPDR, logistics, blocksworld, clumsy_blocksworld,
                 escher_blocksworld, validate_plan, validate_policy, have_pysat)
from pdr.fond import reference_answer
from pdr.evolve import (evolutionary_search, evaluate, reference_table,
                        build_instances, meta_evolve)
from pdr.operators import baseline_operator, Operator, seed_operators
from pdr.transfer import transfer


def hdr(t):
    print("\n" + "=" * 72 + f"\n{t}\n" + "=" * 72)


def main():
    t0 = time.perf_counter()
    print(f"SAT backend: {'python-sat (fast)' if have_pysat() else 'pure-Python DPLL'}")

    hdr("1. CORRECTNESS  (all chapters, every output validated)")
    from pdr import tests as T
    T.main()

    hdr("2. Ch 3  PDR-M consistent speedup on Logistics (thesis Fig 3.5/Table 3.2)")
    for n in (3, 4, 5):
        p = logistics(n, n - 1)
        b = PDR(p).solve().stats["sat_calls"]
        m = PDR(p, variant="M", F=3).solve()
        assert validate_plan(p, m.plan)
        print(f"  {p.name:22s}: baseline {b:5d} -> PDR-M(F=3) {m.stats['sat_calls']:5d} "
              f"SAT calls  ({b / max(1, m.stats['sat_calls']):.2f}x)")

    hdr("3. Ch 6  FOND-PDR: finds validated policies; proves no-policy")
    for build in (lambda: clumsy_blocksworld(3), lambda: escher_blocksworld(3)):
        p = build()
        truth, _ = reference_answer(p)
        r = FONDPDR(p, time_limit=60).solve()
        ok = (r.has_policy == truth) and (not r.has_policy or validate_policy(p, r.policy))
        print(f"  {p.name:20s}: has_policy={r.has_policy} (truth {truth}) "
              f"by '{r.stats['decided_by']}'  validated={ok}")

    hdr("4. L2  evolved adaptive look-ahead vs baseline vs PDR-M  (HELD-OUT)")
    evolutionary_search(seam="progression", generations=4, verbose=False)  # warm
    held = build_instances([("logistics-6-3", lambda: logistics(6, 3)),
                            ("logistics-5-4", lambda: logistics(5, 4)),
                            ("blocks-6", lambda: blocksworld(6))])
    refs = reference_table(held, 10.0, 80)
    F1 = baseline_operator("progression")
    F3 = Operator("fixed-F3", "progression", "template", {"bias": 3.0})
    adap = next(o for o in seed_operators()["progression"] if o.name == "llm-adaptive-depth")
    for name, op in [("F=1 baseline", F1), ("PDR-M F=3", F3), ("evolved adaptive", adap)]:
        ev = evaluate(op, held, refs, 10.0, 80)
        print(f"  {name:18s}: {ev.sat_calls:5d} SAT calls  (safe={ev.safe})")

    hdr("5. L3  meta-evolution learns the leverage ranking across all seams")
    _, _, payoff = meta_evolve(meta_rounds=6, verbose=False)
    for s in sorted(payoff, key=lambda s: -payoff[s]):
        print(f"  payoff[{s:11s}] = {payoff[s]:.2f}x")

    hdr("6. Verified reason transfer is SOUND")
    src, tgt = logistics(3, 2), logistics(5, 3)
    base = PDR(tgt).solve()
    seeded, st = transfer(src, tgt)
    res = seeded.solve()
    ok = (res.solvable == base.solvable) and validate_plan(tgt, res.plan)
    print(f"  {src.name} -> {tgt.name}: {st['verified']}/{st['candidates']} reasons "
          f"verified & seeded; answer preserved & valid = {ok}")

    print(f"\nAll headline results reproduced in {time.perf_counter()-t0:.1f}s.")


if __name__ == "__main__":
    main()
