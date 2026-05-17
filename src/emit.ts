/**
 * Canonical JSONL emission for Mazur receipts.
 *
 * Schema-ordered traversal per docs/canonical-emission.md. Numeric leaves go
 * through formatNumberForEngine; strings are JSON-escaped via JSON.stringify;
 * booleans emit as literal true/false; integers (step, topology sizes,
 * precision_significant_digits) emit as bare digits. No whitespace inside
 * the JSON; one record terminated by LF.
 *
 * v0.1 emits Mazur-specific structure via explicit per-section emitters.
 * v0.2+ may generalize via a schema walker; for now, the explicit form
 * mirrors the schema's x-order annotations and is auditable line-by-line.
 */

import { formatNumberForEngine } from "./runtime-format.js";
import type {
  DownstreamContribution,
  ForwardUnit,
  HiddenErrorSignal,
  MazurReceipt,
  NamedFactor,
  Optimizer,
  OutputErrorSignal,
  Update,
} from "./engine.js";
import type {
  GeneralReceipt,
  SerializedTopology,
} from "./general-engine.js";

// String emitter — JSON.stringify produces a valid JSON string literal
// (quotes + escapes) for any JS string input. The TypeScript signature
// `(value: string)` is the load-bearing guard: callers pass typed fields
// of MazurReceipt, none of which permit Symbol or undefined. If a future
// field is added with a non-string type and a caller forgets to convert,
// the compiler rejects the `S(...)` call before runtime. Note this helper
// is type-defensive only — JSON.stringify of a Symbol returns undefined,
// which would emit the literal "undefined" into the output and corrupt
// the receipt. The TypeScript signature prevents that path.
const S = (value: string): string => JSON.stringify(value);
const N = formatNumberForEngine;

// F-A-002: build-time exhaustiveness check that EMITTED_KEYS exactly equals
// `keyof MazurReceipt`. If a future PR adds a field to MazurReceipt without
// updating EMITTED_KEYS (silent emission drop) OR adds an entry here without a
// corresponding type field (typo), the _CHECK_EMITTED_KEYS initializer becomes
// a TS compile error. Either direction trips the same gate. This converts a
// silent runtime correctness bug — receipt content drift between the type and
// the emitter — into a build-time failure that surfaces during `pnpm
// typecheck` and CI before any byte ever lands in fixtures/.
//
// EMITTED_KEYS is also the authoritative emission order — the per-section
// emitter functions are called in the order the keys appear here, matching
// schemas/receipt.v0.1.0.json's x-order annotations. See
// test/schema-emit-consistency.test.ts for the cross-check on the data side.
const EMITTED_KEYS = [
  "schema_version", "fixture", "step", "fixture_status", "metadata",
  "numeric_policy", "bias_policy", "topology", "learning_rate",
  "inputs", "targets", "parameters_before", "forward", "loss",
  "backward", "updates", "parameters_after",
  "post_update_forward", "post_update_loss",
] as const

type _AssertEmittedKeysMatchReceiptKeys =
  [keyof MazurReceipt] extends [(typeof EMITTED_KEYS)[number]]
    ? [(typeof EMITTED_KEYS)[number]] extends [keyof MazurReceipt]
      ? true
      : ["MISSING_FROM_RECEIPT_TYPE", Exclude<(typeof EMITTED_KEYS)[number], keyof MazurReceipt>]
    : ["MISSING_FROM_EMITTED_KEYS", Exclude<keyof MazurReceipt, (typeof EMITTED_KEYS)[number]>]

const _CHECK_EMITTED_KEYS: _AssertEmittedKeysMatchReceiptKeys = true
void _CHECK_EMITTED_KEYS
void EMITTED_KEYS

