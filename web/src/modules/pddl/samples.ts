// PDDL sample domains + problems, copied VERBATIM from pdr/pddl.py's SAMPLES dict.
// These feed the "load sample" buttons in the PDDL Loader. The same verified
// solver parses + grounds these (in Pyodide via pdr/pddl.py).

export interface PddlSample {
  key: string;
  label: string;
  kind: "classical" | "fond";
  domain: string;
  problem: string;
  heavy?: boolean; // large/real instance — backend strongly recommended
}

// The standard IPC logistics domain (predicate-typed STRIPS) — exercises the
// grounder's static analysis.
const IPC_LOGISTICS_DOMAIN = `(define (domain logistics)
 (:requirements :strips)
 (:predicates (package ?o) (truck ?t) (airplane ?a) (airport ?p) (location ?l)
              (city ?c) (in-city ?l ?c) (at ?o ?l) (in ?o ?v))
 (:action load-truck :parameters (?o ?t ?l)
   :precondition (and (package ?o) (truck ?t) (location ?l) (at ?t ?l) (at ?o ?l))
   :effect (and (not (at ?o ?l)) (in ?o ?t)))
 (:action unload-truck :parameters (?o ?t ?l)
   :precondition (and (package ?o) (truck ?t) (location ?l) (at ?t ?l) (in ?o ?t))
   :effect (and (not (in ?o ?t)) (at ?o ?l)))
 (:action load-airplane :parameters (?o ?a ?l)
   :precondition (and (package ?o) (airplane ?a) (location ?l) (at ?o ?l) (at ?a ?l))
   :effect (and (not (at ?o ?l)) (in ?o ?a)))
 (:action unload-airplane :parameters (?o ?a ?l)
   :precondition (and (package ?o) (airplane ?a) (location ?l) (in ?o ?a) (at ?a ?l))
   :effect (and (not (in ?o ?a)) (at ?o ?l)))
 (:action drive-truck :parameters (?t ?from ?to ?c)
   :precondition (and (truck ?t) (location ?from) (location ?to) (city ?c)
                      (at ?t ?from) (in-city ?from ?c) (in-city ?to ?c))
   :effect (and (not (at ?t ?from)) (at ?t ?to)))
 (:action fly-airplane :parameters (?a ?from ?to)
   :precondition (and (airplane ?a) (airport ?from) (airport ?to) (at ?a ?from))
   :effect (and (not (at ?a ?from)) (at ?a ?to))))`;

