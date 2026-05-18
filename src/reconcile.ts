/**
 * Reconciler v0.3 — implements all 10 rules from docs/reconciliation.md
 * with hybrid (atol + rtol) tolerance.
 *
 * Each rule has at least one bad-* fixture per the Csmith anti-circularity
 * doctrine (see docs/reconciliation.md "Failure-priority rule" and the
 * Csmith / CompCert lineage cited there). The reconciler answers one
 * question: does the math the receipt claims to have done actually add up?
 *
 * v0.4 note: Rules 1-10 cover per-neuron bias updates as a one-factor
 * special case of Rule 4. No Rule 11 needed for v0.4.
 * `bias_sharing: 'per_neuron'` (v0.4) extends the schema corner; the math
 * is unchanged. Per Agent B's analysis the existing rules fire byte-
 * identically on per-neuron bias receipts:
 *   - Rule 4: factors has length 1 (`[{value: signal_u}]`).
 *     `multiplyFactorsLeftToRight` returns `factors[0].value` when the
 *     array has a single entry (the loop runs zero times).
 *   - Rule 5/6/7: work on any update, including bias updates; per-neuron
 *     bias parameters appear in `parameter_order` and have matching
 *     entries in `updates[]`, so Rule 7's update-path branch fires.
 *   - Rule 8: bias factor's `from` references
 *     `backward.<layer>_error_signals.<unit>.signal_value` — a plain
 *     dotted path that `resolvePath` already handles.
 * The v0.4 receipt-schema widening (Optimizer.factors.minItems and
 * OutputErrorSignal.factors.minItems relaxed from 2 to 1) is matched here
 * by relaxing the defense-in-depth length floor in `checkRule1` and
 * `checkRule4` from `< 2` to `< 1`. v0.1-shape Mazur receipts (always
 * `factors.length === 2`) remain byte-identical.
 *
 * v0.1 wired Rule 4 (update.gradient) only.
 * v0.2 added Rules 1-3 and 5-8 — the full single-receipt math surface.
 * v0.3 lands two cross-cutting upgrades:
 *
 *   1. **Hybrid tolerance** — `applyToleranceCheck(a, b, policy)` replaces
 *      the pure-atol `Math.abs(a-b) > tolerance` pattern at every rule
 *      site. A scalar `tolerance: <N>` (v0.1/v0.2 shape) is treated as
 *      sugar for `{ atol: N, rtol: 0 }` and produces byte-identical
 *      reconciliation results to v0.2 — the v0.3 migration is strictly
 *      additive in capability. New v0.3 receipts may emit the object form
 *      `{ atol, rtol }` and benefit from the symmetric-max-form check
 *      `|a-b| <= max(atol, rtol*max(|a|,|b|))`.
 *
 *   2. **Multi-step rules** — Rule 9 (parameter chain across step
 *      boundaries) and Rule 10 (trace_id + step_index sequencing) extend
 *      the reconciler beyond a single receipt. They fire from
 *      `reconcileMultiStep(receipts)` against a JSONL training run; the
 *      single-receipt `reconcileReceipt()` path is unchanged and still
 *      runs only Rules 1-8.
 *
 * Plus two cheap structural improvements (from v0.2):
 *   - FT-E-017: cascade wiring — when rule N fails on parameter P and rule
 *     N-1 also failed on the same P, the rule-N failure carries
 *     `cascade_of_rule: N-1` so the CLI can render a "fix this first" hint.
 *   - FT-E-018: factor decomposition on multiplication-rule failures —
 *     Rules 1, 3, and 4 populate `factors` + `product_order` on failure so
 *     the CLI can render the canonical docs-style factors block under each
 *     failure.
 *
 * Sentinel rule numbers:
 *   rule: 0 — structural failure (shape invalid, unsupported product_order,
 *             non-finite arithmetic, underdetermined Rule 7). Not a real
 *             reconciliation rule.
 *   rule: 1-8 — the eight per-receipt reconciliation rules.
 *   rule: 9-10 — the two cross-receipt (multi-step) reconciliation rules.
 *               Surfaced only from reconcileMultiStep().
 */

import type { NamedFactor } from "./engine.js"
// v0.6 — Rule 14 (engine-recompute differential) needs to invoke the
// generalized engine on external_imported receipts. Importing inside the
// reconciler creates a deliberate coupling: the reconciler IS the second
// independent witness on observer-mode receipts; without that coupling
// the trust model collapses. Engine-authored receipts skip Rule 14 so
// the import has no runtime cost on the v0.1-v0.5 paths.
import {
  runGeneralStep,
  runBatchedGeneralStep,
  type GeneralInput,
  type BatchedGeneralInput,
  type GeneralReceipt,
} from "./general-engine.js"
import type { Topology } from "./topology.js"
import { emitGeneralReceipt } from "./emit.js"
import { hashReceipt } from "./hash.js"

/**
 * Tolerance policy — supports both v0.1 scalar form and v0.2+ object form.
 *
 * Scalar form: `tolerance: 1e-9` (v0.1/v0.2 receipts). Treated as
 * `{ atol: 1e-9, rtol: 0 }` so behavior is byte-identical to the pre-v0.3
 * pure-atol check.
 *
 * Object form: `tolerance: { atol: 1e-12, rtol: 1e-9 }` (v0.3+ receipts).
 * Both axes are honored via the symmetric-max-form check
 * `|a - b| <= max(atol, rtol * max(|a|, |b|))`.
 */
export type TolerancePolicy = number | { readonly atol: number; readonly rtol: number }

/**
 * Normalize a tolerance policy to the object form. Scalar `<N>` becomes
 * `{ atol: N, rtol: 0 }` (preserves v0.1 pure-atol semantics).
 *
 * The ONLY place in the reconciler that handles the scalar-vs-object
 * distinction — all rule sites route through `applyToleranceCheck`, which
 * calls this normalizer. New code MUST NOT branch on `typeof policy`.
 */
export function normalizeTolerance(p: TolerancePolicy): { atol: number; rtol: number } {
  if (typeof p === "number") return { atol: p, rtol: 0 }
  return { atol: p.atol, rtol: p.rtol }
}

/**
 * Symmetric max-form tolerance check:
 *
 *     |a - b| <= max(atol, rtol * max(|a|, |b|))
 *
 * Used by all 10 reconciler rules. Returns the absolute delta + tolerance
 * threshold that was actually applied (the effective max of atol and the
 * rtol-scaled magnitude bound) so failure reports stay informative — the
 * `appliedTolerance` field is what the CLI renders.
 *
 * NaN/Infinity poisoning: if either input or the computed delta is
 * non-finite, returns `{ ok: false, delta: NaN, appliedTolerance: 0,
 * isFinite: false }`. The caller wraps as a Rule N failure with delta:
 * NaN, tolerance: 0, and an explicit non-finite annotation in `message`.
 *
 * @param a       First operand (typically the recomputed value).
 * @param b       Second operand (typically the stored value).
 * @param policy  Tolerance policy. Scalar form is treated as
 *                `{ atol: scalar, rtol: 0 }` — preserves v0.1/v0.2
 *                behavior byte-identically.
 *
 * @returns       `{ ok, delta, appliedTolerance, isFinite }`. When
 *                `isFinite` is false, `delta` is NaN and
 *                `appliedTolerance` is 0 — both sentinels for the
 *                "non-finite arithmetic" branch.
 */
export function applyToleranceCheck(
  a: number,
  b: number,
  policy: TolerancePolicy,
): { ok: boolean; delta: number; appliedTolerance: number; isFinite: boolean } {
  const { atol, rtol } = normalizeTolerance(policy)
  if (!Number.isFinite(a) || !Number.isFinite(b)) {
    return { ok: false, delta: Number.NaN, appliedTolerance: 0, isFinite: false }
  }
  const delta = Math.abs(a - b)
  if (!Number.isFinite(delta)) {
    return { ok: false, delta, appliedTolerance: 0, isFinite: false }
  }
  const magBased = rtol * Math.max(Math.abs(a), Math.abs(b))
  const appliedTolerance = Math.max(atol, magBased)
  return {
    ok: delta <= appliedTolerance,
    delta,
    appliedTolerance,
    isFinite: true,
  }
}

/**
 * One reconciliation failure surfaced by reconcileReceipt or
 * reconcileMultiStep.
 *
 * For real-rule failures (rule >= 1), the numeric quartet
 * (stored / recomputed / delta / tolerance) carries the diagnostic
 * information and `message` is typically undefined / empty — the CLI's
 * RULE_LABELS table renders a human-readable headline from `rule` and the
 * quartet does the rest.
 *
 * For structural failures (rule === 0), the numeric quartet is meaningless
 * (typically all zeros), so an optional `message` field carries a
 * developer-facing sentence explaining what was wrong with the receipt
 * (e.g. "Unsupported product_order 'right_to_left' at
 * updates[0].optimizer.product_order. v0.2 reconciler accepts only
 * 'left_to_right'."). Consumers MAY render this verbatim.
 *
 * For multiplication-rule failures (Rules 1, 3, 4), `factors` carries the
 * decomposed operand values and `product_order` names the multiplication
 * order. The CLI can use these to render the canonical docs-style block:
 *
 *   factors (product_order: left_to_right):
 *     output_error_signal: -0.138498562
 *     upstream_activation:  0.593269992
 *
 * Other rules (2, 5, 6, 7, 8, 9, 10) omit factors — their failures are
 * fully described by the numeric quartet alone, optionally accompanied by
 * a developer-facing `message`.
 *
 * `cascade_of_rule` is set when a downstream rule fails on the same
 * parameter_id as an upstream rule in the same run. The CLI renders
 * "Note: cascades from Rule N. Fix Rule N first." so a reader can
 * prioritize the root cause.
 *
 * For Rule 10 trace_id mismatches, `stored` and `recomputed` hold the
 * observed-and-expected trace_id values cast to `any` (they're strings,
 * not numbers). CLI renderers SHOULD branch on `rule === 10` when
 * presenting these — the `message` field carries the human-readable
 * description in either case.
 */
export type ReconciliationFailure = {
  rule: number
  parameter_id?: string
  field_path: string
  stored: number
  recomputed: number
  delta: number
  tolerance: number
  cascade_of_rule?: number
  /**
   * Developer-facing hint. Populated for structural failures (rule === 0),
   * Rule 9 (multi-step chain breaks), Rule 10 (trace/step-index issues),
   * and any failure where the numeric quartet alone is insufficient.
   * Undefined or empty for plain numeric rule failures — those are fully
   * described by the quartet.
   */
  message?: string
  /**
   * Operand decomposition for multiplication-rule failures (Rules 1, 3, 4).
   * Omitted for non-multiplication rules. When present, the CLI may render
   * the canonical docs-style factors block under the failure headline.
   */
  factors?: NamedFactor[]
  /**
   * Multiplication order used when `factors` is populated. Always
   * "left_to_right" in v0.2/v0.3 — the only product_order the engine
   * emits and the only one the reconciler accepts. Declared so a future
   * rtl variant can be distinguished without an additive field rename.
   */
  product_order?: "left_to_right"
}

export type ReconciliationResult =
  | { ok: true }
  | { ok: false; failures: ReconciliationFailure[] }

/**
 * Canonical human-readable description for each reconciliation rule.
 *
 * Single source of truth for rule descriptions: docs/reconciliation.md
 * "The rules" headings and src/bin/bp.ts RULE_LABELS labels should all
 * derive from this table.
 *
 * Rule 0 is the structural-failure sentinel (NOT one of the documented
 * rules, but a reconciler-internal slot for shape/typing failures so the
 * result stream stays uniformly `{ ok: false; failures: [...] }` rather
 * than mixing throws and structured failures).
 *
 * v0.3 wires all ten rules; the table also serves as a registration
 * point so CLI labels and future MCP-tool descriptions pull from one
 * source.
 */
export const RULE_DESCRIPTIONS: Record<number, string> = {
  0: "Structural failure: receipt-internal contradiction (shape invalid, unsupported product_order, non-finite arithmetic, OR v0.4.1+ cross-consistency between bias_policy.mode / bias_sharing / Update.kind / topology declarations; v0.5 adds Rule 0.8 sub-check: softmax probability bounds).",
  1: "Output error signal consistency: signal_value == product(factors), left-to-right.",
  2: "Downstream contribution and backpropagated sum: contribution.value == downstream_signal * weight_value AND backpropagated_sum == sum(contributions in summation_order).",
  3: "Hidden error signal consistency: signal_value == backpropagated_sum * activation_derivative, left-to-right.",
  4: "Update gradient consistency: update.gradient == product(optimizer.factors), left-to-right.",
  5: "Update value consistency: update.update == optimizer.learning_rate * update.gradient.",
  6: "Weight progression: update.weight_after == update.weight_before + update.update.",
  7: "Final state consistency: parameters_after[param] == parameters_before[param] + sum(updates targeting param).",
  8: "Provenance reference consistency: each factor.from path resolves and factor.value matches the referenced field.",
  9: "Multi-step parameter chain: step N parameters_before == step N-1 parameters_after (within tolerance).",
  10: "Multi-step trace identity: all receipts share trace_id AND step_index is sequential (0, 1, 2, ..., N-1).",
  11: "Softmax normalization: when topology.activation_output === 'softmax', sum(forward[output_unit].out) == 1.0 within tolerance. Fires for v0.5 softmax+CE receipts.",
  12: "Loss formula consistency: loss.per_output[u] and loss.total match the formula declared by topology.loss (v0.4.2: half_squared_error; v0.5: cross_entropy_softmax). Independent of backward — closes a real v0.4.1 trust gap surfaced by the v0.5 study.",
  13: "Gated dual-form consistency (softmax+CE): when OutputErrorSignal.dual_form is present, 13a each jacobian_term.term_value == product(jacobian_term.factors), 13b dual_form.summed_value == sum(jacobian_terms.term_value) in summation_order, 13c dual_form.summed_value == OutputErrorSignal.signal_value. Skipped silently when dual_form is absent — the GATED behavior locked in the v0.5 consolidator Q1 decision.",
  14: "Engine-recompute differential (observer-mode): when fixture_status.authoring_state === 'external_imported', re-run runGeneralStep from parameters_before + inputs + targets + topology and assert engine output agrees with the receipt's claimed forward/loss/backward/updates/parameters_after within attestor.differential_tolerance. Catches the collapsed-laundering attack class (foreign claims diverge from independent engine recomputation). No-op when authoring_state !== 'external_imported'.",
  15: "Skip-basis required (observer-mode): when fixture_status.verification_state === 'engine_recompute_skipped_with_basis', attestor.skip_basis MUST be present AND in the closed enum EXTERNAL_TRUST_BASIS = {hardware_nondeterminism, framework_op_unsupported, distributed_only_field, attested_third_party}. Empty/missing/out-of-enum fires Rule 15. Leroy's verified-vs-trusted discipline applied: skipping the math gate requires naming the reason on the record.",
  16: "Attestation digest binding (gated): when attestor.signed_subject_digest is present, the digest MUST equal hashReceipt(receipt with attestor.signed_subject_digest stripped). Catches SolarWinds-style 'signed-but-substituted' attacks where a valid signature is bound to mutated bytes. Signature *validity* (cosign verification) is OUT of scope for the reconciler — Rule 16 only checks digest-binding integrity. Silently skips when signed_subject_digest is absent — the GATED behavior consistent with Rule 13.",
}

type Factor = { name: string; from?: string; value: number }

type Optimizer = {
  name: string
  learning_rate: number
  factors: Factor[]
  product_order: "left_to_right"
}

type Update = {
  parameter_id: string
  weight_before: number
  optimizer: Optimizer
  gradient: number
  update: number
  weight_after: number
  kind?: "weight" | "bias"
}

type TopologyParameter = {
  id: string
  role: "input_to_hidden_weight" | "hidden_to_output_weight" | "hidden_bias" | "output_bias"
  from_unit?: string
  to_unit?: string
  applies_to_units?: string[]
}

type TopologyShape = {
  input_size?: number
  hidden_size?: number
  output_size?: number
  unit_order?: { input?: string[]; hidden?: string[]; output?: string[] }
  parameter_order?: string[]
  parameters?: TopologyParameter[]
  bias_sharing?: "per_layer" | "per_neuron"
  loss?: "half_squared_error" | "cross_entropy_softmax"
  /**
   * v0.5: optional output-layer activation. When "softmax", Rules 0.8
   * (probability bounds) and 11 (softmax normalization) fire on the receipt's
   * forward outputs.
   */
  activation_output?: "sigmoid" | "identity" | "relu" | "softmax"
  /**
   * v0.6: optional hidden-layer activation (needed when Rule 14 reconstructs
   * a Topology for engine recomputation on observer-mode receipts).
   */
  activation_hidden?: "sigmoid" | "identity" | "relu"
  layers?: string[]
}

type ForwardUnit = {
  net?: number
  out?: number
}

type LossShape = {
  per_output?: Record<string, number>
  total?: number
}

type Contribution = {
  from: string
  downstream_signal: number
  via_weight: string
  weight_value: number
  value: number
}

type JacobianTermShape = {
  target_unit: string
  factors: Factor[]
  term_value: number
}

