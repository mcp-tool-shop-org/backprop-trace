/**
 * v0.6.1 — `bp import jax` end-to-end test.
 *
 * Mirrors test/import-pytorch.test.ts. Verifies that v0.6.0's PyTorch
 * pattern generalizes to JAX without trust-model drift:
 *
 *  1. Sidecar → observer-mode v0.4.0 receipt round-trip produces byte-equal
 *     output to fixtures/external/jax.softmax-ce.golden.jsonl.
 *  2. Resulting receipt schema-validates against receipt.v0.4.0.json.
 *  3. Resulting receipt passes Rules 0-13 + Rule 14 differential.
 *  4. Importer rejects sidecars where source_framework.name !== "jax".
 *  5. importJaxSidecar and importPytorchSidecar refuse each other's
 *     sidecars (per-framework subcommand discipline at the library layer).
 *  6. CLI `bp import jax <sidecar>` works end-to-end with the JAX golden.
 */

import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync, existsSync } from "node:fs"
import { spawnSync } from "node:child_process"
import { fileURLToPath } from "node:url"
import { dirname, resolve } from "node:path"
import { importJaxSidecar } from "../src/import-jax.js"
import { importPytorchSidecar } from "../src/import-pytorch.js"
import { validateReceiptSchema } from "../src/validate.js"
import { reconcileReceipt } from "../src/reconcile.js"

const __dirname = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(__dirname, "..")
const jaxSidecarPath = resolve(
  repoRoot,
  "fixtures/external/jax.softmax-ce.sidecar.jsonl",
)
const jaxGoldenPath = resolve(
  repoRoot,
  "fixtures/external/jax.softmax-ce.golden.jsonl",
)
const pytorchSidecarPath = resolve(
  repoRoot,
  "fixtures/external/pytorch.softmax-ce.sidecar.jsonl",
)

const PINNED_TIMESTAMP = "2026-05-17T06:45:00Z"
const PINNED_FIXTURE_LABEL = "jax-softmax-ce-imported"

test("importJaxSidecar produces byte-equal output to shipped JAX golden", () => {
  if (!existsSync(jaxSidecarPath) || !existsSync(jaxGoldenPath)) {
    throw new Error(
      `v0.6.1 JAX fixtures missing. Run scripts/generate-jax-softmax-ce-fixtures.ts ` +
        `to regenerate sidecar + golden.`,
    )
  }
  const sidecar = readFileSync(jaxSidecarPath, "utf-8")
  const expectedBytes = readFileSync(jaxGoldenPath, "utf-8")
  const result = importJaxSidecar(sidecar, {
    importTimestamp: PINNED_TIMESTAMP,
    fixtureLabel: PINNED_FIXTURE_LABEL,
  })
  assert.strictEqual(
    result.emittedBytes,
    expectedBytes,
    "importJaxSidecar emission must be byte-equal to fixtures/external/jax.softmax-ce.golden.jsonl",
  )
  assert.strictEqual(result.differentialPassed, true)
  assert.strictEqual(result.differentialDisagreements.length, 0)
})

test("JAX observer-mode receipt schema-validates against v0.4.0", () => {
  if (!existsSync(jaxGoldenPath)) return
  const r = JSON.parse(readFileSync(jaxGoldenPath, "utf-8").trim())
  const v = validateReceiptSchema(r)
  assert.strictEqual(v.ok, true, `JAX golden must schema-validate; errors: ${v.ok ? "[]" : JSON.stringify(v.errors)}`)
  assert.strictEqual(v.schemaVersion, "0.4.0")
})

test("JAX observer-mode receipt reconciles cleanly (Rules 1-14 pass)", () => {
  if (!existsSync(jaxGoldenPath)) return
  const r = JSON.parse(readFileSync(jaxGoldenPath, "utf-8").trim())
  const result = reconcileReceipt(r)
  assert.strictEqual(
    result.ok,
    true,
    `JAX golden must reconcile cleanly; got failures: ${JSON.stringify(
      result.ok === false ? result.failures.map((f) => ({ rule: f.rule, field_path: f.field_path, message: f.message })) : "ok",
    )}`,
  )
})

