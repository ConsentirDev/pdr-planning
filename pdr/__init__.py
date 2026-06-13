"""PDR planning toolkit -- a runnable reproduction of Ava Clifton's thesis
"Advancing Property Directed Reachability for Classical and FOND Planning".

Chapters mapped to code:
    Ch 2/3  pdr.py        classical PDR + PDR-M + PDR-IL
    Ch 4    parallel.py   PS-PDR (parallel obligation processing)
    Ch 5    decomp.py     PD-PDR (decompositional)
    Ch 6    fond.py       FOND-PDR (+ fond_encoding.py, Schemas 6-15)
    L0/L1   selfimprove.py  self-configuring portfolio over the solver family
    L2/L3   operators.py + evolve.py  evolving search operators (LLM-in-the-loop)
"""
from .planning import (Problem, Action, FONDProblem, FONDAction,
                       validate_plan, validate_policy)
from .pdr import PDR, Result
from .parallel import PSPDR
from .decomp import PDPDR
from .fond import FONDPDR, FONDResult, compute_policy, reference_answer
from .domains import (logistics, blocksworld, unsolvable_logistics, fuel_logistics,
                      clumsy_blocksworld, clumsy_blocksworld_thesis,
                      escher_blocksworld, ALL_DOMAINS, FOND_DOMAINS)
from .sat import make_solver, have_pysat
from .operators import Operator, seed_operators, baseline_operator
from .evolve import (evolutionary_search, llm_search, meta_evolve,
                     evaluate, Archive)

__all__ = [
    "Problem", "Action", "FONDProblem", "FONDAction",
    "validate_plan", "validate_policy",
    "PDR", "Result", "PSPDR", "PDPDR", "FONDPDR", "FONDResult",
    "compute_policy", "reference_answer",
    "logistics", "blocksworld", "unsolvable_logistics", "fuel_logistics",
    "clumsy_blocksworld", "clumsy_blocksworld_thesis", "escher_blocksworld",
    "ALL_DOMAINS", "FOND_DOMAINS", "make_solver", "have_pysat",
    "Operator", "seed_operators", "baseline_operator",
    "evolutionary_search", "llm_search", "meta_evolve", "evaluate", "Archive",
]
