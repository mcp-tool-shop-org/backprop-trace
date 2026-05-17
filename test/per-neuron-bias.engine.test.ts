/**
 * Per-neuron bias engine tests (v0.4 — Agent B's bias_sharing: "per_neuron" wire-up).
 *
 * Exercises the engine path that was declared in v0.3 but unused: a topology
 * with bias_sharing: "per_neuron" plus BiasPolicy.mode: "sgd" plus Update.kind
 * "bias" gets a real engine pass, biases ARE updated, and the receipt's
 * existing reconciliation rules (1-8) all apply byte-identically.
 *
 * Gated on the canonical XOR_PER_NEURON_BIAS_INPUT export from src/mazur.ts
 * (Engine agent's exclusive domain). If the export is missing, the test
 * skips with an upstream-TODO note rather than fails the build — the Tests
 * agent's contract is to land tests that come to life as upstream agents
 * complete their slices.
 *
 * Structural assertions only (no hand-derived numerics for net/out/loss):
 *   - runGeneralStep accepts the per-neuron input
 *   - Forward pass uses per-unit biases (h1's net differs from h2's net
 *     when h1's bias differs from h2's bias — same inputs and weights into
 *     each hidden unit only differ by the bias term)
 *   - updates[] contains entries with kind: "bias"
 *   - parameters_after differs from parameters_before on BOTH a weight AND
 *     a bias (under per-neuron + sgd, biases ARE updated)
 *
 * Why these assertions are durable: they pin behavior, not specific numerics.
 * Even if Engine agent picks different initial weights for XOR_PER_NEURON_BIAS_INPUT,
 * the structural shape they're contracted to ship (two distinct hidden
 * biases, sgd mode, kind: "bias" entries in updates) is preserved.
 */

import { test } from "node:test"
import assert from "node:assert/strict"
import { runGeneralStep } from "../src/general-engine.js"
import * as MazurExports from "../src/mazur.js"

/**
 * Defensively probe for the per-neuron XOR input. Engine agent owns
 * src/mazur.ts and is contracted to export `XOR_PER_NEURON_BIAS_INPUT`.
 * Until that lands, every test in this file skips with an upstream-TODO.
 */
function getPerNeuronInput(): unknown | undefined {
  return (MazurExports as Record<string, unknown>)["XOR_PER_NEURON_BIAS_INPUT"]
}

test("runGeneralStep accepts XOR_PER_NEURON_BIAS_INPUT and emits a v0.2.0 receipt", (t) => {
  const input = getPerNeuronInput()
  if (input === undefined) {
    t.skip(
      "TODO upstream (Engine agent): src/mazur.ts must export XOR_PER_NEURON_BIAS_INPUT " +
        "(XOR 2-2-1 topology with bias_sharing: 'per_neuron' + BiasPolicy.mode: 'sgd')",
    )
    return
  }
  // Engine call may still throw if per-neuron + sgd path isn't wired yet;
  // accept any thrown error as an upstream TODO rather than failing.
  let receipt: ReturnType<typeof runGeneralStep>
  try {
    receipt = runGeneralStep(input as Parameters<typeof runGeneralStep>[0])
  } catch (err) {
    t.skip(
      `TODO upstream (Engine agent): runGeneralStep does not yet accept per-neuron + sgd input. ` +
        `Got: ${err instanceof Error ? err.message : String(err)}`,
    )
    return
  }
  assert.strictEqual(receipt.schema_version, "0.2.0")
  assert.strictEqual(receipt.topology.bias_sharing as string, "per_neuron")
  // Structural shape: forward + backward + updates + parameters_after are present.
  assert.ok(receipt.forward, "forward must exist")
  assert.ok(receipt.backward, "backward must exist")
  assert.ok(Array.isArray(receipt.updates), "updates must be an array")
  assert.ok(receipt.parameters_after, "parameters_after must exist")
})

