/**
 * v0.3 activation library — sigmoid, identity, relu primitives + their
 * derivatives-from-output.
 *
 * Each activation ships two functions:
 *   - `<name>(x)`: forward — takes a pre-activation net and returns the post-
 *     activation output.
 *   - `<name>DerivativeFromOut(out)`: backward — takes the post-activation
 *     output and returns the derivative of the activation at the corresponding
 *     net. Derivative-from-output is the canonical form used by the engine
 *     because the post-activation output is already memoized in the forward
 *     pass; recomputing the derivative from `out` avoids re-evaluating any
 *     transcendental (Math.exp for sigmoid, comparison for relu, constant
 *     for identity).
 *
 * Plus two table-driven dispatch helpers (`activate`, `activationDerivative
 * FromOut`) that route by name. The general engine consumes these so a
 * topology's activation choice is data, not control flow at the engine
 * level.
 *
 * ReLU subgradient choice: at x === 0 the ReLU is non-differentiable. The
 * canonical ML convention (PyTorch, TensorFlow, JAX) selects the subgradient
 * 0 at x === 0 — equivalently, the derivative is 1 iff out > 0. This module
 * follows that convention. Choosing 0 (rather than 1 or NaN) also avoids
 * propagating spurious gradient through dead units, which matters in
 * sigmoid-driven topologies where post-activation outputs can equal 0
 * after upstream saturation.
 *
 * Identity derivative is exactly 1 for all inputs. Sigmoid derivative-from-
 * out is the textbook `out * (1 - out)` form Mazur uses in his published
 * derivation.
 *
 * Numeric determinism: identity and relu are bitwise exact (no transcendental).
 * Sigmoid inherits the Math.exp implementation-defined precision caveat
 * documented in src/engine.ts; see docs/canonical-emission.md for the V8/
 * Node 22 binary64 pinning policy.
 */

export type ActivationName = "sigmoid" | "identity" | "relu";

/**
 * Sigmoid activation: `1 / (1 + e^{-x})`.
 *
 * Single-branch form; valid input range is approximately `[-700, 700]`
 * (Math.exp(709) ≈ MAX_VALUE, Math.exp(710) === Infinity). Outside this
 * range the result saturates silently to 0 or 1. A two-branch numerically
 * stable variant is deferred to v0.4+.
 */
export function sigmoid(x: number): number {
  return 1 / (1 + Math.exp(-x));
}

/**
 * Sigmoid derivative computed from the already-known output.
 *
 * If `out = sigmoid(net)`, then `sigmoid'(net) = out * (1 - out)`. This
 * avoids recomputing `Math.exp(-net)` and pins the engine to the same
 * derivative shape Mazur uses in his published derivation. NaN-propagating.
 */
export function sigmoidDerivativeFromOut(out: number): number {
  return out * (1 - out);
}

/**
 * Identity activation: `f(x) = x`. Used for linear output layers.
 */
export function identity(x: number): number {
  return x;
}

/**
 * Identity derivative-from-output: always 1. The `_out` parameter is
 * unused but kept in the signature so the activation table can dispatch
 * uniformly.
 */
export function identityDerivativeFromOut(_out: number): number {
  return 1;
}

/**
 * ReLU activation: `f(x) = max(0, x)`. The strict comparison `x > 0`
 * (rather than `x >= 0`) is irrelevant for the forward pass — both
 * branches return 0 at x === 0 — but lets us write the derivative
 * mirror as `out > 0 ? 1 : 0` and keep the subgradient choice (0 at
 * x === 0) self-consistent.
 */
export function relu(x: number): number {
  return x > 0 ? x : 0;
}

/**
 * ReLU derivative computed from the already-known output.
 *
 * Subgradient choice: at the kink (x === 0, out === 0) the function is
 * non-differentiable. This implementation selects the subgradient 0
 * (the canonical PyTorch/TensorFlow/JAX choice) — equivalently the
 * derivative is 1 iff `out > 0`. The choice avoids NaN propagation
 * through 0 * 0 and prevents spurious gradient flow through dead units.
 *
 * Note that for ReLU, `out > 0` iff the upstream `x > 0` (since out is
 * either x or 0), so computing the derivative from `out` is exact —
 * no information is lost vs computing it from `x` directly.
 */
export function reluDerivativeFromOut(out: number): number {
  return out > 0 ? 1 : 0;
}

/**
 * Dispatch a forward activation by name. The general engine uses this
 * so the topology's `activation_hidden` / `activation_output` choice is
 * data, not engine-level control flow.
 *
 * Adding a new activation: extend `ActivationName`, add the forward +
 * derivative-from-out functions, and add cases here and in
 * `activationDerivativeFromOut`. The `case`-exhaustive switch will fail
 * to compile if either dispatcher misses a name.
 */
export function activate(name: ActivationName, x: number): number {
  switch (name) {
    case "sigmoid":
      return sigmoid(x);
    case "identity":
      return identity(x);
    case "relu":
      return relu(x);
  }
}

/**
 * Dispatch the activation derivative-from-output by name. Mirrors
 * `activate` — see that function's JSDoc for the extension protocol.
 */
export function activationDerivativeFromOut(name: ActivationName, out: number): number {
  switch (name) {
    case "sigmoid":
      return sigmoidDerivativeFromOut(out);
    case "identity":
      return identityDerivativeFromOut(out);
    case "relu":
      return reluDerivativeFromOut(out);
  }
}
