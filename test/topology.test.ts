/**
 * v0.3 Topology type + assertTopologyValid tests.
 *
 * Coverage:
 *   1. The three canonical exported topologies (MAZUR_TOPOLOGY,
 *      XOR_TOPOLOGY, IRIS_TOPOLOGY) all validate clean. This is the
 *      "all canonical fixtures stay green" floor — a refactor that
 *      breaks the validator on any of the three is caught here.
 *   2. Negative cases for the load-bearing invariants:
 *        - duplicate unit ids across layers (engine maps are keyed by
 *          unit id; a clash silently overwrites in v0.1, throws in v0.3).
 *        - parameter_order / parameters[] length mismatch (the projection
 *          contract that pins update iteration byte-stability).
 *        - a weight that points at a non-existent unit id.
 *
 * Each negative case uses a structuredClone of MAZUR_TOPOLOGY and mutates
 * a single field — keeps the test pattern uniform and confines the
 * change-under-test to a one-line diff in the test body.
 *
 * Note: assertTopologyValid throws on the first violation with a
 * path-naming Error (per the topology.ts JSDoc). We use assert.throws with
 * a substring matcher so the test stays robust against future error-
 * message wording changes while still asserting the right invariant fires.
 */

import { test } from "node:test"
import assert from "node:assert/strict"
import {
  assertTopologyValid,
  type Parameter,
  type Topology,
} from "../src/topology.js"
import {
  IRIS_TOPOLOGY,
  MAZUR_TOPOLOGY,
  XOR_TOPOLOGY,
} from "../src/mazur.js"

/**
 * Deep-clone a Topology to a mutable shape suitable for in-test mutation.
 * The canonical topologies are deeply readonly so we cast through `unknown`
 * after structuredClone strips the readonly hints.
 */
function cloneMutable(t: Topology): Mutable<Topology> {
  return structuredClone(t) as unknown as Mutable<Topology>
}

type Mutable<T> = {
  -readonly [P in keyof T]: T[P] extends ReadonlyArray<infer U>
    ? Array<Mutable<U>>
    : T[P] extends object
      ? Mutable<T[P]>
      : T[P]
}

test("assertTopologyValid accepts MAZUR_TOPOLOGY without throwing", () => {
  assert.doesNotThrow(
    () => assertTopologyValid(MAZUR_TOPOLOGY),
    "MAZUR_TOPOLOGY must validate cleanly — it is the v0.1/v0.3 anchor topology",
  )
})

test("assertTopologyValid accepts XOR_TOPOLOGY without throwing", () => {
  assert.doesNotThrow(
    () => assertTopologyValid(XOR_TOPOLOGY),
    "XOR_TOPOLOGY must validate cleanly — it is a v0.3 canonical fixture",
  )
})

test("assertTopologyValid accepts IRIS_TOPOLOGY without throwing", () => {
  assert.doesNotThrow(
    () => assertTopologyValid(IRIS_TOPOLOGY),
    "IRIS_TOPOLOGY must validate cleanly — it is a v0.3 canonical fixture",
  )
})

test("assertTopologyValid throws on duplicate unit ids across layers", () => {
  const bad = cloneMutable(MAZUR_TOPOLOGY)
  // Reuse the input id 'i1' as a hidden id — engine maps key by unit id
  // without layer prefix, so this would silently corrupt forward/backward.
  bad.unit_order.hidden[0] = "i1"
  // Keep parameter targets pointing at h1 so we hit the duplicate-unit
  // invariant first (not the unresolvable-target one). Rewrite both
  // weight params that target h1 to instead target i1 (the new "hidden"
  // id) so structural shape stays consistent for the early-exit check.
  for (const p of bad.parameters) {
    if (p.to_unit === "h1") p.to_unit = "i1"
    if (p.from_unit === "h1") p.from_unit = "i1"
  }
  if (bad.parameters[8] !== undefined && bad.parameters[8].applies_to_units) {
    bad.parameters[8].applies_to_units = ["i1", "h2"]
  }
  assert.throws(
    () => assertTopologyValid(bad as unknown as Topology),
    /duplicate unit ids/i,
    "duplicate unit id across layers must throw with a 'duplicate unit ids' diagnostic",
  )
})

test("assertTopologyValid throws on parameter_order / parameters[] length mismatch", () => {
  const bad = cloneMutable(MAZUR_TOPOLOGY)
  // Drop the last parameter_order entry but keep parameters[] intact —
  // the projection-equality contract is violated by either side disagreeing
  // on length OR the i-th id pair.
  bad.parameter_order = bad.parameter_order.slice(0, -1)
  assert.throws(
    () => assertTopologyValid(bad as unknown as Topology),
    /parameter_order/i,
    "length mismatch must throw a parameter_order-named diagnostic",
  )
})

