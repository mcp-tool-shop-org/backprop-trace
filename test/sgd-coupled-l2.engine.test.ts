/**
 * v0.13 — SGD coupled-L2 weight decay (the documented Rule 7 "third branch").
 *
 * Engine + reconciler internal-consistency tests for PyTorch torch.optim.SGD
 * coupled L2 (`weight_decay=lambda`). Coupled L2 folds the decay into the
 * GRADIENT before the momentum buffer / update:
 *
 *   PyTorch (ascent):  d_p = grad_ascent + wd*param ; param -= lr*d_p
 *   engine  (descent): the receipt stores `gradient` (descent base loss
 *                      gradient = product(factors)); the EFFECTIVE descent
 *                      gradient folds in the decay term as
 *                          grad_eff = gradient - wd*param
 *                      (negation of PyTorch's ascent `+ wd*param`, because the
 *                      engine stores the loss gradient in descent direction).
 *
 *   Plain SGD:      update = lr * grad_eff ;       weight_after = weight_before + update
 *   sgd_momentum:   buffer_after = mu*buffer_before + (1-dampening)*grad_eff
 *                   effective    = grad_eff + mu*buffer_after  (nesterov) | buffer_after
 *                   update       = lr * effective ;  weight_after = weight_before + update
 *
 * KEY CONTRAST WITH AdamW: AdamW applies DECOUPLED weight decay
 * `weight_after = (1 - lr*wd)*weight_before + update` at the parameter step —
 * the decay never enters the gradient/buffer. Coupled L2 (this feature) is the
 * exact opposite: the decay enters the gradient/buffer and is rescaled by
 * momentum. Calling them the same is the error the AdamW docs warn against.
 *
 * weight_decay == 0 MUST collapse byte-identically to the no-decay path.
 */

import { test } from "node:test"
import assert from "node:assert/strict"
import {
  runGeneralStep,
  type GeneralInput,
  type MomentumState,
} from "../src/general-engine.js"
import { emitGeneralReceipt } from "../src/emit.js"
import { reconcileReceipt } from "../src/reconcile.js"

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

const PARAMETERS = {
  w_i1_h1: 0.15, w_i2_h1: 0.20, w_i1_h2: 0.25, w_i2_h2: 0.30,
  w_h1_o1: 0.40, w_h2_o1: 0.45, w_h1_o2: 0.50, w_h2_o2: 0.55,
  b_hidden: 0.35, b_output: 0.60,
}

const INPUTS = { i1: 0.05, i2: 0.10 }
const TARGETS = { o1: 0.01, o2: 0.99 }

