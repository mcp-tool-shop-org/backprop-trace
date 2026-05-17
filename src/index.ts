/**
 * @mcptoolshop/backprop-trace — public library surface.
 *
 * The library exports:
 *   - reconcileReceipt + multiplyFactorsLeftToRight + multiplyFactorsRightToLeft
 *     + RULE_DESCRIPTIONS + types from ./reconcile
 *   - v0.3 reconciler additions: applyToleranceCheck + normalizeTolerance +
 *     TolerancePolicy + checkRule9 + checkRule10 + reconcileMultiStep from
 *     ./reconcile (Rules 9, 10 are the multi-step parameter-chain and
 *     trace-identity rules)
 *   - runMazurStep + MazurReceipt + supporting types from ./engine
 *   - v0.3 general engine: runGeneralStep + GeneralReceipt + GeneralInput
 *     + SerializedTopology + GeneralMetadata + FixtureStatus +
 *     NumericPolicy + BiasPolicy + ToleranceObject + ToleranceSpec +
 *     ForwardUnit + NamedFactor + OutputErrorSignal + DownstreamContribution
 *     + HiddenErrorSignal + Optimizer + Update from ./general-engine
 *   - v0.3 topology types: Topology + UnitId + ParameterId + UnitOrder +
 *     Parameter + ParameterRole + assertTopologyValid + findWeight +
 *     findHiddenBias + findOutputBias from ./topology
 *   - v0.3 activations: sigmoid + sigmoidDerivativeFromOut + identity +
 *     identityDerivativeFromOut + relu + reluDerivativeFromOut + activate +
 *     activationDerivativeFromOut + ActivationName from ./activations
 *   - MAZUR_INPUT + MazurInput from ./mazur, plus v0.3 fixture exports:
 *     MAZUR_TOPOLOGY + XOR_TOPOLOGY + XOR_INPUT + IRIS_TOPOLOGY + IRIS_INPUT,
 *     plus v0.4 per-neuron-bias fixture: XOR_PER_NEURON_BIAS_INPUT
 *   - emitMazurReceipt + emitReceipts from ./emit, plus v0.3
 *     emitGeneralReceipt for v0.2.0-schema receipts
 *   - validateReceiptSchema + validateReceiptOrThrow + types from ./validate
 *     (v0.3: multi-version dispatch on schema_version)
 *   - v0.4: validateTopologyInput + validateTopologyInputOrThrow +
 *     InputValidationResult + ValidateInputOptions from ./validate for
 *     the new topology-input schema family
 *   - parseReceipt + parseReceiptJsonl + parseMazurReceipt + types from ./parse
 *   - v0.4: parseTopologyInput + ParseInputResult + ParseInputError from
 *     ./parse-input for the new topology-input schema family
 *   - hashReceipt + HashAlgorithm from ./hash
 *   - getReceiptSchema + SCHEMA_VERSIONS + SchemaVersion from ./schema-loader
 *     (v0.3: SCHEMA_VERSIONS = ["0.1.0", "0.2.0"])
 *   - v0.4: getInputSchema + INPUT_SCHEMA_VERSIONS + InputSchemaVersion
 *     from ./schema-loader (INPUT_SCHEMA_VERSIONS = ["0.4.0"])
 *   - verifyEngineReproduces + VerifyEngineResult from ./verify-engine, plus
 *     v0.3 verifyGeneralEngineReproduces for v0.2.0-schema receipts
 *   - extractEngineInput + extractGeneralEngineInput from ./extract
 *   - formatNumberForEngine + scientificToPlain from ./runtime-format
 *   - formatDecimalStringForFixture + FormatPolicyError + FormatErrorKind from ./format
 *
 * The CLI lives in ./bin/bp and is exposed via package.json bin.
 *
 * Receipt schemas are shipped at schemas/receipt.v{0.1.0,0.2.0}.json
 * (importable via the "@mcptoolshop/backprop-trace/schema/0.1.0" and
 * "@mcptoolshop/backprop-trace/schema/0.2.0" subpath exports;
 * "@mcptoolshop/backprop-trace/schema" remains aliased to 0.1.0 for
 * back-compat with v0.1/v0.2 callers).
 *
 * Quick usage:
 *
 *   // v0.1 path — run the Mazur 2-2-2 engine step and emit a canonical
 *   // v0.1.0-schema receipt:
 *   import { runMazurStep, emitMazurReceipt, MAZUR_INPUT } from "@mcptoolshop/backprop-trace";
 *   const receipt = runMazurStep(MAZUR_INPUT);
 *   const line = emitMazurReceipt(receipt); // canonical JSONL ending in "\n"
 *
 *   // v0.3 path — run the generalized engine on an XOR topology and emit
 *   // a canonical v0.2.0-schema receipt:
 *   import { runGeneralStep, emitGeneralReceipt, XOR_INPUT } from "@mcptoolshop/backprop-trace";
 *   const xor = runGeneralStep(XOR_INPUT);
 *   const xorLine = emitGeneralReceipt(xor);
 *
 *   // Reconcile a parsed receipt against Rule 4 (gradient consistency):
 *   import { reconcileReceipt } from "@mcptoolshop/backprop-trace";
 *   const result = reconcileReceipt(parsedReceipt);
 *   if (!result.ok) for (const f of result.failures) console.error(f);
 *
 *   // Parse + validate a receipt file in one call (v0.2+):
 *   import { parseReceipt } from "@mcptoolshop/backprop-trace";
 *   const r = parseReceipt(readFileSync("fixtures/mazur.golden.jsonl", "utf-8"));
 *   if (!r.ok) console.error(r.error.kind, r.error.message);
 *
 *   // Hash a receipt for in-toto v1 attestation (v0.2+):
 *   import { hashReceipt } from "@mcptoolshop/backprop-trace";
 *   const sha = hashReceipt(receipt); // sha256 hex of canonical bytes
 *
 *   // Verify the engine reproduces a receipt byte-for-byte (v0.2+):
 *   import { verifyEngineReproduces } from "@mcptoolshop/backprop-trace";
 *   const v = verifyEngineReproduces(receipt);
 *   if (!v.matches) console.error("diverges at byte", v.firstDifferingByte);
 *
 *   // v0.3 multi-step reconciliation:
 *   import { reconcileMultiStep } from "@mcptoolshop/backprop-trace";
 *   const multi = reconcileMultiStep([step0, step1, step2]);
 *   if (!multi.ok) console.error("rule 9 or 10 failed:", multi.failures);
 */

