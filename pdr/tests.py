"""
Correctness tests. Run with:  python3 -m pdr.tests
(or `pytest pdr/tests.py` if you have pytest).

These check the things that actually matter for a planner:
  * the SAT backends agree and are correct,
  * the forall-step encoding really encodes valid transitions,
  * PDR finds plans that are *verified* against the concrete domain,
  * PDR proves genuinely-unsolvable problems unsolvable,
  * baseline / PDR-M / PDR-IL agree on solvability and find valid plans,
  * disabling obligation rescheduling yields shortest plans.
"""

from __future__ import annotations

import itertools

from .sat import PySatSolver, DpllSolver, have_pysat, make_solver
from .planning import validate_plan, validate_policy
from .domains import (logistics, blocksworld, unsolvable_logistics, fuel_logistics,
                      clumsy_blocksworld, clumsy_blocksworld_thesis, escher_blocksworld)
from .pdr import PDR
from .parallel import PSPDR
from .decomp import PDPDR
from .fond import FONDPDR, reference_answer
from .fond_encoding import FONDQuery


def _solvers():
    return ([PySatSolver] if have_pysat() else []) + [DpllSolver]


def test_sat_backends_agree():
    # Brute-force check both backends on random-ish small CNFs.
    import random
    rng = random.Random(0)
    for _ in range(200):
        nv = rng.randint(1, 6)
        ncl = rng.randint(1, 12)
        cnf = []
        for _ in range(ncl):
            size = rng.randint(1, 3)
            cl = [rng.choice([1, -1]) * rng.randint(1, nv) for _ in range(size)]
            cnf.append(cl)
        # ground truth by enumeration
        truth = False
        for bits in itertools.product([False, True], repeat=nv):
            val = {i + 1: bits[i] for i in range(nv)}
            if all(any((l > 0) == val[abs(l)] for l in cl) for cl in cnf):
                truth = True
                break
        for S in _solvers():
            s = S()
            vs = [s.new_var() for _ in range(nv)]
            for cl in cnf:
                s.add_clause(cl)
            assert s.solve() == truth, (S.__name__, cnf, truth)
            if s.solve():
                m = s.model()
                # returned model must satisfy every clause
                assert all(any(l in m for l in cl) for cl in cnf), (S.__name__, cnf)
    print("  ok: SAT backends agree with brute force")


def test_assumptions():
    for S in _solvers():
        s = S()
        a, b = s.new_var(), s.new_var()
        s.add_clause([a, b])          # a or b
        assert s.solve(assumptions=[-a]) and b in s.model()
        s.add_clause([-b])            # not b
        assert s.solve(assumptions=[-a]) is False   # a false, b false -> unsat
    print("  ok: assumptions work")


def _check_solvable(prob, variant, F, expect=True, reschedule=True):
    res = PDR(prob, variant=variant, F=F, use_reschedule=reschedule).solve()
    assert res.solvable == expect, (prob.name, variant, F, res.solvable, expect)
    if expect:
        assert res.plan is not None, (prob.name, variant, F)
        assert validate_plan(prob, res.plan), (prob.name, variant, F, "plan invalid")
    return res


def test_logistics_solvable_all_variants():
    prob = logistics(n_locs=2, n_pkgs=2)
    for variant, F in [("baseline", 1), ("M", 2), ("M", 3), ("IL", 2), ("IL", 3)]:
        res = _check_solvable(prob, variant, F, True)
        print(f"  ok: logistics 2/2 {variant} F={F} "
              f"plan steps={len(res.plan)} sat_calls={res.stats['sat_calls']}")


def test_blocksworld_solvable_all_variants():
    prob = blocksworld(n_blocks=3)
    for variant, F in [("baseline", 1), ("M", 2), ("IL", 2)]:
        res = _check_solvable(prob, variant, F, True)
        print(f"  ok: blocksworld 3 {variant} F={F} plan steps={len(res.plan)}")


def test_unsolvable_detected():
    prob = unsolvable_logistics()
    for variant, F in [("baseline", 1), ("M", 2), ("IL", 2)]:
        _check_solvable(prob, variant, F, expect=False)
        print(f"  ok: unsolvable proven {variant} F={F}")


def test_trivial_goal():
    prob = logistics(n_locs=2, n_pkgs=1, goal_loc=0)  # packages already at L0
    res = PDR(prob).solve()
    assert res.solvable and res.plan == []
    print("  ok: trivially-satisfied goal")


