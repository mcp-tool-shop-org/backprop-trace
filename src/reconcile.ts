/**
 * Reconciler v0.2 — implements all 8 rules from docs/reconciliation.md.
 *
 * Each rule has at least one bad-* fixture per the Csmith anti-circularity
 * doctrine (see docs/reconciliation.md "Failure-priority rule" and the
 * Csmith / CompCert lineage cited there). The reconciler answers one
 * question: does the math the receipt claims to have done actually add up?
 *
 * v0.1 wired Rule 4 (update.gradient) only. v0.2 adds:
 *   - Rule 1: output error signal == product(factors)
 *   - Rule 2: downstream contribution and backpropagated sum (two-part)
 *   - Rule 3: hidden error signal == backpropagated_sum * activation_derivative
 *   - Rule 5: update.update == optimizer.learning_rate * update.gradient
 *   - Rule 6: weight_after == weight_before + update
 *   - Rule 7: parameters_after final state (with bias-policy branch)
 *   - Rule 8: provenance reference (factor.from path resolution)
 *
 * Plus two cheap structural improvements:
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
 *   rule: 1-8 — the eight documented reconciliation rules.
 */

import type { NamedFactor } from "./engine.js"

/**
 * One reconciliation failure surfaced by reconcileReceipt.
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
 * updates[0].optimizer.product_order. v0.1 reconciler accepts only
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
 * Other rules (2, 5, 6, 7, 8) omit factors — their failures are fully
 * described by the numeric quartet alone.
 *
 * `cascade_of_rule` is set when a downstream rule fails on the same
 * parameter_id as an upstream rule in the same run. The CLI renders
 * "Note: cascades from Rule N. Fix Rule N first." so a reader can
 * prioritize the root cause.
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
   * Developer-facing hint. Populated for structural failures (rule === 0)
   * to explain WHAT to do, not just what failed. Undefined or empty for
   * numeric rule failures — those are fully described by the quartet.
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
   * "left_to_right" in v0.2 — the only product_order the engine emits and
   * the only one the reconciler accepts. Declared so a future rtl variant
   * can be distinguished without an additive field rename.
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
 * "The eight rules" headings and src/bin/bp.ts RULE_LABELS labels should
 * all derive from this table.
 *
 * Rule 0 is the structural-failure sentinel (NOT one of the eight rules
 * documented in docs/reconciliation.md, but a reconciler-internal slot
 * for shape/typing failures so the result stream stays uniformly
 * `{ ok: false; failures: [...] }` rather than mixing throws and
 * structured failures).
 *
 * v0.2 wires all eight rules; the table also serves as a registration
 * point so CLI labels and future MCP-tool descriptions pull from one
 * source.
 */
export const RULE_DESCRIPTIONS: Record<number, string> = {
  0: "Structural failure: receipt shape, unsupported product_order, or non-finite arithmetic.",
  1: "Output error signal consistency: signal_value == product(factors), left-to-right.",
  2: "Downstream contribution and backpropagated sum: contribution.value == downstream_signal * weight_value AND backpropagated_sum == sum(contributions in summation_order).",
  3: "Hidden error signal consistency: signal_value == backpropagated_sum * activation_derivative, left-to-right.",
  4: "Update gradient consistency: update.gradient == product(optimizer.factors), left-to-right.",
  5: "Update value consistency: update.update == optimizer.learning_rate * update.gradient.",
  6: "Weight progression: update.weight_after == update.weight_before + update.update.",
  7: "Final state consistency: parameters_after[param] == parameters_before[param] + sum(updates targeting param).",
  8: "Provenance reference consistency: each factor.from path resolves and factor.value matches the referenced field.",
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
  numeric_policy: { tolerance: number }
  bias_policy?: { mode?: string }
  updates: Update[]
  parameters_before?: Record<string, number>
  parameters_after?: Record<string, number>
  backward?: {
    output_error_signals?: Record<string, OutputErrorSignalShape>
    hidden_error_signals?: Record<string, HiddenErrorSignalShape>
  }
}

