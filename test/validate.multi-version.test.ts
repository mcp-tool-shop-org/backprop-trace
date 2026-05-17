/**
 * validateReceiptSchema multi-version dispatch tests.
 *
 * Pins v0.3's dispatch contract (memo §1 + src/validate.ts pickSchemaVersion):
 *   - A receipt with schema_version "0.1.0" routes to the v0.1.0 schema.
 *   - A receipt with schema_version "0.2.0" routes to the v0.2.0 schema.
 *   - A malformed v0.1.0 receipt fails against the v0.1.0 schema (errors
 *     reference v0.1.0 in `schemaVersion`).
 *   - A receipt with an unrecognized schema_version (e.g. "0.99.0") falls
 *     through to the default (v0.2.0) per the documented contract — and
 *     since the input lacks the v0.2.0 required fields, validation fails
 *     against v0.2.0 (which is the right diagnostic surface).
 *   - opts.version forces a specific schema regardless of the receipt's
 *     own schema_version.
 *
 * The XOR golden (v0.2.0) is gated on Fixtures agent landing — if absent,
 * those tests skip. The Mazur golden (v0.1.0) is always present.
 */

import { test } from "node:test"
import assert from "node:assert/strict"
import { existsSync, readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { dirname, resolve } from "node:path"
import { validateReceiptSchema } from "../src/validate.js"

const __dirname = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(__dirname, "..")
const mazurGoldenPath = resolve(repoRoot, "fixtures/mazur.golden.jsonl")
const xorGoldenPath = resolve(repoRoot, "fixtures/xor.golden.jsonl")

function loadMazurGolden(): Record<string, unknown> {
  return JSON.parse(readFileSync(mazurGoldenPath, "utf-8")) as Record<string, unknown>
}

function loadXorGoldenIfPresent(): Record<string, unknown> | undefined {
  if (!existsSync(xorGoldenPath)) return undefined
  return JSON.parse(readFileSync(xorGoldenPath, "utf-8").trim()) as Record<
    string,
    unknown
  >
}

test("validateReceiptSchema(mazur golden) dispatches to v0.1.0 and passes", () => {
  const golden = loadMazurGolden()
  const result = validateReceiptSchema(golden)
  assert.strictEqual(
    result.ok,
    true,
    `mazur golden must validate; errors: ${
      result.ok ? "[]" : JSON.stringify(result.errors)
    }`,
  )
  assert.strictEqual(
    result.schemaVersion,
    "0.1.0",
    "dispatcher must route to v0.1.0 based on receipt's own schema_version",
  )
})

test("validateReceiptSchema(xor golden) dispatches to v0.2.0 and passes", { skip: !existsSync(xorGoldenPath) }, () => {
  const golden = loadXorGoldenIfPresent()
  if (!golden) return
  const result = validateReceiptSchema(golden)
  assert.strictEqual(
    result.ok,
    true,
    `XOR golden must validate against v0.2.0; errors: ${
      result.ok ? "[]" : JSON.stringify(result.errors)
    }`,
  )
  assert.strictEqual(
    result.schemaVersion,
    "0.2.0",
    "dispatcher must route to v0.2.0 based on receipt's own schema_version",
  )
})

test("validateReceiptSchema rejects a malformed v0.1.0 receipt and reports schemaVersion='0.1.0'", () => {
  const golden = loadMazurGolden()
  // Delete a required field to drive a clean failure against the v0.1.0
  // schema. We confirm the failure path AND the schemaVersion field
  // accurately tags which schema produced the diagnostic — load-bearing
  // for CLI rendering ("validation failed against v0.1.0: ...").
  delete golden.fixture_status
  const result = validateReceiptSchema(golden)
  assert.strictEqual(result.ok, false, "malformed receipt must fail")
  assert.strictEqual(
    result.schemaVersion,
    "0.1.0",
    "schemaVersion must record the dispatched schema even on failure",
  )
})

test("validateReceiptSchema with unrecognized schema_version falls through to default and the resulting validation likely fails", () => {
  // Take the Mazur golden — structurally a v0.1.0 receipt — and mutate
  // its schema_version to a value not in SCHEMA_VERSIONS. Dispatcher
  // falls through to v0.2.0 (the documented default). v0.1.0 shape
  // does NOT satisfy v0.2.0's required-fields contract, so validation
  // is expected to fail. The test pins "falls through to v0.2.0" + the
  // observable fail/pass behavior on this specific input.
  const golden = loadMazurGolden() as { schema_version: string }
  golden.schema_version = "0.99.0"
  const result = validateReceiptSchema(golden)
  assert.strictEqual(
    result.schemaVersion,
    "0.2.0",
    "unknown schema_version must fall through to v0.2.0 default",
  )
  // A v0.1.0-shaped receipt almost certainly fails v0.2.0's required
  // fields (no unit_order, parameter_order, etc.). We assert .ok === false
  // — if the schemas converge sufficiently in a future revision that this
  // passes, that's an interesting signal and the test should be updated
  // with a more deliberate failure-inducing mutation.
  assert.strictEqual(
    result.ok,
    false,
    "v0.1.0-shaped receipt with rebranded schema_version='0.99.0' must fail v0.2.0 validation " +
      "(missing v0.2.0 required fields like unit_order / parameter_order)",
  )
})

test("validateReceiptSchema with opts.version='0.1.0' forces v0.1.0 dispatch regardless of receipt's own schema_version", () => {
  const golden = loadMazurGolden()
  // Override should pin dispatch to v0.1.0 even if we set the receipt's
  // schema_version to something else; the receipt is still structurally
  // valid against v0.1.0.
  ;(golden as { schema_version: string }).schema_version = "0.2.0"
  const result = validateReceiptSchema(golden, { version: "0.1.0" })
  assert.strictEqual(
    result.schemaVersion,
    "0.1.0",
    "opts.version must win over receipt.schema_version",
  )
  // Validation may pass or fail depending on whether the v0.1.0 schema
  // accepts schema_version: "0.2.0" — that's the const enforcement.
  // Pin schemaVersion only; don't pin ok.
})
