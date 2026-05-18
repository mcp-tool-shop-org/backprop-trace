/**
 * T-A-009: Doctrine-ratchet test — every implemented rule has a bad-* fixture.
 *
 * Closes the deferred T-A-009 finding from Stage A. Implements the Csmith /
 * CompCert anti-circularity doctrine described in research-grounding.md
 * Finding 4: a reconciliation rule that the engine emits but no bad fixture
 * exercises is a rule the test suite cannot prove rejects bad receipts. The
 * doctrine: "bad receipts precede good receipts." This test fails the build
 * if a rule lands in reconcile.ts without an accompanying bad-* fixture.
 *
 * Mapping strategy:
 *
 *   - Extract the set of rule numbers the reconciler can EMIT by scanning
 *     src/reconcile.ts for `rule:\s*(\d+)` occurrences. Rule 0 is excluded
 *     because it is the structural-failure sentinel, not one of the eight
 *     documented reconciliation rules — and structural failures are covered
 *     by separate test paths (NaN-poisoning, malformed product_order, etc.)
 *     rather than dedicated bad-* fixtures.
 *
 *   - For each non-zero rule found, assert at least one `fixtures/bad/*.jsonl`
 *     fixture targets that rule. The mapping is via the sibling meta file
 *     (`fixtures/bad/<name>.meta.json`), which carries a stable
 *     `reconciliation_check_targeted_first` field naming the rule, OR the
 *     filename convention `mazur.bad-<kind>.jsonl` where the kind maps to a
 *     known rule (gradient → 4, etc.). The meta file is the load-bearing
 *     source of truth — filename mapping is a fallback so future fixtures
 *     can ship with descriptive names.
 *
 * v0.2 status: all 8 reconciliation rules are implemented. Each rule has
 * at least one paired bad-* fixture under fixtures/bad/. Test should PASS
 * today. (v0.1 scope was Rule 4 only per E-A-004; v0.2 extended to the
 * full 8-rule docs/reconciliation.md surface.)
 *
 * Why this test ratchets: when v0.3 implements a new rule (say Rule 9 for
 * a new check), src/reconcile.ts grows a `rule: 9` push, this test
 * extracts {1, 2, ..., 8, 9}, asserts all have fixtures, and FAILS until
 * a bad-* fixture for Rule 9 ships. That is the intended ratchet behavior
 * — it forces the bad fixture to land before the implementation can be
 * merged.
 *
 * The anti-circularity ratchet from T-A-005 (reconciler ignores
 * fixture_status when detecting Rule 4) is verified separately by
 * test/reconcile.bad-gradient.test.ts — this test merely confirms that file
 * is still present, so a future refactor that deletes it would surface here.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "..");
const reconcileSourcePath = resolve(repoRoot, "src/reconcile.ts");
const badFixturesDir = resolve(repoRoot, "fixtures/bad");
const antiCircularityTestPath = resolve(
  repoRoot,
  "test/reconcile.bad-gradient.test.ts",
);

// Known filename → rule mapping. New names should add an entry here OR
// declare the rule via the meta file's `reconciliation_check_targeted_first`
// field. The meta file wins when both are present.
//
// Keys correspond to the capture group from
// `^[a-z0-9-]+\.bad-([a-z0-9-]+)\.jsonl$` (the kind after `bad-`). For
// historical compatibility we ALSO accept keys prefixed with `bad-`
// (the v0.2 spelling); the lookup tries both forms.
const FILENAME_KIND_TO_RULE: Record<string, number> = {
  // v0.2 keys (kept for back-compat — meta-file mapping is the canonical
  // path for the mazur.* fixtures, so these entries mostly serve as
  // documentation).
  "bad-gradient": 4,
  "bad-output-signal": 1,
  "bad-contribution": 2,
  "bad-backprop-sum": 2,
  "bad-hidden-signal": 3,
  "bad-update-value": 5,
  "bad-weight-after": 6,
  "bad-params-after": 7,
  "bad-provenance": 8,
  // v0.3 keys: regex capture is "chain" / "trace-id" (without bad- prefix).
  // The v0.2 mazur fixtures route through the meta-file path because their
  // meta files declare reconciliation_check_targeted_first; the v0.3
  // multi-step fixtures don't (yet), so they route through this fallback.
  // Both prefixed AND unprefixed forms are listed so a future meta-less
  // mazur fixture would still resolve.
  "gradient": 4,
  "output-signal": 1,
  "contribution": 2,
  "backprop-sum": 2,
  "hidden-signal": 3,
  "update-value": 5,
  "weight-after": 6,
  "params-after": 7,
  "provenance": 8,
  "chain": 9,
  "trace-id": 10,
  // v0.4 per-neuron bias fixture name patterns (Agent F's contract from
  // consolidator-decision §5). Each maps to the rule the bad fixture is
  // designed to surface:
  //   - bad-bias-gradient        => Rule 4 (update.gradient consistency)
  //   - bad-bias-update-value    => Rule 5 (update == lr * gradient)
  //   - bad-bias-weight-after    => Rule 6 (weight_after == weight_before + update)
  //   - bad-bias-params-after    => Rule 7 (parameters_after sum consistency)
  //   - bad-bias-provenance      => Rule 8 (factor.from resolves to factor.value)
  //   - bad-bias-mode-mismatch   => Rule 0 (structural: bias_policy.mode vs updates[*].kind)
  //
  // Both v0.2-prefixed and v0.3-unprefixed keys are listed so meta-less
  // fixtures (which use the unprefixed kind capture from
  // `<prefix>.bad-<kind>.jsonl`) and meta-bearing fixtures both resolve.
  "bad-bias-gradient": 4,
  "bad-bias-update-value": 5,
  "bad-bias-weight-after": 6,
  "bad-bias-params-after": 7,
  "bad-bias-provenance": 8,
  "bad-bias-mode-mismatch": 0,
  "bias-gradient": 4,
  "bias-update-value": 5,
  "bias-weight-after": 6,
  "bias-params-after": 7,
  "bias-provenance": 8,
  "bias-mode-mismatch": 0,
  // v0.4.1 Rule 0 sub-checks (bias_sharing / kind-vs-role / topology size).
  "bad-bias-sharing-mismatch": 0,
  "bad-kind-vs-role": 0,
  "bad-topology-size": 0,
  "bias-sharing-mismatch": 0,
  "kind-vs-role": 0,
  "topology-size": 0,
  // v0.4.2 Rule 12 (loss formula consistency, half_squared_error branch).
  "bad-loss-total": 12,
  "loss-total": 12,
  // v0.5 softmax+CE Rule 11 + Rule 12 CE branch + Rule 13 (gated dual-form).
  // Rule 0.8 (probability bounds) is a Rule 0 sub-check — the failure record
  // uses rule: 0, so its fixture maps to 0, not 0.8.
  "bad-prob-bound": 0,
  "prob-bound": 0,
  "bad-softmax-sum": 11,
  "softmax-sum": 11,
  "bad-ce-per-output": 12,
  "ce-per-output": 12,
  "bad-ce-total": 12,
  "ce-total": 12,
  "bad-dual-term": 13,
  "dual-term": 13,
  "bad-dual-sum": 13,
  "dual-sum": 13,
  "bad-collapsed-vs-dual": 13,
  "collapsed-vs-dual": 13,
  // v0.6 external trace ingestion (Rules 14/15/16).
  // Rule 0.8 still fires on framework-spoof/trusted-source-bad-math (rule: 0).
  // Rule 7 is the catchall for partial-tamper (existing rule, on the ingest path).
  "bad-shape-not-math": 12,
  "shape-not-math": 12,
  "bad-framework-spoof": 0,
  "framework-spoof": 0,
  "bad-collapsed-laundered": 14,
  "collapsed-laundered": 14,
  "bad-skip-without-basis": 15,
  "skip-without-basis": 15,
  "bad-attested-mutated-after": 16,
  "attested-mutated-after": 16,
  "bad-partial-tamper-internally-consistent": 7,
  "partial-tamper-internally-consistent": 7,
  "bad-trusted-source-bad-math": 0,
  "trusted-source-bad-math": 0,
  "bad-engine-reproduce-disagrees": 14,
  "engine-reproduce-disagrees": 14,
  // v0.6.1 JAX-specific bad fixture (pytree-flatten-order swap; Rule 14
  // catches via differential, Rule 7 catches via final-state — both
  // fire on the same fixture).
  "bad-pytree-flatten-order": 14,
  "pytree-flatten-order": 14,
  // v0.7.0 TensorFlow-specific bad fixture (variable-list-order swap;
  // extractor sorted model.trainable_variables alphabetically by var.name
  // instead of preserving creation order; same Rule 14 + Rule 7 firing
  // shape as JAX's pytree-flatten-order; framework-distinctive root cause).
  "bad-variable-list-order": 14,
  "variable-list-order": 14,
  // v0.8 multi-step observer-mode adversarial plate (cross-step attacks
  // on the JSONL stream produced by `bp import {pytorch,jax,tensorflow}
  // multi`). Each fixture targets one rule:
  //   - step-index-gap                                → Rule 10
  //   - chain-break-cross-step-internally-consistent  → Rule 9 (load-bearing)
  //   - fabricated-mid-step                           → Rule 9
  //   - cross-trace-splice                            → Rule 17 (bundle-integrity, NOT authenticity)
  //   - bundle-digest-tampered                        → Rule 17
  "bad-step-index-gap": 10,
  "step-index-gap": 10,
  "bad-chain-break-cross-step-internally-consistent": 9,
  "chain-break-cross-step-internally-consistent": 9,
  "bad-fabricated-mid-step": 9,
  "fabricated-mid-step": 9,
  "bad-cross-trace-splice": 17,
  "cross-trace-splice": 17,
  "bad-bundle-digest-tampered": 17,
  "bundle-digest-tampered": 17,
  // v0.9 batched observer-mode adversarial plate (batch.bad-*):
  //   - reduction-mode-mismatch  → Rule 18 (loss.total != reduction(per_sample))
  //   - sample-id-missing        → Rule 19 (per-sample map missing sample_id)
  //   - sample-order-duplicate   → Rule 19 (batch.sample_order has duplicate)
  //   - reduced-gradient-wrong   → Rule 14 (engine recompute disagrees on reduced gradient)
  "bad-reduction-mode-mismatch": 18,
  "reduction-mode-mismatch": 18,
  "bad-sample-id-missing": 19,
  "sample-id-missing": 19,
  "bad-sample-order-duplicate": 19,
  "sample-order-duplicate": 19,
  "bad-reduced-gradient-wrong": 14,
  "reduced-gradient-wrong": 14,
};

/**
 * Extract the set of rule numbers the reconciler can emit. Looks for any
 * `rule:` literal followed by a number in src/reconcile.ts. Rule 0 is
 * excluded — it is the structural-failure sentinel, not one of the eight
 * documented rules. Type/interface declarations that mention `rule: number`
 * are filtered out by the digit requirement.
 */
