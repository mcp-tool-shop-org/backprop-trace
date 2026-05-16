# Canonical JSONL Receipt Emission

Receipt bytes are determined by schema-ordered traversal. This is **not**
general JSON serialization. Round-tripping a receipt through `JSON.parse`
plus any re-serializer will produce different bytes than the original.

## Rules

### Object emission
- Keys appear in the order declared by their parent type in
  `schemas/receipt.v0.1.0.json` via the `x-order` annotation. Not insertion
  order. Not alphabetical. Schema order.
- Output: `{<key1>:<value1>,<key2>:<value2>,...}`
- No whitespace between tokens.

### Array emission
- Elements appear in declared array order. The fixture authors order; the
  engine preserves it.
- Output: `[<el1>,<el2>,...]`
- No whitespace between tokens.

### Numeric leaves
- Emitted via `formatNumberForEngine` (runtime formatter).
- Cross-checked against `formatDecimalStringForFixture` (policy formatter)
  for any decimal-string inputs the policy fixture covers.
- See `fixtures/formatter.policy.golden.json` for policy rules and
  `fixtures/templates/formatter.runtime-node.template.json` for runtime
  evidence shape.

### String leaves
- RFC 8259 section 7 escaping. Always double-quoted.

### Boolean / null
- `true`, `false`, `null` — literal lowercase.

### Whitespace
- None between tokens. No indentation. No trailing whitespace.

### Line terminator
- Each JSONL record ends with `\n` (LF, not CRLF).
- The last record in a file ends with `\n`. No additional trailing newline.

### Multi-record framing

JSONL receipts are framed with one record per line, each terminated by LF (`\n`).
A file with N records has N LF terminators including a trailing one — i.e.,
`{...}\n{...}\n{...}\n`. This matches the ndjson convention's "trailing newline
acceptable" reading, and is what `emitReceipts([r1, r2, r3])` produces.

A single-record file from `emitMazurReceipt(r)` is structurally `{...}\n` — the
N=1 case of the above. There is no separate single-record vs multi-record framing.
Library consumers writing multiple receipts should call `emitReceipts(receipts)`
rather than concatenating `emitMazurReceipt` outputs manually; the helper exists
so the trailing-LF contract has a single owner.

### Unknown keys
- Emission errors. Schema is closed; the receipt cannot contain undeclared
  fields. Verification likewise rejects receipts with unknown keys before
  reaching reconciliation.

## Declared order for dynamic keys

Object-typed fields whose keys are not fixed by the schema (parameter ids,
unit ids, etc.) require declared orderings.

### v0.1: hard-coded ordering for Mazur

Mazur-specific orderings live in `schemas/receipt.v0.1.0.json` as
`x-order` annotations on the relevant map-typed fields:

```
inputs:         ["i1", "i2"]
targets:        ["o1", "o2"]
parameters:     ["w1", "w2", "w3", "w4", "w5", "w6", "w7", "w8", "b1", "b2"]
hidden_units:   ["h1", "h2"]
output_units:   ["o1", "o2"]
```

### v0.2+: receipt-declared ordering

For general topologies (any network beyond Mazur), the receipt itself
carries the declared orderings:

```
"unit_order": {
  "input":  ["i1", "i2", ...],
  "hidden": ["h1", "h2", ...],
  "output": ["o1", "o2", ...]
},
"parameter_order": ["w1", "w2", ..., "b1", "b2", ...]
```

Canonical emission iterates these arrays. In v0.1 these fields are optional
and absent (Mazur is hard-coded). In v0.2 they become required for any
non-Mazur fixture. The v0.1 schema permits both shapes so the v0.2
transition is additive, not breaking.

## What this is NOT

- Not `JSON.stringify(obj)`. JavaScript object property order is not the
  schema contract, and `JSON.stringify` cannot preserve receipt numeric
  formatting such as trailing zeros.
- Not equivalent under any standard JSON normalizer. Standard normalizers
  use alphabetical key order; this uses schema order.
