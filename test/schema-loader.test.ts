/**
 * FT-F-005 getReceiptSchema tests.
 *
 * Pins the versioned-schema-access contract:
 *   - getReceiptSchema() defaults to "0.1.0" and returns a parsed JSON-Schema object.
 *   - getReceiptSchema("0.1.0") returns the same cached instance.
 *   - getReceiptSchema(<unknown>) throws.
 *   - v0.3 ships "0.1.0" + "0.2.0" — SCHEMA_VERSIONS reflects this and
 *     `getReceiptSchema("0.2.0")` returns the generalized-receipt schema
 *     with its v0.2.0 identifying $id + title.
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

test("SCHEMA_VERSIONS = ['0.1.0', '0.2.0'] in v0.3 (extended from v0.1/v0.2's '0.1.0'-only)", () => {
  assert.deepStrictEqual(
    Array.from(SCHEMA_VERSIONS).sort(),
    ["0.1.0", "0.2.0"],
    "SCHEMA_VERSIONS must include both '0.1.0' (Mazur-pinned) and '0.2.0' (generalized). " +
      "When v0.4+ adds a new schema version, update this expected list AND drop the " +
      "schemas/receipt.v<version>.json file alongside it.",
  );
});

test('getReceiptSchema("0.2.0") returns the generalized-receipt schema with v0.2.0 identifying fields', () => {
  const schema = getReceiptSchema("0.2.0") as Record<string, unknown>;
  assert.strictEqual(
    typeof schema,
    "object",
    "loaded schema must be an object",
  );
  // The v0.2.0 schema's $id should reference v0.2.0 (parallel to the
  // v0.1.0 anchor). Pin a substring match rather than full equality so a
  // future $id base-URL change doesn't require a coordinated update here.
  assert.match(
    String(schema.$id ?? ""),
    /receipt\.v0\.2\.0\.json/,
    `v0.2.0 schema $id must reference receipt.v0.2.0.json; got: ${String(schema.$id)}`,
  );
});

test('getReceiptSchema("0.2.0") returns the same cached object across calls', () => {
  const a = getReceiptSchema("0.2.0");
  const b = getReceiptSchema("0.2.0");
  assert.strictEqual(
    a,
    b,
    "repeat reads of v0.2.0 must hit the same cache entry",
  );
});
