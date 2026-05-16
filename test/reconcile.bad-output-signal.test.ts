/**
 * Rule 1 reconciliation tests — output_error_signal == product(factors).
 *
 * The bad fixture is owned by the CI/Docs agent
 * (fixtures/bad/mazur.bad-output-signal.jsonl). The fixture mutates a
 * stored signal_value (e.g. `backward.output_error_signals.o1.signal_value`)
 * while leaving its `factors` array untouched, so Rule 1 fires on the
 * mutated unit and only on that unit.
 *
 * If the fixture has not landed yet, tests skip with a TODO context so
 * the failure surfaces clearly as a cross-agent dependency rather than a
 * cryptic ENOENT in CI output. Once the fixture lands and the engine
 * implements Rule 1, the assertions exercise the full contract.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { reconcileReceipt, type ReconciliationFailure } from "../src/reconcile.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixturePath = resolve(
  __dirname,
  "../fixtures/bad/mazur.bad-output-signal.jsonl",
);

function loadFixture(): unknown | null {
  if (!existsSync(fixturePath)) return null;
  return JSON.parse(readFileSync(fixturePath, "utf-8"));
}

test("reconciler reports Rule 1 failure on mazur.bad-output-signal fixture", (t) => {
  const receipt = loadFixture();
  if (receipt === null) {
    t.skip(
      `TODO upstream: CI/Docs agent has not yet shipped ${fixturePath}; ` +
        `Rule 1 fixture-based assertions deferred.`,
    );
    return;
  }
  const result = reconcileReceipt(receipt);
  assert.strictEqual(
    result.ok,
    false,
    "bad-output-signal fixture must be rejected (Rule 1 fires on mutated unit)",
  );
  if (result.ok) return; // type narrowing

  const rule1Failures = result.failures.filter(
    (f: ReconciliationFailure) => f.rule === 1,
  );
  assert.strictEqual(
    rule1Failures.length,
    1,
    `exactly one Rule 1 failure expected on the deliberately mutated unit; ` +
      `got ${rule1Failures.length}: ${JSON.stringify(rule1Failures.map((f) => f.field_path))}`,
  );
  const rule1 = rule1Failures[0]!;
  // Mutated unit is documented in the fixture's .meta.json. The test only
  // pins the SHAPE of the failure — parameter id, field-path containment.
  // Most fixtures target o1 by convention; assert the field_path lands
  // somewhere inside backward.output_error_signals (covers o1 or o2).
  assert.match(
    rule1.field_path,
    /backward\.output_error_signals\.(o1|o2)\.signal_value/,
    `Rule 1 field_path must point at the mutated signal_value; got ${rule1.field_path}`,
  );
});

test("Rule 1 failure includes factors and product_order (per FT-E-018)", (t) => {
  const receipt = loadFixture();
  if (receipt === null) {
    t.skip(
      `TODO upstream: CI/Docs agent has not yet shipped ${fixturePath}; ` +
        `FT-E-018 factor-decomp assertions deferred.`,
    );
    return;
  }
  const result = reconcileReceipt(receipt);
  if (result.ok) {
    assert.fail("expected Rule 1 failure on bad-output-signal fixture");
  }
  const rule1 = result.failures.find(
    (f: ReconciliationFailure) => f.rule === 1,
  );
  assert.ok(rule1, "expected at least one Rule 1 failure");

  // FT-E-018: failure carries the factor decomposition + product_order so
  // CLI output can mirror docs/reconciliation.md's example.
  const rule1Any = rule1 as unknown as {
    factors?: Array<{ name: string; value: number }>;
    product_order?: string;
  };
  assert.ok(
    Array.isArray(rule1Any.factors),
    `Rule 1 failure must include factors[] per FT-E-018; got: ${JSON.stringify(rule1)}`,
  );
  assert.strictEqual(
    rule1Any.product_order,
    "left_to_right",
    `Rule 1 failure must include product_order === "left_to_right"; ` +
      `got: ${JSON.stringify(rule1)}`,
  );
});

test("reconciler does not report cascade for Rule 1 failure", (t) => {
  const receipt = loadFixture();
  if (receipt === null) {
    t.skip(
      `TODO upstream: CI/Docs agent has not yet shipped ${fixturePath}; ` +
        `cascade-absence assertion deferred.`,
    );
    return;
  }
  const result = reconcileReceipt(receipt);
  if (result.ok) {
    assert.fail("expected Rule 1 failure on bad-output-signal fixture");
  }
  const rule1 = result.failures.find(
    (f: ReconciliationFailure) => f.rule === 1,
  );
  assert.ok(rule1, "expected at least one Rule 1 failure");
  // Rule 1 is the entry point of the backward chain — nothing cascades
  // into it from a lower-numbered rule.
  assert.strictEqual(
    rule1.cascade_of_rule,
    undefined,
    `Rule 1 must not carry cascade_of_rule (it has no upstream rule); got: ${JSON.stringify(rule1)}`,
  );
});
