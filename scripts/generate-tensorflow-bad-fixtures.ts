/**
 * v0.7.0 — Generate TensorFlow-specific bad fixtures.
 *
 * Small plate (1 fixture for v0.7.0) — only mistakes a TensorFlow user
 * (vs a PyTorch or JAX user) is structurally likely to make. The v0.6.0
 * PyTorch plate already covers the generic external-ingestion attack
 * classes (shape-not-math, framework-spoof, collapsed-laundered, skip-
 * without-basis, attested-mutated-after, partial-tamper, trusted-source-
 * bad-math, engine-reproduce-disagrees) — those map to any framework.
 * v0.6.1 added one JAX-distinctive fixture (pytree-flatten-order).
 * v0.7.0 adds one TensorFlow-distinctive fixture:
 *
 *   1. tensorflow.bad-variable-list-order → Rule 14
 *      TensorFlow exposes parameters via `model.trainable_variables`,
 *      which returns Variables in CREATION order (a stable but non-
 *      obvious ordering). A common extractor mistake: sort the list
 *      alphabetically by `var.name` (or by `var.handle.name`), then
 *      zip the sorted list against the user's parameter_ids. The result
 *      is values paired with the WRONG slot — a swap.
 *
 *      The sidecar is internally consistent (passes schema) but the
 *      math is wrong because two weights are in swapped slots. Rule 14
 *      catches via engine recompute: the engine uses the SIDECAR's
 *      parameters_before to compute forward, and the resulting
 *      forward[u].out differs from the sidecar's CLAIMED forward[u].out
 *      (which was computed with the CORRECT weights in the user's
 *      actual TensorFlow run).
 *
 *      Same failure shape as JAX's pytree-flatten-order (both extractor-
 *      side ordering mistakes, both surface via Rule 14), DIFFERENT root
 *      cause (TF Variable creation order vs JAX pytree traversal order).
 *      The v0.7.0 pressure test: same Rule 14 catches a third class of
 *      framework-specific extractor mistake without a new rule.
 *
 * Future v0.7.x / v0.8 TensorFlow-specific candidates (deferred):
 *   - tensorflow.bad-trainable-vs-non-trainable (extractor pulled
 *     model.variables — including BatchNorm moving stats — into
 *     parameters_before; Rule 7 fires on parameters_after)
 *   - tensorflow.bad-graph-vs-eager-divergence (tf.function/XLA fused
 *     ops drift beyond differential_tolerance; Rule 14 fires)
 *   - tensorflow.bad-tape-not-persistent-reuse (extractor called
 *     tape.gradient(...) twice on a non-persistent tape; second call
 *     returned bogus values; Rule 14 fires)
 *   - tensorflow.bad-mixed-precision-policy-skew (extractor declared
 *     binary64 precision but actual training ran in float16 / bfloat16;
 *     differential exceeds tolerance unless attestor.differential_
 *     tolerance is widened per-receipt)
 *
 * The 8 PyTorch fixtures + 1 JAX fixture + 1 TensorFlow fixture = 10
 * total external bad fixtures across v0.6.0 + v0.6.1 + v0.7.0. The v0.7.0
 * pressure test the wave validates: does v0.6 generalize to a THIRD
 * adapter without introducing a new attack class or weakening any rule?
 * Answer: yes — variable-list-order is just another Rule 14 trigger;
 * no new rule needed.
 */

import { readFileSync, writeFileSync } from "node:fs"
import { emitGeneralReceipt } from "../src/emit.js"
import type { GeneralReceipt } from "../src/general-engine.js"

const goldenText = readFileSync(
  "fixtures/external/tensorflow.softmax-ce.golden.jsonl",
  "utf-8",
)

function freshGolden(): GeneralReceipt {
  return JSON.parse(goldenText.trim()) as GeneralReceipt
}