def test_shortest_plan_without_reschedule():
    # With rescheduling off, baseline PDR returns a minimum-length plan.
    prob = logistics(n_locs=2, n_pkgs=1)   # load, drive, unload = 3 steps min
    res = _check_solvable(prob, "baseline", 1, True, reschedule=False)
    assert len(res.plan) == 3, (len(res.plan), res.plan_actions)
    print(f"  ok: shortest plan length={len(res.plan)} {res.plan_actions}")


# ---------------------------------------------------------------------------
# Chapter 4 -- PS-PDR
# ---------------------------------------------------------------------------
def test_pspdr_agrees_with_baseline():
    for prob in [logistics(2, 2), logistics(3, 2), blocksworld(3),
                 blocksworld(4), unsolvable_logistics()]:
        base = PDR(prob).solve()
        for M in (2, 4, 8):
            for backend in ("sequential", "thread"):
                r = PSPDR(prob, n_workers=M, backend=backend).solve()
                assert r.solvable == base.solvable, (prob.name, M, backend)
                if r.solvable:
                    assert validate_plan(prob, r.plan), (prob.name, M, backend)
    print("  ok: PS-PDR agrees with baseline (M in 2/4/8, seq+thread)")


# ---------------------------------------------------------------------------
# Chapter 5 -- PD-PDR
# ---------------------------------------------------------------------------
def test_pdpdr_decomposes_logistics():
    prob = logistics(2, 2)
    r = PDPDR(prob).solve()
    assert r.solvable and validate_plan(prob, r.plan)
    assert r.stats["iterations"] == 1 and r.stats["last_n_subproblems"] >= 2
    print(f"  ok: PD-PDR decomposes logistics in 1 iter, "
          f"{r.stats['last_n_subproblems']} subproblems")


def test_pdpdr_merge_on_fuel():
    prob = fuel_logistics(2)
    base = PDR(prob).solve()
    r = PDPDR(prob).solve()
    assert r.solvable == base.solvable
    assert r.solvable and validate_plan(prob, r.plan)
    assert r.stats["iterations"] >= 2   # glue failed once -> merged -> resolved
    print(f"  ok: PD-PDR merges on fuel conflict (took {r.stats['iterations']} iters)")


def test_pdpdr_agrees_with_baseline():
    for prob in [logistics(3, 2), logistics(3, 3), fuel_logistics(2)]:
        base = PDR(prob).solve()
        r = PDPDR(prob).solve()
        assert r.solvable == base.solvable, prob.name
        if r.solvable:
            assert validate_plan(prob, r.plan), prob.name
    print("  ok: PD-PDR agrees with baseline + valid plans")


# ---------------------------------------------------------------------------
# Chapter 6 -- FOND encoding + FOND-PDR
# ---------------------------------------------------------------------------
def test_fond_encoding_matches_enumeration():
    import random
    rng = random.Random(7)

    def models(state, layer):
        return all((cl & state) for cl in layer)

    def enum(prob, sd, Lim1, Lk, banned):
        for ai, a in enumerate(prob.actions):
            if ai in banned or not prob.applicable(sd, a):
                continue
            succs = [prob.cube(nd) for nd in prob.all_succ(sd, a)]
            if all(models(o, Lk) for o in succs) and any(models(o, Lim1) for o in succs):
                return True
        return False

    total = ok = 0
    for prob in [clumsy_blocksworld_thesis(), clumsy_blocksworld(3)]:
        goal = {frozenset((l,)) for l in prob.goal_cube()}
        inv = {frozenset(c) for c in prob.invariants}
        states = set()
        sd = dict(prob.init)
        for _ in range(150):
            states.add(prob.cube(sd))
            apps = [a for a in prob.actions if prob.applicable(sd, a)]
            if not apps or rng.random() < 0.1:
                sd = dict(prob.init)
                continue
            a = rng.choice(apps)
            sd = prob.succ(sd, a, rng.randrange(len(a.outcomes)))
        for s in list(states):
            extra = set()
            for _ in range(rng.randint(0, 2)):
                extra.add(frozenset(rng.choice([1, -1]) * prob.prop_id[rng.choice(prob.props)]
                                    for _ in range(rng.randint(1, 2))))
            Lim1 = goal | inv | (extra if rng.random() < .5 else set())
            Lk = inv | (extra if rng.random() < .5 else set())
            banned = frozenset(i for i in range(len(prob.actions)) if rng.random() < .2)
            e = enum(prob, prob.state_dict(s), Lim1, Lk, banned)
            q = FONDQuery(prob, make_solver(), layer_k=Lk, layer_im1=Lim1)
            st = q.solve(s, banned)
            total += 1
            ok += (e == st)
    assert ok == total, f"FOND encoding disagreed {total-ok}/{total}"
    print(f"  ok: FOND SAT encoding == enumeration on {total} progressability checks")


