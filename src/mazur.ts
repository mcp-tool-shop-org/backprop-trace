/**
 * Mazur 2-2-2 canonical inputs as TS-literal source of truth.
 *
 * fixtures/mazur.published.json (not yet committed in v0.1) is the audit
 * ledger that claims Mazur published these values. This module is the
 * engine's direct expression of them — no JSON fixture is read at runtime.
 *
 * Topology: 2 inputs -> 2 hidden (sigmoid) -> 2 outputs (sigmoid). Half
 * squared error loss. Per-layer shared biases. Biases are constant in
 * step 1 (per Mazur's published derivation).
 *
 * v0.3 adds:
 *   - MAZUR_TOPOLOGY: the same 2-2-2 topology re-expressed in the
 *     generalized src/topology.ts Topology format, so consumers can pass
 *     the Mazur fixture through runGeneralStep (alongside the unchanged
 *     runMazurStep path).
 *   - XOR_INPUT + XOR_TOPOLOGY: the canonical XOR-sigmoid 2-2-1 fixture
 *     (deterministic initial weights, single-sample first-run trace).
 *   - IRIS_INPUT + IRIS_TOPOLOGY: the canonical iris 4-3-3-sigmoid fixture
 *     using the first iris flower (5.1, 3.5, 1.4, 0.2) -> [1, 0, 0].
 *
 * Initial-weight choice for XOR + iris: deterministic monotonically-
 * increasing small numbers (0.10, 0.15, 0.20, ...) — chosen so the
 * pinned numeric values are easy to read off the receipt without
 * inflating the file with stochastic-init bookkeeping. Documented in
 * fixtures/{xor,iris}.published.json under compute_infrastructure.seed.
 */

import type { GeneralInput, NumericPolicy, BiasPolicy } from "./general-engine.js"
import type { Topology } from "./topology.js"

/**
 * Input to runMazurStep — pinned at the type level to the Mazur 2-2-2
 * topology.
 *
 * The literal types on `topology` (input_size: 2, hidden_size: 2,
 * output_size: 2, activation: "sigmoid", loss: "half_squared_error",
 * bias_sharing: "per_layer") are NOT decorative — they encode v0.1's
 * single-topology contract at compile time. Any input that doesn't match
 * fails type-checking before runtime; runMazurStep also re-asserts each
 * field at the boundary (assertMazurTopology in src/engine.ts) so JS
 * callers and cross-module `as unknown` casts can't slip through.
 *
 * v0.2+ will widen this type to a generalized topology shape and add
 * required `unit_order` / `parameter_order` fields so the schema-defined
 * computation order from docs/computation-order.md remains explicit
 * rather than implicit in declaration order. That is a breaking change
 * for the engine's pinned outputs and will require a schema_version bump.
 */
export type MazurInput = {
  topology: {
    layers: readonly ["input", "hidden", "output"];
    input_size: 2;
    hidden_size: 2;
    output_size: 2;
    activation: "sigmoid";
    loss: "half_squared_error";
    bias_sharing: "per_layer";
  };
  learning_rate: number;
  inputs: { i1: number; i2: number };
  targets: { o1: number; o2: number };
  parameters_before: {
    w1: number; w2: number; w3: number; w4: number;
    w5: number; w6: number; w7: number; w8: number;
    b1: number; b2: number;
  };
  numeric_policy: {
    number_encoding: "decimal";
    precision_significant_digits: 9;
    rounding: "round_half_to_even";
    tolerance: number;
    computation_order: "schema_defined";
    byte_output: {
      format: "jsonl";
      json_key_order: "schema_defined";
      trailing_zero_policy: "pad_to_significant_digits";
      indent: "none";
    };
  };
  bias_policy: {
    mode: "constant";
    reason: string;
    updated_in_step: false;
    reconciliation: string;
  };
};

