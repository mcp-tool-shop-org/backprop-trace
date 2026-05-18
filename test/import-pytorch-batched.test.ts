/**
 * v0.9 — `bp import pytorch <batched-sidecar>` + `bp import pytorch multi
 * <multi-step-batched-sidecar>` end-to-end test plate.
 *
 * Verifies the batched observer-mode ingestion path:
 *
 *   1. Single-step batched sidecar → observer-mode v0.4.0 receipt round-trip
 *      produces byte-equal output to fixtures/external/pytorch.softmax-ce.batched.golden.jsonl.
 *   2. Multi-step batched sidecar → 2 observer-mode receipts (bound by
 *      bundle_root_digest) byte-equal to the multi-step golden.
 *   3. Resulting receipts schema-validate against receipt.v0.4.0 (additive
 *      extension — batch + per_sample + loss.reduction + loss.per_sample fields
 *      are optional and don't require a schema bump).
 *   4. Resulting receipts reconcile cleanly through reconcileReceipt /
 *      reconcileMultiStep (Rules 1-17 + Rule 18 (batch reduction consistency
 *      passes on the canonical good fixture) + Rule 19 (sample-set coherence
 *      passes since per-sample maps match batch.sample_order).
 *   5. CLI: `bp import pytorch <batched-sidecar>` and `bp import pytorch
 *      multi <multi-step-batched-sidecar>` work end-to-end.
 *   6. Batch-aware engine (runBatchedGeneralStep) produces consistent
 *      receipts for unit-level testing.
 */

import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync, existsSync } from "node:fs"
import { spawnSync } from "node:child_process"
import { fileURLToPath } from "node:url"
import { dirname, resolve } from "node:path"
import {
  importPytorchSidecar,
  importPytorchSidecarStream,
} from "../src/import-pytorch.js"
import { validateReceiptSchema } from "../src/validate.js"
import {
  reconcileReceipt,
  reconcileMultiStep,
} from "../src/reconcile.js"
import {
  runBatchedGeneralStep,
  type BatchedGeneralInput,
} from "../src/general-engine.js"

const __dirname = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(__dirname, "..")
const batchedSidecarPath = resolve(
  repoRoot,
  "fixtures/external/pytorch.softmax-ce.batched.sidecar.jsonl",
)
const batchedGoldenPath = resolve(
  repoRoot,
  "fixtures/external/pytorch.softmax-ce.batched.golden.jsonl",
)
const multiStepBatchedSidecarPath = resolve(
  repoRoot,
  "fixtures/external/pytorch.softmax-ce.multi-step-batched.sidecar.jsonl",
)
const multiStepBatchedGoldenPath = resolve(
  repoRoot,
  "fixtures/external/pytorch.softmax-ce.multi-step-batched.golden.jsonl",
)

const PINNED_TIMESTAMP = "2026-05-18T05:00:00Z"

// ============================================================================
// Single-step batched
// ============================================================================

test("importPytorchSidecar produces byte-equal output to shipped batched golden", () => {
  if (!existsSync(batchedSidecarPath) || !existsSync(batchedGoldenPath)) {
    throw new Error(
      "v0.9 batched fixtures missing. Run scripts/generate-pytorch-batched-softmax-ce-fixtures.ts.",
    )
  }
  const sidecar = readFileSync(batchedSidecarPath, "utf-8")
  const expected = readFileSync(batchedGoldenPath, "utf-8")
  const result = importPytorchSidecar(sidecar, {
    importTimestamp: PINNED_TIMESTAMP,
    fixtureLabel: "pytorch-softmax-ce-batched-imported",
  })
  assert.strictEqual(
    result.emittedBytes,
    expected,
    "Batched PyTorch importer emission must be byte-equal to fixtures/external/pytorch.softmax-ce.batched.golden.jsonl.",
  )
  assert.strictEqual(result.differentialPassed, true)
  assert.strictEqual(result.differentialDisagreements.length, 0)
})

test("batched observer-mode receipt schema-validates against v0.4.0 (additive batch + per_sample fields)", () => {
  if (!existsSync(batchedGoldenPath)) return
  const r = JSON.parse(readFileSync(batchedGoldenPath, "utf-8").trim())
  const v = validateReceiptSchema(r)
  assert.strictEqual(
    v.ok,
    true,
    `Batched golden must schema-validate (receipt.v0.4.0 additive extension); errors: ${v.ok ? "[]" : JSON.stringify(v.errors)}`,
  )
  assert.strictEqual(v.schemaVersion, "0.4.0")
})