test("assertTopologyValid throws on a weight that points at a non-existent unit id", () => {
  const bad = cloneMutable(MAZUR_TOPOLOGY)
  // Repoint w1 (an input_to_hidden_weight) to a non-existent hidden unit
  // 'h_does_not_exist' so the resolvability check trips.
  const w1 = bad.parameters.find((p: Parameter) => p.id === "w1")
  assert.ok(w1, "test setup: MAZUR_TOPOLOGY must declare w1")
  w1!.to_unit = "h_does_not_exist"
  assert.throws(
    () => assertTopologyValid(bad as unknown as Topology),
    /h_does_not_exist|to_unit/i,
    "unit-id-not-in-layer must throw a diagnostic naming the offending unit or to_unit field",
  )
})

// --- G-020: unique WIRING (not just unique parameter ids) -------------------
//
// assertTopologyValid historically enforced unique parameter IDS but said
// nothing about the (from_unit, to_unit) EDGE the weight occupies. Two
// distinct-id weights could share the same edge (double-counting that edge in
// the forward sum, with the update phase writing two parameters for one wire),
// or a hidden/output unit could receive the wrong NUMBER of incoming weights
// (a missing or extra wire silently changes the net sum). Both are topology
// defects the engine would otherwise run on, emitting a wrong-but-self-
// consistent receipt the reconciler's engine-recompute reproduces (false PASS).

test("assertTopologyValid throws on two weights sharing the same (from_unit,to_unit) edge", () => {
  const bad = cloneMutable(MAZUR_TOPOLOGY)
  // w1 is i1->h1, w2 is i2->h1. Repoint w2's from_unit to i1 so BOTH w1 and
  // w2 occupy the edge i1->h1. Fan-in into h1 stays 2 (w1 + w2), so this is
  // caught by the duplicate-EDGE check, not the fan-in count check — h1 now
  // has two wires from i1 and ZERO from i2.
  const w2 = bad.parameters.find((p: Parameter) => p.id === "w2")
  assert.ok(w2, "test setup: MAZUR_TOPOLOGY must declare w2")
  w2!.from_unit = "i1"
  assert.throws(
    () => assertTopologyValid(bad as unknown as Topology),
    /duplicate|same edge|already.*connect|i1.*h1|from_unit.*to_unit/i,
    "two weights on the same (from_unit,to_unit) edge must throw a wiring-duplication diagnostic",
  )
})

test("assertTopologyValid throws when a hidden unit's input fan-in != input_size", () => {
  const bad = cloneMutable(MAZUR_TOPOLOGY)
  // Drop w2 (i2->h1) from BOTH parameters[] and parameter_order at the same
  // index so the projection-equality contract (parameters[i].id ===
  // parameter_order[i]) stays intact. h1 then receives only w1 (i1->h1) =
  // fan-in 1, but input_size is 2 — every hidden unit MUST be fed by exactly
  // input_size incoming weights. No duplicate edge is introduced, so this
  // isolates the fan-in count invariant.
  const idx = bad.parameters.findIndex((p: Parameter) => p.id === "w2")
  assert.ok(idx >= 0, "test setup: MAZUR_TOPOLOGY must declare w2")
  bad.parameters.splice(idx, 1)
  bad.parameter_order.splice(bad.parameter_order.indexOf("w2"), 1)
  assert.throws(
    () => assertTopologyValid(bad as unknown as Topology),
    /fan-in|fan_in|input_size|incoming.*weight|expected.*2|h1/i,
    "a hidden unit fed by fewer than input_size weights must throw a fan-in diagnostic",
  )
})

test("assertTopologyValid throws when an output unit's hidden fan-in != hidden_size", () => {
  const bad = cloneMutable(MAZUR_TOPOLOGY)
  // Drop w6 (h2->o1) from both arrays at the matching index. o1 then receives
  // only w5 (h1->o1) = fan-in 1, but hidden_size is 2 — every output unit MUST
  // be fed by exactly hidden_size incoming weights.
  const idx = bad.parameters.findIndex((p: Parameter) => p.id === "w6")
  assert.ok(idx >= 0, "test setup: MAZUR_TOPOLOGY must declare w6")
  bad.parameters.splice(idx, 1)
  bad.parameter_order.splice(bad.parameter_order.indexOf("w6"), 1)
  assert.throws(
    () => assertTopologyValid(bad as unknown as Topology),
    /fan-in|fan_in|hidden_size|incoming.*weight|expected.*2|o1/i,
    "an output unit fed by fewer than hidden_size weights must throw a fan-in diagnostic",
  )
})
