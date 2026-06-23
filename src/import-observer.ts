/**
 * v0.6.1 — shared observer-mode sidecar importer (framework-agnostic core).
 *
 * Extracted in v0.6.1 alongside the JAX adapter. The PyTorch importer
 * (v0.6.0) and JAX importer (v0.6.1) are now both thin wrappers over this
 * shared core — each public function calls `buildObserverReceiptFromSidecar`
 * with its framework name + extractor identity default. This preserves the
 * per-framework subcommand discipline at the CLI + library API layer
 * (importPytorchSidecar / importJaxSidecar stay distinctly named so
 * callers can't accidentally mix sidecars) while keeping the actual ingest
 * machinery in one place.
 *
 * No new trust model, no schema drift. Every JAX or PyTorch sidecar
 * arrives through the same pipeline:
 *
 *   1. Hash raw bytes for `attestor.import_provenance.source_hash` BEFORE
 *      parsing (preserves byte stream the operator ingested).
 *   2. JSON.parse the sidecar bytes.
 *   3. Validate against framework-trace.v0.1.0 schema (Ajv).
 *   4. Assert `sidecar.source_framework.name` matches the expected
 *      framework for the calling importer (per-framework subcommand
 *      contract — `importPytorchSidecar` rejects JAX sidecars and vice
 *      versa, even though both pass schema validation).
 *   5. Run `runGeneralStep` from the sidecar's inputs as the differential
 *      witness.
 *   6. Compare engine output to foreign claims field-by-field within
 *      `differential_tolerance` (default {atol:1e-6, rtol:1e-4}).
 *   7. Build the v0.4.0 observer-mode receipt: foreign claims as canonical
 *      fields + attestor + source_framework + fixture_status.
 *   8. Emit canonical bytes via emitGeneralReceipt.
 *
 * The differential disagreements list is returned alongside the receipt
 * so the CLI / caller can decide how to surface them. The receipt's
 * `verification_state` reflects whether disagreement was found
 * (`engine_recompute_matched_within_tolerance` vs
 * `engine_recompute_disagreed`) — that's the observer-side claim.
 * `bp verify general` re-runs Rule 14 independently as the actual gate
 * (Reproducible Builds discipline: producer's claim is not the verifier's
 * truth).
 */

import { createHash } from "node:crypto"
import {
  runGeneralStep,
  runBatchedGeneralStep,
  type GeneralReceipt,
  type GeneralInput,
  type BatchedGeneralInput,
  type SourceFramework,
  type Attestor,
  type OptimizerConfig,
  type AdamState,
  type MomentumState,
  type OptimizerStateAny,
} from "./general-engine.js"
import type { Topology } from "./topology.js"
import { applyToleranceCheck, type TolerancePolicy } from "./reconcile.js"
import { emitGeneralReceipt } from "./emit.js"
import { validateFrameworkTraceSidecar } from "./validate.js"

/**
 * v0.10 — FORENSIC live-helper attribution block. Mirrors the
 * `framework-trace.v0.7.0` schema's `helper` def. Required when
 * `source_framework.name` is a real framework (pytorch/jax/tensorflow)
 * AND `source_framework.extractor.name !== "hand_authored"`. NEVER a
 * credential — Rule 14 (engine-recompute differential) is the authority.
 * Helper may compute and report its own source_hash; this is documented
 * as observer-claimed-not-verifier-checked. Verifier may surface helper
 * fields in Rule 14 failure messages for attribution but does NOT consult
 * them for gate logic.
 */
export type HelperBlock = {
  name: string
  version: string
  /**
   * Closed enum makes the future flip-to-pip transition auditable from
   * sidecar reads alone. v0.10 is "repo-script"; a pip-distributed helper
   * would declare "pypi".
   */
  distribution: "repo-script" | "pypi" | "vendored"
  /** SHA-256 of the helper source file bytes. Forensic only. */
  source_hash: string
  source_uri?: string
  framework: {
    name: "pytorch" | "jax" | "tensorflow"
    version: string
    commit?: string
  }
  runtime: {
    python_version: string
    torch_version?: string
    deterministic_mode?: {
      torch_use_deterministic_algorithms?: boolean
      cudnn_deterministic?: boolean
      cudnn_benchmark?: boolean
      seed?: number
    }
  }
  extraction: {
    timestamp: string
    duration_ms?: number
    device: "cpu" | "cuda" | "mps" | "xla"
  }
}

/**
 * Sidecar shape after framework-trace.v0.1.0 schema validation has
 * succeeded. The shape mirrors a v0.3.0 receipt body but is wrapped in
 * the sidecar envelope (`format` discriminator + `source_framework`).
 * Importer is responsible for mapping into the v0.4.0 receipt.
 */
export type FrameworkTraceSidecar = {
  format:
    | "framework-trace.v0.1.0"
    | "framework-trace.v0.2.0"
    | "framework-trace.v0.3.0"
    | "framework-trace.v0.4.0"
    | "framework-trace.v0.5.0"
    | "framework-trace.v0.6.0"
    | "framework-trace.v0.7.0"
  source_framework: SourceFramework
  /**
   * v0.10+ FORENSIC live-helper attribution. Present when the sidecar was
   * produced by a live framework helper (e.g. scripts/extract/pytorch.py).
   * NEVER a credential — Rule 14 (engine-recompute differential) is the
   * authority on every external_imported receipt regardless of what this
   * block claims. Importer passes the block through to the receipt for
   * post-hoc attribution; it does NOT consult it for gate logic.
   */
  helper?: HelperBlock
  topology: Topology
  learning_rate: number
  /** v0.2.0+ multi-step fields (optional). */
  trace_id?: string
  step_index?: number
  /**
   * v0.3.0+ batched receipt fields (optional). When `batch` is declared, the
   * sidecar represents a BATCHED training step. `per_sample` carries
   * per-sample (inputs, targets, forward, loss); top-level inputs/targets/
   * forward carry the FIRST sample's values by canonical convention. v0.9.0
   * supports batched SGD only; per-sample gradients deferred to v0.9.x/v0.10
   * (reduced gradients at top-level updates[].gradient).
   */
  batch?: {
    size: number
    sample_order: string[]
    reduction: "mean" | "sum" | "none"
  }
  /**
   * v0.4.0+ optimizer block (v0.9.1 Adam/AdamW; v0.9.2 sgd_momentum). When
   * `optimizer.name` is "adam"/"adamw"/"sgd_momentum", the sidecar carries
   * top-level optimizer hyperparameters and each `updates[].optimizer`
   * carries per-parameter `state_before` / `state_after` blocks. When
   * omitted, sidecar defaults to SGD (v0.6/v0.7/v0.8/v0.9.0 behavior).
   * Importer normalizes framework-native optimizer state to canonical
   * names at extractor time — Adam: PyTorch's exp_avg → m, optax's mu → m,
   * TF Keras's Adam/m/<param> → m; sgd_momentum: PyTorch's momentum_buffer
   * → buffer, optax's trace → buffer, TF Keras's SGD/momentum/<param> →
   * buffer.
   */
  optimizer?: {
    name: "sgd" | "adam" | "adamw" | "sgd_momentum"
    learning_rate: number
    beta1?: number
    beta2?: number
    epsilon?: number
    weight_decay?: number
    t?: number
    momentum?: number
    /** v0.9.3 — widened from const false to boolean (PyTorch torch.optim.SGD nesterov). */
    nesterov?: boolean
    /** v0.9.3 — widened from const 0 to number in [0, 1) (PyTorch dampening tau). */
    dampening?: number
  }
  numeric_policy?: GeneralInput["numeric_policy"]
  bias_policy?: GeneralInput["bias_policy"]
  inputs: Record<string, number>
  targets: Record<string, number>
  parameters_before: Record<string, number>
  per_sample?: Record<
    string,
    {
      inputs: Record<string, number>
      targets: Record<string, number>
      forward: GeneralReceipt["forward"]
      loss: GeneralReceipt["loss"]
    }
  >
  forward: GeneralReceipt["forward"]
  loss: GeneralReceipt["loss"]
  backward: GeneralReceipt["backward"]
  updates: GeneralReceipt["updates"]
  parameters_after: GeneralReceipt["parameters_after"]
  post_update_forward?: GeneralReceipt["post_update_forward"]
  post_update_loss?: GeneralReceipt["post_update_loss"]
}

/**
 * Shared options for both per-framework importers. The PyTorch and JAX
 * adapters expose this directly under their per-framework names
 * (ImportPytorchOptions, ImportJaxOptions) — both are aliases of this
 * type to keep the public surface readable.
 */
export type ObserverImportOptions = {
  /**
   * Override the differential tolerance applied to Rule 14 at import
   * time AND embedded in the produced receipt's attestor.differential_
   * tolerance. Default: {atol: 1e-6, rtol: 1e-4} — looser than engine-
   * authored {1e-12, 1e-8} per the v0.6 study's foreign-FP-drift guidance.
   */
  differentialTolerance?: { atol: number; rtol: number }

  /**
   * Override the extractor identity (default depends on which per-framework
   * importer was called — "bp-import-pytorch@<v>" or "bp-import-jax@<v>").
   * Mainly useful for downstream tooling that needs to identify the
   * adapter that produced the receipt.
   */
  extractorIdentity?: string

  /**
   * Override attestor.import_provenance.import_timestamp. When omitted,
   * the current ISO timestamp is used. Fixture authoring should pass a
   * pinned value so the produced receipt is deterministic across re-runs.
   */
  importTimestamp?: string

  /**
   * Pinned `fixture` field for the produced receipt. Defaults to
   * `"<sidecar.source_framework.name>-imported-step"`.
   */
  fixtureLabel?: string
}

/**
 * Result of an observer-mode import. The receipt is always produced even
 * when the differential check fires (so the operator can persist it for
 * audit).
 *
 * `differentialPassed` is the IMPORTER's own engine-recompute verdict. As of
 * v0.12.0 (G-008) it covers the SAME field set as reconciler Rule 14
 * (forward + loss + backward + updates + optimizer.state_after +
 * parameters_after), so a producer-side `differentialPassed === true` is no
 * longer a weaker claim than the gate. BUT it is still NOT a substitute for
 * the gate: per Reproducible-Builds discipline ("the producer's claim is not
 * the verifier's truth"), every imported receipt is independently re-checked
 * by `bp verify` (Rule 14) before it is trusted. Treat this flag as the
 * importer's self-report for operator triage / persistence decisions, not as
 * the verification verdict. `verification_state` on the emitted receipt is
 * derived from this same self-report and is likewise re-derived at the gate.
 */
export type ObserverImportResult = {
  receipt: GeneralReceipt
  emittedBytes: string
  differentialPassed: boolean
  differentialDisagreements: Array<{
    fieldPath: string
    delta: number
    appliedTolerance: number
    // The two operands behind `delta`, mirroring the verify-path Rule-14
    // quartet (reconcile.ts ReconciliationFailure.stored/recomputed): `stored`
    // is the receipt/sidecar-CLAIMED value, `recomputed` is the engine value
    // re-derived at import time. An operator needs BOTH to tell a real tamper
    // (large, structured divergence) from benign FP/Node drift — delta +
    // tolerance alone do not reveal the magnitudes being compared. For
    // structural completeness failures (delta === NaN) the quartet is
    // meaningless and both are 0, the same convention reconcile.ts uses for
    // its rule-0 failures.
    stored: number
    recomputed: number
  }>
}

/**
 * Shared core: validate sidecar, run engine differentially, build the
 * v0.4.0 observer-mode receipt, emit canonical bytes.
 *
 * @param sidecarBytes               Raw sidecar bytes (UTF-8). Hashed for
 *                                    source_hash BEFORE parsing — preserves
 *                                    the exact byte stream the operator
 *                                    ingested.
 * @param expectedFrameworkName      Closed-enum framework the calling
 *                                    importer accepts. Sidecars declaring
 *                                    a different name are rejected — this
 *                                    enforces per-framework subcommand
 *                                    discipline at the library level too.
 * @param defaultExtractorIdentity   Extractor identity string the calling
 *                                    importer applies when opts.extractorIdentity
 *                                    is omitted (e.g. "bp-import-pytorch@0.6.0",
 *                                    "bp-import-jax@0.6.1").
 * @param callerLabel                Name of the calling importer for error
 *                                    messages (e.g. "importPytorchSidecar").
 * @param opts                       See ObserverImportOptions.
 *
 * @throws Error if sidecar bytes are not valid JSON, fail framework-trace.v0.1.0
 *         schema validation, or declare a source_framework.name other than
 *         expectedFrameworkName.
 */