// --- v0.1 / v0.2 reconciler surface (unchanged) ---
export {
  reconcileReceipt,
  multiplyFactorsLeftToRight,
  multiplyFactorsRightToLeft,
  RULE_DESCRIPTIONS,
} from "./reconcile.js"
export type { ReconciliationFailure, ReconciliationResult } from "./reconcile.js"

// --- v0.3 reconciler additions ---
// applyToleranceCheck + normalizeTolerance: hybrid-tolerance primitives
// (memo §3) used by all 8 rules in v0.3. TolerancePolicy is the union
// type accepted by both (scalar number OR {atol, rtol}).
// checkRule9 + checkRule10 + reconcileMultiStep: multi-step verification
// (memo §4). Rule 9 is the parameter-chain rule; Rule 10 is the
// trace-identity rule; reconcileMultiStep runs both PLUS per-step Rules
// 1-8 over an N-record JSONL.
export {
  applyToleranceCheck,
  normalizeTolerance,
  checkRule9,
  checkRule10,
  reconcileMultiStep,
} from "./reconcile.js"
export type { TolerancePolicy } from "./reconcile.js"

// --- v0.1 Mazur engine + types ---
export { runMazurStep } from "./engine.js"
export type {
  MazurReceipt,
  ForwardUnit,
  NamedFactor,
  OutputErrorSignal,
  DownstreamContribution,
  HiddenErrorSignal,
  Optimizer,
  Update,
} from "./engine.js"

// --- v0.3 generalized engine + types ---
// runGeneralStep + GeneralReceipt + GeneralInput are the generalized
// counterparts to runMazurStep + MazurReceipt + MazurInput. SerializedTopology
// is the receipt-resident form of a Topology (JSON-friendly mutable arrays);
// runtime construction uses Topology from ./topology directly.
//
// NOTE on naming: the v0.1 engine.ts already exports type names like
// ForwardUnit / NamedFactor / etc. The v0.3 general-engine.ts re-defines
// structurally-equivalent versions under the same names; re-exporting both
// would collide. We re-export the v0.1 versions above as the canonical
// types for these structural shapes; the v0.3 versions are accessible via
// the "@mcptoolshop/backprop-trace/general-engine" subpath for callers
// that want the v0.3-tagged variants explicitly.
export { runGeneralStep } from "./general-engine.js"
export type {
  GeneralReceipt,
  GeneralInput,
  GeneralMetadata,
  SerializedTopology,
  FixtureStatus,
  NumericPolicy,
  BiasPolicy,
  ToleranceObject,
  ToleranceSpec,
} from "./general-engine.js"

// --- v0.3 topology vocabulary ---
// Topology + UnitId + ParameterId are the load-bearing identity types for
// the generalized engine. UnitOrder + Parameter + ParameterRole are the
// structural shapes inside a Topology declaration.
// assertTopologyValid + findWeight + findHiddenBias + findOutputBias are
// the validator + lookup helpers used by runGeneralStep at runtime;
// re-exported so external callers can validate hand-authored topologies
// before feeding them to the engine.
export {
  assertTopologyValid,
  findWeight,
  findHiddenBias,
  findOutputBias,
} from "./topology.js"
export type {
  Topology,
  UnitId,
  ParameterId,
  UnitOrder,
  Parameter,
  ParameterRole,
} from "./topology.js"