export const SAMPLES: PddlSample[] = [
  {
    key: "logistics",
    label: "Logistics (classical)",
    kind: "classical",
    domain: `(define (domain logistics)
 (:requirements :strips :typing :equality)
 (:types loc pkg truck)
 (:predicates (atp ?p - pkg ?l - loc) (att ?t - truck ?l - loc) (inn ?p - pkg ?t - truck))
 (:action drive :parameters (?t - truck ?from - loc ?to - loc)
   :precondition (and (att ?t ?from) (not (= ?from ?to)))
   :effect (and (not (att ?t ?from)) (att ?t ?to)))
 (:action load :parameters (?t - truck ?p - pkg ?l - loc)
   :precondition (and (atp ?p ?l) (att ?t ?l))
   :effect (and (not (atp ?p ?l)) (inn ?p ?t)))
 (:action unload :parameters (?t - truck ?p - pkg ?l - loc)
   :precondition (and (inn ?p ?t) (att ?t ?l))
   :effect (and (atp ?p ?l) (not (inn ?p ?t)))))`,
    problem: `(define (problem log1) (:domain logistics)
 (:objects p0 p1 - pkg l0 l1 l2 - loc t0 - truck)
 (:init (atp p0 l0) (atp p1 l0) (att t0 l0))
 (:goal (and (atp p0 l2) (atp p1 l2))))`,
  },
  {
    key: "blocksworld",
    label: "Blocksworld (classical)",
    kind: "classical",
    domain: `(define (domain blocks)
 (:requirements :strips :typing :equality)
 (:types block)
 (:predicates (on ?x - block ?y - block) (ontable ?b - block) (clear ?b - block)
              (holding ?b - block) (handempty))
 (:action pickup :parameters (?b - block)
   :precondition (and (ontable ?b) (clear ?b) (handempty))
   :effect (and (not (ontable ?b)) (not (clear ?b)) (not (handempty)) (holding ?b)))
 (:action putdown :parameters (?b - block)
   :precondition (holding ?b)
   :effect (and (ontable ?b) (clear ?b) (handempty) (not (holding ?b))))
 (:action stack :parameters (?x - block ?y - block)
   :precondition (and (holding ?x) (clear ?y) (not (= ?x ?y)))
   :effect (and (not (holding ?x)) (not (clear ?y)) (clear ?x) (handempty) (on ?x ?y)))
 (:action unstack :parameters (?x - block ?y - block)
   :precondition (and (on ?x ?y) (clear ?x) (handempty) (not (= ?x ?y)))
   :effect (and (holding ?x) (not (clear ?x)) (clear ?y) (not (on ?x ?y)) (not (handempty)))))`,
    problem: `(define (problem bw1) (:domain blocks)
 (:objects b0 b1 b2 - block)
 (:init (ontable b0) (ontable b1) (ontable b2) (clear b0) (clear b1) (clear b2) (handempty))
 (:goal (and (on b0 b1) (on b1 b2))))`,
  },
  {
    key: "clumsy",
    label: "Clumsy Blocksworld (FOND)",
    kind: "fond",
    domain: `(define (domain clumsy)
 (:requirements :strips :typing :equality :non-deterministic)
 (:types block)
 (:predicates (on ?x - block ?y - block) (ontable ?b - block) (clear ?b - block)
              (holding ?b - block) (handempty))
 (:action pickup :parameters (?b - block)
   :precondition (and (ontable ?b) (clear ?b) (handempty))
   :effect (oneof (and (not (ontable ?b)) (not (clear ?b)) (not (handempty)) (holding ?b))
                  (and)))
 (:action putdown :parameters (?b - block)
   :precondition (holding ?b)
   :effect (and (ontable ?b) (clear ?b) (handempty) (not (holding ?b))))
 (:action stack :parameters (?x - block ?y - block)
   :precondition (and (holding ?x) (clear ?y) (not (= ?x ?y)))
   :effect (oneof (and (not (holding ?x)) (not (clear ?y)) (clear ?x) (handempty) (on ?x ?y))
                  (and (not (holding ?x)) (clear ?x) (handempty) (ontable ?x)))))`,
    problem: `(define (problem c1) (:domain clumsy)
 (:objects b0 b1 - block)
 (:init (ontable b0) (ontable b1) (clear b0) (clear b1) (handempty))
 (:goal (on b0 b1)))`,
  },
  {
    key: "ipc-mini",
    label: "Logistics — IPC style (trucks + airplane)",
    kind: "classical",
    domain: IPC_LOGISTICS_DOMAIN,
    problem: `(define (problem logistics-mini) (:domain logistics)
 (:objects c1 c2 pos1 apt1 pos2 apt2 t1 t2 a1 p1 p2)
 (:init (city c1) (city c2) (location pos1) (location apt1) (location pos2)
        (location apt2) (airport apt1) (airport apt2)
        (truck t1) (truck t2) (airplane a1) (package p1) (package p2)
        (in-city pos1 c1) (in-city apt1 c1) (in-city pos2 c2) (in-city apt2 c2)
        (at t1 pos1) (at t2 pos2) (at a1 apt1) (at p1 pos1) (at p2 pos1))
 (:goal (and (at p1 pos2) (at p2 apt2))))`,
  },
  {
    key: "ipc-10-0",
    label: "Logistics-10-0 — REAL IPC-2000 (backend recommended)",
    kind: "classical",
    heavy: true,
    domain: IPC_LOGISTICS_DOMAIN,
    problem: `(define (problem logistics-10-0) (:domain logistics)
(:objects apn1 apt4 pos4 apt3 pos3 apt2 pos2 apt1 pos1 cit4 cit3 cit2 cit1 tru4 tru3 tru2 tru1 obj43 obj42 obj41 obj33 obj32 obj31 obj23 obj22 obj21 obj13 obj12 obj11)
(:init (package obj11) (package obj12) (package obj13) (package obj21)
 (package obj22) (package obj23) (package obj31) (package obj32) (package obj33)
 (package obj41) (package obj42) (package obj43) (truck tru1) (truck tru2)
 (truck tru3) (truck tru4) (city cit1) (city cit2) (city cit3) (city cit4)
 (location pos1) (location apt1) (location pos2) (location apt2) (location pos3)
 (location apt3) (location pos4) (location apt4) (airport apt1) (airport apt2)
 (airport apt3) (airport apt4) (airplane apn1) (at apn1 apt1) (at tru1 pos1)
 (at obj11 pos1) (at obj12 pos1) (at obj13 pos1) (at tru2 pos2) (at obj21 pos2)
 (at obj22 pos2) (at obj23 pos2) (at tru3 pos3) (at obj31 pos3) (at obj32 pos3)
 (at obj33 pos3) (at tru4 pos4) (at obj41 pos4) (at obj42 pos4) (at obj43 pos4)
 (in-city pos1 cit1) (in-city apt1 cit1) (in-city pos2 cit2) (in-city apt2 cit2)
 (in-city pos3 cit3) (in-city apt3 cit3) (in-city pos4 cit4) (in-city apt4 cit4))
(:goal (and (at obj31 pos3) (at obj33 apt3) (at obj41 apt3) (at obj23 pos4)
            (at obj11 pos3) (at obj22 apt2) (at obj12 apt1) (at obj21 pos4)
            (at obj42 pos4) (at obj32 pos1))))`,
  },
];

export const LOGISTICS = SAMPLES[0];
