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
import {
  runGeneralStep,
  runBatchedGeneralStep,
  type GeneralInput,
  type BatchedGeneralInput,
} from "../src/general-engine.js"
import {
  IRIS_INPUT,
  MAZUR_INPUT,
  MAZUR_TOPOLOGY,
  SOFTMAX_CE_INPUT,
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

// ===========================================================================
// G-009 — CE+softmax targets must sum to 1 (latent false-PASS surface)
//
// The collapsed output error signal y_u - p_u is the correct descent gradient
// ONLY when targets sum to 1. Non-normalized targets emit a WRONG collapsed
// gradient that Rule 14 (engine-recompute) reproduces byte-for-byte → false
// PASS. runGeneralStep must reject non-normalized CE+softmax targets at the
// boundary.
//
// Non-vacuity / mutation that turns this RED again: delete the
// `assertTargetsNormalizedForSoftmaxCE(input)` call in runGeneralStep (or
// change the `if (Math.abs(targetSum - 1) > NORMALIZATION_ATOL)` guard to a
// no-op). With the gate removed the engine accepts the 0.9-sum input and emits
// a receipt instead of throwing, so `assert.throws` fails.
// ===========================================================================

test("G-009: runGeneralStep throws on CE+softmax targets summing to 0.9", () => {
  // Build a non-normalized CE+softmax input inline by overriding the targets of
  // the shipped softmax-ce fixture so they sum to 0.9 (a one-hot 1 demoted to
  // 0.9, the other two left at 0). Every other field stays valid so the ONLY
  // defect under test is non-normalized targets.
  const badInput: GeneralInput = {
    ...SOFTMAX_CE_INPUT,
    targets: { o1: 0.9, o2: 0, o3: 0 }, // sum = 0.9, NOT a probability distribution
  }
  // Sanity: confirm the construction actually sums to 0.9 (guards the fixture
  // against silent drift if SOFTMAX_CE_INPUT's output unit order ever changes).
  const sum = badInput.targets.o1! + badInput.targets.o2! + badInput.targets.o3!
  assert.strictEqual(sum, 0.9, "test fixture must have targets summing to 0.9")

  assert.throws(
    () => runGeneralStep(badInput),
    /cross_entropy_softmax targets must sum to 1/,
    "runGeneralStep must reject non-normalized CE+softmax targets (sum=0.9) at the boundary",
  )
})

test("G-009: runGeneralStep accepts normalized CE+softmax golden (targets sum to 1)", () => {
  // Regression-safety: the shipped softmax-ce fixture has one-hot targets
  // summing to exactly 1.0 and MUST still pass the normalization gate.
  const sum =
    SOFTMAX_CE_INPUT.targets.o1! +
    SOFTMAX_CE_INPUT.targets.o2! +
    SOFTMAX_CE_INPUT.targets.o3!
  assert.strictEqual(sum, 1, "SOFTMAX_CE_INPUT targets must sum to exactly 1")
  assert.doesNotThrow(
    () => runGeneralStep(SOFTMAX_CE_INPUT),
    "the normalized softmax-ce golden input must still run without throwing",
  )
})

// ===========================================================================
// G-010 — batched reduction:'none' must reject size > 1
//
// reduce() handles reduction:'none' by returning vals[0], silently discarding
// every sample after the first for BOTH the reduced gradient and loss. A
// 3-sample 'none' batch yields parameters_after byte-identical to a 1-sample
// batch on s0; Rule 14 reproduces it and Rule 18 skips for non-mean/sum →
// false assurance an N-sample update occurred. runBatchedGeneralStep must
// reject reduction:'none' with size > 1.
//
// Non-vacuity / mutation that turns this RED again: delete the
// `if (input.batch.reduction === "none" && input.batch.size > 1) throw ...`
// guard in runBatchedGeneralStep. Without it the 3-sample 'none' batch returns
// a receipt (silently using only s0) instead of throwing, so `assert.throws`
// fails.
// ===========================================================================

test("G-010: runBatchedGeneralStep throws on a 3-sample reduction:'none' batch", () => {
  // Build a 3-sample batch over the XOR topology (real, validated). Three
  // DISTINCT samples so that "only the first survives" is observably wrong:
  // if reduction silently kept s0 the other two inputs would be discarded.
  const badBatch: BatchedGeneralInput = {
    topology: XOR_INPUT.topology,
    learning_rate: XOR_INPUT.learning_rate,
    parameters_before: { ...XOR_INPUT.parameters_before },
    numeric_policy: XOR_INPUT.numeric_policy,
    bias_policy: XOR_INPUT.bias_policy,
    batch: {
      size: 3,
      sample_order: ["s0", "s1", "s2"],
      reduction: "none",
    },
    per_sample: {
      s0: { inputs: { x1: 1, x2: 0 }, targets: { y: 1 } },
      s1: { inputs: { x1: 0, x2: 1 }, targets: { y: 1 } },
      s2: { inputs: { x1: 1, x2: 1 }, targets: { y: 0 } },
    },
  }
  assert.throws(
    () => runBatchedGeneralStep(badBatch),
    /batch\.reduction 'none' is invalid for batch\.size > 1/,
    "runBatchedGeneralStep must reject reduction:'none' for a multi-sample batch (size=3)",
  )
})

test("G-010: runBatchedGeneralStep accepts a single-sample reduction:'none' batch", () => {
  // Regression-safety: reduction:'none' is well-defined and lossless when
  // size === 1, so it MUST still be accepted (kept in the schema enum for echo).
  const okBatch: BatchedGeneralInput = {
    topology: XOR_INPUT.topology,
    learning_rate: XOR_INPUT.learning_rate,
    parameters_before: { ...XOR_INPUT.parameters_before },
    numeric_policy: XOR_INPUT.numeric_policy,
    bias_policy: XOR_INPUT.bias_policy,
    batch: {
      size: 1,
      sample_order: ["s0"],
      reduction: "none",
    },
    per_sample: {
      s0: { inputs: { x1: 1, x2: 0 }, targets: { y: 1 } },
    },
  }
  assert.doesNotThrow(
    () => runBatchedGeneralStep(okBatch),
    "single-sample reduction:'none' is lossless and must still be accepted",
  )
})

// ===========================================================================
// G-021 — receipt.step must equal step_index + 1 (not hardcoded 1)
//
// The GeneralReceipt docstring (and the receipt.v0.4.0 schema convention) say
// multi-step records set step = step_index + 1 (step_index is 0-indexed).
// runGeneralStep / runBatchedGeneralStep historically hardcoded `step: 1`,
// which is correct ONLY for the step_index-0 (or step_index-absent) case. A
// step_index=1 record emitting step=1 mislabels the record's position in the
// multi-step bundle — a metadata defect on every record after the first.
//
// Single-step receipts (step_index absent → 0 + 1 = 1) and the step_index=0
// case (0 + 1 = 1) stay byte-unchanged; only step_index >= 1 changes.
//
// Non-vacuity / mutation that turns these RED again: revert the fix to a
// literal `step: 1`. The step_index=1 case then emits step=1 and the
// assertion `step === 2` fails.
// ===========================================================================

test("G-021: runGeneralStep with step_index=1 emits step=2", () => {
  const r = runGeneralStep({ ...XOR_INPUT, trace_id: "a".repeat(32), step_index: 1 })
  assert.strictEqual(
    r.step,
    2,
    "a step_index=1 record must emit step = step_index + 1 = 2 (GeneralReceipt docstring + receipt.v0.4.0 convention)",
  )
  // step_index is echoed unchanged (0-indexed); step is 1-indexed.
  assert.strictEqual(r.step_index, 1, "step_index is echoed verbatim (0-indexed)")
})

test("G-021: runGeneralStep with step_index=0 emits step=1 (unchanged)", () => {
  const r = runGeneralStep({ ...XOR_INPUT, trace_id: "a".repeat(32), step_index: 0 })
  assert.strictEqual(
    r.step,
    1,
    "step_index=0 must emit step=1 (0 + 1) — byte-unchanged from the v0.1 single-step convention",
  )
})

test("G-021: runGeneralStep with step_index absent emits step=1 (single-step unchanged)", () => {
  const r = runGeneralStep(XOR_INPUT)
  assert.strictEqual(
    r.step,
    1,
    "an engine-authored single-step receipt (step_index absent) must still emit step=1 ((step_index ?? 0) + 1)",
  )
})

test("G-021: runBatchedGeneralStep with step_index=3 emits step=4", () => {
  const r = runBatchedGeneralStep({
    topology: XOR_INPUT.topology,
    learning_rate: XOR_INPUT.learning_rate,
    parameters_before: { ...XOR_INPUT.parameters_before },
    numeric_policy: XOR_INPUT.numeric_policy,
    bias_policy: XOR_INPUT.bias_policy,
    trace_id: "b".repeat(32),
    step_index: 3,
    batch: {
      size: 2,
      sample_order: ["s0", "s1"],
      reduction: "mean",
    },
    per_sample: {
      s0: { inputs: { x1: 1, x2: 0 }, targets: { y: 1 } },
      s1: { inputs: { x1: 0, x2: 1 }, targets: { y: 1 } },
    },
  })
  assert.strictEqual(
    r.step,
    4,
    "a batched step_index=3 record must emit step = step_index + 1 = 4",
  )
})

// ===========================================================================
// G-039 — runBatchedGeneralStep must reject batch.size < 1
//
// With size:0 the per-sample-runs map is empty, firstReceipt =
// perSampleReceipts[0]! derefs undefined → cryptic "Cannot read properties of
// undefined (reading 'updates')". A clear path-naming boundary error is owed
// at the top of the function instead.
//
// Non-vacuity / mutation that turns this RED again: delete the
// `if (input.batch.size < 1) throw ...` guard. Without it, size:0 throws the
// cryptic undefined-deref TypeError (not the clear message), so the
// message-matching assert.throws fails.
// ===========================================================================

test("G-039: runBatchedGeneralStep throws a clear error on batch.size = 0", () => {
  const badBatch: BatchedGeneralInput = {
    topology: XOR_INPUT.topology,
    learning_rate: XOR_INPUT.learning_rate,
    parameters_before: { ...XOR_INPUT.parameters_before },
    numeric_policy: XOR_INPUT.numeric_policy,
    bias_policy: XOR_INPUT.bias_policy,
    batch: {
      size: 0,
      sample_order: [],
      reduction: "mean",
    },
    per_sample: {},
  }
  assert.throws(
    () => runBatchedGeneralStep(badBatch),
    /batch\.size must be >= 1/,
    "runBatchedGeneralStep must reject batch.size = 0 with a clear path-naming error (not a cryptic undefined deref)",
  )
})
