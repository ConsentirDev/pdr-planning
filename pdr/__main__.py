"""
Command-line entry point.

Classical:
    python3 -m pdr logistics --locs 3 --pkgs 2
    python3 -m pdr blocksworld --blocks 4 --variant M --F 3
    python3 -m pdr logistics --locs 3 --pkgs 3 --engine ps --workers 4
    python3 -m pdr logistics --locs 3 --pkgs 3 --engine pd          # decomposition

FOND:
    python3 -m pdr clumsy --blocks 3
    python3 -m pdr escher --blocks 3        # proves no policy exists
"""

from __future__ import annotations

import argparse

from .domains import (logistics, blocksworld, fuel_logistics,
                      clumsy_blocksworld, escher_blocksworld)
from .pdr import PDR
from .parallel import PSPDR
from .decomp import PDPDR
from .fond import FONDPDR, reference_answer


def _classical(prob, args):
    if args.engine == "pdr":
        pdr = PDR(prob, variant=args.variant, F=args.F,
                  use_reschedule=not args.no_reschedule,
                  use_clause_pushing=not args.no_clause_pushing,
                  time_limit=args.time_limit)
    elif args.engine == "ps":
        pdr = PSPDR(prob, n_workers=args.workers, time_limit=args.time_limit)
    else:
        pdr = PDPDR(prob, time_limit=args.time_limit)
    res = pdr.solve()
    print(f"problem : {prob.name}  ({len(prob.props)} props, {len(prob.actions)} actions)")
    print(f"solver  : engine={args.engine} variant={args.variant} F={args.F}")
    if res.solvable is None:
        print("result  : TIMEOUT")
    elif res.solvable:
        steps = res.plan_actions or []
        print(f"result  : SOLVABLE ({len(res.plan)} step(s))")
        for i, step in enumerate(steps):
            print(f"  step {i+1}: {', '.join(step) if step else '(no-op)'}")
    else:
        print("result  : UNSOLVABLE (proved no plan exists)")
    s = res.stats
    print(f"stats   : {dict((k, s[k]) for k in s if k in ('k','sat_calls','iterations','rounds','wasted','last_n_subproblems'))}")


def _fond(prob, args):
    truth, _ = reference_answer(prob)
    res = FONDPDR(prob, time_limit=args.time_limit).solve()
    print(f"problem : {prob.name}  ({len(prob.props)} props, {len(prob.actions)} actions, "
          f"FOND, max {prob.max_outcomes} outcomes/action)")
    if res.has_policy is None:
        print("result  : TIMEOUT")
    elif res.has_policy:
        print(f"result  : STRONG-CYCLIC POLICY FOUND ({len(res.policy)} states)")
    else:
        print("result  : NO POLICY EXISTS (proved)")
    print(f"check   : ground truth = {'policy exists' if truth else 'no policy'}  "
          f"(match: {res.has_policy == truth})")
    s = res.stats
    print(f"stats   : k={s['k']} decided_by={s['decided_by']} states={s['states']} sat_calls={s['sat_calls']}")


def main():
    ap = argparse.ArgumentParser(prog="pdr", description="Solve a planning problem with PDR")
    sub = ap.add_subparsers(dest="domain", required=True)

    pl = sub.add_parser("logistics"); pl.add_argument("--locs", type=int, default=2); pl.add_argument("--pkgs", type=int, default=2)
    pb = sub.add_parser("blocksworld"); pb.add_argument("--blocks", type=int, default=3)
    pf = sub.add_parser("fuel")
    for p in (pl, pb, pf):
        p.add_argument("--engine", choices=["pdr", "ps", "pd"], default="pdr")
        p.add_argument("--variant", choices=["baseline", "M", "IL"], default="baseline")
        p.add_argument("--F", type=int, default=1)
        p.add_argument("--workers", type=int, default=4)
        p.add_argument("--no-reschedule", action="store_true")
        p.add_argument("--no-clause-pushing", action="store_true")
        p.add_argument("--time-limit", type=float, default=None)

    cl = sub.add_parser("clumsy"); cl.add_argument("--blocks", type=int, default=3)
    es = sub.add_parser("escher"); es.add_argument("--blocks", type=int, default=3)
    for p in (cl, es):
        p.add_argument("--time-limit", type=float, default=120.0)

    args = ap.parse_args()
    if args.domain == "logistics":
        _classical(logistics(args.locs, args.pkgs), args)
    elif args.domain == "blocksworld":
        _classical(blocksworld(args.blocks), args)
    elif args.domain == "fuel":
        _classical(fuel_logistics(2), args)
    elif args.domain == "clumsy":
        _fond(clumsy_blocksworld(args.blocks), args)
    elif args.domain == "escher":
        _fond(escher_blocksworld(args.blocks), args)


if __name__ == "__main__":
    main()
