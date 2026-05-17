/**
 * v0.6.1 — JAX sidecar importer.
 *
 * Thin wrapper over the shared `buildObserverReceiptFromSidecar` core in
 * `src/import-observer.ts`. v0.6.1's contribution is proving the v0.6.0
 * pattern generalizes: same sidecar schema (framework-trace.v0.1.0), same
 * observer-mode v0.4.0 receipt, same Rule 14 differential check, same
 * trust model. The only JAX-specific code is the `expectedFrameworkName`
 * + `defaultExtractorIdentity` arguments to the shared helper.
 *
 * Per-framework subcommand discipline: `importJaxSidecar` rejects sidecars
 * whose `source_framework.name` is not "jax", even though they would pass
 * schema validation. Callers must use the correct per-framework importer
 * — the dispatch is explicit at the library layer too.
 *
 * No live JAX runtime dependency in core. The sidecar is plain JSON,
 * authored by a user-side Python helper inside a JAX training loop (e.g.,
 * flattening `jax.tree_util.tree_flatten(params)` to a `{param_id: value}`
 * dict and emitting a framework-trace.v0.1.0 JSONL line). The bp core
 * does NOT execute JAX code.
 *
 * Known JAX-specific extractor concerns (NOT importer concerns — these
 * happen in the user's Python helper, before the sidecar arrives at the
 * importer):
 *   - Pytree flattening: jax.tree_util.tree_flatten produces a stable but
 *     non-obvious ordering. The user's helper MUST pair values with their
 *     parameter_ids correctly; a swap surfaces as Rule 14 disagreement.
 *   - float32 default precision: JAX runs in float32 by default; engine
 *     runs binary64. Cross-precision drift is bounded; default
 *     differential_tolerance {atol:1e-6, rtol:1e-4} absorbs it for small
 *     networks. Larger networks may need looser tolerance per-receipt.
 *   - JIT/XLA op fusion: changes intermediate FP roundings but not final
 *     scalar values within tolerance.
 *   - vmap/scan/pmap: produce batched values, not single-step scalars;
 *     schema validation rejects them at the wire layer.
 */

import {
  buildObserverReceiptFromSidecar,
  type ObserverImportOptions,
  type ObserverImportResult,
  type FrameworkTraceSidecar,
} from "./import-observer.js"

// Re-export the shared sidecar type under the JAX-flavored public name
// so callers importing from "./import-jax" don't need to reach into the
// shared module.
export type { FrameworkTraceSidecar }

/**
 * Options for the JAX importer. Alias of the shared ObserverImportOptions.
 */
export type ImportJaxOptions = ObserverImportOptions

/**
 * Result of a JAX import operation. Alias of the shared ObserverImportResult.
 */
export type ImportJaxResult = ObserverImportResult

/**
 * Import a JAX sidecar and produce an observer-mode v0.4.0 receipt.
 *
 * Same trust model as importPytorchSidecar: foreign claims become canonical
 * fields; the backprop-trace engine runs differentially as the witness;
 * Rule 14 enforces agreement within attestor.differential_tolerance at
 * reconcile time.
 *
 * @param sidecarBytes  Raw sidecar bytes (UTF-8) declaring
 *                      source_framework.name === "jax". Hashed for
 *                      attestor.import_provenance.source_hash before parsing.
 * @param opts          Optional overrides — see ImportJaxOptions.
 * @throws              Error if sidecar bytes are not valid JSON, fail
 *                      framework-trace.v0.1.0 schema validation, or
 *                      declare a source_framework.name other than "jax".
 */
export function importJaxSidecar(
  sidecarBytes: string,
  opts?: ImportJaxOptions,
): ImportJaxResult {
  return buildObserverReceiptFromSidecar(
    sidecarBytes,
    "jax",
    "bp-import-jax@0.6.1",
    "importJaxSidecar",
    opts,
  )
}
