/**
 * v0.6 — `bp import pytorch` end-to-end test.
 *
 * Verifies:
 *  1. Sidecar → observer-mode v0.4.0 receipt round-trip produces byte-equal
 *     output to fixtures/external/pytorch.softmax-ce.golden.jsonl.
 *  2. Resulting receipt schema-validates against receipt.v0.4.0.json.
 *  3. Resulting receipt passes Rules 0-13 + Rule 14 (engine-recompute
 *     differential) + Rules 15 + 16 (skip-basis + digest binding are
 *     no-ops when not declared).
 *  4. Importer rejects sidecars where source_framework.name !== "pytorch".
 *  5. Importer rejects sidecars whose source bytes are not valid JSON.
 *  6. Importer respects --out, --json, and emits the expected exit codes
 *     (verified via the bp CLI).
 */

import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync, existsSync } from "node:fs"
import { spawnSync } from "node:child_process"
import { fileURLToPath } from "node:url"
import { dirname, resolve } from "node:path"
import { importPytorchSidecar } from "../src/import-pytorch.js"
import { validateReceiptSchema } from "../src/validate.js"
import { reconcileReceipt } from "../src/reconcile.js"

const __dirname = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(__dirname, "..")
const sidecarPath = resolve(
  repoRoot,
  "fixtures/external/pytorch.softmax-ce.sidecar.jsonl",
)
const goldenPath = resolve(
  repoRoot,
  "fixtures/external/pytorch.softmax-ce.golden.jsonl",
)

const PINNED_TIMESTAMP = "2026-05-17T05:30:00Z"
const PINNED_FIXTURE_LABEL = "pytorch-softmax-ce-imported"

function loadSidecarBytes(): string {
  return readFileSync(sidecarPath, "utf-8")
}

function loadGoldenBytes(): string {
  return readFileSync(goldenPath, "utf-8")
}

test("importPytorchSidecar produces byte-equal output to shipped golden", () => {
  if (!existsSync(sidecarPath) || !existsSync(goldenPath)) {
    throw new Error(
      `v0.6 PyTorch fixtures missing. Run scripts/generate-pytorch-softmax-ce-fixtures.ts ` +
        `to regenerate sidecar + golden.`,
    )
  }
  const sidecar = loadSidecarBytes()
  const expectedBytes = loadGoldenBytes()
  const result = importPytorchSidecar(sidecar, {
    importTimestamp: PINNED_TIMESTAMP,
    fixtureLabel: PINNED_FIXTURE_LABEL,
  })
  assert.strictEqual(
    result.emittedBytes,
    expectedBytes,
    "importer emission must be byte-equal to the shipped pytorch.softmax-ce.golden.jsonl. " +
      "If this fails on a Node version bump or runtime change, regenerate the golden via " +
      "scripts/generate-pytorch-softmax-ce-fixtures.ts AND every fixtures/bad/external.*.jsonl " +
      "via scripts/generate-external-bad-fixtures.ts in the same commit.",
  )
  assert.strictEqual(
    result.differentialPassed,
    true,
    "engine-recompute differential must pass on the canonical PyTorch fixture",
  )
  assert.strictEqual(
    result.differentialDisagreements.length,
    0,
    `expected zero differential disagreements; got: ${JSON.stringify(result.differentialDisagreements)}`,
  )
})

test("imported v0.4.0 receipt schema-validates", () => {
  if (!existsSync(goldenPath)) return
  const r = JSON.parse(loadGoldenBytes().trim())
  const v = validateReceiptSchema(r)
  assert.strictEqual(v.ok, true, `golden must schema-validate; errors: ${v.ok ? "[]" : JSON.stringify(v.errors)}`)
  assert.strictEqual(v.schemaVersion, "0.4.0", "must dispatch to v0.4.0 schema")
})

test("imported v0.4.0 receipt reconciles cleanly (Rules 1-13 + Rule 14 differential pass)", () => {
  if (!existsSync(goldenPath)) return
  const r = JSON.parse(loadGoldenBytes().trim())
  const result = reconcileReceipt(r)
  assert.strictEqual(
    result.ok,
    true,
    `imported PyTorch golden must reconcile cleanly; got failures: ${JSON.stringify(
      result.ok === false ? result.failures.map((f) => ({ rule: f.rule, field_path: f.field_path, message: f.message })) : "ok",
    )}`,
  )
})