/**
 * Emit a MazurReceipt as one canonical JSONL line.
 *
 * Contract:
 *   - Schema-ordered traversal (matches schemas/receipt.v0.1.0.json x-order
 *     annotations), NOT alphabetical key sort.
 *   - Byte-level: no whitespace inside the JSON, single LF (`\n`) terminator.
 *   - Numeric leaves routed through formatNumberForEngine — toPrecision(17) +
 *     scientificToPlain + 9-sig-fig round-half-to-even, plain-decimal output.
 *   - String fields escaped via JSON.stringify.
 *   - Integers (step, topology sizes, precision_significant_digits) emit as
 *     bare digits.
 *   - Booleans emit as literal `true` / `false`.
 *
 * Output is intended to be appended (or written, then verified byte-equal)
 * against fixtures/mazur.golden.jsonl. The byte-level contract is the load-
 * bearing property of the receipt format; any drift here invalidates the
 * "byte-equal across runs" determinism claim documented in
 * docs/canonical-emission.md.
 *
 * @returns Canonical JSONL line ending in LF (`}\n`).
 */
export function emitMazurReceipt(r: MazurReceipt): string {
  const parts: string[] = [
    `"schema_version":${S(r.schema_version)}`,
    `"fixture":${S(r.fixture)}`,
    `"step":${r.step}`,
    `"fixture_status":${emitFixtureStatus(r.fixture_status)}`,
    `"metadata":${emitMetadata(r.metadata)}`,
    `"numeric_policy":${emitNumericPolicy(r.numeric_policy)}`,
    `"bias_policy":${emitBiasPolicy(r.bias_policy)}`,
    `"topology":${emitTopology(r.topology)}`,
    `"learning_rate":${N(r.learning_rate)}`,
    `"inputs":${emitInputs(r.inputs)}`,
    `"targets":${emitTargets(r.targets)}`,
    `"parameters_before":${emitParameters(r.parameters_before)}`,
    `"forward":${emitForward(r.forward)}`,
    `"loss":${emitLoss(r.loss)}`,
    `"backward":${emitBackward(r.backward)}`,
    `"updates":${emitUpdates(r.updates)}`,
    `"parameters_after":${emitParameters(r.parameters_after)}`,
    `"post_update_forward":${emitPostUpdateForward(r.post_update_forward)}`,
    `"post_update_loss":${emitPostUpdateLoss(r.post_update_loss)}`,
  ];
  return `{${parts.join(",")}}\n`;
}

function emitFixtureStatus(s: MazurReceipt["fixture_status"]): string {
  return [
    "{",
    `"authoring_state":${S(s.authoring_state)},`,
    `"verification_state":${S(s.verification_state)},`,
    `"canonical":${s.canonical}`,
    "}",
  ].join("");
}

function emitMetadata(m: MazurReceipt["metadata"]): string {
  return [
    "{",
    `"source":${S(m.source)},`,
    `"url_reference":${S(m.url_reference)},`,
    `"gradient_convention":${S(m.gradient_convention)}`,
    "}",
  ].join("");
}

function emitNumericPolicy(np: MazurReceipt["numeric_policy"]): string {
  return [
    "{",
    `"number_encoding":${S(np.number_encoding)},`,
    `"precision_significant_digits":${np.precision_significant_digits},`,
    `"rounding":${S(np.rounding)},`,
    `"tolerance":${N(np.tolerance)},`,
    `"computation_order":${S(np.computation_order)},`,
    `"byte_output":${emitByteOutput(np.byte_output)}`,
    "}",
  ].join("");
}

function emitByteOutput(bo: MazurReceipt["numeric_policy"]["byte_output"]): string {
  return [
    "{",
    `"format":${S(bo.format)},`,
    `"json_key_order":${S(bo.json_key_order)},`,
    `"trailing_zero_policy":${S(bo.trailing_zero_policy)},`,
    `"indent":${S(bo.indent)}`,
    "}",
  ].join("");
}

function emitBiasPolicy(bp: MazurReceipt["bias_policy"]): string {
  return [
    "{",
    `"mode":${S(bp.mode)},`,
    `"reason":${S(bp.reason)},`,
    `"updated_in_step":${bp.updated_in_step},`,
    `"reconciliation":${S(bp.reconciliation)}`,
    "}",
  ].join("");
}

function emitTopology(t: MazurReceipt["topology"]): string {
  const layers = t.layers.map(S).join(",");
  return [
    "{",
    `"layers":[${layers}],`,
    `"input_size":${t.input_size},`,
    `"hidden_size":${t.hidden_size},`,
    `"output_size":${t.output_size},`,
    `"activation":${S(t.activation)},`,
    `"loss":${S(t.loss)},`,
    `"bias_sharing":${S(t.bias_sharing)}`,
    "}",
  ].join("");
}