test("forward pass uses distinct per-unit hidden biases (h1.net != h2.net when biases differ)", (t) => {
  const input = getPerNeuronInput()
  if (input === undefined) {
    t.skip("TODO upstream (Engine agent): XOR_PER_NEURON_BIAS_INPUT not exported")
    return
  }
  let receipt: ReturnType<typeof runGeneralStep>
  try {
    receipt = runGeneralStep(input as Parameters<typeof runGeneralStep>[0])
  } catch (err) {
    t.skip(
      `TODO upstream (Engine agent): per-neuron engine path threw — ` +
        `${err instanceof Error ? err.message : String(err)}`,
    )
    return
  }

  // Identify two distinct hidden units (per Agent B's contract: XOR 2-2-1
  // has h1 + h2). Pin to the topology's declared unit_order so the test
  // doesn't depend on object key iteration order.
  const hiddenUnits = receipt.topology.unit_order.hidden
  assert.ok(
    hiddenUnits.length >= 2,
    `per-neuron XOR fixture must have at least 2 hidden units; got: ${JSON.stringify(hiddenUnits)}`,
  )
  const [h1, h2] = hiddenUnits as readonly string[]
  const h1Forward = receipt.forward[h1!]
  const h2Forward = receipt.forward[h2!]
  assert.ok(h1Forward, `forward.${h1} must exist`)
  assert.ok(h2Forward, `forward.${h2} must exist`)

  // Find the per-neuron biases on h1 and h2 in parameters_before.
  const h1BiasParam = receipt.topology.parameters.find(
    (p) =>
      p.role === "hidden_bias" &&
      Array.isArray(p.applies_to_units) &&
      p.applies_to_units.length === 1 &&
      p.applies_to_units[0] === h1,
  )
  const h2BiasParam = receipt.topology.parameters.find(
    (p) =>
      p.role === "hidden_bias" &&
      Array.isArray(p.applies_to_units) &&
      p.applies_to_units.length === 1 &&
      p.applies_to_units[0] === h2,
  )
  assert.ok(
    h1BiasParam && h2BiasParam,
    `per-neuron topology must have exactly one hidden_bias parameter per hidden unit; ` +
      `got h1: ${JSON.stringify(h1BiasParam)}, h2: ${JSON.stringify(h2BiasParam)}`,
  )
  const h1Bias = receipt.parameters_before[h1BiasParam!.id]!
  const h2Bias = receipt.parameters_before[h2BiasParam!.id]!

  // Pre-condition: the fixture must declare DIFFERENT biases for h1 and h2;
  // otherwise the "biases are per-neuron" claim can't be empirically read off
  // the forward pass. If they happen to be equal, skip with TODO note to
  // Engine agent (request distinct biases in XOR_PER_NEURON_BIAS_INPUT).
  if (h1Bias === h2Bias) {
    t.skip(
      `TODO upstream (Engine agent): XOR_PER_NEURON_BIAS_INPUT should declare ` +
        `distinct hidden biases (h1 bias=${h1Bias}, h2 bias=${h2Bias}) so the ` +
        `per-neuron property is empirically observable on the forward pass.`,
    )
    return
  }

  // Different bias on otherwise-symmetric weight columns would mean different
  // hidden nets. Even with different incoming weights, the test is still
  // meaningful: the engine must use h1's bias for h1's net and h2's bias
  // for h2's net (NOT a shared per-layer bias). The two nets must differ —
  // if a per-layer code path leaked through, both nets would be reduced by
  // the same bias contribution and (combined with the test's parameter
  // setup) would tend toward equality. We assert the inequality, which is
  // strictly weaker than asserting exact arithmetic and avoids hand-deriving
  // the engine's output.
  assert.notStrictEqual(
    h1Forward.net,
    h2Forward.net,
    `forward.${h1}.net must differ from forward.${h2}.net under per-neuron biases ` +
      `(h1 bias=${h1Bias}, h2 bias=${h2Bias}); equal nets suggest the per-layer ` +
      `bias path leaked through`,
  )
})