/**
 * The canonical Mazur 2-2-2 input — TS-literal source of truth.
 *
 * These exact numeric values (learning_rate, weights w1..w8, biases b1/b2,
 * inputs i1/i2, targets o1/o2) are the same values Mazur publishes in
 * "A Step by Step Backpropagation Example"
 * (https://mattmazur.com/2015/03/17/a-step-by-step-backpropagation-example/).
 * fixtures/mazur.published.json is the audit ledger that records this
 * provenance claim and pins the published-anchor numbers Mazur reports
 * for forward outputs, hidden/output error signals, weights-after, and
 * post-update loss.
 *
 * `as const satisfies MazurInput` makes the literal deeply readonly at
 * the type level (E-A-011) — direct field-level mutation is rejected at
 * compile time, matching the runtime intent: MAZUR_INPUT is a fixed
 * canonical input, not a mutable config. Tests that need to mutate (e.g.
 * the engine.invalid-input.test.ts NaN-injection tests) explicitly
 * structuredClone() into a mutable shape rather than poking through the
 * type system.
 *
 * Changing any value here changes the engine's pinned outputs and is a
 * v0.x -> v0.(x+1) BREAKING change. Such a bump requires:
 *   - schemas/receipt.v0.1.0.json version bump
 *   - fixtures/mazur.golden.jsonl regenerated and reviewed
 *   - fixtures/mazur.published.json provenance claims rechecked against
 *     Mazur's published values (and engine_reproduced_byte_equal /
 *     drift_observed status re-attested if drift changes)
 *   - CHANGELOG entry calling out the breaking change explicitly
 */
export const MAZUR_INPUT = {
  topology: {
    layers: ["input", "hidden", "output"],
    input_size: 2,
    hidden_size: 2,
    output_size: 2,
    activation: "sigmoid",
    loss: "half_squared_error",
    bias_sharing: "per_layer",
  },
  learning_rate: 0.5,
  inputs: { i1: 0.05, i2: 0.10 },
  targets: { o1: 0.01, o2: 0.99 },
  parameters_before: {
    w1: 0.15, w2: 0.20, w3: 0.25, w4: 0.30,
    w5: 0.40, w6: 0.45, w7: 0.50, w8: 0.55,
    b1: 0.35, b2: 0.60,
  },
  numeric_policy: {
    number_encoding: "decimal",
    precision_significant_digits: 9,
    rounding: "round_half_to_even",
    tolerance: 1e-9,
    computation_order: "schema_defined",
    byte_output: {
      format: "jsonl",
      json_key_order: "schema_defined",
      trailing_zero_policy: "pad_to_significant_digits",
      indent: "none",
    },
  },
  bias_policy: {
    mode: "constant",
    reason: "Mazur's published derivation does not update bias terms in step 1",
    updated_in_step: false,
    reconciliation: "parameters_after.b1 == parameters_before.b1 AND parameters_after.b2 == parameters_before.b2",
  },
} as const satisfies MazurInput;

// ---------------------------------------------------------------------------
// v0.3 generalized topology declarations (Mazur + XOR + iris)
// ---------------------------------------------------------------------------

/**
 * Shared numeric_policy + bias_policy literals reused across the v0.3
 * topology fixtures. The v0.3 hybrid-tolerance object form
 * `{atol: 1e-12, rtol: 1e-8}` provides headroom for 9-sig-fig storage of
 * gradient products that chain through 2-3 levels (signal × upstream ×
 * activation_derivative). The theoretical double-rounding error budget for
 * a chained product is ~3e-9 relative; rtol=1e-8 gives ~3x headroom while
 * staying tight enough to flag a real 1e-6 mutation (Csmith-style targeted
 * drift bad fixtures use 1000x). atol=1e-12 protects the near-zero regime;
 * the format-policy floor was widened to 1e-12 in v0.3 to admit it cleanly.
 */
const SHARED_NUMERIC_POLICY_V03: NumericPolicy = {
  number_encoding: "decimal",
  precision_significant_digits: 9,
  rounding: "round_half_to_even",
  tolerance: { atol: 1e-12, rtol: 1e-8 },
  computation_order: "schema_defined",
  byte_output: {
    format: "jsonl",
    json_key_order: "schema_defined",
    trailing_zero_policy: "pad_to_significant_digits",
    indent: "none",
  },
};

const SHARED_BIAS_POLICY_V03: BiasPolicy = {
  mode: "constant",
  reason: "v0.3 fixtures pin biases as constant on step 1 to keep the engine in scope of memo §5 (bias updates deferred to v0.4+)",
  updated_in_step: false,
  reconciliation: "parameters_after[bias_id] === parameters_before[bias_id] for every bias parameter",
};