export function buildObserverReceiptFromSidecar(
  sidecarBytes: string,
  expectedFrameworkName: SourceFramework["name"],
  defaultExtractorIdentity: string,
  callerLabel: string,
  opts?: ObserverImportOptions,
): ObserverImportResult {
  // ING-B-005 (Stage C / degradation-UX) — empty / whitespace-only sidecar
  // diagnostic. parse.ts (parseReceiptJsonl) and parse-input.ts already emit a
  // dedicated "empty input" message; the importer historically fell through to
  // JSON.parse and surfaced the opaque `Unexpected end of JSON input` instead.
  // Mirror the sibling parsers' early check so an operator who pipes an empty
  // file (a common shell mistake — `bp import pytorch < missing.jsonl`) gets an
  // actionable message naming the importer + the empty condition. Runs BEFORE
  // the source-hash binding so the hash is only computed for real content.
  assertSidecarNotEmpty(sidecarBytes, callerLabel)

  // 1. Hash raw bytes BEFORE parsing.
  const sourceHash = `sha256:${createHash("sha256").update(sidecarBytes, "utf8").digest("hex")}`

  // ING-2 — verifier-owned ingest cap (raw-byte layer). Reject an oversized
  // sidecar with a diagnosable structured error BEFORE parse / validate /
  // iterate / emit, so an unbounded body becomes a clear "exceeds ingest cap"
  // message instead of a multi-second hold or a raw `Invalid string length`.
  // Hashing first preserves source_hash binding on the (small) accepted path;
  // the cap rejection short-circuits before any further work. Mirrors the
  // MAX_BATCH_SAMPLES discipline — the verifier owns the limit.
  assertSidecarWithinIngestCap(sidecarBytes, callerLabel)

  // 2. Parse + validate against framework-trace.v0.1.0.
  let parsed: unknown
  try {
    parsed = JSON.parse(sidecarBytes.trim())
  } catch (err) {
    throw new Error(
      `${callerLabel}: sidecar bytes are not valid JSON: ${err instanceof Error ? err.message : String(err)}`,
    )
  }

  // 2a. imports-B-001 (Stage C) — explicit single-step format-version
  // allowlist, mirroring the multi-step path's allowlist
  // (buildObserverReceiptStreamFromSidecar step 3). Two holes this closes:
  //   (A) A recognized-but-out-of-single-step-scope format const on a v0.1.0-
  //       shaped body (e.g. format="framework-trace.v0.5.0" with no optimizer
  //       block) was SILENTLY ACCEPTED — the dispatcher in validate.ts sniffs
  //       the const, validates against that schema (which a v0.1.0-shaped body
  //       can satisfy because trace_id/step_index/optimizer are all optional),
  //       and the importer emitted a downgraded schema_version "0.4.0" receipt.
  //       That is active silent acceptance of a mislabeled sidecar.
  //   (B) An unknown/future format const WAS rejected, but with a confusing
  //       Ajv message ("failed framework-trace.v0.1.0 validation: /format: must
  //       be equal to constant") that reads like an internal v0.1.0 bug rather
  //       than a version-support problem.
  // Running this BEFORE validateFrameworkTraceSidecar lets the clear,
  // version-aware message win for any format problem; schema validation below
  // still runs for accepted versions to catch shape errors. This is the
  // observability/diagnosability half of the verifier-owned-limits discipline:
  // an out-of-scope input fails with a diagnosable "supported set" message, not
  // a silent accept or a raw constraint error. NOT a soundness change — Rule 14
  // remains the authority on every accepted receipt.
  if (typeof parsed === "object" && parsed !== null) {
    const declaredFormat = (parsed as Record<string, unknown>).format
    if (
      typeof declaredFormat === "string" &&
      !SINGLE_STEP_SUPPORTED_FORMATS.includes(declaredFormat)
    ) {
      if (declaredFormat === MULTI_STEP_BASELINE_FORMAT) {
        throw new Error(
          `${callerLabel}: sidecar declares format='${declaredFormat}', which is a MULTI-STEP ` +
            `(JSONL stream) sidecar baseline. The single-step importer accepts only single-step ` +
            `sidecars (${SINGLE_STEP_SUPPORTED_FORMATS.join(", ")}). ` +
            `HINT: import this with the multi-step subcommand — \`bp import ${expectedFrameworkName} multi <file>\` ` +
            `(or the ${expectedFrameworkName === "pytorch" ? "importPytorchSidecarStream" : expectedFrameworkName === "jax" ? "importJaxSidecarStream" : "importTensorflowSidecarStream"} API).`,
        )
      }
      throw new Error(
        `${callerLabel}: unsupported sidecar format version '${declaredFormat}' ` +
          `(supported single-step: ${SINGLE_STEP_SUPPORTED_FORMATS.join(", ")}). ` +
          `HINT: check the sidecar's \`format\` field — it must be one of the supported single-step ` +
          `versions. A v0.2.0 sidecar is multi-step (use \`bp import ${expectedFrameworkName} multi <file>\`); ` +
          `an unknown version means the sidecar was produced by a newer/older helper than this ` +
          `backprop-trace build supports.`,
      )
    }
  }

  // ING-B-003 (Stage C / degradation-UX) — unsupported-optimizer diagnostic.
  // `optimizer.name` is a CLOSED enum in every framework-trace schema; an
  // unsupported value (e.g. "lion", "amsgrad", "rmsprop") fails Ajv with the
  // opaque "/optimizer/name: must be equal to one of the allowed values", which
  // discards the useful part — it never tells the operator what IS accepted.
  // Detect the case BEFORE the generic validation summary and surface a message
  // that NAMES the supported optimizer set, so the operator can correct the
  // sidecar without spelunking the schema. NOT a soundness change — this only
  // improves the rejection message for an input the schema already rejects.
  assertSidecarOptimizerSupported(parsed, callerLabel)

  const validation = validateFrameworkTraceSidecar(parsed)
  if (!validation.ok) {
    const summary = validation.errors
      .map((e) => `${e.instancePath || "/"}: ${e.message}`)
      .join("; ")
    throw new Error(
      `${callerLabel}: sidecar failed framework-trace.v${validation.schemaVersion} validation: ${summary}`,
    )
  }
  const sidecar = validation.sidecar as FrameworkTraceSidecar

  // 3. Per-framework name check (subcommand discipline at the library
  //    layer). importPytorchSidecar rejects "jax" sidecars and vice versa
  //    even though both pass schema validation.
  if (sidecar.source_framework.name !== expectedFrameworkName) {
    throw new Error(
      `${callerLabel}: sidecar declares source_framework.name='${sidecar.source_framework.name}', ` +
        `but ${callerLabel} accepts only '${expectedFrameworkName}'. Use the matching importer ` +
        `for this framework, or correct the sidecar's source_framework.name.`,
    )
  }

  // 3a. imports-B-001 (Stage C) — format-vs-body consistency. The JSON schema
  // marks `optimizer` OPTIONAL for v0.4.0/v0.5.0/v0.6.0 (the `required` set is
  // byte-identical to v0.1.0's), so a v0.1.0-shaped body — no optimizer block —
  // validates cleanly against the v0.5.0 schema. That let a MISLABELED sidecar
  // (`format: "framework-trace.v0.5.0"` on a plain-SGD body) be silently
  // accepted and emitted as a downgraded schema_version "0.4.0" SGD receipt.
  // These format consts PROMISE optimizer semantics; if the body doesn't carry
  // the matching `optimizer` block, the sidecar is mislabeled. Reject it with a
  // diagnosable message instead of silently reinterpreting it. (v0.7.0 is the
  // live-helper format and legitimately carries plain SGD with no optimizer
  // block, so it is intentionally NOT in this set. v0.1.0/v0.3.0 are SGD/batched
  // SGD and never carry optimizer.) Not a soundness change — Rule 14 still
  // re-checks every accepted receipt; this only makes a mislabel diagnosable
  // rather than silently downgraded.
  const declaredFmt = sidecar.format
  const requiredOptimizerNames =
    declaredFmt === "framework-trace.v0.4.0"
      ? (["adam", "adamw"] as const)
      : declaredFmt === "framework-trace.v0.5.0" ||
          declaredFmt === "framework-trace.v0.6.0"
        ? (["sgd_momentum"] as const)
        : undefined
  if (requiredOptimizerNames !== undefined) {
    const optName = sidecar.optimizer?.name
    if (optName === undefined || !requiredOptimizerNames.includes(optName as never)) {
      throw new Error(
        `${callerLabel}: sidecar declares format='${declaredFmt}' but its body does not match that ` +
          `format's optimizer contract (expected optimizer.name ∈ {${requiredOptimizerNames.join(", ")}}, ` +
          `got ${optName === undefined ? "no optimizer block" : `'${optName}'`}). ` +
          `This looks like a MISLABELED sidecar. HINT: a plain-SGD step is 'framework-trace.v0.1.0'; ` +
          `set \`format\` to match the optimizer the step actually used, or add the matching \`optimizer\` ` +
          `block. (Rule 14 re-checks the math regardless; this guard prevents a silent format downgrade.)`,
      )
    }
  }

  // ING-2 — verifier-owned ingest cap (structural layer). Post-validation
  // mirror of the raw-byte cap: reject a sidecar whose updates[] / number-maps
  // carry more than MAX_SIDECAR_COLLECTION_ENTRIES entries, BEFORE the
  // per-field differential iteration + emit. The schemas' maxItems /
  // maxProperties already enforce this at validation; this guarantees the check
  // holds even for a sidecar that validated against a bound-less schema, and
  // keeps a diagnosable cap message ahead of any downstream throw.
  assertSidecarCollectionsWithinCap(sidecar, callerLabel)

  // ING-B-002 (Stage C / degradation) — sidecar completeness pre-emit. A
  // sidecar that declares a parameter in topology.parameter_order but OMITS it
  // from parameters_after is a cross-reference invariant the JSON-shape schema
  // does NOT enforce (parameters_after is a free number-map). Such a sidecar
  // currently builds a receipt and only fails LATER at reconcile (Rule 14
  // COMPLETENESS / FIX-2, reconcile.ts — parameters_after key-set must EQUAL
  // parameter_order). Fail EARLY at import time with a structured error naming
  // the missing key(s) so the operator gets an actionable diagnostic at the
  // ingest boundary rather than a deferred reconcile failure. NOT a new
  // soundness gate — Rule 14 remains the authority and still re-checks every
  // accepted receipt; this is the helpful early-failure half of the
  // verifier-owned-limits discipline.
  assertSidecarCrossReferencesComplete(sidecar, callerLabel)

  // 4. Resolve defaults.
  // imports-B-003 (observability note): `differentialTolerance` is passed
  // verbatim BOTH into the importer's own Rule-14-equivalent differential below
  // AND onto the emitted receipt's `attestor.differential_tolerance`, so the
  // importer's self-report and the persisted claim always agree. This is NOT a
  // soundness concern: at the gate, reconciler Rule 14 independently clamps the
  // applied tolerance to OBSERVER_NUMERIC_TOLERANCE_CEILING {atol:1e-5,rtol:1e-3}
  // for external_imported receipts (see reconcile.ts), so an operator who passes
  // a looser-than-ceiling tolerance here cannot widen the gate — the verifier
  // owns the ceiling. The value recorded on the receipt is the operator's
  // declared intent (forensic), and may be tighter than the ceiling but never
  // effectively looser at verification time.
  const differentialTolerance =
    opts?.differentialTolerance ?? { atol: 1e-6, rtol: 1e-4 }
  const extractorIdentity = opts?.extractorIdentity ?? defaultExtractorIdentity
  const importTimestamp = opts?.importTimestamp ?? new Date().toISOString()
  const fixtureLabel =
    opts?.fixtureLabel ?? `${sidecar.source_framework.name}-imported-step`

  // 5. Run engine differentially. v0.9: dispatch on sidecar.batch presence —
  // batched sidecars use runBatchedGeneralStep with the sidecar's per_sample
  // data; unbatched sidecars use runGeneralStep on the single sample at
  // top-level inputs/targets (v0.6-v0.8 behavior).
  const tolerance: TolerancePolicy = differentialTolerance
  const disagreements: ObserverImportResult["differentialDisagreements"] = []
  const compare = (
    fieldPath: string,
    engineVal: number,
    claimedVal: number,
  ): void => {
    const check = applyToleranceCheck(engineVal, claimedVal, tolerance)
    if (!check.ok) {
      disagreements.push({
        fieldPath,
        delta: check.delta,
        appliedTolerance: check.appliedTolerance,
        stored: claimedVal,
        recomputed: engineVal,
      })
    }
  }

  let engineReceipt: GeneralReceipt
  if (sidecar.batch !== undefined) {
    // BATCHED path (v0.9+). framework-trace.v0.3.0 sidecars with a `batch`
    // block + `per_sample` block.
    if (sidecar.per_sample === undefined) {
      throw new Error(
        `${callerLabel}: sidecar declares batch but is missing the per_sample block. ` +
          `Multi-sample batched receipts require per_sample to be populated for every sample in batch.sample_order.`,
      )
    }
    const batchedInput: BatchedGeneralInput = {
      topology: sidecar.topology,
      learning_rate: sidecar.learning_rate,
      batch: sidecar.batch,
      parameters_before: sidecar.parameters_before,
      per_sample: Object.fromEntries(
        sidecar.batch.sample_order.map((sid) => {
          const s = sidecar.per_sample![sid]
          if (!s) {
            throw new Error(
              `${callerLabel}: sidecar.per_sample missing entry for sample_id ${JSON.stringify(sid)} declared in batch.sample_order.`,
            )
          }
          return [sid, { inputs: s.inputs, targets: s.targets }]
        }),
      ),
      numeric_policy:
        sidecar.numeric_policy ?? DEFAULT_NUMERIC_POLICY_FOR_OBSERVER,
      bias_policy: resolveBiasPolicyForSidecar(sidecar),
    }
    engineReceipt = runBatchedGeneralStep(batchedInput)

    // 6. Differential check — per-sample forward + per-sample loss + reduced
    // loss. Per-sample comparison is the load-bearing batched check.
    for (const sid of sidecar.batch.sample_order) {
      const engineSample = engineReceipt.per_sample?.[sid]
      const sidecarSample = sidecar.per_sample[sid]
      if (!engineSample || !sidecarSample) continue
      // R14-PERSAMPLE-OMISSION mirror — the producer-side verification_state
      // claim must not be WEAKER than the verifier's (reconcile.ts Rule 14
      // per-sample COMPLETENESS). Pre-fix this loop used `if (!c) continue`
      // for a missing per-sample forward unit and `if (typeof cVal !== "number")
      // continue` for a missing per-sample loss component, so a sidecar that
      // DROPPED a nested per_sample field still reported differentialPassed=true.
      // Treat any omitted/incomplete per-sample forward unit or loss field as a
      // differential disagreement (key-set-EQUAL + both-scalars-present), so a
      // dropped per-sample field cannot escape the producer's claim by omission.
      const sForward = sidecarSample.forward ?? {}
      const eForwardKeys = Object.keys(engineSample.forward)
      const eForwardSet = new Set<string>(eForwardKeys)
      for (const uId of eForwardKeys) {
        const e = engineSample.forward[uId]!
        const c = sForward[uId]
        if (!c) {
          // COMPLETENESS — per-sample forward unit absent from the sidecar.
          disagreements.push({
            fieldPath: `per_sample.${sid}.forward.${uId}`,
            delta: Number.NaN,
            appliedTolerance: 0,
            stored: 0,
            recomputed: 0,
          })
          continue
        }
        if (typeof c.net !== "number") {
          disagreements.push({
            fieldPath: `per_sample.${sid}.forward.${uId}.net`,
            delta: Number.NaN,
            appliedTolerance: 0,
            stored: 0,
            recomputed: 0,
          })
        } else {
          compare(`per_sample.${sid}.forward.${uId}.net`, e.net, c.net)
        }
        if (typeof c.out !== "number") {
          disagreements.push({
            fieldPath: `per_sample.${sid}.forward.${uId}.out`,
            delta: Number.NaN,
            appliedTolerance: 0,
            stored: 0,
            recomputed: 0,
          })
        } else {
          compare(`per_sample.${sid}.forward.${uId}.out`, e.out, c.out)
        }
      }
      // COMPLETENESS — extra per-sample forward unit not produced by the engine.
      for (const uId of Object.keys(sForward)) {
        if (!eForwardSet.has(uId)) {
          disagreements.push({
            fieldPath: `per_sample.${sid}.forward.${uId}`,
            delta: Number.NaN,
            appliedTolerance: 0,
            stored: 0,
            recomputed: 0,
          })
        }
      }
      const sLossPerOutput = sidecarSample.loss?.per_output ?? {}
      const eLossPerOutputKeys = Object.keys(engineSample.loss.per_output)
      const eLossPerOutputSet = new Set<string>(eLossPerOutputKeys)
      for (const uId of eLossPerOutputKeys) {
        const eVal = engineSample.loss.per_output[uId]!
        const cVal = sLossPerOutput[uId]
        if (typeof cVal !== "number") {
          // COMPLETENESS — per-sample loss component absent from the sidecar.
          disagreements.push({
            fieldPath: `per_sample.${sid}.loss.per_output.${uId}`,
            delta: Number.NaN,
            appliedTolerance: 0,
            stored: 0,
            recomputed: 0,
          })
          continue
        }
        compare(`per_sample.${sid}.loss.per_output.${uId}`, eVal, cVal)
      }
      for (const uId of Object.keys(sLossPerOutput)) {
        if (!eLossPerOutputSet.has(uId)) {
          disagreements.push({
            fieldPath: `per_sample.${sid}.loss.per_output.${uId}`,
            delta: Number.NaN,
            appliedTolerance: 0,
            stored: 0,
            recomputed: 0,
          })
        }
      }
      // COMPLETENESS — per-sample loss.total must be present and numeric.
      if (typeof sidecarSample.loss?.total !== "number") {
        disagreements.push({
          fieldPath: `per_sample.${sid}.loss.total`,
          delta: Number.NaN,
          appliedTolerance: 0,
          stored: 0,
          recomputed: 0,
        })
      } else {
        compare(`per_sample.${sid}.loss.total`, engineSample.loss.total, sidecarSample.loss.total)
      }
    }
    // Reduced loss comparison.
    for (const uId of Object.keys(engineReceipt.loss.per_output)) {
      const eVal = engineReceipt.loss.per_output[uId]!
      const cVal = sidecar.loss.per_output[uId]
      if (typeof cVal !== "number") continue
      compare(`loss.per_output.${uId}`, eVal, cVal)
    }
    compare("loss.total", engineReceipt.loss.total, sidecar.loss.total)
    // G-008 — reduced (top-level) backward + updates + parameters_after.
    // Rule 14 recomputes against these top-level fields on a batched receipt;
    // the importer's differential must do the same or it is a weaker claim.
    compareReducedFullFieldSet(compare, engineReceipt, sidecar)
  } else {
    // UNBATCHED path (v0.6/v0.7/v0.8 behavior + v0.9.1 Adam/AdamW).
    // Preserves byte-identical emission for v0.1.0/v0.2.0 sidecars when
    // sidecar.optimizer is absent. When sidecar.optimizer.name is
    // adam/adamw, the engine takes the Adam path and emits v0.5.0 receipts.
    const engineInputBase: GeneralInput = {
      topology: sidecar.topology,
      learning_rate: sidecar.learning_rate,
      inputs: sidecar.inputs,
      targets: sidecar.targets,
      parameters_before: sidecar.parameters_before,
      numeric_policy:
        sidecar.numeric_policy ?? DEFAULT_NUMERIC_POLICY_FOR_OBSERVER,
      bias_policy: resolveBiasPolicyForSidecar(sidecar),
    }
    let engineInput: GeneralInput = engineInputBase
    // v0.9.1 — Adam/AdamW dispatch. v0.9.2 — sgd_momentum dispatch.
    if (sidecar.optimizer !== undefined && sidecar.optimizer.name !== "sgd") {
      const ocIn = sidecar.optimizer
      const oc: OptimizerConfig = {
        name: ocIn.name,
        learning_rate: ocIn.learning_rate,
        ...(ocIn.beta1 !== undefined ? { beta1: ocIn.beta1 } : {}),
        ...(ocIn.beta2 !== undefined ? { beta2: ocIn.beta2 } : {}),
        ...(ocIn.epsilon !== undefined ? { epsilon: ocIn.epsilon } : {}),
        ...(ocIn.t !== undefined ? { t: ocIn.t } : {}),
        ...(ocIn.weight_decay !== undefined
          ? { weight_decay: ocIn.weight_decay }
          : {}),
        ...(ocIn.momentum !== undefined ? { momentum: ocIn.momentum } : {}),
        // sgd_momentum Nesterov / dampening MUST flow into the engine's
        // differential recompute. Omitting them made the engine treat a
        // Nesterov step as classical (update = lr*buffer instead of
        // lr*(grad + mu*buffer)) → a false Rule 14 disagreement on a valid
        // step (caught by torch end-to-end). They are already emitted onto the
        // receipt's optimizer_config below, so reconcileMultiStep saw them;
        // only this differential path missed them.
        ...(ocIn.nesterov === true ? { nesterov: true } : {}),
        ...(typeof ocIn.dampening === "number" && ocIn.dampening !== 0
          ? { dampening: ocIn.dampening }
          : {}),
      }
      // Extract per-parameter state_before from sidecar updates[].optimizer.state_before.
      // Shape dispatches on optimizer.name: Adam/AdamW get AdamState ({m, v});
      // sgd_momentum gets MomentumState ({buffer}).
      const stateBefore: Record<string, OptimizerStateAny> = {}
      for (const u of sidecar.updates) {
        const optAny = (u as { optimizer?: { state_before?: OptimizerStateAny } }).optimizer
        const sb = optAny?.state_before
        if (sb !== undefined) {
          if (ocIn.name === "sgd_momentum") {
            const sbMom = sb as Partial<MomentumState>
            if (typeof sbMom.buffer === "number") {
              stateBefore[u.parameter_id] = { buffer: sbMom.buffer }
            }
          } else {
            const sbAdam = sb as Partial<AdamState>
            if (typeof sbAdam.m === "number" && typeof sbAdam.v === "number") {
              stateBefore[u.parameter_id] = { m: sbAdam.m, v: sbAdam.v }
            }
          }
        }
      }
      engineInput = {
        ...engineInputBase,
        optimizer_config: oc,
        optimizer_state_before: stateBefore,
      }
    }
    engineReceipt = runGeneralStep(engineInput)

    // G-008 — FULL field-set differential. Mirrors reconciler Rule 14
    // (checkRule14EngineRecomputeDifferential, reconcile.ts) so the importer's
    // own differentialPassed / verification_state is NOT a weaker claim than
    // the gate. Covers forward + loss + backward + updates (+ optimizer
    // state_after) + parameters_after.
    compareUnbatchedFullFieldSet(compare, engineReceipt, sidecar)
  }

  const differentialPassed = disagreements.length === 0

  // 7. Build v0.4.0 observer-mode receipt. Foreign claims become canonical
  //    fields; engine recompute is the WITNESS, not the content
  //    (Reproducible Builds discipline).
  const attestor: Attestor = {
    computed_by: {
      kind: "framework",
      identity: `${sidecar.source_framework.name}@${sidecar.source_framework.version}`,
    },
    verified_by: {
      kind: "engine",
      // Engine identity is the SEMANTIC version of the deterministic
      // verifier (runGeneralStep + emitGeneralReceipt + reconciler), NOT
      // the npm package version. v0.6.0 shipped the engine at "0.6.0";
      // v0.6.1 added a JAX adapter (new wrapper) but did not change
      // engine semantics, so the identity stays at "0.6.0". Bump only
      // when actual engine math/emission changes — that's the load-
      // bearing claim downstream consumers check.
      identity: "backprop-trace-engine@0.6.0",
    },
    differential_tolerance: differentialTolerance,
    import_provenance: {
      // v0.9 — source_format mirrors the actual sidecar's format const, not
      // hardcoded. v0.1.0/v0.2.0/v0.3.0 all flow through this code path.
      source_format: sidecar.format,
      source_hash: sourceHash,
      import_timestamp: importTimestamp,
    },
  }

  // Extractor sub-block: derive name + version from the resolved identity
  // string ("bp-import-pytorch@0.6.0" -> name="bp-import-pytorch", version="0.6.0").
  // imports-B-002: split on the LAST `@` so a scoped/multi-`@` identity loses no
  // data (byte-equal for the single-`@` default identities).
  const { name: extractorName, version: extractorVersion } =
    splitExtractorIdentity(extractorIdentity)
  const sourceFramework: SourceFramework = {
    name: sidecar.source_framework.name,
    version: sidecar.source_framework.version,
    ...(sidecar.source_framework.information_uri !== undefined && {
      information_uri: sidecar.source_framework.information_uri,
    }),
    extractor: {
      name: extractorName,
      version: extractorVersion,
    },
  }

  const verificationState = differentialPassed
    ? "engine_recompute_matched_within_tolerance"
    : "engine_recompute_disagreed"

  // v0.9.1 — schema_version "0.5.0" for Adam/AdamW receipts (forced bump),
  // "0.4.0" for SGD observer-mode receipts (byte-equal preservation with
  // v0.6/v0.7/v0.8/v0.9.0 SGD observer-mode receipts).
  // v0.9.2 — schema_version "0.6.0" for classical sgd_momentum receipts.
  // v0.9.3 — schema_version "0.7.0" for sgd_momentum receipts with
  // nesterov=true OR dampening>0 (classical sgd_momentum stays at "0.6.0"
  // for byte-equal preservation).
  const isAdamFamilyImport =
    sidecar.optimizer !== undefined &&
    (sidecar.optimizer.name === "adam" || sidecar.optimizer.name === "adamw")
  const isSgdMomentumImport =
    sidecar.optimizer !== undefined && sidecar.optimizer.name === "sgd_momentum"
  const usesNesterovOrDampening =
    isSgdMomentumImport &&
    sidecar.optimizer !== undefined &&
    ((sidecar.optimizer.nesterov === true) ||
      (sidecar.optimizer.dampening !== undefined && sidecar.optimizer.dampening !== 0))
  const receiptSchemaVersion: "0.4.0" | "0.5.0" | "0.6.0" | "0.7.0" = usesNesterovOrDampening
    ? "0.7.0"
    : isSgdMomentumImport
      ? "0.6.0"
      : isAdamFamilyImport
        ? "0.5.0"
        : "0.4.0"

  const receipt: GeneralReceipt = {
    schema_version: receiptSchemaVersion,
    fixture: fixtureLabel,
    step: 1,
    fixture_status: {
      authoring_state:
        "external_imported" as unknown as GeneralReceipt["fixture_status"]["authoring_state"],
      verification_state:
        verificationState as unknown as GeneralReceipt["fixture_status"]["verification_state"],
      canonical: true,
    },
    source_framework: sourceFramework,
    attestor,
    metadata: {
      source: `bp-import-${expectedFrameworkName} (sidecar from ${sidecar.source_framework.name}@${sidecar.source_framework.version})`,
      gradient_convention: "descent_direction",
    },
    numeric_policy:
      sidecar.numeric_policy ?? DEFAULT_NUMERIC_POLICY_FOR_OBSERVER,
    bias_policy: resolveBiasPolicyForSidecar(sidecar),
    topology: engineReceipt.topology,
    learning_rate: sidecar.learning_rate,
    // v0.9.1 — emit optimizer_config block ONLY when Adam/AdamW (preserves
    // SGD observer-mode receipt byte-equality with v0.6-v0.9.0). The block
    // carries name + lr + beta1/beta2/epsilon/t (and weight_decay for adamw).
    // v0.9.2 — same emission for sgd_momentum (momentum hyperparameter).
    ...((isAdamFamilyImport || isSgdMomentumImport) && sidecar.optimizer !== undefined
      ? {
          optimizer_config: {
            name: sidecar.optimizer.name,
            learning_rate: sidecar.optimizer.learning_rate,
            ...(sidecar.optimizer.beta1 !== undefined
              ? { beta1: sidecar.optimizer.beta1 }
              : {}),
            ...(sidecar.optimizer.beta2 !== undefined
              ? { beta2: sidecar.optimizer.beta2 }
              : {}),
            ...(sidecar.optimizer.epsilon !== undefined
              ? { epsilon: sidecar.optimizer.epsilon }
              : {}),
            ...(sidecar.optimizer.t !== undefined ? { t: sidecar.optimizer.t } : {}),
            ...(sidecar.optimizer.weight_decay !== undefined
              ? { weight_decay: sidecar.optimizer.weight_decay }
              : {}),
            ...(sidecar.optimizer.momentum !== undefined
              ? { momentum: sidecar.optimizer.momentum }
              : {}),
            ...(sidecar.optimizer.nesterov === true ? { nesterov: true } : {}),
            ...(typeof sidecar.optimizer.dampening === "number" && sidecar.optimizer.dampening !== 0
              ? { dampening: sidecar.optimizer.dampening }
              : {}),
          } satisfies OptimizerConfig,
        }
      : {}),
    // v0.9 — batched receipts carry batch + per_sample blocks; unbatched
    // receipts omit them (preserves byte-equality for v0.6-v0.8 fixtures).
    ...(sidecar.batch !== undefined ? { batch: sidecar.batch } : {}),
    inputs: sidecar.inputs,
    targets: sidecar.targets,
    parameters_before: sidecar.parameters_before,
    ...(sidecar.per_sample !== undefined ? { per_sample: sidecar.per_sample } : {}),
    forward: sidecar.forward,
    loss: sidecar.loss,
    backward: sidecar.backward,
    updates: sidecar.updates,
    parameters_after: sidecar.parameters_after,
    post_update_forward:
      sidecar.post_update_forward ?? engineReceipt.post_update_forward,
    post_update_loss:
      sidecar.post_update_loss ?? engineReceipt.post_update_loss,
  }

  // ING-B-001 (Stage C / observability) — forensic helper-block passthrough.
  // The sidecar's FrameworkTraceSidecar.helper block (live-helper attribution:
  // name / version / source_hash / framework / runtime / extraction) was being
  // DROPPED — the comment on the field promised it is "passed through to the
  // receipt for post-hoc attribution", but neither receipt-build path attached
  // it, so a downstream reader could never see which live helper produced the
  // imported step. Attach it now (forensic attribution ONLY — it is NOT a
  // credential; Rule 14 remains the authority and never consults this block for
  // gate logic). The canonical emitter (emitGeneralReceipt) is a schema-ordered
  // serializer that emits only the receipt's declared field set, so attaching
  // helper to the in-memory receipt does NOT change the emitted bytes — every
  // golden stays byte-identical — while the returned receipt object now exposes
  // the attribution to any caller that inspects `result.receipt.helper`.
  attachHelperAttribution(receipt, sidecar.helper)

  // 8. Emit canonical bytes.
  const emittedBytes = emitGeneralReceipt(receipt)

  return {
    receipt,
    emittedBytes,
    differentialPassed,
    differentialDisagreements: disagreements,
  }
}

