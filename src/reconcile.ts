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
  0: "Structural failure: receipt-internal contradiction (shape invalid, unsupported product_order, non-finite arithmetic, OR v0.4.1+ cross-consistency between bias_policy.mode / bias_sharing / Update.kind / topology declarations).",
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
  parameters?: TopologyParameter[]
  bias_sharing?: "per_layer" | "per_neuron"
}

type Contribution = {
  from: string
  downstream_signal: number
  via_weight: string
  weight_value: number
  value: number
}

type OutputErrorSignalShape = {
  factors: Factor[]
  product_order: "left_to_right"
  signal_value: number
}

type HiddenErrorSignalShape = {
  downstream_contributions: Contribution[]
  summation_order: string[]
  backpropagated_sum: number
  activation_derivative: number
  product_order: "left_to_right"
  signal_value: number
}

type Receipt = {
  numeric_policy: { tolerance: TolerancePolicy }
  bias_policy?: { mode?: string }
  updates: Update[]
  parameters_before?: Record<string, number>
  parameters_after?: Record<string, number>
  topology?: TopologyShape
  backward?: {
    output_error_signals?: Record<string, OutputErrorSignalShape>
    hidden_error_signals?: Record<string, HiddenErrorSignalShape>
  }
  trace_id?: string
  step_index?: number
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

  return failures.length === 0 ? { ok: true } : { ok: false, failures }
}
