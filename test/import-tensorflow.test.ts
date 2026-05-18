/**
 * v0.7.0 — `bp import tensorflow` end-to-end test.
 *
 * Mirrors test/import-pytorch.test.ts and test/import-jax.test.ts. The
 * v0.7.0 pressure test: does the v0.6 framework-trace pattern generalize
 * to a THIRD adapter without trust-model drift, schema drift, or new
 * rules? This test plate proves yes.
 *
 *  1. Sidecar → observer-mode v0.4.0 receipt round-trip produces byte-equal
 *     output to fixtures/external/tensorflow.softmax-ce.golden.jsonl.
 *  2. Resulting receipt schema-validates against receipt.v0.4.0.json.
 *  3. Resulting receipt passes Rules 0-13 + Rule 14 differential.
 *  4. Importer rejects sidecars where source_framework.name !== "tensorflow".
 *  5. importTensorflowSidecar, importJaxSidecar, importPytorchSidecar
 *     all refuse each other's sidecars (per-framework subcommand
 *     discipline at the library layer; three-way refusal matrix).
 *  6. CLI `bp import tensorflow <sidecar>` works end-to-end with the
 *     TF golden.
 *  7. `bp import tensorflow --help` exits 0 with TF-specific authoring
 *     notes (variable-list-order, BatchNorm non-trainable warning,
 *     tape persistence, graph-vs-eager).
 *  8. `bp import` overview help lists tensorflow as "shipped v0.7.0".
 */

import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync, existsSync } from "node:fs"
import { spawnSync } from "node:child_process"
import { fileURLToPath } from "node:url"
import { dirname, resolve } from "node:path"
import { importTensorflowSidecar } from "../src/import-tensorflow.js"
import { importJaxSidecar } from "../src/import-jax.js"
import { importPytorchSidecar } from "../src/import-pytorch.js"
import { validateReceiptSchema } from "../src/validate.js"
import { reconcileReceipt } from "../src/reconcile.js"

const __dirname = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(__dirname, "..")
const tfSidecarPath = resolve(
  repoRoot,
  "fixtures/external/tensorflow.softmax-ce.sidecar.jsonl",
)
const tfGoldenPath = resolve(
  repoRoot,
  "fixtures/external/tensorflow.softmax-ce.golden.jsonl",
)
const jaxSidecarPath = resolve(
  repoRoot,
  "fixtures/external/jax.softmax-ce.sidecar.jsonl",
)
const pytorchSidecarPath = resolve(
  repoRoot,
  "fixtures/external/pytorch.softmax-ce.sidecar.jsonl",
)

const PINNED_TIMESTAMP = "2026-05-17T08:00:00Z"
const PINNED_FIXTURE_LABEL = "tensorflow-softmax-ce-imported"

test("importTensorflowSidecar produces byte-equal output to shipped TensorFlow golden", () => {
  if (!existsSync(tfSidecarPath) || !existsSync(tfGoldenPath)) {
    throw new Error(
      `v0.7.0 TensorFlow fixtures missing. Run scripts/generate-tensorflow-softmax-ce-fixtures.ts ` +
        `to regenerate sidecar + golden.`,
    )
  }
  const sidecar = readFileSync(tfSidecarPath, "utf-8")
  const expectedBytes = readFileSync(tfGoldenPath, "utf-8")
  const result = importTensorflowSidecar(sidecar, {
    importTimestamp: PINNED_TIMESTAMP,
    fixtureLabel: PINNED_FIXTURE_LABEL,
  })
  assert.strictEqual(
    result.emittedBytes,
    expectedBytes,
    "importTensorflowSidecar emission must be byte-equal to fixtures/external/tensorflow.softmax-ce.golden.jsonl",
  )
  assert.strictEqual(result.differentialPassed, true)
  assert.strictEqual(result.differentialDisagreements.length, 0)
})

test("TensorFlow observer-mode receipt schema-validates against v0.4.0", () => {
  if (!existsSync(tfGoldenPath)) return
  const r = JSON.parse(readFileSync(tfGoldenPath, "utf-8").trim())
  const v = validateReceiptSchema(r)
  assert.strictEqual(
    v.ok,
    true,
    `TensorFlow golden must schema-validate; errors: ${v.ok ? "[]" : JSON.stringify(v.errors)}`,
  )
  assert.strictEqual(v.schemaVersion, "0.4.0")
})

test("TensorFlow observer-mode receipt reconciles cleanly (Rules 1-14 pass)", () => {
  if (!existsSync(tfGoldenPath)) return
  const r = JSON.parse(readFileSync(tfGoldenPath, "utf-8").trim())
  const result = reconcileReceipt(r)
  assert.strictEqual(
    result.ok,
    true,
    `TensorFlow golden must reconcile cleanly; got failures: ${JSON.stringify(
      result.ok === false
        ? result.failures.map((f) => ({
            rule: f.rule,
            field_path: f.field_path,
            message: f.message,
          }))
        : "ok",
    )}`,
  )
})