- Not human-pretty-printed. Pretty-printing happens in viewers, not in the
  on-disk receipt.

## Numeric emission ranges

Numeric leaves in receipts use plain-decimal notation only. Values whose
magnitude falls outside `plain_decimal_range`
(see `fixtures/formatter.policy.golden.json`) cause emission to error
rather than silently switching to scientific notation.

The range floor (currently `[1e-9, 1e7)`) is sized to admit every value
that v0.1 receipts can store — including `numeric_policy.tolerance`
(`1e-9` in v0.1), which sits at the floor itself. Receipt-resident data
(gradients, weights, signals, losses, inputs) sits well above the floor in
practice; the floor exists to keep configuration constants emittable, not
to clip data. If a future tolerance ever needs to be tighter than `1e-9`,
the floor expands first; the engine never invents scientific-notation
fallbacks.

Error messages and diagnostics are a separate code path
(`src/error-format.ts`) and **may** use scientific notation when reporting
delta magnitudes outside the plain-decimal range. Error-format and
receipt-format share no code with each other.

## Position in the law stack

Canonical emission is the byte-level contract. The trust hierarchy:

> Contract precedes engine. Formatter policy precedes runtime formatting.
> Bad receipts precede good receipts. Runtime formatting precedes Mazur.
> Mazur precedes diagnostics.

Canonical emission lives inside "formatter policy" and "runtime formatting" —
the policy says *what* numeric leaves must look like; canonical emission
says *how* those leaves are placed into the byte stream alongside non-numeric
leaves.

The reconciler (which validates math under `docs/reconciliation.md`) is
tested against bad receipts before any good receipt exists. Canonical
emission is therefore tested only after the reconciler is proven, since
byte-equality testing requires a trustworthy receipt to compare against.

## Related work and trade-offs

backprop-trace chose **schema-defined key order** (via `x-order` annotations)
over **alphabetical key order** (RFC 8785 JSON Canonicalization Scheme,
https://www.rfc-editor.org/rfc/rfc8785; RFC 8949 §4.2 CBOR core
deterministic encoding, https://www.rfc-editor.org/rfc/rfc8949.html). The
trade-off:

- **Alphabetical** (JCS / cJSON / CBOR-det): verifier needs zero schema
  dependency — can canonicalize any payload from bytes alone.
- **Schema-defined** (this repo): receipts read top-down in causal/execution
  order (inputs -> forward -> loss -> backward -> updates), which is
  auditor-friendly. The cost is that the schema becomes a load-bearing
  dependency of canonicalization: schema versioning is a security property,
  not a docs concern. backprop-trace addresses this by emitting
  `schema_version` as the first field of every receipt and freezing the
  v0.1 schema bytes.

The receipt schema maps cleanly to an in-toto attestation predicate
(`predicateType: "https://mcptoolshop.org/backprop-trace/receipt/v1"`),
making the path open to DSSE-wrapped, Rekor-logged provenance integration
later (https://github.com/in-toto/attestation/blob/main/spec/v1/envelope.md).
v0.1 does not ship this integration; the architectural seam exists.

## Reference class

backprop-trace is a **structural-trace verifier with canonical bytewise
encoding** — the fixture-determinism engine class (Jest snapshots, Rust insta),
NOT an ML metrics logger (TensorBoard, MLflow, Weights & Biases). The string IS
the contract here; production ML trackers treat the number as the contract and
let serialization vary. The closest formal analog in ML provenance is
Proof-of-Learning (Jia et al. IEEE S&P 2021,
https://ar5iv.labs.arxiv.org/html/2103.05633), which uses accumulated training
state to let verifiers recompute selected gradient steps.

The trace reproduction-status vocabulary used in this repo
(`bit_exact | math_only | drift_within_tolerance | failed_reconciliation`)
appears to be novel — no existing standard (W3C PROV, MLflow, ML-Schema,
FAIR4ML) covers this specific distinction.
