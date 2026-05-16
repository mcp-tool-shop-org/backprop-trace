# Quickstart

A five-minute walk-through. By the end you'll have installed
backprop-trace, run the reconciler on a passing receipt and a
deliberately-broken one, and called the library from your own code.

## 1. Install

```bash
pnpm add @mcptoolshop/backprop-trace
```

Or:

```bash
npm install @mcptoolshop/backprop-trace
```

Requirements: Node 22.x (pinned in `engines`). v0.1 is V8/Node 22 only
— see `Determinism scope` in the README for why.

## 2. Reconcile the Mazur golden receipt — exit 0

The package ships its fixtures under `fixtures/`. Run the bp CLI
against the canonical golden:

```bash
npx bp reconcile receipt node_modules/@mcptoolshop/backprop-trace/fixtures/mazur.golden.jsonl
echo $?
# 0
```

No stderr output; exit 0. The receipt's math is internally consistent
under Rule 4 (the only v0.1-wired rule).

## 3. Reconcile the bad-gradient fixture — exit 1

The package also ships the deliberately-broken anti-circularity
fixture. This receipt mutates `updates[4].gradient` (w5) by 1e-6 —
exactly 1000x the v0.1 tolerance of 1e-9 — while leaving all factor
values unchanged.

```bash
npx bp reconcile receipt node_modules/@mcptoolshop/backprop-trace/fixtures/bad/mazur.bad-gradient.jsonl
echo $?
# 1
```

Stderr names Rule 4, the affected `parameter_id` (w5), stored vs
recomputed gradients, the delta in scientific notation, and the
tolerance. This is correct — the fixture is **deliberately broken**;
the reconciler is supposed to reject it. See
`docs/reconciliation.md` "Failure-priority rule" for why the rule
violation must surface BEFORE the receipt's
`fixture_status.verification_state` metadata, and the Csmith /
CompCert lineage in the same doc for the academic precedent.

## 4. Try the CLI surface

```bash
npx bp --version
# 0.1.0

npx bp --help
# Usage:
#   bp reconcile receipt <file>    Reconcile a receipt against the math rules.
#   bp --version                   Print version
#   bp --help                      Print this message
# ...

npx bp reconcile receipt --help
# Usage: bp reconcile receipt <file> [--json] [--verbose]
# ...
```

Machine-readable mode for CI consumers:

```bash
npx bp reconcile receipt some-receipt.jsonl --json
# stdout: {"ok":true}    (or)
# stdout: {"ok":false,"failures":[{...}]}
# exit:   0              (or)    1
```

## 5. Use the library from your own code

```ts
import {
  reconcileReceipt,
  runMazurStep,
  MAZUR_INPUT,
  emitMazurReceipt,
} from '@mcptoolshop/backprop-trace';

// Run the engine on the canonical Mazur input.
const receipt = runMazurStep(MAZUR_INPUT);

// Reconcile the math.
const result = reconcileReceipt(receipt);
if (!result.ok) {
  console.error(result.failures);
  process.exit(1);
}

// Emit the canonical bytes (schema-ordered, plain-decimal, LF-terminated).
const bytes = emitMazurReceipt(receipt);
console.log(bytes);
```

Subpath imports are also available if you want to pull only what
you need: `@mcptoolshop/backprop-trace/reconcile`,
`/engine`, `/mazur`, `/emit`, `/format`, `/runtime-format`,
`/schema` (the JSON Schema file).

## Where to go next

- **`docs/reconciliation.md`** — the eight reconciler rules in full.
  Quick-reference table at the top; v0.1 wires Rule 4 only.
- **`docs/canonical-emission.md`** — the byte-level encoding contract.
  Why schema-defined key order, not alphabetical. What `x-order` does.
- **`docs/computation-order.md`** — IEEE 754 ordering rules. Why FMA
  is prohibited. How the reconciler handles tolerance.
- **`docs/schema.md`** — field-by-field walk-through of
  `schemas/receipt.v0.1.0.json` with rationale.
- **`CONTRIBUTING.md`** — the law stack, the anti-circularity
  ratchet, and the "bad receipts precede good receipts" doctrine
  (Csmith, Yang et al. PLDI 2011).
- **`SECURITY.md`** — what counts as a vulnerability for a verifier
  (NaN poisoning, schema bypass, canonical-emission divergence,
  anti-circularity violation).
