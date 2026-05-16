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
const FILENAME_KIND_TO_RULE: Record<string, number> = {
  "bad-gradient": 4,
  // v0.2.0 — all 8 reconciliation rules wired with paired fixtures:
  "bad-output-signal": 1,
  "bad-contribution": 2,
  "bad-backprop-sum": 2,
  "bad-hidden-signal": 3,
  "bad-update-value": 5,
  "bad-weight-after": 6,
  "bad-params-after": 7,
  "bad-provenance": 8,
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
      const m = file.match(/mazur\.bad-([a-z0-9-]+)\.jsonl$/);
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
  "T-A-009: v0.2 reconciler implements all 8 reconciliation rules (scope-extend over E-A-004)",
  () => {
    const implemented = extractImplementedRules();
    assert.deepStrictEqual(
      Array.from(implemented).sort((a, b) => a - b),
      [1, 2, 3, 4, 5, 6, 7, 8],
      "v0.2 reconciler scope is Rules 1-8 (E-A-004 v0.1 Rule-4-only scope was extended in v0.2). " +
        "When v0.3 adds a new rule, update this expected list AND ship a sibling bad-* fixture. " +
        "The previous test (every-rule-has-a-fixture) will fail loudly if you forget the fixture.",
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