function extractImplementedRules(): Set<number> {
  const source = readFileSync(reconcileSourcePath, "utf-8");
  const matches = source.matchAll(/rule:\s*(\d+)/g);
  const rules = new Set<number>();
  for (const m of matches) {
    const n = parseInt(m[1]!, 10);
    if (n > 0) rules.add(n);
  }
  return rules;
}

/**
 * For each bad fixture file, extract the rule it targets. Strategy:
 *   1. Read the sibling `.meta.json` if present — look for
 *      `reconciliation_check_targeted_first` (a string like "Rule 4: ...").
 *   2. Otherwise extract the "kind" from the filename
 *      (`mazur.bad-<kind>.jsonl`) and look it up in FILENAME_KIND_TO_RULE.
 */
function collectFixtureRuleCoverage(): Map<number, string[]> {
  const coverage = new Map<number, string[]>();
  if (!existsSync(badFixturesDir)) return coverage;

  const files = readdirSync(badFixturesDir).filter((f) => f.endsWith(".jsonl"));
  for (const file of files) {
    const fullPath = resolve(badFixturesDir, file);
    const metaPath = fullPath.replace(/\.jsonl$/, ".meta.json");

    let rule: number | undefined;

    if (existsSync(metaPath)) {
      try {
        const meta = JSON.parse(readFileSync(metaPath, "utf-8")) as {
          reconciliation_check_targeted_first?: string;
        };
        const target = meta.reconciliation_check_targeted_first;
        if (typeof target === "string") {
          const m = target.match(/Rule\s+(\d+)/i);
          if (m) rule = parseInt(m[1]!, 10);
        }
      } catch {
        // Ignore malformed meta — fall through to filename heuristic.
      }
    }

    if (rule === undefined) {
      // Generalized prefix-bearing kind: `<prefix>.bad-<kind>.jsonl` matches
      // `mazur.bad-gradient.jsonl`, `multi-step.bad-chain.jsonl`, etc. The
      // prefix names the fixture family (mazur receipt vs multi-step
      // sequence); the kind names the rule. v0.3 extends from the v0.2
      // mazur-only convention with `multi-step.bad-{chain,trace-id}.jsonl`.
      const m = file.match(/^[a-z0-9-]+\.bad-([a-z0-9-]+)\.jsonl$/);
      if (m) {
        const kind = m[1]!;
        const known = FILENAME_KIND_TO_RULE[kind];
        if (known !== undefined) rule = known;
      }
    }

    if (rule !== undefined) {
      const arr = coverage.get(rule) ?? [];
      arr.push(file);
      coverage.set(rule, arr);
    }
  }
  return coverage;
}