test("TensorFlow receipt carries source_framework.name === 'tensorflow' + correct attestor identities", () => {
  if (!existsSync(tfGoldenPath)) return
  const r = JSON.parse(readFileSync(tfGoldenPath, "utf-8").trim()) as {
    source_framework?: { name: string; extractor?: { name: string } }
    attestor?: { computed_by?: { identity?: string } }
  }
  assert.strictEqual(r.source_framework?.name, "tensorflow")
  assert.match(
    r.source_framework?.extractor?.name ?? "",
    /^bp-import-tensorflow/,
  )
  assert.match(r.attestor?.computed_by?.identity ?? "", /^tensorflow@/)
})

// =============================================================================
// Per-framework subcommand discipline at the library layer (3-way matrix)
// =============================================================================

test("importTensorflowSidecar rejects sidecars where source_framework.name !== 'tensorflow'", () => {
  if (!existsSync(pytorchSidecarPath) || !existsSync(jaxSidecarPath)) return
  const pytorchSidecar = readFileSync(pytorchSidecarPath, "utf-8")
  const jaxSidecar = readFileSync(jaxSidecarPath, "utf-8")
  assert.throws(
    () =>
      importTensorflowSidecar(pytorchSidecar, {
        importTimestamp: PINNED_TIMESTAMP,
      }),
    /importTensorflowSidecar accepts only 'tensorflow'/,
    "importTensorflowSidecar must refuse a PyTorch sidecar (per-framework discipline)",
  )
  assert.throws(
    () =>
      importTensorflowSidecar(jaxSidecar, {
        importTimestamp: PINNED_TIMESTAMP,
      }),
    /importTensorflowSidecar accepts only 'tensorflow'/,
    "importTensorflowSidecar must refuse a JAX sidecar (per-framework discipline)",
  )
})

test("importPytorchSidecar + importJaxSidecar reject TensorFlow sidecars (symmetric refusal)", () => {
  if (!existsSync(tfSidecarPath)) return
  const tfSidecar = readFileSync(tfSidecarPath, "utf-8")
  assert.throws(
    () =>
      importPytorchSidecar(tfSidecar, { importTimestamp: PINNED_TIMESTAMP }),
    /importPytorchSidecar accepts only 'pytorch'/,
    "importPytorchSidecar must refuse a TensorFlow sidecar",
  )
  assert.throws(
    () => importJaxSidecar(tfSidecar, { importTimestamp: PINNED_TIMESTAMP }),
    /importJaxSidecar accepts only 'jax'/,
    "importJaxSidecar must refuse a TensorFlow sidecar",
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

test("bp import tensorflow <sidecar> writes receipt to stdout and exits 0", () => {
  if (!existsSync(tfSidecarPath)) return
  const { status, stdout } = runBp([
    "import",
    "tensorflow",
    "fixtures/external/tensorflow.softmax-ce.sidecar.jsonl",
  ])
  assert.strictEqual(
    status,
    0,
    "bp import tensorflow on the canonical TF sidecar must exit 0",
  )
  const parsed = JSON.parse(stdout.trim())
  assert.strictEqual(parsed.schema_version, "0.4.0")
  assert.strictEqual(parsed.fixture_status.authoring_state, "external_imported")
  assert.strictEqual(parsed.source_framework.name, "tensorflow")
})

test("bp import tensorflow --help exits 0 with TF-specific authoring notes", () => {
  const { status, stdout } = runBp(["import", "tensorflow", "--help"])
  assert.strictEqual(status, 0)
  assert.match(stdout, /bp import tensorflow/)
  assert.match(stdout, /framework-trace\.v0\.1\.0/)
  // Confirm the TF-distinctive authoring notes are present (variable list
  // ordering, BatchNorm non-trainable, tape persistence, eager-vs-graph).
  assert.match(stdout, /trainable_variables/)
  assert.match(stdout, /BatchNorm/)
  assert.match(stdout, /GradientTape/)
})

test("bp import (overview) includes tensorflow row as shipped v0.7.0", () => {
  const { status, stdout } = runBp(["import", "--help"])
  assert.strictEqual(status, 0)
  assert.match(stdout, /bp import tensorflow/)
  assert.match(stdout, /shipped v0\.7\.0/)
})

test("bp import tensorflow on a PyTorch sidecar exits 2 (per-framework discipline)", () => {
  if (!existsSync(pytorchSidecarPath)) return
  const { status, stderr } = runBp([
    "import",
    "tensorflow",
    "fixtures/external/pytorch.softmax-ce.sidecar.jsonl",
  ])
  assert.strictEqual(
    status,
    2,
    "bp import tensorflow on a pytorch sidecar must exit 2",
  )
  assert.match(stderr, /accepts only 'tensorflow'/)
})

test("bp import tensorflow on a JAX sidecar exits 2 (per-framework discipline)", () => {
  if (!existsSync(jaxSidecarPath)) return
  const { status, stderr } = runBp([
    "import",
    "tensorflow",
    "fixtures/external/jax.softmax-ce.sidecar.jsonl",
  ])
  assert.strictEqual(
    status,
    2,
    "bp import tensorflow on a jax sidecar must exit 2",
  )
  assert.match(stderr, /accepts only 'tensorflow'/)
})
