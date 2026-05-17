/**
 * v0.3 generalized engine tests — runGeneralStep math correctness.
 *
 * Three families:
 *
 *   1. Mazur cross-engine equivalence. The Mazur 2-2-2 topology runs
 *      through BOTH runMazurStep (v0.1 path) and runGeneralStep adapted
 *      with MAZUR_TOPOLOGY (v0.3 path). For the same arithmetic operations
 *      in the same order — guaranteed by mirrored unit_order +
 *      parameter_order pins — the two receipts must agree on every
 *      numeric field within 1e-15 (effectively bit-exact). Schema version
 *      differs (0.1.0 vs 0.2.0) — that's expected.
 *
 *   2. XOR-sigmoid structural shape. runGeneralStep(XOR_INPUT) must
 *      produce a receipt with the right schema_version, the right
 *      topology projection, the right input/target/forward unit ids, the
 *      right parameter count, and biases unchanged (per
 *      bias_policy.mode === "constant").
 *
 *   3. Iris structural shape. Same family of assertions, scaled to the
 *      4-3-3 topology (4 inputs, 3 hidden, 3 outputs, 23 parameters).
 *
 * Math correctness for the non-Mazur topologies is proven by Family 1
 * (the engine code paths are identical — only the topology projection
 * differs). Receipt-shape correctness is proven here.
 */

import { test } from "node:test"
import assert from "node:assert/strict"
import { runMazurStep } from "../src/engine.js"
import { runGeneralStep, type GeneralInput } from "../src/general-engine.js"
import {
  IRIS_INPUT,
  MAZUR_INPUT,
  MAZUR_TOPOLOGY,
  XOR_INPUT,
} from "../src/mazur.js"

/**
 * Construct a GeneralInput from MAZUR_INPUT against MAZUR_TOPOLOGY so the
 * generalized engine runs the exact same arithmetic the Mazur path does.
 *
 * Uses MAZUR_INPUT's scalars verbatim — only the topology wrapper differs.
 * The v0.3 hybrid-tolerance object form replaces the v0.1 scalar so the
 * generalized receipt's numeric_policy shape matches the v0.2.0 schema's
 * declared object form (the scalar form is read-only legacy per memo §3).
 */
function mazurAsGeneralInput(): GeneralInput {
  return {
    topology: MAZUR_TOPOLOGY,
    learning_rate: MAZUR_INPUT.learning_rate,
    inputs: { ...MAZUR_INPUT.inputs },
    targets: { ...MAZUR_INPUT.targets },
    parameters_before: { ...MAZUR_INPUT.parameters_before },
    numeric_policy: {
      number_encoding: "decimal",
      precision_significant_digits: 9,
      rounding: "round_half_to_even",
      tolerance: { atol: 1e-12, rtol: 1e-9 },
      computation_order: "schema_defined",
      byte_output: {
        format: "jsonl",
        json_key_order: "schema_defined",
        trailing_zero_policy: "pad_to_significant_digits",
        indent: "none",
      },
    },
    bias_policy: {
      mode: "constant",
      reason: MAZUR_INPUT.bias_policy.reason,
      updated_in_step: false,
      reconciliation: MAZUR_INPUT.bias_policy.reconciliation,
    },
  }
}

