/**
 * FT-F-001 validateReceiptSchema tests.
 *
 * Pins the Ajv 2020-12 validator's behavior on the golden, on null, and
 * on deliberately malformed clones of the golden:
 *   - missing required field          -> ok:false with a schemaPath
 *   - wrong-typed numeric_policy.tolerance (schema pins const: 1e-9)
 *   - extra field (additionalProperties: false at root)
 *   - wrong enum on topology.activation
 *   - validateReceiptOrThrow surfaces a Hint message
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import {
  validateReceiptSchema,
  validateReceiptOrThrow,
} from "../src/validate.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const goldenPath = resolve(__dirname, "../fixtures/mazur.golden.jsonl");

function loadGolden(): Record<string, unknown> {
  return JSON.parse(readFileSync(goldenPath, "utf-8")) as Record<
    string,
    unknown
  >;
}

test("validateReceiptSchema accepts the golden receipt", () => {
  const golden = loadGolden();
  const result = validateReceiptSchema(golden);
  assert.strictEqual(
    result.ok,
    true,
    `golden receipt must validate; errors: ${
      result.ok ? "[]" : JSON.stringify(result.errors)
    }`,
  );
});

test("validateReceiptSchema rejects null", () => {
  const result = validateReceiptSchema(null);
  assert.strictEqual(result.ok, false, "null must not validate");
  if (result.ok) return;
  assert.ok(result.errors.length >= 1, "errors[] must be non-empty");
  // Sanity-check the error shape — schemaPath/message strings.
  const err = result.errors[0]!;
  assert.strictEqual(
    typeof err.schemaPath,
    "string",
    "error.schemaPath is a string",
  );
  assert.strictEqual(typeof err.message, "string", "error.message is a string");
});

test("validateReceiptSchema rejects missing required field (deletes fixture_status)", () => {
  const golden = loadGolden();
  delete golden.fixture_status;
  const result = validateReceiptSchema(golden);
  assert.strictEqual(
    result.ok,
    false,
    "missing required field must not validate",
  );
  if (result.ok) return;
  const requiredErr = result.errors.find(
    (e) => e.keyword === "required",
  );
  assert.ok(
    requiredErr,
    `expected a 'required' keyword error; got: ${JSON.stringify(result.errors)}`,
  );
  // schemaPath must point at the root's required-keyword check.
  assert.match(
    requiredErr.schemaPath,
    /required/,
    `schemaPath should reference required keyword; got: ${requiredErr.schemaPath}`,
  );
});

test("validateReceiptSchema rejects wrong-typed numeric_policy.tolerance (schema pins const: 1e-9)", () => {
  const golden = loadGolden();
  // The schema declares tolerance as `const: 1e-9`. Setting it to 1e-5
  // is a const violation even though the value is still numeric.
  const np = golden.numeric_policy as { tolerance: number };
  np.tolerance = 1e-5;
  const result = validateReceiptSchema(golden);
  assert.strictEqual(
    result.ok,
    false,
    "non-1e-9 tolerance must not validate (const enforcement)",
  );
});

test("validateReceiptSchema rejects extra root field (additionalProperties: false)", () => {
  const golden = loadGolden();
  (golden as Record<string, unknown>).extra_field = "oops";
  const result = validateReceiptSchema(golden);
  assert.strictEqual(
    result.ok,
    false,
    "extra field at root must not validate (additionalProperties: false)",
  );
  if (result.ok) return;
  const addlErr = result.errors.find(
    (e) => e.keyword === "additionalProperties",
  );
  assert.ok(
    addlErr,
    `expected an 'additionalProperties' error; got: ${JSON.stringify(result.errors)}`,
  );
});

test("validateReceiptSchema rejects wrong enum on topology.activation", () => {
  const golden = loadGolden();
  const topo = golden.topology as { activation: string };
  topo.activation = "relu";
  const result = validateReceiptSchema(golden);
  assert.strictEqual(
    result.ok,
    false,
    "topology.activation must be in enum ['sigmoid']; 'relu' must not validate",
  );
});

test("validateReceiptOrThrow throws on invalid input with a Hint message", () => {
  assert.throws(
    () => validateReceiptOrThrow(null),
    (err: Error) =>
      typeof err.message === "string" &&
      err.message.includes("Hint:") &&
      /schema validation failed/i.test(err.message),
    "throw message must include 'Hint:' and 'schema validation failed' (case-insensitive)",
  );
});

test("validateReceiptOrThrow returns the typed receipt on success", () => {
  const golden = loadGolden();
  const receipt = validateReceiptOrThrow(golden);
  assert.strictEqual(
    receipt.schema_version,
    "0.1.0",
    "successful path returns the typed receipt",
  );
});
