# General topology authoring guide (v0.3+)

v0.3 generalizes the engine beyond Mazur 2-2-2. Any
N-input N-hidden N-output sigmoid/identity/ReLU topology with
half-squared-error loss and per-layer biases can be expressed as a
`Topology` value and run through `runGeneralStep`. This doc is the
authoring guide.

For the byte-level shape of the receipt that `runGeneralStep` emits,
see [`docs/schema.md` "Receipt schema v0.2.0"](./schema.md#receipt-schema-v020--whats-different).
For the 10 reconciler rules that gate it, see
[`docs/reconciliation.md`](./reconciliation.md). For the multi-step
trace_id / step_index overlay, see [`docs/multi-step.md`](./multi-step.md).

## The `Topology` type

`Topology` lives in `src/topology.ts`. It is a plain data declaration —
no methods, no inheritance, fully `readonly`:

```ts
import type { Topology } from '@mcptoolshop/backprop-trace/topology';

export const MY_TOPOLOGY: Topology = {
  layers: ['input', 'hidden', 'output'],
  unit_order: {
    input:  ['x1', 'x2'],
    hidden: ['h1', 'h2'],
    output: ['y'],
  },
  parameter_order: [
    'w_x1_h1', 'w_x2_h1',
    'w_x1_h2', 'w_x2_h2',
    'w_h1_y',  'w_h2_y',
    'b_hidden', 'b_output',
  ],
  parameters: [
    { id: 'w_x1_h1', role: 'input_to_hidden_weight', from_unit: 'x1', to_unit: 'h1' },
    { id: 'w_x2_h1', role: 'input_to_hidden_weight', from_unit: 'x2', to_unit: 'h1' },
    { id: 'w_x1_h2', role: 'input_to_hidden_weight', from_unit: 'x1', to_unit: 'h2' },
    { id: 'w_x2_h2', role: 'input_to_hidden_weight', from_unit: 'x2', to_unit: 'h2' },
    { id: 'w_h1_y',  role: 'hidden_to_output_weight', from_unit: 'h1', to_unit: 'y' },
    { id: 'w_h2_y',  role: 'hidden_to_output_weight', from_unit: 'h2', to_unit: 'y' },
    { id: 'b_hidden', role: 'hidden_bias', applies_to_units: ['h1', 'h2'] },
    { id: 'b_output', role: 'output_bias', applies_to_units: ['y'] },
  ],
  activation_hidden: 'sigmoid',
  activation_output: 'sigmoid',
  loss: 'half_squared_error',
  bias_sharing: 'per_layer',
  input_size: 2,
  hidden_size: 2,
  output_size: 1,
};
```

The literal above is the actual XOR topology shipped as
`XOR_TOPOLOGY` in `src/mazur.ts`.

## The four `ParameterRole`s

Every entry in `parameters[]` declares one of four roles:

| Role | Required fields | Meaning |
|---|---|---|
| `input_to_hidden_weight` | `from_unit` (input unit id), `to_unit` (hidden unit id) | A weight connecting an input unit to a hidden unit. |
| `hidden_to_output_weight` | `from_unit` (hidden unit id), `to_unit` (output unit id) | A weight connecting a hidden unit to an output unit. |
| `hidden_bias` | `applies_to_units` (every hidden unit id) | The shared per-layer bias for the hidden layer. |
| `output_bias` | `applies_to_units` (every output unit id) | The shared per-layer bias for the output layer. |

`assertTopologyValid(t)` enforces these constraints at the engine
boundary — wrong roles or missing fields throw a path-naming Error
before any forward pass runs.

`per_layer` bias sharing (v0.3's only supported form) means exactly one
`hidden_bias` and exactly one `output_bias` per topology, each listing
every unit in its layer. `per_neuron` bias sharing is deferred to v0.4+.

## Unit IDs and parameter IDs

Both unit ids and parameter ids are strings matching the identifier
pattern:

```
^[a-zA-Z][a-zA-Z0-9_]*$
```

Any name that would be a valid JavaScript identifier works. The schema
enforces this pattern; the engine and reconciler additionally enforce
that every id is globally unique across all three layers (no `h1`
reused as `o1`, no `w1` reused for two distinct parameters).

The forward pass writes a single id-keyed map (`receipt.forward[unitId]
= { net, out }`); a duplicate id would silently overwrite. Cross-layer
uniqueness is part of the topology's pinned identity, not a stylistic
preference.

### Naming conventions used by the shipped fixtures

- **Mazur** (`MAZUR_TOPOLOGY`): `i1`, `i2`, `h1`, `h2`, `o1`, `o2` —
  the published Mazur naming. Parameters `w1..w8`, `b1` (hidden bias),
  `b2` (output bias).
- **XOR** (`XOR_TOPOLOGY`): `x1`, `x2`, `h1`, `h2`, `y`. Parameters
  named by edge: `w_<from>_<to>` (e.g. `w_x1_h1`). Biases:
  `b_hidden`, `b_output`.
- **Iris** (`IRIS_TOPOLOGY`): `f1`, `f2`, `f3`, `f4` (features); `h1`,
  `h2`, `h3` (hidden); `o_setosa`, `o_versicolor`, `o_virginica`
  (one-hot output). Parameters named by edge.

The conventions are not load-bearing — pick any naming that documents
the topology for human readers. The engine treats every id as opaque.

## `unit_order` and `parameter_order` canonicalization

`unit_order` and `parameter_order` are how the topology pins iteration
order. The engine walks units in `unit_order.input` order during the
hidden-layer net computation; walks `unit_order.hidden` during the
output-layer net computation; walks `unit_order.output` during the
loss / output-error computation; and walks `parameter_order` during
the update phase.

Reordering ANY of these arrays changes the floating-point sum order
in the affected pass and is therefore part of the topology's pinned
identity — two topologies that disagree on iteration order are
different topologies even if they describe the same graph.

`parameter_order` and `parameters[]` are required to agree
position-by-position: `parameters[i].id === parameter_order[i]` for
every i. `assertTopologyValid` rejects topologies that violate this
projection.

## Per-layer bias sharing constraint

`bias_sharing: 'per_layer'` (v0.3's only supported value) requires
exactly one `hidden_bias` and exactly one `output_bias` parameter
per topology. Each carries an `applies_to_units` array listing every
unit in its layer:

```ts
{ id: 'b_hidden', role: 'hidden_bias', applies_to_units: ['h1', 'h2', 'h3'] },
{ id: 'b_output', role: 'output_bias', applies_to_units: ['o_setosa', 'o_versicolor', 'o_virginica'] },
```

`assertTopologyValid` checks that `applies_to_units` has the same
length as the corresponding layer, contains no duplicates, and
references only declared units. Forgetting a unit, listing a unit
twice, or listing a unit from the wrong layer all fail at the engine
boundary.

`bias_policy.mode: 'constant'` (v0.3's only supported value) means the
bias parameters are NOT updated during the step — `parameters_after[bias_id]
=== parameters_before[bias_id]` exactly. The bias update path is
reserved for v0.4+. Rule 7 (parameter final state) enforces the
zero-delta requirement on biases when `bias_policy.mode === 'constant'`.

## Worked example: how `XOR_INPUT` was constructed

The XOR-sigmoid 2-2-1 topology in `src/mazur.ts`:

1. **Pick the network shape.** 2 inputs (x1, x2), 2 hidden sigmoid (h1,
   h2), 1 output sigmoid (y). MSE loss. Per-layer biases.
2. **Name the units.** Inputs `x1, x2`; hidden `h1, h2`; output `y`.
   Pin `unit_order` accordingly.
3. **List the weights.** 4 input-to-hidden weights (one per
   (input, hidden) pair) + 2 hidden-to-output weights (one per
   (hidden, output) pair). Name them by edge: `w_x1_h1`, `w_x2_h1`,
   `w_x1_h2`, `w_x2_h2`, `w_h1_y`, `w_h2_y`.
4. **Add the biases.** One `hidden_bias` (`b_hidden`,
   applies_to_units `['h1', 'h2']`) and one `output_bias`
   (`b_output`, applies_to_units `['y']`).
5. **Pin `parameter_order`.** Weights first, in declared order, then
   biases: `['w_x1_h1', 'w_x2_h1', 'w_x1_h2', 'w_x2_h2', 'w_h1_y',
   'w_h2_y', 'b_hidden', 'b_output']`.
6. **Pick initial weights.** Deterministic, easy to read off the
   receipt: 0.10, 0.15, 0.20, 0.25, 0.30, 0.35 for the six weights;
   0.10 for `b_hidden`; 0.20 for `b_output`. Documented in
   `fixtures/xor.published.json` under `compute_infrastructure.seed`.
7. **Pick the training sample.** One of the four XOR truth-table
   entries: `(x1: 1, x2: 0) → target y = 1`.
8. **Pick the learning rate.** 0.5 (matches Mazur — keeps the post-
   update weights in a numerically meaningful range for the receipt
   reader).
9. **Build `XOR_INPUT`.** Combine the topology, learning_rate,
   inputs, targets, and `parameters_before` map into a `GeneralInput`
   literal. Attach the shared v0.3 `numeric_policy` (hybrid tolerance
   `{atol: 1e-12, rtol: 1e-9}`) and `bias_policy`
   (`mode: 'constant'`).
10. **Emit and pin.** `runGeneralStep(XOR_INPUT)` → `emitGeneralReceipt`
    → byte-pinned at `fixtures/xor.golden.jsonl`. Re-running the engine
    must reproduce the bytes exactly; CI gates on this via `bp generate
    xor --check`.

The iris 4-3-3 topology in `IRIS_INPUT` follows the same steps with
larger sizes — 4 input features, 3 hidden units, 3 one-hot outputs,
23 parameters total.

## Authoring checklist

Before passing your topology to `runGeneralStep`:

- [ ] `unit_order.{input,hidden,output}` lengths match
  `{input,hidden,output}_size`.
- [ ] Every unit id matches `^[a-zA-Z][a-zA-Z0-9_]*$` and is unique
  across all three layers.
- [ ] Every parameter id matches the same pattern and is unique
  across the topology.
- [ ] `parameters[i].id === parameter_order[i]` for every i (same length,
  same order).
- [ ] Every weight has both `from_unit` and `to_unit`, both resolvable
  to declared units in the correct adjacent layers.
- [ ] `bias_sharing: 'per_layer'` ⇒ exactly one `hidden_bias` listing
  every hidden unit and exactly one `output_bias` listing every output
  unit.
- [ ] `activation_hidden` and `activation_output` are one of
  `{sigmoid, identity, relu}`.
- [ ] `loss: 'half_squared_error'` and `bias_sharing: 'per_layer'`
  (the only v0.3 supported values).
- [ ] `bias_policy.mode: 'constant'`.

`assertTopologyValid(t)` checks all of these. Call it explicitly in
authoring tests to catch errors before the engine sees the topology.

## Next steps

- [`docs/multi-step.md`](./multi-step.md) — wrap your topology in a
  multi-step training run (`trace_id` + `step_index`).
- [`docs/schema.md`](./schema.md) — the v0.2.0 schema your topology's
  emitted receipts validate against.
- [`docs/reconciliation.md`](./reconciliation.md) — the 10 rules the
  reconciler walks; Rules 1-8 fire on per-record verify, Rules 9-10
  on multi-record verify.
- [`docs/cli.md`](./cli.md) — `bp verify general <file>` runs the full
  gate against your receipt; `bp generate {xor,iris}` are the shipped
  generators for the two non-Mazur topologies.