test(
  "T-A-009: every implemented reconciliation rule has at least one fixtures/bad/*.jsonl fixture",
  () => {
    const implemented = extractImplementedRules();
    assert.ok(
      implemented.size > 0,
      "extract failed: no `rule: <n>` matches found in src/reconcile.ts " +
        "(test cannot verify doctrine without source). Check the regex.",
    );

    const coverage = collectFixtureRuleCoverage();

    const missing: number[] = [];
    for (const rule of implemented) {
      if (!coverage.has(rule)) {
        missing.push(rule);
      }
    }
    missing.sort((a, b) => a - b);

    assert.deepStrictEqual(
      missing,
      [],
      `Anti-circularity doctrine breach: rules ${JSON.stringify(missing)} are implemented in ` +
        `src/reconcile.ts but have no bad fixture under fixtures/bad/. ` +
        `Doctrine (Csmith/CompCert; research-grounding.md Finding 4): "bad receipts precede good ` +
        `receipts." Ship a fixtures/bad/*.jsonl fixture targeting each rule and either annotate the ` +
        `meta file with reconciliation_check_targeted_first: "Rule N: ..." OR follow the ` +
        `mazur.bad-<kind>.jsonl naming convention with a known kind. Current coverage map: ` +
        `${JSON.stringify(Object.fromEntries(coverage), null, 2)}`,
    );
  },
);