type DualFormShape = {
  jacobian_terms: JacobianTermShape[]
  product_order: "left_to_right"
  summation_order: string[]
  summed_value: number
}

type OutputErrorSignalShape = {
  factors: Factor[]
  product_order: "left_to_right"
  signal_value: number
  /**
   * v0.5 dual-form Jacobian decomposition. Present only when the receipt is
   * a softmax+CE receipt that opted into dual-form emission. Rule 13 fires
   * only when this field is present (the GATED behavior). Receipts authored
   * from PyTorch / other frameworks may omit dual_form; Rule 13 is silent
   * in that case.
   */
  dual_form?: DualFormShape
}

type HiddenErrorSignalShape = {
  downstream_contributions: Contribution[]
  summation_order: string[]
  backpropagated_sum: number
  activation_derivative: number
  product_order: "left_to_right"
  signal_value: number
}

/**
 * v0.6 — closed enum of skip-basis values for Rule 15. Mirrors the
 * src/general-engine.ts EXTERNAL_TRUST_BASIS constant; duplicated here
 * (rather than imported as a value) because the reconciler MUST stay
 * self-contained for the value check — a future engine refactor that
 * deletes or renames the enum would silently weaken Rule 15.
 */
export const EXTERNAL_TRUST_BASIS_RECONCILER = [
  "hardware_nondeterminism",
  "framework_op_unsupported",
  "distributed_only_field",
  "attested_third_party",
] as const
type ExternalTrustBasisReconciler =
  (typeof EXTERNAL_TRUST_BASIS_RECONCILER)[number]

type AttestorShape = {
  computed_by?: { kind?: string; identity?: string }
  verified_by?: { kind?: string; identity?: string }
  differential_tolerance?: { atol?: number; rtol?: number }
  import_provenance?: {
    source_format?: string
    source_hash?: string
    import_timestamp?: string
  }
  skip_basis?: string
  signed_subject_digest?: string
}

type SourceFrameworkShape = {
  name?: string
  version?: string
  information_uri?: string
  extractor?: { name?: string; version?: string }
}

type Receipt = {
  schema_version?: string
  numeric_policy: { tolerance: TolerancePolicy }
  bias_policy?: { mode?: string }
  updates: Update[]
  parameters_before?: Record<string, number>
  parameters_after?: Record<string, number>
  topology?: TopologyShape
  inputs?: Record<string, number>
  targets?: Record<string, number>
  forward?: Record<string, ForwardUnit>
  loss?: LossShape
  backward?: {
    output_error_signals?: Record<string, OutputErrorSignalShape>
    hidden_error_signals?: Record<string, HiddenErrorSignalShape>
  }
  trace_id?: string
  step_index?: number
  fixture_status?: {
    authoring_state?: string
    verification_state?: string
  }
  learning_rate?: number
  source_framework?: SourceFrameworkShape
  attestor?: AttestorShape
}

/**
 * Multiply factors strictly left-to-right per docs/computation-order.md.
 *
 * Exported so tests can prove the order matters (and so a future receipt
 * that declares a different product_order can be routed to a different
 * helper rather than secretly mis-multiplying).
 *
 * @param factors  Array of `{ value: number }`. Schema requires
 *                 `minItems: 1` in v0.4 (relaxed from 2 to support
 *                 per-neuron bias single-factor gradients), but this helper
 *                 accepts any length >= 1 so it can be reused outside Rule
 *                 4 in v0.2+. A single-factor array correctly returns
 *                 `factors[0].value` (the body loop runs zero times).
 * @returns        The running product `((factors[0] * factors[1]) * factors[2]) ...`
 *                 evaluated strictly left-to-right with V8's binary64 *
 *                 operator (no FMA, no re-association). Returns `NaN` for
 *                 an empty input array — callers must flag empty factors
 *                 as a structural failure (the schema's minItems 1 catches
 *                 this upstream of the reconciler). NaN/Infinity in any
 *                 factor.value PROPAGATES through the product chain by
 *                 IEEE-754 arithmetic; downstream NaN-checks in
 *                 reconcileReceipt convert that to a rule failure with
 *                 delta: NaN (never a silent pass).
 */
export function multiplyFactorsLeftToRight(
  factors: ReadonlyArray<{ value: number }>,
): number {
  if (factors.length === 0) return Number.NaN
  let product = factors[0]!.value
  for (let j = 1; j < factors.length; j++) product = product * factors[j]!.value
  return product
}

/**
 * Multiply factors strictly right-to-left.
 *
 * Exported only so tests can prove product_order is load-bearing (a
 * fixture with operand magnitudes that round differently in each
 * direction should expose the divergence). Never called from production
 * paths in v0.2.
 *
 * @param factors  Array of `{ value: number }`. Returns `NaN` for an empty
 *                 array, mirroring multiplyFactorsLeftToRight. NaN/Infinity
 *                 in any factor.value propagates through the product chain
 *                 the same way it would left-to-right (just visiting the
 *                 factors in reverse).
 * @returns        The running product `(factors[last] * factors[last-1]) ...`
 *                 evaluated strictly right-to-left. For most binary64
 *                 inputs this equals the left-to-right product modulo a
 *                 final ULP, but choice of order is observable for
 *                 sufficiently asymmetric operand magnitudes.
 */
export function multiplyFactorsRightToLeft(
  factors: ReadonlyArray<{ value: number }>,
): number {
  if (factors.length === 0) return Number.NaN
  let product = factors[factors.length - 1]!.value
  for (let j = factors.length - 2; j >= 0; j--) product = product * factors[j]!.value
  return product
}

/**
 * Sum a heterogeneous array of items in a declared key order, looking up
 * each item by a caller-supplied key extractor.
 *
 * Used by Rule 2 to sum downstream_contributions in the receipt's
 * declared `summation_order` rather than in array-traversal order. The
 * order matters because floating-point addition is not associative; a
 * receipt that declares `summation_order: ["o1", "o2"]` but stores the
 * contributions in `[o2, o1]` order must be summed o1-first to match the
 * stored backpropagated_sum.
 *
 * @param items     Source array (any order). Items not referenced by
 *                  `order` are silently dropped from the sum — Rule 2's
 *                  contract is "sum what summation_order names," not "sum
 *                  the array."
 * @param order     The declared order to sum in (e.g. ["o1", "o2"]).
 * @param getKey    Extracts the key from an item (e.g. `c => c.from`).
 * @param getValue  Extracts the numeric value to add (e.g. `c => c.value`).
 * @returns         The running sum, evaluated strictly left-to-right over
 *                  `order`. Returns `NaN` if any referenced key is missing
 *                  from `items` OR if any extracted value is non-finite —
 *                  the caller can detect either case via Number.isFinite.
 */
export function sumInOrder<T>(
  items: ReadonlyArray<T>,
  order: readonly string[],
  getKey: (t: T) => string,
  getValue: (t: T) => number,
): number {
  if (order.length === 0) return 0
  let sum = 0
  let first = true
  for (const key of order) {
    const item = items.find((it) => getKey(it) === key)
    if (item === undefined) return Number.NaN
    const v = getValue(item)
    if (first) {
      sum = v
      first = false
    } else {
      sum = sum + v
    }
  }
  return sum
}

/**
 * Resolve a Rule-8 provenance path against the receipt root.
 *
 * Supports dotted segments (`forward.h1.out`,
 * `backward.output_error_signals.o1.signal_value`, `inputs.i1`) and
 * bracketed numeric indices (`updates[0].optimizer.factors[1].value`).
 * Mixed forms work: `updates[0].optimizer.factors[1].value` walks `updates`
 * → element 0 → `optimizer` → `factors` → element 1 → `value`.
 *
 * Returns `{ found: true, value }` only when the path resolves to a finite
 * number. Returns `{ found: false, reason }` for every other outcome
 * (path component missing, index out of bounds, leaf not a number, leaf
 * non-finite). The reason string is developer-facing and suitable for
 * inclusion in a structural-failure message.
 *
 * Note: this helper does NOT compare values — that is the caller's job.
 * It is a pure lookup primitive so Rule 8 can be tested in isolation
 * from the value-comparison contract.
 */
export function resolvePath(
  receipt: unknown,
  path: string,
): { found: true; value: number } | { found: false; reason: string } {
  if (typeof path !== "string" || path.length === 0) {
    return { found: false, reason: "path is empty or not a string" }
  }
  // Tokenize: split on '.' then expand any bracketed indices.
  // "updates[0].optimizer.factors[1].value" → ["updates", 0, "optimizer", "factors", 1, "value"]
  const tokens: Array<string | number> = []
  for (const part of path.split(".")) {
    if (part.length === 0) {
      return { found: false, reason: `path ${JSON.stringify(path)} has an empty segment` }
    }
    // Match `name[index1][index2]...` — peel the head off and then each `[N]`.
    const headMatch = part.match(/^([^[\]]+)((?:\[\d+\])*)$/)
    if (!headMatch) {
      return { found: false, reason: `path segment ${JSON.stringify(part)} is malformed` }
    }
    tokens.push(headMatch[1]!)
    const tail = headMatch[2]!
    if (tail.length > 0) {
      const indexMatches = tail.matchAll(/\[(\d+)\]/g)
      for (const m of indexMatches) {
        tokens.push(parseInt(m[1]!, 10))
      }
    }
  }
  let cursor: unknown = receipt
  for (const tok of tokens) {
    if (cursor === null || cursor === undefined) {
      return { found: false, reason: `path ${JSON.stringify(path)} hits null/undefined before token ${JSON.stringify(tok)}` }
    }
    if (typeof tok === "number") {
      if (!Array.isArray(cursor)) {
        return { found: false, reason: `path ${JSON.stringify(path)} indexes [${tok}] into a non-array at the corresponding segment` }
      }
      if (tok < 0 || tok >= cursor.length) {
        return { found: false, reason: `path ${JSON.stringify(path)} index ${tok} is out of bounds (length ${cursor.length})` }
      }
      cursor = cursor[tok]
    } else {
      if (typeof cursor !== "object" || Array.isArray(cursor)) {
        return { found: false, reason: `path ${JSON.stringify(path)} expected an object at segment ${JSON.stringify(tok)} but found ${Array.isArray(cursor) ? "array" : typeof cursor}` }
      }
      const obj = cursor as Record<string, unknown>
      if (!(tok in obj)) {
        return { found: false, reason: `path ${JSON.stringify(path)} segment ${JSON.stringify(tok)} is missing` }
      }
      cursor = obj[tok]
    }
  }
  if (typeof cursor !== "number") {
    return { found: false, reason: `path ${JSON.stringify(path)} resolved to ${typeof cursor}, expected a number` }
  }
  if (!Number.isFinite(cursor)) {
    return { found: false, reason: `path ${JSON.stringify(path)} resolved to a non-finite number (${String(cursor)})` }
  }
  return { found: true, value: cursor }
}

/**
 * Structural validity check for a tolerance policy value. Returns true if
 * the value is either:
 *   - a finite number (scalar form, v0.1/v0.2 receipts), OR
 *   - an object with finite `atol` AND finite `rtol` (object form, v0.3+).
 *
 * Used by `reconcileReceipt` to surface a Rule-0 structural failure when
 * `numeric_policy.tolerance` is malformed BEFORE any rule runs. Schema
 * validation against receipt.v0.1.0.json / receipt.v0.2.0.json is the
 * load-bearing gate; this helper exists only so a receipt that bypasses
 * validation surfaces a typed failure rather than a cryptic crash.
 */
function isValidTolerancePolicy(t: unknown): t is TolerancePolicy {
  if (typeof t === "number") return Number.isFinite(t)
  if (t !== null && typeof t === "object") {
    const obj = t as { atol?: unknown; rtol?: unknown }
    return (
      typeof obj.atol === "number" &&
      Number.isFinite(obj.atol) &&
      typeof obj.rtol === "number" &&
      Number.isFinite(obj.rtol)
    )
  }
  return false
}

/**
 * Reconcile the math claims in a backprop-trace receipt against the rules
 * documented in docs/reconciliation.md.
 *
 * v0.3 SCOPE: per-receipt rules (1-8) wired with hybrid-tolerance check.
 * Multi-step rules (9, 10) fire from `reconcileMultiStep` against a JSONL
 * training run — `reconcileReceipt` deliberately skips them so a
 * single-receipt verify gate (`bp verify mazur`, `bp verify general`) is
 * not muddied with multi-step assertions that don't apply.
 *
 * Cascade detection fires on Rules 5/6/7 when an upstream rule failed on
 * the same parameter_id. See RULE_DESCRIPTIONS for the canonical rule
 * descriptions.
 *
 * The function is tolerant of malformed receipts: instead of throwing, it
 * surfaces a typed Rule-0 (structural-failure) entry with a developer-
 * facing `message` explaining what was wrong (e.g. wrong product_order,
 * missing tolerance, empty factors array, NaN gradient). This keeps the
 * caller on a single discriminated-union code path.
 *
 * @param receipt  An unknown value, expected (but not enforced) to have
 *                 already passed JSON-Schema validation against
 *                 schemas/receipt.v0.1.0.json (scalar tolerance) or
 *                 schemas/receipt.v0.2.0.json (object tolerance). The
 *                 function performs a minimal structural shape guard so a
 *                 malformed receipt produces a typed failure rather than
 *                 a cryptic crash.
 * @returns        `{ ok: true }` if every implemented rule passes within
 *                 tolerance, OR `{ ok: false; failures: [...] }` listing
 *                 every failure found. The failures array is never empty
 *                 when `ok` is false. Order is deterministic: rules fire
 *                 in numeric order (1, 2, 3, 4, 5, 6, 7, 8) and within
 *                 each rule in receipt-traversal order.
 *
 * @example
 *   import { reconcileReceipt } from "@mcptoolshop/backprop-trace";
 *   import { readFileSync } from "node:fs";
 *
 *   const receipt = JSON.parse(readFileSync("receipt.json", "utf-8"));
 *   const result = reconcileReceipt(receipt);
 *   if (!result.ok) {
 *     for (const f of result.failures) {
 *       const hint = f.message ? ` -- ${f.message}` : "";
 *       console.error(`Rule ${f.rule} at ${f.field_path}: delta=${f.delta}${hint}`);
 *     }
 *     process.exit(1);
 *   }
 */
