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
  validateFrameworkTraceSidecar,
} from "../src/validate.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const goldenPath = resolve(__dirname, "../fixtures/mazur.golden.jsonl");
// A canonical, schema-valid v0.7.0 live-helper sidecar (AdamW). Carries the
// forensic `helper` block + Adam/AdamW optimizer state. Used as the positive
// baseline for the framework-trace co-presence guard (G-044) and the
// schema-downgrade adversarial test (G-027). This fixture is engine-authored
// and lives under fixtures/external/; it carries NEITHER trace_id NOR
// step_index, so it is the clean co-presence baseline.
const ftSidecarPath = resolve(
  __dirname,
  "../fixtures/external/pytorch.helper-emitted.adamw.sidecar.jsonl",
);

function loadGolden(): Record<string, unknown> {
  return JSON.parse(readFileSync(goldenPath, "utf-8")) as Record<
    string,
    unknown
  >;
}

function loadFrameworkTraceSidecar(): Record<string, unknown> {
  // .trim() because the engine-authored sidecar is a one-line JSONL record;
  // a trailing newline must not break JSON.parse.
  return JSON.parse(readFileSync(ftSidecarPath, "utf-8").trim()) as Record<
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

// ---------------------------------------------------------------------------
// G-044: framework-trace.v0.7.0 trace_id/step_index co-presence guard.
//
// The schema's co-presence guard (an allOf clause) must enforce that
// trace_id and step_index are ALL-OR-NOTHING: neither present (single-step)
// or both present (multi-step). A sidecar carrying exactly one of the two is
// a malformed multi-step record and MUST be rejected.
//
// The original guard was written as a single anyOf branch object with TWO
// "not" keys:
//   { "not": {required:["trace_id"]}, "not": {required:["step_index"]} }
// JSON.parse keeps only the LAST duplicate key, so the trace_id half of the
// guard silently vanished — leaving the asymmetric bug that a sidecar with
// trace_id-but-no-step_index slipped through (while step_index-but-no-trace_id
// happened to fail via the second anyOf branch). These four tests pin the
// SYMMETRIC contract on the canonical valid sidecar baseline.
// ---------------------------------------------------------------------------

function ftClone(): Record<string, unknown> {
  return loadFrameworkTraceSidecar();
}

test("G-044: framework-trace sidecar with NEITHER trace_id nor step_index is accepted (single-step baseline)", () => {
  const sidecar = ftClone();
  // Baseline fixture already carries neither; assert that explicitly so a
  // future fixture change that adds one of the fields is caught here.
  assert.ok(
    !("trace_id" in sidecar) && !("step_index" in sidecar),
    "baseline sidecar must carry neither trace_id nor step_index",
  );
  const result = validateFrameworkTraceSidecar(sidecar);
  assert.strictEqual(
    result.ok,
    true,
    `single-step sidecar (neither field) must validate; errors: ${
      result.ok ? "[]" : JSON.stringify(result.errors)
    }`,
  );
});

test("G-044: framework-trace sidecar with BOTH trace_id and step_index is accepted (multi-step)", () => {
  const sidecar = ftClone();
  sidecar.trace_id = "0123456789abcdef0123456789abcdef";
  sidecar.step_index = 0;
  const result = validateFrameworkTraceSidecar(sidecar);
  assert.strictEqual(
    result.ok,
    true,
    `multi-step sidecar (both fields) must validate; errors: ${
      result.ok ? "[]" : JSON.stringify(result.errors)
    }`,
  );
});

test("G-044: framework-trace sidecar with trace_id but NO step_index is REJECTED (co-presence guard)", () => {
  // THIS is the case the duplicate-"not" collapse let slip through. Before
  // the fix this returns ok:true (bug); after the fix it must be rejected.
  const sidecar = ftClone();
  sidecar.trace_id = "0123456789abcdef0123456789abcdef";
  delete sidecar.step_index;
  const result = validateFrameworkTraceSidecar(sidecar);
  assert.strictEqual(
    result.ok,
    false,
    "sidecar with trace_id but no step_index must be rejected (all-or-nothing co-presence)",
  );
});

test("G-044: framework-trace sidecar with step_index but NO trace_id is REJECTED (co-presence guard)", () => {
  const sidecar = ftClone();
  sidecar.step_index = 0;
  delete sidecar.trace_id;
  const result = validateFrameworkTraceSidecar(sidecar);
  assert.strictEqual(
    result.ok,
    false,
    "sidecar with step_index but no trace_id must be rejected (all-or-nothing co-presence)",
  );
});

// ---------------------------------------------------------------------------
// G-027: schema-DOWNGRADE adversarial test.
//
// A forger takes a sidecar that legitimately carries strong-rule fields
// (the forensic `helper` block, an Adam/AdamW optimizer with state) and
// rewrites the `format` discriminator to an OLDER, weaker schema version
// that predates those fields, hoping the weaker schema validates it while
// downstream rules that key off the older version run a laxer path.
//
// The defense: every framework-trace schema declares
// `additionalProperties: false` at the root. The dispatcher routes on the
// `format` string, so a downgraded sidecar is validated against the OLDER
// schema, whose root additionalProperties:false rejects the now-unknown
// `helper` field outright. The receipt never reaches rule evaluation.
//
// We pin this explicitly: the rejection MUST be an additionalProperties
// violation naming `helper`, and it MUST be tagged with the (older)
// dispatched schemaVersion — not silently accepted.
// ---------------------------------------------------------------------------

test("G-027: downgrading a helper-carrying v0.7.0 sidecar to format v0.6.0 is rejected (additionalProperties:false catches `helper`)", () => {
  const sidecar = ftClone();
  assert.ok(
    "helper" in sidecar,
    "baseline sidecar must carry the forensic `helper` block for this adversarial test",
  );
  // Downgrade the discriminator: claim this is an older (pre-helper) format.
  sidecar.format = "framework-trace.v0.6.0";
  const result = validateFrameworkTraceSidecar(sidecar);
  assert.strictEqual(
    result.ok,
    false,
    "downgraded sidecar must NOT validate against the older schema",
  );
  if (result.ok) return;
  assert.strictEqual(
    result.schemaVersion,
    "0.6.0",
    "dispatcher must route the downgraded sidecar to the v0.6.0 schema (format discriminator)",
  );
  const addlErr = result.errors.find(
    (e) =>
      e.keyword === "additionalProperties" &&
      e.params.additionalProperty === "helper",
  );
  assert.ok(
    addlErr,
    `expected an additionalProperties error naming the unknown 'helper' field; ` +
      `got: ${JSON.stringify(result.errors)}`,
  );
});

test("G-027: forcing the v0.6.0 schema (opts.version) on a helper-carrying sidecar rejects the unknown Adam/observer fields", () => {
  // Same attack via the explicit-version path: a caller that trusts a
  // (forged) external claim of "this is v0.6.0" and forces that schema must
  // still see the unknown `helper` field rejected. additionalProperties:false
  // is the floor under both dispatch paths.
  const sidecar = ftClone();
  const result = validateFrameworkTraceSidecar(sidecar, { version: "0.6.0" });
  assert.strictEqual(
    result.ok,
    false,
    "helper-carrying sidecar forced against v0.6.0 schema must be rejected",
  );
  if (result.ok) return;
  assert.strictEqual(result.schemaVersion, "0.6.0", "forced version recorded");
  const addlErr = result.errors.find(
    (e) =>
      e.keyword === "additionalProperties" &&
      e.params.additionalProperty === "helper",
  );
  assert.ok(
    addlErr,
    `expected additionalProperties rejection of 'helper' under forced v0.6.0; ` +
      `got: ${JSON.stringify(result.errors)}`,
  );
});
