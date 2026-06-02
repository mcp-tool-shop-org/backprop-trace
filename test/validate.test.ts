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
import { SCHEMA_VERSIONS, type SchemaVersion } from "../src/schema-loader.js";

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

// ---------------------------------------------------------------------------
// io-B-004: pickSchemaVersion must NOT silently default a present-but-
// unrecognized schema_version to a hard-coded literal (0.2.0). A receipt that
// DECLARES a version (e.g. "0.9.9") that this build does not ship is a
// diagnosable authoring/version-skew error. The old behavior dispatched
// silently to v0.2.0 and reported only "failed against
// schemas/receipt.v0.2.0.json" — a version the user never named, with no hint
// that 0.9.9 is unknown.
//
// Humanization contract: the receipt is still validated against the default
// schema (so schemaVersion + the pass/fail outcome are unchanged for existing
// callers — see the multi-version suite), but the failure now carries an
// actionable note that NAMES the unknown declared version AND lists the known
// versions, so the user can FIX it (downgrade the receipt or upgrade the
// verifier). The note is the HEADLINE error (errors[0]).
//
// MUTATION THAT MAKES THIS RED: restore pickSchemaVersion's silent
// `{ kind: "default", version: "0.2.0" }` for a recognized-string-miss (drop
// the "unknown" tag). Then no unknown-version note is prepended and the
// assertions below fail.
// ---------------------------------------------------------------------------

test("io-B-004: a present-but-unknown schema_version surfaces an actionable note (not a silent default dispatch)", () => {
  const result = validateReceiptSchema({ schema_version: "0.9.9" });
  assert.strictEqual(
    result.ok,
    false,
    "an unknown declared schema_version (on an otherwise-empty body) must not validate",
  );
  if (result.ok) return;
  // The receipt is validated against the default schema — schemaVersion is the
  // dispatched fallback, unchanged from the historical behavior.
  assert.strictEqual(
    result.schemaVersion,
    "0.2.0",
    `unknown version dispatches to the default schema; got: ${result.schemaVersion}`,
  );
  // The HEADLINE error must be the unknown-version note.
  const unknownErr = result.errors.find(
    (e) => e.keyword === "schema_version" || e.params.unknownSchemaVersion === "0.9.9",
  );
  assert.ok(
    unknownErr,
    `expected an error flagging the unknown schema_version; got: ${JSON.stringify(result.errors)}`,
  );
  assert.strictEqual(
    result.errors[0],
    unknownErr,
    "the unknown-version note must be the FIRST (headline) error, ahead of the wrong-schema cascade",
  );
  // The message must be actionable: name the unknown version AND list known ones.
  assert.match(
    unknownErr.message,
    /0\.9\.9/,
    `error message must name the unknown declared version; got: ${unknownErr.message}`,
  );
  for (const v of SCHEMA_VERSIONS) {
    assert.ok(
      unknownErr.message.includes(v),
      `error message must list known version ${v} so the user can fix the receipt; ` +
        `got: ${unknownErr.message}`,
    );
  }
  // The declared version is preserved in structured params for programmatic
  // callers (CLI JSON / SARIF rendering) — not just buried in the message.
  assert.strictEqual(
    unknownErr.params.unknownSchemaVersion,
    "0.9.9",
    "params.unknownSchemaVersion must carry the declared version for structured consumers",
  );
});

test("io-B-004: an unversioned (schema_version absent) receipt still falls through to the default dispatcher (back-compat preserved)", () => {
  // The finding targets PRESENT-but-unknown versions. An ABSENT schema_version
  // is the long-standing "new generalized receipt without explicit version"
  // path and must keep landing on the default schema (then fail/pass there on
  // its own merits) — NOT be hijacked by the unknown-version rejection.
  const result = validateReceiptSchema({});
  assert.strictEqual(
    result.ok,
    false,
    "an empty object is not a valid receipt and must fail schema validation",
  );
  if (result.ok) return;
  assert.strictEqual(
    result.schemaVersion,
    "0.2.0",
    `absent schema_version must still dispatch to the default (0.2.0), not the ` +
      `unknown-version path; got: ${result.schemaVersion}`,
  );
  // It must NOT be flagged as an unknown-version error (that path is only for
  // a present-but-unrecognized string).
  const unknownErr = result.errors.find(
    (e) => e.keyword === "schema_version" && e.params.unknownSchemaVersion !== undefined,
  );
  assert.strictEqual(
    unknownErr,
    undefined,
    `absent schema_version must NOT trip the unknown-version rejection; got: ${JSON.stringify(result.errors)}`,
  );
});

test("io-B-004: an explicit opts.version override still wins over an unknown declared schema_version", () => {
  // A caller that FORCES a known version (e.g. the CLI's --schema-version) must
  // be able to validate a receipt whose own schema_version is garbage. The
  // override is the trusted source; the unknown-declaration rejection only
  // fires on the SNIFF path.
  const result = validateReceiptSchema(
    { schema_version: "0.9.9" },
    { version: "0.1.0" },
  );
  assert.strictEqual(
    result.schemaVersion,
    "0.1.0",
    "opts.version override must take precedence over the unknown declared version",
  );
  // It validates against v0.1.0 (and fails there for missing required fields,
  // NOT for an unknown-version reason).
  if (!result.ok) {
    const unknownErr = result.errors.find(
      (e) => e.params.unknownSchemaVersion !== undefined,
    );
    assert.strictEqual(
      unknownErr,
      undefined,
      "forced-version path must not emit an unknown-version error",
    );
  }
});

