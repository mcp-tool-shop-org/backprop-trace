/**
 * v0.9 — Generate canonical PyTorch batched softmax+CE fixtures:
 *
 *   - fixtures/external/pytorch.softmax-ce.batched.sidecar.jsonl
 *     (framework-trace.v0.3.0 single-record, 1 step × 4 samples, batched SGD)
 *   - fixtures/external/pytorch.softmax-ce.batched.golden.jsonl
 *     (observer-mode v0.4.0 receipt produced by `bp import pytorch <sidecar>`)
 *
 *   - fixtures/external/pytorch.softmax-ce.multi-step-batched.sidecar.jsonl
 *     (framework-trace.v0.3.0 JSONL stream, 2 steps × 4 samples each)
 *   - fixtures/external/pytorch.softmax-ce.multi-step-batched.golden.jsonl
 *     (2 observer-mode receipts, bound by attestor.bundle_root_digest)
 *
 * Topology: 2-2-3 sigmoid+softmax cross-entropy (matches v0.5-v0.8 single-
 * sample fixtures). 4 samples per batch. Reduction: "mean" (PyTorch default).
 * Loss does NOT converge meaningfully — pedagogical, not real training.
 *
 * v0.9.0 ships SGD only and REDUCED gradients only (per-sample gradients
 * deferred to v0.9.x/v0.10). The sidecar carries per-sample inputs/targets/
 * forward/loss; top-level forward/inputs/targets reflect the FIRST sample
 * by canonical convention; top-level updates[].gradient is the reduced
 * (mean) gradient that SGD actually applied.
 *
 * Reproducibility: re-runs produce byte-identical output.
 */

import { writeFileSync } from "node:fs"
import { runBatchedGeneralStep } from "../src/general-engine.js"
import { importPytorchSidecar, importPytorchSidecarStream } from "../src/import-pytorch.js"
import type { GeneralInput, BatchedGeneralInput } from "../src/general-engine.js"
import type { Topology } from "../src/topology.js"

const PINNED_TIMESTAMP = "2026-05-18T05:00:00Z"
const PINNED_PYTORCH_VERSION = "2.4.0"
const PINNED_TRACE_ID = "b0a1c2d3e4f5061728394a5b6c7d8e9f"

const TOPOLOGY: Topology = {
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

const INITIAL_PARAMETERS = {
  w_x1_h1: 0.15, w_x2_h1: 0.20, w_x1_h2: 0.25, w_x2_h2: 0.30,
  w_h1_o1: 0.40, w_h2_o1: 0.45,
  w_h1_o2: 0.50, w_h2_o2: 0.55,
  w_h1_o3: 0.35, w_h2_o3: 0.10,
  b_hidden: 0.05, b_output: 0.15,
}

const LEARNING_RATE = 0.5

// 4 distinct samples; mix of target classes.
const SAMPLES = [
  { id: "s0", inputs: { x1: 0.10, x2: 0.90 }, targets: { o1: 1, o2: 0, o3: 0 } },
  { id: "s1", inputs: { x1: 0.60, x2: 0.40 }, targets: { o1: 0, o2: 1, o3: 0 } },
  { id: "s2", inputs: { x1: 0.30, x2: 0.70 }, targets: { o1: 0, o2: 0, o3: 1 } },
  { id: "s3", inputs: { x1: 0.80, x2: 0.20 }, targets: { o1: 1, o2: 0, o3: 0 } },
]

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
  reason: "v0.9 PyTorch batched fixture pins biases as constant across the batched step — Mazur convention.",
  updated_in_step: false,
  reconciliation: "parameters_after[bias_id] === parameters_before[bias_id] for every bias parameter",
}

