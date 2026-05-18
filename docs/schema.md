# Schemas — field-by-field guide

backprop-trace ships TWO families of schemas:

**Receipt schemas (engine OUTPUTS):**

- **`schemas/receipt.v0.1.0.json`** — the original Mazur 2-2-2 schema
  (v0.1 / v0.2 wave). Pinned. Fixed unit/parameter key sets.
- **`schemas/receipt.v0.2.0.json`** — the generalized + multi-step schema
  (v0.3 wave; v0.4 widens it additively for per-neuron bias). Required
  `unit_order` + `parameter_order` for arbitrary topologies;
  hybrid-tolerance object form for `numeric_policy.tolerance`; optional
  `trace_id` + `step_index` for multi-step receipts.

**Input-config schema (engine INPUTS, v0.4+):**

- **`schemas/topology-input.v0.4.0.json`** — validates the JSON files that
  `bp generate from-config` and `bp validate-input` consume. SEPARATE from
  the receipt schemas; `additionalProperties: false` FORBIDS receipt-only
  fields. See "Topology input schema (v0.4+)" below.

All schemas are JSON Schema draft 2020-12 (`$schema:
"https://json-schema.org/draft/2020-12/schema"`), `additionalProperties:
false` at every level, and `x-order`-annotated for canonical emission.

### Compatibility note: in-place additive evolution of receipt.v0.4.0

backprop-trace bundles its own schemas with each published package version
(via the `files: ["schemas/**", ...]` entry in `package.json`). v0.8 and
v0.9 BOTH extended `receipt.v0.4.0` in place additively — v0.8 added
optional `attestor.bundle_root_digest`; v0.9 added optional top-level
`batch` + `per_sample` blocks and extended `Loss` with optional
`reduction` + `per_sample` fields. Each addition is OPTIONAL — receipts
authored before the addition (without the new fields) continue to validate
against the updated schema. Receipts authored AFTER the addition (with
the new fields) will FAIL to validate against an OLDER package version's
copy of `receipt.v0.4.0` (the older schema's `additionalProperties: false`
rejects unknown keys).

For the bundled consumer (anyone using `@mcptoolshop/backprop-trace`),
this is invisible: the same package version always ships a consistent
schema + engine + reconciler. **For external consumers** who vendor the
schema independently (e.g., copying `schemas/receipt.v0.4.0.json` into
another repo and validating with their own Ajv): **upgrade the vendored
schema to match the producing backprop-trace version.** Older package
versions that vendor `receipt.v0.4.0` may reject v0.9 batched receipts
(new `batch` / `per_sample` fields) until upgraded. This is honest;
additive doesn't mean old validators magically understand new fields.

This matches the v0.8 precedent and CONTRIBUTING.md's "additive evolution
is allowed within the same schema_version if existing receipts remain
valid" policy.

### v0.10 FORCED bump to framework-trace.v0.7.0 (live-helper `helper` block)

**v0.10 forces a framework-trace bump to `v0.7.0`.** v0.6.0's root-level
`additionalProperties: false` rejects the new top-level `helper` object
that live-extractor sidecars MUST carry. Adding a required top-level
block is a schema-breaking change for v0.6.0-pinned validators — same
doctrine as v0.9.1/v0.9.2/v0.9.3's optimizer-enum-widening forced bumps.

**Receipt schemas are NOT bumped in v0.10.** The helper block lives on
the SIDECAR only; receipts produced via `bp import pytorch` continue
to declare `schema_version: "0.4.0"` (or "0.5.0"/"0.6.0"/"0.7.0" per
optimizer), byte-identical to v0.9.x receipts. The helper never
touches the receipt path — operators reading the original sidecar
bytes get the forensic helper attribution; the receipt does not
re-encode it.

The v0.10 slice adds (framework-trace.v0.7.0 only):

