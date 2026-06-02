/**
 * Input schema test (v0.4.0 topology-input.v0.4.0.json) — assert the schema
 * rejects receipt-only fields and pins the required-field set.
 *
 * This is the canonical-emission trust-leakage gate from consolidator-decision
 * §7 risk 1: authored bytes must NEVER become receipt bytes. The schema's
 * `additionalProperties: false` over the input shape, combined with the
 * absence of receipt-only field names (forward, loss, updates, etc.) from
 * its `properties` block, is what enforces that.
 *
 * Uses Ajv directly (not the library's validateTopologyInput function,
 * which may not yet be exported by Library agent). Reads the schema file
 * directly from schemas/topology-input.v0.4.0.json.
 *
 * Strategy:
 *   - Build a minimal valid input from XOR_INPUT (which conforms to the
 *     v0.4 input schema; the engine's existing XOR fixture serves as the
 *     anchor positive case).
 *   - Mutate one field at a time and assert the schema rejects each
 *     mutation per the §7 risk 1 contract.
 *
 * G-025 de-vacuum: schemas/topology-input.v0.4.0.json and src/mazur.ts's
 * XOR_INPUT export are both shipped. The earlier per-test existsSync /
 * import-failure skips never fired, so they masked a missing-resource
 * regression instead of failing it. Both fixtures are now loaded ONCE at
 * module scope and asserted present; a genuinely missing resource fails the
 * whole file loudly at load rather than silently green-skipping every test.
 */

import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync, existsSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { dirname, resolve } from "node:path"
import Ajv2020 from "ajv/dist/2020.js"

const __dirname = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(__dirname, "..")
const schemaPath = resolve(repoRoot, "schemas/topology-input.v0.4.0.json")

type ValidateFn = (data: unknown) => boolean

interface ValidatorWithErrors {
  (data: unknown): boolean
  errors?: Array<{ keyword: string; instancePath: string; message?: string; params?: unknown }> | null
}

function loadSchemaValidator(): ValidateFn {
  // G-025: assert the shipped schema is present rather than skip on absence.
  assert.ok(
    existsSync(schemaPath),
    `schemas/topology-input.v0.4.0.json must be present (shipped package surface); ` +
      `looked at ${schemaPath}`,
  )
  const raw = readFileSync(schemaPath, "utf-8")
  const schema = JSON.parse(raw) as Record<string, unknown>
  // Strip vendor x-* annotations the Ajv strict mode doesn't recognize.
  const stripped: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(schema)) {
    if (k.startsWith("x-")) continue
    stripped[k] = v
  }
  // Also strip x-* from nested $defs and properties (best-effort). Ajv's
  // strict mode complains about unknown keywords at every level; the
  // simplest portable strategy is to disable strict mode here since the
  // schema is shipped as part of the package surface and is the source of
  // truth for input shape.
  const ajv = new Ajv2020.default({ strict: false, allErrors: true })
  const validate = ajv.compile(stripped)
  return validate as unknown as ValidateFn
}

// G-025: XOR_INPUT is a shipped export of src/mazur.ts; import it once at
// module scope. A failed import is a real regression and must throw (fail
// the file) rather than green-skip every test below.
const { XOR_INPUT } = (await import("../src/mazur.js")) as { XOR_INPUT: unknown }

function getMinimalValidInput(): unknown {
  // Round-trip through JSON to drop readonly type tags + match what an
  // authored input file would carry on the wire.
  return JSON.parse(JSON.stringify(XOR_INPUT))
}

// Compile the validator once — every test reuses it. The compile asserts
// the schema file's presence (see loadSchemaValidator).
const validate = loadSchemaValidator()

test("topology-input.v0.4.0 schema accepts a minimal valid input (XOR_INPUT)", () => {
  const input = getMinimalValidInput()
  const ok = validate(input)
  if (!ok) {
    const errors = (validate as ValidatorWithErrors).errors
    assert.fail(
      `XOR_INPUT must validate against topology-input.v0.4.0.json; ` +
        `Ajv errors: ${JSON.stringify(errors, null, 2)}`,
    )
  }
})

