import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { reconcileReceipt, type ReconciliationFailure } from "../src/reconcile.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixturePath = resolve(__dirname, "../fixtures/bad/mazur.bad-gradient.jsonl");

test(
  "bp reconcile receipt fixtures/bad/mazur.bad-gradient.jsonl fails Rule 4 on w5 only",
  () => {
    const receipt = JSON.parse(readFileSync(fixturePath, "utf-8"));
    const result = reconcileReceipt(receipt);

    if (result.ok) {
      assert.fail("reconciler must reject the bad-gradient fixture");
    }

    // Single-target invariant: exactly one Rule 4 failure, and it is on w5.
    // If other parameters fail Rule 4, the bad fixture's anti-circularity
    // proof is muddied by precision noise — that means the fixture (or the
    // tolerance policy) regressed.
    const rule4Failures = result.failures.filter(
      (f: ReconciliationFailure) => f.rule === 4,
    );
    assert.strictEqual(
      rule4Failures.length,
      1,
      `exactly one Rule 4 failure expected (w5 only); got ${rule4Failures.length}: ${JSON.stringify(rule4Failures.map((f) => f.parameter_id))}`,
    );

    const rule4OnW5 = rule4Failures[0];
    assert.ok(rule4OnW5, "single Rule 4 failure must exist");
    assert.strictEqual(rule4OnW5.parameter_id, "w5");
    assert.strictEqual(rule4OnW5.field_path, "updates[4].gradient");
    assert.strictEqual(rule4OnW5.stored, -0.082166041);

    const expectedProduct = -0.138498562 * 0.593269992;
    assert.strictEqual(rule4OnW5.recomputed, expectedProduct);

    assert.strictEqual(rule4OnW5.tolerance, 1e-9);

    const expectedDelta = Math.abs(expectedProduct - -0.082166041);
    assert.strictEqual(rule4OnW5.delta, expectedDelta);
    assert.ok(
      rule4OnW5.delta > 1e-7,
      `delta ${rule4OnW5.delta} should be well above tolerance (expected ~1e-6, 1000x of 1e-9)`,
    );
  },
);

/**
 * T-A-005: anti-circularity check-ordering.
 *
 * Pins the doctrine cited in research-grounding.md Finding 4 (Csmith /
 * CompCert lineage): the reconciler decides Rule 4 violations from the
 * receipt's own arithmetic, NOT from any meta-claim the receipt makes
 * about itself. Even if a deliberately-corrupted receipt re-labels its
 * fixture_status as fully verified-and-canonical, the math gate must
 * still fire.
 *
 * If this test ever wrongly passes (i.e. result.ok === true after the
 * mutation), the reconciler has been short-circuiting on a self-claim —
 * the exact failure mode anti-circularity gates are designed to prevent.
 */
test(
  "T-A-005: reconciler ignores fixture_status when detecting Rule 4 violation (anti-circularity)",
  () => {
    const receipt = JSON.parse(readFileSync(fixturePath, "utf-8"));
    // Deliberately re-label the receipt's self-claim to the strongest
    // possible "trust me, the math is fine" stance.
    receipt.fixture_status.verification_state = "engine_reproduced_byte_equal";
    receipt.fixture_status.canonical = true;

    const result = reconcileReceipt(receipt);
    assert.strictEqual(
      result.ok,
      false,
      "anti-circularity: fixture_status meta-claim must NOT suppress Rule 4 detection — " +
        "the reconciler decides from arithmetic, not from the receipt's self-label",
    );
    if (result.ok) return; // type narrowing

    const rule4Failures = result.failures.filter(
      (f: ReconciliationFailure) => f.rule === 4,
    );
    assert.strictEqual(
      rule4Failures.length,
      1,
      `exactly one Rule 4 failure expected (w5 only); got ${rule4Failures.length}: ${JSON.stringify(rule4Failures.map((f) => f.parameter_id))}`,
    );
    const rule4OnW5 = rule4Failures[0]!;
    assert.strictEqual(
      rule4OnW5.parameter_id,
      "w5",
      "Rule 4 must still fire on w5 regardless of relabeled fixture_status",
    );
  },
);