test("runGeneralStep on Mazur produces numerically identical math to runMazurStep", () => {
  const mazurReceipt = runMazurStep(MAZUR_INPUT)
  const generalReceipt = runGeneralStep(mazurAsGeneralInput())

  // Schema versions differ by design (memo §1).
  assert.strictEqual(mazurReceipt.schema_version, "0.1.0")
  assert.strictEqual(generalReceipt.schema_version, "0.2.0")

  // Forward pass — every hidden + output unit's net + out must agree
  // bit-exact (same arithmetic operations in the same order is the
  // contract; we still use a 1e-15 floor to allow for any non-load-bearing
  // float jitter — Mazur math runs comfortably above this floor).
  const TOL = 1e-15
  for (const uid of ["h1", "h2", "o1", "o2"] as const) {
    const m = mazurReceipt.forward[uid]
    const g = generalReceipt.forward[uid]
    assert.ok(g, `general forward.${uid} must exist`)
    assert.ok(
      Math.abs(m.net - g.net) <= TOL,
      `forward.${uid}.net mismatch: mazur=${m.net}, general=${g.net}, delta=${Math.abs(m.net - g.net)}`,
    )
    assert.ok(
      Math.abs(m.out - g.out) <= TOL,
      `forward.${uid}.out mismatch: mazur=${m.out}, general=${g.out}, delta=${Math.abs(m.out - g.out)}`,
    )
  }

  // Loss
  assert.ok(
    Math.abs(mazurReceipt.loss.total - generalReceipt.loss.total) <= TOL,
    `loss.total mismatch: mazur=${mazurReceipt.loss.total}, general=${generalReceipt.loss.total}`,
  )
  assert.ok(
    Math.abs(mazurReceipt.loss.per_output.o1 - (generalReceipt.loss.per_output.o1 ?? NaN)) <= TOL,
    "loss.per_output.o1 mismatch",
  )
  assert.ok(
    Math.abs(mazurReceipt.loss.per_output.o2 - (generalReceipt.loss.per_output.o2 ?? NaN)) <= TOL,
    "loss.per_output.o2 mismatch",
  )

  // Output error signals
  for (const oid of ["o1", "o2"] as const) {
    const m = mazurReceipt.backward.output_error_signals[oid]
    const g = generalReceipt.backward.output_error_signals[oid]
    assert.ok(g, `general backward.output_error_signals.${oid} must exist`)
    assert.ok(
      Math.abs(m.signal_value - g.signal_value) <= TOL,
      `output_error_signals.${oid}.signal_value mismatch: mazur=${m.signal_value}, general=${g.signal_value}`,
    )
  }

  // Hidden error signals
  for (const hid of ["h1", "h2"] as const) {
    const m = mazurReceipt.backward.hidden_error_signals[hid]
    const g = generalReceipt.backward.hidden_error_signals[hid]
    assert.ok(g, `general backward.hidden_error_signals.${hid} must exist`)
    assert.ok(
      Math.abs(m.signal_value - g.signal_value) <= TOL,
      `hidden_error_signals.${hid}.signal_value mismatch`,
    )
    assert.ok(
      Math.abs(m.backpropagated_sum - g.backpropagated_sum) <= TOL,
      `hidden_error_signals.${hid}.backpropagated_sum mismatch`,
    )
  }

  // Parameters_after — weights updated, biases unchanged (constant policy).
  const paramIds = ["w1", "w2", "w3", "w4", "w5", "w6", "w7", "w8", "b1", "b2"] as const
  for (const pid of paramIds) {
    const m = (mazurReceipt.parameters_after as Record<string, number>)[pid]!
    const g = generalReceipt.parameters_after[pid]!
    assert.ok(
      Math.abs(m - g) <= TOL,
      `parameters_after.${pid} mismatch: mazur=${m}, general=${g}, delta=${Math.abs(m - g)}`,
    )
  }
  // Biases explicitly unchanged in both engines.
  assert.strictEqual(
    generalReceipt.parameters_after.b1,
    generalReceipt.parameters_before.b1,
    "general engine: b1 must remain unchanged per bias_policy.mode === 'constant'",
  )
  assert.strictEqual(
    generalReceipt.parameters_after.b2,
    generalReceipt.parameters_before.b2,
    "general engine: b2 must remain unchanged per bias_policy.mode === 'constant'",
  )

  // Post-update loss
  assert.ok(
    Math.abs(mazurReceipt.post_update_loss.total - generalReceipt.post_update_loss.total) <= TOL,
    `post_update_loss.total mismatch: mazur=${mazurReceipt.post_update_loss.total}, general=${generalReceipt.post_update_loss.total}`,
  )
})