function emitInputs(i: MazurReceipt["inputs"]): string {
  return `{"i1":${N(i.i1)},"i2":${N(i.i2)}}`;
}

function emitTargets(t: MazurReceipt["targets"]): string {
  return `{"o1":${N(t.o1)},"o2":${N(t.o2)}}`;
}

function emitParameters(p: MazurReceipt["parameters_before"]): string {
  return [
    "{",
    `"w1":${N(p.w1)},`,
    `"w2":${N(p.w2)},`,
    `"w3":${N(p.w3)},`,
    `"w4":${N(p.w4)},`,
    `"w5":${N(p.w5)},`,
    `"w6":${N(p.w6)},`,
    `"w7":${N(p.w7)},`,
    `"w8":${N(p.w8)},`,
    `"b1":${N(p.b1)},`,
    `"b2":${N(p.b2)}`,
    "}",
  ].join("");
}

function emitForwardUnit(u: ForwardUnit): string {
  return `{"net":${N(u.net)},"out":${N(u.out)}}`;
}

function emitForward(f: MazurReceipt["forward"]): string {
  return `{"h1":${emitForwardUnit(f.h1)},"h2":${emitForwardUnit(f.h2)},"o1":${emitForwardUnit(f.o1)},"o2":${emitForwardUnit(f.o2)}}`;
}

function emitLoss(l: MazurReceipt["loss"]): string {
  return `{"per_output":{"o1":${N(l.per_output.o1)},"o2":${N(l.per_output.o2)}},"total":${N(l.total)}}`;
}

function emitNamedFactor(f: NamedFactor): string {
  if (f.from !== undefined) {
    return `{"name":${S(f.name)},"from":${S(f.from)},"value":${N(f.value)}}`;
  }
  return `{"name":${S(f.name)},"value":${N(f.value)}}`;
}

function emitOutputErrorSignal(s: OutputErrorSignal): string {
  const factors = s.factors.map(emitNamedFactor).join(",");
  return `{"factors":[${factors}],"product_order":${S(s.product_order)},"signal_value":${N(s.signal_value)}}`;
}

function emitDownstreamContribution(c: DownstreamContribution): string {
  return `{"from":${S(c.from)},"downstream_signal":${N(c.downstream_signal)},"via_weight":${S(c.via_weight)},"weight_value":${N(c.weight_value)},"value":${N(c.value)}}`;
}

function emitHiddenErrorSignal(s: HiddenErrorSignal): string {
  const contribs = s.downstream_contributions.map(emitDownstreamContribution).join(",");
  const summationOrder = s.summation_order.map(S).join(",");
  return [
    "{",
    `"downstream_contributions":[${contribs}],`,
    `"summation_order":[${summationOrder}],`,
    `"backpropagated_sum":${N(s.backpropagated_sum)},`,
    `"activation_derivative":${N(s.activation_derivative)},`,
    `"product_order":${S(s.product_order)},`,
    `"signal_value":${N(s.signal_value)}`,
    "}",
  ].join("");
}

function emitBackward(b: MazurReceipt["backward"]): string {
  return [
    "{",
    `"output_error_signals":{`,
    `"o1":${emitOutputErrorSignal(b.output_error_signals.o1)},`,
    `"o2":${emitOutputErrorSignal(b.output_error_signals.o2)}`,
    `},`,
    `"hidden_error_signals":{`,
    `"h1":${emitHiddenErrorSignal(b.hidden_error_signals.h1)},`,
    `"h2":${emitHiddenErrorSignal(b.hidden_error_signals.h2)}`,
    `}`,
    "}",
  ].join("");
}

function emitOptimizer(o: Optimizer): string {
  const factors = o.factors.map(emitNamedFactor).join(",");
  return `{"name":${S(o.name)},"learning_rate":${N(o.learning_rate)},"factors":[${factors}],"product_order":${S(o.product_order)}}`;
}

