/**
 * v0.7.0 — TensorFlow sidecar importer.
 *
 * Third adapter on the v0.6 framework-trace pattern. v0.6.0 shipped
 * PyTorch; v0.6.1 added JAX (the pressure test); v0.7.0 adds TensorFlow.
 * Same shared `buildObserverReceiptFromSidecar` core, same
 * framework-trace.v0.1.0 sidecar schema, same observer-mode v0.4.0 receipt,
 * same Rule 14 differential check, same trust model. The v0.7.0
 * contribution is the third adapter — confirming the pattern generalizes
 * beyond two without trust-model drift, schema drift, or new rules.
 *
 * The TensorFlow-specific code is exactly:
 *   - expectedFrameworkName = "tensorflow"
 *   - defaultExtractorIdentity = "bp-import-tensorflow@0.7.0"
 *
 * Per-framework subcommand discipline: `importTensorflowSidecar` rejects
 * sidecars whose `source_framework.name` is not "tensorflow", even though
 * they would pass schema validation. PyTorch and JAX importers reject TF
 * sidecars symmetrically. Callers MUST name the framework explicitly.
 *
 * No live TensorFlow runtime dependency in core. The sidecar is plain
 * JSON, authored by a user-side Python helper inside a TF training loop.
 * For an eager-mode training step the helper would typically:
 *   1. Run forward + backward inside `with tf.GradientTape() as tape:`
 *   2. Extract per-tensor values from the tape and from `model.trainable_variables`
 *   3. Emit a framework-trace.v0.1.0 JSONL line
 * The bp core does NOT execute TensorFlow code.
 *
 * Known TensorFlow-specific extractor concerns (NOT importer concerns —
 * these happen in the user's Python helper, before the sidecar arrives at
 * the importer):
 *   - Variable list ordering: `model.trainable_variables` returns vars in
 *     creation order (which is stable but non-obvious). An extractor that
 *     sorts the list — e.g., alphabetically by `var.name` — pairs values
 *     with parameter_ids in the wrong order. Surfaces as Rule 14
 *     disagreement on forward fields.
 *   - Trainable vs non-trainable variables: BatchNorm `running_mean` /
 *     `running_var` and similar moving-stats parameters are non-trainable
 *     Variables. An extractor that pulls `model.variables` (all vars) into
 *     `parameters_before` introduces entries that don't get gradient
 *     updates; the engine's expected `parameters_after` differs.
 *   - tf.GradientTape persistence: the default tape is non-persistent.
 *     `tape.gradient(...)` may be called only once. An extractor calling
 *     it twice raises a RuntimeError; a workaround (`persistent=True`)
 *     that's then misused can return stale or conflated gradients.
 *   - Eager vs graph mode (`tf.function`): graph-mode (XLA-compiled)
 *     execution may apply constant folding or op fusion that diverges
 *     slightly in the last few ULPs from the eager-mode interpretation
 *     the engine recomputes. Within attestor.differential_tolerance for
 *     small networks; tighten on a per-receipt basis if needed.
 *   - tf.cast / mixed precision: if the user's training step runs in
 *     float16 / bfloat16 (mixed-precision policies), per-tensor values
 *     emitted to the sidecar carry that precision; cross-precision drift
 *     against the engine's binary64 recompute is bounded by
 *     attestor.differential_tolerance.
 */

import {
  buildObserverReceiptFromSidecar,
  type ObserverImportOptions,
  type ObserverImportResult,
  type FrameworkTraceSidecar,
} from "./import-observer.js"

// Re-export the shared sidecar type under the TF-flavored public name so
// callers importing from "./import-tensorflow" don't need to reach into
// the shared module.
export type { FrameworkTraceSidecar }

/**
 * Options for the TensorFlow importer. Alias of the shared
 * ObserverImportOptions.
 */
export type ImportTensorflowOptions = ObserverImportOptions

/**
 * Result of a TensorFlow import operation. Alias of the shared
 * ObserverImportResult.
 */
export type ImportTensorflowResult = ObserverImportResult

/**
 * Import a TensorFlow sidecar and produce an observer-mode v0.4.0 receipt.
 *
 * Same trust model as importPytorchSidecar / importJaxSidecar: foreign
 * claims become canonical fields; the backprop-trace engine runs
 * differentially as the witness; Rule 14 enforces agreement within
 * attestor.differential_tolerance at reconcile time.
 *
 * @param sidecarBytes  Raw sidecar bytes (UTF-8) declaring
 *                      source_framework.name === "tensorflow". Hashed for
 *                      attestor.import_provenance.source_hash before parsing.
 * @param opts          Optional overrides — see ImportTensorflowOptions.
 * @throws              Error if sidecar bytes are not valid JSON, fail
 *                      framework-trace.v0.1.0 schema validation, or
 *                      declare a source_framework.name other than "tensorflow".
 */
export function importTensorflowSidecar(
  sidecarBytes: string,
  opts?: ImportTensorflowOptions,
): ImportTensorflowResult {
  return buildObserverReceiptFromSidecar(
    sidecarBytes,
    "tensorflow",
    "bp-import-tensorflow@0.7.0",
    "importTensorflowSidecar",
    opts,
  )
}