// --- Helpers ---------------------------------------------------------------

/**
 * ING-B-005 (Stage C / degradation-UX) — closed list of the optimizer names the
 * verifier accepts, in the canonical doc order. Exported so the rejection
 * message (assertSidecarOptimizerSupported) and any future caller name the same
 * set the schemas + engine enforce (general-engine.ts runGeneralStep:
 * "optimizer_config.name must be 'sgd', 'adam', 'adamw', or 'sgd_momentum'").
 */
export const SUPPORTED_OPTIMIZER_NAMES: readonly string[] = [
  "sgd",
  "sgd_momentum",
  "adam",
  "adamw",
]

/**
 * ING-B-005 (Stage C / degradation-UX) — reject an empty / whitespace-only
 * sidecar with the SAME actionable diagnostic that parse.ts (parseReceiptJsonl)
 * and parse-input.ts already emit, instead of letting it fall through to the
 * opaque `JSON.parse` failure ("Unexpected end of JSON input"). A piped empty
 * file is a common operator mistake; this names the importer + the empty
 * condition + a remediation hint. Mirrors the importer's Tier-1 envelope (a
 * thrown Error with a diagnosable message).
 */
function assertSidecarNotEmpty(sidecarBytes: string, callerLabel: string): void {
  if (sidecarBytes.trim().length === 0) {
    throw new Error(
      `${callerLabel}: sidecar is empty (no non-whitespace content). ` +
        `Hint: an empty or whitespace-only input usually means a missing or mis-piped file ` +
        `(e.g. \`bp import ... < missing.jsonl\` or an empty redirection). Provide a sidecar ` +
        `containing one JSON object (single-step) or one JSON object per line (multi-step JSONL).`,
    )
  }
}