function emitUpdate(u: Update): string {
  return [
    "{",
    `"parameter_id":${S(u.parameter_id)},`,
    `"kind":${S(u.kind)},`,
    `"layer_edge":${S(u.layer_edge)},`,
    `"parameter_role":${S(u.parameter_role)},`,
    `"from_unit":${S(u.from_unit)},`,
    `"to_unit":${S(u.to_unit)},`,
    `"weight_before":${N(u.weight_before)},`,
    `"optimizer":${emitOptimizer(u.optimizer)},`,
    `"gradient":${N(u.gradient)},`,
    `"update":${N(u.update)},`,
    `"weight_after":${N(u.weight_after)}`,
    "}",
  ].join("");
}

function emitUpdates(updates: Update[]): string {
  return `[${updates.map(emitUpdate).join(",")}]`;
}

function emitPostUpdateForward(p: MazurReceipt["post_update_forward"]): string {
  return [
    "{",
    `"status":${S(p.status)},`,
    `"h1":${emitForwardUnit(p.h1)},`,
    `"h2":${emitForwardUnit(p.h2)},`,
    `"o1":${emitForwardUnit(p.o1)},`,
    `"o2":${emitForwardUnit(p.o2)}`,
    "}",
  ].join("");
}

function emitPostUpdateLoss(p: MazurReceipt["post_update_loss"]): string {
  return [
    "{",
    `"status":${S(p.status)},`,
    `"per_output":{"o1":${N(p.per_output.o1)},"o2":${N(p.per_output.o2)}},`,
    `"total":${N(p.total)}`,
    "}",
  ].join("");
}

/**
 * Emit multiple receipts (Mazur and/or General) as a single canonical
 * JSONL document.
 *
 * Framing choice — trailing-LF AFTER EACH RECORD:
 *
 *   `{record1}\n{record2}\n{record3}\n`
 *
 * Rationale:
 *   - Each emit{Mazur,General}Receipt call already produces `{...}\n`
 *     (single LF terminator); concatenating with the empty string yields
 *     the trailing-LF-per-record framing naturally. No special-case for
 *     the last record — the single-record case (the existing v0.1 fixture
 *     shape) emits identically whether produced by emitMazurReceipt or
 *     emitReceipts([receipt]).
 *   - Trailing-LF-after-every-record is the strict ndjson convention
 *     (newline-delimited JSON, Wikipedia / ndjson.org) — distinct from
 *     "newline-separated" framing which would omit the final LF. Strict
 *     framing means every record is appendable: concatenating two files
 *     produced by emitReceipts is itself a valid emitReceipts output.
 *   - Existing fixtures/mazur.golden.jsonl ends in LF — byte-equal
 *     preservation requires the single-record emission stay byte-
 *     identical. `emitReceipts([receipt])` returns the same bytes as
 *     `emitMazurReceipt(receipt)` by construction.
 *
 * The empty-array case returns the empty string (NOT a lone LF). That
 * matches the "every record contributes one LF, zero records contribute
 * zero LFs" reading of the framing rule, and means
 * `parseReceiptJsonl(emitReceipts([])) === error("Empty JSONL input")`
 * — which is the correct symmetric behavior.
 *
 * v0.3 widens this to accept a mixed array of MazurReceipt (v0.1.0) and
 * GeneralReceipt (v0.2.0) values; dispatch is driven by
 * `receipt.schema_version`. Multi-step v0.2.0 training runs (memo §4)
 * are the canonical multi-record use case; the v0.1 single-record path
 * still works (single-element array of MazurReceipt).
 *
 * @param receipts  ReadonlyArray of Mazur and/or General receipts. Order
 *                  is preserved — receipts emit in the same order they
 *                  appear, no sorting / dedup.
 * @returns         Canonical JSONL string with trailing LF after each
 *                  record. Empty string for an empty input array.
 */
export function emitReceipts(
  receipts: ReadonlyArray<MazurReceipt | GeneralReceipt>,
): string {
  return receipts
    .map((r) =>
      r.schema_version === "0.1.0"
        ? emitMazurReceipt(r as MazurReceipt)
        : emitGeneralReceipt(r as GeneralReceipt),
    )
    .join("");
}

// =============================================================================
// v0.3 emitGeneralReceipt — schema-walker for v0.2.0-schema receipts
// =============================================================================