test("topology-input.v0.4.0 schema rejects missing topology field", () => {
  const input = getMinimalValidInput()
  const mutated = { ...(input as Record<string, unknown>) }
  delete mutated["topology"]
  const ok = validate(mutated)
  assert.strictEqual(ok, false, "schema must reject input missing 'topology'")
  const errors = (validate as ValidatorWithErrors).errors ?? []
  assert.ok(
    errors.some((e) => e.keyword === "required"),
    `expected a required-keyword error; got: ${JSON.stringify(errors, null, 2)}`,
  )
})

test("topology-input.v0.4.0 schema rejects missing topology.unit_order field", () => {
  const input = getMinimalValidInput()
  const mutated = JSON.parse(JSON.stringify(input)) as Record<string, unknown>
  const topology = mutated["topology"] as Record<string, unknown>
  delete topology["unit_order"]
  const ok = validate(mutated)
  assert.strictEqual(ok, false, "schema must reject topology missing 'unit_order'")
  const errors = (validate as ValidatorWithErrors).errors ?? []
  assert.ok(
    errors.some((e) => e.keyword === "required"),
    `expected a required-keyword error on topology.unit_order; ` +
      `got: ${JSON.stringify(errors, null, 2)}`,
  )
})

// One assertion per receipt-only top-level field that MUST be rejected.
// This is the canonical-emission trust-leakage gate (§7 risk 1).
const RECEIPT_ONLY_FIELDS = [
  "forward",
  "loss",
  "updates",
  "parameters_after",
  "fixture_status",
] as const

for (const field of RECEIPT_ONLY_FIELDS) {
  test(`topology-input.v0.4.0 schema rejects receipt-only field '${field}' at top level`, () => {
    const input = getMinimalValidInput()
    const mutated = { ...(input as Record<string, unknown>) }
    // Inject a placeholder value — exact value doesn't matter; the schema
    // must reject ANY value at this key per additionalProperties: false.
    mutated[field] = field === "fixture_status" ? { canonical: true } : {}
    const ok = validate(mutated)
    assert.strictEqual(
      ok,
      false,
      `schema MUST reject input carrying receipt-only field '${field}' ` +
        `(canonical-emission trust-leakage gate from §7 risk 1)`,
    )
    const errors = (validate as ValidatorWithErrors).errors ?? []
    assert.ok(
      errors.some(
        (e) =>
          e.keyword === "additionalProperties" ||
          e.keyword === "unevaluatedProperties" ||
          (typeof e.message === "string" && e.message.toLowerCase().includes(field)),
      ),
      `expected an additionalProperties error naming '${field}'; ` +
        `got: ${JSON.stringify(errors, null, 2)}`,
    )
  })
}

test("topology-input.v0.4.0 schema rejects invalid trace_id (not 32-char hex)", () => {
  const input = getMinimalValidInput()
  const mutated = { ...(input as Record<string, unknown>) }
  mutated["trace_id"] = "not-a-valid-trace-id"
  mutated["step_index"] = 0
  const ok = validate(mutated)
  assert.strictEqual(ok, false, "schema must reject non-hex trace_id")
  const errors = (validate as ValidatorWithErrors).errors ?? []
  assert.ok(
    errors.some(
      (e) => e.keyword === "pattern" && e.instancePath.includes("trace_id"),
    ),
    `expected a pattern-keyword error on trace_id; got: ${JSON.stringify(errors, null, 2)}`,
  )
})

test("topology-input.v0.4.0 schema rejects trace_id without step_index (presence-coupling)", () => {
  const input = getMinimalValidInput()
  const mutated = { ...(input as Record<string, unknown>) }
  // Valid 32-char hex but no step_index -- multi-step presence-coupling
  // must fail.
  mutated["trace_id"] = "0123456789abcdef0123456789abcdef"
  delete mutated["step_index"]
  const ok = validate(mutated)
  assert.strictEqual(
    ok,
    false,
    "schema must reject trace_id without step_index (presence-coupling per §multi-step)",
  )
})