// ---------------------------------------------------------------------------
// SCHEMA defense-in-depth for core-B-001 (batch-sample resource cap).
//
// The core agent's reconciler caps batch sample count at MAX_BATCH_SAMPLES
// (10000) so an attacker-authored receipt cannot demand unbounded per-sample
// allocation (OOM / hang). This block pins the SCHEMA-level mirror: every
// receipt schema that carries a `batch` block (v0.5.0, v0.6.0, v0.7.0) must
// declare `batch.size` <= 10000 (`maximum`) and `batch.sample_order` length
// <= 10000 (`maxItems`). Defense-in-depth: an over-cap batch is rejected at
// schema validation on every path, BEFORE it reaches the reconciler — a clear
// schema violation, not a downstream OOM.
//
// Baseline: each version's engine-authored golden is cloned and a small,
// valid `batch` block is injected (batch is OPTIONAL at schema level, so this
// stays valid). Then `size` / `sample_order` are pushed over the cap and the
// receipt must FAIL with a maximum / maxItems violation at the batch path.
//
// MUTATION THAT MAKES THIS RED: delete the `maximum` from batch.size (or
// `maxItems` from batch.sample_order) in any of the three schemas. Without
// the bound Ajv accepts size:10001 (minimum:1 only) and the over-cap
// assertion for that version fails.
// ---------------------------------------------------------------------------

const MAX_BATCH_SAMPLES = 10000;

// (version, engine-authored golden that validates against that version)
const BATCH_CAP_BASES: ReadonlyArray<[SchemaVersion, string]> = [
  ["0.5.0", "../fixtures/external/pytorch.adam.golden.jsonl"],
  ["0.6.0", "../fixtures/external/pytorch.sgd-momentum.golden.jsonl"],
  ["0.7.0", "../fixtures/external/pytorch.sgd-momentum.nesterov.golden.jsonl"],
];

function loadJsonlRecord(rel: string): Record<string, unknown> {
  return JSON.parse(
    readFileSync(resolve(__dirname, rel), "utf-8").trim().split(/\r?\n/)[0]!,
  ) as Record<string, unknown>;
}

// A valid, in-cap batch block (size 2, two samples) injected as the positive
// baseline. batch is OPTIONAL in the schema (not in `required`), so a valid
// receipt + this block stays valid.
function smallBatch(): Record<string, unknown> {
  return { size: 2, sample_order: ["s0", "s1"], reduction: "mean" };
}

for (const [version, rel] of BATCH_CAP_BASES) {
  test(`batch-cap[${version}]: base golden + a small in-cap batch block validates (positive baseline)`, () => {
    const r = loadJsonlRecord(rel);
    assert.strictEqual(
      r.schema_version,
      version,
      `fixture ${rel} must declare schema_version ${version}; got ${String(r.schema_version)}`,
    );
    r.batch = smallBatch();
    const result = validateReceiptSchema(r);
    assert.strictEqual(
      result.ok,
      true,
      `golden + small batch must validate against v${version}; errors: ${
        result.ok ? "[]" : JSON.stringify(result.errors)
      }`,
    );
  });

  test(`batch-cap[${version}]: batch.size at the cap (${MAX_BATCH_SAMPLES}) is accepted; size over the cap is rejected (maximum)`, () => {
    // At the cap: accepted.
    const atCap = loadJsonlRecord(rel);
    atCap.batch = { ...smallBatch(), size: MAX_BATCH_SAMPLES };
    const atCapResult = validateReceiptSchema(atCap);
    assert.strictEqual(
      atCapResult.ok,
      true,
      `batch.size === ${MAX_BATCH_SAMPLES} must validate (boundary inclusive); errors: ${
        atCapResult.ok ? "[]" : JSON.stringify(atCapResult.errors)
      }`,
    );
    // Over the cap: rejected with a maximum violation at the batch.size path.
    const overCap = loadJsonlRecord(rel);
    overCap.batch = { ...smallBatch(), size: MAX_BATCH_SAMPLES + 1 };
    const overResult = validateReceiptSchema(overCap);
    assert.strictEqual(
      overResult.ok,
      false,
      `batch.size === ${MAX_BATCH_SAMPLES + 1} must be rejected (over-cap)`,
    );
    if (overResult.ok) return;
    const maxErr = overResult.errors.find(
      (e) => e.keyword === "maximum" && e.instancePath.includes("/batch/size"),
    );
    assert.ok(
      maxErr,
      `expected a maximum violation at /batch/size; got: ${JSON.stringify(overResult.errors)}`,
    );
  });

  test(`batch-cap[${version}]: batch.sample_order over ${MAX_BATCH_SAMPLES} items is rejected (maxItems)`, () => {
    const overItems = loadJsonlRecord(rel);
    // size stays small/valid; sample_order is the oversized vector. Use unique
    // ids so uniqueItems does not pre-empt the maxItems check.
    const tooMany = Array.from(
      { length: MAX_BATCH_SAMPLES + 1 },
      (_, i) => `s${i}`,
    );
    overItems.batch = { size: 2, sample_order: tooMany, reduction: "mean" };
    const result = validateReceiptSchema(overItems);
    assert.strictEqual(
      result.ok,
      false,
      `batch.sample_order with ${MAX_BATCH_SAMPLES + 1} items must be rejected (over-cap)`,
    );
    if (result.ok) return;
    const maxItemsErr = result.errors.find(
      (e) =>
        e.keyword === "maxItems" &&
        e.instancePath.includes("/batch/sample_order"),
    );
    assert.ok(
      maxItemsErr,
      `expected a maxItems violation at /batch/sample_order; got: ${JSON.stringify(result.errors)}`,
    );
  });
}
