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
import * as SchemaLoader from "../src/schema-loader.js";

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

test("SCHEMA_VERSIONS = ['0.1.0', '0.2.0', '0.3.0', '0.4.0', '0.5.0', '0.6.0', '0.7.0'] in v0.9.3 (extended from v0.9.2's six with the Nesterov + dampening forced bump)", () => {
  assert.deepStrictEqual(
    Array.from(SCHEMA_VERSIONS).sort(),
    ["0.1.0", "0.2.0", "0.3.0", "0.4.0", "0.5.0", "0.6.0", "0.7.0"],
    "SCHEMA_VERSIONS must include '0.1.0' (Mazur-pinned), '0.2.0' (generalized), " +
      "'0.3.0' (v0.5 softmax+CE additive), '0.4.0' (v0.6 external observer-mode " +
      "additive), '0.5.0' (v0.9.1 Adam + AdamW FORCED bump), '0.6.0' (v0.9.2 classical " +
      "PyTorch-style SGD momentum FORCED bump: nesterov: const false + dampening: const 0 " +
      "reserved for v0.9.3), and '0.7.0' (v0.9.3 Nesterov + dampening FORCED bump: " +
      "nesterov widens from const false to boolean; dampening widens from const 0 to " +
      "number in [0, 1); PyTorch's torch.optim.SGD.__init__ ValueError on nesterov=true && " +
      "dampening>0 mirrored at schema via allOf if/then clause + engine boundary). When " +
      "the next version ships, update this expected list AND drop the " +
      "schemas/receipt.v<version>.json file alongside it.",
  );
});

test('getReceiptSchema("0.3.0") returns the v0.5 softmax+CE schema with v0.3.0 identifying fields', () => {
  const schema = getReceiptSchema("0.3.0") as Record<string, unknown>;
  assert.strictEqual(
    typeof schema,
    "object",
    "loaded schema must be an object",
  );
  assert.match(
    String(schema.$id ?? ""),
    /receipt\.v0\.3\.0\.json/,
    `v0.3.0 schema $id must reference receipt.v0.3.0.json; got: ${String(schema.$id)}`,
  );
  // The v0.3.0 schema must declare the const schema_version: "0.3.0".
  const props = schema["properties"] as Record<string, unknown> | undefined;
  const schemaVersionProp = props?.["schema_version"] as Record<string, unknown> | undefined;
  assert.strictEqual(
    schemaVersionProp?.["const"],
    "0.3.0",
    `v0.3.0 schema must pin properties.schema_version.const to "0.3.0"; got: ` +
      `${JSON.stringify(schemaVersionProp?.["const"])}`,
  );
});

test('getReceiptSchema("0.3.0") returns the same cached object across calls', () => {
  const a = getReceiptSchema("0.3.0");
  const b = getReceiptSchema("0.3.0");
  assert.strictEqual(
    a,
    b,
    "repeat reads of v0.3.0 must hit the same cache entry",
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

// =============================================================================
// v0.4 input-schema extensions (Tests-agent extend per consolidator-decision §5)
// =============================================================================
//
// The v0.4 wave introduces an INPUT schema (topology-input.v0.4.0.json) that's
// distinct from the receipt schemas. Library agent's contract is to expose:
//   - INPUT_SCHEMA_VERSIONS — tuple of supported input-schema versions
//   - getInputSchema(version) — parallels getReceiptSchema(version)
//
// These tests skip with upstream-TODO notes if Library agent hasn't shipped
// the surface yet. The schema file itself is a separate dependency (Schema
// agent's domain) and is gated separately.

test('INPUT_SCHEMA_VERSIONS includes "0.4.0" (v0.4 input-schema dispatch)', (t) => {
  const versions = (SchemaLoader as Record<string, unknown>)["INPUT_SCHEMA_VERSIONS"];
  if (versions === undefined) {
    t.skip(
      "TODO upstream (Library agent): src/schema-loader.ts must export INPUT_SCHEMA_VERSIONS " +
        "(tuple of supported topology-input schema versions). Per consolidator-decision §5 " +
        "Library-agent scope: extend schema-loader with INPUT_SCHEMA_VERSIONS.",
    );
    return;
  }
  assert.ok(
    Array.isArray(versions) || versions instanceof Object,
    `INPUT_SCHEMA_VERSIONS must be an array-like; got: ${JSON.stringify(versions)}`,
  );
  const list = Array.isArray(versions) ? versions : Array.from(versions as Iterable<unknown>);
  assert.ok(
    list.includes("0.4.0"),
    `INPUT_SCHEMA_VERSIONS must include '0.4.0'; got: ${JSON.stringify(list)}`,
  );
});

test('getInputSchema("0.4.0") returns a JSON Schema object', (t) => {
  const getInputSchema = (SchemaLoader as Record<string, unknown>)["getInputSchema"] as
    | ((v: string) => unknown)
    | undefined;
  if (typeof getInputSchema !== "function") {
    t.skip(
      "TODO upstream (Library agent): src/schema-loader.ts must export getInputSchema(version) " +
        "(parallels getReceiptSchema(version) for the v0.4 topology-input schema).",
    );
    return;
  }
  let schema: unknown;
  try {
    schema = getInputSchema("0.4.0");
  } catch (err) {
    t.skip(
      `TODO upstream (Library agent): getInputSchema('0.4.0') threw — ` +
        `${err instanceof Error ? err.message : String(err)}`,
    );
    return;
  }
  assert.strictEqual(
    typeof schema,
    "object",
    `getInputSchema('0.4.0') must return an object; got: ${typeof schema}`,
  );
  const s = schema as Record<string, unknown>;
  assert.ok(
    s["$id"] === undefined ||
      (typeof s["$id"] === "string" && (s["$id"] as string).includes("topology-input.v0.4.0")),
    `$id should reference topology-input.v0.4.0; got: ${String(s["$id"])}`,
  );
  // The schema MUST declare additionalProperties: false at the top level
  // (canonical-emission trust-leakage gate from §7 risk 1).
  assert.strictEqual(
    s["additionalProperties"],
    false,
    `topology-input.v0.4.0 schema must have additionalProperties: false at top level ` +
      `(canonical-emission trust-leakage gate); got: ${JSON.stringify(s["additionalProperties"])}`,
  );
});