/**
 * v0.4 per-neuron-bias SGD policy. Used by XOR_PER_NEURON_BIAS_INPUT (and
 * future per-neuron fixtures) to exercise the bias_policy.mode === "sgd"
 * branch of runGeneralStep.
 *
 * v0.4 restriction: this policy is ONLY valid in combination with
 * topology.bias_sharing === "per_neuron". The engine rejects per_layer +
 * sgd at the boundary (per_layer bias gradient would be the SUM of per-
 * unit signals, a distinct case deferred beyond v0.4).
 */
const SHARED_BIAS_POLICY_V04_PER_NEURON_SGD: BiasPolicy = {
  mode: "sgd",
  reason: "v0.4 per-neuron biases are updated by SGD using the unit's error signal as the single-factor gradient (∂E/∂b_u = signal_u). Closes the previously-declared-but-unused BiasPolicy.mode 'sgd' + Update.kind 'bias' schema corners.",
  updated_in_step: true,
  reconciliation: "for each per_neuron bias parameter b serving unit u, parameters_after[b.id] === parameters_before[b.id] + learning_rate * signal_u where signal_u is the unit's error signal in backward.{hidden,output}_error_signals[u].signal_value",
};

/**
 * Mazur 2-2-2 topology re-expressed in the generalized Topology format.
 *
 * Consumers pass this with the existing MAZUR_INPUT scalars (`learning_rate`,
 * `inputs`, `targets`, `parameters_before`) into runGeneralStep when they
 * want to exercise the generalized engine against the canonical Mazur
 * fixture. The runMazurStep path is unchanged and remains the byte-equal
 * golden source — this is for the v0.2.0-schema receipt path only.
 *
 * unit_order pins iteration: input [i1, i2] -> hidden [h1, h2] -> output
 * [o1, o2]. parameter_order pins update iteration: weights w1..w8 in
 * declared order, then biases b1, b2 (biases are skipped at update time
 * because bias_policy.mode === "constant").
 *
 * Parameter -> unit map mirrors src/engine.ts's hard-coded indices:
 *   - w1: i1 -> h1, w2: i2 -> h1   (Mazur input-1/input-2 to hidden-1)
 *   - w3: i1 -> h2, w4: i2 -> h2
 *   - w5: h1 -> o1, w6: h2 -> o1
 *   - w7: h1 -> o2, w8: h2 -> o2
 *   - b1: hidden_bias (applies to h1, h2)
 *   - b2: output_bias (applies to o1, o2)
 */
export const MAZUR_TOPOLOGY: Topology = {
  layers: ["input", "hidden", "output"],
  unit_order: { input: ["i1", "i2"], hidden: ["h1", "h2"], output: ["o1", "o2"] },
  parameter_order: ["w1", "w2", "w3", "w4", "w5", "w6", "w7", "w8", "b1", "b2"],
  parameters: [
    { id: "w1", role: "input_to_hidden_weight", from_unit: "i1", to_unit: "h1" },
    { id: "w2", role: "input_to_hidden_weight", from_unit: "i2", to_unit: "h1" },
    { id: "w3", role: "input_to_hidden_weight", from_unit: "i1", to_unit: "h2" },
    { id: "w4", role: "input_to_hidden_weight", from_unit: "i2", to_unit: "h2" },
    { id: "w5", role: "hidden_to_output_weight", from_unit: "h1", to_unit: "o1" },
    { id: "w6", role: "hidden_to_output_weight", from_unit: "h2", to_unit: "o1" },
    { id: "w7", role: "hidden_to_output_weight", from_unit: "h1", to_unit: "o2" },
    { id: "w8", role: "hidden_to_output_weight", from_unit: "h2", to_unit: "o2" },
    { id: "b1", role: "hidden_bias", applies_to_units: ["h1", "h2"] },
    { id: "b2", role: "output_bias", applies_to_units: ["o1", "o2"] },
  ],
  activation_hidden: "sigmoid",
  activation_output: "sigmoid",
  loss: "half_squared_error",
  bias_sharing: "per_layer",
  input_size: 2,
  hidden_size: 2,
  output_size: 2,
};

