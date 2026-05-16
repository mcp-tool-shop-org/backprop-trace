/**
 * T-A-011: runMazurStep input validation.
 *
 * Pins the contract that the engine refuses to silently propagate
 * malformed input (NaN, Infinity, negative or zero learning_rate,
 * unsupported topology) through forward/backward into a receipt.
 *
 * Cross-references:
 *   - Engine agent: src/engine.ts E-A-006 assertFiniteMazurInput + E-A-009
 *     assertMazurTopology
 *
 * Strategy: deep-clone MAZUR_INPUT (which is `as const`, so we cast through
 * `unknown` to a mutable shape), mutate one field to the offending value,
 * and assert runMazurStep throws.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { runMazurStep } from "../src/engine.js";
import { MAZUR_INPUT, type MazurInput } from "../src/mazur.js";

type MutableMazurInput = {
  topology: {
    layers: string[];
    input_size: number;
    hidden_size: number;
    output_size: number;
    activation: string;
    loss: string;
    bias_sharing: string;
  };
  learning_rate: number;
  inputs: { i1: number; i2: number };
  targets: { o1: number; o2: number };
  parameters_before: {
    w1: number; w2: number; w3: number; w4: number;
    w5: number; w6: number; w7: number; w8: number;
    b1: number; b2: number;
  };
  numeric_policy: MazurInput["numeric_policy"];
  bias_policy: MazurInput["bias_policy"];
};

/**
 * Deep clone MAZUR_INPUT into a mutable shape so each test can poison one
 * field without leaking changes into other tests. The `as const` on
 * MAZUR_INPUT freezes nested objects at the type level only — runtime is
 * just a JS literal, and structuredClone gives us a fully mutable copy.
 */
function cloneInput(): MutableMazurInput {
  return structuredClone(MAZUR_INPUT) as unknown as MutableMazurInput;
}

test("runMazurStep throws on NaN in inputs.i1", () => {
  const input = cloneInput();
  input.inputs.i1 = Number.NaN;
  assert.throws(
    () => runMazurStep(input as unknown as MazurInput),
    /not finite|i1|NaN/i,
    "engine must reject NaN in inputs.i1 at the boundary",
  );
});

test("runMazurStep throws on Infinity in parameters_before.w1", () => {
  const input = cloneInput();
  input.parameters_before.w1 = Number.POSITIVE_INFINITY;
  assert.throws(
    () => runMazurStep(input as unknown as MazurInput),
    /not finite|w1|Infinity/i,
    "engine must reject +Infinity in parameters_before.w1",
  );
});

test("runMazurStep throws on -Infinity in targets.o2", () => {
  const input = cloneInput();
  input.targets.o2 = Number.NEGATIVE_INFINITY;
  assert.throws(
    () => runMazurStep(input as unknown as MazurInput),
    /not finite|o2|Infinity/i,
    "engine must reject -Infinity in targets.o2",
  );
});

test("runMazurStep throws on negative learning_rate", () => {
  const input = cloneInput();
  input.learning_rate = -0.5;
  assert.throws(
    () => runMazurStep(input as unknown as MazurInput),
    /learning_rate|> 0|positive/i,
    "engine must reject negative learning_rate (asserts > 0)",
  );
});

test("runMazurStep throws on learning_rate === 0", () => {
  const input = cloneInput();
  input.learning_rate = 0;
  assert.throws(
    () => runMazurStep(input as unknown as MazurInput),
    /learning_rate|> 0|positive/i,
    "engine must reject learning_rate === 0 (asserts strictly > 0, " +
      "matching schemas/receipt.v0.1.0.json exclusiveMinimum: 0)",
  );
});

test("runMazurStep throws on bias_sharing other than 'per_layer'", () => {
  const input = cloneInput();
  input.topology.bias_sharing = "per_neuron";
  assert.throws(
    () => runMazurStep(input as unknown as MazurInput),
    /bias_sharing|per_layer/i,
    "engine implements only per_layer bias sharing; must reject other modes " +
      "rather than silently mis-computing",
  );
});
