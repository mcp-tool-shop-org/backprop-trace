/**
 * FT-F-005 getReceiptSchema tests.
 *
 * Pins the versioned-schema-access contract:
 *   - getReceiptSchema() defaults to "0.1.0" and returns a parsed JSON-Schema object.
 *   - getReceiptSchema("0.1.0") returns the same cached instance.
 *   - getReceiptSchema(<unknown>) throws.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { getReceiptSchema, SCHEMA_VERSIONS } from "../src/schema-loader.js";

test("getReceiptSchema() returns the v0.1.0 schema with expected shape", () => {
  const schema = getReceiptSchema() as Record<string, unknown>;
  assert.strictEqual(
    typeof schema,
    "object",
    "loaded schema must be an object",
  );
  assert.strictEqual(
    schema.$id,
    "https://github.com/mcp-tool-shop-org/backprop-trace/schemas/receipt.v0.1.0.json",
    "$id must identify the v0.1.0 schema",
  );
  assert.strictEqual(
    schema.title,
    "Backprop-Trace Receipt v0.1.0",
    "title must match the v0.1.0 schema title",
  );
});

test('getReceiptSchema("0.1.0") returns the same cached object as the default call', () => {
  const a = getReceiptSchema();
  const b = getReceiptSchema("0.1.0");
  assert.strictEqual(
    a,
    b,
    "explicit '0.1.0' must hit the same cache entry as the default",
  );
});

test('getReceiptSchema throws on an unknown version', () => {
  assert.throws(
    () => getReceiptSchema("nonexistent" as (typeof SCHEMA_VERSIONS)[number]),
    /Unknown schema version|nonexistent/i,
    "must throw a recognizable error on an unknown version",
  );
});
