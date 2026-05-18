/**
 * v0.6 — PyTorch sidecar importer.
 *
 * v0.6.0 shipped this as a self-contained module; v0.6.1 refactored the
 * shared ingest machinery into `src/import-observer.ts` and reduced this
 * file to a thin per-framework wrapper. Public API + observable behavior
 * unchanged from v0.6.0 — receipts produced by `importPytorchSidecar`
 * remain byte-identical to the v0.6.0 shipped golden.
 *
 * Per-framework wrapper preserves the subcommand discipline: callers
 * import `importPytorchSidecar` (or `bp import pytorch`) explicitly,
 * and the wrapper rejects sidecars whose `source_framework.name` is
 * anything other than "pytorch". The shared core (`buildObserverReceiptFromSidecar`)
 * enforces this name check at the library layer too — the framework
 * vocabulary is closed and the importer dispatch is explicit.
 *
 * No live PyTorch runtime dependency in core. The sidecar is plain JSON.
 * A user-side Python helper (planned for v0.6.x: `scripts/python-helpers/dump_pytorch_trace.py`)
 * emits the sidecar from inside a training loop; `bp import pytorch`
 * consumes the resulting JSONL.
 */

import {
  buildObserverReceiptFromSidecar,
  buildObserverReceiptStreamFromSidecar,
  type ObserverImportOptions,
  type ObserverImportResult,
  type FrameworkTraceSidecar,
} from "./import-observer.js"

// Re-export the shared sidecar type under the v0.6.0 public name so v0.6.0
// consumers (`import { FrameworkTraceSidecar } from "@mcptoolshop/backprop-trace/import-pytorch"`)
// continue to compile unchanged.
export type { FrameworkTraceSidecar }

/**
 * Options for the PyTorch importer. Alias of the shared ObserverImportOptions
 * — kept under the v0.6.0 public name so existing callers' type imports
 * continue to work unchanged.
 */
export type ImportPytorchOptions = ObserverImportOptions

/**
 * Result of a PyTorch import operation. Alias of the shared
 * ObserverImportResult — kept under the v0.6.0 public name for API
 * stability.
 */
export type ImportPytorchResult = ObserverImportResult

/**
 * Import a PyTorch sidecar and produce an observer-mode v0.4.0 receipt.
 *
 * Public API unchanged from v0.6.0. The body now delegates to the shared
 * `buildObserverReceiptFromSidecar` core with `expectedFrameworkName: "pytorch"`
 * and the PyTorch extractor identity default.
 */
export function importPytorchSidecar(
  sidecarBytes: string,
  opts?: ImportPytorchOptions,
): ImportPytorchResult {
  return buildObserverReceiptFromSidecar(
    sidecarBytes,
    "pytorch",
    "bp-import-pytorch@0.6.0",
    "importPytorchSidecar",
    opts,
  )
}

/**
 * v0.8 — Import a multi-step PyTorch sidecar JSONL stream and produce N
 * observer-mode v0.4.0 receipts (one per training step) bound by a
 * `attestor.bundle_root_digest` (Rule 17). Thin wrapper over the shared
 * `buildObserverReceiptStreamFromSidecar` core.
 *
 * The input sidecar MUST declare `format: "framework-trace.v0.2.0"` on
 * every record AND `source_framework.name === "pytorch"` on every record.
 * Mid-stream framework swaps and v0.1.0-format records are rejected with
 * a loud diagnostic.
 */
export type ImportPytorchStreamOptions = ImportPytorchOptions
export type ImportPytorchStreamResult =
  import("./import-observer.js").ObserverImportStreamResult

export function importPytorchSidecarStream(
  sidecarBytes: string,
  opts?: ImportPytorchStreamOptions,
): ImportPytorchStreamResult {
  return buildObserverReceiptStreamFromSidecar(
    sidecarBytes,
    "pytorch",
    "bp-import-pytorch@0.8.0",
    "importPytorchSidecarStream",
    opts,
  )
}