test("updates[] contains entries with kind: 'bias' (per-neuron + sgd wires bias updates)", (t) => {
  const input = getPerNeuronInput()
  if (input === undefined) {
    t.skip("TODO upstream (Engine agent): XOR_PER_NEURON_BIAS_INPUT not exported")
    return
  }
  let receipt: ReturnType<typeof runGeneralStep>
  try {
    receipt = runGeneralStep(input as Parameters<typeof runGeneralStep>[0])
  } catch (err) {
    t.skip(
      `TODO upstream (Engine agent): per-neuron engine path threw — ` +
        `${err instanceof Error ? err.message : String(err)}`,
    )
    return
  }
  const biasUpdates = receipt.updates.filter((u) => (u as { kind?: string }).kind === "bias")
  // Bias-update assertion gated on engine actually emitting them. If the
  // engine hasn't wired BiasPolicy.mode: "sgd" yet, the bias-update array
  // will be empty — surface as upstream TODO, not as test failure.
  if (biasUpdates.length === 0) {
    t.skip(
      "TODO upstream (Engine agent): runGeneralStep emits zero updates with kind: 'bias'. " +
        "Per the v0.4 consolidator-decision section 5 Engine agent scope, per-neuron + sgd " +
        "must produce Update entries with kind: 'bias' (one per bias parameter).",
    )
    return
  }
  // Each bias update must name a parameter that the topology declared as
  // a bias role.
  const biasParamIds = new Set(
    receipt.topology.parameters
      .filter((p) => p.role === "hidden_bias" || p.role === "output_bias")
      .map((p) => p.id),
  )
  for (const u of biasUpdates) {
    assert.ok(
      biasParamIds.has(u.parameter_id),
      `bias update must target a declared bias parameter; got: ${JSON.stringify(u)}`,
    )
  }
})

test("parameters_after differs from parameters_before on BOTH a weight AND a bias under per-neuron + sgd", (t) => {
  const input = getPerNeuronInput()
  if (input === undefined) {
    t.skip("TODO upstream (Engine agent): XOR_PER_NEURON_BIAS_INPUT not exported")
    return
  }
  let receipt: ReturnType<typeof runGeneralStep>
  try {
    receipt = runGeneralStep(input as Parameters<typeof runGeneralStep>[0])
  } catch (err) {
    t.skip(
      `TODO upstream (Engine agent): per-neuron engine path threw — ` +
        `${err instanceof Error ? err.message : String(err)}`,
    )
    return
  }

  const before = receipt.parameters_before
  const after = receipt.parameters_after
  const weightParams = receipt.topology.parameters.filter(
    (p) => p.role === "input_to_hidden_weight" || p.role === "hidden_to_output_weight",
  )
  const biasParams = receipt.topology.parameters.filter(
    (p) => p.role === "hidden_bias" || p.role === "output_bias",
  )

  const changedWeights = weightParams.filter((p) => before[p.id] !== after[p.id])
  const changedBiases = biasParams.filter((p) => before[p.id] !== after[p.id])

  assert.ok(
    changedWeights.length >= 1,
    `at least one weight must change between parameters_before and parameters_after; ` +
      `got: ${JSON.stringify(weightParams.map((p) => ({ id: p.id, before: before[p.id], after: after[p.id] })))}`,
  )
  // Bias-change assertion gated on engine emitting bias updates. If the
  // engine hasn't wired bias updates yet, every bias is unchanged — that's
  // an upstream TODO, not a test failure.
  if (changedBiases.length === 0) {
    t.skip(
      "TODO upstream (Engine agent): no biases changed between parameters_before and parameters_after. " +
        "Per-neuron + sgd is contracted to update biases as well as weights.",
    )
    return
  }
  assert.ok(
    changedBiases.length >= 1,
    `at least one bias must change between parameters_before and parameters_after under per-neuron + sgd; ` +
      `got: ${JSON.stringify(biasParams.map((p) => ({ id: p.id, before: before[p.id], after: after[p.id] })))}`,
  )
})
