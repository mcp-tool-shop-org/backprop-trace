/**
 * extractEngineInput — reconstruct a MazurInput from a MazurReceipt (FT-F-012).
 *
 * Every field a receipt contains in the input-shape positions is also a
 * field MazurInput requires; the receipt's input-shape fields are
 * structurally identical to MazurInput by construction (see src/engine.ts
 * MazurReceipt — its `numeric_policy`, `bias_policy`, `topology`,
 * `learning_rate`, `inputs`, `targets`, `parameters_before` fields all
 * directly type-equal MazurInput's). Extraction is therefore a pure
 * destructure — no field translation, no defaulting.
 *
 * The function exists so `bp verify mazur` can re-run the engine on a
 * receipt to verify byte-equality without requiring the caller to also
 * supply the original MazurInput. The same receipt that records the
 * forward/backward/update math also records the inputs that produced
 * them, so the receipt is self-sufficient for replay.
 *
 * v0.2+ generalized topologies may break this invariant (e.g. if the
 * receipt embeds a derived topology rather than the original input
 * topology); when that happens this function will need a version-aware
 * branch. For v0.1 (and the v0.2.0 feature wave that keeps schema at
 * v0.1.0), the destructure is sound.
 */

import type { MazurReceipt } from "./engine.js";
import type { MazurInput } from "./mazur.js";
import type {
  GeneralInput,
  GeneralReceipt,
  SerializedTopology,
} from "./general-engine.js";
import type { Topology } from "./topology.js";

/**
 * Reconstruct the MazurInput that, when fed to `runMazurStep`, would
 * produce the given receipt. Pure destructure — no field translation.
 *
 * Useful for `bp verify mazur`: re-run the engine on the receipt's own
 * inputs and check byte-equality against the receipt's recorded outputs
 * (Rule 9 in the v0.2+ verifier composition: "engine reproduces receipt
 * byte-for-byte"). See src/verify-engine.ts for the composed helper.
 *
 * The returned object is structurally a fresh MazurInput value (no
 * shared mutable references with the receipt). Returned topology /
 * numeric_policy / bias_policy fields point at the same in-memory
 * objects as the receipt's — receipts and inputs are by contract
 * immutable, so this is safe; callers MUST NOT mutate.
 *
 * @param receipt  A valid MazurReceipt (typically the output of a prior
 *                 runMazurStep call OR the result of parsing a fixture
 *                 file via parseReceipt).
 * @returns        A MazurInput equivalent to the input that produced
 *                 the receipt's forward/backward/update math.
 */
export function extractEngineInput(receipt: MazurReceipt): MazurInput {
  // FT-F-012 / imports-B-006 (Stage C) — actionable guard. This is a pure
  // destructure of an ALREADY-VALIDATED receipt (the caller is expected to have
  // run parseReceipt / validateReceiptSchema first). A null/undefined receipt is
  // a caller mistake; without this guard the destructure throws a cryptic
  // "Cannot read properties of undefined (reading 'topology')". Fail with a
  // message that says what to do instead.
  if (receipt === null || typeof receipt !== "object") {
    throw new Error(
      `extractEngineInput: expected a parsed MazurReceipt object, got ${receipt === null ? "null" : typeof receipt}. ` +
        `HINT: parse + validate the receipt first (parseReceipt / validateReceiptSchema), then pass the result here.`,
    )
  }
  return {
    topology: receipt.topology,
    learning_rate: receipt.learning_rate,
    inputs: receipt.inputs,
    targets: receipt.targets,
    parameters_before: receipt.parameters_before,
    numeric_policy: receipt.numeric_policy,
    bias_policy: receipt.bias_policy,
  };
}

/**
 * v0.3 sibling of extractEngineInput, generalized over arbitrary
 * topologies. Reconstruct the GeneralInput that, when fed to
 * `runGeneralStep`, would produce the given v0.2.0-schema receipt.
 *
 * Round-trip discipline: GeneralReceipt's `topology` field is a
 * SerializedTopology (JSON-shaped plain object); runGeneralStep accepts a
 * Topology (readonly arrays / discriminated parameter roles). The two
 * shapes are STRUCTURALLY identical at runtime — SerializedTopology drops
 * the readonly hints to be JSON-serializable, but every field name and
 * value shape matches Topology. The cast through `as unknown as Topology`
 * is faithful by construction (Topology and SerializedTopology share the
 * same in-memory shape; the difference is purely type-level mutability).
 *
 * The returned input has trace_id / step_index / fixture / metadata
 * carried through iff they were set on the receipt — runGeneralStep
 * propagates them back into the regenerated receipt unchanged, which is
 * required for byte-equality.
 *
 * @param receipt  A valid GeneralReceipt (output of a prior runGeneralStep
 *                 call OR the result of parsing a v0.2.0-schema fixture).
 * @returns        A GeneralInput equivalent to the input that produced
 *                 the receipt's forward/backward/update math.
 */
export function extractGeneralEngineInput(receipt: GeneralReceipt): GeneralInput {
  // imports-B-006 (Stage C) — actionable guard (see extractEngineInput). Pure
  // destructure of an already-validated receipt; a null/undefined argument is a
  // caller mistake, surfaced with a diagnosable message instead of a cryptic
  // property-access TypeError.
  if (receipt === null || typeof receipt !== "object") {
    throw new Error(
      `extractGeneralEngineInput: expected a parsed GeneralReceipt object, got ${receipt === null ? "null" : typeof receipt}. ` +
        `HINT: parse + validate the receipt first (parseReceipt / validateReceiptSchema), then pass the result here.`,
    )
  }
  // SerializedTopology and Topology share the same runtime shape; the
  // type difference is purely the readonly hint. Cast through `unknown`
  // to satisfy the structural assignability check.
  const topology = receipt.topology as unknown as Topology;
  const input: GeneralInput = {
    topology,
    learning_rate: receipt.learning_rate,
    inputs: receipt.inputs,
    targets: receipt.targets,
    parameters_before: receipt.parameters_before,
    numeric_policy: receipt.numeric_policy,
    bias_policy: receipt.bias_policy,
  };
  // Optional fields propagate iff present on the receipt — runGeneralStep
  // uses exactOptionalPropertyTypes-equivalent discipline (the field is
  // re-added to the receipt iff the input had it), so this round-trip is
  // byte-stable.
  const out: GeneralInput = {
    ...input,
    ...(receipt.trace_id !== undefined ? { trace_id: receipt.trace_id } : {}),
    ...(receipt.step_index !== undefined ? { step_index: receipt.step_index } : {}),
    ...(receipt.fixture !== undefined ? { fixture: receipt.fixture } : {}),
    ...(receipt.metadata !== undefined ? { metadata: receipt.metadata } : {}),
  };
  return out;
}

// Re-export SerializedTopology so callers importing extract.ts get the
// type for argument typing.
export type { SerializedTopology };
