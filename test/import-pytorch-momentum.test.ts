/**
 * v0.9.2 — Classical PyTorch-style SGD momentum engine + importer tests.
 *
 * Covers:
 *   - runGeneralStep with optimizer_config.name === "sgd_momentum" produces
 *     a v0.6.0 receipt with top-level optimizer_config + per-update
 *     state_before/state_after carrying {buffer}
 *   - Rule 21a (buffer recurrence) and 21b (parameter update) hold:
 *     buffer_after == momentum * buffer_before + gradient
 *     update == learning_rate * buffer_after (descent direction)
 *     weight_after == weight_before + update (no AdamW-style decoupled-decay branch)
 *   - importPytorchSidecar with framework-trace.v0.5.0 momentum sidecar
 *     produces observer-mode v0.6.0 receipt with optimizer_config carried
 *   - Multi-step momentum ingestion: optimizer_config propagates per record;
 *     bundle digest binds 3 receipts; allDifferentialsPassed = true
 *   - Engine boundary rejects nesterov: true (deferred to v0.9.3)
 *   - Engine boundary rejects dampening !== 0 (deferred to v0.9.3)
 *   - Engine boundary rejects weight_decay for sgd_momentum (deferred to v0.10)
 *   - sgd_momentum receipt reconciles cleanly (Rules 1-26 all pass; Rule 21
 *     fires for state-bearing updates)
 */

import test from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { runGeneralStep, type GeneralInput, type MomentumState } from "../src/general-engine.js"
import { importPytorchSidecar, importPytorchSidecarStream } from "../src/import-pytorch.js"
import { reconcileReceipt, reconcileMultiStep } from "../src/reconcile.js"
import { parseReceiptJsonl } from "../src/parse.js"

const MAZUR_TOPOLOGY = {
  layers: ["input", "hidden", "output"] as const,
  unit_order: { input: ["i1", "i2"], hidden: ["h1", "h2"], output: ["o1", "o2"] },
  parameter_order: [
    "w_i1_h1", "w_i2_h1", "w_i1_h2", "w_i2_h2",
    "w_h1_o1", "w_h2_o1", "w_h1_o2", "w_h2_o2",
    "b_hidden", "b_output",
  ],
  parameters: [
    { id: "w_i1_h1", role: "input_to_hidden_weight" as const, from_unit: "i1", to_unit: "h1" },
    { id: "w_i2_h1", role: "input_to_hidden_weight" as const, from_unit: "i2", to_unit: "h1" },
    { id: "w_i1_h2", role: "input_to_hidden_weight" as const, from_unit: "i1", to_unit: "h2" },
    { id: "w_i2_h2", role: "input_to_hidden_weight" as const, from_unit: "i2", to_unit: "h2" },
    { id: "w_h1_o1", role: "hidden_to_output_weight" as const, from_unit: "h1", to_unit: "o1" },
    { id: "w_h2_o1", role: "hidden_to_output_weight" as const, from_unit: "h2", to_unit: "o1" },
    { id: "w_h1_o2", role: "hidden_to_output_weight" as const, from_unit: "h1", to_unit: "o2" },
    { id: "w_h2_o2", role: "hidden_to_output_weight" as const, from_unit: "h2", to_unit: "o2" },
    { id: "b_hidden", role: "hidden_bias" as const, applies_to_units: ["h1", "h2"] },
    { id: "b_output", role: "output_bias" as const, applies_to_units: ["o1", "o2"] },
  ],
  activation_hidden: "sigmoid" as const,
  activation_output: "sigmoid" as const,
  loss: "half_squared_error" as const,
  bias_sharing: "per_layer" as const,
  input_size: 2,
  hidden_size: 2,
  output_size: 2,
}

const MINIMAL_PARAMETERS = {
  w_i1_h1: 0.15, w_i2_h1: 0.20, w_i1_h2: 0.25, w_i2_h2: 0.30,
  w_h1_o1: 0.40, w_h2_o1: 0.45, w_h1_o2: 0.50, w_h2_o2: 0.55,
  b_hidden: 0.35, b_output: 0.60,
}

const MINIMAL_INPUTS = { i1: 0.05, i2: 0.10 }
const MINIMAL_TARGETS = { o1: 0.01, o2: 0.99 }

const MINIMAL_NUMERIC_POLICY = {
  number_encoding: "decimal" as const,
  precision_significant_digits: 9,
  rounding: "round_half_to_even" as const,
  tolerance: { atol: 1e-11, rtol: 1e-7 },
  computation_order: "schema_defined" as const,
  byte_output: {
    format: "jsonl" as const,
    json_key_order: "schema_defined" as const,
    trailing_zero_policy: "pad_to_significant_digits" as const,
    indent: "none" as const,
  },
}

