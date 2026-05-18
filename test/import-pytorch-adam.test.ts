/**
 * v0.9.1 — Adam + AdamW engine and importer tests.
 *
 * Covers:
 *   - runGeneralStep with optimizer_config.name === "adam" produces a v0.5.0
 *     receipt with top-level optimizer_config + per-update state_before/state_after
 *   - Adam math matches Kingma & Ba 2014 Algorithm 1 (m, v recurrences,
 *     bias correction, parameter update with epsilon OUTSIDE sqrt)
 *   - AdamW adds (1 - lr*wd) factor at parameters_after (Loshchilov & Hutter
 *     2017 Algorithm 2 line 12); update field itself is identical to Adam
 *   - importPytorchSidecar with framework-trace.v0.4.0 Adam sidecar produces
 *     observer-mode v0.5.0 receipt with optimizer_config carried + state present
 *   - Multi-step Adam ingestion: optimizer_config propagates per record;
 *     bundle digest binds 3 receipts; differentialPassed = true
 *   - Validation errors fire at the engine boundary when Adam config is incomplete
 */

import test from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { runGeneralStep, type GeneralInput, type AdamState } from "../src/general-engine.js"
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
  reconciliation: "biases constant for Adam test",
}

const zeroState = (): Record<string, { m: number; v: number }> => {
  const s: Record<string, { m: number; v: number }> = {}
  for (const pid of Object.keys(MINIMAL_PARAMETERS)) {
    if (pid.startsWith("b_")) continue
    s[pid] = { m: 0, v: 0 }
  }
  return s
}

test("runGeneralStep with optimizer_config.name === 'adam' produces v0.5.0 receipt with optimizer_config and per-update state", () => {
  const input: GeneralInput = {
    topology: MAZUR_TOPOLOGY,
    learning_rate: 0.01,
    inputs: MINIMAL_INPUTS,
    targets: MINIMAL_TARGETS,
    parameters_before: MINIMAL_PARAMETERS,
    numeric_policy: MINIMAL_NUMERIC_POLICY,
    bias_policy: MINIMAL_BIAS_POLICY,
    optimizer_config: {
      name: "adam",
      learning_rate: 0.01,
      beta1: 0.9,
      beta2: 0.999,
      epsilon: 1e-8,
      t: 1,
    },
    optimizer_state_before: zeroState(),
  }
  const receipt = runGeneralStep(input)
  assert.equal(receipt.schema_version, "0.5.0", "Adam receipt uses v0.5.0 schema")
  assert.ok(receipt.optimizer_config, "Adam receipt has top-level optimizer_config")
  assert.equal(receipt.optimizer_config!.name, "adam")
  assert.equal(receipt.optimizer_config!.beta1, 0.9)
  assert.equal(receipt.optimizer_config!.beta2, 0.999)
  assert.equal(receipt.optimizer_config!.epsilon, 1e-8)
  assert.equal(receipt.optimizer_config!.t, 1)
  // Per-update state_before / state_after on every WEIGHT update.
  // v0.9.2: state is OptimizerStateAny (union of AdamState | MomentumState);
  // narrow to AdamState here since optimizer.name === "adam".
  for (const u of receipt.updates) {
    if (u.parameter_id.startsWith("b_")) continue
    assert.ok(u.optimizer.state_before, `state_before present on ${u.parameter_id}`)
    assert.ok(u.optimizer.state_after, `state_after present on ${u.parameter_id}`)
    const sb = u.optimizer.state_before as AdamState
    const sa = u.optimizer.state_after as AdamState
    assert.equal(sb.m, 0, "m_before = 0 at t=1")
    assert.equal(sb.v, 0, "v_before = 0 at t=1")
    // v_after should be non-negative (squared gradient)
    assert.ok(sa.v >= 0, "v_after non-negative")
  }
})

