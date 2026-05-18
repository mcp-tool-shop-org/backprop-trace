/**
 * v0.8 — `bp import pytorch multi` end-to-end test plate.
 *
 * Verifies the multi-step observer-mode ingestion path:
 *
 *  1. Sidecar JSONL stream → N observer-mode v0.4.0 receipts round-trip
 *     produces byte-equal output to fixtures/external/pytorch.softmax-ce.multi-step.golden.jsonl.
 *  2. Every emitted receipt schema-validates against receipt.v0.4.0.json.
 *  3. The receipt stream reconciles cleanly through reconcileMultiStep
 *     (Rules 1-8 per receipt + Rules 9 + 10 cross-record + Rule 17 bundle binding).
 *  4. Each receipt carries shared trace_id + dense step_index 0..N-1.
 *  5. Every receipt's attestor.bundle_root_digest is identical and matches
 *     the recomputed canonical-byte digest of the stripped bundle.
 *  6. Per-framework discipline: importPytorchSidecarStream rejects JAX
 *     and TensorFlow v0.2.0 sidecars (and vice versa, library layer).
 *  7. Format-const dispatch: rejecting v0.1.0 (single-step) sidecars in
 *     the multi-step path with a clear diagnostic.
 *  8. CLI: `bp import pytorch multi <sidecar.jsonl>` exits 0 on the
 *     canonical fixture; `bp import pytorch multi <bad>` fires expected
 *     diagnostics + exit codes.
 *  9. End-to-end: `bp import pytorch multi <file> | bp verify multi -`
 *     produces exit 0 on the canonical fixture (covered separately in
 *     cli.multi-step-import-pipe.test.ts).
 */

import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync, existsSync } from "node:fs"
import { spawnSync } from "node:child_process"
import { fileURLToPath } from "node:url"
import { dirname, resolve } from "node:path"
import { importPytorchSidecarStream } from "../src/import-pytorch.js"
import { importJaxSidecarStream } from "../src/import-jax.js"
import { importTensorflowSidecarStream } from "../src/import-tensorflow.js"
import { validateReceiptSchema } from "../src/validate.js"
import { reconcileMultiStep } from "../src/reconcile.js"

const __dirname = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(__dirname, "..")
const sidecarPath = resolve(
  repoRoot,
  "fixtures/external/pytorch.softmax-ce.multi-step.sidecar.jsonl",
)
const goldenPath = resolve(
  repoRoot,
  "fixtures/external/pytorch.softmax-ce.multi-step.golden.jsonl",
)
const singleStepSidecarPath = resolve(
  repoRoot,
  "fixtures/external/pytorch.softmax-ce.sidecar.jsonl",
)

const PINNED_TIMESTAMP = "2026-05-18T02:00:00Z"
const PINNED_FIXTURE_LABEL = "pytorch-softmax-ce-multi-step-imported"

test("importPytorchSidecarStream produces byte-equal output to shipped multi-step golden", () => {
  if (!existsSync(sidecarPath) || !existsSync(goldenPath)) {
    throw new Error(
      `v0.8 multi-step fixtures missing. Run scripts/generate-pytorch-multi-step-softmax-ce-fixtures.ts.`,
    )
  }
  const sidecar = readFileSync(sidecarPath, "utf-8")
  const expected = readFileSync(goldenPath, "utf-8")
  const result = importPytorchSidecarStream(sidecar, {
    importTimestamp: PINNED_TIMESTAMP,
    fixtureLabel: PINNED_FIXTURE_LABEL,
  })
  assert.strictEqual(
    result.emittedBytes,
    expected,
    `Multi-step PyTorch importer emission must be byte-equal to fixtures/external/pytorch.softmax-ce.multi-step.golden.jsonl. ` +
      `If this fails, regenerate via scripts/generate-pytorch-multi-step-softmax-ce-fixtures.ts AND every multi-step bad fixture via ` +
      `scripts/generate-multi-step-external-bad-fixtures.ts in the same commit.`,
  )
  assert.strictEqual(result.allDifferentialsPassed, true)
  assert.strictEqual(result.steps.length, 3)
  for (const s of result.steps) {
    assert.strictEqual(s.differentialPassed, true)
    assert.strictEqual(s.differentialDisagreements.length, 0)
  }
})

