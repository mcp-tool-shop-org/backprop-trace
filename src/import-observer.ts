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
  type GeneralReceipt,
  type GeneralInput,
  type SourceFramework,
  type Attestor,
} from "./general-engine.js"
import type { Topology } from "./topology.js"
import { applyToleranceCheck, type TolerancePolicy } from "./reconcile.js"
import { emitGeneralReceipt } from "./emit.js"
import { validateFrameworkTraceSidecar } from "./validate.js"

/**
 * Sidecar shape after framework-trace.v0.1.0 schema validation has
 * succeeded. The shape mirrors a v0.3.0 receipt body but is wrapped in
 * the sidecar envelope (`format` discriminator + `source_framework`).
 * Importer is responsible for mapping into the v0.4.0 receipt.
 */
export type FrameworkTraceSidecar = {
  format: "framework-trace.v0.1.0"
  source_framework: SourceFramework
  topology: Topology
  learning_rate: number
  numeric_policy?: GeneralInput["numeric_policy"]
  bias_policy?: GeneralInput["bias_policy"]
  inputs: Record<string, number>
  targets: Record<string, number>
  parameters_before: Record<string, number>
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
 * audit); `differentialPassed` summarizes whether downstream Rule 14
 * will pass.
 */
export type ObserverImportResult = {
  receipt: GeneralReceipt
  emittedBytes: string
  differentialPassed: boolean
  differentialDisagreements: Array<{
    fieldPath: string
    delta: number
    appliedTolerance: number
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
  // 1. Hash raw bytes BEFORE parsing.
  const sourceHash = `sha256:${createHash("sha256").update(sidecarBytes, "utf8").digest("hex")}`

  // 2. Parse + validate against framework-trace.v0.1.0.
  let parsed: unknown
  try {
    parsed = JSON.parse(sidecarBytes.trim())
  } catch (err) {
    throw new Error(
      `${callerLabel}: sidecar bytes are not valid JSON: ${err instanceof Error ? err.message : String(err)}`,
    )
  }
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

  // 4. Resolve defaults.
  const differentialTolerance =
    opts?.differentialTolerance ?? { atol: 1e-6, rtol: 1e-4 }
  const extractorIdentity = opts?.extractorIdentity ?? defaultExtractorIdentity
  const importTimestamp = opts?.importTimestamp ?? new Date().toISOString()
  const fixtureLabel =
    opts?.fixtureLabel ?? `${sidecar.source_framework.name}-imported-step`

  // 5. Run engine differentially.
  const engineInput: GeneralInput = {
    topology: sidecar.topology,
    learning_rate: sidecar.learning_rate,
    inputs: sidecar.inputs,
    targets: sidecar.targets,
    parameters_before: sidecar.parameters_before,
    numeric_policy:
      sidecar.numeric_policy ?? DEFAULT_NUMERIC_POLICY_FOR_OBSERVER,
    bias_policy: sidecar.bias_policy ?? DEFAULT_BIAS_POLICY_FOR_OBSERVER,
  }
  const engineReceipt = runGeneralStep(engineInput)

  // 6. Differential check — collect per-field disagreements.
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
      })
    }
  }
  for (const uId of Object.keys(engineReceipt.forward)) {
    const e = engineReceipt.forward[uId]!
    const c = sidecar.forward[uId]
    if (!c) continue
    compare(`forward.${uId}.net`, e.net, c.net)
    compare(`forward.${uId}.out`, e.out, c.out)
  }
  for (const uId of Object.keys(engineReceipt.loss.per_output)) {
    const eVal = engineReceipt.loss.per_output[uId]!
    const cVal = sidecar.loss.per_output[uId]
    if (typeof cVal !== "number") continue
    compare(`loss.per_output.${uId}`, eVal, cVal)
  }
  compare("loss.total", engineReceipt.loss.total, sidecar.loss.total)

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
      source_format: "framework-trace.v0.1.0",
      source_hash: sourceHash,
      import_timestamp: importTimestamp,
    },
  }

  // Extractor sub-block: derive name + version from the resolved identity
  // string ("bp-import-pytorch@0.6.0" -> name="bp-import-pytorch", version="0.6.0").
  // Fall back to the sidecar's declared extractor if the user shipped one
  // and the importer's default is the only thing we'd have to merge.
  const extractorParts = extractorIdentity.split("@")
  const extractorName = extractorParts[0] ?? extractorIdentity
  const extractorVersion = extractorParts[1] ?? "unversioned"
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

  const receipt: GeneralReceipt = {
    schema_version: "0.4.0",
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
    bias_policy: sidecar.bias_policy ?? DEFAULT_BIAS_POLICY_FOR_OBSERVER,
    topology: engineReceipt.topology,
    learning_rate: sidecar.learning_rate,
    inputs: sidecar.inputs,
    targets: sidecar.targets,
    parameters_before: sidecar.parameters_before,
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

  // 8. Emit canonical bytes.
  const emittedBytes = emitGeneralReceipt(receipt)

  return {
    receipt,
    emittedBytes,
    differentialPassed,
    differentialDisagreements: disagreements,
  }
}

// --- Defaults --------------------------------------------------------------

const DEFAULT_NUMERIC_POLICY_FOR_OBSERVER: GeneralInput["numeric_policy"] = {
  number_encoding: "decimal",
  precision_significant_digits: 9,
  rounding: "round_half_to_even",
  tolerance: { atol: 1e-11, rtol: 1e-7 },
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
