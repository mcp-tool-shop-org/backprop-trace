/**
 * Reconciler for backprop-trace receipts. Implements the rules in
 * docs/reconciliation.md.
 *
 * v0.1 implements only what's needed to catch the bad-gradient fixture:
 * Rule 4 — update.gradient == product(optimizer.factors).
 *
 * Other rules will be added as additional bad-receipt fixtures land in v0.2+.
 */

export type ReconciliationFailure = {
  rule: number;
  parameter_id?: string;
  field_path: string;
  stored: number;
  recomputed: number;
  delta: number;
  tolerance: number;
  cascade_of_rule?: number;
};

export type ReconciliationResult =
  | { ok: true }
  | { ok: false; failures: ReconciliationFailure[] };

type Factor = { name: string; from?: string; value: number };

type Optimizer = {
  name: string;
  learning_rate: number;
  factors: Factor[];
  product_order: "left_to_right";
};

type Update = {
  parameter_id: string;
  weight_before: number;
  optimizer: Optimizer;
  gradient: number;
  update: number;
  weight_after: number;
};

type Receipt = {
  numeric_policy: { tolerance: number };
  updates: Update[];
};

export function reconcileReceipt(receipt: unknown): ReconciliationResult {
  // Precondition: the receipt has passed schema validation against
  // schemas/receipt.v0.1.0.json. This function does not re-validate
  // structure; it only checks math relationships.
  const r = receipt as Receipt;
  const failures: ReconciliationFailure[] = [];
  const tolerance = r.numeric_policy.tolerance;

  for (let i = 0; i < r.updates.length; i++) {
    const update = r.updates[i]!;
    if (update.optimizer.product_order !== "left_to_right") {
      throw new Error(
        `Unsupported product_order at updates[${i}]: ${String(update.optimizer.product_order)}`,
      );
    }
    const factors = update.optimizer.factors;
    let product = factors[0]!.value;
    for (let j = 1; j < factors.length; j++) {
      product = product * factors[j]!.value;
    }
    const stored = update.gradient;
    const delta = Math.abs(product - stored);
    if (delta > tolerance) {
      failures.push({
        rule: 4,
        parameter_id: update.parameter_id,
        field_path: `updates[${i}].gradient`,
        stored,
        recomputed: product,
        delta,
        tolerance,
      });
    }
  }

  if (failures.length === 0) {
    return { ok: true };
  }
  return { ok: false, failures };
}
