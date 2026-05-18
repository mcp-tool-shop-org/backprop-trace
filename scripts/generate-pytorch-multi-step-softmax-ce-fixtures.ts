/**
 * v0.8 — Generate the canonical PyTorch multi-step softmax+CE fixture pair:
 *   - fixtures/external/pytorch.softmax-ce.multi-step.sidecar.jsonl
 *       (framework-trace.v0.2.0 JSONL stream — 3 records, one per training
 *        step, what a PyTorch user would emit from a 3-iteration training
 *        loop via a thin Python helper that dumps per-step values from
 *        the autograd graph + optimizer state)
 *   - fixtures/external/pytorch.softmax-ce.multi-step.golden.jsonl
 *       (observer-mode v0.4.0 receipt JSONL stream — 3 receipts, one
 *        per step, what `bp import pytorch multi` produces)
 *
 * Topology: same 2-2-3 softmax+CE used by the v0.6.0 single-step PyTorch
 * fixture, run for 3 SGD steps. Loss does NOT converge — it oscillates on
 * such a small network — but that's fine; the verifier checks per-step
 * math + cross-step chain integrity + bundle binding, not training quality.
 *
 * The bundle is bound by an attestor.bundle_root_digest computed by the
 * multi-step importer in two passes (emit without digest → sha256 → embed
 * digest on every receipt → re-emit). Rule 17 verifies this binding at
 * reconcile time.
 *
 * Reproducibility: reads no files. Re-runs produce byte-identical output
 * provided runGeneralStep + emitGeneralReceipt are unchanged.
 */

import { writeFileSync } from "node:fs"
import { runGeneralStep } from "../src/general-engine.js"
import { importPytorchSidecarStream } from "../src/import-pytorch.js"
import type { GeneralInput, GeneralReceipt } from "../src/general-engine.js"
import type { Topology } from "../src/topology.js"

const PINNED_TIMESTAMP = "2026-05-18T02:00:00Z"
const PINNED_PYTORCH_VERSION = "2.4.0"
const PINNED_TRACE_ID = "a0b1c2d3e4f5061728394a5b6c7d8e9f" // 32-char hex
const STEP_COUNT = 3

const PYTORCH_MULTI_STEP_TOPOLOGY: Topology = {
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

// Initial parameters for step 0. Each subsequent step uses the prior
// step's parameters_after as parameters_before (chain).
const INITIAL_PARAMETERS = {
  w_x1_h1: 0.15, w_x2_h1: 0.20, w_x1_h2: 0.25, w_x2_h2: 0.30,
  w_h1_o1: 0.40, w_h2_o1: 0.45,
  w_h1_o2: 0.50, w_h2_o2: 0.55,
  w_h1_o3: 0.35, w_h2_o3: 0.10,
  b_hidden: 0.05, b_output: 0.15,
}

const LEARNING_RATE = 0.5
const INPUTS = { x1: 1.0, x2: 0.5 }
const TARGETS = { o1: 1, o2: 0, o3: 0 } // one-hot class o1, same across all steps

const NUMERIC_POLICY: NonNullable<GeneralInput["numeric_policy"]> = {
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
}

const BIAS_POLICY: NonNullable<GeneralInput["bias_policy"]> = {
  mode: "constant",
  reason:
    "v0.8 PyTorch multi-step fixture pins biases as constant across all 3 steps — Mazur convention.",
  updated_in_step: false,
  reconciliation:
    "parameters_after[bias_id] === parameters_before[bias_id] for every bias parameter",
}

// ---- Step 1: produce N=3 engine receipts as the foreign-claim baseline,
// chaining parameters_before[N] = parameters_after[N-1].
const engineReceipts: GeneralReceipt[] = []
let parameters_before: Record<string, number> = { ...INITIAL_PARAMETERS }
for (let i = 0; i < STEP_COUNT; i += 1) {
  const input: GeneralInput = {
    topology: PYTORCH_MULTI_STEP_TOPOLOGY,
    learning_rate: LEARNING_RATE,
    inputs: INPUTS,
    targets: TARGETS,
    parameters_before,
    numeric_policy: NUMERIC_POLICY,
    bias_policy: BIAS_POLICY,
    fixture: `pytorch-multi-step-engine-step-${i}`,
    metadata: {
      source:
        "src/import-pytorch.ts (PyTorch multi-step softmax+CE observer-mode engine recompute reference)",
      gradient_convention: "descent_direction",
    },
  }
  const r = runGeneralStep(input)
  engineReceipts.push(r)
  parameters_before = { ...r.parameters_after }
}

// ---- Step 2: build the multi-step sidecar (3 JSONL records). Each record
// is a framework-trace.v0.2.0 sidecar that mirrors the engine receipt for
// that step. trace_id + step_index are declared on every record.
const sidecarRecords = engineReceipts.map((er, i) => ({
  format: "framework-trace.v0.2.0",
  source_framework: {
    name: "pytorch",
    version: PINNED_PYTORCH_VERSION,
    information_uri: "https://pytorch.org/",
    extractor: {
      name: "bp-import-pytorch-multi-step-helper",
      version: "0.8.0",
    },
  },
  trace_id: PINNED_TRACE_ID,
  step_index: i,
  topology: PYTORCH_MULTI_STEP_TOPOLOGY,
  learning_rate: LEARNING_RATE,
  numeric_policy: NUMERIC_POLICY,
  bias_policy: BIAS_POLICY,
  inputs: INPUTS,
  targets: TARGETS,
  parameters_before: er.parameters_before,
  forward: er.forward,
  loss: er.loss,
  backward: er.backward,
  updates: er.updates,
  parameters_after: er.parameters_after,
  post_update_forward: {
    status: er.post_update_forward.status,
    ...er.post_update_forward.units,
  },
  post_update_loss: er.post_update_loss,
}))

const sidecarBytes = sidecarRecords.map((r) => JSON.stringify(r)).join("\n") + "\n"
writeFileSync(
  "fixtures/external/pytorch.softmax-ce.multi-step.sidecar.jsonl",
  sidecarBytes,
)
console.log(
  `wrote fixtures/external/pytorch.softmax-ce.multi-step.sidecar.jsonl (${STEP_COUNT} steps, trace_id=${PINNED_TRACE_ID})`,
)

// ---- Step 3: run the multi-step importer on the sidecar. PINNED_TIMESTAMP
// makes the produced receipts deterministic across re-runs.
const result = importPytorchSidecarStream(sidecarBytes, {
  importTimestamp: PINNED_TIMESTAMP,
  fixtureLabel: "pytorch-softmax-ce-multi-step-imported",
})

writeFileSync(
  "fixtures/external/pytorch.softmax-ce.multi-step.golden.jsonl",
  result.emittedBytes,
)
console.log(
  `wrote fixtures/external/pytorch.softmax-ce.multi-step.golden.jsonl (${result.steps.length} receipts)`,
)
console.log(`  allDifferentialsPassed: ${result.allDifferentialsPassed}`)
console.log(`  bundleRootDigest: ${result.bundleRootDigest}`)
console.log(
  `  per-step verification_state: ${result.steps
    .map((s) => s.receipt.fixture_status.verification_state)
    .join(", ")}`,
)
console.log(`  trace_id (resolved): ${result.steps[0]?.receipt.trace_id}`)
console.log(
  `  step_index sequence: ${result.steps.map((s) => s.receipt.step_index).join(", ")}`,
)