// --- v0.3 activation library ---
// sigmoid + identity + relu + each derivative-from-output. activate +
// activationDerivativeFromOut are name-dispatch helpers used by the
// generalized engine to route topology.activation_{hidden,output} to
// the right primitive at runtime.
export {
  sigmoid,
  sigmoidDerivativeFromOut,
  identity,
  identityDerivativeFromOut,
  relu,
  reluDerivativeFromOut,
  activate,
  activationDerivativeFromOut,
} from "./activations.js"
export type { ActivationName } from "./activations.js"

// --- Mazur input + v0.3 fixture inputs/topologies ---
// MAZUR_INPUT + MazurInput preserved for v0.1/v0.2 callers. MAZUR_TOPOLOGY
// is the v0.3 explicit-units rendering of the Mazur 2-2-2 graph; XOR_INPUT
// + IRIS_INPUT are the v0.3 engine-anchored fixture inputs that feed the
// generalized engine.
export { MAZUR_INPUT } from "./mazur.js"
export type { MazurInput } from "./mazur.js"
export {
  MAZUR_TOPOLOGY,
  XOR_TOPOLOGY,
  XOR_INPUT,
  IRIS_TOPOLOGY,
  IRIS_INPUT,
  // v0.4: XOR 2-2-1 with per-neuron biases (2 distinct hidden biases +
  // 1 output bias) + bias_policy.mode === "sgd". Exercises the v0.4
  // "per_neuron" bias sharing branch added to runGeneralStep by the
  // Engine agent. Re-exported here so external consumers can author
  // per-neuron-bias receipts without reaching into the ./mazur subpath.
  XOR_PER_NEURON_BIAS_INPUT,
} from "./mazur.js"

// --- Emit (v0.1 Mazur + v0.3 general) ---
export {
  emitMazurReceipt,
  emitReceipts,
  emitGeneralReceipt,
} from "./emit.js"

// --- Validate (v0.3 multi-version + v0.4 topology-input) ---
// validateReceiptSchema + validateReceiptOrThrow validate RECEIPTS against
// the receipt schema family (v0.1.0, v0.2.0). validateTopologyInput +
// validateTopologyInputOrThrow validate INPUTS against the topology-input
// schema family (v0.4.0). The two families are versioned independently;
// see schema-loader.ts for the separation rationale.
export {
  validateReceiptSchema,
  validateReceiptOrThrow,
  validateTopologyInput,
  validateTopologyInputOrThrow,
} from "./validate.js"
export type {
  ValidationResult,
  SchemaError,
  ValidateOptions,
  InputValidationResult,
  ValidateInputOptions,
} from "./validate.js"

// --- Parse (v0.3 multi-version receipts + v0.4 topology-input) ---
export { parseReceipt, parseReceiptJsonl, parseMazurReceipt } from "./parse.js"
export type { ParseResult, ParseError, ParsedReceiptShape } from "./parse.js"
export { parseTopologyInput } from "./parse-input.js"
export type { ParseInputResult, ParseInputError } from "./parse-input.js"

// --- Hash ---
export { hashReceipt } from "./hash.js"
export type { HashAlgorithm } from "./hash.js"

// --- Schema loader (v0.3 receipts: 0.1.0 + 0.2.0; v0.4 input: 0.4.0) ---
// getReceiptSchema + SCHEMA_VERSIONS + SchemaVersion: receipt schema
// family. getInputSchema + INPUT_SCHEMA_VERSIONS + InputSchemaVersion:
// topology-input schema family (introduced v0.4). The two families are
// versioned independently — a receipt-schema bump does NOT force an
// input-schema bump and vice versa.
export {
  getReceiptSchema,
  SCHEMA_VERSIONS,
  getInputSchema,
  INPUT_SCHEMA_VERSIONS,
} from "./schema-loader.js"
export type { SchemaVersion, InputSchemaVersion } from "./schema-loader.js"

// --- Verify engine (v0.1 Mazur + v0.3 general) ---
export {
  verifyEngineReproduces,
  verifyGeneralEngineReproduces,
} from "./verify-engine.js"
export type { VerifyEngineResult } from "./verify-engine.js"

// --- Extract (v0.1 Mazur + v0.3 general) ---
export { extractEngineInput, extractGeneralEngineInput } from "./extract.js"

// --- Number formatting + format policy ---
export { formatNumberForEngine, scientificToPlain } from "./runtime-format.js"

export { formatDecimalStringForFixture, FormatPolicyError } from "./format.js"
export type { FormatErrorKind } from "./format.js"