test("Adam moment recurrence: m_after == beta1 * m_before + (1 - beta1) * gradient (Kingma & Ba 2014 Alg 1 line 9)", () => {
  const input: GeneralInput = {
    topology: MAZUR_TOPOLOGY,
    learning_rate: 0.01,
    inputs: MINIMAL_INPUTS,
    targets: MINIMAL_TARGETS,
    parameters_before: MINIMAL_PARAMETERS,
    numeric_policy: MINIMAL_NUMERIC_POLICY,
    bias_policy: MINIMAL_BIAS_POLICY,
    optimizer_config: { name: "adam", learning_rate: 0.01, beta1: 0.9, beta2: 0.999, epsilon: 1e-8, t: 1 },
    optimizer_state_before: zeroState(),
  }
  const r = runGeneralStep(input)
  for (const u of r.updates) {
    if (u.parameter_id.startsWith("b_")) continue
    const beta1 = 0.9
    const sb = u.optimizer.state_before as AdamState
    const sa = u.optimizer.state_after as AdamState
    const expectedM = beta1 * sb.m + (1 - beta1) * u.gradient
    assert.ok(
      Math.abs(sa.m - expectedM) < 1e-12,
      `m_after on ${u.parameter_id}: ${sa.m} matches expected ${expectedM}`,
    )
  }
})

test("Adam parameter update: update == lr * m_hat / (sqrt(v_hat) + epsilon), epsilon OUTSIDE sqrt", () => {
  const input: GeneralInput = {
    topology: MAZUR_TOPOLOGY,
    learning_rate: 0.01,
    inputs: MINIMAL_INPUTS,
    targets: MINIMAL_TARGETS,
    parameters_before: MINIMAL_PARAMETERS,
    numeric_policy: MINIMAL_NUMERIC_POLICY,
    bias_policy: MINIMAL_BIAS_POLICY,
    optimizer_config: { name: "adam", learning_rate: 0.01, beta1: 0.9, beta2: 0.999, epsilon: 1e-8, t: 1 },
    optimizer_state_before: zeroState(),
  }
  const r = runGeneralStep(input)
  for (const u of r.updates) {
    if (u.parameter_id.startsWith("b_")) continue
    const beta1 = 0.9, beta2 = 0.999, epsilon = 1e-8, t = 1, lr = 0.01
    const sa = u.optimizer.state_after as AdamState
    const mHat = sa.m / (1 - Math.pow(beta1, t))
    const vHat = sa.v / (1 - Math.pow(beta2, t))
    const expectedUpdate = (lr * mHat) / (Math.sqrt(vHat) + epsilon)
    assert.ok(
      Math.abs(u.update - expectedUpdate) < 1e-12,
      `update on ${u.parameter_id}: ${u.update} matches expected ${expectedUpdate}`,
    )
  }
})

test("AdamW parameters_after has decoupled weight decay factor (1 - lr*wd), update field unchanged from Adam", () => {
  const wd = 0.01
  const input: GeneralInput = {
    topology: MAZUR_TOPOLOGY,
    learning_rate: 0.01,
    inputs: MINIMAL_INPUTS,
    targets: MINIMAL_TARGETS,
    parameters_before: MINIMAL_PARAMETERS,
    numeric_policy: MINIMAL_NUMERIC_POLICY,
    bias_policy: MINIMAL_BIAS_POLICY,
    optimizer_config: {
      name: "adamw",
      learning_rate: 0.01,
      beta1: 0.9, beta2: 0.999, epsilon: 1e-8,
      weight_decay: wd, t: 1,
    },
    optimizer_state_before: zeroState(),
  }
  const r = runGeneralStep(input)
  for (const u of r.updates) {
    if (u.parameter_id.startsWith("b_")) continue
    // AdamW's parameters_after = (1 - lr*wd) * weight_before + update
    // (Loshchilov & Hutter 2017 Alg 2 line 12)
    const expectedAfter = (1 - 0.01 * wd) * u.weight_before + u.update
    assert.ok(
      Math.abs(u.weight_after - expectedAfter) < 1e-12,
      `AdamW weight_after on ${u.parameter_id}: ${u.weight_after} matches (1 - lr*wd) * w + update = ${expectedAfter}`,
    )
    // parameters_after consistent
    assert.equal(r.parameters_after[u.parameter_id], u.weight_after)
  }
})