const NUMERIC_POLICY = {
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

const BIAS_POLICY = {
  mode: "constant" as const,
  reason: "test",
  updated_in_step: false,
  reconciliation: "biases constant for coupled-L2 test",
}

const zeroMomentumState = (): Record<string, MomentumState> => {
  const s: Record<string, MomentumState> = {}
  for (const pid of Object.keys(PARAMETERS)) {
    if (pid.startsWith("b_")) continue
    s[pid] = { buffer: 0 }
  }
  return s
}

const LR = 0.5
const WD = 0.01

// --- Plain SGD + coupled L2 ------------------------------------------------

test("plain SGD + weight_decay: receipt is v0.8.0 with optimizer_config carrying weight_decay", () => {
  const input: GeneralInput = {
    topology: MAZUR_TOPOLOGY,
    learning_rate: LR,
    inputs: INPUTS,
    targets: TARGETS,
    parameters_before: PARAMETERS,
    numeric_policy: NUMERIC_POLICY,
    bias_policy: BIAS_POLICY,
    optimizer_config: { name: "sgd", learning_rate: LR, weight_decay: WD },
  }
  const r = runGeneralStep(input)
  assert.equal(r.schema_version, "0.8.0", "sgd+wd receipt uses v0.8.0 schema")
  assert.ok(r.optimizer_config, "sgd+wd receipt carries top-level optimizer_config")
  assert.equal(r.optimizer_config!.name, "sgd")
  assert.equal(r.optimizer_config!.weight_decay, WD)
})

test("plain SGD + weight_decay: coupled-L2 descent math (grad_eff = gradient - wd*param; update = lr*grad_eff)", () => {
  const input: GeneralInput = {
    topology: MAZUR_TOPOLOGY,
    learning_rate: LR,
    inputs: INPUTS,
    targets: TARGETS,
    parameters_before: PARAMETERS,
    numeric_policy: NUMERIC_POLICY,
    bias_policy: BIAS_POLICY,
    optimizer_config: { name: "sgd", learning_rate: LR, weight_decay: WD },
  }
  const r = runGeneralStep(input)
  for (const u of r.updates) {
    if (u.parameter_id.startsWith("b_")) continue
    // Rule 4: gradient is the BASE loss gradient = product(factors); decay NOT in factors.
    const factorProduct = u.optimizer.factors.reduce((acc, f) => acc * f.value, 1)
    assert.ok(
      Math.abs(u.gradient - factorProduct) < 1e-12,
      `Rule 4 intact on ${u.parameter_id}: gradient (${u.gradient}) == product(factors) (${factorProduct})`,
    )
    // Effective descent gradient folds in coupled L2.
    const gradEff = u.gradient - WD * u.weight_before
    const expectedUpdate = LR * gradEff
    assert.ok(
      Math.abs(u.update - expectedUpdate) < 1e-12,
      `update on ${u.parameter_id}: ${u.update} == lr*(gradient - wd*param) = ${expectedUpdate}`,
    )
    assert.ok(
      Math.abs(u.weight_after - (u.weight_before + u.update)) < 1e-12,
      `weight_after on ${u.parameter_id} == weight_before + update`,
    )
    // The decay PULLS the weight toward zero relative to the no-decay update:
    // for a positive weight, -wd*param is negative, so update is more negative.
    assert.ok(u.gradient !== gradEff, "decay term changes the effective gradient (wd>0)")
  }
})

test("plain SGD + weight_decay reconciles ok:true (Rules 1-26 internally consistent)", () => {
  const input: GeneralInput = {
    topology: MAZUR_TOPOLOGY,
    learning_rate: LR,
    inputs: INPUTS,
    targets: TARGETS,
    parameters_before: PARAMETERS,
    numeric_policy: NUMERIC_POLICY,
    bias_policy: BIAS_POLICY,
    optimizer_config: { name: "sgd", learning_rate: LR, weight_decay: WD },
  }
  const r = runGeneralStep(input)
  const parsed = JSON.parse(emitGeneralReceipt(r))
  const result = reconcileReceipt(parsed)
  assert.equal(
    result.ok,
    true,
    `sgd+wd receipt must reconcile cleanly; failures: ${JSON.stringify(result.ok ? [] : result.failures, null, 2)}`,
  )
})

// --- sgd_momentum + coupled L2 ---------------------------------------------

test("sgd_momentum + weight_decay: coupled-L2 enters the buffer (buffer_after = mu*buffer_before + (1-dampening)*grad_eff)", () => {
  const mu = 0.9
  const input: GeneralInput = {
    topology: MAZUR_TOPOLOGY,
    learning_rate: LR,
    inputs: INPUTS,
    targets: TARGETS,
    parameters_before: PARAMETERS,
    numeric_policy: NUMERIC_POLICY,
    bias_policy: BIAS_POLICY,
    optimizer_config: { name: "sgd_momentum", learning_rate: LR, momentum: mu, weight_decay: WD },
    optimizer_state_before: zeroMomentumState(),
  }
  const r = runGeneralStep(input)
  assert.equal(r.schema_version, "0.8.0", "sgd_momentum+wd receipt uses v0.8.0 schema")
  assert.equal(r.optimizer_config!.weight_decay, WD)
  for (const u of r.updates) {
    if (u.parameter_id.startsWith("b_")) continue
    const sb = u.optimizer.state_before as MomentumState
    const sa = u.optimizer.state_after as MomentumState
    const gradEff = u.gradient - WD * u.weight_before
    const expectedBuffer = mu * sb.buffer + gradEff // dampening 0
    assert.ok(
      Math.abs(sa.buffer - expectedBuffer) < 1e-12,
      `buffer_after on ${u.parameter_id}: ${sa.buffer} == mu*buffer_before + grad_eff = ${expectedBuffer} (coupled L2 in buffer)`,
    )
    const expectedUpdate = LR * sa.buffer // classical: effective = buffer_after
    assert.ok(
      Math.abs(u.update - expectedUpdate) < 1e-12,
      `update on ${u.parameter_id}: ${u.update} == lr*buffer_after = ${expectedUpdate}`,
    )
  }
})

test("sgd_momentum + weight_decay reconciles ok:true", () => {
  const input: GeneralInput = {
    topology: MAZUR_TOPOLOGY,
    learning_rate: LR,
    inputs: INPUTS,
    targets: TARGETS,
    parameters_before: PARAMETERS,
    numeric_policy: NUMERIC_POLICY,
    bias_policy: BIAS_POLICY,
    optimizer_config: { name: "sgd_momentum", learning_rate: LR, momentum: 0.9, weight_decay: WD },
    optimizer_state_before: zeroMomentumState(),
  }
  const r = runGeneralStep(input)
  const parsed = JSON.parse(emitGeneralReceipt(r))
  const result = reconcileReceipt(parsed)
  assert.equal(
    result.ok,
    true,
    `sgd_momentum+wd receipt must reconcile cleanly; failures: ${JSON.stringify(result.ok ? [] : result.failures, null, 2)}`,
  )
})

// --- weight_decay == 0 byte-identity collapse ------------------------------

test("weight_decay == 0 collapses BYTE-IDENTICALLY to the no-decay sgd path", () => {
  const noDecay = runGeneralStep({
    topology: MAZUR_TOPOLOGY,
    learning_rate: LR,
    inputs: INPUTS,
    targets: TARGETS,
    parameters_before: PARAMETERS,
    numeric_policy: NUMERIC_POLICY,
    bias_policy: BIAS_POLICY,
    // no optimizer_config — implicit SGD path
  })
  const wdZero = runGeneralStep({
    topology: MAZUR_TOPOLOGY,
    learning_rate: LR,
    inputs: INPUTS,
    targets: TARGETS,
    parameters_before: PARAMETERS,
    numeric_policy: NUMERIC_POLICY,
    bias_policy: BIAS_POLICY,
    optimizer_config: { name: "sgd", learning_rate: LR, weight_decay: 0 },
  })
  // weight_decay === 0 must NOT change the math: byte-identical receipt bytes
  // (an explicit weight_decay:0 emits no optimizer_config block, exactly like
  // the implicit-SGD path, so the bytes match the shipped no-decay goldens).
  assert.equal(
    emitGeneralReceipt(wdZero),
    emitGeneralReceipt(noDecay),
    "weight_decay:0 sgd receipt is byte-identical to the implicit no-decay sgd receipt",
  )
})

test("weight_decay == 0 collapses BYTE-IDENTICALLY to the no-decay sgd_momentum path", () => {
  const noDecay = runGeneralStep({
    topology: MAZUR_TOPOLOGY,
    learning_rate: LR,
    inputs: INPUTS,
    targets: TARGETS,
    parameters_before: PARAMETERS,
    numeric_policy: NUMERIC_POLICY,
    bias_policy: BIAS_POLICY,
    optimizer_config: { name: "sgd_momentum", learning_rate: LR, momentum: 0.9 },
    optimizer_state_before: zeroMomentumState(),
  })
  const wdZero = runGeneralStep({
    topology: MAZUR_TOPOLOGY,
    learning_rate: LR,
    inputs: INPUTS,
    targets: TARGETS,
    parameters_before: PARAMETERS,
    numeric_policy: NUMERIC_POLICY,
    bias_policy: BIAS_POLICY,
    optimizer_config: { name: "sgd_momentum", learning_rate: LR, momentum: 0.9, weight_decay: 0 },
    optimizer_state_before: zeroMomentumState(),
  })
  assert.equal(
    emitGeneralReceipt(wdZero),
    emitGeneralReceipt(noDecay),
    "weight_decay:0 sgd_momentum receipt is byte-identical to the no-decay sgd_momentum receipt (stays v0.6.0)",
  )
  assert.equal(noDecay.schema_version, "0.6.0", "no-decay sgd_momentum stays v0.6.0")
  assert.equal(wdZero.schema_version, "0.6.0", "weight_decay:0 sgd_momentum stays v0.6.0 (byte-equal)")
})

// --- weight_decay validation -----------------------------------------------

test("negative weight_decay is rejected at the engine boundary", () => {
  assert.throws(
    () =>
      runGeneralStep({
        topology: MAZUR_TOPOLOGY,
        learning_rate: LR,
        inputs: INPUTS,
        targets: TARGETS,
        parameters_before: PARAMETERS,
        numeric_policy: NUMERIC_POLICY,
        bias_policy: BIAS_POLICY,
        optimizer_config: { name: "sgd", learning_rate: LR, weight_decay: -0.01 },
      }),
    /weight_decay/,
    "negative weight_decay must throw",
  )
})