/**
 * XOR-sigmoid 2-2-1 topology (memo §6). 2 inputs, 2 hidden sigmoid,
 * 1 output sigmoid, half-squared-error.
 *
 * Unit ids: x1, x2 (inputs); h1, h2 (hidden); y (output).
 *
 * Parameter -> unit map (deterministic, monotonically-increasing initial
 * weights — see design memo §6 and the file-header note):
 *   - w_x1_h1: x1 -> h1 (0.10)
 *   - w_x2_h1: x2 -> h1 (0.15)
 *   - w_x1_h2: x1 -> h2 (0.20)
 *   - w_x2_h2: x2 -> h2 (0.25)
 *   - w_h1_y:  h1 -> y  (0.30)
 *   - w_h2_y:  h2 -> y  (0.35)
 *   - b_hidden: hidden_bias (0.10) applies to [h1, h2]
 *   - b_output: output_bias (0.20) applies to [y]
 */
export const XOR_TOPOLOGY: Topology = {
  layers: ["input", "hidden", "output"],
  unit_order: { input: ["x1", "x2"], hidden: ["h1", "h2"], output: ["y"] },
  parameter_order: [
    "w_x1_h1", "w_x2_h1", "w_x1_h2", "w_x2_h2",
    "w_h1_y", "w_h2_y",
    "b_hidden", "b_output",
  ],
  parameters: [
    { id: "w_x1_h1", role: "input_to_hidden_weight", from_unit: "x1", to_unit: "h1" },
    { id: "w_x2_h1", role: "input_to_hidden_weight", from_unit: "x2", to_unit: "h1" },
    { id: "w_x1_h2", role: "input_to_hidden_weight", from_unit: "x1", to_unit: "h2" },
    { id: "w_x2_h2", role: "input_to_hidden_weight", from_unit: "x2", to_unit: "h2" },
    { id: "w_h1_y",  role: "hidden_to_output_weight", from_unit: "h1", to_unit: "y" },
    { id: "w_h2_y",  role: "hidden_to_output_weight", from_unit: "h2", to_unit: "y" },
    { id: "b_hidden", role: "hidden_bias", applies_to_units: ["h1", "h2"] },
    { id: "b_output", role: "output_bias", applies_to_units: ["y"] },
  ],
  activation_hidden: "sigmoid",
  activation_output: "sigmoid",
  loss: "half_squared_error",
  bias_sharing: "per_layer",
  input_size: 2,
  hidden_size: 2,
  output_size: 1,
};

/**
 * Canonical XOR first-run input. Single sample (x1=1, x2=0) -> target y=1,
 * which is one of the four canonical XOR truth-table entries. Single-step
 * trace from deterministic init.
 *
 * learning_rate 0.5 matches Mazur's choice — keeps the post-update weights
 * in a numerically meaningful range for the receipt reader.
 */
export const XOR_INPUT: GeneralInput = {
  topology: XOR_TOPOLOGY,
  learning_rate: 0.5,
  inputs: { x1: 1, x2: 0 },
  targets: { y: 1 },
  parameters_before: {
    w_x1_h1: 0.10, w_x2_h1: 0.15, w_x1_h2: 0.20, w_x2_h2: 0.25,
    w_h1_y:  0.30, w_h2_y:  0.35,
    b_hidden: 0.10, b_output: 0.20,
  },
  numeric_policy: SHARED_NUMERIC_POLICY_V03,
  bias_policy: SHARED_BIAS_POLICY_V03,
  fixture: "xor-sigmoid-engine-first-run",
  metadata: {
    source: "src/mazur.ts XOR_INPUT (XOR-sigmoid 2-2-1 engine first-run)",
    url_reference: "https://www.deeplearningbook.org/contents/mlp.html",
    gradient_convention: "descent_direction",
  },
};