/**
 * Canonical-emission key order for v0.2.0-schema receipts.
 *
 * Mirrors schemas/receipt.v0.2.0.json `x-order` annotation. Top-level
 * fields emit in this order, with optional fields (trace_id, step_index)
 * inserted at their declared slot iff present.
 *
 * Build-time exhaustiveness check is intentionally lighter than v0.1's
 * `_AssertEmittedKeysMatchReceiptKeys` cross-check — GeneralReceipt's
 * shape is open-ended (unit/parameter id keys on inputs/forward/etc.) so
 * a strict "every key emits" assertion would have to discriminate
 * structural-required keys from data-keyed maps. The top-level required
 * fields ARE captured below as a static array used for both ordering AND
 * a per-receipt presence check; missing required fields surface as a
 * runtime Error rather than a compile error.
 */
const GENERAL_REQUIRED_TOPLEVEL_ORDER = [
  "schema_version",
  "fixture",
  "step",
  "fixture_status",
  "metadata",
  "numeric_policy",
  "bias_policy",
  "topology",
  "learning_rate",
  "unit_order",
  "parameter_order",
  "inputs",
  "targets",
  "parameters_before",
  "forward",
  "loss",
  "backward",
  "updates",
  "parameters_after",
  "post_update_forward",
  "post_update_loss",
] as const;
// Mark as load-bearing so a future emitter rewrite can't drop it on a
// "looks-unused" tree-shake. The constant is a single-source-of-truth
// reference for the v0.2.0 schema's x-order at the top level.
void GENERAL_REQUIRED_TOPLEVEL_ORDER;

/**
 * Emit a GeneralReceipt as one canonical JSONL line.
 *
 * v0.3 contract:
 *   - Schema-ordered traversal per schemas/receipt.v0.2.0.json x-order
 *     annotations. trace_id + step_index optional pair lands between
 *     learning_rate and unit_order when present (per the v0.2.0 schema's
 *     top-level x-order array).
 *   - Inputs/targets/parameters/forward/backward maps iterate in declared
 *     unit_order / parameter_order — NOT in JavaScript object-insertion
 *     order. This is the load-bearing canonical-key-order policy for
 *     generalized topologies.
 *   - numeric_policy.tolerance emits as object form `{atol, rtol}` if the
 *     receipt carries it that way, OR as legacy scalar form if it's a
 *     scalar (back-compat with v0.1 receipts that landed as v0.2.0 via
 *     transcoding). Reader-side normalization is the reconciler's job
 *     (see src/reconcile.ts normalizeTolerance).
 *   - post_update_forward emits with `status` first then each unit's
 *     ForwardUnit at the same level (per the v0.2.0 schema's
 *     additionalProperties: { ForwardUnit } shape). The engine's
 *     GeneralReceipt nests these under a `units` property; the emitter
 *     flattens during serialization.
 *
 * CRITICAL: emitMazurReceipt is unchanged and remains the v0.1.0 path.
 * This sibling exists for v0.2.0 receipts only.
 *
 * @returns Canonical JSONL line ending in LF (`}\n`).
 */
export function emitGeneralReceipt(r: GeneralReceipt): string {
  // Build the field list in declared order. Optional trace_id/step_index
  // insert between learning_rate and unit_order, matching the v0.2.0
  // schema's top-level x-order array.
  const parts: string[] = [
    `"schema_version":${S(r.schema_version)}`,
    `"fixture":${S(r.fixture)}`,
    `"step":${r.step}`,
    `"fixture_status":${emitFixtureStatusV02(r.fixture_status)}`,
    `"metadata":${emitMetadataV02(r.metadata)}`,
    `"numeric_policy":${emitNumericPolicyV02(r.numeric_policy)}`,
    `"bias_policy":${emitBiasPolicyV02(r.bias_policy)}`,
    `"topology":${emitTopologyV02(r.topology)}`,
    `"learning_rate":${N(r.learning_rate)}`,
  ];
  if (r.trace_id !== undefined) parts.push(`"trace_id":${S(r.trace_id)}`);
  if (r.step_index !== undefined) parts.push(`"step_index":${r.step_index}`);
  parts.push(`"inputs":${emitOrderedNumberMap(r.inputs, r.topology.unit_order.input)}`);
  parts.push(`"targets":${emitOrderedNumberMap(r.targets, r.topology.unit_order.output)}`);
  parts.push(`"parameters_before":${emitOrderedNumberMap(r.parameters_before, r.topology.parameter_order)}`);
  parts.push(`"forward":${emitForwardGeneral(r.forward, r.topology.unit_order)}`);
  parts.push(`"loss":${emitLossGeneral(r.loss, r.topology.unit_order.output)}`);
  parts.push(`"backward":${emitBackwardGeneral(r.backward, r.topology.unit_order)}`);
  parts.push(`"updates":${emitUpdates(r.updates)}`);
  parts.push(`"parameters_after":${emitOrderedNumberMap(r.parameters_after, r.topology.parameter_order)}`);
  parts.push(`"post_update_forward":${emitPostUpdateForwardGeneral(r.post_update_forward, r.topology.unit_order)}`);
  parts.push(`"post_update_loss":${emitPostUpdateLossGeneral(r.post_update_loss, r.topology.unit_order.output)}`);
  return `{${parts.join(",")}}\n`;
}