export function reconcileReceipt(receipt: unknown): ReconciliationResult {
  // Precondition: the receipt has passed schema validation against
  // schemas/receipt.v0.1.0.json or schemas/receipt.v0.2.0.json. This
  // function does not re-validate structure exhaustively; it performs a
  // minimal structural shape guard here so a malformed receipt produces
  // a typed Rule-0 failure rather than a cryptic crash (E-A-002).
  if (receipt === null || typeof receipt !== "object") {
    return {
      ok: false,
      failures: [
        {
          rule: 0,
          field_path: "root",
          stored: 0,
          recomputed: 0,
          delta: 0,
          tolerance: 0,
          message:
            "Receipt is not a JSON object (got " +
            (receipt === null ? "null" : typeof receipt) +
            "). Run schema validation against schemas/receipt.v0.1.0.json or v0.2.0.json before reconciling.",
        },
      ],
    }
  }
  const raw = receipt as { numeric_policy?: unknown; updates?: unknown }
  const np = raw.numeric_policy as { tolerance?: unknown } | undefined
  if (np === null || typeof np !== "object" || !isValidTolerancePolicy(np.tolerance)) {
    return {
      ok: false,
      failures: [
        {
          rule: 0,
          field_path: "numeric_policy.tolerance",
          stored: 0,
          recomputed: 0,
          delta: 0,
          tolerance: 0,
          message:
            "Receipt is missing required field 'numeric_policy.tolerance' or it is malformed. " +
            "Expected a finite number (v0.1/v0.2 scalar form) or an object " +
            "{ atol: <finite>, rtol: <finite> } (v0.3+ object form). " +
            "Run schema validation against schemas/receipt.v0.1.0.json or v0.2.0.json before reconciling.",
        },
      ],
    }
  }
  if (!Array.isArray(raw.updates)) {
    return {
      ok: false,
      failures: [
        {
          rule: 0,
          field_path: "updates",
          stored: 0,
          recomputed: 0,
          delta: 0,
          tolerance: 0,
          message:
            "Receipt is missing required field 'updates' (expected an array of update records). " +
            "Run schema validation against schemas/receipt.v0.1.0.json or v0.2.0.json before reconciling.",
        },
      ],
    }
  }

  const r = receipt as Receipt
  const failures: ReconciliationFailure[] = []
  const tolerance = r.numeric_policy.tolerance

  // --- Rule 0 (Phase 0): structural cross-consistency -------------------
  // Catch receipt-internal contradictions BEFORE running numeric rules.
  // Numeric Rules 1-8 on a structurally-broken receipt produce confusing
  // failure quartets (e.g., Rule 7 saying "params_after disagrees with
  // before+update" when the real bug is "bias_policy.mode='constant' but
  // bias updates exist"). Short-circuit: if Phase 0 fires, return without
  // running Rules 1-8. The structural quartet alone tells the operator
  // what's actually wrong.
  //
  // Each check gracefully no-ops when the relevant v0.2+ fields aren't
  // present (e.g., v0.1 Mazur receipts skip the topology.parameters checks
  // since v0.1 schema doesn't carry that field).
  checkRule0Structural(r, failures)
  if (failures.length > 0) {
    return { ok: false, failures }
  }

  // Cascade-tracking state: for each parameter_id, remember the set of
  // rule numbers that have already failed on it in this run. Rules 5, 6,
  // 7 consult this map to set `cascade_of_rule` on their own failures.
  // The earliest (smallest-numbered) prior failure wins for naming.
  const failuresByParam = new Map<string, Set<number>>()
  function recordFailure(rule: number, parameter_id: string | undefined): void {
    if (parameter_id === undefined) return
    let set = failuresByParam.get(parameter_id)
    if (!set) {
      set = new Set<number>()
      failuresByParam.set(parameter_id, set)
    }
    set.add(rule)
  }
  function priorFailureRule(parameter_id: string | undefined, candidates: readonly number[]): number | undefined {
    if (parameter_id === undefined) return undefined
    const set = failuresByParam.get(parameter_id)
    if (!set) return undefined
    // Earliest-numbered candidate that fired wins so the cascade chain is
    // labeled at its root rather than at the immediately-prior link.
    for (const c of candidates) {
      if (set.has(c)) return c
    }
    return undefined
  }

  // --- Rule 1: output error signal == product(factors) -----------------
  checkRule1(r, tolerance, failures, recordFailure)

  // --- Rule 2: contribution products + backpropagated sum --------------
  checkRule2(r, tolerance, failures, recordFailure)

  // --- Rule 3: hidden error signal == backprop_sum * activation_deriv --
  checkRule3(r, tolerance, failures, recordFailure)

  // --- Rule 4: update.gradient == product(optimizer.factors) -----------
  checkRule4(r, tolerance, failures, recordFailure)

  // --- Rule 5: update == lr * gradient (cascades from 4) ---------------
  checkRule5(r, tolerance, failures, recordFailure, priorFailureRule)

  // --- Rule 6: weight_after == weight_before + update (cascades 4/5) ---
  checkRule6(r, tolerance, failures, recordFailure, priorFailureRule)

  // --- Rule 7: parameters_after final state + bias-policy branch -------
  checkRule7(r, tolerance, failures, recordFailure, priorFailureRule)

  // --- Rule 8: provenance reference (factor.from path resolution) ------
  checkRule8(r, tolerance, failures)

  // --- Rule 11: softmax normalization ----------------------------------
  // When topology.activation_output === "softmax", the forward outputs are
  // probabilities and MUST sum to 1.0 within tolerance. Silently no-ops when
  // activation_output is anything else (sigmoid/identity/relu) — those
  // outputs are not constrained to be normalized.
  checkRule11SoftmaxNormalization(r, tolerance, failures)

  // --- Rule 12: loss formula consistency (per-output + total) ----------
  // Independent of backward (loss is a forward-side computation). Wired in
  // v0.4.2 as a polymorphic dispatcher on topology.loss; v0.5 fills in the
  // cross_entropy_softmax branch. Closes a real v0.4.1 gap: prior to v0.4.2,
  // loss.total was schema-validated but never math-checked by any rule (the
  // half_squared_error formula was effectively trust-on-faith).
  checkRule12LossFormula(r, tolerance, failures)

  // --- Rule 13: gated dual-form consistency (softmax+CE) ---------------
  // Fires ONLY when an output_error_signals[u].dual_form block is present.
  // Receipts that emit collapsed form only (the engine default for non-
  // softmax+CE, or PyTorch-style traces) silently skip Rule 13. When
  // present, three sub-checks: 13a per-term multiplication, 13b summation,
  // 13c collapsed-vs-dual sum equality. Q1 = GATED, Q2 = NO auto-synthesis
  // (the engine emits dual_form when authoring softmax+CE; it does NOT
  // back-fill dual_form on receipts that lack it).
  checkRule13GatedDualForm(r, tolerance, failures)

  // --- Rule 14: engine-recompute differential (observer-mode only) -----
  // Fires when fixture_status.authoring_state === "external_imported".
  // No-op for engine-authored receipts (the engine IS the producer, no
  // second-witness needed). Catches the collapsed-laundering attack class.
  checkRule14EngineRecomputeDifferential(r, failures)

  // --- Rule 15: skip-basis required (observer-mode) --------------------
  // Fires when verification_state === "engine_recompute_skipped_with_basis"
  // AND attestor.skip_basis is missing or not in EXTERNAL_TRUST_BASIS.
  checkRule15SkipBasis(r, failures)

  // --- Rule 16: attestation digest binding (gated on signed_subject_digest)
  // Fires when attestor.signed_subject_digest is present AND the
  // recomputed canonical-byte digest of the receipt (with the digest field
  // stripped) does not match. Silently skips when absent.
  checkRule16AttestationBinding(receipt, r, failures)

  // --- Rule 18 (v0.9): batch reduction consistency (gated on batch presence)
  // Fires when receipt.batch is present AND loss.reduction is "mean" or
  // "sum". Asserts loss.total == reduction(loss.per_sample.values()).
  // Catches mean-vs-sum confusion structurally. Silently skips for unbatched
  // receipts.
  checkRule18BatchReduction(r, tolerance, failures)

  // --- Rule 19 (v0.9): sample-set coherence (gated on batch.sample_order)
  // When batch.sample_order is present, every ordered per-sample projection
  // used for reduction / emission / canonical digest construction MUST be
  // derived by iterating exactly that order. Missing, duplicate, or out-of-
  // order sample IDs fail. Silently skips for unbatched receipts.
  checkRule19SampleSetCoherence(r, failures)

  if (failures.length === 0) {
    return { ok: true }
  }
  return { ok: false, failures }
}

// ============================================================================
// Per-rule check helpers — each takes the receipt, tolerance policy, the
// failures accumulator, and (when relevant) the cascade-state helpers.
// Helpers push directly into `failures` and `failuresByParam` via callbacks
// rather than returning arrays so the caller's traversal order is preserved
// exactly.
//
// Every rule routes its numeric check through `applyToleranceCheck` (v0.3
// migration). The reported `tolerance` on each failure is the EFFECTIVE
// threshold (`max(atol, rtol * max(|a|, |b|))`) so failure reports stay
// informative for both the scalar (v0.1/v0.2) and object (v0.3+) policy
// shapes.
// ============================================================================

/**
 * Build the developer-facing message string for a non-finite arithmetic
 * failure. Centralized so every rule emits the same wording for the
 * same failure mode.
 */
function nonFiniteMessage(rule: number, fieldPath: string, recomputed: number, stored: number): string {
  return (
    `Non-finite arithmetic detected at ${fieldPath} (Rule ${rule}): ` +
    `recomputed=${String(recomputed)}, stored=${String(stored)}. ` +
    `Check upstream factors for NaN/Infinity.`
  )
}

/**
 * Rule 0 (structural): receipt-internal cross-consistency checks that catch
 * contradictions BEFORE numeric reconciliation. Wired in v0.4.1 to close the
 * gap surfaced by v0.4's xor.bad-bias-mode-mismatch fixture.
 *
 * Checks (each gracefully no-ops when the relevant v0.2+ fields are absent,
 * so v0.1 Mazur receipts pass through cleanly):
 *
 *   0a. bias_policy.mode === "constant" but updates[] contains kind:"bias"
 *       — the policy declares biases never change, but the receipt has
 *       bias-update entries. Closes xor.bad-bias-mode-mismatch.
 *
 *   0b. bias_policy.mode === "constant" but a bias parameter's
 *       parameters_after value differs from parameters_before — same
 *       contradiction, observed at the final-state side.
 *
 *   0c. bias_policy.mode === "sgd" but the topology declares bias
 *       parameters AND updates[] contains zero kind:"bias" entries — the
 *       policy declares SGD on biases, but no bias updates were emitted.
 *
 *   0d. bias_sharing === "per_neuron" but a bias parameter's
 *       applies_to_units has length != 1 — per-neuron biases serve exactly
 *       one unit each.
 *
 *   0e. bias_sharing === "per_layer" but a bias parameter's
 *       applies_to_units length != the corresponding layer size — per-layer
 *       biases must serve every unit in their layer.
 *
 *   0f. Update.kind mismatches its parameter's role (bias kind on a weight
 *       parameter, or weight kind on a bias parameter).
 *
 *   0g. topology.{input,hidden,output}_size doesn't match
 *       unit_order.{input,hidden,output}.length.
 *
 * For all sub-checks: rule: 0, field_path identifies the contradicting
 * field, message explains the contradiction in plain English with a
 * remediation pointer.
 */
function checkRule0Structural(
  r: Receipt,
  failures: ReconciliationFailure[],
): void {
  const bp = r.bias_policy
  const topo = r.topology

  // 0a. constant mode + bias updates -----------------------------------
  if (bp?.mode === "constant" && Array.isArray(r.updates)) {
    for (let i = 0; i < r.updates.length; i++) {
      const u = r.updates[i]
      if (u && u.kind === "bias") {
        failures.push({
          rule: 0,
          parameter_id: u.parameter_id,
          field_path: `updates[${i}].kind`,
          stored: 0,
          recomputed: 0,
          delta: 0,
          tolerance: 0,
          message:
            `bias_policy.mode='constant' contradicts updates[${i}].kind='bias' on ` +
            `parameter '${u.parameter_id}'. Under mode='constant' the engine emits no ` +
            `bias-update entries (biases stay fixed). Either set bias_policy.mode='sgd' ` +
            `or remove the bias updates and restore bias parameters_after to equal ` +
            `parameters_before.`,
        })
      }
    }
  }

  // 0b. constant mode + bias parameters drifted ------------------------
  if (
    bp?.mode === "constant" &&
    topo?.parameters &&
    r.parameters_before &&
    r.parameters_after
  ) {
    for (const param of topo.parameters) {
      if (param.role === "hidden_bias" || param.role === "output_bias") {
        const before = r.parameters_before[param.id]
        const after = r.parameters_after[param.id]
        if (
          typeof before === "number" &&
          typeof after === "number" &&
          before !== after
        ) {
          failures.push({
            rule: 0,
            parameter_id: param.id,
            field_path: `parameters_after.${param.id}`,
            stored: after,
            recomputed: before,
            delta: Math.abs(after - before),
            tolerance: 0,
            message:
              `bias_policy.mode='constant' contradicts parameters_after.${param.id} ` +
              `(${after}) != parameters_before.${param.id} (${before}). Under ` +
              `mode='constant', bias parameters must be exactly equal across the step ` +
              `(tolerance=0). Either set bias_policy.mode='sgd' or restore the bias ` +
              `value.`,
          })
        }
      }
    }
  }

  // 0c. sgd mode + bias parameters declared + no bias updates ----------
  if (bp?.mode === "sgd" && topo?.parameters && Array.isArray(r.updates)) {
    const declaredBiasIds = new Set(
      topo.parameters
        .filter((p) => p.role === "hidden_bias" || p.role === "output_bias")
        .map((p) => p.id),
    )
    if (declaredBiasIds.size > 0) {
      const updatedBiasIds = new Set(
        r.updates.filter((u) => u?.kind === "bias").map((u) => u.parameter_id),
      )
      const missing: string[] = []
      for (const id of declaredBiasIds) {
        if (!updatedBiasIds.has(id)) missing.push(id)
      }
      if (missing.length > 0) {
        failures.push({
          rule: 0,
          field_path: "bias_policy.mode",
          stored: 0,
          recomputed: 0,
          delta: 0,
          tolerance: 0,
          message:
            `bias_policy.mode='sgd' declares biases are updated, but updates[] ` +
            `contains zero kind='bias' entries for declared bias parameter(s): ` +
            `${missing.join(", ")}. Either emit bias update entries or set ` +
            `bias_policy.mode='constant'.`,
        })
      }
    }
  }

  // 0d + 0e. bias_sharing vs applies_to_units length -------------------
  if (
    topo?.bias_sharing &&
    topo.parameters &&
    topo.unit_order
  ) {
    for (const param of topo.parameters) {
      if (param.role !== "hidden_bias" && param.role !== "output_bias") continue
      const layer =
        param.role === "hidden_bias"
          ? topo.unit_order.hidden
          : topo.unit_order.output
      if (!Array.isArray(layer) || !Array.isArray(param.applies_to_units)) continue
      const actual = param.applies_to_units.length
      const expected = topo.bias_sharing === "per_layer" ? layer.length : 1
      if (actual !== expected) {
        failures.push({
          rule: 0,
          parameter_id: param.id,
          field_path: `topology.parameters[id=${param.id}].applies_to_units`,
          stored: actual,
          recomputed: expected,
          delta: Math.abs(actual - expected),
          tolerance: 0,
          message:
            `topology.bias_sharing='${topo.bias_sharing}' implies bias parameter ` +
            `'${param.id}' should have applies_to_units.length === ${expected} ` +
            `(${topo.bias_sharing === "per_layer" ? "the entire layer" : "exactly one unit"}), ` +
            `got ${actual}. Either set bias_sharing='${topo.bias_sharing === "per_layer" ? "per_neuron" : "per_layer"}' ` +
            `or restructure applies_to_units to match the declared mode.`,
        })
      }
    }
  }

  // 0f. Update.kind vs parameter role ----------------------------------
  if (topo?.parameters && Array.isArray(r.updates)) {
    const roleById = new Map<string, TopologyParameter["role"]>()
    for (const p of topo.parameters) roleById.set(p.id, p.role)
    for (let i = 0; i < r.updates.length; i++) {
      const u = r.updates[i]
      if (!u) continue
      const role = roleById.get(u.parameter_id)
      if (role === undefined) continue // schema validation should have caught this
      const isBiasRole = role === "hidden_bias" || role === "output_bias"
      const isBiasKind = u.kind === "bias"
      if (u.kind !== undefined && isBiasRole !== isBiasKind) {
        failures.push({
          rule: 0,
          parameter_id: u.parameter_id,
          field_path: `updates[${i}].kind`,
          stored: 0,
          recomputed: 0,
          delta: 0,
          tolerance: 0,
          message:
            `updates[${i}].kind='${u.kind}' contradicts topology.parameters[id=${u.parameter_id}].role='${role}'. ` +
            `${isBiasRole ? "Bias-role parameters require kind='bias'" : "Weight-role parameters require kind='weight'"}. ` +
            `Either correct the update's kind or fix the parameter's role declaration.`,
        })
      }
    }
  }

  // 0.8 (v0.5). Softmax probability bounds: when topology.activation_output
  // === "softmax", each forward[output_unit].out MUST be in the inclusive
  // range [0, 1]. Softmax outputs are probabilities by construction; a
  // value outside [0, 1] is a structural impossibility for a valid receipt
  // (either a corrupted forward.out or a topology mislabeled as softmax).
  //
  // Numbered as "0.8" in docs/reconciliation.md to communicate "this is a
  // STRUCTURAL bound that precedes the numeric rules" — the failure record
  // uses rule: 0 (the structural sentinel) with the message naming "Rule
  // 0.8" so the doctrine ratchet test (which scans integer rule numbers)
  // continues to work unchanged.
  //
  // Inclusive bounds: we use [0, 1] strictly (with a small floating-point
  // slack via the numeric_policy tolerance) because the engine's softmaxVector
  // is bounded by construction within FP precision. A value of -0 or 1+ULP
  // is a Rule 0.8 violation only if it exceeds the receipt's atol.
  if (
    topo?.activation_output === "softmax" &&
    topo.unit_order &&
    Array.isArray(topo.unit_order.output) &&
    r.forward
  ) {
    // For bounds, use the receipt's atol as a one-sided slack. The hybrid
    // tolerance form (atol + rtol*max(|a|,|b|)) does not naturally express
    // "x in [a, b] within slack"; we use the atol component only here,
    // matching the convention that bounds checks are absolute-tolerance only.
    const { atol } = normalizeTolerance(r.numeric_policy.tolerance)
    for (const oUnit of topo.unit_order.output) {
      const f = r.forward[oUnit]
      if (!f || typeof f.out !== "number") continue
      const out = f.out
      if (!Number.isFinite(out)) {
        failures.push({
          rule: 0,
          parameter_id: oUnit,
          field_path: `forward.${oUnit}.out`,
          stored: out,
          recomputed: 0,
          delta: Number.NaN,
          tolerance: 0,
          message:
            `Rule 0.8 (probability bounds): forward.${oUnit}.out is non-finite (${String(out)}). ` +
            `Under topology.activation_output='softmax' every output's .out must be a finite ` +
            `number in the closed range [0, 1].`,
        })
        continue
      }
      if (out < -atol || out > 1 + atol) {
        failures.push({
          rule: 0,
          parameter_id: oUnit,
          field_path: `forward.${oUnit}.out`,
          stored: out,
          recomputed: 0,
          delta: out < 0 ? -out : out - 1,
          tolerance: atol,
          message:
            `Rule 0.8 (probability bounds): forward.${oUnit}.out=${out} is outside [0, 1] ` +
            `(atol=${atol}). Softmax outputs are probabilities by construction; a value ` +
            `outside [0, 1] is either a corrupted forward.out or a topology mislabeled as softmax.`,
        })
      }
    }
  }

  // 0g. topology sizes vs unit_order lengths ---------------------------
  if (topo?.unit_order) {
    const checks: Array<{
      side: "input" | "hidden" | "output"
      declared: number | undefined
      actual: number | undefined
    }> = [
      { side: "input", declared: topo.input_size, actual: topo.unit_order.input?.length },
      { side: "hidden", declared: topo.hidden_size, actual: topo.unit_order.hidden?.length },
      { side: "output", declared: topo.output_size, actual: topo.unit_order.output?.length },
    ]
    for (const c of checks) {
      if (
        typeof c.declared === "number" &&
        typeof c.actual === "number" &&
        c.declared !== c.actual
      ) {
        failures.push({
          rule: 0,
          field_path: `topology.${c.side}_size`,
          stored: c.declared,
          recomputed: c.actual,
          delta: Math.abs(c.declared - c.actual),
          tolerance: 0,
          message:
            `topology.${c.side}_size=${c.declared} contradicts topology.unit_order.${c.side}.length=${c.actual}. ` +
            `These must match: the declared size is the count of unit ids in the layer.`,
        })
      }
    }
  }
}