/**
 * Multiply factors strictly left-to-right per docs/computation-order.md.
 *
 * Exported so tests can prove the order matters (and so a future receipt
 * that declares a different product_order can be routed to a different
 * helper rather than secretly mis-multiplying).
 *
 * @param factors  Array of `{ value: number }`. Schema requires minItems 2,
 *                 but this helper accepts any length so it can be reused
 *                 outside Rule 4 in v0.2+.
 * @returns        The running product `((factors[0] * factors[1]) * factors[2]) ...`
 *                 evaluated strictly left-to-right with V8's binary64 *
 *                 operator (no FMA, no re-association). Returns `NaN` for
 *                 an empty input array — callers must flag empty factors
 *                 as a structural failure (the schema's minItems 2 catches
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
 * Reconcile the math claims in a backprop-trace receipt against the rules
 * documented in docs/reconciliation.md.
 *
 * v0.2 SCOPE: all 8 rules wired (1, 2, 3, 4, 5, 6, 7, 8). Cascade detection
 * fires on Rules 5/6/7 when an upstream rule failed on the same
 * parameter_id. See RULE_DESCRIPTIONS for the canonical rule descriptions.
 *
 * The function is tolerant of malformed receipts: instead of throwing, it
 * surfaces a typed Rule-0 (structural-failure) entry with a developer-
 * facing `message` explaining what was wrong (e.g. wrong product_order,
 * missing tolerance, fewer than 2 factors, NaN gradient). This keeps the
 * caller on a single discriminated-union code path.
 *
 * @param receipt  An unknown value, expected (but not enforced) to have
 *                 already passed JSON-Schema validation against
 *                 schemas/receipt.v0.1.0.json. The function performs a
 *                 minimal structural shape guard so a malformed receipt
 *                 produces a typed failure rather than a cryptic crash.
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
  // schemas/receipt.v0.1.0.json. This function does not re-validate
  // structure exhaustively; it performs a minimal structural shape guard
  // here so a malformed receipt produces a typed Rule-0 failure rather
  // than a cryptic crash (E-A-002).
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
            "). Run schema validation against schemas/receipt.v0.1.0.json before reconciling.",
        },
      ],
    }
  }
  const raw = receipt as { numeric_policy?: unknown; updates?: unknown }
  const np = raw.numeric_policy as { tolerance?: unknown } | undefined
  if (
    np === null ||
    typeof np !== "object" ||
    typeof np.tolerance !== "number" ||
    !Number.isFinite(np.tolerance)
  ) {
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
            "Receipt is missing required field 'numeric_policy.tolerance' or it is not a finite number. " +
            "Run schema validation against schemas/receipt.v0.1.0.json before reconciling.",
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
            "Run schema validation against schemas/receipt.v0.1.0.json before reconciling.",
        },
      ],
    }
  }

  const r = receipt as Receipt
  const failures: ReconciliationFailure[] = []
  const tolerance = r.numeric_policy.tolerance

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
// Per-rule check helpers — each takes the receipt, tolerance, the failures
// accumulator, and (when relevant) the cascade-state helpers. Helpers push
// directly into `failures` and `failuresByParam` via callbacks rather than
// returning arrays so the caller's traversal order is preserved exactly.
// ============================================================================

function checkRule1(
  r: Receipt,
  tolerance: number,
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
        tolerance,
        message:
          `Unsupported product_order ${JSON.stringify(unit.product_order)} at ` +
          `backward.output_error_signals.${unitId}.product_order. v0.2 reconciler accepts only ` +
          `'left_to_right' (see docs/reconciliation.md and docs/computation-order.md).`,
      })
      continue
    }
    const factors = unit.factors
    if (!Array.isArray(factors) || factors.length < 2) {
      failures.push({
        rule: 0,
        parameter_id: unitId,
        field_path: `backward.output_error_signals.${unitId}.factors`,
        stored: 0,
        recomputed: 0,
        delta: 0,
        tolerance,
        message:
          `backward.output_error_signals.${unitId}.factors has ` +
          (Array.isArray(factors) ? `${factors.length} entries` : `non-array type ${typeof factors}`) +
          `. v0.2 receipts require >= 2 factors per output error signal (schema minItems: 2).`,
      })
      continue
    }
    const product = multiplyFactorsLeftToRight(factors)
    const stored = unit.signal_value
    const delta = Math.abs(product - stored)
    if (!Number.isFinite(product) || !Number.isFinite(stored) || !Number.isFinite(delta)) {
      failures.push({
        rule: 1,
        parameter_id: unitId,
        field_path: `backward.output_error_signals.${unitId}.signal_value`,
        stored,
        recomputed: product,
        delta: Number.isFinite(delta) ? delta : Number.NaN,
        tolerance,
        factors: factors as NamedFactor[],
        product_order: "left_to_right",
      })
      recordFailure(1, unitId)
      continue
    }
    if (delta > tolerance) {
      failures.push({
        rule: 1,
        parameter_id: unitId,
        field_path: `backward.output_error_signals.${unitId}.signal_value`,
        stored,
        recomputed: product,
        delta,
        tolerance,
        factors: factors as NamedFactor[],
        product_order: "left_to_right",
      })
      recordFailure(1, unitId)
    }
  }
}

function checkRule2(
  r: Receipt,
  tolerance: number,
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
        tolerance,
        message:
          `backward.hidden_error_signals.${unitId}.downstream_contributions is not an array ` +
          `(got ${typeof contribs}). v0.2 receipts require an array of contribution records.`,
      })
      continue
    }
    // Rule 2a: each contribution.value == downstream_signal * weight_value.
    for (let j = 0; j < contribs.length; j++) {
      const c = contribs[j]!
      const product = c.downstream_signal * c.weight_value
      const stored = c.value
      const delta = Math.abs(product - stored)
      if (!Number.isFinite(product) || !Number.isFinite(stored) || !Number.isFinite(delta)) {
        failures.push({
          rule: 2,
          parameter_id: unitId,
          field_path: `backward.hidden_error_signals.${unitId}.downstream_contributions[${j}].value`,
          stored,
          recomputed: product,
          delta: Number.isFinite(delta) ? delta : Number.NaN,
          tolerance,
        })
        recordFailure(2, unitId)
        continue
      }
      if (delta > tolerance) {
        failures.push({
          rule: 2,
          parameter_id: unitId,
          field_path: `backward.hidden_error_signals.${unitId}.downstream_contributions[${j}].value`,
          stored,
          recomputed: product,
          delta,
          tolerance,
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
        tolerance,
        message:
          `backward.hidden_error_signals.${unitId}.summation_order is not an array ` +
          `(got ${typeof order}). v0.2 receipts require a declared summation_order.`,
      })
      continue
    }
    const sum = sumInOrder(contribs, order, (c) => c.from, (c) => c.value)
    const storedSum = unit.backpropagated_sum
    const delta2 = Math.abs(sum - storedSum)
    if (!Number.isFinite(sum) || !Number.isFinite(storedSum) || !Number.isFinite(delta2)) {
      failures.push({
        rule: 2,
        parameter_id: unitId,
        field_path: `backward.hidden_error_signals.${unitId}.backpropagated_sum`,
        stored: storedSum,
        recomputed: sum,
        delta: Number.isFinite(delta2) ? delta2 : Number.NaN,
        tolerance,
      })
      recordFailure(2, unitId)
      continue
    }
    if (delta2 > tolerance) {
      failures.push({
        rule: 2,
        parameter_id: unitId,
        field_path: `backward.hidden_error_signals.${unitId}.backpropagated_sum`,
        stored: storedSum,
        recomputed: sum,
        delta: delta2,
        tolerance,
      })
      recordFailure(2, unitId)
    }
  }
}

function checkRule3(
  r: Receipt,
  tolerance: number,
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
        tolerance,
        message:
          `Unsupported product_order ${JSON.stringify(unit.product_order)} at ` +
          `backward.hidden_error_signals.${unitId}.product_order. v0.2 reconciler accepts only ` +
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
    const delta = Math.abs(product - stored)
    if (!Number.isFinite(product) || !Number.isFinite(stored) || !Number.isFinite(delta)) {
      failures.push({
        rule: 3,
        parameter_id: unitId,
        field_path: `backward.hidden_error_signals.${unitId}.signal_value`,
        stored,
        recomputed: product,
        delta: Number.isFinite(delta) ? delta : Number.NaN,
        tolerance,
        factors: operands,
        product_order: "left_to_right",
      })
      recordFailure(3, unitId)
      continue
    }
    if (delta > tolerance) {
      failures.push({
        rule: 3,
        parameter_id: unitId,
        field_path: `backward.hidden_error_signals.${unitId}.signal_value`,
        stored,
        recomputed: product,
        delta,
        tolerance,
        factors: operands,
        product_order: "left_to_right",
      })
      recordFailure(3, unitId)
    }
  }
}

function checkRule4(
  r: Receipt,
  tolerance: number,
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
        tolerance,
        message:
          `Unsupported product_order ${JSON.stringify(update.optimizer.product_order)} at ` +
          `updates[${i}].optimizer.product_order. v0.2 reconciler accepts only 'left_to_right' ` +
          `(see docs/reconciliation.md and docs/computation-order.md).`,
      })
      continue
    }
    const factors = update.optimizer.factors
    // E-A-012: defense-in-depth length check. Schema guarantees minItems 2
    // on factors, but if a malformed receipt reaches this point we surface
    // a Rule-0 failure instead of trusting factors[0]!.
    if (!Array.isArray(factors) || factors.length < 2) {
      failures.push({
        rule: 0,
        parameter_id: update.parameter_id,
        field_path: `updates[${i}].optimizer.factors`,
        stored: 0,
        recomputed: 0,
        delta: 0,
        tolerance,
        message:
          `updates[${i}].optimizer.factors has ` +
          (Array.isArray(factors) ? `${factors.length} entries` : `non-array type ${typeof factors}`) +
          `. v0.2 receipts require >= 2 factors per optimizer (schema minItems: 2).`,
      })
      continue
    }
    // E-A-008: factor multiplication is delegated to the exported helper
    // so the order is named (multiplyFactorsLeftToRight) rather than
    // implicit, and tests can compare it against multiplyFactorsRightToLeft
    // to prove product_order is load-bearing.
    const product = multiplyFactorsLeftToRight(factors)
    const stored = update.gradient
    const delta = Math.abs(product - stored)
    // E-A-001: NaN-poisoning guard. Math.abs(NaN - x) is NaN and NaN >
    // tolerance is false, so a non-finite product, stored gradient, or
    // delta would silently pass the threshold check below. Surface those
    // cases as a Rule 4 failure with delta: NaN when delta itself is not
    // finite. Catches non-finite factors (multiplyFactorsLeftToRight
    // propagates NaN/Infinity through the product) and a non-finite
    // stored gradient.
    if (
      !Number.isFinite(product) ||
      !Number.isFinite(stored) ||
      !Number.isFinite(delta)
    ) {
      failures.push({
        rule: 4,
        parameter_id: update.parameter_id,
        field_path: `updates[${i}].gradient`,
        stored,
        recomputed: product,
        delta: Number.isFinite(delta) ? delta : Number.NaN,
        tolerance,
        factors: factors as NamedFactor[],
        product_order: "left_to_right",
      })
      recordFailure(4, update.parameter_id)
      continue
    }
    if (delta > tolerance) {
      failures.push({
        rule: 4,
        parameter_id: update.parameter_id,
        field_path: `updates[${i}].gradient`,
        stored,
        recomputed: product,
        delta,
        tolerance,
        factors: factors as NamedFactor[],
        product_order: "left_to_right",
      })
      recordFailure(4, update.parameter_id)
    }
  }
}

function checkRule5(
  r: Receipt,
  tolerance: number,
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
    const delta = Math.abs(recomputed - stored)
    if (!Number.isFinite(recomputed) || !Number.isFinite(stored) || !Number.isFinite(delta)) {
      const cascade = priorFailureRule(update.parameter_id, [4])
      const fail: ReconciliationFailure = {
        rule: 5,
        parameter_id: update.parameter_id,
        field_path: `updates[${i}].update`,
        stored,
        recomputed,
        delta: Number.isFinite(delta) ? delta : Number.NaN,
        tolerance,
      }
      if (cascade !== undefined) fail.cascade_of_rule = cascade
      failures.push(fail)
      recordFailure(5, update.parameter_id)
      continue
    }
    if (delta > tolerance) {
      const cascade = priorFailureRule(update.parameter_id, [4])
      const fail: ReconciliationFailure = {
        rule: 5,
        parameter_id: update.parameter_id,
        field_path: `updates[${i}].update`,
        stored,
        recomputed,
        delta,
        tolerance,
      }
      if (cascade !== undefined) fail.cascade_of_rule = cascade
      failures.push(fail)
      recordFailure(5, update.parameter_id)
    }
  }
}

function checkRule6(
  r: Receipt,
  tolerance: number,
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
    const delta = Math.abs(recomputed - stored)
    if (!Number.isFinite(recomputed) || !Number.isFinite(stored) || !Number.isFinite(delta)) {
      const cascade = priorFailureRule(update.parameter_id, [4, 5])
      const fail: ReconciliationFailure = {
        rule: 6,
        parameter_id: update.parameter_id,
        field_path: `updates[${i}].weight_after`,
        stored,
        recomputed,
        delta: Number.isFinite(delta) ? delta : Number.NaN,
        tolerance,
      }
      if (cascade !== undefined) fail.cascade_of_rule = cascade
      failures.push(fail)
      recordFailure(6, update.parameter_id)
      continue
    }
    if (delta > tolerance) {
      const cascade = priorFailureRule(update.parameter_id, [4, 5])
      const fail: ReconciliationFailure = {
        rule: 6,
        parameter_id: update.parameter_id,
        field_path: `updates[${i}].weight_after`,
        stored,
        recomputed,
        delta,
        tolerance,
      }
      if (cascade !== undefined) fail.cascade_of_rule = cascade
      failures.push(fail)
      recordFailure(6, update.parameter_id)
    }
  }
}

function checkRule7(
  r: Receipt,
  tolerance: number,
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
        tolerance,
        message:
          `parameters_after.${paramId} is not a number (got ${typeof storedAfter}). ` +
          `Run schema validation against schemas/receipt.v0.1.0.json before reconciling.`,
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
        tolerance,
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
      const delta = Math.abs(recomputed - storedAfter)
      if (!Number.isFinite(recomputed) || !Number.isFinite(storedAfter) || !Number.isFinite(delta)) {
        const cascade = priorFailureRule(paramId, [4, 5, 6])
        const fail: ReconciliationFailure = {
          rule: 7,
          parameter_id: paramId,
          field_path: `parameters_after.${paramId}`,
          stored: storedAfter,
          recomputed,
          delta: Number.isFinite(delta) ? delta : Number.NaN,
          tolerance,
        }
        if (cascade !== undefined) fail.cascade_of_rule = cascade
        failures.push(fail)
        recordFailure(7, paramId)
        continue
      }
      if (delta > tolerance) {
        const cascade = priorFailureRule(paramId, [4, 5, 6])
        const fail: ReconciliationFailure = {
          rule: 7,
          parameter_id: paramId,
          field_path: `parameters_after.${paramId}`,
          stored: storedAfter,
          recomputed,
          delta,
          tolerance,
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
          tolerance,
          message:
            `Underdetermined: parameter not in updates and bias_policy.mode is not 'constant' ` +
            `(got '${biasMode ?? "undefined"}'). v0.1 reconciler cannot certify this combination.`,
        })
      }
    }
  }
}

function checkRule8(
  r: Receipt,
  tolerance: number,
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
  tolerance: number,
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
      tolerance,
      message:
        `Provenance path ${JSON.stringify(fromPath)} could not be resolved (referenced from ${factorPath}): ${resolved.reason}.`,
    })
    return
  }
  const stored = factor.value
  const recomputed = resolved.value
  const delta = Math.abs(recomputed - stored)
  if (!Number.isFinite(stored) || !Number.isFinite(delta)) {
    failures.push({
      rule: 8,
      parameter_id,
      field_path: fromPath,
      stored,
      recomputed,
      delta: Number.isFinite(delta) ? delta : Number.NaN,
      tolerance,
    })
    return
  }
  if (delta > tolerance) {
    failures.push({
      rule: 8,
      parameter_id,
      field_path: fromPath,
      stored,
      recomputed,
      delta,
      tolerance,
    })
  }
}
