/**
 * T-A-008 / F-A-001: schema-emit consistency.
 *
 * Pins that the order of keys in the emitted Mazur receipt matches the
 * property iteration order in schemas/receipt.v0.1.0.json. The schema
 * also carries explicit `x-order` annotations on each object — these are
 * the canonical-emission spec per docs/canonical-emission.md. We compare
 * against `x-order` where present (top-level + nested objects), falling
 * back to `properties` iteration order otherwise.
 *
 * If a future PR adds a field to MazurReceipt and src/emit.ts without
 * updating x-order in the schema (or vice versa), this test fails and
 * forces the schema and emitter to agree.
 *
 * Cross-references:
 *   - Format agent: src/emit.ts F-A-002 EMITTED_KEYS exhaustiveness check
 *     (catches the type-level drift; this test catches the order-level drift)
 *   - docs/canonical-emission.md: schema-ordered traversal contract
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { runMazurStep } from "../src/engine.js";
import { emitMazurReceipt } from "../src/emit.js";
import { MAZUR_INPUT } from "../src/mazur.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "..");
const schemaPath = resolve(repoRoot, "schemas/receipt.v0.1.0.json");

type SchemaObject = {
  type?: string;
  properties?: Record<string, unknown>;
  "x-order"?: string[];
  required?: string[];
};

/**
 * Return the canonical emission order for a schema object: x-order if
 * present (this is the doc-level spec), otherwise properties iteration
 * order. Filters to keys that actually appear in `properties` so optional
 * x-order entries (e.g. v0.2+ forward-compat fields) don't poison the
 * comparison against the actual emitted shape.
 */
function schemaEmissionOrder(schemaObj: SchemaObject): string[] {
  const props = schemaObj.properties ?? {};
  const propKeys = new Set(Object.keys(props));
  const xOrder = schemaObj["x-order"];
  if (Array.isArray(xOrder) && xOrder.length > 0) {
    return xOrder.filter((k) => propKeys.has(k));
  }
  return Object.keys(props);
}

/**
 * Top-level expected keys: every key in the schema's x-order/properties
 * intersected with the keys actually present in the emitted receipt. The
 * intersection lets us tolerate optional fields the receipt omits (e.g.
 * `unit_order` / `parameter_order`, which the schema lists for v0.2+).
 *
 * We assert the ORDER of present keys matches the schema order — that is
 * the load-bearing canonical-emission contract.
 */
test(
  "T-A-008: emitted Mazur receipt top-level key order matches schemas/receipt.v0.1.0.json x-order",
  () => {
    const schema = JSON.parse(readFileSync(schemaPath, "utf-8")) as SchemaObject;
    const schemaOrder = schemaEmissionOrder(schema);
    assert.ok(
      schemaOrder.length > 0,
      "schema must declare top-level x-order or properties",
    );

    const receipt = runMazurStep(MAZUR_INPUT);
    const emitted = emitMazurReceipt(receipt);
    const parsed = JSON.parse(emitted) as Record<string, unknown>;
    const emittedKeys = Object.keys(parsed);

    const presentSet = new Set(emittedKeys);
    const expectedOrder = schemaOrder.filter((k) => presentSet.has(k));

    assert.deepStrictEqual(
      emittedKeys,
      expectedOrder,
      "emit.ts emission order must match the schema's canonical order.\n" +
        `emitted: ${JSON.stringify(emittedKeys)}\n` +
        `expected (from schema x-order ∩ emitted): ${JSON.stringify(expectedOrder)}`,
    );

    // Reciprocal sanity: every emitted key MUST be declared in the schema
    // (no rogue top-level keys leaking into the emission).
    const schemaKeySet = new Set(schemaOrder);
    const undeclared = emittedKeys.filter((k) => !schemaKeySet.has(k));
    assert.deepStrictEqual(
      undeclared,
      [],
      `emit.ts emitted top-level keys not declared in schema properties/x-order: ${JSON.stringify(undeclared)}`,
    );
  },
);

/**
 * Walk one level deep to catch nested-object emission drift. Pinning the
 * common cases (fixture_status, metadata, numeric_policy, topology, ...)
 * here means a future emitter that reshuffles, e.g., numeric_policy.tolerance
 * to come before precision_significant_digits fails this test instead of
 * silently breaking byte-equality against golden.
 */
test(
  "T-A-008: emitted Mazur receipt nested objects follow schema x-order",
  () => {
    const schema = JSON.parse(readFileSync(schemaPath, "utf-8")) as SchemaObject & {
      $defs?: Record<string, SchemaObject>;
    };
    const defs = schema.$defs ?? {};

    const receipt = runMazurStep(MAZUR_INPUT);
    const emitted = emitMazurReceipt(receipt);
    const parsed = JSON.parse(emitted) as Record<string, unknown>;

    // Map top-level receipt fields to the $defs they reference. Only
    // fields with a $ref to a single $def need to be checked — the
    // schema spec ties each to a named $def.
    const topProps = schema.properties ?? {};
    const fieldToDefName: Record<string, string> = {};
    for (const [field, propSchema] of Object.entries(topProps)) {
      const ref = (propSchema as { $ref?: string }).$ref;
      if (typeof ref === "string") {
        const match = ref.match(/^#\/\$defs\/(\w+)$/);
        if (match) fieldToDefName[field] = match[1]!;
      }
    }

    let checks = 0;
    for (const [field, defName] of Object.entries(fieldToDefName)) {
      const def = defs[defName];
      if (!def) continue;
      const order = schemaEmissionOrder(def);
      if (order.length === 0) continue;

      const value = parsed[field];
      if (value === undefined || value === null || typeof value !== "object") continue;
      // Skip arrays — element order is governed by domain rules
      // (updates[] order, factors[] order) which the engine fixes
      // explicitly rather than via schema x-order.
      if (Array.isArray(value)) continue;

      const emittedKeys = Object.keys(value as Record<string, unknown>);
      const presentSet = new Set(emittedKeys);
      const expectedOrder = order.filter((k) => presentSet.has(k));

      assert.deepStrictEqual(
        emittedKeys,
        expectedOrder,
        `nested object '${field}' (\$defs/${defName}) emitted key order must match schema x-order.\n` +
          `emitted: ${JSON.stringify(emittedKeys)}\n` +
          `expected: ${JSON.stringify(expectedOrder)}`,
      );
      checks++;
    }

    assert.ok(checks > 0, "expected to cross-check at least one nested object");
  },
);