// --- v0.2.0 per-section emitters ------------------------------------------

function emitFixtureStatusV02(s: GeneralReceipt["fixture_status"]): string {
  // v0.2.0 FixtureStatus has the same required triple as v0.1 (authoring_
  // state, verification_state, canonical), plus optional promote_to /
  // describes_in / blockers_to_promotion fields the engine doesn't set.
  // Mirror v0.1's emit shape for the required fields.
  return [
    "{",
    `"authoring_state":${S(s.authoring_state)},`,
    `"verification_state":${S(s.verification_state)},`,
    `"canonical":${s.canonical}`,
    "}",
  ].join("");
}

function emitMetadataV02(m: GeneralReceipt["metadata"]): string {
  // The schema declares metadata as a free-form object (`type: "object"`).
  // The engine sets source + gradient_convention always, plus optional
  // url_reference. Emit in canonical-named order with the optional field
  // honored.
  const parts: string[] = [`"source":${S(m.source)}`];
  if (m.url_reference !== undefined) {
    parts.push(`"url_reference":${S(m.url_reference)}`);
  }
  parts.push(`"gradient_convention":${S(m.gradient_convention)}`);
  return `{${parts.join(",")}}`;
}

function emitNumericPolicyV02(np: GeneralReceipt["numeric_policy"]): string {
  // Hybrid tolerance emission (memo §3): if `tolerance` is a scalar
  // (legacy v0.1 sugar), emit it as a bare JSON number; if it's an object
  // {atol, rtol}, emit the canonical 2-field object. The reader (reconciler
  // normalizeTolerance) handles both shapes symmetrically.
  const tol = np.tolerance;
  const tolerancePart =
    typeof tol === "number"
      ? `"tolerance":${N(tol)}`
      : `"tolerance":{"atol":${N(tol.atol)},"rtol":${N(tol.rtol)}}`;
  return [
    "{",
    `"number_encoding":${S(np.number_encoding)},`,
    `"precision_significant_digits":${np.precision_significant_digits},`,
    `"rounding":${S(np.rounding)},`,
    `${tolerancePart},`,
    `"computation_order":${S(np.computation_order)},`,
    `"byte_output":${emitByteOutputV02(np.byte_output)}`,
    "}",
  ].join("");
}

function emitByteOutputV02(bo: GeneralReceipt["numeric_policy"]["byte_output"]): string {
  return [
    "{",
    `"format":${S(bo.format)},`,
    `"json_key_order":${S(bo.json_key_order)},`,
    `"trailing_zero_policy":${S(bo.trailing_zero_policy)},`,
    `"indent":${S(bo.indent)}`,
    "}",
  ].join("");
}

function emitBiasPolicyV02(bp: GeneralReceipt["bias_policy"]): string {
  // v0.2.0 schema requires `mode` + `updated_in_step`; reason +
  // reconciliation are optional. The engine populates all four in practice
  // but we emit only the present fields.
  const parts: string[] = [`"mode":${S(bp.mode)}`];
  if (bp.reason !== undefined) parts.push(`"reason":${S(bp.reason)}`);
  parts.push(`"updated_in_step":${bp.updated_in_step}`);
  if (bp.reconciliation !== undefined) {
    parts.push(`"reconciliation":${S(bp.reconciliation)}`);
  }
  return `{${parts.join(",")}}`;
}

