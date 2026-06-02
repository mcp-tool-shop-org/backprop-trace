/**
 * FT-F-002 parseReceipt / parseReceiptJsonl tests.
 *
 * Pins the unified parse + validate path:
 *   - parseReceipt(valid JSON) -> ok
 *   - parseReceipt(invalid JSON) -> JSON_SYNTAX error
 *   - parseReceipt(JSON with schema violation) -> SCHEMA_VIOLATION error
 *   - parseReceiptJsonl(single-record JSONL) -> ok
 *   - parseReceiptJsonl(empty input) -> error
 *   - parseReceiptJsonl(multi-record) -> error with hint about v0.1 limit
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { parseReceipt, parseReceiptJsonl } from "../src/parse.js";
import { parseTopologyInput } from "../src/parse-input.js";
import { XOR_INPUT } from "../src/mazur.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const goldenPath = resolve(__dirname, "../fixtures/mazur.golden.jsonl");

// U+FEFF byte-order mark. Windows / PowerShell `>` redirection and many
// editors prepend this to UTF-8 files; JSON.parse treats it as an unexpected
// token and fails. Receipts/inputs that round-trip through such a redirection
// must still parse (io-B-002 / io-B-007).
const BOM = "﻿";

function goldenText(): string {
  return readFileSync(goldenPath, "utf-8");
}

test("parseReceipt(validJSON) returns ok with typed receipt", () => {
  // Strip the trailing LF so JSON.parse sees a single document.
  const text = goldenText().trim();
  const result = parseReceipt(text);
  assert.strictEqual(
    result.ok,
    true,
    `golden text must parse + validate; error: ${result.ok ? "n/a" : JSON.stringify(result.error)}`,
  );
  if (result.ok) {
    assert.strictEqual(result.receipt.schema_version, "0.1.0");
  }
});

test("parseReceipt(invalidJSON) returns JSON_SYNTAX error", () => {
  const result = parseReceipt("{not valid");
  assert.strictEqual(
    result.ok,
    false,
    "malformed JSON must surface as parse error",
  );
  if (result.ok) return;
  assert.strictEqual(
    result.error.kind,
    "JSON_SYNTAX",
    `error.kind must be 'JSON_SYNTAX'; got ${result.error.kind}`,
  );
  assert.ok(
    typeof result.error.message === "string" && result.error.message.length > 0,
    "error.message must be a non-empty string",
  );
});

test("parseReceipt(JSON with schema violation) returns SCHEMA_VIOLATION", () => {
  const result = parseReceipt('{"schema_version":"oops"}');
  assert.strictEqual(
    result.ok,
    false,
    "schema-violating JSON must surface as parse error",
  );
  if (result.ok) return;
  assert.strictEqual(
    result.error.kind,
    "SCHEMA_VIOLATION",
    `error.kind must be 'SCHEMA_VIOLATION'; got ${result.error.kind}`,
  );
  assert.ok(
    Array.isArray(result.error.schemaErrors) &&
      result.error.schemaErrors.length >= 1,
    `error.schemaErrors must be a non-empty array; got: ${JSON.stringify(result.error)}`,
  );
});

test("parseReceiptJsonl(single-record JSONL) returns ok", () => {
  const text = goldenText(); // golden file is the single-record JSONL form
  const result = parseReceiptJsonl(text);
  assert.strictEqual(
    result.ok,
    true,
    `single-record JSONL must parse; error: ${result.ok ? "n/a" : JSON.stringify(result.error)}`,
  );
});

test("parseReceiptJsonl(empty input) returns error", () => {
  const result = parseReceiptJsonl("");
  assert.strictEqual(
    result.ok,
    false,
    "empty JSONL input must surface as error",
  );
  if (result.ok) return;
  assert.strictEqual(
    result.error.kind,
    "JSON_SYNTAX",
    `empty input kind must be JSON_SYNTAX; got ${result.error.kind}`,
  );
});

test("parseReceiptJsonl(multi-record) returns error with hint about v0.1 limit", () => {
  const text = goldenText().trim();
  // Duplicate the single record on a second line.
  const multi = `${text}\n${text}\n`;
  const result = parseReceiptJsonl(multi);
  assert.strictEqual(
    result.ok,
    false,
    "multi-record JSONL must surface as error in v0.1",
  );
  if (result.ok) return;
  assert.match(
    result.error.message,
    /Multi-record JSONL|got 2 records|v0\.1/i,
    `error.message should hint at the v0.1 single-record limit; got: ${JSON.stringify(result.error.message)}`,
  );
});

// ---------------------------------------------------------------------------
// io-B-002: a UTF-8 BOM (U+FEFF) prefix must not break parsing.
//
// Windows / PowerShell `command > file.json` redirection and several editors
// prepend a BOM to UTF-8 files. JSON.parse treats the BOM as an unexpected
// token ("Unexpected token ﻿") and fails — a confusing failure for a
// user whose JSON is otherwise byte-correct. parseReceipt / parseReceiptJsonl
// must strip a single leading BOM before JSON.parse so a redirected receipt
// parses identically to one without the mark.
//
// MUTATION THAT MAKES THIS RED: remove the BOM strip in parse.ts. Then
// JSON.parse(BOM + json) throws and these tests see JSON_SYNTAX.
// ---------------------------------------------------------------------------

test("io-B-002: parseReceipt strips a leading UTF-8 BOM and parses identically", () => {
  const text = goldenText().trim();
  const withBom = BOM + text;
  const result = parseReceipt(withBom);
  assert.strictEqual(
    result.ok,
    true,
    `BOM-prefixed receipt must parse; error: ${result.ok ? "n/a" : JSON.stringify(result.error)}`,
  );
  if (result.ok) {
    assert.strictEqual(result.receipt.schema_version, "0.1.0");
  }
});

test("io-B-002: parseReceiptJsonl strips a leading UTF-8 BOM and parses identically", () => {
  // The golden file is the single-record JSONL form (with trailing LF). Prepend
  // a BOM the way `pwsh > golden.jsonl` would.
  const withBom = BOM + goldenText();
  const result = parseReceiptJsonl(withBom);
  assert.strictEqual(
    result.ok,
    true,
    `BOM-prefixed JSONL must parse; error: ${result.ok ? "n/a" : JSON.stringify(result.error)}`,
  );
});

test("io-B-002: a BOM strip does NOT mask a genuinely malformed BOM-prefixed document", () => {
  // Stripping the BOM must not turn a malformed doc into a silent pass — after
  // the strip the remaining bytes are still bad JSON, so it stays JSON_SYNTAX.
  const result = parseReceipt(BOM + "{not valid");
  assert.strictEqual(result.ok, false, "malformed-after-BOM must still fail");
  if (result.ok) return;
  assert.strictEqual(result.error.kind, "JSON_SYNTAX");
});

// ---------------------------------------------------------------------------
// io-B-007: parseTopologyInput error parity with the receipt parser.
//
// parse-input must reshape failures the same way parse.ts does:
//   - strip a leading BOM before JSON.parse (io-B-002 parity);
//   - surface an explicit, actionable message for empty / whitespace-only
//     input instead of a raw "Unexpected end of JSON input".
// Both still use the JSON_SYNTAX discriminator and the discriminated-union
// shape so existing callers are unaffected.
//
// MUTATION THAT MAKES THIS RED: remove the BOM strip / empty-input guard in
// parse-input.ts. The BOM test then sees JSON_SYNTAX; the empty test sees the
// raw JSON.parse message instead of the explicit "empty"/actionable text.
// ---------------------------------------------------------------------------

test("io-B-007: parseTopologyInput strips a leading UTF-8 BOM and parses identically", () => {
  const inputText = JSON.stringify(XOR_INPUT);
  const result = parseTopologyInput(BOM + inputText);
  assert.strictEqual(
    result.ok,
    true,
    `BOM-prefixed topology input must parse; error: ${result.ok ? "n/a" : JSON.stringify(result.error)}`,
  );
});

test("io-B-007: parseTopologyInput surfaces an actionable empty-input error (not a raw JSON.parse message)", () => {
  const result = parseTopologyInput("");
  assert.strictEqual(result.ok, false, "empty input must surface as error");
  if (result.ok) return;
  assert.strictEqual(
    result.error.kind,
    "JSON_SYNTAX",
    `empty input kind must be JSON_SYNTAX; got ${result.error.kind}`,
  );
  assert.match(
    result.error.message,
    /empty/i,
    `empty-input message must name the empty-input condition (actionable), ` +
      `not echo a raw parser token; got: ${JSON.stringify(result.error.message)}`,
  );
});

test("io-B-007: parseTopologyInput treats whitespace-only input as empty (parity with empty)", () => {
  const result = parseTopologyInput("   \n\t  ");
  assert.strictEqual(result.ok, false, "whitespace-only input must surface as error");
  if (result.ok) return;
  assert.strictEqual(result.error.kind, "JSON_SYNTAX");
  assert.match(
    result.error.message,
    /empty/i,
    `whitespace-only input must be diagnosed as empty; got: ${JSON.stringify(result.error.message)}`,
  );
});

test("io-B-007: parseTopologyInput still reports a real syntax error as JSON_SYNTAX with a hint", () => {
  // Non-empty but malformed: must keep the structured JSON_SYNTAX shape and the
  // topology-specific hint (parity with parse.ts's structured reshaping).
  const result = parseTopologyInput("{not valid");
  assert.strictEqual(result.ok, false, "malformed input must fail");
  if (result.ok) return;
  assert.strictEqual(result.error.kind, "JSON_SYNTAX");
  assert.ok(
    result.error.jsonError instanceof SyntaxError,
    "a genuine syntax error must still carry the raw SyntaxError on jsonError",
  );
  assert.match(
    result.error.message,
    /topology input/i,
    "syntax-error message must keep the topology-input context hint",
  );
});
