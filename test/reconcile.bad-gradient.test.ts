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

/**
 * G-006: GATED-Rule-14 ratchet — a self-declared math-gate skip must be
 * DETECTABLE, never mistaken for a clean full PASS.
 *
 * A receipt can disable its own anti-laundering gate by declaring
 * fixture_status.verification_state === "engine_recompute_skipped_with_basis"
 * (Rule 14 returns early; Rule 15 is satisfied by a valid skip_basis). Before
 * G-006, reconcileReceipt then returned a bare { ok: true } with NO signal the
 * math gate was skipped — so a consumer could not tell a self-declared-skip
 * apart from a fully-verified PASS. The skip behavior is by-design (per docs);
 * the soundness fix is to make it MACHINE-READABLE.
 *
 * This test ACTUALLY forges an engine-input field (parameters_before) on an
 * observer receipt so the engine recompute WOULD diverge if Rule 14 ran, then
 * declares the skip-with-basis. The receipt still reconciles ok:true (the skip
 * is honored AND the forge is invisible to every non-Rule-14 check), but the
 * result MUST carry the math_gate_skipped signal naming Rule 14 — qualifying the
 * PASS. The forge is on the hidden bias b_hidden, shifted EQUALLY in both
 * parameters_before and parameters_after so the constant-bias invariant
 * (before == after) holds and NO internal-consistency rule objects — only the
 * (skipped) engine recompute would have caught it. A pinned CONTROL inside the
 * test proves that premise: the same forge WITHOUT the skip fires exactly
 * Rule 14.
 *
 * Non-vacuity: removing the G-006 signal (math_gate_skipped / skipped_rules)
 * makes this test RED.
 */
test(
  "G-006: external receipt that self-declares engine_recompute_skipped_with_basis surfaces math_gate_skipped (Rule 14 skip is detectable EVEN when the skipped gate would have failed)",
  () => {
    const goldenPath = resolve(
      __dirname,
      "../fixtures/external/pytorch.softmax-ce.golden.jsonl",
    );

    // CONTROL — prove the forge actually WOULD fail the math gate. Apply the
    // exact same parameters_before forge WITHOUT declaring the skip; the engine
    // recompute must diverge and fire EXACTLY Rule 14 (the bias invariant keeps
    // every internal-consistency rule silent). If this control did not fire
    // Rule 14, the main assertion below would be vacuous.
    {
      const control = JSON.parse(readFileSync(goldenPath, "utf-8").trim()) as {
        parameters_before: Record<string, number> & { b_hidden: number };
        parameters_after: Record<string, number> & { b_hidden: number };
      };
      control.parameters_before.b_hidden += 0.05;
      control.parameters_after.b_hidden += 0.05; // preserve constant-bias invariant
      const controlResult = reconcileReceipt(control);
      assert.strictEqual(
        controlResult.ok,
        false,
        "CONTROL: the b_hidden forge must make the receipt fail when the math gate is NOT skipped — " +
          "otherwise the skip-detection assertion is vacuous (the gate had nothing to catch)",
      );
      if (!controlResult.ok) {
        const rulesFired = [
          ...new Set(controlResult.failures.map((f) => f.rule)),
        ].sort((a, b) => a - b);
        assert.deepStrictEqual(
          rulesFired,
          [14],
          `CONTROL: the b_hidden forge must be caught by EXACTLY Rule 14 (engine recompute) — ` +
            `the constant-bias invariant keeps every other rule silent, so Rule 14 is the sole gate ` +
            `that would object. Got rules: ${rulesFired.join(",")}`,
        );
      }
    }

    const receipt = JSON.parse(readFileSync(goldenPath, "utf-8").trim()) as {
      fixture_status: { verification_state?: string };
      attestor: { skip_basis?: string };
      parameters_before: Record<string, number> & { b_hidden: number };
      parameters_after: Record<string, number> & { b_hidden: number };
    };

    // Forge the engine-input field: shift the hidden bias b_hidden EQUALLY in
    // both parameters_before and parameters_after. The forward pass consumes
    // b_hidden, so an engine recompute (Rule 14) diverges; but the constant-bias
    // invariant (before == after) holds, so every internal-consistency rule
    // stays silent — ONLY the (skipped) Rule 14 would have objected. This is the
    // forge the docstring describes, now actually applied (it was previously
    // only described in a comment and never performed).
    receipt.parameters_before.b_hidden += 0.05;
    receipt.parameters_after.b_hidden += 0.05;

    // Self-declare the skip with a valid basis so Rule 15 is satisfied and
    // Rule 14 short-circuits.
    receipt.fixture_status.verification_state =
      "engine_recompute_skipped_with_basis";
    receipt.attestor.skip_basis = "hardware_nondeterminism";

    const result = reconcileReceipt(receipt) as {
      ok: boolean;
      math_gate_skipped?: boolean;
      skipped_rules?: number[];
      failures?: ReconciliationFailure[];
    };

    // A self-declared skip must NOT be silently treated as a clean full PASS:
    // the result must carry a machine-readable signal that the math gate was
    // skipped (either math_gate_skipped===true or skipped_rules includes 14).
    // Crucially, this holds EVEN THOUGH the (now-applied) forge means the
    // skipped gate WOULD have failed — the skip flag cannot be suppressed by
    // the fact that there was something to catch.
    const signalsSkip =
      result.math_gate_skipped === true ||
      (Array.isArray(result.skipped_rules) &&
        result.skipped_rules.includes(14));
    assert.ok(
      signalsSkip,
      `a receipt that self-declares engine_recompute_skipped_with_basis MUST surface ` +
        `the math-gate-skip signal (math_gate_skipped===true or skipped_rules includes 14) so ` +
        `ok:true is qualified — a self-declared skip cannot masquerade as full verification, ` +
        `even when the skipped gate would have caught a forged engine input. ` +
        `Got: ${JSON.stringify({ ok: result.ok, math_gate_skipped: result.math_gate_skipped, skipped_rules: result.skipped_rules })}`,
    );
  },
);