/**
 * ING-B-003 (Stage C / degradation-UX) — when a sidecar declares an
 * `optimizer.name` outside the closed supported set, surface a message that
 * NAMES the supported set instead of the opaque Ajv "must be equal to one of the
 * allowed values". Runs on the raw parsed value BEFORE schema validation so the
 * helpful message wins. Only fires for a STRING optimizer.name that is not
 * supported — a missing/non-string optimizer block (legitimate plain-SGD
 * sidecars omit it entirely) is a no-op, and any other shape problem still falls
 * through to schema validation. NOT a soundness change — the schema already
 * rejects these; this only improves the rejection message.
 */
function assertSidecarOptimizerSupported(
  parsed: unknown,
  callerLabel: string,
): void {
  if (typeof parsed !== "object" || parsed === null) return
  const optimizer = (parsed as Record<string, unknown>).optimizer
  if (typeof optimizer !== "object" || optimizer === null) return
  const name = (optimizer as Record<string, unknown>).name
  if (typeof name !== "string") return
  if (SUPPORTED_OPTIMIZER_NAMES.includes(name)) return
  throw new Error(
    `${callerLabel}: sidecar declares optimizer.name='${name}', which is not a supported optimizer. ` +
      `Supported optimizers: ${SUPPORTED_OPTIMIZER_NAMES.join(", ")}. ` +
      `Hint: backprop-trace verifies a closed set of optimizers (plain SGD, SGD with momentum — ` +
      `classical / Nesterov / dampening — and Adam / AdamW). An unsupported optimizer (e.g. Lion, ` +
      `AMSGrad, RMSProp) cannot be re-derived by the engine, so the sidecar is rejected here rather ` +
      `than producing an unverifiable receipt. Re-run the training step with a supported optimizer, ` +
      `or omit the optimizer block for a plain-SGD step.`,
  )
}

/**
 * ING-B-002 (Stage C / degradation) — fail EARLY at import time when a sidecar's
 * `parameters_after` omits a parameter declared in `topology.parameter_order`
 * (or carries an extra undeclared one). This is a cross-reference invariant the
 * JSON-shape schema does NOT enforce — `parameters_after` is a free number-map —
 * so without this check the importer builds a receipt and the omission is only
 * caught LATER at reconcile (Rule 14 COMPLETENESS / FIX-2, reconcile.ts, which
 * requires parameters_after's key set to EQUAL parameter_order).
 *
 * This is NOT a new soundness gate: Rule 14 remains the authority and still
 * re-checks every accepted receipt. It is the helpful early-failure half of the
 * verifier-owned-limits discipline — an operator who drops a final-state value
 * gets an actionable message naming the missing key(s) at the ingest boundary
 * instead of a deferred reconcile failure. The message mirrors Rule 14's
 * COMPLETENESS wording so the early and late diagnostics read the same.
 *
 * Applies the same key-set-EQUAL check to the batched `per_sample[*].forward`
 * maps when cheaply consistent (each per-sample forward must declare exactly the
 * topology's unit_order hidden+output units the engine recomputes). Missing keys
 * are named; extras are named. Both directions matter — a smuggled extra key is
 * the same omission class as a dropped one.
 */
function assertSidecarCrossReferencesComplete(
  sidecar: FrameworkTraceSidecar,
  callerLabel: string,
): void {
  const declaredOrder = sidecar.topology?.parameter_order
  if (!Array.isArray(declaredOrder)) return // schema guarantees presence; defensive
  const after = sidecar.parameters_after ?? {}
  const afterKeys = new Set<string>(Object.keys(after))
  const declaredSet = new Set<string>(declaredOrder)

  const missing = declaredOrder.filter((pid) => !afterKeys.has(pid))
  if (missing.length > 0) {
    throw new Error(
      `${callerLabel}: sidecar parameters_after is missing parameter(s) ${JSON.stringify(missing)} ` +
        `declared in topology.parameter_order; every declared parameter must have an after-value. ` +
        `Hint: parameters_after's key set must EQUAL topology.parameter_order (the same COMPLETENESS ` +
        `invariant Rule 14 enforces at reconcile — caught here EARLY so a dropped final-state value is ` +
        `named at import time, not deferred to verification). Add the missing after-value(s), or remove ` +
        `the parameter(s) from parameter_order if the step genuinely did not produce them.`,
    )
  }
  const extra = Object.keys(after).filter((pid) => !declaredSet.has(pid))
  if (extra.length > 0) {
    throw new Error(
      `${callerLabel}: sidecar parameters_after declares parameter(s) ${JSON.stringify(extra)} ` +
        `NOT present in topology.parameter_order; parameters_after's key set must EQUAL ` +
        `topology.parameter_order (no extra/undeclared final-state keys). ` +
        `Hint: add the parameter(s) to parameter_order if they are real, or remove the stray ` +
        `after-value(s). (Same key-set-EQUAL invariant Rule 14 enforces at reconcile.)`,
    )
  }
}

/**
 * ING-B-001 (Stage C / observability) — attach the sidecar's forensic
 * `helper` block to a built receipt so a downstream reader can see the live
 * helper's name / version / source_hash / framework / runtime / extraction. The
 * `helper` field is documented (FrameworkTraceSidecar.helper) as "passed through
 * to the receipt for post-hoc attribution" but was being dropped by both
 * receipt-build paths; this wires it through.
 *
 * NEVER a credential — Rule 14 (engine-recompute differential) remains the
 * authority on every external_imported receipt regardless of what this block
 * claims. The canonical emitter (emitGeneralReceipt) is a schema-ordered
 * serializer that emits only the receipt's declared field set, so attaching
 * `helper` to the in-memory receipt object does NOT change the emitted bytes
 * (every golden stays byte-identical) — it only exposes the attribution to
 * callers that inspect the returned receipt object. A no-op when the sidecar
 * carries no helper block (preserves byte- and shape-equality for hand-authored
 * sidecars). Attached via a typed cast because the engine's GeneralReceipt type
 * does not declare this forensic field.
 */
function attachHelperAttribution(
  receipt: GeneralReceipt,
  helper: HelperBlock | undefined,
): void {
  if (helper === undefined) return
  ;(receipt as GeneralReceipt & { helper?: HelperBlock }).helper = helper
}

/**
 * imports-B-002 (Stage C) — split an extractor identity string into
 * `{name, version}` without silently dropping data when the identity contains
 * more than one `@`.
 *
 * The convention is `"<name>@<version>"` (e.g. "bp-import-pytorch@0.6.0"), so
 * the default path has exactly one `@`. But a caller-supplied
 * `opts.extractorIdentity` could be an npm-scoped name like
 * `"@my-scope/tool@1.2.3"`. The old `split("@")[1]` took only the FIRST segment
 * after the first `@` ("my-scope/tool" misread, or for "a@b@c" → version "b",
 * silently discarding "@c"). This splits on the LAST `@` so the version is the
 * final segment and the name keeps any leading/embedded `@` — no silent loss.
 * Identity with no `@` → version "unversioned" (unchanged). Byte-equal for every
 * single-`@` identity, so all shipped goldens are unaffected. Observability-only
 * (the extractor sub-block is forensic attribution; Rule 14 is the authority).
 */
