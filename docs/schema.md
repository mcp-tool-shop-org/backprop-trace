# Receipt schema (v0.1.0) — field-by-field guide

This walks through `schemas/receipt.v0.1.0.json` (JSON Schema draft
2020-12, `additionalProperties: false`) and explains each field's role.
The schema is the **load-bearing contract** of the law stack:

> Contract precedes engine. Formatter policy precedes runtime formatting.
> Bad receipts precede good receipts. Runtime formatting precedes Mazur.
> Mazur precedes diagnostics.

Three properties of this schema are non-negotiable:

1. **Closed.** `additionalProperties: false` at every level. A receipt
   may not carry fields the schema does not declare. Unknown keys are
   rejected before reconciliation runs.
2. **`x-order`-annotated.** Every object type carries an `x-order` array.
   Canonical emission walks each object in this order to determine byte
   placement — not alphabetical, not insertion order. See
   `docs/canonical-emission.md` for the encoding choice rationale
   (schema-defined key order vs JCS / CBOR-det alphabetical), grounded
   in IETF RFC 8785 (https://www.rfc-editor.org/rfc/rfc8785) and
   RFC 8949 §4.2 (https://www.rfc-editor.org/rfc/rfc8949.html).
3. **Frozen.** A v0.1.0 schema file is never edited in place. Any
   addition of a required field is a breaking change and bumps the
   schema_version (e.g. `0.1.0` → `0.2.0`) with a new schema file.
   See `CONTRIBUTING.md` "Schema-version policy".

## Top-level fields

`schemas/receipt.v0.1.0.json` defines a closed object with the
`x-order` shown below. The canonical emitter walks this order
top-to-bottom and emits each present field in turn.

```
schema_version
fixture
step
fixture_status
metadata
numeric_policy
bias_policy
topology
learning_rate
inputs
targets
parameters_before
forward
loss
backward
updates
parameters_after
post_update_forward
post_update_loss
unit_order
parameter_order
```

### `schema_version` (required, `const: "0.1.0"`)

Always the first field. Pinning `schema_version` first makes it
trivially extractable from the first ~30 bytes of any receipt, which
matters for canonical-emission verification: a verifier can decide
which schema to load before parsing further.

### `fixture` (required, string)

Free-form fixture identifier. The Mazur golden uses `"mazur-2-2-2"`.

### `step` (required, integer ≥ 1)

The 1-indexed training step. v0.1 only ships step-1 receipts; step-2+
arrives in v0.2 once multi-step semantics are pinned.

### `fixture_status` (required, FixtureStatus object)

Lifecycle metadata about the receipt itself — whether it's hand-derived
or engine-generated, whether it's a canonical golden or a draft, and
(for `bad/*` fixtures) whether the receipt is *expected to fail
reconciliation*.

**This field is consulted only AFTER reconciliation completes.** The
anti-circularity ratchet — see `docs/reconciliation.md` "Failure-priority
rule" — forbids the reconciler from reading lifecycle metadata before
running rule checks. A receipt cannot self-declare "I am broken, please
trust me."

x-order: `authoring_state, verification_state, canonical, promote_to,
describes_in, blockers_to_promotion`

### `metadata` (optional, free-form object)

Provenance and authoring notes. Permissive in v0.1; v0.2+ may lock the
shape.

### `numeric_policy` (required, NumericPolicy object)

Pins the numeric encoding of the receipt. v0.1 hard-codes:

- `number_encoding: "decimal"`
- `precision_significant_digits: 9`
- `rounding: "round_half_to_even"` (IEEE 754 §4.3.1 default;
  banker's rounding)
- `tolerance: 1e-9`

`tolerance` is the per-comparison threshold the reconciler uses for
`Math.abs(stored - recomputed) <= tolerance`. Outside this window, the
rule fails; inside (or equal), the rule passes. The reconciler also
guards `Number.isFinite` before the threshold check — `NaN > 1e-9` is
`false`, so NaN-poisoning would otherwise silently pass.

x-order: `number_encoding, precision_significant_digits, rounding,
tolerance, computation_order, byte_output`

### `bias_policy` (required, BiasPolicy object)

Declares whether biases participate in updates this step. The Mazur
fixture sets `mode: "constant"` (biases not updated in step 1, per
Mazur's hand-derivation). v0.2+ adds `mode: "sgd"` for bias-update
fixtures.

The reconciler's Rule 7 ("Parameter final state consistency") depends
on this: when `bias_policy.mode == "constant"`, a parameter that
appears in `parameters_after` but not in `updates` must have its
before-value preserved *exactly* (zero-delta, no tolerance). When
`mode` is non-constant and a parameter is absent from `updates`, the
combination is underdetermined and the reconciler refuses to certify.

x-order: `mode, reason, updated_in_step, reconciliation`

### `topology` (required, Topology object)

The network shape. v0.1 fixes `activation: "sigmoid"`,
`loss: "half_squared_error"` (MSE without the 1/2 dropped),
`bias_sharing: "per_layer"`. The shape fields (`input_size`,
`hidden_size`, `output_size`) record the dimensions for any reader who
doesn't want to count from `inputs` / `targets`.

x-order: `layers, input_size, hidden_size, output_size, activation,
loss, bias_sharing`

### `learning_rate` (required, number > 0)

The SGD learning rate for this step. The Mazur fixture uses `0.5`.
v0.1 only supports SGD with no momentum / no weight decay / no Adam;
this scalar is the entire optimizer state.

### `inputs` / `targets` / `parameters_before` / `parameters_after`

The named-scalar maps for the fixture. v0.1 hard-codes the Mazur
2-2-2 shape: `i1/i2`, `o1/o2`, `w1..w8 + b1/b2`. Each is a closed
object with its `x-order` pinned by the schema, so canonical emission
is deterministic without any receipt-side ordering declaration.

In v0.2+ this lifts to `unit_order` / `parameter_order` fields that
the receipt itself carries — see `docs/canonical-emission.md`
"Declared order for dynamic keys". The v0.1 schema permits both
shapes so the v0.2 transition is additive, not breaking.

### `forward` (required, ForwardMazur)

The forward pass values for each unit. For the Mazur 2-2-2 fixture
this is `h1, h2, o1, o2`, each a `ForwardUnit` with `net` (pre-
activation) and `out` (post-activation).

x-order at unit level: `net, out`

### `loss` (required, Loss object)

`per_output: { o1, o2 }` for the per-output losses, plus `total`
(their sum). For half-squared-error loss the formula is
`L_i = 0.5 * (target_i - out_i)^2`, summed across outputs.

x-order: `per_output, total`

### `backward` (required, BackwardMazur)

The backward pass. Split into two named buckets:

#### `output_error_signals: { o1, o2 }`

Each `OutputErrorSignal` carries:

- `factors`: an array of `NamedFactor` objects (each `{ name, from?,
  value }`). For Mazur outputs these are typically `dL/dout` and
  `dout/dnet`.
- `product_order: "left_to_right"` (the only permitted value in v0.1
  — see `docs/computation-order.md` for FMA-prohibition and ordering
  rationale).
- `signal_value`: the product of all factor values in declared order.
  Rule 1 in v0.2+ will verify this equality (Rule 1 is currently
  documented but not wired; v0.1 ships only Rule 4).

x-order: `factors, product_order, signal_value`

#### `hidden_error_signals: { h1, h2 }`

Each `HiddenErrorSignal` carries:

- `downstream_contributions`: an array of `DownstreamContribution`,
  each `{ from, downstream_signal, via_weight, weight_value, value }`.
  `value` = `downstream_signal * weight_value`.
- `summation_order`: declared array of `from` ids (e.g. `["o1", "o2"]`)
  in the canonical sum order.
- `backpropagated_sum`: the result of summing contributions in
  `summation_order`.
- `activation_derivative`: `out * (1 - out)` for sigmoid.
- `product_order: "left_to_right"`.
- `signal_value`: `backpropagated_sum * activation_derivative`.

x-order: `downstream_contributions, summation_order, backpropagated_sum,
activation_derivative, product_order, signal_value`

### `updates` (required, array of `Update`, minItems 1)

The per-parameter update records. Each `Update`:

- `parameter_id`: e.g. `"w5"`.
- `kind`: `"weight"` or `"bias"`.
- `layer_edge`: `"input_to_hidden" | "hidden_to_output" |
  "bias_to_layer"` — auditor-friendly classification.
- `parameter_role` / `from_unit` / `to_unit`: optional human-facing
  labels.
- `weight_before`: parameter value going into the step.
- `optimizer`: an embedded object pinning `name: "sgd"`, the
  `learning_rate` (must equal the receipt's top-level `learning_rate`),
  the `factors` (e.g. `dL/dout`, `dout/dnet`, `dnet/dweight`), and
  `product_order: "left_to_right"`.
- `gradient`: product of `optimizer.factors` in `product_order`. **Rule
  4 (the only v0.1-wired rule) checks this equality.**
- `update`: `learning_rate * gradient` (v0.2+ Rule 5).
- `weight_after`: `weight_before + update` (v0.2+ Rule 6).

x-order: `parameter_id, kind, layer_edge, parameter_role, from_unit,
to_unit, weight_before, optimizer, gradient, update, weight_after`

### `post_update_forward` / `post_update_loss` (optional)

The forward pass and loss computed *after* applying the step's
updates. v0.1 receipts may carry these in `status: "filled"` form
(the Mazur golden does) or in `status: "pending_engine_first_run"`
(the bad-gradient fixture does, intentionally — the anti-circularity
ratchet forbids the reconciler from short-circuiting on this status).

x-order at this layer: `status, required_before_promotion,
fields_required, fill_specification, note, h1, h2, o1, o2` (for
forward); analogous for loss.

### `unit_order` / `parameter_order` (optional, v0.2+ forward-compat)

v0.2+ fields for general topologies. In v0.1 receipts these are
absent; Mazur orderings are hard-coded via the `*Mazur` `$defs`. The
v0.1 schema permits both shapes so a v0.2 receipt with these fields
still passes v0.1 schema validation if it follows Mazur shape (i.e.,
the additive transition is non-breaking for Mazur-shaped data).

## NamedFactor (cross-cutting type)

`NamedFactor` appears in `output_error_signals[*].factors`,
`updates[*].optimizer.factors`, and (indirectly, by analogous shape)
inside `hidden_error_signals[*].downstream_contributions[*]`.

Shape: `{ name: string, from?: string, value: number }`, x-order:
`name, from, value`.

- `name`: free-form label (e.g. `"dL/dout"`, `"dnet/dw5"`). Not
  validated by Rule 4; Rule 4 only multiplies values.
- `from`: optional dotted path into the receipt (e.g.
  `"backward.output_error_signals.o1.signal_value"`). Rule 8 in v0.2+
  will verify that the factor's `value` equals the value at this
  path. Factors without `from` skip Rule 8 (their values are taken on
  faith at the leaf; they can't lie about provenance because they
  don't claim provenance).
- `value`: the numeric value used by the rule's product.

## Receipt-emission ordering example

Putting the schema and `x-order` together, the first few bytes of any
v0.1 receipt look like:

```
{"schema_version":"0.1.0","fixture":"<id>","step":1,"fixture_status":{...},...
```

with the rest of the fields appended in the top-level `x-order` above,
each object recursing into its own `x-order`. There is no whitespace
between tokens. Each JSONL record ends with a single `\n` (LF, not
CRLF). The last record in a file ends with `\n` and no additional
trailing newline.

See `docs/canonical-emission.md` for the full encoding rules and
`fixtures/formatter.policy.golden.json` for the 24 test cases covering
round-half-to-even, carry propagation, negative-zero normalization,
scope rejection, and tie behavior.

## Why schema-defined order (not alphabetical)?

backprop-trace chose schema-defined `x-order` over the alphabetical
ordering of IETF RFC 8785 (JSON Canonicalization Scheme) /
RFC 8949 §4.2 (CBOR core deterministic encoding). The trade-off:

- **Alphabetical** (JCS / cJSON / CBOR-det): the verifier needs zero
  schema dependency — it can canonicalize any payload from bytes alone.
- **Schema-defined** (this repo): receipts read top-down in
  causal/execution order (inputs → forward → loss → backward →
  updates), which is auditor-friendly. The cost is that the schema
  becomes a load-bearing dependency of canonicalization, so schema
  versioning becomes a security property rather than just a docs
  concern. backprop-trace addresses this by emitting `schema_version`
  as the first field of every receipt and freezing the v0.1 schema
  bytes.

This is also Finding 3 of the research-grounding doc: the canonical-
encoding choice is the load-bearing seam for the in-toto attestation
predicate (`predicateType:
"https://mcptoolshop.org/backprop-trace/receipt/v1"`), making the path
open to DSSE-wrapped, Rekor-logged provenance integration later
(https://github.com/in-toto/attestation/blob/main/spec/v1/envelope.md).
v0.1 does not ship that integration; the architectural seam exists.

## Reference

- Schema file: `schemas/receipt.v0.1.0.json`
- Reconciliation rules: `docs/reconciliation.md`
- Computation order: `docs/computation-order.md`
- Canonical emission rules: `docs/canonical-emission.md`
- Formatter policy fixture: `fixtures/formatter.policy.golden.json`
- Mazur golden receipt (engine output): `fixtures/mazur.golden.jsonl`
- Anti-circularity bad fixture: `fixtures/bad/mazur.bad-gradient.jsonl`
