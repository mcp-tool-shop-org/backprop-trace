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