test("batched receipt carries batch + per_sample + loss.per_sample + loss.reduction fields", () => {
  if (!existsSync(batchedGoldenPath)) return
  const r = JSON.parse(readFileSync(batchedGoldenPath, "utf-8").trim()) as {
    batch?: { size: number; sample_order: string[]; reduction: string }
    per_sample?: Record<string, unknown>
    loss: { per_sample?: Record<string, number>; reduction?: string }
  }
  assert.ok(r.batch, "receipt must declare batch block")
  assert.strictEqual(r.batch!.size, 4)
  assert.deepStrictEqual(r.batch!.sample_order, ["s0", "s1", "s2", "s3"])
  assert.strictEqual(r.batch!.reduction, "mean")
  assert.ok(r.per_sample, "receipt must declare per_sample block")
  assert.deepStrictEqual(
    Object.keys(r.per_sample!).sort(),
    ["s0", "s1", "s2", "s3"],
    "per_sample keys must match batch.sample_order set",
  )
  assert.ok(r.loss.per_sample, "loss must declare per_sample map (used by Rule 18)")
  assert.strictEqual(r.loss.reduction, "mean", "loss.reduction must echo batch.reduction")
})

test("batched receipt reconciles cleanly (Rules 1-19 all pass on canonical golden)", () => {
  if (!existsSync(batchedGoldenPath)) return
  const r = JSON.parse(readFileSync(batchedGoldenPath, "utf-8").trim())
  const result = reconcileReceipt(r)
  assert.strictEqual(
    result.ok,
    true,
    `Batched golden must reconcile cleanly; failures: ${
      result.ok === false
        ? JSON.stringify(result.failures.map((f) => ({ rule: f.rule, field_path: f.field_path })))
        : "ok"
    }`,
  )
})

// ============================================================================
// Multi-step batched
// ============================================================================

test("importPytorchSidecarStream produces byte-equal output to shipped multi-step batched golden", () => {
  if (!existsSync(multiStepBatchedSidecarPath) || !existsSync(multiStepBatchedGoldenPath)) {
    throw new Error(
      "v0.9 multi-step batched fixtures missing. Run scripts/generate-pytorch-batched-softmax-ce-fixtures.ts.",
    )
  }
  const sidecar = readFileSync(multiStepBatchedSidecarPath, "utf-8")
  const expected = readFileSync(multiStepBatchedGoldenPath, "utf-8")
  const result = importPytorchSidecarStream(sidecar, {
    importTimestamp: PINNED_TIMESTAMP,
    fixtureLabel: "pytorch-softmax-ce-multi-step-batched-imported",
  })
  assert.strictEqual(
    result.emittedBytes,
    expected,
    "Multi-step batched PyTorch stream importer must be byte-equal to fixtures/external/pytorch.softmax-ce.multi-step-batched.golden.jsonl",
  )
  assert.strictEqual(result.allDifferentialsPassed, true)
  assert.strictEqual(result.steps.length, 2)
})

test("multi-step batched receipt stream reconciles cleanly (Rules 1-19 + cross-step Rules 9, 10, 17)", () => {
  if (!existsSync(multiStepBatchedGoldenPath)) return
  const text = readFileSync(multiStepBatchedGoldenPath, "utf-8").trim()
  const receipts = text.split("\n").map((line) => JSON.parse(line))
  const result = reconcileMultiStep(receipts)
  assert.strictEqual(
    result.ok,
    true,
    `Multi-step batched golden must reconcile cleanly; failures: ${
      result.ok === false
        ? JSON.stringify(result.failures.map((f) => ({ rule: f.rule, field_path: f.field_path })))
        : "ok"
    }`,
  )
})

test("multi-step batched receipts share trace_id + dense step_index + identical bundle_root_digest", () => {
  if (!existsSync(multiStepBatchedGoldenPath)) return
  const receipts = readFileSync(multiStepBatchedGoldenPath, "utf-8")
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line) as {
      trace_id?: string
      step_index?: number
      batch?: { size: number; reduction: string }
      attestor?: { bundle_root_digest?: string }
    })
  const traceIds = new Set(receipts.map((r) => r.trace_id))
  assert.strictEqual(traceIds.size, 1, "all receipts share one trace_id")
  assert.deepStrictEqual(receipts.map((r) => r.step_index), [0, 1])
  const digests = new Set(receipts.map((r) => r.attestor?.bundle_root_digest))
  assert.strictEqual(digests.size, 1, "all receipts declare identical bundle_root_digest")
  // Both records are batched with size=4 mean.
  for (const r of receipts) {
    assert.strictEqual(r.batch?.size, 4)
    assert.strictEqual(r.batch?.reduction, "mean")
  }
})

// ============================================================================
// runBatchedGeneralStep unit-level invariants
// ============================================================================

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
  reason: "unit-test minimum bias policy",
  updated_in_step: false,
  reconciliation:
    "parameters_after[bias_id] === parameters_before[bias_id] for every bias parameter",
}

const MINIMAL_TOPOLOGY = {
  layers: ["input", "hidden", "output"] as const,
  unit_order: { input: ["x1"], hidden: ["h1"], output: ["o1"] },
  parameter_order: ["w_x1_h1", "w_h1_o1", "b_hidden", "b_output"],
  parameters: [
    { id: "w_x1_h1", role: "input_to_hidden_weight" as const, from_unit: "x1", to_unit: "h1" },
    { id: "w_h1_o1", role: "hidden_to_output_weight" as const, from_unit: "h1", to_unit: "o1" },
    { id: "b_hidden", role: "hidden_bias" as const, applies_to_units: ["h1"] },
    { id: "b_output", role: "output_bias" as const, applies_to_units: ["o1"] },
  ],
  activation_hidden: "sigmoid" as const,
  activation_output: "sigmoid" as const,
  loss: "half_squared_error" as const,
  bias_sharing: "per_layer" as const,
  input_size: 1,
  hidden_size: 1,
  output_size: 1,
}