function splitExtractorIdentity(identity: string): {
  name: string
  version: string
} {
  const lastAt = identity.lastIndexOf("@")
  // No `@`, or a leading-only `@` (scoped name with no version, e.g.
  // "@scope/tool") → no version segment; keep the whole string as the name.
  if (lastAt <= 0) {
    return { name: identity, version: "unversioned" }
  }
  return {
    name: identity.slice(0, lastAt),
    version: identity.slice(lastAt + 1),
  }
}

// --- Defaults --------------------------------------------------------------

/**
 * imports-B-001 (Stage C) — closed allowlist of `format` consts the SINGLE-step
 * importer accepts. This is the single-step mirror of the multi-step path's
 * accepted-version set (buildObserverReceiptStreamFromSidecar step 3, which
 * accepts {v0.2.0..v0.7.0} and rejects v0.1.0 → "use single-step").
 *
 * The single-step set is {v0.1.0, v0.3.0, v0.4.0, v0.5.0, v0.6.0, v0.7.0}:
 *   - v0.1.0: base SGD single-step (original v0.6 fixtures).
 *   - v0.3.0: single-step batched receipts (a `batch` block, no trace_id stream).
 *   - v0.4.0: Adam / AdamW single-step (optimizer block).
 *   - v0.5.0: classical sgd_momentum single-step.
 *   - v0.6.0: sgd_momentum with Nesterov / dampening single-step.
 *   - v0.7.0: live-helper-emitted single-step (helper attribution block).
 * v0.2.0 is deliberately EXCLUDED — it is the multi-step baseline; a v0.2.0
 * sidecar is routed to the multi-step subcommand with a clear hint.
 *
 * Keep in lockstep with the FrameworkTraceSidecar `format` union above and with
 * the multi-step allowlist; both are intentionally explicit (closed-vocabulary
 * discipline) so a future schema version cannot be silently accepted by the
 * dispatcher's format-sniff alone.
 */
const SINGLE_STEP_SUPPORTED_FORMATS: readonly string[] = [
  "framework-trace.v0.1.0",
  "framework-trace.v0.3.0",
  "framework-trace.v0.4.0",
  "framework-trace.v0.5.0",
  "framework-trace.v0.6.0",
  "framework-trace.v0.7.0",
]

/** imports-B-001 — the multi-step (JSONL stream) sidecar baseline format. */
const MULTI_STEP_BASELINE_FORMAT = "framework-trace.v0.2.0"

/**
 * ING-2 — verifier-owned ingest byte cap for a SINGLE sidecar record.
 *
 * The framework-trace schemas now bound every collection
 * (updates[]/factors[]/summation_order[] maxItems, UnitNumberMap /
 * ParameterMap / ForwardMap / loss.per_output maxProperties — see
 * schemas/framework-trace.v0.1.0..v0.7.0). This raw-byte cap is the SECOND
 * layer of the defense-in-depth: it converts the unbounded ingest path into a
 * diagnosable rejection BEFORE the importer parses, validates, iterates, and
 * emits — so even a schema that somehow lacks a bound, or the raw
 * `Invalid string length` thrown by JSON.stringify at emit when the body is
 * enormous, becomes a clear "sidecar exceeds verifier ingest cap" message
 * instead of a multi-second hang or an undiagnosable runtime throw.
 *
 * Mirrors the MAX_BATCH_SAMPLES discipline (general-engine.ts): the verifier
 * owns the limit; the bound is an INCLUSIVE maximum far above any legitimate
 * single-step sidecar (the engine only ever consumes topology.unit_order /
 * topology.parameter_order keys — at most 64 units / a few hundred parameters —
 * so a legitimate sidecar is a few KB to low tens of KB; the largest shipped
 * golden line is ~14 KB). 8 MiB sits ~600x above that yet ~64x BELOW V8's
 * ~512 MB max-string-length (where the raw `Invalid string length` lives), so a
 * 2,000,000-entry updates[] or a 3,000,000-unit forward map — both many MB — is
 * rejected here long before it can be parsed or emitted. NOT a soundness change:
 * Rule 14 remains the authority on every accepted receipt; this only bounds the
 * DoS surface.
 *
 * Exported so tests can pin the value — a silent raise re-opens the hang/OOM
 * surface; a silent lower could reject a legitimate sidecar. Both are
 * regressions that must surface in CI.
 */
export const MAX_SIDECAR_INGEST_BYTES = 8 * 1024 * 1024 // 8 MiB

/**
 * ING-2 — verifier-owned structural cap on the count of entries in any single
 * ingested collection (updates[], forward / parameters maps, loss.per_output,
 * etc.). Kept in lockstep with the schemas' maxItems / maxProperties bound
 * (4096) so the importer's own check and the schema agree. This is the
 * post-validation structural mirror of MAX_SIDECAR_INGEST_BYTES: it fires for a
 * collection that is individually under the byte cap but still pathologically
 * large, and guarantees the check holds even for a hypothetical sidecar that
 * validated against a schema version lacking the bound. INCLUSIVE maximum.
 *
 * Exported for test pinning (same rationale as MAX_SIDECAR_INGEST_BYTES).
 */
export const MAX_SIDECAR_COLLECTION_ENTRIES = 4096

/**
 * ING-2 — reject a sidecar whose raw bytes exceed MAX_SIDECAR_INGEST_BYTES
 * BEFORE any parse / validate / iterate / emit. Mirrors the MAX_BATCH_SAMPLES
 * guard's message shape: name the cap, the observed size, and a remediation
 * hint. Throws a structured Error (the importer's Tier-1 envelope is a thrown
 * Error with a diagnosable message — same pattern as every other guard in this
 * file). Byte length is measured as UTF-8 (Buffer.byteLength), matching the
 * bytes the operator actually ingested.
 */
function assertSidecarWithinIngestCap(
  sidecarBytes: string,
  callerLabel: string,
): void {
  const byteLength = Buffer.byteLength(sidecarBytes, "utf8")
  if (byteLength > MAX_SIDECAR_INGEST_BYTES) {
    throw new Error(
      `${callerLabel}: sidecar exceeds verifier ingest cap ` +
        `(${byteLength} bytes > MAX_SIDECAR_INGEST_BYTES=${MAX_SIDECAR_INGEST_BYTES}). ` +
        `Hint: the importer parses, validates, and re-emits the whole sidecar; an unbounded ` +
        `sidecar (e.g. a multi-million-entry updates[] or forward map) would be held in memory ` +
        `and walked at emit (a multi-second hang, or an undiagnosable runtime string-length ` +
        `failure once it crosses V8's ~512MB string limit) rather than fail cleanly. The cap is an ` +
        `inclusive maximum far above any legitimate single-step sidecar (the engine consumes at ` +
        `most 64 units / a few hundred parameters; the largest shipped golden line is ~14KB). If ` +
        `this is a genuine large trace, it is malformed for single-step ingestion — split it or ` +
        `correct the producer.`,
    )
  }
}

/**
 * ING-2 — post-validation structural cap. Asserts that no single ingested
 * collection (updates[], the forward / parameters / loss number-maps) carries
 * more than MAX_SIDECAR_COLLECTION_ENTRIES entries. The schemas' maxItems /
 * maxProperties already enforce this at validation time; this is the
 * verifier-owned mirror so the check holds even for a sidecar that somehow
 * validated against a schema lacking the bound, and so a diagnosable cap message
 * wins over any downstream `Invalid string length`. Runs BEFORE the per-field
 * differential iteration + emit. Throws the same structured Error shape.
 */
function assertSidecarCollectionsWithinCap(
  sidecar: FrameworkTraceSidecar,
  callerLabel: string,
): void {
  const reject = (what: string, count: number): never => {
    throw new Error(
      `${callerLabel}: sidecar exceeds verifier ingest cap — ${what} has ${count} entries ` +
        `(> MAX_SIDECAR_COLLECTION_ENTRIES=${MAX_SIDECAR_COLLECTION_ENTRIES}). ` +
        `Hint: the importer iterates and re-emits every entry; an unbounded collection is a DoS ` +
        `surface. The cap is an inclusive maximum far above any legitimate single-step sidecar ` +
        `(the engine consumes at most 64 units / a few hundred parameters). This sidecar is ` +
        `malformed for single-step ingestion — split it or correct the producer.`,
    )
  }
  if (Array.isArray(sidecar.updates) && sidecar.updates.length > MAX_SIDECAR_COLLECTION_ENTRIES) {
    reject("updates[]", sidecar.updates.length)
  }
  const mapEntryCount = (m: unknown): number =>
    typeof m === "object" && m !== null ? Object.keys(m as object).length : 0
  const maps: Array<[string, unknown]> = [
    ["inputs", sidecar.inputs],
    ["targets", sidecar.targets],
    ["parameters_before", sidecar.parameters_before],
    ["parameters_after", sidecar.parameters_after],
    ["forward", sidecar.forward],
    ["loss.per_output", sidecar.loss?.per_output],
  ]
  for (const [name, m] of maps) {
    const n = mapEntryCount(m)
    if (n > MAX_SIDECAR_COLLECTION_ENTRIES) reject(name, n)
  }
}

const DEFAULT_NUMERIC_POLICY_FOR_OBSERVER: GeneralInput["numeric_policy"] = {
  number_encoding: "decimal",
  precision_significant_digits: 9,
  rounding: "round_half_to_even",
  // FIX-3b — FLOAT32-grade observer default. The live PyTorch/JAX/TF helpers
  // emit sidecars that OMIT numeric_policy, so imported receipts inherit this
  // value. A real DEFAULT-float32 framework step drifts ~1e-8..2.3e-5 from the
  // engine's float64 recompute; the old float64-grade {atol:1e-11, rtol:1e-7}
  // was far tighter than that drift, so a VALID imported step failed Rule 5/6/7
  // internal-consistency at the gate (a false FAIL). {atol:1e-6, rtol:1e-4} is
  // float32-appropriate and sits one order UNDER the reconciler's
  // OBSERVER_NUMERIC_TOLERANCE_CEILING {1e-5, 1e-3} (the bound the
  // authoring-aware clamp enforces on external_imported receipts). This governs
  // ONLY internal-consistency; Rule 14 (the engine-recompute differential,
  // ceiling {1e-5, 1e-3}) is the real authority and catches any TRUE divergence.
  tolerance: { atol: 1e-6, rtol: 1e-4 },
  computation_order: "schema_defined",
  byte_output: {
    format: "jsonl",
    json_key_order: "schema_defined",
    trailing_zero_policy: "pad_to_significant_digits",
    indent: "none",
  },
}

const DEFAULT_BIAS_POLICY_FOR_OBSERVER: GeneralInput["bias_policy"] = {
  mode: "constant",
  reason:
    "Default for v0.6 observer-mode receipts: sidecar omitted bias_policy; importer assumes Mazur convention (biases constant on step 1).",
  updated_in_step: false,
  reconciliation:
    "parameters_after[bias_id] === parameters_before[bias_id] for every bias parameter",
}

/**
 * G-015 — bias_policy for an observer-mode sidecar that omits one.
 *
 * The live PyTorch helper (scripts/extract/pytorch.py) emits per-neuron
 * biases (`bias_sharing: "per_neuron"`, one `b_h<k>` / `b_o<k>` parameter per
 * neuron) but NO `bias_policy` field. A real `nn.Linear(..., bias=True)` under
 * ANY optimizer updates each per-neuron bias every step, so the engine MUST be
 * told `bias_policy.mode = "sgd"` — otherwise it defaults to `"constant"`,
 * holds the engine's recomputed biases at their before-step values, and Rule 14
 * compares them against the receipt's CHANGED biases → a valid step is rejected
 * (the false FAIL this finding fixes).
 *
 * Decision rule (purely structural — no helper-claim trust; Rule 14 remains the
 * authority):
 *   - If the sidecar carries an explicit `bias_policy`, honor it verbatim.
 *   - Else, if ANY bias parameter's value changes across the step
 *     (parameters_before[b] !== parameters_after[b]), the biases are UPDATING →
 *     route to mode="sgd". The engine's per_neuron + sgd path
 *     (general-engine.ts) then recomputes them and Rule 14 compares apples to
 *     apples. (Requires bias_sharing="per_neuron"; the engine rejects
 *     per_layer + sgd. A bias=False model has all-zero, unchanging biases and
 *     falls through to the constant default below — byte-equal with pre-G-015
 *     SGD observer receipts.)
 *   - Else (no bias changed — bias=False, or a genuinely constant-bias step):
 *     keep the constant default.
 *
 * A "changed" bias is detected with an exact `!==`: the engine recompute is the
 * arbiter of whether the claimed deltas are CORRECT (Rule 14), so this routing
 * only needs to detect INTENT (did the producer move the bias at all). An
 * honest constant-bias step never trips it; a corrupt one is caught downstream.
 */
