/**
 * v0.7.0 — Generate the canonical TensorFlow softmax+CE fixture pair:
 *   - fixtures/external/tensorflow.softmax-ce.sidecar.jsonl
 *       (framework-trace.v0.1.0 sidecar — what a TF user would emit from
 *        their training loop via a Python helper that extracts per-tensor
 *        values from tf.GradientTape + model.trainable_variables)
 *   - fixtures/external/tensorflow.softmax-ce.golden.jsonl
 *       (observer-mode v0.4.0 receipt — what `bp import tensorflow` produces)
 *
 * Topology choice: same 2-2-3 softmax+CE as the PyTorch / JAX fixtures but
 * with different weights + inputs + targets + learning_rate so the TF
 * golden is byte-distinct from both. This is the v0.7.0 third-adapter
 * proof — same shape, same trust model, third framework + third topology
 * values. No new schema, no new rule, no new trust model.
 *
 * Sidecar's claimed math = engine's recomputed math (v0.7.0 doesn't yet
 * have real TensorFlow in CI; the canonical fixture demonstrates shape
 * correctness). A real-TF-authored sidecar would carry minor FP drift
 * within attestor.differential_tolerance.
 *
 * Reproducibility: reads no files. Re-runs produce byte-identical output.
 */

import { writeFileSync } from "node:fs"
import { runGeneralStep } from "../src/general-engine.js"
import { importTensorflowSidecar } from "../src/import-tensorflow.js"
import type { GeneralInput } from "../src/general-engine.js"
import type { Topology } from "../src/topology.js"

const PINNED_TIMESTAMP = "2026-05-17T08:00:00Z"
const PINNED_TF_VERSION = "2.16.1"

// TensorFlow 2-2-3 softmax+CE topology. Different weights + sample than
// the PyTorch / JAX fixtures so the TF golden is structurally distinct.
const TF_SOFTMAX_CE_TOPOLOGY: Topology = {
  layers: ["input", "hidden", "output"],
  unit_order: {
    input: ["x1", "x2"],
    hidden: ["h1", "h2"],
    output: ["o1", "o2", "o3"],
  },
  parameter_order: [
    "w_x1_h1", "w_x2_h1", "w_x1_h2", "w_x2_h2",
    "w_h1_o1", "w_h2_o1",
    "w_h1_o2", "w_h2_o2",
    "w_h1_o3", "w_h2_o3",
    "b_hidden", "b_output",
  ],
  parameters: [
    { id: "w_x1_h1", role: "input_to_hidden_weight", from_unit: "x1", to_unit: "h1" },
    { id: "w_x2_h1", role: "input_to_hidden_weight", from_unit: "x2", to_unit: "h1" },
    { id: "w_x1_h2", role: "input_to_hidden_weight", from_unit: "x1", to_unit: "h2" },
    { id: "w_x2_h2", role: "input_to_hidden_weight", from_unit: "x2", to_unit: "h2" },
    { id: "w_h1_o1", role: "hidden_to_output_weight", from_unit: "h1", to_unit: "o1" },
    { id: "w_h2_o1", role: "hidden_to_output_weight", from_unit: "h2", to_unit: "o1" },
    { id: "w_h1_o2", role: "hidden_to_output_weight", from_unit: "h1", to_unit: "o2" },
    { id: "w_h2_o2", role: "hidden_to_output_weight", from_unit: "h2", to_unit: "o2" },
    { id: "w_h1_o3", role: "hidden_to_output_weight", from_unit: "h1", to_unit: "o3" },
    { id: "w_h2_o3", role: "hidden_to_output_weight", from_unit: "h2", to_unit: "o3" },
    { id: "b_hidden", role: "hidden_bias", applies_to_units: ["h1", "h2"] },
    { id: "b_output", role: "output_bias", applies_to_units: ["o1", "o2", "o3"] },
  ],
  activation_hidden: "sigmoid",
  activation_output: "softmax",
  loss: "cross_entropy_softmax",
  bias_sharing: "per_layer",
  input_size: 2,
  hidden_size: 2,
  output_size: 3,
}