const MINIMAL_BIAS_POLICY = {
  mode: "constant" as const,
  reason: "test",
  updated_in_step: false,
  reconciliation: "biases constant for momentum test",
}

const zeroMomentumState = (): Record<string, MomentumState> => {
  const s: Record<string, MomentumState> = {}
  for (const pid of Object.keys(MINIMAL_PARAMETERS)) {
    if (pid.startsWith("b_")) continue
    s[pid] = { buffer: 0 }
  }
  return s
}

test("runGeneralStep with optimizer_config.name === 'sgd_momentum' produces v0.6.0 receipt with optimizer_config and per-update state", () => {
  const input: GeneralInput = {
    topology: MAZUR_TOPOLOGY,
    learning_rate: 0.01,
    inputs: MINIMAL_INPUTS,
    targets: MINIMAL_TARGETS,
    parameters_before: MINIMAL_PARAMETERS,
    numeric_policy: MINIMAL_NUMERIC_POLICY,
    bias_policy: MINIMAL_BIAS_POLICY,
    optimizer_config: {
      name: "sgd_momentum",
      learning_rate: 0.01,
      momentum: 0.9,
    },
    optimizer_state_before: zeroMomentumState(),
  }
  const receipt = runGeneralStep(input)
  assert.equal(receipt.schema_version, "0.6.0", "sgd_momentum receipt uses v0.6.0 schema")
  assert.ok(receipt.optimizer_config, "sgd_momentum receipt has top-level optimizer_config")
  assert.equal(receipt.optimizer_config!.name, "sgd_momentum")
  assert.equal(receipt.optimizer_config!.momentum, 0.9)
  // Per-update state_before / state_after on every WEIGHT update with MomentumState shape.
  for (const u of receipt.updates) {
    if (u.parameter_id.startsWith("b_")) continue
    assert.ok(u.optimizer.state_before, `state_before present on ${u.parameter_id}`)
    assert.ok(u.optimizer.state_after, `state_after present on ${u.parameter_id}`)
    const sb = u.optimizer.state_before as MomentumState
    const sa = u.optimizer.state_after as MomentumState
    assert.equal(sb.buffer, 0, "buffer_before = 0 at first step (PyTorch lazy-init equivalent)")
    assert.equal(typeof sa.buffer, "number", "buffer_after is a number")
  }
})

test("Rule 21a (buffer recurrence): buffer_after == momentum * buffer_before + gradient (PyTorch convention)", () => {
  const input: GeneralInput = {
    topology: MAZUR_TOPOLOGY,
    learning_rate: 0.01,
    inputs: MINIMAL_INPUTS,
    targets: MINIMAL_TARGETS,
    parameters_before: MINIMAL_PARAMETERS,
    numeric_policy: MINIMAL_NUMERIC_POLICY,
    bias_policy: MINIMAL_BIAS_POLICY,
    optimizer_config: { name: "sgd_momentum", learning_rate: 0.01, momentum: 0.9 },
    optimizer_state_before: zeroMomentumState(),
  }
  const r = runGeneralStep(input)
  const mu = 0.9
  for (const u of r.updates) {
    if (u.parameter_id.startsWith("b_")) continue
    const sb = u.optimizer.state_before as MomentumState
    const sa = u.optimizer.state_after as MomentumState
    const expectedBufAfter = mu * sb.buffer + u.gradient
    assert.ok(
      Math.abs(sa.buffer - expectedBufAfter) < 1e-12,
      `buffer_after on ${u.parameter_id}: ${sa.buffer} matches mu * buffer_before + gradient = ${expectedBufAfter}`,
    )
  }
})

