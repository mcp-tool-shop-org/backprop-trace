/**
 * PH-ENG-01 — degenerate-topology FLOOR for assertTopologyValid.
 *
 * assertTopologyValid had a per-layer size CEILING (TOPOLOGY_SIZE_CEILING
 * = 512) but no minimum floor. A per_layer topology with output_size: 0
 * (or input_size: 0 / hidden_size: 0) therefore ran end-to-end and
 * reconciled as a VACUOUS green PASS: loss.total === 0, no output error
 * signals, an empty update set — a "verified" training step that verifies
 * nothing. The floor rejects that at the topology boundary, the same way
 * the ceiling rejects adversarial sizes.
 *
 * Coverage:
 *   1. A size-0 topology on each of input/hidden/output is REJECTED with
 *      the "below the verifier minimum of 1" + "vacuous receipt" message.
 *   2. A topology with an emptied-out unit_order layer (output_size: 0 +
 *      unit_order.output: []) is REJECTED at the floor — BEFORE the
 *      length-vs-size and fan-in checks (the floor is the first gate).
 *   3. A non-integer / negative size is REJECTED too (the floor is
 *      `Number.isInteger(size) && size >= 1`).
 *   4. The three canonical topologies (MAZUR/XOR/IRIS, all 2-2-2 / 2-2-1 /
 *      4-3-3) STILL validate cleanly — the floor adds no false rejection.
 */

import { test } from "node:test"
import assert from "node:assert/strict"
import { assertTopologyValid, type Topology } from "../src/topology.js"
import {
  IRIS_TOPOLOGY,
  MAZUR_TOPOLOGY,
  XOR_TOPOLOGY,
} from "../src/mazur.js"

type Mutable<T> = {
  -readonly [P in keyof T]: T[P] extends ReadonlyArray<infer U>
    ? Array<Mutable<U>>
    : T[P] extends object
      ? Mutable<T[P]>
      : T[P]
}

function cloneMutable(t: Topology): Mutable<Topology> {
  return structuredClone(t) as unknown as Mutable<Topology>
}

/** The exact, message-pinned floor diagnostic (shared by every dimension). */
const FLOOR_MESSAGE = /below the verifier minimum of 1/i
const VACUOUS_HINT = /vacuous receipt/i

test("assertTopologyValid rejects output_size: 0 with the floor diagnostic", () => {
  const bad = cloneMutable(MAZUR_TOPOLOGY)
  bad.output_size = 0
  assert.throws(
    () => assertTopologyValid(bad as unknown as Topology),
    (err: unknown) => {
      assert.ok(err instanceof Error, "must throw an Error")
      assert.match(err.message, FLOOR_MESSAGE)
      assert.match(err.message, /output_size/)
      assert.match(err.message, VACUOUS_HINT)
      return true
    },
    "output_size 0 must be rejected — it produces a vacuous green PASS",
  )
})

test("assertTopologyValid rejects input_size: 0 with the floor diagnostic", () => {
  const bad = cloneMutable(MAZUR_TOPOLOGY)
  bad.input_size = 0
  assert.throws(
    () => assertTopologyValid(bad as unknown as Topology),
    (err: unknown) => {
      assert.ok(err instanceof Error)
      assert.match(err.message, FLOOR_MESSAGE)
      assert.match(err.message, /input_size/)
      return true
    },
    "input_size 0 must be rejected at the floor",
  )
})

test("assertTopologyValid rejects hidden_size: 0 with the floor diagnostic", () => {
  const bad = cloneMutable(MAZUR_TOPOLOGY)
  bad.hidden_size = 0
  assert.throws(
    () => assertTopologyValid(bad as unknown as Topology),
    (err: unknown) => {
      assert.ok(err instanceof Error)
      assert.match(err.message, FLOOR_MESSAGE)
      assert.match(err.message, /hidden_size/)
      return true
    },
    "hidden_size 0 must be rejected at the floor",
  )
})

test("assertTopologyValid rejects an emptied output layer (size 0 + empty unit_order) at the floor FIRST", () => {
  // A fully-degenerate output layer: size 0 AND the unit_order list emptied to
  // match. Without the floor this would slip past the length-vs-size check
  // (0 === 0) and the fan-in check (no output units to validate) and reconcile
  // as a vacuous PASS. The floor must fire FIRST, before either of those.
  const bad = cloneMutable(MAZUR_TOPOLOGY)
  bad.output_size = 0
  bad.unit_order.output = []
  assert.throws(
    () => assertTopologyValid(bad as unknown as Topology),
    FLOOR_MESSAGE,
    "an emptied output layer must be rejected by the floor, not silently accepted",
  )
})

test("assertTopologyValid rejects a non-integer / negative size at the floor", () => {
  const negative = cloneMutable(MAZUR_TOPOLOGY)
  negative.output_size = -1
  assert.throws(
    () => assertTopologyValid(negative as unknown as Topology),
    FLOOR_MESSAGE,
    "a negative size must be rejected by the integer-and-floor check",
  )

  const fractional = cloneMutable(MAZUR_TOPOLOGY)
  fractional.input_size = 1.5
  assert.throws(
    () => assertTopologyValid(fractional as unknown as Topology),
    FLOOR_MESSAGE,
    "a non-integer size must be rejected by the integer-and-floor check",
  )
})

test("assertTopologyValid still accepts the three canonical topologies after the floor lands", () => {
  // No-regression: the floor must not false-reject any legitimate topology.
  assert.doesNotThrow(
    () => assertTopologyValid(MAZUR_TOPOLOGY),
    "MAZUR_TOPOLOGY (2-2-2) must still validate",
  )
  assert.doesNotThrow(
    () => assertTopologyValid(XOR_TOPOLOGY),
    "XOR_TOPOLOGY (2-2-1) must still validate",
  )
  assert.doesNotThrow(
    () => assertTopologyValid(IRIS_TOPOLOGY),
    "IRIS_TOPOLOGY (4-3-3) must still validate",
  )
})