/**
 * G-006 negative control: a receipt that did NOT skip the math gate must NOT
 * carry the math_gate_skipped signal. Pins that the signal means what it says
 * (a fully-verified observer receipt is not falsely flagged as skipped).
 */
test(
  "G-006: an observer receipt with the math gate ENGAGED does NOT carry math_gate_skipped",
  () => {
    const goldenPath = resolve(
      __dirname,
      "../fixtures/external/pytorch.softmax-ce.golden.jsonl",
    );
    const receipt = JSON.parse(readFileSync(goldenPath, "utf-8").trim());
    const result = reconcileReceipt(receipt) as {
      ok: boolean;
      math_gate_skipped?: boolean;
      skipped_rules?: number[];
    };
    assert.strictEqual(
      result.ok,
      true,
      "pytorch observer golden must reconcile cleanly with the math gate engaged",
    );
    assert.notStrictEqual(
      result.math_gate_skipped,
      true,
      "math_gate_skipped must be absent/false when Rule 14 actually ran",
    );
    assert.ok(
      !Array.isArray(result.skipped_rules) ||
        !result.skipped_rules.includes(14),
      "skipped_rules must not include 14 when Rule 14 actually ran",
    );
  },
);

/**
 * G-007: an UNRECOGNIZED optimizer.name must not silently bypass every
 * update-equation rule.
 *
 * Rule 5 gates off for any optimizer.name !== 'sgd'; Rule 21 only fires for
 * 'sgd_momentum'; Rule 24 only for 'adam'/'adamw'. So an optimizer the
 * reconciler does not recognize (e.g. 'lamb') has NO rule checking
 * update == f(gradient) — a FABRICATED update sails through, an
 * active-false-assurance (the worst defect for this inverted threat model).
 *
 * The fix: reconcileReceipt emits a Rule 0 structural failure when any
 * optimizer name is outside the recognized set {sgd, adam, adamw,
 * sgd_momentum}, rather than silently skipping all update-equation rules.
 *
 * Non-vacuity: the FABRICATED update below is gibberish (gradient unchanged,
 * Rule 4 still passes). Without the G-007 Rule 0 gate, the receipt reconciles
 * ok:true despite update != lr*gradient — so removing the gate makes this
 * test RED.
 */