function emitTopologyV02(t: SerializedTopology): string {
  // v0.2.0 Topology schema fields (matches schemas/receipt.v0.2.0.json#/$defs/Topology):
  // layers, input_size, hidden_size, output_size, unit_order, parameter_order,
  // parameters[], activation_hidden, activation_output, loss, bias_sharing.
  // unit_order + parameter_order + parameters live INSIDE topology (not root)
  // so the topology block is fully self-describing; consumers reconstructing
  // the engine state get the entire graph declaration in one nested object.
  const layers = t.layers.map(S).join(",");
  const unitOrder = emitUnitOrderV02(t.unit_order);
  const parameterOrder = emitParameterOrderV02(t.parameter_order);
  const parameters = emitTopologyParameters(t.parameters);
  const parts: string[] = [
    `"layers":[${layers}]`,
    `"input_size":${t.input_size}`,
    `"hidden_size":${t.hidden_size}`,
    `"output_size":${t.output_size}`,
    `"unit_order":${unitOrder}`,
    `"parameter_order":${parameterOrder}`,
    `"parameters":${parameters}`,
    `"activation_hidden":${S(t.activation_hidden)}`,
    `"activation_output":${S(t.activation_output)}`,
    `"loss":${S(t.loss)}`,
    `"bias_sharing":${S(t.bias_sharing)}`,
  ];
  return `{${parts.join(",")}}`;
}

function emitUnitOrderV02(uo: { input: readonly string[]; hidden: readonly string[]; output: readonly string[] }): string {
  const input = uo.input.map(S).join(",");
  const hidden = uo.hidden.map(S).join(",");
  const output = uo.output.map(S).join(",");
  return `{"input":[${input}],"hidden":[${hidden}],"output":[${output}]}`;
}

function emitParameterOrderV02(po: readonly string[]): string {
  return `[${po.map(S).join(",")}]`;
}

function emitTopologyParameter(p: SerializedTopology["parameters"][number]): string {
  // Each parameter has required id + role; optional from_unit / to_unit
  // (weights only) and applies_to_units (biases only). Emit in the
  // canonical-named order with optional fields honored.
  const parts: string[] = [`"id":${S(p.id)}`, `"role":${S(p.role)}`];
  if (p.from_unit !== undefined) parts.push(`"from_unit":${S(p.from_unit)}`);
  if (p.to_unit !== undefined) parts.push(`"to_unit":${S(p.to_unit)}`);
  if (p.applies_to_units !== undefined) {
    const units = p.applies_to_units.map(S).join(",");
    parts.push(`"applies_to_units":[${units}]`);
  }
  return `{${parts.join(",")}}`;
}

function emitTopologyParameters(ps: SerializedTopology["parameters"]): string {
  return `[${ps.map(emitTopologyParameter).join(",")}]`;
}

/**
 * Iterate `order` and emit `{ key1: N(map[key1]), key2: N(map[key2]), ... }`
 * — the canonical schema-defined key order for unit/parameter-keyed
 * number maps in v0.2.0 receipts. Throws if any required key is missing
 * from the map (per receipt-validity: every id in `order` must have a
 * value).
 */
function emitOrderedNumberMap(
  map: Readonly<Record<string, number>>,
  order: readonly string[],
): string {
  const parts: string[] = [];
  for (const key of order) {
    if (!(key in map)) {
      throw new Error(
        `emitOrderedNumberMap: missing required key '${key}' in ordered number map. ` +
          `Hint: every id in the receipt's unit_order/parameter_order must have a numeric value.`,
      );
    }
    parts.push(`${S(key)}:${N(map[key]!)}`);
  }
  return `{${parts.join(",")}}`;
}

/**
 * Iterate `order` and emit `{ key1: ForwardUnit, key2: ForwardUnit, ... }`
 * — per-unit forward records keyed by unit id. Used for both `forward` at
 * the receipt top level and the `units` block inside post_update_forward.
 */
