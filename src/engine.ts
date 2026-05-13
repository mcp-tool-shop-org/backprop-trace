/**
 * Mazur 2-2-2 engine: pure forward / backward / update math.
 *
 * Inputs come from src/mazur.ts (TS-literal). Output is a fully typed
 * MazurReceipt with forward, loss, backward (output + hidden error signals),
 * per-parameter updates with named-factor decomposition, parameters_after,
 * post_update_forward (filled), and post_update_loss (filled).
 *
 * Computation order follows docs/computation-order.md: factor multiplications
 * are left-to-right; hidden-signal summations are in declared order [o1, o2].
 *
 * The engine does not emit JSON. Emission lives in src/emit.ts.
 */

import type { MazurInput } from "./mazur.js";

export type ForwardUnit = { net: number; out: number };

export type NamedFactor = { name: string; from?: string; value: number };

export type OutputErrorSignal = {
  factors: NamedFactor[];
  product_order: "left_to_right";
  signal_value: number;
};

export type DownstreamContribution = {
  from: string;
  downstream_signal: number;
  via_weight: string;
  weight_value: number;
  value: number;
};

export type HiddenErrorSignal = {
  downstream_contributions: DownstreamContribution[];
  summation_order: string[];
  backpropagated_sum: number;
  activation_derivative: number;
  product_order: "left_to_right";
  signal_value: number;
};

export type Optimizer = {
  name: "sgd";
  learning_rate: number;
  factors: NamedFactor[];
  product_order: "left_to_right";
};

export type Update = {
  parameter_id: string;
  kind: "weight";
  layer_edge: "input_to_hidden" | "hidden_to_output";
  parameter_role: string;
  from_unit: string;
  to_unit: string;
  weight_before: number;
  optimizer: Optimizer;
  gradient: number;
  update: number;
  weight_after: number;
};

export type MazurReceipt = {
  schema_version: "0.1.0";
  fixture: string;
  step: 1;
  fixture_status: {
    authoring_state: "engine_generated";
    verification_state: "engine_reproduced_byte_equal";
    canonical: true;
  };
  metadata: {
    source: string;
    url_reference: string;
    gradient_convention: "descent_direction";
  };
  numeric_policy: MazurInput["numeric_policy"];
  bias_policy: MazurInput["bias_policy"];
  topology: MazurInput["topology"];
  learning_rate: number;
  inputs: MazurInput["inputs"];
  targets: MazurInput["targets"];
  parameters_before: MazurInput["parameters_before"];
  forward: { h1: ForwardUnit; h2: ForwardUnit; o1: ForwardUnit; o2: ForwardUnit };
  loss: { per_output: { o1: number; o2: number }; total: number };
  backward: {
    output_error_signals: { o1: OutputErrorSignal; o2: OutputErrorSignal };
    hidden_error_signals: { h1: HiddenErrorSignal; h2: HiddenErrorSignal };
  };
  updates: Update[];
  parameters_after: MazurInput["parameters_before"];
  post_update_forward: {
    status: "filled";
    h1: ForwardUnit;
    h2: ForwardUnit;
    o1: ForwardUnit;
    o2: ForwardUnit;
  };
  post_update_loss: {
    status: "filled";
    per_output: { o1: number; o2: number };
    total: number;
  };
};

function sigmoid(x: number): number {
  return 1 / (1 + Math.exp(-x));
}