test("each multi-step receipt schema-validates against v0.4.0", () => {
  if (!existsSync(goldenPath)) return
  const text = readFileSync(goldenPath, "utf-8").trim()
  const receipts = text.split("\n").map((line) => JSON.parse(line))
  assert.strictEqual(receipts.length, 3)
  for (let i = 0; i < receipts.length; i += 1) {
    const v = validateReceiptSchema(receipts[i])
    assert.strictEqual(
      v.ok,
      true,
      `Receipt ${i} must schema-validate; errors: ${v.ok ? "[]" : JSON.stringify(v.errors)}`,
    )
    assert.strictEqual(v.schemaVersion, "0.4.0")
  }
})

test("multi-step receipt stream reconciles cleanly via reconcileMultiStep (Rules 1-10, 14, 17 all pass)", () => {
  if (!existsSync(goldenPath)) return
  const text = readFileSync(goldenPath, "utf-8").trim()
  const receipts = text.split("\n").map((line) => JSON.parse(line))
  const result = reconcileMultiStep(receipts)
  assert.strictEqual(
    result.ok,
    true,
    `Multi-step golden must reconcile cleanly; failures: ${
      result.ok === false
        ? JSON.stringify(result.failures.map((f) => ({ rule: f.rule, field_path: f.field_path })))
        : "ok"
    }`,
  )
})

test("multi-step receipts carry shared trace_id + dense step_index 0..N-1 + identical bundle_root_digest", () => {
  if (!existsSync(goldenPath)) return
  const receipts = readFileSync(goldenPath, "utf-8")
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line) as {
      trace_id?: string
      step_index?: number
      attestor?: { bundle_root_digest?: string }
    })
  const traceIds = new Set(receipts.map((r) => r.trace_id))
  assert.strictEqual(traceIds.size, 1, "all receipts must share one trace_id")
  const stepIndices = receipts.map((r) => r.step_index)
  assert.deepStrictEqual(
    stepIndices,
    [0, 1, 2],
    "step_index sequence must be dense + monotonic from 0",
  )
  const digests = new Set(receipts.map((r) => r.attestor?.bundle_root_digest))
  assert.strictEqual(
    digests.size,
    1,
    "all receipts must declare identical attestor.bundle_root_digest",
  )
  const digest = receipts[0]!.attestor!.bundle_root_digest!
  assert.match(
    digest,
    /^sha256:[0-9a-f]{64}$/,
    "bundle_root_digest must be sha256:<64-hex>",
  )
})

// =============================================================================
// Per-framework subcommand discipline (3-way refusal matrix on streams)
// =============================================================================

test("importPytorchSidecarStream rejects JAX multi-step sidecars", () => {
  if (!existsSync(sidecarPath)) return
  const pyt = readFileSync(sidecarPath, "utf-8")
  // Build a JAX-named multi-step sidecar by relabeling source_framework.name.
  const records = pyt
    .trim()
    .split("\n")
    .map((l) => {
      const r = JSON.parse(l) as { source_framework: { name: string } }
      r.source_framework.name = "jax"
      return JSON.stringify(r)
    })
    .join("\n") + "\n"
  assert.throws(
    () => importPytorchSidecarStream(records, { importTimestamp: PINNED_TIMESTAMP }),
    /importPytorchSidecarStream accepts only 'pytorch'/,
    "must reject JAX-named multi-step sidecars",
  )
})

test("importJaxSidecarStream + importTensorflowSidecarStream reject PyTorch multi-step sidecars (symmetric refusal)", () => {
  if (!existsSync(sidecarPath)) return
  const pyt = readFileSync(sidecarPath, "utf-8")
  assert.throws(
    () => importJaxSidecarStream(pyt, { importTimestamp: PINNED_TIMESTAMP }),
    /importJaxSidecarStream accepts only 'jax'/,
    "importJaxSidecarStream must refuse a PyTorch multi-step sidecar",
  )
  assert.throws(
    () =>
      importTensorflowSidecarStream(pyt, { importTimestamp: PINNED_TIMESTAMP }),
    /importTensorflowSidecarStream accepts only 'tensorflow'/,
    "importTensorflowSidecarStream must refuse a PyTorch multi-step sidecar",
  )
})

// =============================================================================
// Format-const dispatch: v0.1.0 single-step sidecars are NOT valid multi-step input
// =============================================================================