/**
 * v0.4 per-neuron-bias variant of XOR_TOPOLOGY. Identical to XOR_TOPOLOGY
 * EXCEPT for the bias surface:
 *
 *   per_layer (XOR_TOPOLOGY)            per_neuron (this)
 *   ------------------------            ----------------
 *   b_hidden  applies to [h1, h2]       b_h1     applies to [h1]
 *   b_output  applies to [y]            b_h2     applies to [h2]
 *                                       b_y      applies to [y]
 *
 * parameter_order: weights w_x1_h1..w_h2_y in the same declared order as
 * XOR_TOPOLOGY (6 weights), THEN the 3 per-neuron biases in the order
 * [b_h1, b_h2, b_y] (hidden biases first in unit_order, then output bias).
 *
 * bias_sharing: "per_neuron". Use with SHARED_BIAS_POLICY_V04_PER_NEURON_SGD
 * to exercise the v0.4 bias-update branch of runGeneralStep.
 *
 * NOTE: this topology is NOT a drop-in replacement for XOR_TOPOLOGY — they
 * disagree on bias parameter ids and counts. Receipts emitted from this
 * topology use distinct parameter ids in parameters_before / parameters_after
 * / updates, so a downstream consumer can tell the two paths apart from the
 * receipt bytes alone.
 */
export const XOR_PER_NEURON_BIAS_TOPOLOGY: Topology = {
  layers: ["input", "hidden", "output"],
  unit_order: { input: ["x1", "x2"], hidden: ["h1", "h2"], output: ["y"] },
  parameter_order: [
    "w_x1_h1", "w_x2_h1", "w_x1_h2", "w_x2_h2",
    "w_h1_y", "w_h2_y",
    "b_h1", "b_h2", "b_y",
  ],
  parameters: [
    { id: "w_x1_h1", role: "input_to_hidden_weight", from_unit: "x1", to_unit: "h1" },
    { id: "w_x2_h1", role: "input_to_hidden_weight", from_unit: "x2", to_unit: "h1" },
    { id: "w_x1_h2", role: "input_to_hidden_weight", from_unit: "x1", to_unit: "h2" },
    { id: "w_x2_h2", role: "input_to_hidden_weight", from_unit: "x2", to_unit: "h2" },
    { id: "w_h1_y",  role: "hidden_to_output_weight", from_unit: "h1", to_unit: "y" },
    { id: "w_h2_y",  role: "hidden_to_output_weight", from_unit: "h2", to_unit: "y" },
    { id: "b_h1", role: "hidden_bias", applies_to_units: ["h1"] },
    { id: "b_h2", role: "hidden_bias", applies_to_units: ["h2"] },
    { id: "b_y",  role: "output_bias", applies_to_units: ["y"] },
  ],
  activation_hidden: "sigmoid",
  activation_output: "sigmoid",
  loss: "half_squared_error",
  bias_sharing: "per_neuron",
  input_size: 2,
  hidden_size: 2,
  output_size: 1,
};

/**
 * v0.4 canonical XOR per-neuron-bias first-run input. Mirrors XOR_INPUT
 * (same sample x1=1, x2=0, target y=1; same learning_rate 0.5; same
 * initial weights w_x1_h1=0.10, ..., w_h2_y=0.35) but with distinct
 * per-neuron bias initials: b_h1=0.10, b_h2=0.15, b_y=0.20.
 *
 * Initial bias choice rationale: distinct values so a downstream byte-
 * inspecting consumer can confirm each per-neuron bias is read and
 * updated independently (a topology bug that aliased b_h1 and b_h2 would
 * produce identical bias values in parameters_after).
 *
 * Uses SHARED_BIAS_POLICY_V04_PER_NEURON_SGD (mode: "sgd") so the engine
 * emits Update entries for each per-neuron bias (kind: "bias",
 * layer_edge: "bias_to_layer", optimizer.factors.length === 1).
 *
 * Authoring constraint (v0.4 consolidator §7 risk 1): the .golden.jsonl
 * receipt for this input MUST be engine-authored via the v0.4
 * `bp generate from-config` path — NEVER hand-constructed. The Fixtures
 * agent owns that authoring step.
 */