function checkRule1(
  r: Receipt,
  tolerance: TolerancePolicy,
  failures: ReconciliationFailure[],
  recordFailure: (rule: number, parameter_id: string | undefined) => void,
): void {
  const signals = r.backward?.output_error_signals
  if (!signals || typeof signals !== "object") return
  for (const unitId of Object.keys(signals)) {
    const unit = signals[unitId]
    if (!unit || typeof unit !== "object") continue
    if (unit.product_order !== "left_to_right") {
      failures.push({
        rule: 0,
        parameter_id: unitId,
        field_path: `backward.output_error_signals.${unitId}.product_order`,
        stored: 0,
        recomputed: 0,
        delta: 0,
        tolerance: 0,
        message:
          `Unsupported product_order ${JSON.stringify(unit.product_order)} at ` +
          `backward.output_error_signals.${unitId}.product_order. v0.3 reconciler accepts only ` +
          `'left_to_right' (see docs/reconciliation.md and docs/computation-order.md).`,
      })
      continue
    }
    const factors = unit.factors
    // E-A-012 (v0.4): defense-in-depth length check. Schema guarantees
    // minItems >= 1 on factors in v0.4 (relaxed from 2 to support per-neuron
    // bias single-factor products); reject only the genuinely-empty case so
    // a malformed receipt that reaches this point surfaces as a Rule-0
    // failure instead of an out-of-bounds factors[0]! access in
    // multiplyFactorsLeftToRight.
    if (!Array.isArray(factors) || factors.length < 1) {
      failures.push({
        rule: 0,
        parameter_id: unitId,
        field_path: `backward.output_error_signals.${unitId}.factors`,
        stored: 0,
        recomputed: 0,
        delta: 0,
        tolerance: 0,
        message:
          `backward.output_error_signals.${unitId}.factors has ` +
          (Array.isArray(factors) ? `${factors.length} entries` : `non-array type ${typeof factors}`) +
          `. v0.4 receipts require >= 1 factor per output error signal (schema minItems: 1 — relaxed from v0.3's 2 to support per-neuron bias).`,
      })
      continue
    }
    const product = multiplyFactorsLeftToRight(factors)
    const stored = unit.signal_value
    const fieldPath = `backward.output_error_signals.${unitId}.signal_value`
    const check = applyToleranceCheck(product, stored, tolerance)
    if (!check.isFinite) {
      failures.push({
        rule: 1,
        parameter_id: unitId,
        field_path: fieldPath,
        stored,
        recomputed: product,
        delta: Number.NaN,
        tolerance: 0,
        factors: factors as NamedFactor[],
        product_order: "left_to_right",
        message: nonFiniteMessage(1, fieldPath, product, stored),
      })
      recordFailure(1, unitId)
      continue
    }
    if (!check.ok) {
      failures.push({
        rule: 1,
        parameter_id: unitId,
        field_path: fieldPath,
        stored,
        recomputed: product,
        delta: check.delta,
        tolerance: check.appliedTolerance,
        factors: factors as NamedFactor[],
        product_order: "left_to_right",
      })
      recordFailure(1, unitId)
    }
  }
}

function checkRule2(
  r: Receipt,
  tolerance: TolerancePolicy,
  failures: ReconciliationFailure[],
  recordFailure: (rule: number, parameter_id: string | undefined) => void,
): void {
  const signals = r.backward?.hidden_error_signals
  if (!signals || typeof signals !== "object") return
  for (const unitId of Object.keys(signals)) {
    const unit = signals[unitId]
    if (!unit || typeof unit !== "object") continue
    const contribs = unit.downstream_contributions
    if (!Array.isArray(contribs)) {
      failures.push({
        rule: 0,
        parameter_id: unitId,
        field_path: `backward.hidden_error_signals.${unitId}.downstream_contributions`,
        stored: 0,
        recomputed: 0,
        delta: 0,
        tolerance: 0,
        message:
          `backward.hidden_error_signals.${unitId}.downstream_contributions is not an array ` +
          `(got ${typeof contribs}). v0.3 receipts require an array of contribution records.`,
      })
      continue
    }
    // Rule 2a: each contribution.value == downstream_signal * weight_value.
    for (let j = 0; j < contribs.length; j++) {
      const c = contribs[j]!
      const product = c.downstream_signal * c.weight_value
      const stored = c.value
      const fieldPath = `backward.hidden_error_signals.${unitId}.downstream_contributions[${j}].value`
      const check = applyToleranceCheck(product, stored, tolerance)
      if (!check.isFinite) {
        failures.push({
          rule: 2,
          parameter_id: unitId,
          field_path: fieldPath,
          stored,
          recomputed: product,
          delta: Number.NaN,
          tolerance: 0,
          message: nonFiniteMessage(2, fieldPath, product, stored),
        })
        recordFailure(2, unitId)
        continue
      }
      if (!check.ok) {
        failures.push({
          rule: 2,
          parameter_id: unitId,
          field_path: fieldPath,
          stored,
          recomputed: product,
          delta: check.delta,
          tolerance: check.appliedTolerance,
        })
        recordFailure(2, unitId)
      }
    }
    // Rule 2b: backpropagated_sum == sum(contributions in summation_order).
    const order = unit.summation_order
    if (!Array.isArray(order)) {
      failures.push({
        rule: 0,
        parameter_id: unitId,
        field_path: `backward.hidden_error_signals.${unitId}.summation_order`,
        stored: 0,
        recomputed: 0,
        delta: 0,
        tolerance: 0,
        message:
          `backward.hidden_error_signals.${unitId}.summation_order is not an array ` +
          `(got ${typeof order}). v0.3 receipts require a declared summation_order.`,
      })
      continue
    }
    const sum = sumInOrder(contribs, order, (c) => c.from, (c) => c.value)
    const storedSum = unit.backpropagated_sum
    const fieldPath2 = `backward.hidden_error_signals.${unitId}.backpropagated_sum`
    const check2 = applyToleranceCheck(sum, storedSum, tolerance)
    if (!check2.isFinite) {
      failures.push({
        rule: 2,
        parameter_id: unitId,
        field_path: fieldPath2,
        stored: storedSum,
        recomputed: sum,
        delta: Number.NaN,
        tolerance: 0,
        message: nonFiniteMessage(2, fieldPath2, sum, storedSum),
      })
      recordFailure(2, unitId)
      continue
    }
    if (!check2.ok) {
      failures.push({
        rule: 2,
        parameter_id: unitId,
        field_path: fieldPath2,
        stored: storedSum,
        recomputed: sum,
        delta: check2.delta,
        tolerance: check2.appliedTolerance,
      })
      recordFailure(2, unitId)
    }
  }
}

function checkRule3(
  r: Receipt,
  tolerance: TolerancePolicy,
  failures: ReconciliationFailure[],
  recordFailure: (rule: number, parameter_id: string | undefined) => void,
): void {
  const signals = r.backward?.hidden_error_signals
  if (!signals || typeof signals !== "object") return
  for (const unitId of Object.keys(signals)) {
    const unit = signals[unitId]
    if (!unit || typeof unit !== "object") continue
    if (unit.product_order !== "left_to_right") {
      failures.push({
        rule: 0,
        parameter_id: unitId,
        field_path: `backward.hidden_error_signals.${unitId}.product_order`,
        stored: 0,
        recomputed: 0,
        delta: 0,
        tolerance: 0,
        message:
          `Unsupported product_order ${JSON.stringify(unit.product_order)} at ` +
          `backward.hidden_error_signals.${unitId}.product_order. v0.3 reconciler accepts only ` +
          `'left_to_right' (see docs/reconciliation.md and docs/computation-order.md).`,
      })
      continue
    }
    const bp = unit.backpropagated_sum
    const ad = unit.activation_derivative
    // Rule 3 uses the same multiplyFactorsLeftToRight primitive for
    // consistency with Rules 1 and 4 — the operand decomposition then
    // matches the canonical docs-style factors block.
    const operands: NamedFactor[] = [
      { name: "backpropagated_sum", value: bp },
      { name: "activation_derivative", value: ad },
    ]
    const product = multiplyFactorsLeftToRight(operands)
    const stored = unit.signal_value
    const fieldPath = `backward.hidden_error_signals.${unitId}.signal_value`
    const check = applyToleranceCheck(product, stored, tolerance)
    if (!check.isFinite) {
      failures.push({
        rule: 3,
        parameter_id: unitId,
        field_path: fieldPath,
        stored,
        recomputed: product,
        delta: Number.NaN,
        tolerance: 0,
        factors: operands,
        product_order: "left_to_right",
        message: nonFiniteMessage(3, fieldPath, product, stored),
      })
      recordFailure(3, unitId)
      continue
    }
    if (!check.ok) {
      failures.push({
        rule: 3,
        parameter_id: unitId,
        field_path: fieldPath,
        stored,
        recomputed: product,
        delta: check.delta,
        tolerance: check.appliedTolerance,
        factors: operands,
        product_order: "left_to_right",
      })
      recordFailure(3, unitId)
    }
  }
}

function checkRule4(
  r: Receipt,
  tolerance: TolerancePolicy,
  failures: ReconciliationFailure[],
  recordFailure: (rule: number, parameter_id: string | undefined) => void,
): void {
  for (let i = 0; i < r.updates.length; i++) {
    const update = r.updates[i]!
    if (update.optimizer.product_order !== "left_to_right") {
      // E-A-003: unsupported product_order is reported as a typed Rule-0
      // failure rather than thrown, so callers see it in the same stream
      // as math failures.
      failures.push({
        rule: 0,
        parameter_id: update.parameter_id,
        field_path: `updates[${i}].optimizer.product_order`,
        stored: 0,
        recomputed: 0,
        delta: 0,
        tolerance: 0,
        message:
          `Unsupported product_order ${JSON.stringify(update.optimizer.product_order)} at ` +
          `updates[${i}].optimizer.product_order. v0.3 reconciler accepts only 'left_to_right' ` +
          `(see docs/reconciliation.md and docs/computation-order.md).`,
      })
      continue
    }
    const factors = update.optimizer.factors
    // E-A-012 (v0.4): defense-in-depth length check. Schema guarantees
    // minItems >= 1 on factors in v0.4 (relaxed from 2 to support per-neuron
    // bias single-factor SGD updates — gradient = signal_u for the bias
    // parameter). Reject only the genuinely-empty case; a single-factor
    // array is multiplied correctly by multiplyFactorsLeftToRight (which
    // returns factors[0].value when the array has one entry).
    if (!Array.isArray(factors) || factors.length < 1) {
      failures.push({
        rule: 0,
        parameter_id: update.parameter_id,
        field_path: `updates[${i}].optimizer.factors`,
        stored: 0,
        recomputed: 0,
        delta: 0,
        tolerance: 0,
        message:
          `updates[${i}].optimizer.factors has ` +
          (Array.isArray(factors) ? `${factors.length} entries` : `non-array type ${typeof factors}`) +
          `. v0.4 receipts require >= 1 factor per optimizer (schema minItems: 1 — relaxed from v0.3's 2 to support per-neuron bias).`,
      })
      continue
    }
    // E-A-008: factor multiplication is delegated to the exported helper
    // so the order is named (multiplyFactorsLeftToRight) rather than
    // implicit, and tests can compare it against multiplyFactorsRightToLeft
    // to prove product_order is load-bearing.
    const product = multiplyFactorsLeftToRight(factors)
    const stored = update.gradient
    const fieldPath = `updates[${i}].gradient`
    // E-A-001: NaN-poisoning guard. applyToleranceCheck returns
    // isFinite: false when either input or the computed delta is
    // non-finite, so a non-finite product or stored gradient surfaces as
    // a Rule 4 failure with delta: NaN (never a silent pass).
    const check = applyToleranceCheck(product, stored, tolerance)
    if (!check.isFinite) {
      failures.push({
        rule: 4,
        parameter_id: update.parameter_id,
        field_path: fieldPath,
        stored,
        recomputed: product,
        delta: Number.NaN,
        tolerance: 0,
        factors: factors as NamedFactor[],
        product_order: "left_to_right",
        message: nonFiniteMessage(4, fieldPath, product, stored),
      })
      recordFailure(4, update.parameter_id)
      continue
    }
    if (!check.ok) {
      failures.push({
        rule: 4,
        parameter_id: update.parameter_id,
        field_path: fieldPath,
        stored,
        recomputed: product,
        delta: check.delta,
        tolerance: check.appliedTolerance,
        factors: factors as NamedFactor[],
        product_order: "left_to_right",
      })
      recordFailure(4, update.parameter_id)
    }
  }
}

function checkRule5(
  r: Receipt,
  tolerance: TolerancePolicy,
  failures: ReconciliationFailure[],
  recordFailure: (rule: number, parameter_id: string | undefined) => void,
  priorFailureRule: (parameter_id: string | undefined, candidates: readonly number[]) => number | undefined,
): void {
  for (let i = 0; i < r.updates.length; i++) {
    const update = r.updates[i]!
    // Rule 5 uses STORED gradient and STORED learning_rate so each rule
    // has independent attribution — a Rule 4 failure does not silently
    // change Rule 5's recomputed value. Cascade detection labels the
    // root cause via cascade_of_rule.
    const lr = update.optimizer.learning_rate
    const grad = update.gradient
    const recomputed = lr * grad
    const stored = update.update
    const fieldPath = `updates[${i}].update`
    const check = applyToleranceCheck(recomputed, stored, tolerance)
    if (!check.isFinite) {
      const cascade = priorFailureRule(update.parameter_id, [4])
      const fail: ReconciliationFailure = {
        rule: 5,
        parameter_id: update.parameter_id,
        field_path: fieldPath,
        stored,
        recomputed,
        delta: Number.NaN,
        tolerance: 0,
        message: nonFiniteMessage(5, fieldPath, recomputed, stored),
      }
      if (cascade !== undefined) fail.cascade_of_rule = cascade
      failures.push(fail)
      recordFailure(5, update.parameter_id)
      continue
    }
    if (!check.ok) {
      const cascade = priorFailureRule(update.parameter_id, [4])
      const fail: ReconciliationFailure = {
        rule: 5,
        parameter_id: update.parameter_id,
        field_path: fieldPath,
        stored,
        recomputed,
        delta: check.delta,
        tolerance: check.appliedTolerance,
      }
      if (cascade !== undefined) fail.cascade_of_rule = cascade
      failures.push(fail)
      recordFailure(5, update.parameter_id)
    }
  }
}

function checkRule6(
  r: Receipt,
  tolerance: TolerancePolicy,
  failures: ReconciliationFailure[],
  recordFailure: (rule: number, parameter_id: string | undefined) => void,
  priorFailureRule: (parameter_id: string | undefined, candidates: readonly number[]) => number | undefined,
): void {
  for (let i = 0; i < r.updates.length; i++) {
    const update = r.updates[i]!
    const before = update.weight_before
    const upd = update.update
    const recomputed = before + upd
    const stored = update.weight_after
    const fieldPath = `updates[${i}].weight_after`
    const check = applyToleranceCheck(recomputed, stored, tolerance)
    if (!check.isFinite) {
      const cascade = priorFailureRule(update.parameter_id, [4, 5])
      const fail: ReconciliationFailure = {
        rule: 6,
        parameter_id: update.parameter_id,
        field_path: fieldPath,
        stored,
        recomputed,
        delta: Number.NaN,
        tolerance: 0,
        message: nonFiniteMessage(6, fieldPath, recomputed, stored),
      }
      if (cascade !== undefined) fail.cascade_of_rule = cascade
      failures.push(fail)
      recordFailure(6, update.parameter_id)
      continue
    }
    if (!check.ok) {
      const cascade = priorFailureRule(update.parameter_id, [4, 5])
      const fail: ReconciliationFailure = {
        rule: 6,
        parameter_id: update.parameter_id,
        field_path: fieldPath,
        stored,
        recomputed,
        delta: check.delta,
        tolerance: check.appliedTolerance,
      }
      if (cascade !== undefined) fail.cascade_of_rule = cascade
      failures.push(fail)
      recordFailure(6, update.parameter_id)
    }
  }
}