function resolveBiasPolicyForSidecar(
  sidecar: FrameworkTraceSidecar,
): GeneralInput["bias_policy"] {
  if (sidecar.bias_policy !== undefined) return sidecar.bias_policy
  const before = sidecar.parameters_before ?? {}
  const after = sidecar.parameters_after ?? {}
  const biasParams = (sidecar.topology?.parameters ?? []).filter(
    (p) => p.role === "hidden_bias" || p.role === "output_bias",
  )
  const anyBiasUpdates = biasParams.some((p) => {
    const b = before[p.id]
    const a = after[p.id]
    return typeof b === "number" && typeof a === "number" && b !== a
  })
  if (anyBiasUpdates && sidecar.topology?.bias_sharing === "per_neuron") {
    return {
      mode: "sgd",
      reason:
        "G-015 observer routing: sidecar omitted bias_policy but carries UPDATING per-neuron biases " +
        "(a real nn.Linear(bias=True) under any optimizer); routed to per_neuron + sgd so the engine " +
        "updates biases and Rule 14 compares like-for-like. Rule 14 remains the authority on correctness.",
      updated_in_step: true,
      reconciliation:
        "for every per_neuron bias parameter b_u, parameters_after[b_u] === parameters_before[b_u] + learning_rate * signal_u " +
        "(verified via the optimizer's single-factor gradient under Rules 4-7 / 21-24).",
    }
  }
  return DEFAULT_BIAS_POLICY_FOR_OBSERVER
}

// ---------------------------------------------------------------------------
// G-008 — full-field-set differential helpers.
//
// PURPOSE: the importer's OWN differential (the value it bakes into
// `differentialPassed` and `verification_state`) MUST cover the SAME field set
// as reconciler Rule 14 (checkRule14EngineRecomputeDifferential in
// reconcile.ts). Before v0.12.0 the importer compared ONLY forward.{net,out} +
// loss.per_output[*] + loss.total, so a sidecar with forged backward / updates
// / parameters_after still emitted
// verification_state='engine_recompute_matched_within_tolerance' — active false
// assurance baked into the receipt. (It still failed SAFE at the gate because
// `bp verify` re-runs Rule 14; but the producer-side claim must not be weaker
// than the verifier's.)
//
// `compare` is the per-path tolerance closure from the calling scope; its
// claimed-value argument is `number`, so these helpers guard non-number claims
// (e.g. a sidecar that omits a field) the same way Rule 14's compareScalar does
// — a missing claim is a schema-level concern, not a differential disagreement.
// ---------------------------------------------------------------------------

type ObserverCompareFn = (
  fieldPath: string,
  engineVal: number,
  claimedVal: number,
) => void

/**
 * Compare engine-recomputed backward + updates (+ optimizer state_after) +
 * parameters_after against the sidecar's claimed values. Shared by the
 * unbatched and reduced(batched) full-field-set helpers — these fields live at
 * the receipt's TOP level for both unbatched and batched receipts (a batched
 * receipt carries the REDUCED backward/updates/parameters_after at top level).
 *
 * Mirrors reconcile.ts checkRule14EngineRecomputeDifferential lines for
 * backward.output_error_signals / backward.hidden_error_signals /
 * updates[*].{gradient,update,weight_after} + optimizer.state_after /
 * parameters_after EXACTLY (same field paths, same guards).
 */
function compareBackwardUpdatesParamsFullFieldSet(
  compare: ObserverCompareFn,
  engineReceipt: GeneralReceipt,
  sidecar: FrameworkTraceSidecar,
): void {
  // backward.output_error_signals[*].signal_value
  for (const uId of Object.keys(engineReceipt.backward.output_error_signals)) {
    const eSig = engineReceipt.backward.output_error_signals[uId]!
    const cSig = sidecar.backward?.output_error_signals?.[uId]
    if (!cSig) continue
    if (typeof cSig.signal_value === "number") {
      compare(
        `backward.output_error_signals.${uId}.signal_value`,
        eSig.signal_value,
        cSig.signal_value,
      )
    }
  }

  // backward.hidden_error_signals[*].{backpropagated_sum, activation_derivative, signal_value}
  for (const uId of Object.keys(engineReceipt.backward.hidden_error_signals)) {
    const eSig = engineReceipt.backward.hidden_error_signals[uId]!
    const cSig = sidecar.backward?.hidden_error_signals?.[uId]
    if (!cSig) continue
    if (typeof cSig.backpropagated_sum === "number") {
      compare(
        `backward.hidden_error_signals.${uId}.backpropagated_sum`,
        eSig.backpropagated_sum,
        cSig.backpropagated_sum,
      )
    }
    if (typeof cSig.activation_derivative === "number") {
      compare(
        `backward.hidden_error_signals.${uId}.activation_derivative`,
        eSig.activation_derivative,
        cSig.activation_derivative,
      )
    }
    if (typeof cSig.signal_value === "number") {
      compare(
        `backward.hidden_error_signals.${uId}.signal_value`,
        eSig.signal_value,
        cSig.signal_value,
      )
    }
  }

  // updates[*].{gradient, update, weight_after} (+ optimizer.state_after.{m,v}/{buffer})
  const cUpdatesByParam = new Map<string, FrameworkTraceSidecar["updates"][number]>()
  for (const u of sidecar.updates) cUpdatesByParam.set(u.parameter_id, u)
  for (const eUpdate of engineReceipt.updates) {
    const cUpdate = cUpdatesByParam.get(eUpdate.parameter_id)
    if (!cUpdate) continue
    if (typeof cUpdate.gradient === "number") {
      compare(`updates[${eUpdate.parameter_id}].gradient`, eUpdate.gradient, cUpdate.gradient)
    }
    if (typeof cUpdate.update === "number") {
      compare(`updates[${eUpdate.parameter_id}].update`, eUpdate.update, cUpdate.update)
    }
    if (typeof cUpdate.weight_after === "number") {
      compare(
        `updates[${eUpdate.parameter_id}].weight_after`,
        eUpdate.weight_after,
        cUpdate.weight_after,
      )
    }
    // optimizer.state_after differential (Adam/AdamW: {m,v}; sgd_momentum:
    // {buffer}). Only when both sides declare state_after AND names agree —
    // mirrors reconcile.ts so a missing/SGD state block is a no-op, not a
    // false disagreement.
    const eOpt = (eUpdate as { optimizer?: { name?: unknown; state_after?: unknown } }).optimizer
    const cOpt = (cUpdate as { optimizer?: { name?: unknown; state_after?: unknown } }).optimizer
    if (eOpt?.state_after && cOpt?.state_after && eOpt.name === cOpt.name) {
      const eName = eOpt.name as string
      if (eName === "adam" || eName === "adamw") {
        const ea = eOpt.state_after as AdamState
        const ca = cOpt.state_after as AdamState
        if (typeof ca.m === "number") {
          compare(`updates[${eUpdate.parameter_id}].optimizer.state_after.m`, ea.m, ca.m)
        }
        if (typeof ca.v === "number") {
          compare(`updates[${eUpdate.parameter_id}].optimizer.state_after.v`, ea.v, ca.v)
        }
      } else if (eName === "sgd_momentum") {
        const ea = eOpt.state_after as MomentumState
        const ca = cOpt.state_after as MomentumState
        if (typeof ca.buffer === "number") {
          compare(
            `updates[${eUpdate.parameter_id}].optimizer.state_after.buffer`,
            ea.buffer,
            ca.buffer,
          )
        }
      }
    }
  }

  // parameters_after[*]
  for (const pid of Object.keys(engineReceipt.parameters_after)) {
    const cVal = sidecar.parameters_after?.[pid]
    if (typeof cVal !== "number") continue
    compare(`parameters_after.${pid}`, engineReceipt.parameters_after[pid]!, cVal)
  }
}

/**
 * UNBATCHED full-field-set differential: forward + loss + backward + updates +
 * parameters_after. (loss is compared by the caller right before this for the
 * single-step path, but the multi-step path also relies on the caller's loss
 * compares; this helper deliberately covers forward + the
 * backward/updates/params tail to keep the four call sites uniform without
 * double-comparing loss.)
 *
 * NOTE: callers compare loss BEFORE invoking this helper (preserving the exact
 * pre-existing loss field paths). This helper adds forward + backward + updates
 * + parameters_after.
 */
function compareUnbatchedFullFieldSet(
  compare: ObserverCompareFn,
  engineReceipt: GeneralReceipt,
  sidecar: FrameworkTraceSidecar,
): void {
  // forward[*].{net, out}
  for (const uId of Object.keys(engineReceipt.forward)) {
    const e = engineReceipt.forward[uId]!
    const c = sidecar.forward[uId]
    if (!c) continue
    if (typeof c.net === "number") compare(`forward.${uId}.net`, e.net, c.net)
    if (typeof c.out === "number") compare(`forward.${uId}.out`, e.out, c.out)
  }
  compareBackwardUpdatesParamsFullFieldSet(compare, engineReceipt, sidecar)
}

/**
 * REDUCED (batched) full-field-set differential: the reduced backward +
 * updates + parameters_after at the receipt's top level. Forward + loss are
 * compared PER-SAMPLE by the batched caller (plus reduced loss at top level),
 * so this helper covers only the reduced backward/updates/params tail that the
 * batched paths previously omitted — the exact gap Rule 14 still recomputes.
 */
function compareReducedFullFieldSet(
  compare: ObserverCompareFn,
  engineReceipt: GeneralReceipt,
  sidecar: FrameworkTraceSidecar,
): void {
  compareBackwardUpdatesParamsFullFieldSet(compare, engineReceipt, sidecar)
}

// ---------------------------------------------------------------------------
// v0.8 — multi-step observer-mode ingestion
// ---------------------------------------------------------------------------

/**
 * v0.8 — sidecar shape for a single record of a framework-trace.v0.2.0
 * multi-step JSONL stream. Identical to v0.1.0 sidecar shape plus optional
 * `trace_id` + `step_index` fields. v0.1.0 sidecars satisfy this shape
 * structurally (trace_id + step_index absent), but multi-step ingestion
 * dispatches on the `format` const, so v0.1.0 sidecars are rejected at
 * schema validation.
 */
export type FrameworkTraceSidecarV2 = FrameworkTraceSidecar & {
  trace_id?: string
  step_index?: number
}

/**
 * v0.8 — per-step result of a multi-step observer-mode ingestion.
 */
export type ObserverImportStreamStep = {
  receipt: GeneralReceipt
  differentialPassed: boolean
  differentialDisagreements: Array<{
    fieldPath: string
    delta: number
    appliedTolerance: number
    // See ObserverImportResult.differentialDisagreements — `stored` is the
    // sidecar-CLAIMED value, `recomputed` is the engine value re-derived at
    // import time. Same verify-path Rule-14 quartet semantics.
    stored: number
    recomputed: number
  }>
}

/**
 * v0.8 — result of a multi-step observer-mode ingestion. The emitted
 * bytes are a JSONL stream (one observer-mode v0.4.0 receipt per line,
 * in step order) ready to pipe into `bp verify multi`.
 *
 * `bundleRootDigest` is the sha256 of the canonical-byte concatenation
 * of every receipt with `attestor.bundle_root_digest` stripped (the same
 * value embedded on each receipt's `attestor.bundle_root_digest` and
 * verified by Rule 17). It is an INTEGRITY artifact, not an authenticity
 * artifact — an attacker who controls all receipt bytes and recomputes
 * the bundle digest passes Rule 17 trivially.
 */
export type ObserverImportStreamResult = {
  steps: ObserverImportStreamStep[]
  emittedBytes: string
  allDifferentialsPassed: boolean
  bundleRootDigest: string
}

/**
 * v0.8 shared core — multi-step observer-mode ingestion.
 *
 * Mirrors `buildObserverReceiptFromSidecar` but for a JSONL stream of N
 * sidecar records (one per training step). Each per-framework multi-step
 * wrapper (`importPytorchSidecarStream`, `importJaxSidecarStream`,
 * `importTensorflowSidecarStream`) delegates here with its expected
 * framework name + extractor identity.
 *
 * Pipeline:
 *   1. Hash the whole sidecar JSONL bytes BEFORE parsing → `source_hash`
 *      (embedded identically on every emitted receipt's
 *      attestor.import_provenance). Same byte-stream binding discipline
 *      as the single-step path.
 *   2. Split into non-empty JSON-line records.
 *   3. Validate each record against framework-trace.v0.2.0 (sniffed via
 *      the `format` const dispatcher). v0.1.0 sidecars fail here — the
 *      caller must use the single-step path for those.
 *   4. Assert intra-stream homogeneity:
 *        - All records declare source_framework.name === expectedFrameworkName
 *          AND share name+version (catches mid-stream framework swap)
 *        - All records share trace_id (or all absent — degenerate to
 *          single-record case; importer synthesizes a trace_id from
 *          source_hash when absent)
 *        - step_index dense + monotonic from 0 to N-1 (or all absent —
 *          importer synthesizes 0..N-1 sequentially)
 *   5. For each record, run runGeneralStep + Rule 14 differential check
 *      (same per-step semantics as single-step path).
 *   6. Build N v0.4.0 observer-mode receipts WITHOUT bundle_root_digest.
 *   7. Two-pass canonical emit:
 *        a. Emit each receipt's bytes (no bundle_root_digest field)
 *        b. SHA-256 the canonical concatenation → bundleRootDigest
 *        c. Add bundle_root_digest to each receipt's attestor
 *        d. Re-emit all receipts with bundle_root_digest present
 *   8. Return the JSONL stream + per-step results.
 *
 * Rule 17 catches integrity failures (accidental splice, post-binding
 * mutation, inconsistent bundle roots) when bundle_root_digest is present.
 * Rule 17 is GATED on the field's presence — single-step receipts do not
 * carry it and Rule 17 silently skips. Multi-step receipts always carry
 * it by default (no opt-out in v0.8).
 */