const TF_SOFTMAX_CE_INPUT: GeneralInput = {
  topology: TF_SOFTMAX_CE_TOPOLOGY,
  // Different learning rate than PyTorch (0.5) and JAX (0.25).
  learning_rate: 0.1,
  // Sample: (x1=0.75, x2=0.25), one-hot target class o3.
  // (PyTorch used class o1, JAX used class o2 — all three distinct.)
  inputs: { x1: 0.75, x2: 0.25 },
  targets: { o1: 0, o2: 0, o3: 1 },
  // Different weight values than PyTorch and JAX so the golden is byte-
  // distinct.
  parameters_before: {
    w_x1_h1: 0.12, w_x2_h1: 0.22, w_x1_h2: 0.32, w_x2_h2: 0.42,
    w_h1_o1: 0.18, w_h2_o1: 0.28,
    w_h1_o2: 0.38, w_h2_o2: 0.48,
    w_h1_o3: 0.08, w_h2_o3: 0.18,
    b_hidden: 0.04, b_output: 0.14,
  },
  numeric_policy: {
    number_encoding: "decimal",
    precision_significant_digits: 9,
    rounding: "round_half_to_even",
    tolerance: { atol: 1e-11, rtol: 1e-7 },
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
    reason:
      "v0.7.0 TensorFlow fixture pins biases as constant on step 1 — matches Mazur convention.",
    updated_in_step: false,
    reconciliation:
      "parameters_after[bias_id] === parameters_before[bias_id] for every bias parameter",
  },
  fixture: "tensorflow-softmax-ce-engine-recompute",
  metadata: {
    source:
      "src/import-tensorflow.ts (TensorFlow softmax+CE observer-mode engine recompute reference)",
    gradient_convention: "descent_direction",
  },
}

// ---- Step 1: produce the engine receipt as the foreign-claim baseline.
const engineReceipt = runGeneralStep(TF_SOFTMAX_CE_INPUT)

// ---- Step 2: build the sidecar. source_framework declares tensorflow +
// a pinned version. The sidecar's claimed math is byte-identical to engine
// output for the v0.7.0 demo (real TF would carry minor FP drift).
const sidecar = {
  format: "framework-trace.v0.1.0",
  source_framework: {
    name: "tensorflow",
    version: PINNED_TF_VERSION,
    information_uri: "https://www.tensorflow.org/",
    extractor: {
      name: "bp-import-tensorflow-helper",
      version: "0.7.0",
    },
  },
  topology: TF_SOFTMAX_CE_INPUT.topology,
  learning_rate: TF_SOFTMAX_CE_INPUT.learning_rate,
  numeric_policy: TF_SOFTMAX_CE_INPUT.numeric_policy,
  bias_policy: TF_SOFTMAX_CE_INPUT.bias_policy,
  inputs: TF_SOFTMAX_CE_INPUT.inputs,
  targets: TF_SOFTMAX_CE_INPUT.targets,
  parameters_before: TF_SOFTMAX_CE_INPUT.parameters_before,
  forward: engineReceipt.forward,
  loss: engineReceipt.loss,
  backward: engineReceipt.backward,
  updates: engineReceipt.updates,
  parameters_after: engineReceipt.parameters_after,
  post_update_forward: {
    status: engineReceipt.post_update_forward.status,
    ...engineReceipt.post_update_forward.units,
  },
  post_update_loss: engineReceipt.post_update_loss,
}

const sidecarBytes = JSON.stringify(sidecar) + "\n"
writeFileSync(
  "fixtures/external/tensorflow.softmax-ce.sidecar.jsonl",
  sidecarBytes,
)
console.log("wrote fixtures/external/tensorflow.softmax-ce.sidecar.jsonl")

// ---- Step 3: run the importer on the sidecar. PINNED_TIMESTAMP makes
// the produced receipt deterministic across re-runs.
const result = importTensorflowSidecar(sidecarBytes, {
  importTimestamp: PINNED_TIMESTAMP,
  fixtureLabel: "tensorflow-softmax-ce-imported",
})

writeFileSync(
  "fixtures/external/tensorflow.softmax-ce.golden.jsonl",
  result.emittedBytes,
)
console.log("wrote fixtures/external/tensorflow.softmax-ce.golden.jsonl")
console.log(`  differentialPassed: ${result.differentialPassed}`)
console.log(`  schema_version: ${result.receipt.schema_version}`)
console.log(
  `  fixture_status: ${result.receipt.fixture_status.authoring_state} / ${result.receipt.fixture_status.verification_state}`,
)
console.log(
  `  source_framework.name: ${result.receipt.source_framework?.name}`,
)
console.log(
  `  source_hash: ${result.receipt.attestor?.import_provenance?.source_hash}`,
)
