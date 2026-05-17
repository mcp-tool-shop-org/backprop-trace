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

Requirements: Node 22.x (pinned in `engines`). v0.3 is V8/Node 22 only
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
under all eight per-record rules (Rule 4 wired in v0.1; Rules 1, 2, 3,
5, 6, 7, 8 wired in v0.2; Rules 9 + 10 in v0.3 are multi-record and
skip on this single-record file).

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
# 0.3.0

npx bp --help
# Usage:
#   bp reconcile receipt <file>     Reconcile a receipt against the 10 rules
#   bp verify mazur [<file>]        Full gate (Mazur): schema + reconcile + ...
#   bp verify general <file>        Generalized verify gate (v0.2.0-schema)
#   bp verify multi <file.jsonl>    Multi-record verify (Rules 9, 10)
#   bp generate mazur               Re-run Mazur engine, emit canonical bytes
#   bp generate xor                 Re-run XOR engine, emit canonical bytes
#   bp generate iris                Re-run iris engine, emit canonical bytes
#   bp validate <file>              Schema-validate a receipt
#   bp --version                    Print version
#   bp --help                       Print this message
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

## 6. Beyond Mazur — XOR and iris (v0.3+)

v0.3 generalizes the engine beyond Mazur 2-2-2. The XOR-sigmoid 2-2-1
and iris-sigmoid 4-3-3 topologies ship as canonical fixtures and the
same 10-rule reconciler verifies them.

### CLI: generate + verify in one pipe

```bash
# Generate a fresh XOR receipt and verify it through the generalized gate.
npx bp generate xor | npx bp verify general -

# Or generate and reconcile the bundled iris fixture.
npx bp verify general node_modules/@mcptoolshop/backprop-trace/fixtures/iris.golden.jsonl
```

`bp verify general` runs the same fixed-order pipeline as `bp verify
mazur` but against the v0.2.0 schema and any topology. See
[`docs/cli.md`](./cli.md#subcommand-bp-verify-general-v03) for the
full reference.

### Library: programmatic XOR

```ts
import {
  runGeneralStep,
  emitGeneralReceipt,
  reconcileReceipt,
  XOR_INPUT,
} from '@mcptoolshop/backprop-trace';

const receipt = runGeneralStep(XOR_INPUT);

// Reconcile per-record (Rules 1-8 from the 10-rule set).
const result = reconcileReceipt(receipt);
if (!result.ok) { console.error(result.failures); process.exit(1); }

// Emit canonical bytes — same in-toto v1 attestation seam as the Mazur path.
const bytes = emitGeneralReceipt(receipt);
console.log(bytes);
```

### Library: multi-step training run

```ts
import {
  runMultiStep,
  emitReceipts,
  reconcileMultiStep,
  XOR_INPUT,
} from '@mcptoolshop/backprop-trace';

// Five-step training run sharing a single trace_id.
const receipts = runMultiStep(
  { ...XOR_INPUT, trace_id: 'a'.repeat(32), step_index: 0 },
  /* stepCount */ 5
);

// Reconcile per-record + Rule 9 (parameter chain) + Rule 10 (trace identity).
const result = reconcileMultiStep(receipts);
if (!result.ok) { console.error(result.failures); process.exit(1); }

// Multi-record JSONL: one record per line, trailing LF per record.
const jsonl = emitReceipts(receipts);
```

See [`docs/topology.md`](./topology.md) for authoring a custom
topology and [`docs/multi-step.md`](./multi-step.md) for the
trace_id / step_index contract.

## Where to go next

- **`docs/reconciliation.md`** — the ten reconciler rules in full.
  Quick-reference table at the top; v0.3 wires Rules 1-10.
- **`docs/canonical-emission.md`** — the byte-level encoding contract.
  Why schema-defined key order, not alphabetical. What `x-order` does.
- **`docs/computation-order.md`** — IEEE 754 ordering rules. Why FMA
  is prohibited. Hybrid tolerance (v0.3+).
- **`docs/schema.md`** — field-by-field walk-through of
  `schemas/receipt.v0.1.0.json` and `receipt.v0.2.0.json` with rationale.
- **`docs/topology.md`** (v0.3+) — author a custom topology end-to-end.
- **`docs/multi-step.md`** (v0.3+) — multi-step training receipts,
  `trace_id` + `step_index`, Rules 9 + 10.
- **`CONTRIBUTING.md`** — the law stack, the anti-circularity
  ratchet, and the "bad receipts precede good receipts" doctrine
  (Csmith, Yang et al. PLDI 2011).
- **`SECURITY.md`** — what counts as a vulnerability for a verifier
  (NaN poisoning, schema bypass, canonical-emission divergence,
  anti-circularity violation).
