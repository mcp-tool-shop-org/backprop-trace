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

export const MAZUR_INPUT: MazurInput = {
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
};
