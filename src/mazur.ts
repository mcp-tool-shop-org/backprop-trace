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
 */

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
