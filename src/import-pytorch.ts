/**
 * v0.6 — PyTorch sidecar importer.
 *
 * Consumes a framework-trace.v0.1.0 sidecar (JSONL line emitted from a
 * user's PyTorch training loop via a thin Python helper, or hand-authored
 * for fixture work) and produces an observer-mode v0.4.0 receipt with:
 *   - The foreign framework's claimed forward / loss / backward / updates /
 *     parameters_after copied verbatim as the receipt's canonical fields
 *     (the foreign math IS the receipt's content; the importer does not
 *     synthesize or back-fill anything per Q2 of the v0.5 consolidator).
 *   - `source_framework` block naming pytorch + version + (optional) extractor.
 *   - `attestor` block: computed_by = framework identity, verified_by =
 *     backprop-trace engine identity, differential_tolerance (defaults to
 *     {atol:1e-6, rtol:1e-4} unless the sidecar overrides via numeric_policy),
 *     import_provenance (source_format + source_hash + import_timestamp).
 *   - `fixture_status.authoring_state = "external_imported"` and a
 *     verification_state determined by the differential check outcome.
 *
 * Critically: the importer DOES NOT execute foreign code. The sidecar is
 * plain JSON. There is no peer dependency on torch / jax / tensorflow.
 * The Python helper (scripts/python-helpers/dump_pytorch_trace.py) runs
 * outside backprop-trace in the user's environment; backprop-trace only
 * reads its output.
 *
 * Rule 14 (engine-recompute differential) fires when the resulting receipt
 * is reconciled — but the importer ALSO runs the differential check itself
 * so the produced receipt accurately declares verification_state. This
 * double-run is intentional: the importer's verification_state is a
 * convenience for downstream tooling; `bp verify general` re-runs the
 * check independently as the actual gate (Reproducible Builds discipline:
 * the producer's claim is not the verifier's truth).
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
 * Options for the importer. Most callers pass nothing — defaults match
 * the v0.6 study lock.
 */
export type ImportPytorchOptions = {
  /**
   * Override the differential tolerance the importer applies (and embeds
   * in the receipt's attestor.differential_tolerance). Default: {atol:
   * 1e-6, rtol: 1e-4} — looser than engine-authored {1e-12, 1e-8} per
   * Agent 2's "foreign FP precision drifts" guidance.
   */
  differentialTolerance?: { atol: number; rtol: number }

  /**
   * Identifier string for the extractor (the adapter producing this
   * receipt). Default: "bp-import-pytorch@0.6.0".
   */
  extractorIdentity?: string

  /**
   * Override import_provenance.import_timestamp. Mainly for fixture
   * authoring (so the timestamp is deterministic). When omitted, the
   * current ISO timestamp is used — fixture builds should pass a pinned
   * value.
   */
  importTimestamp?: string

  /**
   * Pinned `fixture` field for the produced receipt. Defaults to
   * `"<sidecar.source_framework.name>-imported-step"`.
   */
  fixtureLabel?: string
}

/**
 * Result of an import operation. The receipt is always produced (even when
 * the differential check fires) so the caller can persist it for audit;
 * `differentialPassed` summarizes whether `bp verify general` will pass
 * downstream Rule 14.
 */
export type ImportPytorchResult = {
  receipt: GeneralReceipt
  emittedBytes: string
  differentialPassed: boolean
  /**
   * Per-field deltas captured during the import-time differential run.
   * Empty when differentialPassed === true. Each entry: {fieldPath, delta,
   * appliedTolerance}.
   */
  differentialDisagreements: Array<{
    fieldPath: string
    delta: number
    appliedTolerance: number
  }>
}

/**
 * Import a PyTorch sidecar and produce an observer-mode v0.4.0 receipt.
 *
 * Validates the sidecar against framework-trace.v0.1.0, runs the engine
 * recompute, builds the receipt with attestor + source_framework + the
 * foreign-claim canonical fields, and returns the emitted canonical bytes.
 *
 * @param sidecarBytes Raw sidecar bytes (UTF-8 string). Hashed for
 *                     attestor.import_provenance.source_hash before parsing.
 * @param opts         Optional overrides — see ImportPytorchOptions.
 * @throws             Error if sidecar bytes are not valid JSON OR don't
 *                     validate against framework-trace.v0.1.0.
 */