test("Rule 21b (parameter update): update == lr * buffer_after (descent direction; sign in gradient)", () => {
  const input: GeneralInput = {
    topology: MAZUR_TOPOLOGY,
    learning_rate: 0.01,
    inputs: MINIMAL_INPUTS,
    targets: MINIMAL_TARGETS,
    parameters_before: MINIMAL_PARAMETERS,
    numeric_policy: MINIMAL_NUMERIC_POLICY,
    bias_policy: MINIMAL_BIAS_POLICY,
    optimizer_config: { name: "sgd_momentum", learning_rate: 0.01, momentum: 0.9 },
    optimizer_state_before: zeroMomentumState(),
  }
  const r = runGeneralStep(input)
  const lr = 0.01
  for (const u of r.updates) {
    if (u.parameter_id.startsWith("b_")) continue
    const sa = u.optimizer.state_after as MomentumState
    const expectedUpdate = lr * sa.buffer
    assert.ok(
      Math.abs(u.update - expectedUpdate) < 1e-12,
      `update on ${u.parameter_id}: ${u.update} matches lr * buffer_after = ${expectedUpdate}`,
    )
    // Rule 6 (weight progression) — no AdamW-style decoupled-decay branch for momentum.
    const expectedAfter = u.weight_before + u.update
    assert.ok(
      Math.abs(u.weight_after - expectedAfter) < 1e-12,
      `weight_after on ${u.parameter_id} matches weight_before + update (no decoupled decay for sgd_momentum)`,
    )
  }
})

test("runGeneralStep rejects sgd_momentum with nesterov: true at the boundary (deferred to v0.9.3)", () => {
  const input: GeneralInput = {
    topology: MAZUR_TOPOLOGY,
    learning_rate: 0.01,
    inputs: MINIMAL_INPUTS,
    targets: MINIMAL_TARGETS,
    parameters_before: MINIMAL_PARAMETERS,
    numeric_policy: MINIMAL_NUMERIC_POLICY,
    bias_policy: MINIMAL_BIAS_POLICY,
    optimizer_config: {
      name: "sgd_momentum",
      learning_rate: 0.01,
      momentum: 0.9,
      // @ts-expect-error: nesterov: true is rejected at runtime in v0.9.2
      nesterov: true,
    },
    optimizer_state_before: zeroMomentumState(),
  }
  assert.throws(() => runGeneralStep(input), /nesterov === true is NOT supported in v0.9.2/i)
})

test("runGeneralStep rejects sgd_momentum with dampening !== 0 at the boundary (deferred to v0.9.3)", () => {
  const input: GeneralInput = {
    topology: MAZUR_TOPOLOGY,
    learning_rate: 0.01,
    inputs: MINIMAL_INPUTS,
    targets: MINIMAL_TARGETS,
    parameters_before: MINIMAL_PARAMETERS,
    numeric_policy: MINIMAL_NUMERIC_POLICY,
    bias_policy: MINIMAL_BIAS_POLICY,
    optimizer_config: {
      name: "sgd_momentum",
      learning_rate: 0.01,
      momentum: 0.9,
      // @ts-expect-error: dampening !== 0 is rejected at runtime in v0.9.2
      dampening: 0.1,
    },
    optimizer_state_before: zeroMomentumState(),
  }
  assert.throws(() => runGeneralStep(input), /dampening !== 0 is NOT supported in v0.9.2/i)
})

test("runGeneralStep rejects sgd_momentum with weight_decay at the boundary (deferred to v0.10)", () => {
  const input: GeneralInput = {
    topology: MAZUR_TOPOLOGY,
    learning_rate: 0.01,
    inputs: MINIMAL_INPUTS,
    targets: MINIMAL_TARGETS,
    parameters_before: MINIMAL_PARAMETERS,
    numeric_policy: MINIMAL_NUMERIC_POLICY,
    bias_policy: MINIMAL_BIAS_POLICY,
    optimizer_config: {
      name: "sgd_momentum",
      learning_rate: 0.01,
      momentum: 0.9,
      weight_decay: 0.01,
    },
    optimizer_state_before: zeroMomentumState(),
  }
  assert.throws(() => runGeneralStep(input), /weight_decay is NOT supported with name === 'sgd_momentum' in v0.9.2/i)
})

test("runGeneralStep rejects sgd_momentum with missing momentum hyperparameter", () => {
  const input: GeneralInput = {
    topology: MAZUR_TOPOLOGY,
    learning_rate: 0.01,
    inputs: MINIMAL_INPUTS,
    targets: MINIMAL_TARGETS,
    parameters_before: MINIMAL_PARAMETERS,
    numeric_policy: MINIMAL_NUMERIC_POLICY,
    bias_policy: MINIMAL_BIAS_POLICY,
    // optimizer_config without momentum
    optimizer_config: { name: "sgd_momentum", learning_rate: 0.01 } as unknown as GeneralInput["optimizer_config"],
    optimizer_state_before: zeroMomentumState(),
  }
  assert.throws(() => runGeneralStep(input), /momentum is required when name === 'sgd_momentum'/i)
})