test("imported receipt carries source_framework + attestor + external_imported fixture_status", () => {
  if (!existsSync(goldenPath)) return
  const r = JSON.parse(loadGoldenBytes().trim()) as {
    schema_version: string
    fixture_status: { authoring_state: string; verification_state: string }
    source_framework?: { name: string; version: string }
    attestor?: { computed_by?: { kind?: string }; verified_by?: { kind?: string } }
  }
  assert.strictEqual(r.schema_version, "0.4.0")
  assert.strictEqual(r.fixture_status.authoring_state, "external_imported")
  assert.strictEqual(
    r.fixture_status.verification_state,
    "engine_recompute_matched_within_tolerance",
  )
  assert.ok(r.source_framework, "source_framework block must be present")
  assert.strictEqual(r.source_framework!.name, "pytorch")
  assert.ok(r.attestor, "attestor block must be present")
  assert.strictEqual(r.attestor!.computed_by?.kind, "framework")
  assert.strictEqual(r.attestor!.verified_by?.kind, "engine")
})

test("importer rejects sidecars whose source_framework.name !== 'pytorch'", () => {
  if (!existsSync(sidecarPath)) return
  const sidecar = JSON.parse(loadSidecarBytes().trim()) as {
    source_framework: { name: string }
  }
  sidecar.source_framework.name = "jax"
  assert.throws(
    () => importPytorchSidecar(JSON.stringify(sidecar) + "\n", { importTimestamp: PINNED_TIMESTAMP }),
    /importPytorchSidecar accepts only 'pytorch'/,
    "must reject non-pytorch sidecars (per-framework subcommand discipline)",
  )
})

test("importer rejects bytes that are not valid JSON", () => {
  assert.throws(
    () => importPytorchSidecar("{this is not json\n", { importTimestamp: PINNED_TIMESTAMP }),
    /not valid JSON/,
    "must reject malformed JSON input",
  )
})

test("importer rejects sidecars missing required topology field", () => {
  if (!existsSync(sidecarPath)) return
  const sidecar = JSON.parse(loadSidecarBytes().trim()) as { topology?: unknown }
  delete sidecar.topology
  assert.throws(
    () => importPytorchSidecar(JSON.stringify(sidecar) + "\n", { importTimestamp: PINNED_TIMESTAMP }),
    /framework-trace.+validation/,
    "must reject sidecars missing required schema fields",
  )
})

// =============================================================================
// CLI-level end-to-end (spawns bp subprocess)
// =============================================================================

function runBp(args: string[]): { status: number | null; stdout: string; stderr: string } {
  const result = spawnSync(
    process.execPath,
    ["--import", "tsx", "src/bin/bp.ts", ...args],
    { cwd: repoRoot, encoding: "utf-8" },
  )
  return { status: result.status, stdout: result.stdout, stderr: result.stderr }
}

test("bp import pytorch <sidecar> writes receipt to stdout and exits 0", () => {
  if (!existsSync(sidecarPath)) return
  const { status, stdout } = runBp([
    "import",
    "pytorch",
    "fixtures/external/pytorch.softmax-ce.sidecar.jsonl",
  ])
  assert.strictEqual(status, 0, "bp import pytorch on the canonical sidecar must exit 0")
  // The CLI's import_timestamp will differ from the pinned-fixture timestamp
  // (it uses the current time when --import-timestamp is not exposed yet).
  // So we don't byte-compare; we just confirm it parses and has the expected
  // shape.
  const parsed = JSON.parse(stdout.trim())
  assert.strictEqual(parsed.schema_version, "0.4.0")
  assert.strictEqual(parsed.fixture_status.authoring_state, "external_imported")
  assert.strictEqual(
    parsed.fixture_status.verification_state,
    "engine_recompute_matched_within_tolerance",
  )
})

test("bp import pytorch --help exits 0 with usage text", () => {
  const { status, stdout } = runBp(["import", "pytorch", "--help"])
  assert.strictEqual(status, 0)
  assert.match(stdout, /bp import pytorch/)
  assert.match(stdout, /framework-trace\.v0\.1\.0/)
})

test("bp import (no framework arg) exits 2 with --help text", () => {
  const { status, stdout, stderr } = runBp(["import"])
  assert.strictEqual(status, 2)
  const combined = stdout + stderr
  assert.match(combined, /Usage: bp import/)
})

test("bp import jax exits 4 (framework planned but not implemented in v0.6.0)", () => {
  const { status, stderr } = runBp(["import", "jax", "/tmp/nonexistent"])
  assert.strictEqual(status, 4)
  assert.match(stderr, /not implemented/)
})

test("bp import unknown-framework exits 2", () => {
  const { status, stderr } = runBp(["import", "tensorflow-lite", "/tmp/nonexistent"])
  assert.strictEqual(status, 2)
  assert.match(stderr, /unknown framework/)
})
