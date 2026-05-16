/**
 * T-A-001: NaN-poisoning rejection.
 *
 * Covers the silent-Rule-4-pass class of bugs: prior to the engine agent's
 * fix in reconcile.ts (E-A-001), `Math.abs(NaN - x) > tolerance` evaluates
 * to `false`, so a receipt with NaN in a gradient/factor would be silently
 * accepted. These tests pin the post-fix behavior: any non-finite value
 * reachable by Rule 4's computation MUST cause `result.ok === false`.
 *
 * Receipts are constructed in-memory by cloning the golden Mazur receipt
 * (so they remain otherwise structurally valid) and mutating a single field
 * to a poisoned value before invoking reconcileReceipt. This isolates the
 * non-finite-rejection contract from any other rule.
 *
 * Cross-references:
 *   - Engine agent: src/reconcile.ts E-A-001 NaN-poisoning guard
 *   - Research grounding: Csmith/CompCert anti-circularity lineage (Finding 4)
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { reconcileReceipt, type ReconciliationFailure } from "../src/reconcile.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const goldenPath = resolve(__dirname, "../fixtures/mazur.golden.jsonl");

// Load and parse the golden fixture once per test so each mutation is
// applied to a fresh deep clone (no cross-test contamination).
function loadGoldenClone(): Record<string, unknown> {
  const text = readFileSync(goldenPath, "utf-8").trim();
  return JSON.parse(text) as Record<string, unknown>;
}

function findRule4OrStructuralFailureOn(
  failures: ReconciliationFailure[],
  fieldPathPrefix: string,
): ReconciliationFailure | undefined {
  return failures.find(
    (f) =>
      (f.rule === 4 || f.rule === 0) &&
      typeof f.field_path === "string" &&
      f.field_path.startsWith(fieldPathPrefix),
  );
}

test(
  "reconcileReceipt rejects receipt where updates[0].gradient is NaN",
  () => {
    const receipt = loadGoldenClone();
    const updates = receipt.updates as Array<Record<string, unknown>>;
    updates[0]!.gradient = Number.NaN;

    const result = reconcileReceipt(receipt);
    assert.strictEqual(
      result.ok,
      false,
      "NaN gradient must NOT pass reconciliation (silent-Rule-4 pass is the E-A-001 bug)",
    );
    if (result.ok) return; // type narrowing for TS

    const f = findRule4OrStructuralFailureOn(result.failures, "updates[0]");
    assert.ok(
      f,
      `expected a Rule 4 or Rule 0 failure on updates[0], got: ${JSON.stringify(result.failures, null, 2)}`,
    );
  },
);

test(
  "reconcileReceipt rejects receipt where updates[0].gradient is +Infinity",
  () => {
    const receipt = loadGoldenClone();
    const updates = receipt.updates as Array<Record<string, unknown>>;
    updates[0]!.gradient = Number.POSITIVE_INFINITY;

    const result = reconcileReceipt(receipt);
    assert.strictEqual(
      result.ok,
      false,
      "+Infinity gradient must NOT pass reconciliation",
    );
    if (result.ok) return;

    const f = findRule4OrStructuralFailureOn(result.failures, "updates[0]");
    assert.ok(
      f,
      `expected a Rule 4 or Rule 0 failure on updates[0], got: ${JSON.stringify(result.failures, null, 2)}`,
    );
  },
);

test(
  "reconcileReceipt rejects receipt where updates[0].gradient is -Infinity",
  () => {
    const receipt = loadGoldenClone();
    const updates = receipt.updates as Array<Record<string, unknown>>;
    updates[0]!.gradient = Number.NEGATIVE_INFINITY;

    const result = reconcileReceipt(receipt);
    assert.strictEqual(
      result.ok,
      false,
      "-Infinity gradient must NOT pass reconciliation",
    );
    if (result.ok) return;

    const f = findRule4OrStructuralFailureOn(result.failures, "updates[0]");
    assert.ok(
      f,
      `expected a Rule 4 or Rule 0 failure on updates[0], got: ${JSON.stringify(result.failures, null, 2)}`,
    );
  },
);

test(
  "reconcileReceipt rejects receipt where updates[0].optimizer.factors[0].value is NaN",
  () => {
    const receipt = loadGoldenClone();
    const updates = receipt.updates as Array<Record<string, unknown>>;
    const optimizer = updates[0]!.optimizer as Record<string, unknown>;
    const factors = optimizer.factors as Array<Record<string, unknown>>;
    factors[0]!.value = Number.NaN;

    const result = reconcileReceipt(receipt);
    assert.strictEqual(
      result.ok,
      false,
      "NaN factor value must poison the product and cause Rule 4 to reject the receipt (NOT silently pass via NaN > tolerance === false)",
    );
    if (result.ok) return;

    const f = findRule4OrStructuralFailureOn(result.failures, "updates[0]");
    assert.ok(
      f,
      `expected a Rule 4 or Rule 0 failure on updates[0], got: ${JSON.stringify(result.failures, null, 2)}`,
    );
  },
);

test(
  "reconcileReceipt rejects receipt where updates[0].optimizer.factors[1].value is Infinity",
  () => {
    const receipt = loadGoldenClone();
    const updates = receipt.updates as Array<Record<string, unknown>>;
    const optimizer = updates[0]!.optimizer as Record<string, unknown>;
    const factors = optimizer.factors as Array<Record<string, unknown>>;
    factors[1]!.value = Number.POSITIVE_INFINITY;

    const result = reconcileReceipt(receipt);
    assert.strictEqual(
      result.ok,
      false,
      "+Infinity factor value must poison the product and cause Rule 4 to reject the receipt",
    );
    if (result.ok) return;

    const f = findRule4OrStructuralFailureOn(result.failures, "updates[0]");
    assert.ok(
      f,
      `expected a Rule 4 or Rule 0 failure on updates[0], got: ${JSON.stringify(result.failures, null, 2)}`,
    );
  },
);

test(
  "reconcileReceipt rejects receipt where numeric_policy.tolerance is NaN (structural Rule 0)",
  () => {
    const receipt = loadGoldenClone();
    const np = receipt.numeric_policy as Record<string, unknown>;
    np.tolerance = Number.NaN;

    const result = reconcileReceipt(receipt);
    assert.strictEqual(
      result.ok,
      false,
      "NaN tolerance must produce a structural failure (Rule 0), not be silently accepted",
    );
    if (result.ok) return;

    // tolerance is enforced via the structural shape guard at the top of
    // reconcileReceipt; expect rule 0 specifically.
    const f = result.failures.find(
      (f) =>
        f.rule === 0 &&
        typeof f.field_path === "string" &&
        f.field_path.includes("tolerance"),
    );
    assert.ok(
      f,
      `expected a Rule 0 failure on numeric_policy.tolerance, got: ${JSON.stringify(result.failures, null, 2)}`,
    );
  },
);