- New top-level `helper` object with `additionalProperties: false` and
  these REQUIRED fields:
  - `name` (string) — e.g. `"backprop-trace-pytorch-helper"`.
  - `version` (string) — SemVer. v0.10 uses
    `"0.10.0-repo-script+<sha7>"` style.
  - `distribution` (closed enum: `"repo-script" | "pypi" | "vendored"`).
    Makes any future flip-to-pip auditable from sidecar reads alone.
  - `source_hash` (string, `^sha256:[0-9a-f]{64}$`). **FORENSIC ONLY**
    — Rule 14 is the authority. The helper may compute and report
    its own hash; this is documented as observer-claimed-not-verifier-
    checked. The schema does NOT validate the hash against actual
    file contents (which would re-introduce the trust-boundary
    violation we're avoiding).
  - `framework` (object: `name` enum `pytorch|jax|tensorflow`, `version`,
    optional `commit`).
  - `runtime` (object: `python_version`, optional `torch_version`,
    optional `deterministic_mode`).
  - `extraction` (object: `timestamp` (ISO-8601 pattern), optional
    `duration_ms`, `device` enum `cpu|cuda|mps|xla`).
- New `allOf` conditional clause: when `source_framework.name in
  {pytorch, jax, tensorflow}`, `helper` is REQUIRED **unless**
  `source_framework.extractor.name === "hand_authored"` (back-compat
  escape so existing v0.6.0 fixtures can re-declare as v0.7.0 without
  forcing a helper block). The `if`-clause requires `source_framework`
  + `source_framework.name` to be PRESENT — same vacuous-properties
  trap fix earned in v0.9.3.

**Trust boundary (load-bearing).** The `helper` block is forensic, not
credential. Rule 14 (engine-recompute differential) fires
unconditionally on every receipt with `authoring_state ===
"external_imported"` regardless of what the helper claims. A spoofed
/ wrong / missing `source_hash` does NOT bypass Rule 14. The block
exists for post-hoc attribution when Rule 14 disagrees, not for
bypass logic. See `docs/live-helpers.md` for the trust-boundary
statement, the Forbidden-in-the-helper list, and the Csmith/CompCert
+ Fang et al. 2023 PoL spoofing doctrine that motivates the
observer-not-verifier discipline.

**No receipt schema bump.** v0.10 does NOT bump the receipt schema
family. Receipt v0.7.0 (Nesterov + dampening, earned v0.9.3) remains
the latest. The helper's forensic record terminates at the sidecar;
the importer surfaces helper attribution in Rule 14 failure messages
when it disagrees. A future slice may add a receipt-side mirror
block (e.g. `attestor.upstream_helper`) but that's out of v0.10 scope.

**Schema cross-references**: `package.json` `exports` adds
`./schema/framework-trace-0.7.0`. v0.1-v0.6 sidecars continue to
validate against their own schemas unchanged. The importer dispatcher
in `src/import-observer.ts` accepts all seven framework-trace
versions on the multi-step path.

### v0.9.3 FORCED bump to receipt.v0.7.0 + framework-trace.v0.6.0 (Nesterov + dampening)

**v0.9.3 forces the bump to `receipt.v0.7.0` + `framework-trace.v0.6.0`.**
v0.9.2 reserved `nesterov: { const: false }` and `dampening: { const: 0 }`
as schema slots; widening these consts to `boolean` and `number ∈ [0, 1)`
is a schema-breaking change for v0.6.0-pinned validators (the new values
would fail `const` validation). Same doctrine as v0.9.1/v0.9.2's enum-
widening forced bumps.

The v0.9.3 slice adds:
- `OptimizerConfig.nesterov` widens `{ const: false }` → `{ type: "boolean" }`
- `OptimizerConfig.dampening` widens `{ const: 0 }` → `{ type: "number",
  minimum: 0, exclusiveMaximum: 1 }`
- New `allOf` clause mirroring PyTorch's
  `torch.optim.SGD.__init__` `ValueError("Nesterov momentum requires
  a momentum and zero dampening")`: when `nesterov === true`,
  `dampening` MUST be absent or `0`. The `if`-clause requires
  `nesterov` to be PRESENT (not just `properties` check) so that
  classical-and-dampened receipts (`nesterov` absent, `dampening > 0`)
  don't trigger the `then`-clause vacuously.

v0.6.0 classical sgd_momentum receipts continue to declare
`schema_version: "0.6.0"` and validate byte-identical (engine emits
`nesterov` only when `true`, `dampening` only when `> 0`, so classical
receipts have no new fields). Receipts with `nesterov: true` OR
`dampening > 0` declare `schema_version: "0.7.0"`. `package.json`
`exports` adds `./schema/receipt-0.7.0` + `./schema/framework-trace-0.6.0`
subpath exports.

**Live-helper sign-convention pin** (forward-looking for v0.10):
`MomentumState.buffer` stores the **descent-direction** velocity.
PyTorch's `state["momentum_buffer"]` stores the **ascent-direction**
velocity (since PyTorch's `param.grad` is in ascent direction). Live-
helper extractors at v0.10 MUST sign-flip on read:
`buffer_descent = -state["momentum_buffer"]`. This keeps the Nesterov
formula sign-symmetric: in our convention `update = lr * (gradient_descent
+ mu * buffer_descent)`; in PyTorch `update = -lr * (gradient_ascent +
mu * buffer_ascent)`. v0.9.3 fixtures are engine-authored so the
descent-direction buffer is correct by construction; the sign-flip is
a v0.10 live-helper concern. Documented in `MomentumState` docstring
to prevent live-helper authors from getting it wrong.

### v0.9.2 FORCED bump to receipt.v0.6.0 + framework-trace.v0.5.0 (classical PyTorch-style SGD momentum)

**v0.9.2 forces the bump to `receipt.v0.6.0` + `framework-trace.v0.5.0`** for
the same reasons v0.9.1 forced v0.5.0/v0.4.0: closed `optimizer.name` enum
widening (`["sgd", "adam", "adamw"]` → `["sgd", "adam", "adamw", "sgd_momentum"]`)
plus a new closed-shape state def (`MomentumState = { buffer }`, distinct
from `AdamState = { m, v }`). The v0.9.1 "force bump when closed enums
widen" doctrine applies — bending it now would muddy the precedent.

The v0.9.2 slice adds:
- `OptimizerConfig.name` enum widened by `"sgd_momentum"`
- `Update.optimizer.name` enum widened to match
- New `MomentumState = { buffer: number }` def with `additionalProperties:
  false` and `required: ["buffer"]`
- `Update.optimizer.state_before` / `state_after` widens to `OptimizerState =
  oneOf(AdamState, MomentumState)`; reconciler Rule 20 enforces shape-matches-
  name (schema is permissive; reconciler is strict)
- `OptimizerConfig.momentum` (optional; conditionally REQUIRED when name ===
  "sgd_momentum" via allOf if/then)
- `OptimizerConfig.nesterov: { const: false }` (RESERVED — v0.9.3 widens to
  `boolean` for Nesterov accelerated gradient)
- `OptimizerConfig.dampening: { const: 0 }` (RESERVED — v0.9.3 widens to
  `number` for PyTorch's `torch.optim.SGD(dampening=tau)` recurrence)
- `OptimizerConfig.weight_decay` REJECTED via allOf if/then when name ===
  "sgd_momentum" (SGD coupled L2 deferred to v0.10; Rule 7 third branch
  not yet implemented)

SGD/Adam/AdamW receipts continue to declare their existing `schema_version`
("0.4.0" for SGD, "0.5.0" for Adam/AdamW) and validate byte-identical.
sgd_momentum receipts declare `schema_version: "0.6.0"`. The framework-trace
sidecar parallel bump is `v0.5.0`; v0.1-v0.4 sidecars continue to validate
against their own schemas unchanged. `package.json` `exports` adds
`./schema/receipt-0.6.0` + `./schema/framework-trace-0.5.0` subpath exports.

### v0.9.1 FORCED bump to receipt.v0.5.0 (Adam + AdamW)

**v0.9.1 forces the bump to `receipt.v0.5.0`.** The v0.9.1 Adam + AdamW
slice adds:
- Top-level `optimizer_config` block (`name`, `learning_rate`, `beta1`,
  `beta2`, `epsilon`, `weight_decay?`, `t`)
- Per-update `Update.optimizer.state_before` and `Update.optimizer.state_after`
  blocks (each with `m, v`)
- Widened `Update.optimizer.name` enum from `["sgd"]` to `["sgd", "adam", "adamw"]`

These changes CANNOT happen in-place on `receipt.v0.4.0` because:
- `Update.optimizer.name` was a closed enum `["sgd"]` — widening requires
  schema-version bump (the old schema rejects `"adam"` / `"adamw"`)
- `Update.optimizer` had `additionalProperties: false` — adding `state_before`
  / `state_after` would require either weakening the closure (kills the
  v0.1-v0.9.0 closed-shape discipline) or bumping the version
- Root-level `optimizer_config` requires the same trade-off

This is the load-bearing reason the v0.8/v0.9 decision deferred — Adam
was anticipated. SGD-only receipts continue to declare `schema_version:
"0.4.0"` and validate against the v0.4.0 schema unchanged (byte-equal
preservation for the entire v0.1-v0.9.0 fixture lineage). Adam/AdamW
receipts declare `schema_version: "0.5.0"` and pick up the new
conditional `if/then` requirements on `optimizer_config` +
`Update.optimizer`. The `framework-trace` sidecar schema bumps in
parallel (`framework-trace.v0.4.0` is forced for the same reasons —
`optimizer.name` closed enum + `Update.optimizer.additionalProperties:
false`).

The `package.json` `exports` map now also exposes the v0.2.0 and v0.3.0
framework-trace subpath exports (previously bundled in `files:` but not
subpath-exported; fixed in v0.9.1 alongside the v0.4.0 export).

A receipt's `schema_version` field selects which schema validates it.
The bundled validator (`src/validate.ts`) compiles both schemas at
module load and dispatches on the receipt's declared version (or a
caller-supplied `opts.version` override). Mazur receipts continue to
declare `schema_version: "0.1.0"`; generalized receipts emitted by
`runGeneralStep` declare `schema_version: "0.2.0"`.

## Receipt schema v0.1.0 — field-by-field

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

The 1-indexed training step. v0.1.0 receipts only ship step-1 receipts.
Multi-step semantics arrive in v0.3 via the v0.2.0 schema's optional
`trace_id` + `step_index` overlay — see
[`docs/multi-step.md`](./multi-step.md). In v0.2.0 receipts the
`step_index` field is the load-bearing position within a training run;
`step` remains for byte-equal compatibility with v0.1.0 receipts.

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

## Receipt schema v0.2.0 — what's different

`schemas/receipt.v0.2.0.json` is **additive** on top of v0.1.0. Every
v0.1.0 receipt remains valid against its own schema; v0.2.0 receipts
are emitted by `runGeneralStep` and parsed against the v0.2.0 schema
by the dispatching validator.

The v0.2.0 schema records its own change log at the top under
`x-changes-from-v0.1.0` (a vendor annotation declared as a no-op keyword
on the Ajv validator). This section walks through the load-bearing
diffs.

### `schema_version` bump

`const: "0.2.0"`. A receipt's first field is what tells the validator
which schema to load.

### `unit_order` (REQUIRED in v0.2.0; absent in v0.1.0)

```
"unit_order": {
  "input":  ["i1", "i2"],
  "hidden": ["h1", "h2"],
  "output": ["o1", "o2"]
}
```

Three arrays of identifier-pattern strings (`^[a-zA-Z][a-zA-Z0-9_]*$`),
listing every input / hidden / output unit by id in the canonical
iteration order. The engine walks units in this exact order during
forward, backward, and update phases; the order is part of the
topology's pinned identity (reordering changes the floating-point sum
order in hidden-layer net computations).

For v0.1 Mazur receipts the equivalent ordering is hard-coded by the
schema's per-field key constraints (`i1`, `i2`, `h1`, `h2`, etc.); the
v0.2.0 schema lifts that into receipt-side data so non-Mazur topologies
have a place to declare it.

### `parameter_order` (REQUIRED in v0.2.0; absent in v0.1.0)

An array of identifier-pattern strings, unique, listing every parameter
in the iteration order the update phase uses. For the Mazur 2-2-2
topology this is `["w1", "w2", ..., "w8", "b1", "b2"]`. For XOR it's
`["w_x1_h1", "w_x2_h1", ..., "w_h1_y", "w_h2_y", "b_hidden", "b_output"]`.
The keys of `parameters_before` / `parameters_after` must conform to
this set at runtime (enforced by the engine and reconciler, not by the
schema).

### `numeric_policy.tolerance` — scalar OR object

v0.1.0: `tolerance: 1e-9` (a bare number).

v0.2.0: `oneOf [object {atol, rtol}, scalar number]`. The object form
is the canonical v0.3 shape; the scalar form is legacy compat sugar
and is treated by the reconciler as `{atol: <value>, rtol: 0}` (so v0.1
Mazur receipts reconcile bit-identically — see
[`docs/computation-order.md` "Hybrid tolerance (v0.3+)"](./computation-order.md#hybrid-tolerance-v03)).

```
// v0.2.0 object form (default emitted by runGeneralStep)
"tolerance": { "atol": 1e-12, "rtol": 1e-9 }

// v0.1 scalar form (still valid against the v0.2.0 schema as a
// transition aid; runGeneralStep does not emit this shape)
"tolerance": 1e-9
```

### `topology.activation` enum widened

v0.1.0: `["sigmoid"]`. v0.2.0: `["sigmoid", "identity", "relu"]`. The
`half_squared_error` loss enum and `per_layer` bias-sharing enum stay
the same in v0.2.0 (cross_entropy / softmax / per_neuron are deferred
to v0.4+).

### `topology.{input,hidden,output}_size` widened

v0.1.0: `const: 2` on every layer size (Mazur 2-2-2 only). v0.2.0:
`integer 1-64` per axis. The upper bound is a soft cap for v0.3 — large
topologies will pass schema validation but may take noticeable time
through the engine (which is O(input * hidden * output) per step).

### `trace_id` (OPTIONAL, NEW)

```
"trace_id": "5f8b3c0a7d2e4f1b9c6e8a7d3f5b2c1a"
```

Lowercase hex, exactly 32 characters (`pattern: "^[0-9a-f]{32}$"`).
Mirrors W3C TraceContext's `trace-id` shape
(https://www.w3.org/TR/trace-context/). Present iff this receipt is
part of a multi-step training run. Shared across every step receipt of
the run. Used by Rule 10 (trace identity) on the multi-record verify
path.

### `step_index` (OPTIONAL, NEW)

A non-negative integer (`type: "integer", minimum: 0`). 0-based step
index within the trace identified by `trace_id`. Present iff `trace_id`
is present (the schema's `allOf` clause enforces this — a receipt may
not carry one without the other).

### `unit_order` / `parameter_order` already-present field

v0.1.0 reserved `unit_order` and `parameter_order` as optional forward-
compat fields. v0.2.0 promotes both to REQUIRED. The transition is
non-breaking for the v0.1.0 schema (which is frozen); it only affects
new v0.2.0 receipts.

### `fixture_status.authoring_state` adds `engine_generated_general`

v0.1.0 enum: `["hand_derived", "engine_generated", "deliberately_corrupted"]`.
v0.2.0 enum adds `"engine_generated_general"` — the value
`runGeneralStep` emits for XOR / iris / future general-topology
receipts. The Mazur path keeps `engine_generated`.

### Open-keyed maps for unit / parameter ids

v0.1.0 hard-codes `inputs.{i1, i2}`, `targets.{o1, o2}`,
`parameters_before.{w1..w8, b1, b2}`, etc. via fixed `properties` blocks.
v0.2.0 replaces those with `additionalProperties: { type: "number" }`
maps for `inputs`, `targets`, `parameters_before`, `parameters_after`,
`forward`, `loss.per_output`, `post_update_forward`, and
`backward.{output,hidden}_error_signals` — the keys are now arbitrary
unit / parameter ids whose conformance to `unit_order` /
`parameter_order` is enforced at runtime, not by the schema. The
runtime check is in `runGeneralStep`'s boundary assertions; the
reconciler also verifies key-set consistency before walking the rules.

### What stayed the same

- `additionalProperties: false` at every level — closed schema.
- `x-order` annotations on every object — canonical emission walks
  these.
- `product_order: "left_to_right"` is the only permitted value for
  every `product_order` field (FMA still prohibited; v0.3 does not
  introduce a `right_to_left` option).
- `optimizer.name: "sgd"` is still the only permitted optimizer.
- `bias_policy.mode: ["constant", "sgd"]` enum unchanged (the "sgd"
  bias-update path is exercised by v0.4 per-neuron-bias receipts).

## Receipt schema v0.2.0 — v0.4 additive widening

v0.4 does NOT introduce a v0.3.0 receipt schema file. Per the v0.4
study-swarm doctrine ratchet, the per-neuron-bias slice fits within the
v0.2.0 receipt schema with two narrowly-scoped additive relaxations:

### `topology.bias_sharing.enum` widened

v0.2.0 (v0.3 wave): `["per_layer"]`. v0.4 widening: `["per_layer",
"per_neuron"]`. Existing per-layer receipts validate bit-identically; new
per-neuron-bias receipts emit `bias_sharing: "per_neuron"` and include a
distinct bias parameter per hidden + output unit in `parameter_order`,
`parameters_before`, and `parameters_after`.

### `OutputErrorSignal.factors.minItems` relaxed

v0.2.0 (v0.3 wave): `minItems: 2`. v0.4 widening: `minItems: 1`. The
per-neuron bias gradient is a **one-factor product** — the unit's error
signal directly, with no `dnet/dbias` multiplier (the `dnet/dbias` chain
factor is conventionally `1` and is folded out at the schema level rather
than stored as a redundant `value: 1` factor). Existing two-factor and
three-factor receipts validate unchanged.

### Why no v0.3.0 receipt schema

A bumped receipt schema would force a `schema_version` flip in every
receipt — including byte-equal Mazur receipts that the v0.4 slice does not
change. Per the law stack, schema files are frozen once shipped: any
addition that BREAKS prior receipts requires a new file. Both v0.4
widenings (enum extension + minItems relaxation) only ACCEPT a strict
superset of v0.2.0-conforming receipts. They are safe in place.

The next true v0.3.0 receipt schema lands when v0.5 reshapes
`OutputErrorSignal.factors` for softmax+CE (the Jacobian's vector-valued
shape doesn't fit the current 2-factor decomposition — see the v0.4
consolidator-decision.md "what NOT to build yet" list).

## Topology input schema (v0.4+)

`schemas/topology-input.v0.4.0.json` validates the JSON files consumed by
`bp generate from-config` and `bp validate-input`. It is the **input-side
analog** of the receipt schemas — the schema engine INPUTS bind to,
distinct from the schema engine OUTPUTS bind to.

### The two-schema split

- **Receipt schemas** (`receipt.v0.1.0.json`, `receipt.v0.2.0.json`)
  validate engine OUTPUTS. Required fields include `forward`, `loss`,
  `backward`, `updates`, `parameters_after`, etc. — values the engine
  computes.
- **Input schema** (`topology-input.v0.4.0.json`) validates engine
  INPUTS. Required fields are the topology declaration (`unit_order`,
  `parameter_order`, `topology`), the optimizer policy
  (`numeric_policy`, `bias_policy`, `learning_rate`), and the runtime
  values (`inputs`, `targets`, `parameters_before`). PROHIBITS every
  receipt-only field via `additionalProperties: false`.

### Why two schemas

The canonical-emission trust boundary requires that authored bytes
NEVER become receipt bytes. Without the input schema, an attacker could
author a "receipt" by hand-writing all the `forward`, `loss`, `updates`
values themselves and route it through `bp verify general` — bypassing
the engine entirely. The input schema is the schema-level enforcement:
fields like `forward`, `loss`, `backward`, `updates`, `parameters_after`,
`post_update_forward`, `post_update_loss`, `fixture_status` are
EXPLICITLY rejected at validation time with a named-field error.

The engine is the only authorized source for those values. The input
schema makes that boundary inspectable in the schema file itself, not
just in the engine's runtime asserts. Agent D's HIGH-severity risk in the
v0.4 consolidator-decision.md ("canonical-emission trust leakage") is
mitigated by this structural choice.

### Input schema top-level shape

The input schema's `x-order` (canonical key order for input configs that
choose to be canonically encoded — input configs do NOT need to be
canonically encoded, but the engine's scaffold output is):

```
schema_version
fixture
metadata
numeric_policy
bias_policy
topology
learning_rate
inputs
targets
parameters_before
unit_order
parameter_order
```

Every field above corresponds 1:1 to a field of the same name in the
receipt schemas. The values flow through the engine unchanged. The fields
the engine FILLS IN — `forward`, `loss`, `backward`, `updates`,
`parameters_after`, `post_update_forward`, `post_update_loss`,
`fixture_status` — are the ones the input schema PROHIBITS.

### `schema_version: "0.4.0"`

Input configs declare `schema_version: "0.4.0"` (a const enforced by the
schema). This is the INPUT-schema version, distinct from receipt
`schema_version` values (`"0.1.0"`, `"0.2.0"`).

### Authoring discipline

- Hand-edit a scaffolded input file (`bp scaffold topology --topology
  mazur`) rather than constructing from scratch.
- Use `$schema:
  "https://raw.githubusercontent.com/mcp-tool-shop-org/backprop-trace/main/schemas/topology-input.v0.4.0.json"`
  in your input files for IDE autocompletion (VS Code, JSONLint, Ajv-CLI
  all consume `$schema`).
- Validate before generating: `bp validate-input my-net.input.json`
  catches typos and rejected fields faster than waiting for the engine
  to fail.

See [`docs/authoring.md`](./authoring.md) for the full walkthrough.

## Reference

- Receipt schema files: `schemas/receipt.v0.1.0.json` (Mazur), `schemas/receipt.v0.2.0.json` (generalized + multi-step; v0.4 additively widened for per-neuron bias)
- Input-config schema file (v0.4+): `schemas/topology-input.v0.4.0.json`
- Reconciliation rules: `docs/reconciliation.md`
- Computation order + hybrid tolerance + determinism boundary: `docs/computation-order.md`
- Canonical emission rules: `docs/canonical-emission.md`
- Topology authoring guide (v0.3+): `docs/topology.md`
- Authoring custom topologies via CLI (v0.4+): `docs/authoring.md`
- Multi-step receipts (v0.3+): `docs/multi-step.md`
- Formatter policy fixture: `fixtures/formatter.policy.golden.json`
- Mazur golden receipt (engine output): `fixtures/mazur.golden.jsonl`
- XOR golden receipt (v0.3+): `fixtures/xor.golden.jsonl`
- XOR per-neuron-bias golden receipt (v0.4+): `fixtures/xor-per-neuron-bias.golden.jsonl`
- Iris golden receipt (v0.3+): `fixtures/iris.golden.jsonl`
- Anti-circularity bad fixtures: `fixtures/bad/mazur.bad-*.jsonl` + `fixtures/bad/multi-step.bad-{chain,trace-id}.jsonl` + `fixtures/bad/xor.bad-bias-*.jsonl` (v0.4+)