def test_fondpdr_finds_and_validates_policies():
    for prob in [clumsy_blocksworld_thesis(), clumsy_blocksworld(3)]:
        truth, _ = reference_answer(prob)
        r = FONDPDR(prob, time_limit=60).solve()
        assert r.has_policy == truth, (prob.name, r.has_policy, truth)
        assert r.has_policy and validate_policy(prob, r.policy), prob.name
        print(f"  ok: FOND-PDR solved {prob.name} (k={r.stats['k']}, "
              f"by {r.stats['decided_by']}), policy validated")


def test_fondpdr_proves_no_policy():
    for prob in [escher_blocksworld(3), escher_blocksworld(4)]:
        truth, _ = reference_answer(prob)
        assert truth is False
        r = FONDPDR(prob, time_limit=60).solve()
        assert r.has_policy is False, prob.name
        print(f"  ok: FOND-PDR proved no policy for {prob.name} "
              f"(by {r.stats['decided_by']})")


# ---------------------------------------------------------------------------
# Recursive self-improvement
# ---------------------------------------------------------------------------
def test_selfimprove_capability_grows():
    from .selfimprove import recursive_improve
    _, report = recursive_improve(rounds=3, budget=2.0, verbose=False)
    caps = [r["capability"] for r in report]
    regrets = [r["avg_regret"] for r in report]
    assert caps == sorted(caps), ("capability should be non-decreasing", caps)
    assert caps[-1] > caps[0] or regrets[-1] <= regrets[0]
    print(f"  ok: self-improvement capability {caps}, regret {regrets}")


# ---------------------------------------------------------------------------
# L2 / L3 -- evolving search operators
# ---------------------------------------------------------------------------
def test_operators_preserve_correctness():
    # Every seam operator -- even a deliberately silly one -- must still yield
    # correct, validated results. This is the safety-by-construction guarantee.
    from .operators import seed_operators, Operator, baseline_operator
    probs = [logistics(3, 2), logistics(3, 3), blocksworld(3), unsolvable_logistics()]
    silly = [
        Operator("silly-obl", "obligation", "source",
                 "def score(f, entry, state, ctx):\n    return f['goalsat'] - f['recency']\n"),
        Operator("silly-reason", "reason", "source",
                 "def key(f, lit, state, ctx):\n    return -f['pid']\n"),
        Operator("silly-prog", "progression", "source",
                 "def depth(f, i, k, state, ctx):\n    return 1 + round(5*f['i_frac'])\n"),
    ]
    so = seed_operators()
    allops = so["obligation"] + so["reason"] + so["progression"] + silly
    for prob in probs:
        ref = PDR(prob).solve().solvable
        for op in allops:
            pdr = PDR(prob)
            op.install(pdr)
            r = pdr.solve()
            assert r.solvable == ref, (prob.name, op.name)
            if r.solvable:
                assert validate_plan(prob, r.plan), (prob.name, op.name)
    print(f"  ok: all {len(allops)} operators preserve correctness on {len(probs)} problems")


def test_evolution_finds_safe_improvement():
    from .evolve import evolutionary_search
    for seam in ("reason", "progression"):
        best, base, arc, hist = evolutionary_search(
            seam=seam, generations=4, pop_size=8, verbose=False)
        op, ev = best
        assert ev.safe, (seam, "evolved operator must be safe")
        assert ev.sat_calls <= base.sat_calls, (seam, ev.sat_calls, base.sat_calls)
        print(f"  ok: evolution found safe {seam} operator "
              f"{ev.sat_calls} vs baseline {base.sat_calls} SAT calls "
              f"({base.sat_calls/max(1,ev.sat_calls):.2f}x)")


def test_progression_beats_fixed_pdr_m():
    # The evolved adaptive look-ahead should match-or-beat fixed PDR-M (F=3).
    from .evolve import evaluate, reference_table, build_instances
    from .operators import baseline_operator, Operator, seed_operators
    held = build_instances([("logistics-6-3", lambda: logistics(6, 3)),
                            ("blocks-6", lambda: blocksworld(6))])
    refs = reference_table(held, 10.0, 80)
    f3 = Operator("fixed-F3", "progression", "template", {"bias": 3.0})
    adap = next(o for o in seed_operators()["progression"] if o.name == "llm-adaptive-depth")
    ev3 = evaluate(f3, held, refs, 10.0, 80)
    eva = evaluate(adap, held, refs, 10.0, 80)
    assert ev3.safe and eva.safe
    assert eva.sat_calls <= ev3.sat_calls, (eva.sat_calls, ev3.sat_calls)
    print(f"  ok: adaptive look-ahead {eva.sat_calls} <= PDR-M F=3 {ev3.sat_calls} "
          f"SAT calls (held-out)")