test("runGeneralStep rejects Adam with missing beta1 at the boundary", () => {
  const input: GeneralInput = {
    topology: MAZUR_TOPOLOGY,
    learning_rate: 0.01,
    inputs: MINIMAL_INPUTS,
    targets: MINIMAL_TARGETS,
    parameters_before: MINIMAL_PARAMETERS,
    numeric_policy: MINIMAL_NUMERIC_POLICY,
    bias_policy: MINIMAL_BIAS_POLICY,
    // optimizer_config without beta1
    optimizer_config: { name: "adam", learning_rate: 0.01, beta2: 0.999, epsilon: 1e-8, t: 1 } as unknown as GeneralInput["optimizer_config"],
    optimizer_state_before: zeroState(),
  }
  assert.throws(() => runGeneralStep(input), /beta1 is required/i)
})

test("runGeneralStep rejects AdamW with missing weight_decay at the boundary", () => {
  const input: GeneralInput = {
    topology: MAZUR_TOPOLOGY,
    learning_rate: 0.01,
    inputs: MINIMAL_INPUTS,
    targets: MINIMAL_TARGETS,
    parameters_before: MINIMAL_PARAMETERS,
    numeric_policy: MINIMAL_NUMERIC_POLICY,
    bias_policy: MINIMAL_BIAS_POLICY,
    optimizer_config: {
      name: "adamw",
      learning_rate: 0.01,
      beta1: 0.9, beta2: 0.999, epsilon: 1e-8, t: 1,
      // weight_decay missing
    },
    optimizer_state_before: zeroState(),
  }
  assert.throws(() => runGeneralStep(input), /weight_decay is required/i)
})

test("importPytorchSidecar accepts framework-trace.v0.4.0 Adam sidecar and produces v0.5.0 receipt", () => {
  const sidecarBytes = readFileSync("fixtures/external/pytorch.adam.sidecar.jsonl", "utf-8")
  const result = importPytorchSidecar(sidecarBytes, {
    importTimestamp: "2026-05-18T03:00:00Z",
    fixtureLabel: "pytorch-adam-test-import",
  })
  assert.equal(result.differentialPassed, true, "Adam sidecar differential passes")
  assert.equal(result.receipt.schema_version, "0.5.0", "Adam receipt is v0.5.0")
  assert.ok(result.receipt.optimizer_config, "Adam receipt has optimizer_config")
  assert.equal(result.receipt.optimizer_config!.name, "adam")
})

test("Adam single-step golden reconciles cleanly (Rules 1-26 minus 21 all pass)", () => {
  const goldenBytes = readFileSync("fixtures/external/pytorch.adam.golden.jsonl", "utf-8")
  const parsed = parseReceiptJsonl(goldenBytes)
  if (!parsed.ok) throw new Error(parsed.error.message)
  const result = reconcileReceipt(parsed.receipt)
  assert.equal(
    result.ok,
    true,
    `Adam golden must reconcile cleanly. Failures: ${
      result.ok ? "[]" : JSON.stringify(result.failures.map((f) => ({ rule: f.rule, field: f.field_path })))
    }`,
  )
})

test("AdamW single-step golden reconciles cleanly", () => {
  const goldenBytes = readFileSync("fixtures/external/pytorch.adamw.golden.jsonl", "utf-8")
  const parsed = parseReceiptJsonl(goldenBytes)
  if (!parsed.ok) throw new Error(parsed.error.message)
  const result = reconcileReceipt(parsed.receipt)
  assert.equal(
    result.ok,
    true,
    `AdamW golden must reconcile cleanly. Failures: ${
      result.ok ? "[]" : JSON.stringify(result.failures.map((f) => ({ rule: f.rule, field: f.field_path })))
    }`,
  )
})

