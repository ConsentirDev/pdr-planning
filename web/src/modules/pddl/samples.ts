// PDDL sample domains + problems, copied VERBATIM from pdr/pddl.py's SAMPLES dict.
// These feed the "load sample" buttons in the PDDL Loader. The same verified
// solver parses + grounds these (in Pyodide via pdr/pddl.py).

export interface PddlSample {
  key: string;
  label: string;
  kind: "classical" | "fond";
  domain: string;
  problem: string;
}

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
];

export const LOGISTICS = SAMPLES[0];