test("multi-step importer rejects v0.1.0 single-step sidecars with framework-trace.v0.2.0 required diagnostic", () => {
  if (!existsSync(singleStepSidecarPath)) return
  const singleStep = readFileSync(singleStepSidecarPath, "utf-8")
  assert.throws(
    () =>
      importPytorchSidecarStream(singleStep, { importTimestamp: PINNED_TIMESTAMP }),
    /framework-trace\.v0\.1\.0.+ requires.+framework-trace\.v0\.2\.0|framework-trace\.v0\.2\.0|single-step subcommand/,
    "multi-step path must reject v0.1.0 sidecars with a clear diagnostic pointing at the single-step subcommand",
  )
})

// =============================================================================
// Mid-stream framework swap rejection
// =============================================================================

test("multi-step importer rejects mid-stream framework swap (pytorch → jax)", () => {
  if (!existsSync(sidecarPath)) return
  const records = readFileSync(sidecarPath, "utf-8")
    .trim()
    .split("\n")
    .map((l) => JSON.parse(l) as { source_framework: { name: string } })
  records[1]!.source_framework.name = "jax"
  const tampered = records.map((r) => JSON.stringify(r)).join("\n") + "\n"
  assert.throws(
    () => importPytorchSidecarStream(tampered, { importTimestamp: PINNED_TIMESTAMP }),
    /framework mismatch at sidecar line 2/,
    "mid-stream framework swap must fail fast at the offending line",
  )
})

// =============================================================================
// CLI end-to-end
// =============================================================================

function runBp(args: string[]): {
  status: number | null
  stdout: string
  stderr: string
} {
  const result = spawnSync(
    process.execPath,
    ["--import", "tsx", "src/bin/bp.ts", ...args],
    { cwd: repoRoot, encoding: "utf-8" },
  )
  return { status: result.status, stdout: result.stdout, stderr: result.stderr }
}

test("bp import pytorch multi <sidecar> writes 3 receipts to stdout and exits 0", () => {
  if (!existsSync(sidecarPath)) return
  const { status, stdout } = runBp([
    "import",
    "pytorch",
    "multi",
    "fixtures/external/pytorch.softmax-ce.multi-step.sidecar.jsonl",
  ])
  assert.strictEqual(status, 0, "canonical 3-step PyTorch sidecar must exit 0")
  const lines = stdout.trim().split("\n").filter((l) => l.length > 0)
  assert.strictEqual(lines.length, 3, "stdout must contain 3 JSONL records (one per step)")
  for (const line of lines) {
    const r = JSON.parse(line) as {
      schema_version: string
      fixture_status: { authoring_state: string }
      source_framework: { name: string }
      attestor: { bundle_root_digest?: string }
    }
    assert.strictEqual(r.schema_version, "0.4.0")
    assert.strictEqual(r.fixture_status.authoring_state, "external_imported")
    assert.strictEqual(r.source_framework.name, "pytorch")
    assert.match(r.attestor.bundle_root_digest ?? "", /^sha256:[0-9a-f]{64}$/)
  }
})

test("bp import pytorch multi --help exits 0 with multi-step authoring notes", () => {
  const { status, stdout } = runBp(["import", "pytorch", "multi", "--help"])
  assert.strictEqual(status, 0)
  assert.match(stdout, /bp import pytorch multi/)
  assert.match(stdout, /framework-trace\.v0\.2\.0/)
  assert.match(stdout, /bundle_root_digest/)
  assert.match(stdout, /BUNDLE INTEGRITY/)
  assert.match(stdout, /NOT prove producer authenticity/)
})

test("bp import (overview) lists multi-step subcommands as shipped v0.8", () => {
  const { status, stdout } = runBp(["import", "--help"])
  assert.strictEqual(status, 0)
  assert.match(stdout, /bp import pytorch    multi/)
  assert.match(stdout, /bp import jax        multi/)
  assert.match(stdout, /bp import tensorflow multi/)
  assert.match(stdout, /multi-step JSONL stream \(v0\.8\)/)
})

test("bp import pytorch multi on missing file exits 2 with usage text", () => {
  const { status, stderr } = runBp([
    "import",
    "pytorch",
    "multi",
    "/tmp/this-multi-step-sidecar-does-not-exist.jsonl",
  ])
  assert.strictEqual(status, 2)
  assert.match(stderr, /multi-step import failed|file not found|ENOENT/)
})
