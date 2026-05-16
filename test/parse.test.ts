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

const __dirname = dirname(fileURLToPath(import.meta.url));
const goldenPath = resolve(__dirname, "../fixtures/mazur.golden.jsonl");

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
