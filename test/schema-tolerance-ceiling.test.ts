/**
 * G-004 [CRITICAL] — schema-level upper bounds on verifier tolerances.
 *
 * THREAT MODEL (inverted): a FALSE PASS is the worst defect. The reconciler
 * judges a receipt's claims using the tolerance THE RECEIPT DECLARES
 * (numeric_policy.tolerance for the canonical reconciliation; attestor.
 * differential_tolerance for Rule 14's engine-recompute differential). If a
 * receipt can declare an arbitrarily loose tolerance, it controls the
 * strictness of the check that judges it — a corrupted receipt declares
 * {atol: 1e9, rtol: 1e9}, every disagreement falls inside tolerance, and a
 * defect that SHOULD be rejected is accepted. Active false assurance.
 *
 * DEFENSE: the reconciler clamp (reconciler agent) is the load-bearing gate.
 * THIS file pins the defense-in-depth SCHEMA maximum that rejects an absurd
 * tolerance early on every schema-validated path. The ceilings are pinned
 * (verifier-owned, NOT receipt-owned).
 *
 *   numeric_policy.tolerance:           atol <= 1e-5, rtol <= 1e-3
 *                                       scalar form (number) <= 1e-5
 *   attestor.differential_tolerance:    atol <= 1e-5, rtol <= 1e-3
 *
 * FIX-3c — the SCHEMA numeric_policy.tolerance maximum is the OBSERVER bound
 * {atol 1e-5, rtol 1e-3}, NOT the tighter ENGINE bound. Rationale: the schema
 * is defense-in-depth (it rejects absurd tolerances on every validated path);
 * the LOAD-BEARING numeric gate is the RECONCILER's authoring-aware clamp,
 * which enforces the TIGHTER engine bound ({atol 1e-8, rtol 1e-6},
 * NUMERIC_TOLERANCE_CEILING) on engine-authored receipts and the looser
 * OBSERVER_NUMERIC_TOLERANCE_CEILING {atol 1e-5, rtol 1e-3} on
 * external_imported receipts. If the SCHEMA kept the engine bound it would
 * reject a legitimate float32-grade observer receipt (declaring up to {1e-5,
 * 1e-3}) before the reconciler ever saw it — the false-FAIL FIX-3b/FIX-3c
 * close. So the schema relaxes to the observer bound and lets the reconciler
 * be the strict, authoring-aware authority. attestor.differential_tolerance
 * keeps its {atol 1e-5, rtol 1e-3} maximum (UNCHANGED) — that is already the
 * observer bound and Rule 14 is the real differential authority.
 *
 * NON-VACUITY: each rejection test asserts ok:false. The mutation that
 * makes it go RED again is "delete the `maximum` keyword from atol/rtol/the
 * scalar branch in the corresponding schema" — without the maximum, Ajv
 * accepts {atol:1e9, rtol:1e9} (minimum:0 only) and the test fails. The
 * boundary tests further pin the EXACT ceiling: at-ceiling accepts,
 * just-over rejects, so a wrong maximum value (e.g. a too-tight 1e-8/1e-6
 * instead of the relaxed 1e-5/1e-3) also makes the suite go red.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import {
  validateReceiptSchema,
  validateTopologyInput,
  validateFrameworkTraceSidecar,
} from "../src/validate.js";
import {
  SCHEMA_VERSIONS,
  FRAMEWORK_TRACE_SCHEMA_VERSIONS,
  type SchemaVersion,
} from "../src/schema-loader.js";
import { XOR_INPUT } from "../src/mazur.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "..");

function loadJsonl(rel: string): Record<string, unknown> {
  const p = resolve(repoRoot, rel);
  return JSON.parse(readFileSync(p, "utf-8").trim().split(/\r?\n/)[0]!) as Record<
    string,
    unknown
  >;
}

// Deep clone so each test mutates an independent copy.
function clone<T>(o: T): T {
  return JSON.parse(JSON.stringify(o)) as T;
}

// --- bases -----------------------------------------------------------------
// xor golden (schema_version 0.2.0): object-form numeric_policy.tolerance,
// no attestor — the canonical base for the numeric_policy ceiling.
const XOR = "fixtures/xor.golden.jsonl";
// pytorch external golden (schema_version 0.4.0): carries
// attestor.differential_tolerance — the base for the Rule 14 ceiling.
const PYTORCH_EXT = "fixtures/external/pytorch.softmax-ce.golden.jsonl";
// pytorch sidecar (format framework-trace.v0.1.0): carries
// numeric_policy.tolerance — the base for the framework-trace ceiling.
const PYTORCH_SIDECAR = "fixtures/external/pytorch.softmax-ce.sidecar.jsonl";

// ===========================================================================
// 1. numeric_policy.tolerance — receipt schema (object form)
// ===========================================================================

test("REJECT receipt with numeric_policy.tolerance {atol:1e9,rtol:1e9} (object form)", () => {
  const r = clone(loadJsonl(XOR));
  (r.numeric_policy as { tolerance: unknown }).tolerance = {
    atol: 1e9,
    rtol: 1e9,
  };
  const result = validateReceiptSchema(r);
  assert.strictEqual(
    result.ok,
    false,
    "a receipt declaring an absurd tolerance MUST be rejected at schema level " +
      "(defense-in-depth against receipt-controlled verifier strictness)",
  );
});

test("REJECT receipt with numeric_policy.tolerance.atol over 1e-5 ceiling", () => {
  const r = clone(loadJsonl(XOR));
  // atol just over the 1e-5 ceiling, rtol legit — isolates the atol bound.
  (r.numeric_policy as { tolerance: unknown }).tolerance = {
    atol: 1e-4,
    rtol: 1e-4,
  };
  const result = validateReceiptSchema(r);
  assert.strictEqual(result.ok, false, "atol 1e-4 > 1e-5 ceiling must reject");
});

test("REJECT receipt with numeric_policy.tolerance.rtol over 1e-3 ceiling", () => {
  const r = clone(loadJsonl(XOR));
  // rtol just over the 1e-3 ceiling, atol legit — isolates the rtol bound.
  (r.numeric_policy as { tolerance: unknown }).tolerance = {
    atol: 1e-12,
    rtol: 1e-2,
  };
  const result = validateReceiptSchema(r);
  assert.strictEqual(result.ok, false, "rtol 1e-2 > 1e-3 ceiling must reject");
});

test("ACCEPT receipt with numeric_policy.tolerance exactly at ceiling (atol 1e-5, rtol 1e-3)", () => {
  const r = clone(loadJsonl(XOR));
  (r.numeric_policy as { tolerance: unknown }).tolerance = {
    atol: 1e-5,
    rtol: 1e-3,
  };
  const result = validateReceiptSchema(r);
  assert.strictEqual(
    result.ok,
    true,
    `at-ceiling tolerance MUST still validate (the bound is inclusive); errors: ${
      result.ok ? "[]" : JSON.stringify(result.errors)
    }`,
  );
});

// ===========================================================================
// 2. numeric_policy.tolerance — receipt schema (scalar form)
//    Scalar X maps to {atol: X, rtol: 0}; the scalar branch must be bounded
//    by the numeric atol ceiling (1e-8).
// ===========================================================================

test("REJECT receipt with scalar numeric_policy.tolerance 1e9", () => {
  // mazur golden uses the scalar form, but its schema (v0.1.0) pins
  // const: 1e-9 and is out of G-004 scope. Instead force the v0.2.0 schema,
  // which accepts the scalar branch, and prove the scalar branch is bounded.
  const r = clone(loadJsonl(XOR));
  (r.numeric_policy as { tolerance: unknown }).tolerance = 1e9;
  const result = validateReceiptSchema(r, { version: "0.2.0" });
  assert.strictEqual(
    result.ok,
    false,
    "scalar tolerance 1e9 MUST be rejected — scalar branch bounded by atol ceiling",
  );
});

test("REJECT receipt with scalar numeric_policy.tolerance just over 1e-5", () => {
  const r = clone(loadJsonl(XOR));
  (r.numeric_policy as { tolerance: unknown }).tolerance = 1e-4;
  const result = validateReceiptSchema(r, { version: "0.2.0" });
  assert.strictEqual(
    result.ok,
    false,
    "scalar tolerance 1e-4 > 1e-5 ceiling must reject",
  );
});

test("ACCEPT receipt with scalar numeric_policy.tolerance exactly at 1e-5", () => {
  const r = clone(loadJsonl(XOR));
  (r.numeric_policy as { tolerance: unknown }).tolerance = 1e-5;
  const result = validateReceiptSchema(r, { version: "0.2.0" });
  assert.strictEqual(
    result.ok,
    true,
    `at-ceiling scalar tolerance MUST validate; errors: ${
      result.ok ? "[]" : JSON.stringify(result.errors)
    }`,
  );
});

// ===========================================================================
// 3. numeric_policy.tolerance ceiling enforced on EVERY receipt schema
//    version in G-004 scope (0.2.0 .. latest). Each version is exercised
//    through a REAL golden whose schema_version matches, validated via
//    opts.version. The non-vacuity proof is a CLEAN->DIRTY flip: the
//    unmodified golden validates, and the SAME golden with only the
//    tolerance widened to 1e9 fails. Because the sole change is the
//    tolerance, the flip can ONLY be caused by the ceiling firing — this
//    holds even under Ajv's fail-fast (allErrors:false), where inspecting a
//    specific instancePath would be unreliable. A partial fix (one schema
//    patched, another missed) is caught: the missed version's dirty clone
//    would still validate and fail the assertion.
// ===========================================================================

// Map each in-scope receipt schema version to a real golden first line.
const RECEIPT_VERSION_GOLDEN: Record<string, string> = {
  "0.2.0": "fixtures/xor.golden.jsonl",
  "0.3.0": "fixtures/softmax-ce.golden.jsonl",
  "0.4.0": "fixtures/external/pytorch.softmax-ce.golden.jsonl",
  "0.5.0": "fixtures/external/pytorch.adam.golden.jsonl",
  "0.6.0": "fixtures/external/pytorch.sgd-momentum.golden.jsonl",
  "0.7.0": "fixtures/external/pytorch.sgd-momentum.nesterov.golden.jsonl",
};

const SCOPED_VERSIONS: SchemaVersion[] = SCHEMA_VERSIONS.filter(
  (v) => v !== "0.1.0",
);

for (const version of SCOPED_VERSIONS) {
  const rel = RECEIPT_VERSION_GOLDEN[version];
  test(`numeric_policy.tolerance ceiling: receipt schema v${version} (clean golden validates, atol/rtol 1e9 rejected)`, { skip: !rel || !existsSync(resolve(repoRoot, rel)) }, () => {
    assert.ok(rel, `no golden mapped for receipt schema v${version}`);
    const base = loadJsonl(rel);
    // 1. Clean golden validates against its own schema (sanity + non-vacuity
    //    floor — proves the dirty failure below is caused by the tolerance,
    //    not by the base being malformed for this version).
    const clean = validateReceiptSchema(clone(base), { version });
    assert.strictEqual(
      clean.ok,
      true,
      `v${version}: clean golden ${rel} must validate; errors: ${
        clean.ok ? "[]" : JSON.stringify(clean.errors)
      }`,
    );
    // 2. Same golden, tolerance widened to absurd -> must be rejected.
    const dirty = clone(base);
    (dirty.numeric_policy as { tolerance: unknown }).tolerance = {
      atol: 1e9,
      rtol: 1e9,
    };
    const dirtyResult = validateReceiptSchema(dirty, { version });
    assert.strictEqual(
      dirtyResult.ok,
      false,
      `v${version}: golden with tolerance {atol:1e9,rtol:1e9} MUST be rejected ` +
        `(the ceiling must be present in schemas/receipt.v${version}.json)`,
    );
  });
}

// ===========================================================================
// 4. attestor.differential_tolerance — Rule 14 ceiling (atol 1e-5, rtol 1e-3)
// ===========================================================================

test("REJECT receipt with attestor.differential_tolerance {atol:1e9,rtol:1e9}", () => {
  const r = clone(loadJsonl(PYTORCH_EXT));
  (r.attestor as { differential_tolerance: unknown }).differential_tolerance = {
    atol: 1e9,
    rtol: 1e9,
  };
  const result = validateReceiptSchema(r);
  assert.strictEqual(
    result.ok,
    false,
    "absurd attestor.differential_tolerance MUST be rejected — a receipt " +
      "cannot loosen the Rule 14 engine-recompute differential check that judges it",
  );
});

test("REJECT attestor.differential_tolerance.atol over 1e-5 ceiling", () => {
  const r = clone(loadJsonl(PYTORCH_EXT));
  // atol just over the 1e-5 ceiling, rtol legit — isolates the atol bound.
  (r.attestor as { differential_tolerance: unknown }).differential_tolerance = {
    atol: 1e-4,
    rtol: 1e-4,
  };
  const result = validateReceiptSchema(r);
  assert.strictEqual(result.ok, false, "diff atol 1e-4 > 1e-5 ceiling must reject");
});

test("REJECT attestor.differential_tolerance.rtol over 1e-3 ceiling", () => {
  const r = clone(loadJsonl(PYTORCH_EXT));
  // rtol just over the 1e-3 ceiling, atol legit — isolates the rtol bound.
  (r.attestor as { differential_tolerance: unknown }).differential_tolerance = {
    atol: 1e-6,
    rtol: 1e-2,
  };
  const result = validateReceiptSchema(r);
  assert.strictEqual(result.ok, false, "diff rtol 1e-2 > 1e-3 ceiling must reject");
});

test("ACCEPT attestor.differential_tolerance exactly at ceiling (atol 1e-5, rtol 1e-3)", () => {
  const r = clone(loadJsonl(PYTORCH_EXT));
  (r.attestor as { differential_tolerance: unknown }).differential_tolerance = {
    atol: 1e-5,
    rtol: 1e-3,
  };
  const result = validateReceiptSchema(r);
  assert.strictEqual(
    result.ok,
    true,
    `at-ceiling differential_tolerance MUST still validate; errors: ${
      result.ok ? "[]" : JSON.stringify(result.errors)
    }`,
  );
});

// differential_tolerance ceiling enforced on every receipt schema that
// carries an Attestor (0.4.0 onward). Older schemas (0.2.0, 0.3.0) have no
// Attestor def. Same CLEAN->DIRTY flip non-vacuity pattern as section 3,
// using a per-version external golden that natively carries an attestor.
const ATTESTOR_VERSION_GOLDEN: Record<string, string> = {
  "0.4.0": "fixtures/external/pytorch.softmax-ce.golden.jsonl",
  "0.5.0": "fixtures/external/pytorch.adam.golden.jsonl",
  "0.6.0": "fixtures/external/pytorch.sgd-momentum.golden.jsonl",
  "0.7.0": "fixtures/external/pytorch.sgd-momentum.nesterov.golden.jsonl",
};

const ATTESTOR_VERSIONS: SchemaVersion[] = SCHEMA_VERSIONS.filter(
  (v) => v !== "0.1.0" && v !== "0.2.0" && v !== "0.3.0",
);

for (const version of ATTESTOR_VERSIONS) {
  const rel = ATTESTOR_VERSION_GOLDEN[version];
  test(`differential_tolerance ceiling: receipt schema v${version} (clean golden validates, atol/rtol 1e9 rejected)`, { skip: !rel || !existsSync(resolve(repoRoot, rel)) }, () => {
    assert.ok(rel, `no attestor golden mapped for receipt schema v${version}`);
    const base = loadJsonl(rel);
    const clean = validateReceiptSchema(clone(base), { version });
    assert.strictEqual(
      clean.ok,
      true,
      `v${version}: clean external golden ${rel} must validate; errors: ${
        clean.ok ? "[]" : JSON.stringify(clean.errors)
      }`,
    );
    const dirty = clone(base);
    (
      dirty.attestor as { differential_tolerance: unknown }
    ).differential_tolerance = { atol: 1e9, rtol: 1e9 };
    const dirtyResult = validateReceiptSchema(dirty, { version });
    assert.strictEqual(
      dirtyResult.ok,
      false,
      `v${version}: golden with differential_tolerance {atol:1e9,rtol:1e9} MUST ` +
        `be rejected (ceiling must be present in schemas/receipt.v${version}.json)`,
    );
  });
}

// ===========================================================================
// 5. framework-trace sidecar — numeric_policy.tolerance ceiling
// ===========================================================================

test("REJECT framework-trace sidecar with numeric_policy.tolerance {atol:1e9,rtol:1e9}", { skip: !existsSync(resolve(repoRoot, PYTORCH_SIDECAR)) }, () => {
  const s = clone(loadJsonl(PYTORCH_SIDECAR));
  (s.numeric_policy as { tolerance: unknown }).tolerance = {
    atol: 1e9,
    rtol: 1e9,
  };
  const result = validateFrameworkTraceSidecar(s);
  assert.strictEqual(
    result.ok,
    false,
    "a foreign sidecar declaring an absurd tolerance MUST be rejected at schema level",
  );
});

// Enforced on EVERY framework-trace schema version via a REAL per-version
// sidecar, with the CLEAN->DIRTY flip non-vacuity pattern, so a missed file
// in the family is caught.
const FT_VERSION_SIDECAR: Record<string, string> = {
  "0.1.0": "fixtures/external/jax.softmax-ce.sidecar.jsonl",
  "0.2.0": "fixtures/external/pytorch.softmax-ce.multi-step.sidecar.jsonl",
  "0.3.0": "fixtures/external/pytorch.softmax-ce.batched.sidecar.jsonl",
  "0.4.0": "fixtures/external/pytorch.adam.multi-step.sidecar.jsonl",
  "0.5.0": "fixtures/external/pytorch.sgd-momentum.multi-step.sidecar.jsonl",
  "0.6.0": "fixtures/external/pytorch.sgd-momentum.dampening.sidecar.jsonl",
  "0.7.0": "fixtures/external/pytorch.helper-emitted.adamw.sidecar.jsonl",
};

for (const version of FRAMEWORK_TRACE_SCHEMA_VERSIONS) {
  const rel = FT_VERSION_SIDECAR[version];
  test(`numeric_policy.tolerance ceiling: framework-trace v${version} (clean sidecar validates, atol/rtol 1e9 rejected)`, { skip: !rel || !existsSync(resolve(repoRoot, rel)) }, () => {
    assert.ok(rel, `no sidecar mapped for framework-trace v${version}`);
    const base = loadJsonl(rel);
    const clean = validateFrameworkTraceSidecar(clone(base), { version });
    assert.strictEqual(
      clean.ok,
      true,
      `framework-trace v${version}: clean sidecar ${rel} must validate; errors: ${
        clean.ok ? "[]" : JSON.stringify(clean.errors)
      }`,
    );
    const dirty = clone(base);
    (dirty.numeric_policy as { tolerance: unknown }).tolerance = {
      atol: 1e9,
      rtol: 1e9,
    };
    const dirtyResult = validateFrameworkTraceSidecar(dirty, { version });
    assert.strictEqual(
      dirtyResult.ok,
      false,
      `framework-trace v${version}: sidecar with tolerance {atol:1e9,rtol:1e9} MUST ` +
        `be rejected (ceiling must be present in schemas/framework-trace.v${version}.json)`,
    );
  });
}

// ===========================================================================
// 6. topology-input schema — numeric_policy.tolerance ceiling
// ===========================================================================

// CLEAN->DIRTY flip on the canonical XOR_INPUT (a valid authored input):
// the clean input validates, the same input with tolerance widened to 1e9
// is rejected. The flip isolates the ceiling as the cause.
test("numeric_policy.tolerance ceiling: topology-input (clean XOR_INPUT validates, atol/rtol 1e9 rejected)", () => {
  const base = JSON.parse(JSON.stringify(XOR_INPUT)) as Record<string, unknown>;
  const clean = validateTopologyInput(clone(base));
  assert.strictEqual(
    clean.ok,
    true,
    `clean XOR_INPUT must validate; errors: ${
      clean.ok ? "[]" : JSON.stringify(clean.errors)
    }`,
  );
  const dirty = clone(base);
  (dirty.numeric_policy as { tolerance: unknown }).tolerance = {
    atol: 1e9,
    rtol: 1e9,
  };
  const dirtyResult = validateTopologyInput(dirty);
  assert.strictEqual(
    dirtyResult.ok,
    false,
    "topology-input with tolerance {atol:1e9,rtol:1e9} MUST be rejected " +
      "(ceiling must be present in schemas/topology-input.v0.4.0.json)",
  );
});

test("REJECT topology-input scalar numeric_policy.tolerance 1e9", () => {
  const dirty = JSON.parse(JSON.stringify(XOR_INPUT)) as Record<string, unknown>;
  (dirty.numeric_policy as { tolerance: unknown }).tolerance = 1e9;
  const result = validateTopologyInput(dirty);
  assert.strictEqual(
    result.ok,
    false,
    "topology-input scalar tolerance 1e9 MUST be rejected (scalar ceiling 1e-5)",
  );
});

// ===========================================================================
// 7. ANTI-OVER-CLAMP — every shipped legit golden + sidecar STILL validates.
//    The whole point of a CEILING (not a fixed value) is headroom: if the
//    bound is set too tight, legit corpus breaks. This is the regression
//    guard the task mandates ("confirm every shipped legit golden still
//    reconciles ok:true after the clamp").
// ===========================================================================

const LEGIT_GOLDENS = [
  "fixtures/xor.golden.jsonl",
  "fixtures/xor-per-neuron-bias.golden.jsonl",
  "fixtures/iris.golden.jsonl",
  "fixtures/softmax-ce.golden.jsonl",
  "fixtures/mazur.golden.jsonl",
  "fixtures/external/jax.softmax-ce.golden.jsonl",
  "fixtures/external/pytorch.adam.golden.jsonl",
  "fixtures/external/pytorch.adamw.golden.jsonl",
  "fixtures/external/pytorch.sgd-momentum.golden.jsonl",
  "fixtures/external/pytorch.sgd-momentum.nesterov.golden.jsonl",
  "fixtures/external/pytorch.sgd-momentum.dampening.golden.jsonl",
  "fixtures/external/pytorch.softmax-ce.golden.jsonl",
  "fixtures/external/pytorch.softmax-ce.batched.golden.jsonl",
  "fixtures/external/tensorflow.softmax-ce.golden.jsonl",
];

for (const rel of LEGIT_GOLDENS) {
  test(`legit golden still validates after tolerance clamp: ${rel}`, { skip: !existsSync(resolve(repoRoot, rel)) }, () => {
    // Validate EVERY line (multi-step goldens are JSONL streams).
    const lines = readFileSync(resolve(repoRoot, rel), "utf-8")
      .trim()
      .split(/\r?\n/);
    lines.forEach((ln, i) => {
      const receipt = JSON.parse(ln) as Record<string, unknown>;
      const result = validateReceiptSchema(receipt);
      assert.strictEqual(
        result.ok,
        true,
        `${rel} line ${i}: legit golden MUST still validate after the ` +
          `tolerance ceiling was added; errors: ${
            result.ok ? "[]" : JSON.stringify(result.errors)
          }`,
      );
    });
  });
}