export const XOR_PER_NEURON_BIAS_INPUT: GeneralInput = {
  topology: XOR_PER_NEURON_BIAS_TOPOLOGY,
  learning_rate: 0.5,
  inputs: { x1: 1, x2: 0 },
  targets: { y: 1 },
  parameters_before: {
    w_x1_h1: 0.10, w_x2_h1: 0.15, w_x1_h2: 0.20, w_x2_h2: 0.25,
    w_h1_y:  0.30, w_h2_y:  0.35,
    b_h1: 0.10, b_h2: 0.15, b_y: 0.20,
  },
  numeric_policy: SHARED_NUMERIC_POLICY_V03,
  bias_policy: SHARED_BIAS_POLICY_V04_PER_NEURON_SGD,
  fixture: "xor-per-neuron-bias-engine-first-run",
  metadata: {
    source: "src/mazur.ts XOR_PER_NEURON_BIAS_INPUT (XOR-sigmoid 2-2-1 per-neuron-bias engine first-run)",
    url_reference: "https://www.deeplearningbook.org/contents/mlp.html",
    gradient_convention: "descent_direction",
  },
};

/**
 * Iris 4-3-3 sigmoid topology (memo §6). 4 inputs (sepal/petal length+width),
 * 3 hidden sigmoid, 3 output sigmoid (one-hot setosa/versicolor/virginica),
 * half-squared-error.
 *
 * Unit ids: f1, f2, f3, f4 (inputs); h1, h2, h3 (hidden); o_setosa,
 * o_versicolor, o_virginica (outputs).
 *
 * Parameter count: 4*3 input-to-hidden + 3*3 hidden-to-output + 2 biases
 * = 12 + 9 + 2 = 23. Initial weights are deterministic and monotonically
 * increasing in groups of 0.05.
 *
 * Naming: w_<from>_<to>. Order: input-to-hidden first (grouped by hidden
 * unit), then hidden-to-output (grouped by output unit), then biases.
 */
export const IRIS_TOPOLOGY: Topology = {
  layers: ["input", "hidden", "output"],
  unit_order: {
    input: ["f1", "f2", "f3", "f4"],
    hidden: ["h1", "h2", "h3"],
    output: ["o_setosa", "o_versicolor", "o_virginica"],
  },
  parameter_order: [
    // input-to-hidden, grouped by hidden unit (h1 then h2 then h3)
    "w_f1_h1", "w_f2_h1", "w_f3_h1", "w_f4_h1",
    "w_f1_h2", "w_f2_h2", "w_f3_h2", "w_f4_h2",
    "w_f1_h3", "w_f2_h3", "w_f3_h3", "w_f4_h3",
    // hidden-to-output, grouped by output unit
    "w_h1_o_setosa", "w_h2_o_setosa", "w_h3_o_setosa",
    "w_h1_o_versicolor", "w_h2_o_versicolor", "w_h3_o_versicolor",
    "w_h1_o_virginica", "w_h2_o_virginica", "w_h3_o_virginica",
    // biases last
    "b_hidden", "b_output",
  ],
  parameters: [
    // input-to-hidden
    { id: "w_f1_h1", role: "input_to_hidden_weight", from_unit: "f1", to_unit: "h1" },
    { id: "w_f2_h1", role: "input_to_hidden_weight", from_unit: "f2", to_unit: "h1" },
    { id: "w_f3_h1", role: "input_to_hidden_weight", from_unit: "f3", to_unit: "h1" },
    { id: "w_f4_h1", role: "input_to_hidden_weight", from_unit: "f4", to_unit: "h1" },
    { id: "w_f1_h2", role: "input_to_hidden_weight", from_unit: "f1", to_unit: "h2" },
    { id: "w_f2_h2", role: "input_to_hidden_weight", from_unit: "f2", to_unit: "h2" },
    { id: "w_f3_h2", role: "input_to_hidden_weight", from_unit: "f3", to_unit: "h2" },
    { id: "w_f4_h2", role: "input_to_hidden_weight", from_unit: "f4", to_unit: "h2" },
    { id: "w_f1_h3", role: "input_to_hidden_weight", from_unit: "f1", to_unit: "h3" },
    { id: "w_f2_h3", role: "input_to_hidden_weight", from_unit: "f2", to_unit: "h3" },
    { id: "w_f3_h3", role: "input_to_hidden_weight", from_unit: "f3", to_unit: "h3" },
    { id: "w_f4_h3", role: "input_to_hidden_weight", from_unit: "f4", to_unit: "h3" },
    // hidden-to-output
    { id: "w_h1_o_setosa",     role: "hidden_to_output_weight", from_unit: "h1", to_unit: "o_setosa" },
    { id: "w_h2_o_setosa",     role: "hidden_to_output_weight", from_unit: "h2", to_unit: "o_setosa" },
    { id: "w_h3_o_setosa",     role: "hidden_to_output_weight", from_unit: "h3", to_unit: "o_setosa" },
    { id: "w_h1_o_versicolor", role: "hidden_to_output_weight", from_unit: "h1", to_unit: "o_versicolor" },
    { id: "w_h2_o_versicolor", role: "hidden_to_output_weight", from_unit: "h2", to_unit: "o_versicolor" },
    { id: "w_h3_o_versicolor", role: "hidden_to_output_weight", from_unit: "h3", to_unit: "o_versicolor" },
    { id: "w_h1_o_virginica",  role: "hidden_to_output_weight", from_unit: "h1", to_unit: "o_virginica" },
    { id: "w_h2_o_virginica",  role: "hidden_to_output_weight", from_unit: "h2", to_unit: "o_virginica" },
    { id: "w_h3_o_virginica",  role: "hidden_to_output_weight", from_unit: "h3", to_unit: "o_virginica" },
    // biases
    { id: "b_hidden", role: "hidden_bias", applies_to_units: ["h1", "h2", "h3"] },
    { id: "b_output", role: "output_bias", applies_to_units: ["o_setosa", "o_versicolor", "o_virginica"] },
  ],
  activation_hidden: "sigmoid",
  activation_output: "sigmoid",
  loss: "half_squared_error",
  bias_sharing: "per_layer",
  input_size: 4,
  hidden_size: 3,
  output_size: 3,
};