/**
 * T-A-013: unsupported product_order surfaces as a typed Rule-0 failure,
 * NOT a thrown exception.
 *
 * Per the engine agent's E-A-003 amend, reconcile.ts now pushes a Rule 0
 * failure with field_path containing 'product_order' instead of throwing.
 * This keeps callers on a single result-typed code path (no mixed throw +
 * structured-failure stream) and matches how malformed receipts surface
 * to the bp CLI.
 */
/**
 * Rule 4 -> Rule 5 cascade.
 *
 * Per FT-E-017 + the engine agent's "use STORED values" choice (documented
 * in fixtures/bad/mazur.bad-gradient.meta.json
 * cascading_failures_expected_when_other_rules_land):
 *
 *   - The bad-gradient fixture mutates updates[4].gradient but leaves
 *     updates[4].update unchanged.
 *   - When Rule 5 is implemented, it computes lr * STORED_gradient (the
 *     mutated value) and compares against STORED_update. Those disagree by
 *     ~5e-7, so Rule 5 ALSO fires on updates[4].update.
 *   - That second failure must carry cascade_of_rule === 4 so the CLI's
 *     "Note: cascades from Rule 4. Fix Rule 4 first." line surfaces.
 *   - Rule 6 should NOT fire because stored weight_after was derived from
 *     the (unchanged) stored update; weight_before + stored_update is
 *     still consistent with stored weight_after.
 *
 * If the engine has not yet implemented Rule 5 (or chose the recompute
 * path instead of the stored-values path), the cascade marker won't be
 * present and the test skips with a TODO context.
 */
test(
  "T-A-014: Rule 5 cascades from Rule 4 on bad-gradient (engine agent chose stored-values path)",
  (t) => {
    const receipt = JSON.parse(readFileSync(fixturePath, "utf-8"));
    const result = reconcileReceipt(receipt);

    if (result.ok) {
      assert.fail("bad-gradient fixture must still be rejected on Rule 4");
    }

    const rule5OnW5 = result.failures.find(
      (f: ReconciliationFailure) =>
        f.rule === 5 && f.field_path === "updates[4].update",
    );

    if (!rule5OnW5) {
      t.skip(
        `TODO upstream: Rule 5 not implemented yet (or engine agent chose ` +
          `recompute path that hides the cascade). Expected a Rule 5 failure ` +
          `on updates[4].update with cascade_of_rule === 4.`,
      );
      return;
    }

    assert.strictEqual(
      rule5OnW5.cascade_of_rule,
      4,
      `Rule 5 failure on the same parameter as the Rule 4 origin must carry ` +
        `cascade_of_rule === 4; got: ${JSON.stringify(rule5OnW5)}`,
    );

    // Rule 6 should NOT fire — weight_after was derived from the unchanged
    // stored update, so weight_before + stored_update is consistent with
    // stored weight_after to within tolerance.
    const rule6OnW5 = result.failures.find(
      (f: ReconciliationFailure) =>
        f.rule === 6 && f.field_path === "updates[4].weight_after",
    );
    assert.strictEqual(
      rule6OnW5,
      undefined,
      `Rule 6 must NOT fire under the stored-values path (weight_after derived from unchanged stored update); ` +
        `got: ${JSON.stringify(rule6OnW5)}`,
    );
  },
);

test(
  "T-A-013: reconciler returns typed Rule-0 failure on unsupported product_order (not a throw)",
  () => {
    const receipt = JSON.parse(readFileSync(fixturePath, "utf-8"));
    // Cast through unknown so we can write a value the static type
    // forbids — this exercises exactly the "unexpected runtime value"
    // branch the reconciler must defend against.
    (receipt.updates[0].optimizer as { product_order: unknown }).product_order =
      "right_to_left";

    const result = reconcileReceipt(receipt);
    assert.strictEqual(
      result.ok,
      false,
      "unsupported product_order must produce a typed failure, not pass and not throw",
    );
    if (result.ok) return; // type narrowing

    const productOrderFailure = result.failures.find(
      (f: ReconciliationFailure) =>
        f.rule === 0 &&
        typeof f.field_path === "string" &&
        f.field_path.includes("product_order"),
    );
    assert.ok(
      productOrderFailure,
      `expected a Rule 0 failure with field_path containing 'product_order', got: ${JSON.stringify(result.failures, null, 2)}`,
    );
  },
);