// ----------------------------------------------------------------------------
// Helper: build a batched sidecar record from per-sample engine receipts.
// ----------------------------------------------------------------------------
function buildBatchedSidecar(
  parameters_before: Record<string, number>,
  trace_id: string | undefined,
  step_index: number | undefined,
): { sidecar: object; reducedReceipt: ReturnType<typeof runBatchedGeneralStep> } {
  const batchedInput: BatchedGeneralInput = {
    topology: TOPOLOGY,
    learning_rate: LEARNING_RATE,
    batch: {
      size: SAMPLES.length,
      sample_order: SAMPLES.map((s) => s.id),
      reduction: "mean",
    },
    parameters_before,
    per_sample: Object.fromEntries(
      SAMPLES.map((s) => [s.id, { inputs: s.inputs, targets: s.targets }]),
    ),
    numeric_policy: NUMERIC_POLICY,
    bias_policy: BIAS_POLICY,
    ...(trace_id !== undefined ? { trace_id } : {}),
    ...(step_index !== undefined ? { step_index } : {}),
  }
  const reducedReceipt = runBatchedGeneralStep(batchedInput)

  // Sidecar mirrors the engine receipt's batch + per_sample + reduced loss /
  // backward / updates fields. The importer will pass these through to the
  // observer-mode receipt (foreign claims = canonical fields; engine recompute
  // = differential witness).
  const sidecar = {
    format: "framework-trace.v0.3.0",
    source_framework: {
      name: "pytorch",
      version: PINNED_PYTORCH_VERSION,
      information_uri: "https://pytorch.org/",
      extractor: {
        name: "bp-import-pytorch-batched-helper",
        version: "0.9.0",
      },
    },
    ...(trace_id !== undefined ? { trace_id } : {}),
    ...(step_index !== undefined ? { step_index } : {}),
    topology: TOPOLOGY,
    learning_rate: LEARNING_RATE,
    numeric_policy: NUMERIC_POLICY,
    bias_policy: BIAS_POLICY,
    batch: {
      size: SAMPLES.length,
      sample_order: SAMPLES.map((s) => s.id),
      reduction: "mean",
    },
    inputs: SAMPLES[0]!.inputs,
    targets: SAMPLES[0]!.targets,
    parameters_before,
    per_sample: Object.fromEntries(
      SAMPLES.map((s) => {
        const eng = reducedReceipt.per_sample![s.id]!
        return [
          s.id,
          {
            inputs: s.inputs,
            targets: s.targets,
            forward: eng.forward,
            loss: { per_output: eng.loss.per_output, total: eng.loss.total },
          },
        ]
      }),
    ),
    forward: reducedReceipt.forward,
    loss: reducedReceipt.loss,
    backward: reducedReceipt.backward,
    updates: reducedReceipt.updates,
    parameters_after: reducedReceipt.parameters_after,
    post_update_forward: {
      status: reducedReceipt.post_update_forward.status,
      ...reducedReceipt.post_update_forward.units,
    },
    post_update_loss: reducedReceipt.post_update_loss,
  }
  return { sidecar, reducedReceipt }
}

// ============================================================================
// Fixture 1: pytorch.softmax-ce.batched (1 step × 4 samples)
// ============================================================================
{
  const { sidecar } = buildBatchedSidecar(INITIAL_PARAMETERS, undefined, undefined)
  const sidecarBytes = JSON.stringify(sidecar) + "\n"
  writeFileSync("fixtures/external/pytorch.softmax-ce.batched.sidecar.jsonl", sidecarBytes)
  console.log("wrote fixtures/external/pytorch.softmax-ce.batched.sidecar.jsonl")

  const result = importPytorchSidecar(sidecarBytes, {
    importTimestamp: PINNED_TIMESTAMP,
    fixtureLabel: "pytorch-softmax-ce-batched-imported",
  })
  writeFileSync("fixtures/external/pytorch.softmax-ce.batched.golden.jsonl", result.emittedBytes)
  console.log("wrote fixtures/external/pytorch.softmax-ce.batched.golden.jsonl")
  console.log(`  differentialPassed: ${result.differentialPassed}`)
  console.log(`  fixture_status: ${result.receipt.fixture_status.authoring_state} / ${result.receipt.fixture_status.verification_state}`)
  console.log(`  batch.size: ${result.receipt.batch?.size}; reduction: ${result.receipt.batch?.reduction}`)
}

// ============================================================================
// Fixture 2: pytorch.softmax-ce.multi-step-batched (2 steps × 4 samples)
// ============================================================================
{
  const sidecars: object[] = []
  let parameters_before: Record<string, number> = { ...INITIAL_PARAMETERS }
  for (let i = 0; i < 2; i += 1) {
    const { sidecar, reducedReceipt } = buildBatchedSidecar(
      parameters_before,
      PINNED_TRACE_ID,
      i,
    )
    sidecars.push(sidecar)
    parameters_before = { ...reducedReceipt.parameters_after }
  }
  const sidecarBytes = sidecars.map((r) => JSON.stringify(r)).join("\n") + "\n"
  writeFileSync(
    "fixtures/external/pytorch.softmax-ce.multi-step-batched.sidecar.jsonl",
    sidecarBytes,
  )
  console.log(
    `wrote fixtures/external/pytorch.softmax-ce.multi-step-batched.sidecar.jsonl (${sidecars.length} steps × ${SAMPLES.length} samples)`,
  )

  const result = importPytorchSidecarStream(sidecarBytes, {
    importTimestamp: PINNED_TIMESTAMP,
    fixtureLabel: "pytorch-softmax-ce-multi-step-batched-imported",
  })
  writeFileSync(
    "fixtures/external/pytorch.softmax-ce.multi-step-batched.golden.jsonl",
    result.emittedBytes,
  )
  console.log(
    `wrote fixtures/external/pytorch.softmax-ce.multi-step-batched.golden.jsonl (${result.steps.length} receipts)`,
  )
  console.log(`  allDifferentialsPassed: ${result.allDifferentialsPassed}`)
  console.log(`  bundleRootDigest: ${result.bundleRootDigest}`)
}