test("JAX receipt carries source_framework.name === 'jax' + correct attestor identities", () => {
  if (!existsSync(jaxGoldenPath)) return
  const r = JSON.parse(readFileSync(jaxGoldenPath, "utf-8").trim()) as {
    source_framework?: { name: string; extractor?: { name: string } }
    attestor?: { computed_by?: { identity?: string } }
  }
  assert.strictEqual(r.source_framework?.name, "jax")
  assert.match(r.source_framework?.extractor?.name ?? "", /^bp-import-jax/)
  assert.match(r.attestor?.computed_by?.identity ?? "", /^jax@/)
})

// =============================================================================
// Per-framework subcommand discipline at the library layer
// =============================================================================

test("importJaxSidecar rejects sidecars where source_framework.name !== 'jax'", () => {
  if (!existsSync(pytorchSidecarPath)) return
  const pytorchSidecar = readFileSync(pytorchSidecarPath, "utf-8")
  assert.throws(
    () => importJaxSidecar(pytorchSidecar, { importTimestamp: PINNED_TIMESTAMP }),
    /importJaxSidecar accepts only 'jax'/,
    "importJaxSidecar must refuse a PyTorch sidecar (per-framework subcommand discipline)",
  )
})

test("importPytorchSidecar rejects sidecars where source_framework.name !== 'pytorch'", () => {
  if (!existsSync(jaxSidecarPath)) return
  const jaxSidecar = readFileSync(jaxSidecarPath, "utf-8")
  assert.throws(
    () => importPytorchSidecar(jaxSidecar, { importTimestamp: PINNED_TIMESTAMP }),
    /importPytorchSidecar accepts only 'pytorch'/,
    "importPytorchSidecar must refuse a JAX sidecar (per-framework subcommand discipline)",
  )
})

// =============================================================================
// CLI end-to-end
// =============================================================================

function runBp(args: string[]): { status: number | null; stdout: string; stderr: string } {
  const result = spawnSync(
    process.execPath,
    ["--import", "tsx", "src/bin/bp.ts", ...args],
    { cwd: repoRoot, encoding: "utf-8" },
  )
  return { status: result.status, stdout: result.stdout, stderr: result.stderr }
}

test("bp import jax <sidecar> writes receipt to stdout and exits 0", () => {
  if (!existsSync(jaxSidecarPath)) return
  const { status, stdout } = runBp([
    "import",
    "jax",
    "fixtures/external/jax.softmax-ce.sidecar.jsonl",
  ])
  assert.strictEqual(status, 0, "bp import jax on the canonical JAX sidecar must exit 0")
  const parsed = JSON.parse(stdout.trim())
  assert.strictEqual(parsed.schema_version, "0.4.0")
  assert.strictEqual(parsed.fixture_status.authoring_state, "external_imported")
  assert.strictEqual(parsed.source_framework.name, "jax")
})

test("bp import jax --help exits 0 with usage text", () => {
  const { status, stdout } = runBp(["import", "jax", "--help"])
  assert.strictEqual(status, 0)
  assert.match(stdout, /bp import jax/)
  assert.match(stdout, /framework-trace\.v0\.1\.0/)
  assert.match(stdout, /jax\.tree_util\.tree_flatten/)
})

test("bp import (overview) includes jax row", () => {
  const { status, stdout } = runBp(["import", "--help"])
  assert.strictEqual(status, 0)
  assert.match(stdout, /bp import jax/)
  // v0.8 reformatted the overview as "single-step (v0.6.1)" / "multi-step
  // (v0.8)" rows. The shipped-version marker for jax single-step changed
  // from "shipped v0.6.1" to "single-step (v0.6.1)".
  assert.match(stdout, /single-step \(v0\.6\.1\)/)
})

test("bp import jax on a PyTorch sidecar exits 2 (per-framework discipline)", () => {
  if (!existsSync(pytorchSidecarPath)) return
  const { status, stderr } = runBp([
    "import",
    "jax",
    "fixtures/external/pytorch.softmax-ce.sidecar.jsonl",
  ])
  assert.strictEqual(status, 2, "bp import jax on a pytorch sidecar must exit 2")
  assert.match(stderr, /accepts only 'jax'/)
})

// v0.7.0 shipped TensorFlow — the previously-stub `bp import tensorflow`
// is now wired (see test/import-tensorflow.test.ts). Removed the v0.6.1-
// era assertion that TF returns exit 4; that no longer holds.
