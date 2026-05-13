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

export function reconcileReceipt(_receipt: unknown): ReconciliationResult {
  throw new Error("NOT_IMPLEMENTED");
}