test("runGeneralStep(XOR_INPUT) — schema_version + unit_order + parameter_order + forward/inputs/targets shape", () => {
  const r = runGeneralStep(XOR_INPUT)

  assert.strictEqual(r.schema_version, "0.2.0", "XOR receipt schema_version is v0.2.0")

  // unit_order projection
  assert.deepStrictEqual(
    r.topology.unit_order.input,
    ["x1", "x2"],
    "XOR input unit_order",
  )
  assert.deepStrictEqual(
    r.topology.unit_order.hidden,
    ["h1", "h2"],
    "XOR hidden unit_order",
  )
  assert.deepStrictEqual(
    r.topology.unit_order.output,
    ["y"],
    "XOR output unit_order",
  )

  // parameter_order length
  assert.strictEqual(
    r.topology.parameter_order.length,
    8,
    "XOR parameter_order length (6 weights + 2 biases)",
  )

  // inputs + targets keying
  assert.deepStrictEqual(
    Object.keys(r.inputs).sort(),
    ["x1", "x2"],
    "inputs keys",
  )
  assert.deepStrictEqual(
    Object.keys(r.targets).sort(),
    ["y"],
    "targets keys",
  )

  // forward must have entries for every hidden + output unit
  assert.deepStrictEqual(
    Object.keys(r.forward).sort(),
    ["h1", "h2", "y"],
    "forward entries for h1, h2, y",
  )

  // parameters_after differs from parameters_before only on weights (per
  // bias_policy.mode === "constant").
  for (const pid of r.topology.parameter_order) {
    const before = r.parameters_before[pid]!
    const after = r.parameters_after[pid]!
    const param = r.topology.parameters.find((p) => p.id === pid)!
    if (param.role === "hidden_bias" || param.role === "output_bias") {
      assert.strictEqual(
        after,
        before,
        `XOR bias '${pid}' must be unchanged (constant policy); before=${before}, after=${after}`,
      )
    }
    // Weights MAY equal before if the gradient happened to be 0; we
    // don't assert inequality, only that biases ARE unchanged.
  }
})

test("runGeneralStep(IRIS_INPUT) — 4 inputs, 3 hidden, 3 outputs", () => {
  const r = runGeneralStep(IRIS_INPUT)

  assert.strictEqual(r.schema_version, "0.2.0")
  assert.strictEqual(r.topology.input_size, 4)
  assert.strictEqual(r.topology.hidden_size, 3)
  assert.strictEqual(r.topology.output_size, 3)

  assert.strictEqual(r.topology.unit_order.input.length, 4, "iris has 4 input units")
  assert.strictEqual(r.topology.unit_order.hidden.length, 3, "iris has 3 hidden units")
  assert.strictEqual(r.topology.unit_order.output.length, 3, "iris has 3 output units")

  // 4*3 input-to-hidden + 3*3 hidden-to-output + 2 biases = 23 parameters
  assert.strictEqual(
    r.topology.parameter_order.length,
    23,
    "iris parameter_order length = 4*3 + 3*3 + 2 = 23",
  )

  // inputs + targets must cover every input + output unit
  for (const uid of r.topology.unit_order.input) {
    assert.ok(
      typeof r.inputs[uid] === "number",
      `iris inputs must have numeric entry for ${uid}`,
    )
  }
  for (const uid of r.topology.unit_order.output) {
    assert.ok(
      typeof r.targets[uid] === "number",
      `iris targets must have numeric entry for ${uid}`,
    )
  }

  // Biases unchanged (constant policy)
  assert.strictEqual(
    r.parameters_after.b_hidden,
    r.parameters_before.b_hidden,
    "iris b_hidden unchanged",
  )
  assert.strictEqual(
    r.parameters_after.b_output,
    r.parameters_before.b_output,
    "iris b_output unchanged",
  )
})