test(
  "T-A-009: v0.9 reconciler implements Rules 1-19 (1-8 per-receipt, 9-10 multi-step, 11 softmax-norm, 12 loss formula, 13 gated dual-form, 14 engine-recompute differential, 15 skip-basis required, 16 gated digest binding, 17 gated trace-bundle binding, 18 gated batch reduction consistency, 19 gated sample-set coherence)",
  () => {
    const implemented = extractImplementedRules();
    assert.deepStrictEqual(
      Array.from(implemented).sort((a, b) => a - b),
      [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19],
      "v0.9 reconciler scope: Rules 1-8 (per-receipt math), 9-10 (multi-step), 11 (softmax " +
        "normalization), 12 (loss formula — both half_squared_error and cross_entropy_softmax " +
        "branches), 13 (GATED dual-form consistency for softmax+CE), 14 (engine-recompute " +
        "differential — MANDATORY for fixture_status.authoring_state === 'external_imported'; " +
        "no-op for engine-authored receipts), 15 (skip-basis required — when verification_state " +
        "is 'engine_recompute_skipped_with_basis', attestor.skip_basis must be in the closed " +
        "EXTERNAL_TRUST_BASIS enum), 16 (attestation digest binding — GATED on " +
        "attestor.signed_subject_digest presence), 17 (trace-bundle binding — GATED on " +
        "attestor.bundle_root_digest presence; BUNDLE INTEGRITY check, NOT producer-" +
        "authenticity), 18 (batch reduction consistency — GATED on receipt.batch presence + " +
        "loss.reduction in {mean,sum}; catches mean-vs-sum confusion), 19 (sample-set " +
        "coherence — GATED on batch.sample_order presence; precisely scoped to ordered " +
        "per-sample projections used for reduction / emission / canonical digest construction). " +
        "Rule 0.8 (probability bounds) remains a Rule 0 sub-check, not a separate integer rule. " +
        "When a future version adds a new rule, update this expected list AND ship a sibling " +
        "bad-* fixture; the doctrine ratchet fails loudly if a rule lands without its paired " +
        "fixture.",
    );
  },
);

test(
  "T-A-009: anti-circularity ratchet test file (test/reconcile.bad-gradient.test.ts) is present",
  () => {
    assert.ok(
      existsSync(antiCircularityTestPath),
      "T-A-005 anti-circularity subtest lives in test/reconcile.bad-gradient.test.ts. " +
        "If this file is missing, the reconciler-ignores-fixture_status invariant has lost " +
        "its protective test. Restore the file or move the subtest before deletion.",
    );

    const text = readFileSync(antiCircularityTestPath, "utf-8");
    assert.match(
      text,
      /anti-circularity/i,
      "T-A-005 subtest must remain in test/reconcile.bad-gradient.test.ts with the " +
        "'anti-circularity' label (search anchor for cross-file references).",
    );
    assert.match(
      text,
      /fixture_status/,
      "T-A-005 subtest must reference fixture_status (the mutated field) so deletion " +
        "of the relevant block is loud, not silent.",
    );
  },
);