function checkRule7(
  r: Receipt,
  tolerance: TolerancePolicy,
  failures: ReconciliationFailure[],
  recordFailure: (rule: number, parameter_id: string | undefined) => void,
  priorFailureRule: (parameter_id: string | undefined, candidates: readonly number[]) => number | undefined,
): void {
  const after = r.parameters_after
  const before = r.parameters_before
  if (!after || typeof after !== "object") return
  if (!before || typeof before !== "object") return
  // Build update lookup by parameter_id. v0.2 supports at most one update
  // per parameter (single-step SGD); v0.3+ multi-step will require summing.
  const updatesById = new Map<string, Update>()
  for (const u of r.updates) {
    updatesById.set(u.parameter_id, u)
  }
  const biasMode = r.bias_policy?.mode

  // Iterate deterministically in parameters_after key order.
  for (const paramId of Object.keys(after)) {
    const storedAfter = after[paramId]
    const beforeVal = before[paramId]
    if (typeof storedAfter !== "number") {
      failures.push({
        rule: 0,
        parameter_id: paramId,
        field_path: `parameters_after.${paramId}`,
        stored: 0,
        recomputed: 0,
        delta: 0,
        tolerance: 0,
        message:
          `parameters_after.${paramId} is not a number (got ${typeof storedAfter}). ` +
          `Run schema validation against schemas/receipt.v0.1.0.json or v0.2.0.json before reconciling.`,
      })
      continue
    }
    if (typeof beforeVal !== "number") {
      failures.push({
        rule: 0,
        parameter_id: paramId,
        field_path: `parameters_before.${paramId}`,
        stored: 0,
        recomputed: 0,
        delta: 0,
        tolerance: 0,
        message:
          `parameters_before.${paramId} is missing or not a number (got ${typeof beforeVal}). ` +
          `Cannot reconcile parameters_after.${paramId} without it.`,
      })
      continue
    }
    const u = updatesById.get(paramId)
    if (u !== undefined) {
      // Updated parameter: stored == before + stored update (use STORED
      // update so each rule attributes independently; cascade names Rule 4/5/6
      // if any fired first on this parameter).
      const recomputed = beforeVal + u.update
      const fieldPath = `parameters_after.${paramId}`
      const check = applyToleranceCheck(recomputed, storedAfter, tolerance)
      if (!check.isFinite) {
        const cascade = priorFailureRule(paramId, [4, 5, 6])
        const fail: ReconciliationFailure = {
          rule: 7,
          parameter_id: paramId,
          field_path: fieldPath,
          stored: storedAfter,
          recomputed,
          delta: Number.NaN,
          tolerance: 0,
          message: nonFiniteMessage(7, fieldPath, recomputed, storedAfter),
        }
        if (cascade !== undefined) fail.cascade_of_rule = cascade
        failures.push(fail)
        recordFailure(7, paramId)
        continue
      }
      if (!check.ok) {
        const cascade = priorFailureRule(paramId, [4, 5, 6])
        const fail: ReconciliationFailure = {
          rule: 7,
          parameter_id: paramId,
          field_path: fieldPath,
          stored: storedAfter,
          recomputed,
          delta: check.delta,
          tolerance: check.appliedTolerance,
        }
        if (cascade !== undefined) fail.cascade_of_rule = cascade
        failures.push(fail)
        recordFailure(7, paramId)
      }
    } else {
      // Parameter not in updates. Branch on bias_policy.mode:
      //   - "constant": parameters_after[id] === parameters_before[id]
      //     EXACTLY (zero-delta requirement; tolerance does not apply).
      //   - anything else: underdetermined — refuse to certify (Rule 0).
      if (biasMode === "constant") {
        if (storedAfter !== beforeVal) {
          failures.push({
            rule: 7,
            parameter_id: paramId,
            field_path: `parameters_after.${paramId}`,
            stored: storedAfter,
            recomputed: beforeVal,
            // For zero-delta failures, the "delta" is just the difference;
            // tolerance is meaningfully zero (no slack permitted).
            delta: Math.abs(storedAfter - beforeVal),
            tolerance: 0,
          })
          recordFailure(7, paramId)
        }
      } else {
        failures.push({
          rule: 0,
          parameter_id: paramId,
          field_path: `parameters_after.${paramId}`,
          stored: 0,
          recomputed: 0,
          delta: 0,
          tolerance: 0,
          message:
            `Underdetermined: parameter not in updates and bias_policy.mode is not 'constant' ` +
            `(got '${biasMode ?? "undefined"}'). v0.3 reconciler cannot certify this combination.`,
        })
      }
    }
  }
}

function checkRule8(
  r: Receipt,
  tolerance: TolerancePolicy,
  failures: ReconciliationFailure[],
): void {
  // Walk every NamedFactor with a `from` field that looks like a path.
  // Per docs/reconciliation.md, the NamedFactor sites are:
  //   - backward.output_error_signals[*].factors[*]
  //   - updates[*].optimizer.factors[*]
  // The downstream_contributions[*].from on hidden_error_signals is a
  // UNIT NAME (e.g. "o1"), not a path, so v0.2 skips provenance checks
  // there. (The contribution's value provenance is implicitly checked by
  // Rule 2a — contribution.value == downstream_signal * weight_value.)
  const outputSignals = r.backward?.output_error_signals
  if (outputSignals && typeof outputSignals === "object") {
    for (const unitId of Object.keys(outputSignals)) {
      const unit = outputSignals[unitId]
      if (!unit || typeof unit !== "object") continue
      const factors = unit.factors
      if (!Array.isArray(factors)) continue
      for (let j = 0; j < factors.length; j++) {
        const f = factors[j]!
        if (typeof f.from !== "string" || f.from.length === 0) continue
        const fieldPath = `backward.output_error_signals.${unitId}.factors[${j}].value`
        rule8CheckOne(r, f, fieldPath, unitId, tolerance, failures)
      }
    }
  }
  for (let i = 0; i < r.updates.length; i++) {
    const update = r.updates[i]!
    const factors = update.optimizer?.factors
    if (!Array.isArray(factors)) continue
    for (let j = 0; j < factors.length; j++) {
      const f = factors[j]!
      if (typeof f.from !== "string" || f.from.length === 0) continue
      const fieldPath = `updates[${i}].optimizer.factors[${j}].value`
      rule8CheckOne(r, f, fieldPath, update.parameter_id, tolerance, failures)
    }
  }
}

function rule8CheckOne(
  r: Receipt,
  factor: Factor,
  factorPath: string,
  parameter_id: string | undefined,
  tolerance: TolerancePolicy,
  failures: ReconciliationFailure[],
): void {
  // Rule 8 names the provenance path (factor.from) as the field_path on
  // failure — the failure is "this factor claims to mirror that path, but
  // doesn't." `factorPath` (the factor's own location in the receipt) is
  // recorded in the `message` so callers can locate the source factor too,
  // but the load-bearing identifier for Rule 8 is the from-path: a
  // downstream tool aggregating provenance failures groups by the path
  // being referenced, not by every consumer site.
  const fromPath = factor.from!
  const resolved = resolvePath(r, fromPath)
  if (!resolved.found) {
    failures.push({
      rule: 8,
      parameter_id,
      field_path: fromPath,
      stored: factor.value,
      recomputed: Number.NaN,
      delta: Number.NaN,
      tolerance: 0,
      message:
        `Provenance path ${JSON.stringify(fromPath)} could not be resolved (referenced from ${factorPath}): ${resolved.reason}.`,
    })
    return
  }
  const stored = factor.value
  const recomputed = resolved.value
  const check = applyToleranceCheck(recomputed, stored, tolerance)
  if (!check.isFinite) {
    failures.push({
      rule: 8,
      parameter_id,
      field_path: fromPath,
      stored,
      recomputed,
      delta: Number.NaN,
      tolerance: 0,
      message: nonFiniteMessage(8, fromPath, recomputed, stored),
    })
    return
  }
  if (!check.ok) {
    failures.push({
      rule: 8,
      parameter_id,
      field_path: fromPath,
      stored,
      recomputed,
      delta: check.delta,
      tolerance: check.appliedTolerance,
    })
  }
}

// ============================================================================
// v0.3 multi-step rules: Rule 9 (parameter chain) + Rule 10 (trace identity).
// These fire from reconcileMultiStep against a sequence of receipts in a
// training run. They are NOT run by reconcileReceipt — single-receipt verify
// paths skip them so `bp verify mazur` / `bp verify general` are not muddied
// with multi-step assertions that don't apply.
// ============================================================================

/**
 * Rule 9: Multi-step parameter chain.
 *
 * For receipt at `step_index = N` (N > 0), `parameters_before` MUST equal
 * the PRIOR receipt's `parameters_after` (within the receipt's
 * `numeric_policy.tolerance`).
 *
 * Single-step receipts (`step_index = 0` or absent) SKIP this rule — chain
 * integrity is only defined across step boundaries.
 *
 * Called by `reconcileMultiStep(receipts)` — NOT by `reconcileReceipt()`
 * which works on one receipt at a time. The caller passes adjacent pairs:
 * `checkRule9(receipts[i], receipts[i-1], policy)` for i in [1, N).
 *
 * @param current   The current step's receipt (with `parameters_before`).
 * @param prior     The prior step's receipt (with `parameters_after`).
 * @param tolerance The tolerance policy from the CURRENT receipt's
 *                  `numeric_policy.tolerance`. Multi-step receipts inherit
 *                  the per-receipt policy — there is no separate
 *                  cross-step tolerance.
 * @returns         Zero or more failures (one per parameter that
 *                  disagrees beyond tolerance). Returns an empty array
 *                  when the chain is intact.
 */
export function checkRule9(
  current: unknown,
  prior: unknown,
  tolerance: TolerancePolicy,
): ReconciliationFailure[] {
  const failures: ReconciliationFailure[] = []
  if (current === null || typeof current !== "object") return failures
  if (prior === null || typeof prior !== "object") return failures
  const cur = current as { parameters_before?: Record<string, number> }
  const prv = prior as { parameters_after?: Record<string, number> }
  if (!cur.parameters_before || typeof cur.parameters_before !== "object") return failures
  if (!prv.parameters_after || typeof prv.parameters_after !== "object") return failures
  for (const paramId of Object.keys(cur.parameters_before)) {
    const before = cur.parameters_before[paramId]
    const after = prv.parameters_after[paramId]
    // Defense-in-depth: skip parameters that aren't present in both sides
    // as numbers — schema validation should catch this upstream, but a
    // malformed receipt that reaches Rule 9 shouldn't crash the run.
    if (typeof before !== "number" || typeof after !== "number") continue
    const check = applyToleranceCheck(before, after, tolerance)
    if (!check.isFinite) {
      failures.push({
        rule: 9,
        parameter_id: paramId,
        field_path: `parameters_before.${paramId}`,
        stored: before,
        recomputed: after,
        delta: Number.NaN,
        tolerance: 0,
        message:
          `Multi-step chain non-finite value at parameters_before.${paramId}: ` +
          `before=${String(before)}, prior parameters_after=${String(after)}. ` +
          `Check upstream factors for NaN/Infinity.`,
      })
      continue
    }
    if (!check.ok) {
      failures.push({
        rule: 9,
        parameter_id: paramId,
        field_path: `parameters_before.${paramId}`,
        stored: before,
        // "recomputed" here = "value from prior step's parameters_after";
        // the field name keeps the quartet shape uniform across rules so
        // the CLI can render every failure with one template.
        recomputed: after,
        delta: check.delta,
        tolerance: check.appliedTolerance,
        message:
          `Multi-step chain violation: parameters_before.${paramId} ` +
          `disagrees with prior step's parameters_after.${paramId} ` +
          `(delta=${check.delta}, tolerance=${check.appliedTolerance}).`,
      })
    }
  }
  return failures
}

/**
 * Rule 10: Trace identity + step ordering.
 *
 * For a sequence of receipts in a multi-step training run:
 *   - All receipts MUST share the same `trace_id`.
 *   - `step_index` MUST be sequential (0, 1, 2, ..., N-1) — monotonic AND
 *     dense. Gaps, reorderings, and duplicates all fire.
 *
 * Receipts without `trace_id` are exempt (single-step usage). A mixed
 * sequence where the FIRST receipt has no trace_id is treated as the
 * single-step legacy case — the entire sequence is exempt.
 *
 * Note: stored/recomputed for Rule 10 are non-numeric in the trace_id
 * case (they're strings). The field types still match (we cast to `any`).
 * CLI renderers SHOULD branch on `rule === 10` to render the trace_id
 * comparison sensibly; the `message` field carries a human-readable
 * description in either case.
 *
 * @param receipts The full ordered sequence of receipts in the training
 *                 run (typically the parsed lines of a multi-record
 *                 JSONL file). An empty array passes trivially.
 */
export function checkRule10(receipts: ReadonlyArray<unknown>): ReconciliationFailure[] {
  const failures: ReconciliationFailure[] = []
  if (receipts.length === 0) return failures
  const first = receipts[0]
  if (first === null || typeof first !== "object") return failures
  const expectedTraceId = (first as { trace_id?: unknown }).trace_id
  // Single-step exemption: a first receipt without trace_id signals legacy
  // single-step usage; the whole sequence is exempt from Rule 10.
  if (expectedTraceId === undefined) return failures

  for (let i = 0; i < receipts.length; i++) {
    const r = receipts[i]
    if (r === null || typeof r !== "object") continue
    const rr = r as { trace_id?: unknown; step_index?: unknown }
    if (rr.trace_id !== expectedTraceId) {
      failures.push({
        rule: 10,
        field_path: `receipts[${i}].trace_id`,
        // String values cast through `any` so the numeric quartet type
        // still matches — CLI renderers branch on rule === 10 to format.
        stored: rr.trace_id as unknown as number,
        recomputed: expectedTraceId as unknown as number,
        delta: 0,
        tolerance: 0,
        message:
          `Trace ID mismatch at receipt ${i}: expected ${JSON.stringify(expectedTraceId)}, ` +
          `got ${JSON.stringify(rr.trace_id ?? "(undefined)")}. All receipts in a multi-step ` +
          `training run must share trace_id.`,
      })
    }
    if (rr.step_index !== i) {
      const observed = typeof rr.step_index === "number" ? rr.step_index : -1
      failures.push({
        rule: 10,
        field_path: `receipts[${i}].step_index`,
        stored: observed,
        recomputed: i,
        delta: Math.abs(observed - i),
        tolerance: 0,
        message:
          `step_index gap or reorder at receipt ${i}: expected ${i}, ` +
          `got ${JSON.stringify(rr.step_index ?? "(undefined)")}. Multi-step receipts must be ` +
          `0-indexed, monotonic, and dense (no gaps, no duplicates, no reorderings).`,
      })
    }
  }
  return failures
}

/**
 * Reconcile a sequence of receipts from a multi-step training run.
 *
 * Two-phase validation:
 *   1. For each receipt, run Rules 1-8 (per-receipt math correctness)
 *      via `reconcileReceipt`. Failures are prefixed with `receipts[i].`
 *      in their `field_path` so the multi-record output unambiguously
 *      locates each failure to a specific step.
 *   2. Across adjacent pairs, run Rule 9 (parameter chain). Across the
 *      entire sequence, run Rule 10 (trace identity + step_index
 *      sequencing).
 *
 * Returns the union of all failures from both phases. An empty sequence
 * passes trivially (`{ ok: true }`); a single-receipt sequence runs
 * Rules 1-8 only (Rule 9 has no prior step; Rule 10 is exempt when the
 * first receipt has no trace_id, or fires if step_index !== 0 when it
 * does).
 *
 * @param receipts  The ordered sequence of receipts in the training run
 *                  (typically the parsed lines of a multi-record JSONL
 *                  file, e.g. `fixtures/xor.golden.jsonl`).
 * @returns         `{ ok: true }` if every implemented rule passes across
 *                  the full sequence, OR `{ ok: false; failures: [...] }`
 *                  listing every failure found across both phases. The
 *                  failures array is never empty when `ok` is false.
 *
 * @example
 *   import { reconcileMultiStep, parseReceiptJsonl } from "@mcptoolshop/backprop-trace";
 *   import { readFileSync } from "node:fs";
 *
 *   const parsed = parseReceiptJsonl(readFileSync("training-run.jsonl", "utf-8"));
 *   if (!parsed.ok) throw new Error(parsed.error.message);
 *   const result = reconcileMultiStep(parsed.receipts);
 *   if (!result.ok) {
 *     for (const f of result.failures) {
 *       console.error(`Rule ${f.rule} at ${f.field_path}: ${f.message ?? ""}`);
 *     }
 *     process.exit(1);
 *   }
 */