/**
 * Canonical iris first-run input. First flower of Fisher's iris dataset:
 * (sepal length 5.1, sepal width 3.5, petal length 1.4, petal width 0.2)
 * targeting one-hot Iris setosa [1, 0, 0].
 *
 * learning_rate 0.1 — lower than the XOR/Mazur 0.5 to keep the larger
 * 23-parameter update bounded for the pinned receipt's numeric range.
 *
 * Initial weights deterministic 0.10, 0.15, 0.20, ... incremented by
 * 0.05 in declared parameter_order. Biases 0.10 / 0.20.
 */
export const IRIS_INPUT: GeneralInput = {
  topology: IRIS_TOPOLOGY,
  learning_rate: 0.1,
  inputs: { f1: 5.1, f2: 3.5, f3: 1.4, f4: 0.2 },
  targets: { o_setosa: 1, o_versicolor: 0, o_virginica: 0 },
  parameters_before: {
    // input-to-hidden (12 weights)
    w_f1_h1: 0.10, w_f2_h1: 0.15, w_f3_h1: 0.20, w_f4_h1: 0.25,
    w_f1_h2: 0.30, w_f2_h2: 0.35, w_f3_h2: 0.40, w_f4_h2: 0.45,
    w_f1_h3: 0.50, w_f2_h3: 0.55, w_f3_h3: 0.60, w_f4_h3: 0.65,
    // hidden-to-output (9 weights)
    w_h1_o_setosa:     0.70, w_h2_o_setosa:     0.75, w_h3_o_setosa:     0.80,
    w_h1_o_versicolor: 0.85, w_h2_o_versicolor: 0.90, w_h3_o_versicolor: 0.95,
    w_h1_o_virginica:  1.00, w_h2_o_virginica:  1.05, w_h3_o_virginica:  1.10,
    // biases
    b_hidden: 0.10, b_output: 0.20,
  },
  numeric_policy: SHARED_NUMERIC_POLICY_V03,
  bias_policy: SHARED_BIAS_POLICY_V03,
  fixture: "iris-sigmoid-engine-first-run",
  metadata: {
    source: "src/mazur.ts IRIS_INPUT (iris 4-3-3-sigmoid engine first-run, first flower of Fisher's iris dataset)",
    url_reference: "https://archive.ics.uci.edu/ml/datasets/iris",
    gradient_convention: "descent_direction",
  },
};