function emitOrderedForwardMap(
  map: Readonly<Record<string, ForwardUnit>>,
  order: readonly string[],
): string {
  const parts: string[] = [];
  for (const key of order) {
    const unit = map[key];
    if (unit === undefined) {
      throw new Error(
        `emitOrderedForwardMap: missing required key '${key}' in ordered forward map.`,
      );
    }
    parts.push(`${S(key)}:${emitForwardUnit(unit)}`);
  }
  return `{${parts.join(",")}}`;
}

function emitForwardGeneral(
  forward: GeneralReceipt["forward"],
  unitOrder: { input: readonly string[]; hidden: readonly string[]; output: readonly string[] },
): string {
  // Hidden units first, then output units — input units have no forward
  // pass record (they are pure inputs to the network).
  const order = [...unitOrder.hidden, ...unitOrder.output];
  return emitOrderedForwardMap(forward, order);
}

function emitLossGeneral(
  loss: GeneralReceipt["loss"],
  outputOrder: readonly string[],
): string {
  const perOutput = emitOrderedNumberMap(loss.per_output, outputOrder);
  return `{"per_output":${perOutput},"total":${N(loss.total)}}`;
}

function emitBackwardGeneral(
  backward: GeneralReceipt["backward"],
  unitOrder: { input: readonly string[]; hidden: readonly string[]; output: readonly string[] },
): string {
  // output_error_signals are keyed by output unit id and emit in
  // unit_order.output order; hidden_error_signals are keyed by hidden
  // unit id and emit in unit_order.hidden order.
  const outputSignals = emitOrderedSignalMap(
    backward.output_error_signals,
    unitOrder.output,
    emitOutputErrorSignal,
  );
  const hiddenSignals = emitOrderedSignalMap(
    backward.hidden_error_signals,
    unitOrder.hidden,
    emitHiddenErrorSignal,
  );
  return [
    "{",
    `"output_error_signals":${outputSignals},`,
    `"hidden_error_signals":${hiddenSignals}`,
    "}",
  ].join("");
}

function emitOrderedSignalMap<T>(
  map: Readonly<Record<string, T>>,
  order: readonly string[],
  emitOne: (s: T) => string,
): string {
  const parts: string[] = [];
  for (const key of order) {
    const signal = map[key];
    if (signal === undefined) {
      throw new Error(
        `emitOrderedSignalMap: missing required key '${key}' in ordered signal map.`,
      );
    }
    parts.push(`${S(key)}:${emitOne(signal)}`);
  }
  return `{${parts.join(",")}}`;
}

function emitPostUpdateForwardGeneral(
  p: GeneralReceipt["post_update_forward"],
  unitOrder: { input: readonly string[]; hidden: readonly string[]; output: readonly string[] },
): string {
  // v0.2.0 schema shape: `status` first, then each unit's ForwardUnit as
  // sibling top-level keys (additionalProperties: ForwardUnit).
  // The engine's runtime type nests units under `p.units`; a JSON-parsed
  // receipt has them flattened at the top level (matching the wire shape).
  // Support both by checking p.units first, then falling back to flat keys.
  const order = [...unitOrder.hidden, ...unitOrder.output];
  const parts: string[] = [`"status":${S(p.status)}`];
  const flat = p as unknown as Record<string, unknown>;
  for (const key of order) {
    const unit = (p.units && p.units[key]) ?? (flat[key] as ForwardUnit | undefined);
    if (unit === undefined) {
      throw new Error(
        `emitPostUpdateForwardGeneral: missing required unit '${key}' (looked in p.units and as flat key).`,
      );
    }
    parts.push(`${S(key)}:${emitForwardUnit(unit)}`);
  }
  return `{${parts.join(",")}}`;
}

function emitPostUpdateLossGeneral(
  p: GeneralReceipt["post_update_loss"],
  outputOrder: readonly string[],
): string {
  // v0.2.0 schema's PostUpdateLoss has status + per_output + total
  // (plus optional drift-tracking fields the engine doesn't populate).
  const perOutput = emitOrderedNumberMap(p.per_output, outputOrder);
  return [
    "{",
    `"status":${S(p.status)},`,
    `"per_output":${perOutput},`,
    `"total":${N(p.total)}`,
    "}",
  ].join("");
}