export function reconcileMultiStep(
  receipts: ReadonlyArray<unknown>,
): ReconciliationResult {
  const failures: ReconciliationFailure[] = []

  // Phase 1: per-receipt rules (1-8) on every step.
  for (let i = 0; i < receipts.length; i++) {
    const r = receipts[i]
    const result = reconcileReceipt(r)
    if (!result.ok) {
      for (const f of result.failures) {
        failures.push({ ...f, field_path: `receipts[${i}].${f.field_path}` })
      }
    }
  }

  // Phase 2: cross-record rules.
  // Rule 9: adjacent pairs, current step's tolerance policy.
  for (let i = 1; i < receipts.length; i++) {
    const cur = receipts[i]
    if (cur === null || typeof cur !== "object") continue
    const curPolicy = (cur as { numeric_policy?: { tolerance?: unknown } }).numeric_policy
      ?.tolerance
    if (!isValidTolerancePolicy(curPolicy)) continue
    failures.push(...checkRule9(cur, receipts[i - 1], curPolicy))
  }
  // Rule 10: full-sequence trace identity + step_index sequencing.
  failures.push(...checkRule10(receipts))

  // Rule 17 (v0.8): trace-bundle binding (GATED on bundle_root_digest).
  // Bundle-integrity check, NOT producer-authenticity. Silent skip when
  // no receipt declares the field — preserves backward compat with
  // v0.6/v0.7 multi-step receipts that pre-date Rule 17.
  checkRule17BundleBinding(receipts, failures)

  return failures.length === 0 ? { ok: true } : { ok: false, failures }
}

/**
 * Rule 12: loss formula consistency.
 *
 * Polymorphic dispatcher on `topology.loss`. v0.4.2 implements the
 * `half_squared_error` branch — the only loss currently supported by the
 * engine and the only one that appears in shipped fixtures. v0.5 will
 * extend with `cross_entropy_softmax` per the v0.5 study consolidator.
 *
 * For `half_squared_error`:
 *   - Per-output: `loss.per_output[u] == 0.5 * (targets[u] - forward[u].out)^2`
 *   - Total:      `loss.total == sum(loss.per_output[u] for u in output_units)`
 *
 * Gracefully no-ops when:
 *   - `topology.loss` is absent (v0.1 Mazur receipts where topology is the
 *     narrow Mazur shape without a `loss` field) — we fall back to the
 *     receipt's implicit half_squared_error assumption only when forward +
 *     targets are present.
 *   - `loss.per_output` or `loss.total` is absent
 *   - `targets` or `forward` is absent
 *
 * This rule INDEPENDENTLY catches loss-side mutations that Rules 1-8 miss:
 * Rules 1-8 are backward-side (signal_value, gradients, updates) and never
 * read `loss.total` or `loss.per_output`. v0.4.2 closes the gap surfaced
 * by Agent C in the v0.5 study: pre-v0.4.2, a receipt could mutate
 * `loss.total` arbitrarily and reconcileReceipt would return ok===true.
 *
 * Failure quartet: `stored` = the receipt's claim, `recomputed` = what the
 * formula derives from forward + targets. Field path points at the exact
 * loss field that contradicts the formula (`loss.total` or
 * `loss.per_output.<unit>`).
 */
function checkRule12LossFormula(
  r: Receipt,
  tolerance: TolerancePolicy,
  failures: ReconciliationFailure[],
): void {
  // v0.9 — Skip Rule 12 for batched receipts. The top-level loss.per_output
  // and loss.total are batch-REDUCED across samples; deriving expected values
  // from top-level forward + targets (which are FIRST-SAMPLE only by canonical
  // convention) would produce single-sample values that don't match the reduced
  // claims. Rule 18 (batch reduction consistency) catches the loss-side
  // batched mistakes via loss.per_sample. Per-sample loss formula correctness
  // is verified by Rule 14 (engine recompute) per sample.
  if ((r as { batch?: unknown }).batch !== undefined) return

  // Determine the loss formula. Prefer topology.loss; fall back to
  // half_squared_error for receipts that don't declare one (v0.1 Mazur).
  const declared = r.topology?.loss
  const formula: "half_squared_error" | "cross_entropy_softmax" =
    declared ?? "half_squared_error"

  if (formula === "cross_entropy_softmax") {
    // v0.5 cross_entropy_softmax branch — symmetric with the
    // half_squared_error branch below but using the CE formula:
    //   per_output[u] = -y_u * log(p_u)              (forced to 0 when y_u===0
    //                                                  to match the y*log(y)→0
    //                                                  limit and avoid -0*log(0)
    //                                                  NaN propagation; see the
    //                                                  engine's loss block)
    //   total         = sum_u per_output[u]
    //
    // The reconciler MUST mirror the engine's "force 0 when y_u===0" rule
    // because a strictly-computed -0*log(0) yields NaN, which would surface
    // as a non-finite Rule 12 failure even on a valid receipt. The forced 0
    // is mathematically faithful (the limit holds at y=0 for any p).
    const loss = r.loss
    const targets = r.targets
    const forward = r.forward
    if (!loss || !targets || !forward) return

    const perOutput = loss.per_output
    if (!perOutput || typeof perOutput !== "object") {
      failures.push({
        rule: 12,
        field_path: "loss.per_output",
        stored: 0,
        recomputed: 0,
        delta: 0,
        tolerance: 0,
        message:
          "Rule 12 (cross_entropy_softmax): loss.per_output is missing or not an object. " +
          "Receipt cannot be reconciled against the loss formula without per-output entries.",
      })
      return
    }

    let expectedTotal = 0
    let totalReconstructable = true
    for (const unitId of Object.keys(perOutput)) {
      const stored = perOutput[unitId]
      if (typeof stored !== "number") continue
      const target = targets[unitId]
      const out = forward[unitId]?.out
      if (typeof target !== "number" || typeof out !== "number") {
        totalReconstructable = false
        continue
      }
      const recomputed = target === 0 ? 0 : -target * Math.log(out)
      expectedTotal = expectedTotal + recomputed
      const check = applyToleranceCheck(stored, recomputed, tolerance)
      if (!check.ok) {
        failures.push({
          rule: 12,
          parameter_id: unitId,
          field_path: `loss.per_output.${unitId}`,
          stored,
          recomputed,
          delta: check.delta,
          tolerance: check.appliedTolerance,
          message: check.isFinite
            ? undefined
            : nonFiniteMessage(12, `loss.per_output.${unitId}`, recomputed, stored),
        })
      }
    }

    if (typeof loss.total === "number" && totalReconstructable) {
      const storedTotal = loss.total
      const check = applyToleranceCheck(storedTotal, expectedTotal, tolerance)
      if (!check.ok) {
        failures.push({
          rule: 12,
          field_path: "loss.total",
          stored: storedTotal,
          recomputed: expectedTotal,
          delta: check.delta,
          tolerance: check.appliedTolerance,
          message: check.isFinite
            ? undefined
            : nonFiniteMessage(12, "loss.total", expectedTotal, storedTotal),
        })
      }
    } else if (loss.total !== undefined && typeof loss.total !== "number") {
      failures.push({
        rule: 12,
        field_path: "loss.total",
        stored: 0,
        recomputed: 0,
        delta: 0,
        tolerance: 0,
        message:
          "Rule 12 (cross_entropy_softmax): loss.total is present but not a number. " +
          "Expected the sum of -y_u * log(p_u) over output units.",
      })
    }
    return
  }

  // half_squared_error branch — the v0.4.2 ship.
  const loss = r.loss
  const targets = r.targets
  const forward = r.forward
  if (!loss || !targets || !forward) {
    // Missing required data — silently no-op. Schema validation would
    // catch a malformed receipt before reconciliation; this guard exists
    // for defensive depth.
    return
  }

  const perOutput = loss.per_output
  if (!perOutput || typeof perOutput !== "object") {
    failures.push({
      rule: 12,
      field_path: "loss.per_output",
      stored: 0,
      recomputed: 0,
      delta: 0,
      tolerance: 0,
      message:
        "Rule 12 (half_squared_error): loss.per_output is missing or not an object. " +
        "Receipt cannot be reconciled against the loss formula without per-output entries.",
    })
    return
  }

  // Per-output check: loss.per_output[u] == 0.5 * (targets[u] - forward[u].out)^2
  // Iterate over the per_output keys (which should match output unit ids).
  let expectedTotal = 0
  let totalReconstructable = true
  for (const unitId of Object.keys(perOutput)) {
    const stored = perOutput[unitId]
    if (typeof stored !== "number") continue
    const target = targets[unitId]
    const out = forward[unitId]?.out
    if (typeof target !== "number" || typeof out !== "number") {
      // Missing the inputs needed to recompute — skip this unit's check
      // but DO disqualify the total reconstruction.
      totalReconstructable = false
      continue
    }
    const diff = target - out
    const recomputed = 0.5 * diff * diff
    expectedTotal = expectedTotal + recomputed
    const check = applyToleranceCheck(stored, recomputed, tolerance)
    if (!check.ok) {
      failures.push({
        rule: 12,
        parameter_id: unitId,
        field_path: `loss.per_output.${unitId}`,
        stored,
        recomputed,
        delta: check.delta,
        tolerance: check.appliedTolerance,
        message: check.isFinite
          ? undefined
          : nonFiniteMessage(12, `loss.per_output.${unitId}`, recomputed, stored),
      })
    }
  }

  // Total check: loss.total == sum(loss.per_output[*])
  if (typeof loss.total === "number" && totalReconstructable) {
    const storedTotal = loss.total
    const check = applyToleranceCheck(storedTotal, expectedTotal, tolerance)
    if (!check.ok) {
      failures.push({
        rule: 12,
        field_path: "loss.total",
        stored: storedTotal,
        recomputed: expectedTotal,
        delta: check.delta,
        tolerance: check.appliedTolerance,
        message: check.isFinite
          ? undefined
          : nonFiniteMessage(12, "loss.total", expectedTotal, storedTotal),
      })
    }
  } else if (loss.total !== undefined && typeof loss.total !== "number") {
    failures.push({
      rule: 12,
      field_path: "loss.total",
      stored: 0,
      recomputed: 0,
      delta: 0,
      tolerance: 0,
      message:
        "Rule 12 (half_squared_error): loss.total is present but not a number. " +
        "Expected the sum of loss.per_output[*] under the half_squared_error formula.",
    })
  }
}

/**
 * Rule 11 (v0.5): softmax normalization.
 *
 * When topology.activation_output === "softmax", the forward outputs are
 * probabilities and MUST sum to 1.0 within tolerance. The sum is computed
 * left-to-right in topology.unit_order.output order — the same order the
 * engine uses when building the softmax vector — so a deterministic
 * floating-point sum can be reconciled.
 *
 * Silently no-ops when activation_output is anything other than "softmax":
 *  - sigmoid/identity/relu outputs are not constrained to sum to 1.
 *  - Receipts that don't declare an activation_output (legacy or partial
 *    receipts) are exempt.
 *
 * This is INDEPENDENT of Rule 0.8 (probability bounds): Rule 0.8 checks
 * per-output `in [0, 1]`; Rule 11 checks the sum-to-unity invariant. A
 * receipt could pass Rule 0.8 (every value in [0, 1]) while failing Rule 11
 * (sum ≠ 1, e.g., one value uniformly shrunk to make the sum 0.99) and vice
 * versa (a value of -0.5 paired with another of 1.5 sums to 1 but violates
 * 0.8).
 */
function checkRule11SoftmaxNormalization(
  r: Receipt,
  tolerance: TolerancePolicy,
  failures: ReconciliationFailure[],
): void {
  const topo = r.topology
  if (topo?.activation_output !== "softmax") return
  const order = topo.unit_order?.output
  if (!Array.isArray(order) || order.length === 0) return
  const forward = r.forward
  if (!forward) return
  let sum = 0
  let first = true
  let anyMissing = false
  for (const oUnit of order) {
    const f = forward[oUnit]
    if (!f || typeof f.out !== "number") {
      anyMissing = true
      break
    }
    if (first) {
      sum = f.out
      first = false
    } else {
      sum = sum + f.out
    }
  }
  if (anyMissing) {
    // A missing or non-numeric forward.out is a structural issue caught
    // elsewhere (schema validation, Rule 0). Don't double-report from Rule 11.
    return
  }
  const check = applyToleranceCheck(sum, 1.0, tolerance)
  if (!check.ok) {
    failures.push({
      rule: 11,
      field_path: "forward[output_units].out (sum)",
      stored: sum,
      recomputed: 1.0,
      delta: check.delta,
      tolerance: check.appliedTolerance,
      message: check.isFinite
        ? `Rule 11 (softmax normalization): sum(forward[output_unit].out) = ${sum} ` +
          `disagrees with the required normalization 1.0 (delta=${check.delta}, ` +
          `tolerance=${check.appliedTolerance}). Sum computed left-to-right in ` +
          `topology.unit_order.output order: [${order.join(", ")}].`
        : nonFiniteMessage(11, "forward[output_units].out (sum)", sum, 1.0),
    })
  }
}

/**
 * Rule 13 (v0.5): gated dual-form consistency for softmax+CE.
 *
 * Fires ONLY when an OutputErrorSignal carries a `dual_form` block. The v0.5
 * consolidator locked Rule 13 as GATED (not mandatory) so receipts can opt
 * into the extra verification surface by emitting dual_form alongside the
 * collapsed factors. The engine emits dual_form for every softmax+CE
 * output_error_signal; receipts authored from PyTorch / JAX / other
 * frameworks can omit dual_form and Rule 13 silently skips.
 *
 * Three sub-checks (each fires independently — multiple may surface per
 * output unit if the receipt is severely corrupted):
 *
 *  13a. Per-term multiplication: each jacobian_term.term_value ==
 *       multiply(jacobian_term.factors), left-to-right. Reuses the existing
 *       multiplyFactorsLeftToRight primitive so the named "product_order"
 *       contract is consistent with Rules 1, 3, 4.
 *
 *  13b. Summation: dual_form.summed_value == sum(jacobian_terms.term_value)
 *       in dual_form.summation_order order. Reuses sumInOrder so the
 *       summation contract matches Rule 2's backpropagated_sum convention.
 *
 *  13c. Collapsed-vs-dual: dual_form.summed_value == OutputErrorSignal.signal_value.
 *       This is the load-bearing cross-form check — if both the collapsed
 *       factors and the expanded Jacobian decomposition are emitted, they
 *       MUST agree at the sum level. A disagreement means either the
 *       collapsed factors lied or the dual decomposition is wrong; the
 *       message names the discrepancy without choosing sides.
 *
 * No-cascade: Rule 13 does NOT consume cascade state from Rules 1-8 because
 * its three sub-checks are independent — a per-term failure (13a) doesn't
 * make the summation check (13b) less informative, and the cross-form check
 * (13c) is orthogonal to both. All three fire if applicable.
 */