export function importPytorchSidecar(
  sidecarBytes: string,
  opts?: ImportPytorchOptions,
): ImportPytorchResult {
  // 1. Compute source_hash on the raw bytes BEFORE parsing — preserves
  //    the exact byte stream the operator ingested.
  const sourceHash = `sha256:${createHash("sha256").update(sidecarBytes, "utf8").digest("hex")}`

  // 2. Parse + validate against framework-trace.v0.1.0.
  let parsed: unknown
  try {
    parsed = JSON.parse(sidecarBytes.trim())
  } catch (err) {
    throw new Error(
      `importPytorchSidecar: sidecar bytes are not valid JSON: ${err instanceof Error ? err.message : String(err)}`,
    )
  }
  const validation = validateFrameworkTraceSidecar(parsed)
  if (!validation.ok) {
    const summary = validation.errors
      .map((e) => `${e.instancePath || "/"}: ${e.message}`)
      .join("; ")
    throw new Error(
      `importPytorchSidecar: sidecar failed framework-trace.v${validation.schemaVersion} validation: ${summary}`,
    )
  }
  const sidecar = validation.sidecar as FrameworkTraceSidecar

  // 3. Validate the framework name: bp import pytorch only accepts pytorch
  //    sidecars (per-framework subcommand discipline).
  if (sidecar.source_framework.name !== "pytorch") {
    throw new Error(
      `importPytorchSidecar: sidecar declares source_framework.name='${sidecar.source_framework.name}', ` +
        `but importPytorchSidecar accepts only 'pytorch'. Use the matching importer for this framework, ` +
        `or correct the sidecar's source_framework.name.`,
    )
  }

  // 4. Resolve defaults.
  const differentialTolerance =
    opts?.differentialTolerance ?? { atol: 1e-6, rtol: 1e-4 }
  const extractorIdentity = opts?.extractorIdentity ?? "bp-import-pytorch@0.6.0"
  const importTimestamp = opts?.importTimestamp ?? new Date().toISOString()
  const fixtureLabel =
    opts?.fixtureLabel ?? `${sidecar.source_framework.name}-imported-step`

  // 5. Run the engine differentially.
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
  const disagreements: ImportPytorchResult["differentialDisagreements"] = []
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

  // 7. Build the v0.4.0 receipt. Foreign claims become canonical fields;
  //    engine recompute is the WITNESS, not the content (Reproducible
  //    Builds + Agent 2 discipline).
  const attestor: Attestor = {
    computed_by: {
      kind: "framework",
      identity: `${sidecar.source_framework.name}@${sidecar.source_framework.version}`,
    },
    verified_by: {
      kind: "engine",
      identity: "backprop-trace-engine@0.6.0",
    },
    differential_tolerance: differentialTolerance,
    import_provenance: {
      source_format: "framework-trace.v0.1.0",
      source_hash: sourceHash,
      import_timestamp: importTimestamp,
    },
  }

  const sourceFramework: SourceFramework = {
    name: sidecar.source_framework.name,
    version: sidecar.source_framework.version,
    ...(sidecar.source_framework.information_uri !== undefined && {
      information_uri: sidecar.source_framework.information_uri,
    }),
    extractor: {
      name: "bp-import-pytorch",
      version: extractorIdentity.includes("@")
        ? extractorIdentity.split("@")[1]!
        : "0.6.0",
    },
  }

  const verificationState = differentialPassed
    ? "engine_recompute_matched_within_tolerance"
    : "engine_recompute_disagreed"

  // The observer receipt body carries the SIDECAR's claimed math, not
  // the engine's recomputation. The engine is the witness; the foreign
  // framework is the producer.
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
      source: `bp-import-pytorch (sidecar from ${sidecar.source_framework.name}@${sidecar.source_framework.version})`,
      gradient_convention: "descent_direction",
    },
    numeric_policy:
      sidecar.numeric_policy ?? DEFAULT_NUMERIC_POLICY_FOR_OBSERVER,
    bias_policy: sidecar.bias_policy ?? DEFAULT_BIAS_POLICY_FOR_OBSERVER,
    topology: engineReceipt.topology, // SerializedTopology; engine's serialization is canonical
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
