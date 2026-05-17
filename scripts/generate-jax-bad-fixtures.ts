/**
 * v0.6.1 — Generate JAX-specific bad fixtures.
 *
 * Small plate (1 fixture for v0.6.1) — only mistakes a JAX user (vs a
 * PyTorch user) is structurally likely to make. The PyTorch bad-fixture
 * plate already covers the generic external-ingestion attack classes
 * (shape-not-math, framework-spoof, collapsed-laundered, skip-without-
 * basis, attested-mutated-after, partial-tamper, trusted-source-bad-math,
 * engine-reproduce-disagrees) — those map to any framework. v0.6.1 adds
 * JAX-distinctive mistakes:
 *
 *   1. jax.bad-pytree-flatten-order → Rule 14
 *      JAX users iterate parameters via jax.tree_util.tree_flatten, which
 *      produces a stable but non-obvious order. If the user's extractor
 *      pairs values with parameter_ids in the wrong order (e.g., swapping
 *      two weights), the sidecar is internally consistent (passes schema)
 *      but the math is wrong because the weights occupy wrong slots.
 *      Rule 14 catches via engine recompute: the engine uses the SIDECAR's
 *      parameters_before to compute forward, and the resulting forward[u].out
 *      differs from the sidecar's CLAIMED forward[u].out (which was computed
 *      with the CORRECT weights in the user's actual JAX run).
 *
 * Future v0.6.x JAX-specific candidates (deferred):
 *   - jax.bad-float32-tolerance-too-tight (extractor declared tolerance
 *     tighter than float32 vs binary64 cross-precision drift; Rule 14
 *     fires)
 *   - jax.bad-vmap-batch-leak (vmap'd value where scalar expected; schema
 *     validation rejects)
 *   - jax.bad-jit-stale-cache (params mutated outside JIT trace; Rule 14
 *     fires on stale captured values)
 *
 * The PyTorch plate's 8 fixtures + this 1 JAX fixture = 9 total external
 * bad fixtures across v0.6.0 + v0.6.1. The pressure test the v0.6.1 wave
 * is validating: does v0.6 generalize to a second adapter without
 * introducing a new attack class or weakening any rule? Answer: yes —
 * pytree-flatten-order is just another Rule 14 trigger; no new rule needed.
 */

import { readFileSync, writeFileSync } from "node:fs"
import { emitGeneralReceipt } from "../src/emit.js"
import type { GeneralReceipt } from "../src/general-engine.js"

const goldenText = readFileSync(
  "fixtures/external/jax.softmax-ce.golden.jsonl",
  "utf-8",
)

function freshGolden(): GeneralReceipt {
  return JSON.parse(goldenText.trim()) as GeneralReceipt
}

// --- bad-pytree-flatten-order --------------------------------------------
//
// Swap w_x1_h1 and w_x2_h1 in parameters_before. The user's extractor
// flattened jax.tree_util.tree_flatten(params) in the wrong order, so the
// sidecar declares parameters_before with two weights at swapped slots.
// The CLAIMED forward / loss / backward / updates / parameters_after are
// based on the ORIGINAL (correct) JAX run, so they don't match what the
// engine recomputes from the SWAPPED parameters_before. Rule 14 fires.
{
  const receipt = freshGolden()
  receipt.fixture_status = {
    authoring_state:
      "external_imported" as unknown as GeneralReceipt["fixture_status"]["authoring_state"],
    verification_state:
      "expected_to_fail_reconciliation" as unknown as GeneralReceipt["fixture_status"]["verification_state"],
    canonical: false as true,
  }
  receipt.fixture = "jax.bad-pytree-flatten-order"

  const original = {
    w_x1_h1: receipt.parameters_before.w_x1_h1,
    w_x2_h1: receipt.parameters_before.w_x2_h1,
  }
  receipt.parameters_before.w_x1_h1 = original.w_x2_h1!
  receipt.parameters_before.w_x2_h1 = original.w_x1_h1!

  const bytes = emitGeneralReceipt(receipt)
  const outPath = "fixtures/bad/jax.bad-pytree-flatten-order.jsonl"
  writeFileSync(outPath, bytes)

  const meta = {
    schema_version: "0.1.0",
    fixture: "jax.bad-pytree-flatten-order.meta",
    describes: outPath,
    based_on:
      "Byte-precise mutation of fixtures/external/jax.softmax-ce.golden.jsonl. " +
      "Two parameters_before entries (w_x1_h1, w_x2_h1) swapped to mimic a JAX " +
      "extractor flattening jax.tree_util.tree_flatten(params) in the wrong order.",
    mutation: {
      field_path: "parameters_before.{w_x1_h1, w_x2_h1} (swapped)",
      original,
      mutated: {
        w_x1_h1: receipt.parameters_before.w_x1_h1,
        w_x2_h1: receipt.parameters_before.w_x2_h1,
      },
      kind: "v0_6_1_jax_specific_extractor_mistake",
      description:
        "JAX-distinctive bad fixture: the extractor zipped flattened pytree " +
        "values with parameter_ids in the wrong order, putting w_x1_h1's value " +
        "into w_x2_h1's slot and vice versa. The sidecar is internally " +
        "consistent (passes schema) but the CLAIMED forward/loss/backward fields " +
        "(computed in the user's actual JAX run with the CORRECT weights) " +
        "disagree with what the engine recomputes from the SWAPPED " +
        "parameters_before. Rule 14 fires on forward / loss / backward / " +
        "updates / parameters_after fields independently.",
    },
    reconciliation_check_targeted_first:
      "Rule 14 (engine-recompute differential): foreign claim at forward.h1 disagrees with engine recomputation because parameters_before slots are swapped.",
    purpose:
      "v0.6.1 JAX-specific anti-circularity fixture. Pressure-tests that Rule 14 " +
      "catches JAX extractor mistakes via the same differential machinery used " +
      "for PyTorch — no new rule, no new schema, no new trust model required. " +
      "The v0.6 framework-trace pattern generalizes.",
    v0_6_1_note:
      "v0.6.1 ships the JAX adapter as a thin wrapper over the v0.6.0 " +
      "observer-mode pipeline. JAX-specific extractor mistakes (pytree flatten " +
      "order, float32 vs binary64 drift, vmap batch leakage) all surface as " +
      "Rule 14 differential failures — they are existing-rule firings on a " +
      "new adapter, not new attack classes.",
  }
  writeFileSync(
    outPath.replace(/\.jsonl$/, ".meta.json"),
    JSON.stringify(meta, null, 2) + "\n",
  )
  console.log(`wrote ${outPath}`)
}