function checkRule13GatedDualForm(
  r: Receipt,
  tolerance: TolerancePolicy,
  failures: ReconciliationFailure[],
): void {
  const signals = r.backward?.output_error_signals
  if (!signals || typeof signals !== "object") return
  for (const unitId of Object.keys(signals)) {
    const unit = signals[unitId]
    if (!unit || typeof unit !== "object") continue
    const dual = unit.dual_form
    if (!dual) continue // GATED: silently skip when absent.

    // Structural guard: dual_form.product_order must be left_to_right (the
    // only order the v0.5 reconciler accepts, matching the rest of the
    // multiplication-rule sites).
    if (dual.product_order !== "left_to_right") {
      failures.push({
        rule: 0,
        parameter_id: unitId,
        field_path: `backward.output_error_signals.${unitId}.dual_form.product_order`,
        stored: 0,
        recomputed: 0,
        delta: 0,
        tolerance: 0,
        message:
          `Unsupported product_order ${JSON.stringify(dual.product_order)} at ` +
          `backward.output_error_signals.${unitId}.dual_form.product_order. ` +
          `v0.5 reconciler accepts only 'left_to_right'.`,
      })
      continue
    }

    const terms = dual.jacobian_terms
    if (!Array.isArray(terms) || terms.length === 0) {
      failures.push({
        rule: 0,
        parameter_id: unitId,
        field_path: `backward.output_error_signals.${unitId}.dual_form.jacobian_terms`,
        stored: 0,
        recomputed: 0,
        delta: 0,
        tolerance: 0,
        message:
          `backward.output_error_signals.${unitId}.dual_form.jacobian_terms is empty or ` +
          `not an array. v0.5 schema requires minItems: 1.`,
      })
      continue
    }

    // 13a: per-term multiplication.
    for (let j = 0; j < terms.length; j++) {
      const term = terms[j]!
      if (!Array.isArray(term.factors) || term.factors.length < 1) {
        failures.push({
          rule: 0,
          parameter_id: unitId,
          field_path: `backward.output_error_signals.${unitId}.dual_form.jacobian_terms[${j}].factors`,
          stored: 0,
          recomputed: 0,
          delta: 0,
          tolerance: 0,
          message:
            `backward.output_error_signals.${unitId}.dual_form.jacobian_terms[${j}].factors ` +
            `has ` +
            (Array.isArray(term.factors) ? `${term.factors.length} entries` : `non-array type ${typeof term.factors}`) +
            `. v0.5 schema requires minItems: 1 per Jacobian term.`,
        })
        continue
      }
      const product = multiplyFactorsLeftToRight(term.factors)
      const stored = term.term_value
      const fieldPath = `backward.output_error_signals.${unitId}.dual_form.jacobian_terms[${j}].term_value`
      const check = applyToleranceCheck(product, stored, tolerance)
      if (!check.isFinite) {
        failures.push({
          rule: 13,
          parameter_id: unitId,
          field_path: fieldPath,
          stored,
          recomputed: product,
          delta: Number.NaN,
          tolerance: 0,
          factors: term.factors as NamedFactor[],
          product_order: "left_to_right",
          message: nonFiniteMessage(13, fieldPath, product, stored),
        })
        continue
      }
      if (!check.ok) {
        failures.push({
          rule: 13,
          parameter_id: unitId,
          field_path: fieldPath,
          stored,
          recomputed: product,
          delta: check.delta,
          tolerance: check.appliedTolerance,
          factors: term.factors as NamedFactor[],
          product_order: "left_to_right",
          message:
            `Rule 13a (dual-form term multiplication): jacobian_terms[${j}].term_value ` +
            `disagrees with the product of its factors (left_to_right). target_unit='${term.target_unit}'.`,
        })
      }
    }

    // 13b: summation.
    if (!Array.isArray(dual.summation_order)) {
      failures.push({
        rule: 0,
        parameter_id: unitId,
        field_path: `backward.output_error_signals.${unitId}.dual_form.summation_order`,
        stored: 0,
        recomputed: 0,
        delta: 0,
        tolerance: 0,
        message:
          `backward.output_error_signals.${unitId}.dual_form.summation_order is not an array.`,
      })
      continue
    }
    const dualSumRecomputed = sumInOrder(
      terms,
      dual.summation_order,
      (t) => t.target_unit,
      (t) => t.term_value,
    )
    const dualSumStored = dual.summed_value
    const sumFieldPath = `backward.output_error_signals.${unitId}.dual_form.summed_value`
    const sumCheck = applyToleranceCheck(dualSumRecomputed, dualSumStored, tolerance)
    if (!sumCheck.isFinite) {
      failures.push({
        rule: 13,
        parameter_id: unitId,
        field_path: sumFieldPath,
        stored: dualSumStored,
        recomputed: dualSumRecomputed,
        delta: Number.NaN,
        tolerance: 0,
        message: nonFiniteMessage(13, sumFieldPath, dualSumRecomputed, dualSumStored),
      })
    } else if (!sumCheck.ok) {
      failures.push({
        rule: 13,
        parameter_id: unitId,
        field_path: sumFieldPath,
        stored: dualSumStored,
        recomputed: dualSumRecomputed,
        delta: sumCheck.delta,
        tolerance: sumCheck.appliedTolerance,
        message:
          `Rule 13b (dual-form summation): summed_value disagrees with sum of jacobian_terms ` +
          `in summation_order [${dual.summation_order.join(", ")}].`,
      })
    }

    // 13c: collapsed-vs-dual cross-form check.
    const collapsedStored = unit.signal_value
    if (typeof collapsedStored === "number" && Number.isFinite(dualSumStored)) {
      const crossFieldPath = `backward.output_error_signals.${unitId}.dual_form.summed_value`
      const crossCheck = applyToleranceCheck(dualSumStored, collapsedStored, tolerance)
      if (!crossCheck.isFinite) {
        failures.push({
          rule: 13,
          parameter_id: unitId,
          field_path: crossFieldPath,
          stored: dualSumStored,
          recomputed: collapsedStored,
          delta: Number.NaN,
          tolerance: 0,
          message: nonFiniteMessage(13, crossFieldPath, collapsedStored, dualSumStored),
        })
      } else if (!crossCheck.ok) {
        failures.push({
          rule: 13,
          parameter_id: unitId,
          field_path: crossFieldPath,
          stored: dualSumStored,
          recomputed: collapsedStored,
          delta: crossCheck.delta,
          tolerance: crossCheck.appliedTolerance,
          message:
            `Rule 13c (collapsed-vs-dual): dual_form.summed_value (${dualSumStored}) disagrees ` +
            `with OutputErrorSignal.signal_value (${collapsedStored}). The collapsed factors ` +
            `and the dual-form Jacobian decomposition must agree at the sum level for ` +
            `softmax+CE — one of them is wrong.`,
        })
      }
    }
  }
}

// ============================================================================
// v0.6 — Rules 14 / 15 / 16 (external trace ingestion)
//
// These rules fire on observer-mode receipts (fixture_status.authoring_state
// === "external_imported"). Rules 14 + 15 are mandatory for observer
// receipts; Rule 16 is GATED on attestor.signed_subject_digest presence.
// All three are no-ops for engine-authored receipts so the v0.1-v0.5
// reconciliation paths are unchanged.
// ============================================================================

/**
 * Rule 14 (v0.6): engine-recompute differential.
 *
 * For observer-mode receipts (authoring_state === "external_imported"),
 * re-run runGeneralStep from `parameters_before + inputs + targets +
 * topology + learning_rate + numeric_policy + bias_policy` (everything
 * the engine needs to deterministically produce a step). Compare the
 * engine's output against the receipt's claimed forward / loss /
 * backward / updates / parameters_after within `attestor.differential_
 * tolerance` (defaults to {atol: 1e-6, rtol: 1e-4} if absent).
 *
 * Each per-field disagreement is a Rule 14 failure with the specific
 * field_path. This catches the collapsed-laundering attack class: a
 * mutated `signal_value` or `loss.total` that's internally consistent
 * within the receipt but disagrees with what the engine produces from
 * the same inputs.
 *
 * Skip conditions:
 *   - authoring_state !== "external_imported" → no-op (engine-authored
 *     receipts ARE the byte-equal source; differential is meaningless)
 *   - verification_state === "engine_recompute_skipped_with_basis" →
 *     no-op (the receipt declares recompute was deliberately skipped;
 *     Rule 15 enforces the basis-naming requirement instead)
 *   - Required engine inputs (parameters_before, inputs, targets,
 *     learning_rate, topology) are missing → no-op (schema validation
 *     catches malformed observer receipts; Rule 14 doesn't double-report)
 *
 * On engine-throw (e.g., topology cross-reference invalid), Rule 14
 * emits ONE failure naming the throw site rather than letting the
 * reconciler crash.
 */
function checkRule14EngineRecomputeDifferential(
  r: Receipt,
  failures: ReconciliationFailure[],
): void {
  const authoringState = r.fixture_status?.authoring_state
  if (authoringState !== "external_imported") return
  const verificationState = r.fixture_status?.verification_state
  if (verificationState === "engine_recompute_skipped_with_basis") return

  // Resolve differential tolerance: attestor.differential_tolerance preferred;
  // fall back to a permissive default if absent (Agent 2's "looser than
  // engine-authored" guidance — foreign FP precision drifts across CUDA /
  // JIT / vector instructions).
  const at = r.attestor
  const diffTol: TolerancePolicy =
    at?.differential_tolerance &&
    typeof at.differential_tolerance.atol === "number" &&
    typeof at.differential_tolerance.rtol === "number"
      ? { atol: at.differential_tolerance.atol, rtol: at.differential_tolerance.rtol }
      : { atol: 1e-6, rtol: 1e-4 }

  // Required engine inputs.
  const topo = r.topology
  if (!topo || !topo.unit_order || !topo.parameter_order || !topo.parameters) {
    return // schema-level structural issue; not Rule 14's domain
  }
  if (
    typeof r.learning_rate !== "number" ||
    !r.inputs ||
    !r.targets ||
    !r.parameters_before
  ) {
    return
  }
  if (!r.bias_policy?.mode) return
  if (!r.numeric_policy?.tolerance) return

  // Build a GeneralInput from the receipt's parameters_before + inputs +
  // targets + topology + policies. The shape mirrors what bp.ts builds
  // when running runGeneralStep on an engine-authored input.
  // v0.9 — batched receipts (receipt.batch present) dispatch to
  // runBatchedGeneralStep; the engine recomputes per-sample state via the
  // sidecar's per_sample data plus reduces the gradient. Unbatched receipts
  // continue to use runGeneralStep on the single sample at top-level
  // inputs/targets (v0.6-v0.8 behavior).
  let engineReceipt: Awaited<ReturnType<typeof runGeneralStep>>
  try {
    const batch = (r as { batch?: { size: number; sample_order: string[]; reduction: "mean" | "sum" | "none" } }).batch
    const perSample = (r as { per_sample?: Record<string, { inputs: Record<string, number>; targets: Record<string, number> }> }).per_sample
    if (batch && perSample) {
      const batchedInput: BatchedGeneralInput = {
        topology: topo as unknown as Topology,
        learning_rate: r.learning_rate,
        batch,
        parameters_before: r.parameters_before,
        per_sample: Object.fromEntries(
          batch.sample_order.map((sid) => {
            const s = perSample[sid]
            if (!s) {
              throw new Error(
                `Rule 14 (engine-recompute differential): per_sample missing entry for sample_id ${JSON.stringify(sid)} declared in batch.sample_order.`,
              )
            }
            return [sid, { inputs: s.inputs, targets: s.targets }]
          }),
        ),
        numeric_policy: r.numeric_policy as unknown as GeneralInput["numeric_policy"],
        bias_policy: r.bias_policy as unknown as GeneralInput["bias_policy"],
      }
      engineReceipt = runBatchedGeneralStep(batchedInput)
    } else {
      const input: GeneralInput = {
        topology: topo as unknown as Topology,
        learning_rate: r.learning_rate,
        inputs: r.inputs,
        targets: r.targets,
        parameters_before: r.parameters_before,
        numeric_policy: r.numeric_policy as unknown as GeneralInput["numeric_policy"],
        bias_policy: r.bias_policy as unknown as GeneralInput["bias_policy"],
      }
      engineReceipt = runGeneralStep(input)
    }
  } catch (err) {
    failures.push({
      rule: 14,
      field_path: "engine_recompute",
      stored: 0,
      recomputed: 0,
      delta: 0,
      tolerance: 0,
      message:
        `Rule 14 (engine-recompute differential): engine threw while recomputing the receipt ` +
        `for observer-mode validation: ${err instanceof Error ? err.message : String(err)}. ` +
        `Check topology cross-references and finite-input invariants.`,
    })
    return
  }

  // Compare engine output to receipt's claimed values, field by field.
  // Each disagreement is a separate Rule 14 failure with the field path.
  const compareScalar = (
    fieldPath: string,
    engineVal: number,
    receiptVal: number | undefined,
  ): void => {
    if (typeof receiptVal !== "number") return // schema-level; not Rule 14's domain
    const check = applyToleranceCheck(engineVal, receiptVal, diffTol)
    if (!check.isFinite) {
      failures.push({
        rule: 14,
        field_path: fieldPath,
        stored: receiptVal,
        recomputed: engineVal,
        delta: Number.NaN,
        tolerance: 0,
        message:
          `Rule 14 (engine-recompute differential): non-finite arithmetic at ${fieldPath}. ` +
          `Engine recomputed ${String(engineVal)}; receipt claimed ${String(receiptVal)}.`,
      })
      return
    }
    if (!check.ok) {
      failures.push({
        rule: 14,
        field_path: fieldPath,
        stored: receiptVal,
        recomputed: engineVal,
        delta: check.delta,
        tolerance: check.appliedTolerance,
        message:
          `Rule 14 (engine-recompute differential): foreign claim at ${fieldPath} ` +
          `(${receiptVal}) disagrees with engine recomputation (${engineVal}) beyond ` +
          `differential_tolerance (atol=${typeof diffTol === "number" ? diffTol : diffTol.atol}, ` +
          `rtol=${typeof diffTol === "number" ? 0 : diffTol.rtol}).`,
      })
    }
  }

  // forward[*].{net, out}
  for (const uId of Object.keys(engineReceipt.forward)) {
    const eUnit = engineReceipt.forward[uId]
    const rUnit = r.forward?.[uId]
    if (!eUnit || !rUnit) continue
    compareScalar(`forward.${uId}.net`, eUnit.net, rUnit.net)
    compareScalar(`forward.${uId}.out`, eUnit.out, rUnit.out)
  }

  // loss.per_output[*] and loss.total
  for (const uId of Object.keys(engineReceipt.loss.per_output)) {
    compareScalar(
      `loss.per_output.${uId}`,
      engineReceipt.loss.per_output[uId]!,
      r.loss?.per_output?.[uId],
    )
  }
  compareScalar("loss.total", engineReceipt.loss.total, r.loss?.total)

  // backward.output_error_signals[*].signal_value
  for (const uId of Object.keys(engineReceipt.backward.output_error_signals)) {
    const eSig = engineReceipt.backward.output_error_signals[uId]!
    const rSig = r.backward?.output_error_signals?.[uId]
    if (!rSig) continue
    compareScalar(
      `backward.output_error_signals.${uId}.signal_value`,
      eSig.signal_value,
      rSig.signal_value,
    )
  }

  // backward.hidden_error_signals[*].{backpropagated_sum, activation_derivative, signal_value}
  for (const uId of Object.keys(engineReceipt.backward.hidden_error_signals)) {
    const eSig = engineReceipt.backward.hidden_error_signals[uId]!
    const rSig = r.backward?.hidden_error_signals?.[uId]
    if (!rSig) continue
    compareScalar(
      `backward.hidden_error_signals.${uId}.backpropagated_sum`,
      eSig.backpropagated_sum,
      rSig.backpropagated_sum,
    )
    compareScalar(
      `backward.hidden_error_signals.${uId}.activation_derivative`,
      eSig.activation_derivative,
      rSig.activation_derivative,
    )
    compareScalar(
      `backward.hidden_error_signals.${uId}.signal_value`,
      eSig.signal_value,
      rSig.signal_value,
    )
  }

  // updates[*].{gradient, update, weight_after}
  const rUpdatesByParam = new Map<string, Update>()
  for (const u of r.updates) rUpdatesByParam.set(u.parameter_id, u)
  for (const eUpdate of engineReceipt.updates) {
    const rUpdate = rUpdatesByParam.get(eUpdate.parameter_id)
    if (!rUpdate) continue
    compareScalar(
      `updates[${eUpdate.parameter_id}].gradient`,
      eUpdate.gradient,
      rUpdate.gradient,
    )
    compareScalar(
      `updates[${eUpdate.parameter_id}].update`,
      eUpdate.update,
      rUpdate.update,
    )
    compareScalar(
      `updates[${eUpdate.parameter_id}].weight_after`,
      eUpdate.weight_after,
      rUpdate.weight_after,
    )
  }

  // parameters_after[*]
  for (const pid of Object.keys(engineReceipt.parameters_after)) {
    compareScalar(
      `parameters_after.${pid}`,
      engineReceipt.parameters_after[pid]!,
      r.parameters_after?.[pid],
    )
  }
}

/**
 * Rule 15 (v0.6): skip-basis required when recompute is skipped.
 *
 * When fixture_status.verification_state === "engine_recompute_skipped_
 * with_basis", attestor.skip_basis MUST be present AND in the closed
 * enum EXTERNAL_TRUST_BASIS_RECONCILER. Empty / missing / out-of-enum
 * fires Rule 15.
 *
 * Closed enum (mirrors src/general-engine.ts EXTERNAL_TRUST_BASIS):
 *   - hardware_nondeterminism
 *   - framework_op_unsupported
 *   - distributed_only_field
 *   - attested_third_party
 *
 * Leroy's verified-vs-trusted discipline applied: skipping the math gate
 * requires naming the reason on the record. Silent skipping is rejected.
 */
function checkRule15SkipBasis(
  r: Receipt,
  failures: ReconciliationFailure[],
): void {
  const verificationState = r.fixture_status?.verification_state
  if (verificationState !== "engine_recompute_skipped_with_basis") return

  const skipBasis = r.attestor?.skip_basis
  if (typeof skipBasis !== "string" || skipBasis.length === 0) {
    failures.push({
      rule: 15,
      field_path: "attestor.skip_basis",
      stored: 0,
      recomputed: 0,
      delta: 0,
      tolerance: 0,
      message:
        `Rule 15 (skip-basis required): fixture_status.verification_state is ` +
        `"engine_recompute_skipped_with_basis" but attestor.skip_basis is ` +
        (skipBasis === undefined ? "absent" : `empty (${JSON.stringify(skipBasis)})`) +
        `. Operator must name the basis from the closed enum ` +
        `EXTERNAL_TRUST_BASIS = [${EXTERNAL_TRUST_BASIS_RECONCILER.join(", ")}] on the record. ` +
        `Silent skipping is rejected — Leroy's verified-vs-trusted discipline.`,
    })
    return
  }
  if (
    !(EXTERNAL_TRUST_BASIS_RECONCILER as readonly string[]).includes(skipBasis)
  ) {
    failures.push({
      rule: 15,
      field_path: "attestor.skip_basis",
      stored: 0,
      recomputed: 0,
      delta: 0,
      tolerance: 0,
      message:
        `Rule 15 (skip-basis required): attestor.skip_basis=${JSON.stringify(skipBasis)} ` +
        `is not in the closed enum EXTERNAL_TRUST_BASIS = ` +
        `[${EXTERNAL_TRUST_BASIS_RECONCILER.join(", ")}]. Extending the vocabulary requires ` +
        `a coordinated source-code change — silent additions are rejected.`,
    })
  }
}

