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
 * Emit multiple MazurReceipts as a single canonical JSONL document.
 *
 * Framing choice — trailing-LF AFTER EACH RECORD:
 *
 *   `{record1}\n{record2}\n{record3}\n`
 *
 * Rationale:
 *   - Each emitMazurReceipt call already produces `{...}\n` (single LF
 *     terminator); concatenating with the empty string yields the
 *     trailing-LF-per-record framing naturally. No special-case for the
 *     last record — the single-record case (the existing v0.1 fixture
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
 * v0.3+ may add a streaming variant (FT-F-007) that emits records as
 * they arrive; until then this in-memory helper is sufficient for the
 * single-record fixture shape and any small batches a future
 * `bp generate mazur --batch` mode might produce.
 *
 * @param receipts  ReadonlyArray of MazurReceipts. Order is preserved —
 *                  receipts emit in the same order they appear in the
 *                  array, no sorting / dedup.
 * @returns         Canonical JSONL string with trailing LF after each
 *                  record. Empty string for an empty input array.
 */
export function emitReceipts(receipts: ReadonlyArray<MazurReceipt>): string {
  return receipts.map(emitMazurReceipt).join("");
}