export function runMazurStep(input: MazurInput): MazurReceipt {
  const { i1, i2 } = input.inputs;
  const { w1, w2, w3, w4, w5, w6, w7, w8, b1, b2 } = input.parameters_before;
  const t_o1 = input.targets.o1;
  const t_o2 = input.targets.o2;
  const lr = input.learning_rate;

  // Forward pass
  const net_h1 = w1 * i1 + w2 * i2 + b1;
  const out_h1 = sigmoid(net_h1);
  const net_h2 = w3 * i1 + w4 * i2 + b1;
  const out_h2 = sigmoid(net_h2);
  const net_o1 = w5 * out_h1 + w6 * out_h2 + b2;
  const out_o1 = sigmoid(net_o1);
  const net_o2 = w7 * out_h1 + w8 * out_h2 + b2;
  const out_o2 = sigmoid(net_o2);

  // Loss (half squared error)
  const diff_o1 = t_o1 - out_o1;
  const E_o1 = 0.5 * diff_o1 * diff_o1;
  const diff_o2 = t_o2 - out_o2;
  const E_o2 = 0.5 * diff_o2 * diff_o2;
  const E_total = E_o1 + E_o2;

  // Backward: output error signals (descent direction)
  // signal_o = (target - output) * sigmoid'(net) ; equals -∂E/∂net.
  const tmo_o1 = t_o1 - out_o1;
  const ad_o1 = out_o1 * (1 - out_o1);
  const signal_o1 = tmo_o1 * ad_o1;

  const tmo_o2 = t_o2 - out_o2;
  const ad_o2 = out_o2 * (1 - out_o2);
  const signal_o2 = tmo_o2 * ad_o2;

  // Backward: hidden error signals (downstream contributions summed in
  // declared summation_order [o1, o2], then multiplied by activation_derivative).
  const h1_contrib_o1_value = signal_o1 * w5;
  const h1_contrib_o2_value = signal_o2 * w7;
  const backprop_sum_h1 = h1_contrib_o1_value + h1_contrib_o2_value;
  const ad_h1 = out_h1 * (1 - out_h1);
  const signal_h1 = backprop_sum_h1 * ad_h1;

  const h2_contrib_o1_value = signal_o1 * w6;
  const h2_contrib_o2_value = signal_o2 * w8;
  const backprop_sum_h2 = h2_contrib_o1_value + h2_contrib_o2_value;
  const ad_h2 = out_h2 * (1 - out_h2);
  const signal_h2 = backprop_sum_h2 * ad_h2;

  // Updates — input-to-hidden weights (w1..w4)
  const grad_w1 = signal_h1 * i1;
  const upd_w1 = lr * grad_w1;
  const w1_after = w1 + upd_w1;

  const grad_w2 = signal_h1 * i2;
  const upd_w2 = lr * grad_w2;
  const w2_after = w2 + upd_w2;

  const grad_w3 = signal_h2 * i1;
  const upd_w3 = lr * grad_w3;
  const w3_after = w3 + upd_w3;

  const grad_w4 = signal_h2 * i2;
  const upd_w4 = lr * grad_w4;
  const w4_after = w4 + upd_w4;

  // Updates — hidden-to-output weights (w5..w8)
  const grad_w5 = signal_o1 * out_h1;
  const upd_w5 = lr * grad_w5;
  const w5_after = w5 + upd_w5;

  const grad_w6 = signal_o1 * out_h2;
  const upd_w6 = lr * grad_w6;
  const w6_after = w6 + upd_w6;

  const grad_w7 = signal_o2 * out_h1;
  const upd_w7 = lr * grad_w7;
  const w7_after = w7 + upd_w7;

  const grad_w8 = signal_o2 * out_h2;
  const upd_w8 = lr * grad_w8;
  const w8_after = w8 + upd_w8;

  // Parameters after (biases unchanged per bias_policy.mode === "constant")
  const parameters_after = {
    w1: w1_after, w2: w2_after, w3: w3_after, w4: w4_after,
    w5: w5_after, w6: w6_after, w7: w7_after, w8: w8_after,
    b1, b2,
  };

  // Post-update forward pass
  const new_net_h1 = w1_after * i1 + w2_after * i2 + b1;
  const new_out_h1 = sigmoid(new_net_h1);
  const new_net_h2 = w3_after * i1 + w4_after * i2 + b1;
  const new_out_h2 = sigmoid(new_net_h2);
  const new_net_o1 = w5_after * new_out_h1 + w6_after * new_out_h2 + b2;
  const new_out_o1 = sigmoid(new_net_o1);
  const new_net_o2 = w7_after * new_out_h1 + w8_after * new_out_h2 + b2;
  const new_out_o2 = sigmoid(new_net_o2);

  // Post-update loss
  const new_diff_o1 = t_o1 - new_out_o1;
  const new_E_o1 = 0.5 * new_diff_o1 * new_diff_o1;
  const new_diff_o2 = t_o2 - new_out_o2;
  const new_E_o2 = 0.5 * new_diff_o2 * new_diff_o2;
  const new_E_total = new_E_o1 + new_E_o2;

  return {
    schema_version: "0.1.0",
    fixture: "mazur-engine-first-run",
    step: 1,
    fixture_status: {
      authoring_state: "engine_generated",
      verification_state: "engine_reproduced_byte_equal",
      canonical: true,
    },
    metadata: {
      source: "src/engine.ts (Mazur 2-2-2 engine first-run)",
      url_reference: "https://mattmazur.com/2015/03/17/a-step-by-step-backpropagation-example/",
      gradient_convention: "descent_direction",
    },
    numeric_policy: input.numeric_policy,
    bias_policy: input.bias_policy,
    topology: input.topology,
    learning_rate: lr,
    inputs: { i1, i2 },
    targets: { o1: t_o1, o2: t_o2 },
    parameters_before: { w1, w2, w3, w4, w5, w6, w7, w8, b1, b2 },
    forward: {
      h1: { net: net_h1, out: out_h1 },
      h2: { net: net_h2, out: out_h2 },
      o1: { net: net_o1, out: out_o1 },
      o2: { net: net_o2, out: out_o2 },
    },
    loss: {
      per_output: { o1: E_o1, o2: E_o2 },
      total: E_total,
    },
    backward: {
      output_error_signals: {
        o1: {
          factors: [
            { name: "target_minus_output", value: tmo_o1 },
            { name: "activation_derivative", value: ad_o1 },
          ],
          product_order: "left_to_right",
          signal_value: signal_o1,
        },
        o2: {
          factors: [
            { name: "target_minus_output", value: tmo_o2 },
            { name: "activation_derivative", value: ad_o2 },
          ],
          product_order: "left_to_right",
          signal_value: signal_o2,
        },
      },
      hidden_error_signals: {
        h1: {
          downstream_contributions: [
            { from: "o1", downstream_signal: signal_o1, via_weight: "w5", weight_value: w5, value: h1_contrib_o1_value },
            { from: "o2", downstream_signal: signal_o2, via_weight: "w7", weight_value: w7, value: h1_contrib_o2_value },
          ],
          summation_order: ["o1", "o2"],
          backpropagated_sum: backprop_sum_h1,
          activation_derivative: ad_h1,
          product_order: "left_to_right",
          signal_value: signal_h1,
        },
        h2: {
          downstream_contributions: [
            { from: "o1", downstream_signal: signal_o1, via_weight: "w6", weight_value: w6, value: h2_contrib_o1_value },
            { from: "o2", downstream_signal: signal_o2, via_weight: "w8", weight_value: w8, value: h2_contrib_o2_value },
          ],
          summation_order: ["o1", "o2"],
          backpropagated_sum: backprop_sum_h2,
          activation_derivative: ad_h2,
          product_order: "left_to_right",
          signal_value: signal_h2,
        },
      },
    },
    updates: [
      makeUpdate("w1", "input_to_hidden",  "input_1_to_hidden_1",  "i1", "h1", w1, "hidden_error_signal", "backward.hidden_error_signals.h1.signal_value", signal_h1, "upstream_activation", "inputs.i1",      i1,      lr, grad_w1, upd_w1, w1_after),
      makeUpdate("w2", "input_to_hidden",  "input_2_to_hidden_1",  "i2", "h1", w2, "hidden_error_signal", "backward.hidden_error_signals.h1.signal_value", signal_h1, "upstream_activation", "inputs.i2",      i2,      lr, grad_w2, upd_w2, w2_after),
      makeUpdate("w3", "input_to_hidden",  "input_1_to_hidden_2",  "i1", "h2", w3, "hidden_error_signal", "backward.hidden_error_signals.h2.signal_value", signal_h2, "upstream_activation", "inputs.i1",      i1,      lr, grad_w3, upd_w3, w3_after),
      makeUpdate("w4", "input_to_hidden",  "input_2_to_hidden_2",  "i2", "h2", w4, "hidden_error_signal", "backward.hidden_error_signals.h2.signal_value", signal_h2, "upstream_activation", "inputs.i2",      i2,      lr, grad_w4, upd_w4, w4_after),
      makeUpdate("w5", "hidden_to_output", "hidden_1_to_output_1", "h1", "o1", w5, "output_error_signal", "backward.output_error_signals.o1.signal_value", signal_o1, "upstream_activation", "forward.h1.out", out_h1,  lr, grad_w5, upd_w5, w5_after),
      makeUpdate("w6", "hidden_to_output", "hidden_2_to_output_1", "h2", "o1", w6, "output_error_signal", "backward.output_error_signals.o1.signal_value", signal_o1, "upstream_activation", "forward.h2.out", out_h2,  lr, grad_w6, upd_w6, w6_after),
      makeUpdate("w7", "hidden_to_output", "hidden_1_to_output_2", "h1", "o2", w7, "output_error_signal", "backward.output_error_signals.o2.signal_value", signal_o2, "upstream_activation", "forward.h1.out", out_h1,  lr, grad_w7, upd_w7, w7_after),
      makeUpdate("w8", "hidden_to_output", "hidden_2_to_output_2", "h2", "o2", w8, "output_error_signal", "backward.output_error_signals.o2.signal_value", signal_o2, "upstream_activation", "forward.h2.out", out_h2,  lr, grad_w8, upd_w8, w8_after),
    ],
    parameters_after,
    post_update_forward: {
      status: "filled",
      h1: { net: new_net_h1, out: new_out_h1 },
      h2: { net: new_net_h2, out: new_out_h2 },
      o1: { net: new_net_o1, out: new_out_o1 },
      o2: { net: new_net_o2, out: new_out_o2 },
    },
    post_update_loss: {
      status: "filled",
      per_output: { o1: new_E_o1, o2: new_E_o2 },
      total: new_E_total,
    },
  };
}

function makeUpdate(
  parameter_id: string,
  layer_edge: "input_to_hidden" | "hidden_to_output",
  parameter_role: string,
  from_unit: string,
  to_unit: string,
  weight_before: number,
  signalName: string,
  signalFrom: string,
  signal: number,
  upstreamName: string,
  upstreamFrom: string,
  upstream: number,
  learning_rate: number,
  gradient: number,
  update: number,
  weight_after: number,
): Update {
  return {
    parameter_id,
    kind: "weight",
    layer_edge,
    parameter_role,
    from_unit,
    to_unit,
    weight_before,
    optimizer: {
      name: "sgd",
      learning_rate,
      factors: [
        { name: signalName, from: signalFrom, value: signal },
        { name: upstreamName, from: upstreamFrom, value: upstream },
      ],
      product_order: "left_to_right",
    },
    gradient,
    update,
    weight_after,
  };
}