test("Adam multi-step golden reconciles cleanly across all 3 receipts (Rules 25 + 26 fire on chain)", () => {
  const goldenBytes = readFileSync("fixtures/external/pytorch.adam.multi-step.golden.jsonl", "utf-8")
  // Multi-record JSONL: split + JSON.parse per existing v0.8/v0.9 test pattern.
  const receipts = goldenBytes
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line))
  assert.equal(receipts.length, 3, "Adam multi-step golden has 3 records")
  const result = reconcileMultiStep(receipts)
  assert.equal(
    result.ok,
    true,
    `Adam multi-step golden must reconcile cleanly across all 3 receipts. Failures: ${
      result.ok ? "[]" : JSON.stringify(result.failures.map((f) => ({ rule: f.rule, field: f.field_path })))
    }`,
  )
})

test("importPytorchSidecarStream on Adam multi-step sidecar yields v0.5.0 receipts with optimizer_config per record", () => {
  const sidecarBytes = readFileSync(
    "fixtures/external/pytorch.adam.multi-step.sidecar.jsonl",
    "utf-8",
  )
  const result = importPytorchSidecarStream(sidecarBytes, {
    importTimestamp: "2026-05-18T03:00:00Z",
    fixtureLabel: "pytorch-adam-multi-step-test",
  })
  assert.equal(result.allDifferentialsPassed, true)
  assert.equal(result.steps.length, 3)
  for (let i = 0; i < 3; i += 1) {
    const r = result.steps[i]!.receipt
    assert.equal(r.schema_version, "0.5.0", `step ${i} is v0.5.0`)
    assert.ok(r.optimizer_config, `step ${i} has optimizer_config`)
    assert.equal(r.optimizer_config!.t, i + 1, `step ${i} t = ${i + 1}`)
  }
})

test("AdamW differs from Adam by exactly (1 - lr*wd) factor on parameters_after; same update value", () => {
  const baseInput: Omit<GeneralInput, "optimizer_config" | "optimizer_state_before"> = {
    topology: MAZUR_TOPOLOGY,
    learning_rate: 0.01,
    inputs: MINIMAL_INPUTS,
    targets: MINIMAL_TARGETS,
    parameters_before: MINIMAL_PARAMETERS,
    numeric_policy: MINIMAL_NUMERIC_POLICY,
    bias_policy: MINIMAL_BIAS_POLICY,
  }
  const adam = runGeneralStep({
    ...baseInput,
    optimizer_config: { name: "adam", learning_rate: 0.01, beta1: 0.9, beta2: 0.999, epsilon: 1e-8, t: 1 },
    optimizer_state_before: zeroState(),
  })
  const adamw = runGeneralStep({
    ...baseInput,
    optimizer_config: { name: "adamw", learning_rate: 0.01, beta1: 0.9, beta2: 0.999, epsilon: 1e-8, weight_decay: 0.01, t: 1 },
    optimizer_state_before: zeroState(),
  })
  for (const aU of adam.updates) {
    if (aU.parameter_id.startsWith("b_")) continue
    const wU = adamw.updates.find((x) => x.parameter_id === aU.parameter_id)!
    // The Adam `update` field is identical to AdamW's; the difference is in weight_after.
    assert.ok(
      Math.abs(aU.update - wU.update) < 1e-12,
      `update identical for ${aU.parameter_id}: adam=${aU.update}, adamw=${wU.update}`,
    )
    // weight_after differs by lr*wd*weight_before (Loshchilov & Hutter 2017 Alg 2 line 12)
    const decoupledDecay = 0.01 * 0.01 * aU.weight_before
    const expectedDiff = -decoupledDecay
    const observedDiff = wU.weight_after - aU.weight_after
    assert.ok(
      Math.abs(observedDiff - expectedDiff) < 1e-12,
      `AdamW vs Adam weight_after diff on ${aU.parameter_id}: ${observedDiff} matches -lr*wd*w_before = ${expectedDiff}`,
    )
  }
})