/**
 * Rule 16 (v0.6): attestation digest binding (gated).
 *
 * Fires ONLY when attestor.signed_subject_digest is present. When present,
 * recompute the canonical-byte hash of the receipt (with the
 * signed_subject_digest field stripped from the attestor block) and
 * assert it matches the declared digest.
 *
 * Catches SolarWinds-style "signed-but-substituted" attacks where a
 * valid signature is bound to mutated bytes. Signature *validity* (e.g.,
 * cosign verification of a cryptographic signature over the digest) is
 * OUT of scope for the reconciler — that's a CI-side concern. Rule 16
 * only checks the digest-binding integrity within the receipt itself.
 *
 * Silently skips when signed_subject_digest is absent — consistent with
 * Rule 13's GATED behavior.
 *
 * Format: "sha256:<64-hex>" (matches the schema's pattern constraint).
 *
 * @param rawReceipt  The original unknown receipt value (for canonical-
 *                    byte hashing — must be the JSON-parsed object, not
 *                    the narrowed Receipt type, because hashReceipt
 *                    re-emits via the canonical emitter and needs the
 *                    full object).
 */
function checkRule16AttestationBinding(
  rawReceipt: unknown,
  r: Receipt,
  failures: ReconciliationFailure[],
): void {
  const digest = r.attestor?.signed_subject_digest
  if (typeof digest !== "string" || digest.length === 0) return // GATED

  // Validate digest format BEFORE recomputing — saves a hash call on
  // structurally-broken receipts.
  const match = digest.match(/^sha256:([0-9a-f]{64})$/)
  if (!match) {
    failures.push({
      rule: 16,
      field_path: "attestor.signed_subject_digest",
      stored: 0,
      recomputed: 0,
      delta: 0,
      tolerance: 0,
      message:
        `Rule 16 (attestation digest binding): attestor.signed_subject_digest ` +
        `${JSON.stringify(digest)} is not in the expected "sha256:<64-hex>" format.`,
    })
    return
  }

  // Build a copy of the receipt with the digest field stripped, then
  // hash it via the canonical-byte hasher.
  let stripped: unknown
  try {
    stripped = JSON.parse(JSON.stringify(rawReceipt)) // deep clone
    const sAttestor = (stripped as { attestor?: { signed_subject_digest?: unknown } }).attestor
    if (sAttestor) delete sAttestor.signed_subject_digest
  } catch (err) {
    failures.push({
      rule: 16,
      field_path: "attestor.signed_subject_digest",
      stored: 0,
      recomputed: 0,
      delta: 0,
      tolerance: 0,
      message:
        `Rule 16 (attestation digest binding): could not deep-clone receipt for digest ` +
        `recomputation: ${err instanceof Error ? err.message : String(err)}.`,
    })
    return
  }

  let recomputedDigest: string
  try {
    // Canonicalize via the generalized emitter, then hash the canonical
    // byte stream. emitGeneralReceipt produces deterministic byte output
    // matching the schema's x-order — the same bytes any other consumer
    // would derive from the same logical receipt. Pass the bytes string
    // directly to hashReceipt's string-input overload.
    const canonicalBytes = emitGeneralReceipt(stripped as unknown as GeneralReceipt)
    recomputedDigest = `sha256:${hashReceipt(canonicalBytes)}`
  } catch (err) {
    failures.push({
      rule: 16,
      field_path: "attestor.signed_subject_digest",
      stored: 0,
      recomputed: 0,
      delta: 0,
      tolerance: 0,
      message:
        `Rule 16 (attestation digest binding): canonical-emit/hash threw on the stripped receipt: ` +
        `${err instanceof Error ? err.message : String(err)}.`,
    })
    return
  }

  if (recomputedDigest !== digest) {
    failures.push({
      rule: 16,
      field_path: "attestor.signed_subject_digest",
      stored: 0,
      recomputed: 0,
      delta: 0,
      tolerance: 0,
      message:
        `Rule 16 (attestation digest binding): declared digest ${digest} does not match ` +
        `recomputed digest ${recomputedDigest}. The receipt bytes have been mutated after ` +
        `the digest was bound — SolarWinds-style "signed-but-substituted" attack signature. ` +
        `Signature validity (cosign verification) is out of scope for the reconciler; this ` +
        `check only catches digest-binding integrity within the receipt itself.`,
    })
  }
}

/**
 * Rule 18 (v0.9): batch reduction consistency (GATED).
 *
 * Fires when `receipt.batch` is present AND `loss.reduction` is "mean" or
 * "sum". Asserts:
 *
 *   loss.total == reduction(loss.per_sample.values(), batch.reduction)
 *
 * Catches mean-vs-sum confusion structurally — the canonical attack class
 * where a producer claims `reduction: "mean"` but emits
 * `loss.total = sum(per_sample)` (off by a factor of N).
 *
 * Silently skips:
 *   - Unbatched receipts (no `batch` block).
 *   - Batched receipts with `loss.reduction = "none"` (no reduction claimed).
 *   - Batched receipts where `loss.per_sample` is absent (the importer/producer
 *     chose not to expose per-sample loss; Rule 18 cannot verify what isn't
 *     declared). Note: for observer-mode imports, the importer ALWAYS populates
 *     `loss.per_sample` when batch is present, so this skip-path only applies
 *     to engine-authored receipts that opted out.
 */
function checkRule18BatchReduction(
  r: Receipt,
  tolerance: TolerancePolicy,
  failures: ReconciliationFailure[],
): void {
  // GATED on batch presence + reduction in {mean, sum} + per_sample present.
  const batch = (r as { batch?: { reduction: string; sample_order: string[] } }).batch
  if (!batch) return
  if (batch.reduction !== "mean" && batch.reduction !== "sum") return
  const loss = r.loss as { per_sample?: Record<string, number>; total: number }
  if (!loss.per_sample) return

  // Compute expected total via reduction over sample_order (canonical iteration).
  const perSampleValues: number[] = []
  for (const sid of batch.sample_order) {
    const v = loss.per_sample[sid]
    if (typeof v !== "number") {
      // Sample missing from per_sample map — Rule 19 catches this directly;
      // Rule 18 silently skips the reduction check to avoid duplicate fires.
      return
    }
    perSampleValues.push(v)
  }
  let expectedTotal: number
  if (batch.reduction === "mean") {
    expectedTotal = perSampleValues.reduce((a, b) => a + b, 0) / perSampleValues.length
  } else {
    expectedTotal = perSampleValues.reduce((a, b) => a + b, 0)
  }
  const declared = loss.total
  const check = applyToleranceCheck(declared, expectedTotal, tolerance)
  if (!check.ok) {
    failures.push({
      rule: 18,
      field_path: "loss.total",
      stored: declared,
      recomputed: expectedTotal,
      delta: check.delta,
      tolerance: check.appliedTolerance,
      message:
        `Rule 18 (batch reduction consistency): loss.total ${declared} does not match ` +
        `${batch.reduction}(loss.per_sample.values()) = ${expectedTotal} ` +
        `(${perSampleValues.length} samples, reduction=${batch.reduction}). ` +
        `Catches the mean-vs-sum confusion attack class — a producer claiming reduction=${batch.reduction} ` +
        `but emitting loss.total with the OTHER reduction (off by a factor of N).`,
    })
  }
}

/**
 * Rule 19 (v0.9): sample-set coherence (GATED).
 *
 * Precisely scoped per the v0.9 lock: "When batch.sample_order is present,
 * every ordered per-sample projection used for reduction, emission, or
 * canonical digest construction must be derived by iterating exactly that
 * order. Missing, duplicate, or out-of-order sample IDs fail."
 *
 * Concretely, this rule asserts:
 *   (a) batch.sample_order has no duplicates (already enforced by schema's
 *       uniqueItems but re-checked at reconcile time as defense in depth).
 *   (b) For every per-sample MAP in the receipt (loss.per_sample, top-level
 *       per_sample), the key set EQUALS the set of batch.sample_order entries.
 *       Missing IDs (gap), extra IDs (extra), or wrong IDs (substitution)
 *       all fire.
 *
 * Does NOT fire on:
 *   - Unbatched receipts (no batch block).
 *   - Maps that aren't declared as per-sample projections (e.g.,
 *     parameters_before, which is keyed by parameter_id not sample_id).
 *
 * Canonical-emission discipline handles the ordering: emit.ts emitPerSample
 * iterates batch.sample_order. Rule 19 verifies the underlying data has the
 * right key set so that iteration is correct.
 */
function checkRule19SampleSetCoherence(
  r: Receipt,
  failures: ReconciliationFailure[],
): void {
  const batch = (r as { batch?: { sample_order: string[] } }).batch
  if (!batch) return
  const sampleOrder = batch.sample_order

  // (a) Duplicate detection (defense in depth — schema's uniqueItems already
  // catches this at validation time).
  const seen = new Set<string>()
  for (let i = 0; i < sampleOrder.length; i += 1) {
    const sid = sampleOrder[i]!
    if (seen.has(sid)) {
      failures.push({
        rule: 19,
        field_path: `batch.sample_order[${i}]`,
        stored: 0,
        recomputed: 0,
        delta: 0,
        tolerance: 0,
        message:
          `Rule 19 (sample-set coherence): batch.sample_order contains duplicate sample_id ${JSON.stringify(sid)} ` +
          `at index ${i}. Per-sample projections must be derived by iterating an unambiguous order.`,
      })
      return // Don't cascade further — duplicate sample_order makes set comparisons meaningless.
    }
    seen.add(sid)
  }

  const declared = new Set(sampleOrder)

  // (b) Per-sample map key-set checks. Iterate every per-sample map in the
  // receipt and assert its keys EQUAL batch.sample_order set.
  const lossPerSample = (r.loss as { per_sample?: Record<string, number> }).per_sample
  if (lossPerSample) {
    checkSampleKeySet(
      declared,
      lossPerSample,
      "loss.per_sample",
      failures,
    )
  }
  const topPerSample = (r as { per_sample?: Record<string, unknown> }).per_sample
  if (topPerSample) {
    checkSampleKeySet(declared, topPerSample, "per_sample", failures)
  }
}

/**
 * Helper for Rule 19: assert per-sample map's key set equals declared set.
 * Surfaces missing IDs (in declared but not in map) and extra IDs (in map
 * but not in declared) as separate failures with clear field_paths.
 */
function checkSampleKeySet(
  declared: ReadonlySet<string>,
  perSampleMap: Record<string, unknown>,
  mapPath: string,
  failures: ReconciliationFailure[],
): void {
  const observed = new Set(Object.keys(perSampleMap))
  // Missing: in declared but not in observed.
  for (const sid of declared) {
    if (!observed.has(sid)) {
      failures.push({
        rule: 19,
        field_path: `${mapPath}.${sid}`,
        stored: 0,
        recomputed: 0,
        delta: 0,
        tolerance: 0,
        message:
          `Rule 19 (sample-set coherence): ${mapPath} is missing sample_id ${JSON.stringify(sid)} ` +
          `declared in batch.sample_order. Every ordered per-sample projection must include all sample IDs.`,
      })
    }
  }
  // Extra: in observed but not in declared.
  for (const sid of observed) {
    if (!declared.has(sid)) {
      failures.push({
        rule: 19,
        field_path: `${mapPath}.${sid}`,
        stored: 0,
        recomputed: 0,
        delta: 0,
        tolerance: 0,
        message:
          `Rule 19 (sample-set coherence): ${mapPath} contains sample_id ${JSON.stringify(sid)} ` +
          `not declared in batch.sample_order. Per-sample projections must use only declared sample IDs.`,
      })
    }
  }
}

/**
 * Rule 17 (v0.8): trace-bundle binding (GATED).
 *
 * Fires ONLY when any receipt in the multi-record input declares
 * `attestor.bundle_root_digest`. When fired, asserts three properties:
 *   (a) Co-presence: every receipt in the bundle declares the field
 *       (heterogeneous binding is rejected).
 *   (b) Value consistency: every receipt's bundle_root_digest is the
 *       same string.
 *   (c) Recompute: concatenate canonical bytes of every receipt with
 *       its own bundle_root_digest field stripped, sha256 the stream,
 *       and assert the result matches the declared value.
 *
 * Catches BUNDLE INTEGRITY failures: accidental splice, post-binding
 * mutation of a receipt's bytes, inconsistent bundle roots when the
 * digest was not recomputed after the change, receipt reordering after
 * binding.
 *
 * Rule 17 is NOT a producer-authenticity check. An attacker who controls
 * all receipt bytes AND recomputes the bundle digest passes Rule 17
 * trivially. For producer-identity binding, combine bundle_root_digest
 * with Rule 16's signed_subject_digest, an external signature, or an
 * out-of-band attestation. Rule 17 is a tamper-evidence layer, not an
 * authentication layer.
 *
 * Silently skips when no receipt declares the field — consistent with
 * Rule 16's GATED behavior. Fires only from `reconcileMultiStep` because
 * the bundle context (which receipts comprise the trace) is meaningful
 * only across a multi-record sequence.
 */
function checkRule17BundleBinding(
  rawReceipts: ReadonlyArray<unknown>,
  failures: ReconciliationFailure[],
): void {
  // Collect declared bundle_root_digest from each receipt's attestor.
  const digests = rawReceipts.map((r) => {
    if (r === null || typeof r !== "object") return undefined
    const a = (r as { attestor?: { bundle_root_digest?: unknown } }).attestor
    if (!a || typeof a !== "object") return undefined
    const d = (a as { bundle_root_digest?: unknown }).bundle_root_digest
    return typeof d === "string" ? d : undefined
  })

  const anyDeclared = digests.some((d) => d !== undefined)
  if (!anyDeclared) return // GATED — silent skip

  // (a) Co-presence: every receipt must declare the field once any does.
  const allDeclared = digests.every((d) => d !== undefined)
  if (!allDeclared) {
    const firstMissing = digests.findIndex((d) => d === undefined)
    failures.push({
      rule: 17,
      field_path: `receipts[${firstMissing}].attestor.bundle_root_digest`,
      stored: 0,
      recomputed: 0,
      delta: 0,
      tolerance: 0,
      message:
        `Rule 17 (trace-bundle binding): heterogeneous binding — some receipts declare ` +
        `attestor.bundle_root_digest and others do not. First receipt missing the field: ` +
        `index ${firstMissing}. Either bind the whole bundle (all receipts carry the same ` +
        `bundle_root_digest) or none. Rule 17 is a BUNDLE INTEGRITY check, NOT a producer-` +
        `authenticity check.`,
    })
    return
  }

  // (b) Value consistency: every receipt's digest must be identical.
  const first = digests[0]!
  for (let i = 1; i < digests.length; i += 1) {
    if (digests[i] !== first) {
      failures.push({
        rule: 17,
        field_path: `receipts[${i}].attestor.bundle_root_digest`,
        stored: 0,
        recomputed: 0,
        delta: 0,
        tolerance: 0,
        message:
          `Rule 17 (trace-bundle binding): bundle_root_digest mismatch at receipt[${i}]. ` +
          `Expected ${first} (from receipt[0]); got ${digests[i]}. All receipts in a bundle ` +
          `MUST declare the same bundle_root_digest value.`,
      })
      return
    }
  }

  // Validate digest format BEFORE recomputing.
  const match = first.match(/^sha256:([0-9a-f]{64})$/)
  if (!match) {
    failures.push({
      rule: 17,
      field_path: "receipts[0].attestor.bundle_root_digest",
      stored: 0,
      recomputed: 0,
      delta: 0,
      tolerance: 0,
      message:
        `Rule 17 (trace-bundle binding): bundle_root_digest ${JSON.stringify(first)} ` +
        `is not in the expected "sha256:<64-hex>" format.`,
    })
    return
  }

  // (c) Recompute: strip bundle_root_digest from each receipt, re-emit
  // canonical bytes, concatenate, sha256, compare.
  let recomputedDigest: string
  try {
    const parts: string[] = []
    for (const r of rawReceipts) {
      const stripped = JSON.parse(JSON.stringify(r)) as Record<string, unknown>
      const sAttestor = stripped.attestor as { bundle_root_digest?: unknown } | undefined
      if (sAttestor && typeof sAttestor === "object") {
        delete sAttestor.bundle_root_digest
      }
      parts.push(emitGeneralReceipt(stripped as unknown as GeneralReceipt))
    }
    const pass1Bytes = parts.join("")
    recomputedDigest = `sha256:${hashReceipt(pass1Bytes)}`
  } catch (err) {
    failures.push({
      rule: 17,
      field_path: "receipts[*].attestor.bundle_root_digest",
      stored: 0,
      recomputed: 0,
      delta: 0,
      tolerance: 0,
      message:
        `Rule 17 (trace-bundle binding): canonical-emit threw while recomputing the bundle ` +
        `digest from receipts: ${err instanceof Error ? err.message : String(err)}.`,
    })
    return
  }

  if (recomputedDigest !== first) {
    failures.push({
      rule: 17,
      field_path: "receipts[*].attestor.bundle_root_digest",
      stored: 0,
      recomputed: 0,
      delta: 0,
      tolerance: 0,
      message:
        `Rule 17 (trace-bundle binding): declared bundle_root_digest ${first} does not match ` +
        `recomputed digest ${recomputedDigest}. Receipt bytes have been mutated, spliced, or ` +
        `reordered after the bundle digest was bound. NOTE: Rule 17 is a BUNDLE INTEGRITY ` +
        `check, NOT a producer-authenticity check — an attacker who controls all receipt ` +
        `bytes and recomputes the bundle digest passes Rule 17 trivially. Combine with Rule 16 ` +
        `signed_subject_digest or an external signature for producer-identity binding.`,
    })
  }
}
