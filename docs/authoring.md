# Authoring custom topology receipts

This guide shows how to verify a custom neural-network backprop step
without editing TypeScript. New in v0.4: the authoring surface lets you
describe a topology in JSON, hand it to the engine, and produce a
canonical receipt that the existing `bp verify general` gate consumes
unchanged.

## Workflow

1. Scaffold a starter input file from a known good topology:

   ```bash
   bp scaffold topology --topology xor --out my-net.input.json
   ```

   `--topology` accepts `mazur` (2-2-2 sigmoid + MSE), `xor` (2-2-1
   sigmoid), or `iris` (4-3-3 sigmoid). The output is the corresponding
   in-memory `*_INPUT` literal serialized in canonical input-config
   form. The file is immediately consumable by `bp generate from-config`
   — without any edits, it round-trips to the matching shipped fixture.

2. Edit `my-net.input.json` to describe your topology (sizes, units,
   parameters, initial weights). The JSON Schema at
   `schemas/topology-input.v0.4.0.json` gives IDE autocompletion via
   `$schema` — add the following to the top of your input file:

   ```json
   {
     "$schema": "https://raw.githubusercontent.com/mcp-tool-shop-org/backprop-trace/main/schemas/topology-input.v0.4.0.json",
     ...
   }
   ```

   VS Code, JSONLint, and Ajv-CLI all honor `$schema`.

3. Validate the shape before running. This is faster than waiting for
   the engine to fail with a less-helpful error:

   ```bash
   bp validate-input my-net.input.json
   ```

   Exits 0 on conforming input, 1 with a field-path-named error on
   schema violation.

4. Generate the canonical receipt:

   ```bash
   bp generate from-config my-net.input.json --out my-net.golden.jsonl
   ```

   The engine reads your input, runs one backprop step, and writes a
   v0.2.0-schema receipt to the named file. Without `--out` the bytes
   go to stdout (pipe to `sha256sum`, `tee`, or another `bp` subcommand).

5. Verify the receipt with the full 10-rule gate:

   ```bash
   bp verify general my-net.golden.jsonl
   ```

   This runs schema validation + reconciliation (Rules 1-8 + per-neuron
   bias coverage if applicable) + engine reproduction (re-runs the
   engine against the receipt's inputs and checks byte equality) +
   `fixture_status` lifecycle checks.

## Why two schemas?

Topology input (the thing you author) and receipts (the thing the engine
emits) are different artifacts:

- **`schemas/topology-input.v0.4.0.json`** describes WHAT you want the
  engine to compute. It binds to `inputs`, `targets`,
  `parameters_before`, `topology`, `bias_policy`, `numeric_policy`,
  `learning_rate`, `unit_order`, `parameter_order`, and optional
  `metadata` / `fixture`.
- **`schemas/receipt.v0.2.0.json`** describes WHAT the engine actually
  computed. It additionally requires `forward`, `loss`, `backward`,
  `updates`, `parameters_after`, `post_update_forward`,
  `post_update_loss`, and `fixture_status` — values the engine FILLS
  IN.

The input schema PROHIBITS receipt-only fields via
`additionalProperties: false`. Hand-authoring `forward` or `updates` is
a schema violation, surfaced before the engine even sees the file. The
engine is the only authorized source for those values. This preserves
the canonical-emission trust boundary: authored bytes can never
masquerade as engine bytes.

See [`docs/schema.md`](./schema.md) for the field-by-field walk-through
of both families.

## Per-neuron bias

v0.4 also widens the engine to accept `bias_sharing: "per_neuron"` in
the topology declaration. With per-layer bias (the v0.3 default), every
unit in a layer shares one bias parameter. With per-neuron bias, each
unit has its own bias parameter — declared individually in
`parameter_order` (e.g. `b_h1`, `b_h2`, `b_o`) and given its own value
in `parameters_before`.

The XOR per-neuron-bias fixture (`fixtures/xor-per-neuron-bias.golden.jsonl`)
is the canonical example. Scaffold it from `--topology xor` and edit
`bias_sharing` from `"per_layer"` to `"per_neuron"`, then add a distinct
bias parameter for each unit. The engine emits `Update.kind: "bias"`
and `Update.layer_edge: "bias_to_unit"` for each bias update.

Bias updates are **one-factor products** of the unit's error signal —
the conventional `dnet/dbias = 1` chain factor is folded out at the
schema level rather than carried as a redundant `value: 1` factor. The
v0.4 receipt schema relaxes `OutputErrorSignal.factors.minItems` from 2
to 1 to accommodate this.

## CI usage

```bash
bp generate from-config my-net.input.json --check --out my-net.golden.jsonl
```

exits 1 on drift. Pair with `bp verify general my-net.golden.jsonl` for
a complete pipeline gate:

```yaml
# Example GitHub Actions step
- name: verify custom topology receipt
  run: |
    bp generate from-config my-net.input.json --check --out my-net.golden.jsonl
    bp verify general my-net.golden.jsonl
```

The two gates are complementary: `--check` catches engine output drift
(did the engine change since the last commit of the golden?); `verify
general` catches receipt corruption (did the golden get hand-edited?).

## Limitations (v0.4)

- v0.4 supports per-layer + per-neuron bias modes, sigmoid / identity /
  ReLU activations, half-squared-error (MSE) loss only.
- Softmax + cross-entropy deferred to v0.5 (requires factor-decomposition
  design phase — the Jacobian's vector-valued shape doesn't fit the
  current 2-factor `OutputErrorSignal.factors` decomposition).
- Tanh, momentum, Adam, weight decay, batching all deferred — see
  `CHANGELOG.md` for the v0.4 doctrine ratchet.
- JSON only. YAML config support is not on the roadmap.
- Layer sizes 1-64 (soft cap per the v0.3 schema widening — large
  topologies pass schema validation but take noticeable time through
  the engine since runtime is O(input * hidden * output) per step).
- Single backprop step per input file. Multi-step training run authoring
  via JSONL-of-inputs is not yet supported; the v0.3 `bp verify multi`
  consumes pre-generated JSONL receipts, but `bp generate from-config`
  takes one input config at a time. (Reserved for a v0.4.x if demand
  materializes.)
- No `bp init`, no workspaces, no template registry. The three new
  subcommands (`generate from-config`, `scaffold topology`,
  `validate-input`) each map to a distinct user verb; the v0.4
  consolidator-decision.md caps the authoring surface at exactly that.
- No `bp scaffold receipt`. Scaffolding bytes that LOOK like receipts
  would make authored bytes a trust source for the verifier — a
  canonical-emission boundary violation. Only INPUTS may be scaffolded.

## Cross-references

- [`docs/cli.md`](./cli.md) — the `bp generate from-config`,
  `bp scaffold topology`, and `bp validate-input` subcommand references
- [`docs/schema.md`](./schema.md) — the topology-input schema and the
  v0.4 additive receipt-schema widenings, field-by-field
- [`docs/topology.md`](./topology.md) — the `Topology` type, the four
  `ParameterRole`s, unit-id / parameter-id constraints (this guide
  assumes you've read it for the conceptual shape)
- [`docs/computation-order.md`](./computation-order.md) — the
  determinism boundary; what the byte-equal contract does and does not
  cover for receipts you generate
- [`docs/reconciliation.md`](./reconciliation.md) — the 10 reconciler
  rules that `bp verify general` runs against your generated receipt
- `CHANGELOG.md` — the v0.4.0 entry, including the explicit
  doctrine-ratchet list of what v0.4 deliberately does NOT ship
