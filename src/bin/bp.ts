#!/usr/bin/env node
/**
 * bp — backprop-trace CLI
 *
 * v0.1 surface (minimal, no framework):
 *
 *   bp reconcile receipt <file>    Run the reconciler on a receipt JSON/JSONL file.
 *                                  Exit 0 if all rules pass within tolerance.
 *                                  Exit 1 with stderr describing failures otherwise.
 *
 * Unknown commands exit 2 with a usage message.
 */

import { readFileSync } from "node:fs";
import { reconcileReceipt, type ReconciliationFailure } from "../reconcile.js";

function renderFailure(f: ReconciliationFailure): string {
  const lines = [
    `Rule ${f.rule}: update.gradient mismatch on ${f.parameter_id ?? "(unknown parameter)"}`,
    `  field_path:          ${f.field_path}`,
    `  stored gradient:     ${f.stored}`,
    `  recomputed gradient: ${f.recomputed}`,
    `  delta:               ${f.delta.toExponential(9)}`,
    `  tolerance:           ${f.tolerance.toExponential(9)}`,
  ];
  if (f.cascade_of_rule !== undefined) {
    lines.push(`  cascade of Rule ${f.cascade_of_rule}`);
  }
  lines.push("");
  return lines.join("\n");
}

const argv = process.argv.slice(2);

if (argv[0] === "reconcile" && argv[1] === "receipt" && typeof argv[2] === "string") {
  const file = argv[2];
  const receipt = JSON.parse(readFileSync(file, "utf-8"));
  const result = reconcileReceipt(receipt);
  if (result.ok) {
    process.exit(0);
  }
  process.stderr.write("reconciliation failed\n\n");
  for (const f of result.failures) {
    process.stderr.write(renderFailure(f));
  }
  process.exit(1);
}

process.stderr.write("usage: bp reconcile receipt <file>\n");
process.exit(2);