test(
  "G-007: a receipt with an UNRECOGNIZED optimizer.name ('lamb') is rejected (Rule 0), not silently accepted",
  () => {
    const goldenPath = resolve(__dirname, "../fixtures/mazur.golden.jsonl");
    const receipt = JSON.parse(readFileSync(goldenPath, "utf-8")) as {
      updates: Array<{
        parameter_id: string;
        optimizer: { name: string };
        gradient: number;
        update: number;
      }>;
    };
    // Relabel every update's optimizer to an unrecognized name AND fabricate
    // one update value. Keep `gradient` consistent with factors so Rule 4
    // still passes — isolating the "no update-equation rule fires" gap.
    for (const u of receipt.updates) u.optimizer.name = "lamb";
    receipt.updates[4]!.update = receipt.updates[4]!.update + 1.0; // gross fabrication

    const result = reconcileReceipt(receipt);
    assert.strictEqual(
      result.ok,
      false,
      "an unrecognized optimizer.name must be rejected — silently skipping every " +
        "update-equation rule lets a fabricated update pass (active false assurance)",
    );
    if (result.ok) return;
    const rule0 = result.failures.find(
      (f: ReconciliationFailure) =>
        f.rule === 0 &&
        /optimizer/i.test(f.field_path) &&
        /unrecognized|unsupported|outside/i.test(f.message ?? ""),
    );
    assert.ok(
      rule0,
      `expected a Rule 0 structural failure naming the unrecognized optimizer; got: ${JSON.stringify(
        result.failures.map((f) => ({ rule: f.rule, field_path: f.field_path, message: f.message })),
      )}`,
    );
  },
);

/**
 * G-007 control via top-level optimizer_config.name: an unrecognized name in
 * the top-level optimizer_config block is also rejected. (The finding names
 * BOTH update.optimizer.name and optimizer_config.name as the surface.)
 */
test(
  "G-007: an unrecognized top-level optimizer_config.name is rejected (Rule 0)",
  () => {
    const goldenPath = resolve(__dirname, "../fixtures/mazur.golden.jsonl");
    const receipt = JSON.parse(readFileSync(goldenPath, "utf-8")) as Record<
      string,
      unknown
    >;
    // Inject an unrecognized top-level optimizer_config.name. Updates remain
    // 'sgd' (recognized), so ONLY the top-level config name is the offender.
    receipt.optimizer_config = { name: "shampoo", learning_rate: 0.5 };
    const result = reconcileReceipt(receipt);
    assert.strictEqual(
      result.ok,
      false,
      "an unrecognized optimizer_config.name must be rejected (Rule 0)",
    );
    if (result.ok) return;
    assert.ok(
      result.failures.some(
        (f: ReconciliationFailure) =>
          f.rule === 0 && /optimizer/i.test(f.field_path),
      ),
      "expected a Rule 0 failure on the unrecognized optimizer_config.name",
    );
  },
);

/**
 * G-007 positive control: a recognized optimizer ('sgd') with consistent math
 * still reconciles ok:true. Pins that the recognized-set gate does not break
 * honest receipts (anti-vacuity for the gate itself).
 */
test(
  "G-007: a recognized optimizer ('sgd') with consistent math still passes",
  () => {
    const goldenPath = resolve(__dirname, "../fixtures/mazur.golden.jsonl");
    const receipt = JSON.parse(readFileSync(goldenPath, "utf-8"));
    const result = reconcileReceipt(receipt);
    assert.strictEqual(
      result.ok,
      true,
      `recognized-optimizer golden must still pass; got: ${
        result.ok === false
          ? JSON.stringify(result.failures.map((f) => ({ rule: f.rule, field_path: f.field_path })))
          : "ok"
      }`,
    );
  },
);