// --- bad-variable-list-order ---------------------------------------------
//
// Swap w_x1_h1 and w_x2_h1 in parameters_before. The user's extractor
// sorted model.trainable_variables alphabetically by var.name (instead
// of preserving creation order), so the sidecar declares parameters_before
// with two weights at swapped slots. The CLAIMED forward / loss / backward
// / updates / parameters_after are based on the ORIGINAL (correct) TF run,
// so they don't match what the engine recomputes from the SWAPPED
// parameters_before. Rule 14 fires.
{
  const receipt = freshGolden()
  receipt.fixture_status = {
    authoring_state:
      "external_imported" as unknown as GeneralReceipt["fixture_status"]["authoring_state"],
    verification_state:
      "expected_to_fail_reconciliation" as unknown as GeneralReceipt["fixture_status"]["verification_state"],
    canonical: false as true,
  }
  receipt.fixture = "tensorflow.bad-variable-list-order"

  const original = {
    w_x1_h1: receipt.parameters_before.w_x1_h1,
    w_x2_h1: receipt.parameters_before.w_x2_h1,
  }
  receipt.parameters_before.w_x1_h1 = original.w_x2_h1!
  receipt.parameters_before.w_x2_h1 = original.w_x1_h1!

  const bytes = emitGeneralReceipt(receipt)
  const outPath = "fixtures/bad/tensorflow.bad-variable-list-order.jsonl"
  writeFileSync(outPath, bytes)

  const meta = {
    schema_version: "0.1.0",
    fixture: "tensorflow.bad-variable-list-order.meta",
    describes: outPath,
    based_on:
      "Byte-precise mutation of fixtures/external/tensorflow.softmax-ce.golden.jsonl. " +
      "Two parameters_before entries (w_x1_h1, w_x2_h1) swapped to mimic a TensorFlow " +
      "extractor sorting model.trainable_variables alphabetically by var.name (instead " +
      "of preserving the stable creation order TF returns by default).",
    mutation: {
      field_path: "parameters_before.{w_x1_h1, w_x2_h1} (swapped)",
      original,
      mutated: {
        w_x1_h1: receipt.parameters_before.w_x1_h1,
        w_x2_h1: receipt.parameters_before.w_x2_h1,
      },
      kind: "v0_7_0_tensorflow_specific_extractor_mistake",
      description:
        "TensorFlow-distinctive bad fixture: the extractor sorted " +
        "model.trainable_variables alphabetically by var.name and then zipped the " +
        "sorted list against parameter_ids, putting w_x1_h1's value into w_x2_h1's " +
        "slot and vice versa. The sidecar is internally consistent (passes schema) " +
        "but the CLAIMED forward/loss/backward fields (computed in the user's actual " +
        "TF run with the CORRECT weights) disagree with what the engine recomputes " +
        "from the SWAPPED parameters_before. Rule 14 fires on forward / loss / " +
        "backward / updates / parameters_after fields independently. Same failure " +
        "shape as JAX's pytree-flatten-order (both extractor-side ordering mistakes), " +
        "different root cause (TF Variable creation order vs JAX pytree traversal " +
        "order).",
    },
    reconciliation_check_targeted_first:
      "Rule 14 (engine-recompute differential): foreign claim at forward.h1 disagrees with engine recomputation because parameters_before slots are swapped.",
    purpose:
      "v0.7.0 TensorFlow-specific anti-circularity fixture. Pressure-tests that " +
      "Rule 14 catches TF extractor mistakes via the same differential machinery " +
      "used for PyTorch and JAX — no new rule, no new schema, no new trust model " +
      "required. The v0.6 framework-trace pattern generalizes to a THIRD adapter.",
    v0_7_0_note:
      "v0.7.0 ships the TensorFlow adapter as a thin wrapper over the v0.6 " +
      "observer-mode pipeline. TF-specific extractor mistakes (variable list " +
      "ordering, trainable-vs-non-trainable confusion, tape persistence misuse, " +
      "graph-vs-eager ULP drift, mixed-precision skew) all surface as Rule 14 " +
      "differential failures — they are existing-rule firings on a new adapter, " +
      "not new attack classes.",
  }
  writeFileSync(
    outPath.replace(/\.jsonl$/, ".meta.json"),
    JSON.stringify(meta, null, 2) + "\n",
  )
  console.log(`wrote ${outPath}`)
}
