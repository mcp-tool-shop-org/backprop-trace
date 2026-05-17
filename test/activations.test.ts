/**
 * v0.3 activation library tests — sigmoid, identity, relu + their
 * derivatives-from-output + the table-dispatch helpers.
 *
 * Two axes of coverage:
 *
 *   1. Each primitive in isolation. Sigmoid replicates the textbook
 *      `1 / (1 + e^{-x})` shape (0.5 at 0, saturates at ±large). Identity
 *      is the algebraic identity for all finite inputs. ReLU clips at zero
 *      with the canonical `max(0, x)` form. Derivatives-from-output mirror
 *      the engine's pre-memoized post-activation contract (`out * (1 - out)`
 *      for sigmoid, `1` for identity, `out > 0 ? 1 : 0` for relu).
 *
 *   2. The `activate(name, x)` table dispatch. This is the only path the
 *      general engine takes (so it can switch activations as data, not
 *      control flow). The test routes each name through `activate` and
 *      cross-checks against the direct primitive.
 *
 * ReLU subgradient choice at the kink: 0 (canonical PyTorch / TensorFlow /
 * JAX), enforced by `reluDerivativeFromOut(0) === 0`.
 *
 * Where "approx" is needed (sigmoid saturation), tests assert proximity
 * rather than equality because Math.exp is implementation-defined precision
 * per ECMA §21.3. The thresholds are well below any v0.3 reconciler
 * tolerance so a future Math.exp drift never spuriously fails these tests.
 */

import { test } from "node:test"
import assert from "node:assert/strict"
import {
  activate,
  activationDerivativeFromOut,
  identity,
  identityDerivativeFromOut,
  relu,
  reluDerivativeFromOut,
  sigmoid,
  sigmoidDerivativeFromOut,
} from "../src/activations.js"

test("sigmoid(0) === 0.5", () => {
  assert.strictEqual(sigmoid(0), 0.5)
})

test("sigmoid(large positive) saturates near 1", () => {
  const out = sigmoid(50)
  assert.ok(
    out > 1 - 1e-15,
    `sigmoid(50) must saturate near 1; got ${out}`,
  )
  assert.ok(out <= 1, `sigmoid(50) must not exceed 1; got ${out}`)
})

test("sigmoid(large negative) saturates near 0", () => {
  const out = sigmoid(-50)
  assert.ok(
    out < 1e-15,
    `sigmoid(-50) must saturate near 0; got ${out}`,
  )
  assert.ok(out >= 0, `sigmoid(-50) must not go below 0; got ${out}`)
})

test("sigmoidDerivativeFromOut(0.5) === 0.25 (peak of the derivative)", () => {
  assert.strictEqual(sigmoidDerivativeFromOut(0.5), 0.25)
})

test("sigmoidDerivativeFromOut(0) === 0 and sigmoidDerivativeFromOut(1) === 0 (saturated endpoints)", () => {
  assert.strictEqual(sigmoidDerivativeFromOut(0), 0)
  assert.strictEqual(sigmoidDerivativeFromOut(1), 0)
})

test("identity is the algebraic identity for representative finite inputs", () => {
  for (const x of [0, 1, -1, 0.5, -42.7, 1e10, -1e10, Number.MIN_VALUE, Number.MAX_VALUE]) {
    assert.strictEqual(identity(x), x, `identity(${x}) must equal ${x}`)
  }
})

test("identityDerivativeFromOut is exactly 1 for any input (the _out arg is unused but signature is uniform)", () => {
  for (const x of [0, 1, -1, 0.5, 1e9, -1e9]) {
    assert.strictEqual(
      identityDerivativeFromOut(x),
      1,
      `identityDerivativeFromOut(${x}) must equal 1`,
    )
  }
})

test("relu(positive) === input", () => {
  assert.strictEqual(relu(1), 1)
  assert.strictEqual(relu(0.5), 0.5)
  assert.strictEqual(relu(42), 42)
})

test("relu(negative) === 0", () => {
  assert.strictEqual(relu(-1), 0)
  assert.strictEqual(relu(-0.5), 0)
  assert.strictEqual(relu(-42), 0)
})

test("relu(0) === 0 (clamped at the kink)", () => {
  assert.strictEqual(relu(0), 0)
})

test("reluDerivativeFromOut(positive) === 1", () => {
  assert.strictEqual(reluDerivativeFromOut(1), 1)
  assert.strictEqual(reluDerivativeFromOut(0.5), 1)
  assert.strictEqual(reluDerivativeFromOut(42), 1)
})

test("reluDerivativeFromOut(0) === 0 (subgradient choice — canonical PyTorch/TF/JAX)", () => {
  assert.strictEqual(reluDerivativeFromOut(0), 0)
})

test("reluDerivativeFromOut(negative) === 0 (defensive — out should never be negative for relu)", () => {
  // ReLU clips out >= 0 always, so this branch is unreachable from the
  // engine. We still pin the contract: any out <= 0 yields derivative 0
  // so a mis-fed value does not propagate spurious gradient.
  assert.strictEqual(reluDerivativeFromOut(-0.1), 0)
})

test("activate('relu', -1) === 0 — table dispatch matches the primitive", () => {
  assert.strictEqual(activate("relu", -1), 0)
  assert.strictEqual(activate("relu", -1), relu(-1))
})

test("activate('identity', -1) === -1 — table dispatch matches the primitive", () => {
  assert.strictEqual(activate("identity", -1), -1)
  assert.strictEqual(activate("identity", -1), identity(-1))
})

test("activate('sigmoid', 0) === 0.5 — table dispatch matches the primitive", () => {
  assert.strictEqual(activate("sigmoid", 0), 0.5)
  assert.strictEqual(activate("sigmoid", 0), sigmoid(0))
})

test("activationDerivativeFromOut routes to the same per-name derivative as the direct primitive", () => {
  assert.strictEqual(activationDerivativeFromOut("sigmoid", 0.5), 0.25)
  assert.strictEqual(activationDerivativeFromOut("identity", 42), 1)
  assert.strictEqual(activationDerivativeFromOut("relu", 0), 0)
  assert.strictEqual(activationDerivativeFromOut("relu", 1), 1)
})
