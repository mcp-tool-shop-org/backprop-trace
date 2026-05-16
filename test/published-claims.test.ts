/**
 * T-A-010: Per-claim consistency test for fixtures/mazur.published.json.
 *
 * Pins the invariants every claim in the published ledger must satisfy.
 * Pre-amend the test suite only checked one specific claim
 * (post_update_total_error). A future claim added to the ledger with a
 * malformed `claim_type`, an undefined `reproduction_status`, or a
 * `drift_observed` status missing its `engine_reproduced_value` would
 * not have been caught. This iterates every claim and applies the
 * cross-cutting invariants:
 *
 *   - `claim_type` is one of the keys in `claim_type_legend`
 *   - `reproduction_status` is one of the keys in `reproduction_status_legend`
 *   - `hard_gate` is a boolean
 *   - If `reproduction_status === 'drift_observed'`:
 *       `engine_reproduced_value` AND `drift_absolute` MUST be present;
 *       `drift_absolute === value - engine_reproduced_value` within 1e-15
 *   - If `reproduction_status === 'verified'`:
 *       `engine_reproduced_value` MUST equal `value` within 1e-9 tolerance
 *
 * Keeps the existing claim-id-specific test (post_update_total_error) as a
 * regression guard — it lives in test/mazur.engine.test.ts and remains in
 * place. This file complements it with the per-claim ratchet.
 *
 * Why this matters: research-grounding.md Finding 4 (anti-circularity)
 * extends to the published ledger — a claim that contradicts itself
 * (`drift_observed` without a documented drift) is exactly the silent
 * failure mode the doctrine guards against. This test makes a malformed
 * claim a build break, not a slow-burn drift.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const publishedPath = resolve(__dirname, "../fixtures/mazur.published.json");

type Claim = {
  id: string;
  value: number;
  claim_type: string;
  reproduction_status: string;
  hard_gate: boolean;
  provenance?: string;
  engine_reproduced_value?: number;
  drift_absolute?: number;
  drift_note?: string;
  v0_1_behavior?: string;
};

type Published = {
  claim_type_legend: Record<string, string>;
  reproduction_status_legend: Record<string, string>;
  claims: Claim[];
};

const published = JSON.parse(readFileSync(publishedPath, "utf-8")) as Published;

test("T-A-010: published.json declares non-empty claim_type_legend and reproduction_status_legend", () => {
  assert.ok(
    typeof published.claim_type_legend === "object" &&
      published.claim_type_legend !== null,
    "published.json must declare claim_type_legend",
  );
  assert.ok(
    Object.keys(published.claim_type_legend).length > 0,
    "claim_type_legend must declare at least one entry",
  );
  assert.ok(
    typeof published.reproduction_status_legend === "object" &&
      published.reproduction_status_legend !== null,
    "published.json must declare reproduction_status_legend",
  );
  assert.ok(
    Object.keys(published.reproduction_status_legend).length > 0,
    "reproduction_status_legend must declare at least one entry",
  );
});

test("T-A-010: published.json declares at least one claim", () => {
  assert.ok(
    Array.isArray(published.claims),
    "published.json must declare a claims[] array",
  );
  assert.ok(
    published.claims.length >= 1,
    "published.json must declare at least one claim (v0.1 ships post_update_total_error)",
  );
});

// Per-claim invariants — run as a single test that iterates every claim
// rather than one test per claim. A single test with descriptive failure
// messages is easier to triage than N tests when multiple claims regress
// at once (and the per-claim message names which claim failed which
// invariant).

test("T-A-010: every published claim conforms to legend + drift/verified consistency rules", () => {
  const validClaimTypes = new Set(Object.keys(published.claim_type_legend));
  const validReproductionStatuses = new Set(
    Object.keys(published.reproduction_status_legend),
  );

  for (const claim of published.claims) {
    const claimLabel = `claim '${claim.id}'`;

    // 1. id must be a non-empty string (defends against an array entry
    //    missing its id; later assertions name the claim by id).
    assert.ok(
      typeof claim.id === "string" && claim.id.length > 0,
      `every claim must declare a non-empty id; got ${JSON.stringify(claim)}`,
    );

    // 2. value must be a finite number.
    assert.ok(
      typeof claim.value === "number" && Number.isFinite(claim.value),
      `${claimLabel}: value must be a finite number; got ${String(claim.value)}`,
    );

    // 3. claim_type must be a key in claim_type_legend.
    assert.ok(
      validClaimTypes.has(claim.claim_type),
      `${claimLabel}: claim_type ${JSON.stringify(claim.claim_type)} must be one of ` +
        `${JSON.stringify(Array.from(validClaimTypes))}`,
    );

    // 4. reproduction_status must be a key in reproduction_status_legend.
    assert.ok(
      validReproductionStatuses.has(claim.reproduction_status),
      `${claimLabel}: reproduction_status ${JSON.stringify(claim.reproduction_status)} must be one of ` +
        `${JSON.stringify(Array.from(validReproductionStatuses))}`,
    );

    // 5. hard_gate must be a boolean.
    assert.strictEqual(
      typeof claim.hard_gate,
      "boolean",
      `${claimLabel}: hard_gate must be a boolean; got ${String(claim.hard_gate)} (type ${typeof claim.hard_gate})`,
    );

    // 6. drift_observed-specific invariants
    if (claim.reproduction_status === "drift_observed") {
      assert.ok(
        typeof claim.engine_reproduced_value === "number" &&
          Number.isFinite(claim.engine_reproduced_value),
        `${claimLabel}: reproduction_status='drift_observed' requires a finite engine_reproduced_value; ` +
          `got ${String(claim.engine_reproduced_value)}`,
      );
      assert.ok(
        typeof claim.drift_absolute === "number" &&
          Number.isFinite(claim.drift_absolute),
        `${claimLabel}: reproduction_status='drift_observed' requires a finite drift_absolute; ` +
          `got ${String(claim.drift_absolute)}`,
      );
      const expectedDrift = claim.value - claim.engine_reproduced_value!;
      assert.ok(
        Math.abs(claim.drift_absolute! - expectedDrift) < 1e-15,
        `${claimLabel}: drift_absolute must equal (value - engine_reproduced_value) within 1e-15; ` +
          `value=${claim.value}, engine=${claim.engine_reproduced_value}, ` +
          `expected_drift=${expectedDrift}, stored_drift=${claim.drift_absolute}`,
      );
    }

    // 7. verified-specific invariants
    if (claim.reproduction_status === "verified") {
      assert.ok(
        typeof claim.engine_reproduced_value === "number" &&
          Number.isFinite(claim.engine_reproduced_value),
        `${claimLabel}: reproduction_status='verified' requires a finite engine_reproduced_value; ` +
          `got ${String(claim.engine_reproduced_value)}`,
      );
      assert.ok(
        Math.abs(claim.engine_reproduced_value! - claim.value) <= 1e-9,
        `${claimLabel}: reproduction_status='verified' requires engine_reproduced_value within 1e-9 of value; ` +
          `value=${claim.value}, engine=${claim.engine_reproduced_value}, ` +
          `abs_diff=${Math.abs(claim.engine_reproduced_value! - claim.value)}`,
      );
    }
  }
});

test(
  "T-A-010: regression guard — post_update_total_error claim still present with drift_observed + hard_gate=false",
  () => {
    const claim = published.claims.find((c) => c.id === "post_update_total_error");
    assert.ok(
      claim,
      "post_update_total_error claim must remain in published.json — it is the load-bearing " +
        "anchor claim for the v0.1 drift contract (engine value vs widely-cited downstream anchor).",
    );
    assert.strictEqual(
      claim!.reproduction_status,
      "drift_observed",
      "post_update_total_error must remain reproduction_status='drift_observed' — flipping to " +
        "'verified' would silently change the v0.1 verify outcome semantics from WARN to PASS.",
    );
    assert.strictEqual(
      claim!.hard_gate,
      false,
      "post_update_total_error must remain hard_gate=false — flipping to true would turn the " +
        "documented drift into a release-blocking failure with no other change.",
    );
  },
);