test("runBatchedGeneralStep rejects sample_order with duplicates", () => {
  const input: BatchedGeneralInput = {
    topology: MINIMAL_TOPOLOGY,
    learning_rate: 0.1,
    batch: { size: 2, sample_order: ["s0", "s0"], reduction: "mean" },
    parameters_before: { w_x1_h1: 0.5, w_h1_o1: 0.5, b_hidden: 0.0, b_output: 0.0 },
    per_sample: {
      s0: { inputs: { x1: 1.0 }, targets: { o1: 1.0 } },
    },
    numeric_policy: MINIMAL_NUMERIC_POLICY,
    bias_policy: MINIMAL_BIAS_POLICY,
  }
  assert.throws(
    () => runBatchedGeneralStep(input),
    /duplicate sample_id/,
    "runBatchedGeneralStep must reject duplicate sample_id in batch.sample_order",
  )
})

test("runBatchedGeneralStep rejects per_sample missing a declared sample_id", () => {
  const input: BatchedGeneralInput = {
    topology: MINIMAL_TOPOLOGY,
    learning_rate: 0.1,
    batch: { size: 2, sample_order: ["s0", "s1"], reduction: "mean" },
    parameters_before: { w_x1_h1: 0.5, w_h1_o1: 0.5, b_hidden: 0.0, b_output: 0.0 },
    per_sample: {
      s0: { inputs: { x1: 1.0 }, targets: { o1: 1.0 } },
      // s1 missing!
    },
    numeric_policy: MINIMAL_NUMERIC_POLICY,
    bias_policy: MINIMAL_BIAS_POLICY,
  }
  assert.throws(
    () => runBatchedGeneralStep(input),
    /missing entry for sample_id "s1"/,
    "runBatchedGeneralStep must reject per_sample missing a declared sample_id",
  )
})

// ============================================================================
// CLI end-to-end
// ============================================================================

function runBp(args: string[], stdin?: string): {
  status: number | null
  stdout: string
  stderr: string
} {
  const result = spawnSync(
    process.execPath,
    ["--import", "tsx", "src/bin/bp.ts", ...args],
    { cwd: repoRoot, encoding: "utf-8", input: stdin },
  )
  return { status: result.status, stdout: result.stdout, stderr: result.stderr }
}

test("bp import pytorch <batched-sidecar> exits 0 and emits batched observer-mode receipt", () => {
  if (!existsSync(batchedSidecarPath)) return
  const { status, stdout } = runBp([
    "import",
    "pytorch",
    "fixtures/external/pytorch.softmax-ce.batched.sidecar.jsonl",
  ])
  assert.strictEqual(status, 0, "canonical batched PyTorch sidecar must exit 0")
  const parsed = JSON.parse(stdout.trim()) as {
    schema_version: string
    batch?: { size: number; reduction: string }
    per_sample?: Record<string, unknown>
  }
  assert.strictEqual(parsed.schema_version, "0.4.0")
  assert.strictEqual(parsed.batch?.size, 4)
  assert.strictEqual(parsed.batch?.reduction, "mean")
  assert.ok(parsed.per_sample, "emitted receipt must carry per_sample block")
})

test("bp import pytorch multi <multi-step-batched-sidecar> exits 0 and emits 2 batched receipts", () => {
  if (!existsSync(multiStepBatchedSidecarPath)) return
  const { status, stdout } = runBp([
    "import",
    "pytorch",
    "multi",
    "fixtures/external/pytorch.softmax-ce.multi-step-batched.sidecar.jsonl",
  ])
  assert.strictEqual(
    status,
    0,
    "canonical multi-step batched PyTorch sidecar must exit 0",
  )
  const lines = stdout.trim().split("\n").filter((l) => l.length > 0)
  assert.strictEqual(lines.length, 2)
  for (const line of lines) {
    const r = JSON.parse(line) as { batch?: { size: number } }
    assert.strictEqual(r.batch?.size, 4)
  }
})

test("end-to-end batched pipe: bp import pytorch multi <batched> | bp verify multi - exits 0", () => {
  if (!existsSync(multiStepBatchedSidecarPath)) return
  const importResult = runBp([
    "import",
    "pytorch",
    "multi",
    "fixtures/external/pytorch.softmax-ce.multi-step-batched.sidecar.jsonl",
  ])
  assert.strictEqual(importResult.status, 0)
  const verifyResult = runBp(["verify", "multi", "-"], importResult.stdout)
  assert.strictEqual(
    verifyResult.status,
    0,
    `verify multi must accept batched multi-step receipts and exit 0. stderr: ${verifyResult.stderr}`,
  )
})