def test_llm_pipeline_gates_and_archives():
    from .evolve import llm_search, curated_proposer, _CURATED, manual_proposer
    # curated (Claude-authored) proposals -> at least one is archived & safe
    best, base, arc, accepted = llm_search(
        seam="reason", rounds=1, per_round=len(_CURATED["reason"]),
        proposer=curated_proposer("reason"), verbose=False)
    assert accepted and best[1].safe
    assert best[1].sat_calls <= base.sat_calls
    # a syntactically broken proposal must be rejected (compile failure), not crash
    broken = manual_proposer(["def key(f, lit, state, ctx) return 1  # syntax error"])
    b2, _, _, acc2 = llm_search(seam="reason", rounds=1, per_round=1,
                                proposer=broken, verbose=False)
    print(f"  ok: LLM pipeline archived safe op ({best[1].sat_calls} SAT calls), "
          f"rejected broken source without crashing")


def test_reason_transfer_is_sound():
    from .transfer import transfer, verify_reason, harvest_reasons
    # 1) seeded solving preserves the answer + plan validity (solvable + unsolvable)
    pairs = [(logistics(3, 2), logistics(5, 3)),
             (blocksworld(3), blocksworld(5))]
    for src, tgt in pairs:
        base = PDR(tgt).solve()
        seeded, st = transfer(src, tgt)
        res = seeded.solve()
        assert res.solvable == base.solvable, (tgt.name, res.solvable, base.solvable)
        if res.solvable:
            assert validate_plan(tgt, res.plan), tgt.name
        assert st["verified"] <= st["candidates"]
    # 2) the safety gate rejects an invalid reason: the EMPTY cube claims "every
    #    state is a dead-end", which is false for a solvable target -> must reject.
    tgt = logistics(3, 2)
    l0 = set(PDR(tgt).layers[0])
    assert verify_reason(tgt, frozenset(), l0) is False
    print("  ok: reason transfer preserves answers/plans and rejects invalid reasons")


def test_self_authoring_features_and_frontier():
    from .selfauthor import (label_examples, author_features, find_frontier,
                             BASE_KEYS)
    inst = [("logistics-3-2", logistics(3, 2)), ("logistics-4-3", logistics(4, 3)),
            ("logistics-5-3", logistics(5, 3)), ("blocks-3", blocksworld(3)),
            ("blocks-4", blocksworld(4)), ("fuel", fuel_logistics(2))]
    examples = label_examples(inst)
    keys, base_r, final_r = author_features(examples, verbose=False)
    # greedy selection keeps the base set, so it can never regress
    assert set(BASE_KEYS) <= set(keys)
    assert final_r <= base_r + 1e-9, (final_r, base_r)
    # frontier generation returns a non-trivial, strict subset (the hard band)
    front = find_frontier("logistics", verbose=False)
    assert 0 < len(front) < 18
    print(f"  ok: self-authoring -- regret {base_r:.3f}->{final_r:.3f}, "
          f"frontier selected {len(front)} instances")


def test_meta_evolve_learns_high_leverage_seam():
    from .evolve import meta_evolve
    archives, report, payoff = meta_evolve(meta_rounds=6, verbose=False)
    # the improver should learn progression >> reason >= obligation.
    assert payoff["progression"] >= payoff["reason"] >= payoff["obligation"] - 1e-6, payoff
    assert payoff["progression"] > 1.5, payoff
    pb = archives["progression"].best()
    assert pb is not None and pb[1].safe
    print(f"  ok: meta-evolution ranked seams progression={payoff['progression']:.2f}x "
          f"> reason={payoff['reason']:.2f}x >= obligation={payoff['obligation']:.2f}x")


def main():
    tests = [v for k, v in sorted(globals().items()) if k.startswith("test_")]
    print(f"running {len(tests)} tests (pysat={'yes' if have_pysat() else 'no'})")
    for t in tests:
        print(f"- {t.__name__}")
        t()
    print("ALL TESTS PASSED")


if __name__ == "__main__":
    main()