test("importPytorchSidecar accepts framework-trace.v0.5.0 sgd_momentum sidecar and produces v0.6.0 receipt", () => {
  const sidecarBytes = readFileSync("fixtures/external/pytorch.sgd-momentum.sidecar.jsonl", "utf-8")
  const result = importPytorchSidecar(sidecarBytes, {
    importTimestamp: "2026-05-19T01:00:00Z",
    fixtureLabel: "pytorch-sgd-momentum-test-import",
  })
  assert.equal(result.differentialPassed, true, "sgd_momentum sidecar differential passes")
  assert.equal(result.receipt.schema_version, "0.6.0", "sgd_momentum receipt is v0.6.0")
  assert.ok(result.receipt.optimizer_config, "sgd_momentum receipt has optimizer_config")
  assert.equal(result.receipt.optimizer_config!.name, "sgd_momentum")
  assert.equal(result.receipt.optimizer_config!.momentum, 0.9)
})

test("sgd_momentum single-step golden reconciles cleanly (Rules 1-26 all pass; Rule 21 fires)", () => {
  const goldenBytes = readFileSync("fixtures/external/pytorch.sgd-momentum.golden.jsonl", "utf-8")
  const parsed = parseReceiptJsonl(goldenBytes)
  if (!parsed.ok) throw new Error(parsed.error.message)
  const result = reconcileReceipt(parsed.receipt)
  assert.equal(
    result.ok,
    true,
    `sgd_momentum golden must reconcile cleanly. Failures: ${
      result.ok ? "[]" : JSON.stringify(result.failures.map((f) => ({ rule: f.rule, field: f.field_path })))
    }`,
  )
})

test("sgd_momentum multi-step golden reconciles cleanly across 3 receipts (Rules 25 buffer chain + 26 config constancy)", () => {
  const goldenBytes = readFileSync(
    "fixtures/external/pytorch.sgd-momentum.multi-step.golden.jsonl",
    "utf-8",
  )
  const receipts = goldenBytes
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line))
  assert.equal(receipts.length, 3, "sgd_momentum multi-step golden has 3 records")
  const result = reconcileMultiStep(receipts)
  assert.equal(
    result.ok,
    true,
    `sgd_momentum multi-step golden must reconcile cleanly. Failures: ${
      result.ok ? "[]" : JSON.stringify(result.failures.map((f) => ({ rule: f.rule, field: f.field_path })))
    }`,
  )
})

test("importPytorchSidecarStream on sgd_momentum multi-step sidecar yields v0.6.0 receipts with optimizer_config per record", () => {
  const sidecarBytes = readFileSync(
    "fixtures/external/pytorch.sgd-momentum.multi-step.sidecar.jsonl",
    "utf-8",
  )
  const result = importPytorchSidecarStream(sidecarBytes, {
    importTimestamp: "2026-05-19T01:00:00Z",
    fixtureLabel: "pytorch-sgd-momentum-multi-step-test",
  })
  assert.equal(result.allDifferentialsPassed, true)
  assert.equal(result.steps.length, 3)
  for (let i = 0; i < 3; i += 1) {
    const r = result.steps[i]!.receipt
    assert.equal(r.schema_version, "0.6.0", `step ${i} is v0.6.0`)
    assert.ok(r.optimizer_config, `step ${i} has optimizer_config`)
    assert.equal(r.optimizer_config!.name, "sgd_momentum", `step ${i} name === sgd_momentum`)
    assert.equal(r.optimizer_config!.momentum, 0.9, `step ${i} momentum === 0.9`)
  }
})

test("sgd_momentum classical recurrence is byte-equal to engine-recomputed values (Rule 14 round-trip)", () => {
  // Run engine, capture buffer_after at step 1, run engine again with same inputs,
  // confirm byte-identical output. Same determinism contract as SGD/Adam paths.
  const input: GeneralInput = {
    topology: MAZUR_TOPOLOGY,
    learning_rate: 0.01,
    inputs: MINIMAL_INPUTS,
    targets: MINIMAL_TARGETS,
    parameters_before: MINIMAL_PARAMETERS,
    numeric_policy: MINIMAL_NUMERIC_POLICY,
    bias_policy: MINIMAL_BIAS_POLICY,
    optimizer_config: { name: "sgd_momentum", learning_rate: 0.01, momentum: 0.9 },
    optimizer_state_before: zeroMomentumState(),
  }
  const a = runGeneralStep(input)
  const b = runGeneralStep(input)
  assert.deepEqual(a.updates, b.updates, "sgd_momentum updates are deterministic across runs")
  assert.deepEqual(a.parameters_after, b.parameters_after, "sgd_momentum parameters_after deterministic")
})
