"""
Chapter 4 -- Parallel State PDR (PS-PDR), Algorithm 3.

Classical PDR pulls ONE obligation off the queue at a time. PS-PDR has an
*orchestrator* that hands a batch of up to M obligations to M *workers* who each
answer their little SAT question independently and in parallel, then reports
back. The orchestrator merges all the answers using exactly the same rules as
serial PDR (add successors, learn reasons, trim the queue).

Why it can help: many independent questions get answered per round.
Why it can hurt (the thesis is candid about this, Sec 4.3.2): several workers may
be handed near-identical dead-ends in the same round and all derive the *same*
reason -- work serial PDR would have skipped because the first reason would have
trimmed the rest. We measure that wasted work (`stats["wasted"]`).

Because every obligation is processed against the *same layer snapshot* within a
round and merged with the serial rules afterwards, PS-PDR returns the same
answer as baseline PDR -- the tests assert this on every instance.

`backend="thread"` runs the batch on a real thread pool (the C SAT solver
releases the GIL during solving); `backend="sequential"` (default) simulates the
same batching deterministically.
"""

from __future__ import annotations

import threading
from concurrent.futures import ThreadPoolExecutor

from .pdr import PDR, Result, _PDRTimeout


class PSPDR(PDR):
    def __init__(self, problem, n_workers=4, backend="sequential", **kw):
        # PS-PDR uses single-step progression like baseline.
        kw.pop("variant", None)
        kw.pop("F", None)
        super().__init__(problem, variant="baseline", F=1, **kw)
        self.M = max(1, n_workers)
        self.backend = backend
        self._lock = threading.Lock()
        self.stats["wasted"] = 0
        self.stats["rounds"] = 0
        self.stats["workers"] = self.M

    def _timed_solve(self, q, cube, t_state=0):
        # thread-safe stats accumulation
        with self._lock:
            return super()._timed_solve(q, cube, t_state)

    def _process_batch(self, batch):
        """Answer each obligation's SAT question (optionally in parallel)."""
        if self.backend == "thread" and len(batch) > 1:
            with ThreadPoolExecutor(max_workers=self.M) as ex:
                results = list(ex.map(lambda so: (so, self._progress(*so)), batch))
            return results
        return [(so, self._progress(*so)) for so in batch]

    def _solve(self) -> Result:
        import time
        p = self.p
        init = p.init_cube()
        if self.time_limit is not None:
            self._deadline = time.perf_counter() + self.time_limit
        if self._state_models_layer(init, self.layers[0]):
            return Result(True, plan=[], plan_actions=[], stats=self._final_stats(0))

        order = [0]
        for k in range(1, self.max_k + 1):
            self.stats["k"] = k
            self._ensure_layers(k)
            Q = []
            present = set()

            def push_obl(state, idx):
                key = (idx, state)
                if key in present:
                    return
                present.add(key)
                order[0] += 1
                Q.append([idx, order[0], state])

            def pop_min():
                best = None
                for e in Q:
                    if best is None or e[0] < best[0] or (e[0] == best[0] and e[1] > best[1]):
                        best = e
                Q.remove(best)
                present.discard((best[0], best[2]))
                return best[2], best[0]

            def trim_with(reason, i):
                nonlocal Q, present
                new_entries, new_present = [], set()
                for idx, od, z in Q:
                    consistent = reason <= z
                    if idx > i or not consistent:
                        keep = (idx, od, z)
                    elif i < k:
                        keep = (i + 1, od, z)
                    else:
                        continue
                    if (keep[0], keep[2]) not in new_present:
                        new_present.add((keep[0], keep[2]))
                        new_entries.append(list(keep))
                Q = new_entries
                present = new_present

            push_obl(init, k)

            while Q:
                self._check_deadline()
                # pop a batch of up to M obligations (orchestrator hands work out)
                batch = []
                while Q and len(batch) < self.M:
                    batch.append(pop_min())
                self.stats["rounds"] += 1

                results = self._process_batch(batch)

                # Process successes first (Lines 10-12), then failures (13-24),
                # exactly as serial PDR would, but for the whole batch.
                successes = [(so, pl) for so, (kind, pl) in results if kind == "sat"]
                failures = [(so, pl) for so, (kind, pl) in results if kind == "unsat"]

                for (s, i), succ in successes:
                    for t, j, seq in succ:
                        if t not in self.parent and t != init:
                            self.parent[t] = (s, seq)
                        if j == 0:
                            plan = self._reconstruct(t)
                            from .planning import validate_plan
                            ok = plan is not None and validate_plan(p, plan)
                            return Result(True, plan=plan,
                                          plan_actions=self._names(plan) if plan else None,
                                          stats=self._final_stats(k, validated=ok))
                        push_obl(t, j)
                    push_obl(s, i)

                for (s, i), reason in failures:
                    # If an earlier reason this round already forbade s at i,
                    # this worker's effort was (in hindsight) wasted.
                    if not self._state_models_layer(s, self.layers[i]):
                        self.stats["wasted"] += 1
                    self._add_reason_clause(reason, i)
                    if self.use_reschedule and i < k:
                        push_obl(s, i + 1)
                    trim_with(reason, i)

            if self.use_clause_pushing:
                self._clause_push(k)
            if self._converged(k):
                return Result(False, stats=self._final_stats(k))

        return Result(False, stats=self._final_stats(self.max_k, hit_max=True))