export function buildObserverReceiptStreamFromSidecar(
  sidecarBytes: string,
  expectedFrameworkName: SourceFramework["name"],
  defaultExtractorIdentity: string,
  callerLabel: string,
  opts?: ObserverImportOptions,
): ObserverImportStreamResult {
  // ING-B-005 (Stage C / degradation-UX) — empty / whitespace-only stream
  // diagnostic. Mirrors the single-step entry + parse.ts (parseReceiptJsonl) +
  // parse-input.ts so an operator who pipes an empty file to the multi-step
  // subcommand gets an actionable "empty input" message naming the importer,
  // rather than the (correct but less direct) "zero records" message that only
  // surfaces after the split. Runs BEFORE the source-hash binding.
  assertSidecarNotEmpty(sidecarBytes, callerLabel)

  // 1. Hash whole stream BEFORE parsing.
  const sourceHash = `sha256:${createHash("sha256").update(sidecarBytes, "utf8").digest("hex")}`

  // 2. Split into per-line records.
  const lines = sidecarBytes
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0)
  if (lines.length === 0) {
    throw new Error(
      `${callerLabel}: sidecar JSONL stream contains zero records. ` +
        `Multi-step ingestion requires ≥1 record (one JSON object per line, in step order).`,
    )
  }

  // 3. Parse + validate each record.
  const sidecars: FrameworkTraceSidecarV2[] = []
  for (let i = 0; i < lines.length; i += 1) {
    let parsed: unknown
    try {
      parsed = JSON.parse(lines[i]!)
    } catch (err) {
      throw new Error(
        `${callerLabel}: sidecar line ${i + 1} is not valid JSON: ${
          err instanceof Error ? err.message : String(err)
        }`,
      )
    }
    // ING-B-003 (Stage C / degradation-UX) — unsupported-optimizer diagnostic
    // (per-record mirror of the single-step path). Name the supported optimizer
    // set so an unsupported `optimizer.name` in any record yields an actionable
    // message instead of the opaque Ajv "must be equal to one of the allowed
    // values". Names the offending line too (multi-step diagnosability).
    assertSidecarOptimizerSupported(parsed, `${callerLabel}: sidecar line ${i + 1}`)

    const validation = validateFrameworkTraceSidecar(parsed)
    if (!validation.ok) {
      const summary = validation.errors
        .map((e) => `${e.instancePath || "/"}: ${e.message}`)
        .join("; ")
      throw new Error(
        `${callerLabel}: sidecar line ${i + 1} failed framework-trace.v${validation.schemaVersion} validation: ${summary}. ` +
          `Multi-step ingestion requires framework-trace.v0.2.0 sidecars; if you have a v0.1.0 single-step sidecar, use ` +
          `the single-step subcommand (drop 'multi' from the CLI invocation).`,
      )
    }
    // v0.9.3: multi-step ingestion accepts framework-trace.v0.2.0 (unbatched
    // SGD), v0.3.0 (batched or unbatched SGD), v0.4.0 (Adam/AdamW + optimizer
    // state), v0.5.0 (classical sgd_momentum), AND v0.6.0 (sgd_momentum with
    // Nesterov / dampening — PyTorch-style SGD momentum widened beyond
    // classical). v0.1.0 single-step sidecars are still rejected — they lack
    // trace_id/step_index and must use the single-step subcommand.
    if (
      validation.schemaVersion !== "0.2.0" &&
      validation.schemaVersion !== "0.3.0" &&
      validation.schemaVersion !== "0.4.0" &&
      validation.schemaVersion !== "0.5.0" &&
      validation.schemaVersion !== "0.6.0" &&
      validation.schemaVersion !== "0.7.0"
    ) {
      throw new Error(
        `${callerLabel}: sidecar line ${i + 1} declares format='framework-trace.v${validation.schemaVersion}' but multi-step ` +
          `ingestion requires 'framework-trace.v0.2.0', 'framework-trace.v0.3.0', ` +
          `'framework-trace.v0.4.0', 'framework-trace.v0.5.0', 'framework-trace.v0.6.0', or 'framework-trace.v0.7.0'. ` +
          `Use the single-step subcommand for v0.1.0 sidecars.`,
      )
    }
    // ING-2 — verifier-owned ingest cap (per-record structural layer). Each
    // record of the stream is a single step bounded by the same per-step
    // schema maxItems / maxProperties; assert it here so an unbounded
    // collection in any one record fails with a diagnosable cap message
    // (naming the line) before the per-record engine recompute + emit. The
    // whole-stream byte size is intentionally NOT capped here — a legitimate
    // multi-step training trace can be a very large JSONL (see cli-B-001 in
    // src/bin/bp.ts) — the DoS surface is per-record collection size, which
    // this bounds.
    assertSidecarCollectionsWithinCap(
      validation.sidecar as FrameworkTraceSidecar,
      `${callerLabel}: sidecar line ${i + 1}`,
    )
    // ING-B-002 (Stage C / degradation) — per-record completeness pre-emit. A
    // record declaring a parameter in topology.parameter_order but omitting it
    // from parameters_after fails EARLY here (naming the line + missing key)
    // instead of at reconcile (Rule 14 COMPLETENESS). Same cross-reference
    // invariant as the single-step path; NOT a new soundness gate.
    assertSidecarCrossReferencesComplete(
      validation.sidecar as FrameworkTraceSidecar,
      `${callerLabel}: sidecar line ${i + 1}`,
    )
    sidecars.push(validation.sidecar as FrameworkTraceSidecarV2)
  }

  // 4. Intra-stream homogeneity + sequencing checks.
  const firstFramework = sidecars[0]!.source_framework
  if (firstFramework.name !== expectedFrameworkName) {
    throw new Error(
      `${callerLabel}: sidecar line 1 declares source_framework.name='${firstFramework.name}', ` +
        `but ${callerLabel} accepts only '${expectedFrameworkName}'. Use the matching importer for this framework.`,
    )
  }
  for (let i = 1; i < sidecars.length; i += 1) {
    const fw = sidecars[i]!.source_framework
    if (fw.name !== firstFramework.name || fw.version !== firstFramework.version) {
      throw new Error(
        `${callerLabel}: framework mismatch at sidecar line ${i + 1}. ` +
          `Expected source_framework.name='${firstFramework.name}' version='${firstFramework.version}' ` +
          `(from line 1); got name='${fw.name}' version='${fw.version}'. ` +
          `A multi-step bundle must be a single training trace from one framework version. ` +
          `If you have mixed-framework sidecars, split them and import each framework separately.`,
      )
    }
  }

  // 4b. trace_id homogeneity. If declared on any record, must be declared
  // on every record AND must be identical. If absent on all records,
  // synthesize from source_hash (lowercase first 32 hex chars).
  const declaredTraceIds = sidecars.map((s) => s.trace_id)
  const someDeclared = declaredTraceIds.some((t) => t !== undefined)
  const allDeclared = declaredTraceIds.every((t) => t !== undefined)
  let resolvedTraceId: string
  if (someDeclared && !allDeclared) {
    const firstMissing = declaredTraceIds.findIndex((t) => t === undefined)
    throw new Error(
      `${callerLabel}: trace_id co-presence violated. Some records declare trace_id and others do not. ` +
        `First record missing trace_id: line ${firstMissing + 1}. Either declare trace_id on all records or none.`,
    )
  }
  if (allDeclared) {
    resolvedTraceId = declaredTraceIds[0]!
    for (let i = 1; i < declaredTraceIds.length; i += 1) {
      if (declaredTraceIds[i] !== resolvedTraceId) {
        throw new Error(
          `${callerLabel}: trace_id mismatch at line ${i + 1}. ` +
            `Expected '${resolvedTraceId}' (from line 1); got '${declaredTraceIds[i]}'. ` +
            `A multi-step bundle must share trace_id across all records.`,
        )
      }
    }
  } else {
    resolvedTraceId = sourceHash.slice(7, 7 + 32) // strip "sha256:" prefix, take first 32 hex chars
  }

  // 4c. step_index sequencing. If declared on any record, must be declared
  // on every record AND must be dense + monotonic from 0. If absent on
  // all records, synthesize sequentially 0..N-1.
  const declaredStepIndices = sidecars.map((s) => s.step_index)
  const someStepDeclared = declaredStepIndices.some((s) => s !== undefined)
  const allStepDeclared = declaredStepIndices.every((s) => s !== undefined)
  let resolvedStepIndices: number[]
  if (someStepDeclared && !allStepDeclared) {
    const firstMissing = declaredStepIndices.findIndex((s) => s === undefined)
    throw new Error(
      `${callerLabel}: step_index co-presence violated. Some records declare step_index and others do not. ` +
        `First record missing step_index: line ${firstMissing + 1}. Either declare step_index on all records or none.`,
    )
  }
  if (allStepDeclared) {
    resolvedStepIndices = declaredStepIndices as number[]
    for (let i = 0; i < resolvedStepIndices.length; i += 1) {
      if (resolvedStepIndices[i] !== i) {
        throw new Error(
          `${callerLabel}: step_index sequence violated at line ${i + 1}. ` +
            `Expected step_index=${i} (dense monotonic from 0); got step_index=${resolvedStepIndices[i]}. ` +
            `Rule 10 enforces dense + monotonic step_index across a trace.`,
        )
      }
    }
  } else {
    resolvedStepIndices = sidecars.map((_, i) => i)
  }

  // 5. Resolve options.
  const differentialTolerance =
    opts?.differentialTolerance ?? { atol: 1e-6, rtol: 1e-4 }
  const extractorIdentity = opts?.extractorIdentity ?? defaultExtractorIdentity
  const importTimestamp = opts?.importTimestamp ?? new Date().toISOString()
  const fixtureLabelBase =
    opts?.fixtureLabel ?? `${firstFramework.name}-imported-multi-step`

  // 6. Build per-step receipts (without bundle_root_digest yet).
  // v0.9: each record may be batched (sidecar.batch present) or unbatched.
  // Dispatch per-record to runBatchedGeneralStep or runGeneralStep accordingly.
  const steps: ObserverImportStreamStep[] = []
  for (let i = 0; i < sidecars.length; i += 1) {
    const sidecar = sidecars[i]!
    const tolerance: TolerancePolicy = differentialTolerance
    const disagreements: ObserverImportStreamStep["differentialDisagreements"] = []
    const compare = (
      fieldPath: string,
      engineVal: number,
      claimedVal: number,
    ): void => {
      const check = applyToleranceCheck(engineVal, claimedVal, tolerance)
      if (!check.ok) {
        disagreements.push({
          fieldPath,
          delta: check.delta,
          appliedTolerance: check.appliedTolerance,
          stored: claimedVal,
          recomputed: engineVal,
        })
      }
    }

    // imports-B-004 (Stage C) — wrap the per-record engine recompute so any
    // throw names WHICH record failed. Multi-step ingestion is intentionally
    // all-or-nothing (a defective record aborts the whole bundle — soundness),
    // but before this wrapper a per-record engine throw (e.g. runGeneralStep:
    // "input.parameters_before is missing required parameter 'w_x1_h1'")
    // propagated with no indication of WHICH of N records caused it. The
    // validation/homogeneity aborts above already carry `line N`; this closes
    // the engine-recompute gap. Still aborts (preserves all-or-nothing); only
    // adds diagnosable record context — record index (1-based, matching the
    // JSONL line) + resolved step_index. The underlying engine cause is
    // preserved verbatim so the operator gets both "which record" and "what".
    let engineReceipt: GeneralReceipt
    try {
    if (sidecar.batch !== undefined) {
      // BATCHED record (v0.9+).
      if (sidecar.per_sample === undefined) {
        throw new Error(
          `${callerLabel}: sidecar line ${i + 1} declares batch but is missing the per_sample block.`,
        )
      }
      const batchedInput: BatchedGeneralInput = {
        topology: sidecar.topology,
        learning_rate: sidecar.learning_rate,
        batch: sidecar.batch,
        parameters_before: sidecar.parameters_before,
        per_sample: Object.fromEntries(
          sidecar.batch.sample_order.map((sid) => {
            const s = sidecar.per_sample![sid]
            if (!s) {
              throw new Error(
                `${callerLabel}: sidecar line ${i + 1} per_sample missing entry for sample_id ${JSON.stringify(sid)}.`,
              )
            }
            return [sid, { inputs: s.inputs, targets: s.targets }]
          }),
        ),
        numeric_policy:
          sidecar.numeric_policy ?? DEFAULT_NUMERIC_POLICY_FOR_OBSERVER,
        bias_policy: resolveBiasPolicyForSidecar(sidecar),
      }
      engineReceipt = runBatchedGeneralStep(batchedInput)

      for (const sid of sidecar.batch.sample_order) {
        const engineSample = engineReceipt.per_sample?.[sid]
        const sidecarSample = sidecar.per_sample[sid]
        if (!engineSample || !sidecarSample) continue
        for (const uId of Object.keys(engineSample.forward)) {
          const e = engineSample.forward[uId]!
          const c = sidecarSample.forward[uId]
          if (!c) continue
          compare(`per_sample.${sid}.forward.${uId}.net`, e.net, c.net)
          compare(`per_sample.${sid}.forward.${uId}.out`, e.out, c.out)
        }
        for (const uId of Object.keys(engineSample.loss.per_output)) {
          const eVal = engineSample.loss.per_output[uId]!
          const cVal = sidecarSample.loss.per_output[uId]
          if (typeof cVal !== "number") continue
          compare(`per_sample.${sid}.loss.per_output.${uId}`, eVal, cVal)
        }
        compare(`per_sample.${sid}.loss.total`, engineSample.loss.total, sidecarSample.loss.total)
      }
      for (const uId of Object.keys(engineReceipt.loss.per_output)) {
        const eVal = engineReceipt.loss.per_output[uId]!
        const cVal = sidecar.loss.per_output[uId]
        if (typeof cVal !== "number") continue
        compare(`loss.per_output.${uId}`, eVal, cVal)
      }
      compare("loss.total", engineReceipt.loss.total, sidecar.loss.total)
      // G-008 — reduced (top-level) backward + updates + parameters_after.
      // See compareReducedFullFieldSet. Per-record (multi-step) batched path.
      compareReducedFullFieldSet(compare, engineReceipt, sidecar)
    } else {
      // UNBATCHED record (v0.6/v0.7/v0.8 path + v0.9.1 Adam/AdamW path).
      const engineInputBase: GeneralInput = {
        topology: sidecar.topology,
        learning_rate: sidecar.learning_rate,
        inputs: sidecar.inputs,
        targets: sidecar.targets,
        parameters_before: sidecar.parameters_before,
        numeric_policy:
          sidecar.numeric_policy ?? DEFAULT_NUMERIC_POLICY_FOR_OBSERVER,
        bias_policy: resolveBiasPolicyForSidecar(sidecar),
      }
      let engineInput: GeneralInput = engineInputBase
      if (sidecar.optimizer !== undefined && sidecar.optimizer.name !== "sgd") {
        const ocIn = sidecar.optimizer
        const oc: OptimizerConfig = {
          name: ocIn.name,
          learning_rate: ocIn.learning_rate,
          ...(ocIn.beta1 !== undefined ? { beta1: ocIn.beta1 } : {}),
          ...(ocIn.beta2 !== undefined ? { beta2: ocIn.beta2 } : {}),
          ...(ocIn.epsilon !== undefined ? { epsilon: ocIn.epsilon } : {}),
          ...(ocIn.t !== undefined ? { t: ocIn.t } : {}),
          ...(ocIn.weight_decay !== undefined
            ? { weight_decay: ocIn.weight_decay }
            : {}),
          ...(ocIn.momentum !== undefined ? { momentum: ocIn.momentum } : {}),
          // Nesterov / dampening into the engine's differential recompute
          // (see single-step path above — same false-disagreement fix).
          ...(ocIn.nesterov === true ? { nesterov: true } : {}),
          ...(typeof ocIn.dampening === "number" && ocIn.dampening !== 0
            ? { dampening: ocIn.dampening }
            : {}),
        }
        const stateBefore: Record<string, OptimizerStateAny> = {}
        for (const u of sidecar.updates) {
          const optAny = (u as { optimizer?: { state_before?: OptimizerStateAny } }).optimizer
          const sb = optAny?.state_before
          if (sb !== undefined) {
            if (ocIn.name === "sgd_momentum") {
              const sbMom = sb as Partial<MomentumState>
              if (typeof sbMom.buffer === "number") {
                stateBefore[u.parameter_id] = { buffer: sbMom.buffer }
              }
            } else {
              const sbAdam = sb as Partial<AdamState>
              if (typeof sbAdam.m === "number" && typeof sbAdam.v === "number") {
                stateBefore[u.parameter_id] = { m: sbAdam.m, v: sbAdam.v }
              }
            }
          }
        }
        engineInput = {
          ...engineInputBase,
          optimizer_config: oc,
          optimizer_state_before: stateBefore,
        }
      }
      engineReceipt = runGeneralStep(engineInput)

      // G-008 — FULL field-set differential (same coverage as Rule 14). See
      // compareUnbatchedFullFieldSet. Per-record (multi-step) unbatched path.
      compareUnbatchedFullFieldSet(compare, engineReceipt, sidecar)
    }
    } catch (err) {
      // imports-B-004 — re-throw with record context. If the inner throw already
      // names the line (the batch/per_sample structural guards do), the extra
      // prefix is still useful (adds step_index) and harmless. The cause is
      // preserved verbatim.
      const cause = err instanceof Error ? err.message : String(err)
      throw new Error(
        `${callerLabel}: record ${i + 1} (step_index ${resolvedStepIndices[i]}) failed during engine recompute: ${cause} ` +
          `HINT: this record (1-based line ${i + 1} of the JSONL stream) is malformed; fix or remove it. ` +
          `Multi-step ingestion is all-or-nothing — the whole bundle is rejected so a partial trace is never emitted.`,
      )
    }

    const differentialPassed = disagreements.length === 0

    const attestor: Attestor = {
      computed_by: {
        kind: "framework",
        identity: `${sidecar.source_framework.name}@${sidecar.source_framework.version}`,
      },
      verified_by: {
        kind: "engine",
        // Engine identity stays at the semantic version of the deterministic
        // verifier. v0.8 adds multi-step ingestion + Rule 17 but does NOT
        // change engine math; identity stays at "0.6.0".
        identity: "backprop-trace-engine@0.6.0",
      },
      differential_tolerance: differentialTolerance,
      import_provenance: {
        // v0.9 — source_format mirrors the actual sidecar's format const,
        // not hardcoded. v0.2.0 (unbatched multi-step) and v0.3.0 (batched
        // or unbatched multi-step) both flow through this code path.
        source_format: sidecar.format,
        source_hash: sourceHash,
        import_timestamp: importTimestamp,
      },
      // bundle_root_digest deliberately omitted in pass 1 — filled in pass 2.
    }

    // imports-B-002: split on the LAST `@` (see splitExtractorIdentity) so a
    // scoped/multi-`@` identity loses no data; byte-equal for default identities.
    const { name: extractorName, version: extractorVersion } =
      splitExtractorIdentity(extractorIdentity)
    const sourceFramework: SourceFramework = {
      name: sidecar.source_framework.name,
      version: sidecar.source_framework.version,
      ...(sidecar.source_framework.information_uri !== undefined && {
        information_uri: sidecar.source_framework.information_uri,
      }),
      extractor: {
        name: extractorName,
        version: extractorVersion,
      },
    }

    const verificationState = differentialPassed
      ? "engine_recompute_matched_within_tolerance"
      : "engine_recompute_disagreed"

    // v0.9.1 — schema_version "0.5.0" when sidecar declares Adam/AdamW.
    // v0.9.2 — schema_version "0.6.0" when sidecar declares classical
    // sgd_momentum.
    // v0.9.3 — schema_version "0.7.0" when sidecar declares sgd_momentum
    // with nesterov=true OR dampening>0.
    // Otherwise stays "0.4.0" (byte-equal preservation for SGD multi-step).
    const isAdamFamilyRecord =
      sidecar.optimizer !== undefined &&
      (sidecar.optimizer.name === "adam" || sidecar.optimizer.name === "adamw")
    const isSgdMomentumRecord =
      sidecar.optimizer !== undefined && sidecar.optimizer.name === "sgd_momentum"
    const recordUsesNesterovOrDampening =
      isSgdMomentumRecord &&
      sidecar.optimizer !== undefined &&
      ((sidecar.optimizer.nesterov === true) ||
        (sidecar.optimizer.dampening !== undefined && sidecar.optimizer.dampening !== 0))
    const recordSchemaVersion: "0.4.0" | "0.5.0" | "0.6.0" | "0.7.0" = recordUsesNesterovOrDampening
      ? "0.7.0"
      : isSgdMomentumRecord
        ? "0.6.0"
        : isAdamFamilyRecord
          ? "0.5.0"
          : "0.4.0"
    const receipt: GeneralReceipt = {
      schema_version: recordSchemaVersion,
      fixture: `${fixtureLabelBase}-step-${i}`,
      step: resolvedStepIndices[i]! + 1, // legacy 1-indexed `step` field
      trace_id: resolvedTraceId,
      step_index: resolvedStepIndices[i]!,
      fixture_status: {
        authoring_state:
          "external_imported" as unknown as GeneralReceipt["fixture_status"]["authoring_state"],
        verification_state:
          verificationState as unknown as GeneralReceipt["fixture_status"]["verification_state"],
        canonical: true,
      },
      source_framework: sourceFramework,
      attestor,
      metadata: {
        source: `bp-import-${expectedFrameworkName} multi (sidecar from ${sidecar.source_framework.name}@${sidecar.source_framework.version})`,
        gradient_convention: "descent_direction",
      },
      numeric_policy:
        sidecar.numeric_policy ?? DEFAULT_NUMERIC_POLICY_FOR_OBSERVER,
      bias_policy: resolveBiasPolicyForSidecar(sidecar),
      topology: engineReceipt.topology,
      learning_rate: sidecar.learning_rate,
      // v0.9.1 — emit optimizer_config block ONLY for Adam/AdamW records.
      // v0.9.2 — same emission for sgd_momentum records.
      ...((isAdamFamilyRecord || isSgdMomentumRecord) && sidecar.optimizer !== undefined
        ? {
            optimizer_config: {
              name: sidecar.optimizer.name,
              learning_rate: sidecar.optimizer.learning_rate,
              ...(sidecar.optimizer.beta1 !== undefined
                ? { beta1: sidecar.optimizer.beta1 }
                : {}),
              ...(sidecar.optimizer.beta2 !== undefined
                ? { beta2: sidecar.optimizer.beta2 }
                : {}),
              ...(sidecar.optimizer.epsilon !== undefined
                ? { epsilon: sidecar.optimizer.epsilon }
                : {}),
              ...(sidecar.optimizer.t !== undefined
                ? { t: sidecar.optimizer.t }
                : {}),
              ...(sidecar.optimizer.weight_decay !== undefined
                ? { weight_decay: sidecar.optimizer.weight_decay }
                : {}),
              ...(sidecar.optimizer.momentum !== undefined
                ? { momentum: sidecar.optimizer.momentum }
                : {}),
              ...(sidecar.optimizer.nesterov === true ? { nesterov: true } : {}),
              ...(typeof sidecar.optimizer.dampening === "number" && sidecar.optimizer.dampening !== 0
                ? { dampening: sidecar.optimizer.dampening }
                : {}),
            } satisfies OptimizerConfig,
          }
        : {}),
      // v0.9 — batched record fields propagated to the receipt.
      ...(sidecar.batch !== undefined ? { batch: sidecar.batch } : {}),
      inputs: sidecar.inputs,
      targets: sidecar.targets,
      parameters_before: sidecar.parameters_before,
      ...(sidecar.per_sample !== undefined ? { per_sample: sidecar.per_sample } : {}),
      forward: sidecar.forward,
      loss: sidecar.loss,
      backward: sidecar.backward,
      updates: sidecar.updates,
      parameters_after: sidecar.parameters_after,
      post_update_forward:
        sidecar.post_update_forward ?? engineReceipt.post_update_forward,
      post_update_loss:
        sidecar.post_update_loss ?? engineReceipt.post_update_loss,
    }

    // ING-B-001 (Stage C / observability) — forensic helper-block passthrough
    // (per-record mirror of the single-step path). Attach this record's helper
    // attribution so a downstream reader of any per-step receipt sees which live
    // helper produced it. Forensic ONLY — Rule 14 is the authority. Does not
    // change emitted bytes (schema-ordered emitter ignores the field).
    attachHelperAttribution(receipt, sidecar.helper)

    steps.push({ receipt, differentialPassed, differentialDisagreements: disagreements })
  }

  // 7. Two-pass emit. Pass 1: bytes without bundle_root_digest, then
  // sha256 the canonical concatenation.
  const pass1Bytes = steps.map((s) => emitGeneralReceipt(s.receipt)).join("")
  const bundleRootDigest = `sha256:${createHash("sha256").update(pass1Bytes, "utf8").digest("hex")}`

  // Pass 2: add bundle_root_digest to every receipt, re-emit.
  for (const s of steps) {
    s.receipt.attestor!.bundle_root_digest = bundleRootDigest
  }
  const emittedBytes = steps.map((s) => emitGeneralReceipt(s.receipt)).join("")

  const allDifferentialsPassed = steps.every((s) => s.differentialPassed)

  return {
    steps,
    emittedBytes,
    allDifferentialsPassed,
    bundleRootDigest,
  }
}
