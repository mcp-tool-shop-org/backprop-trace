# Computation Order

Floating-point arithmetic is not associative. `(a + b) + c` may differ
from `a + (b + c)` at the last bit, and `a * b * c` evaluated as
`(a * b) * c` may differ from `a * (b * c)`. For byte-equality testing
to work across implementations, the order of operations must be
specified.

This doc pins the order. The reconciler and the engine both follow it.
Receipts carry order metadata (`product_order`, `summation_order`) so
the relationship is auditable, not assumed.

## Factor multiplication

For any `factors: NamedFactor[]` array, multiplication proceeds **left to
right**, operand by operand:

```
result = factors[0].value
for i in 1 .. n-1:
  result = result * factors[i].value
```

Receipt fields that declare `product_order: "left_to_right"` express
this ordering. `product_order` is required on every factor-product
computation in the schema. `"left_to_right"` is the only permitted
value in v0.1.

The order matters for IEEE-754 double-precision arithmetic when the
operands' magnitudes differ enough that intermediate rounding shifts.
For the Mazur fixture the operand magnitudes are within 2 orders, so
the ordering rarely shifts the result at 9 sig figs — but the rule is
mandatory regardless. Cross-implementation portability depends on it.

## Downstream contribution summation

For `backward.hidden_error_signals.<unit>.downstream_contributions`,
summation proceeds in the order declared by `summation_order`:

```
result = 0.0
for key in summation_order:
  contribution = find(downstream_contributions, where from == key)
  result = result + contribution.value
```

In v0.1 the only `summation_order` is `["o1", "o2"]` — output unit ids
in lexical order. v0.2+ may introduce other orderings for larger output
layers; the order will still be declared in the receipt, not implicit.

## Multi-step compound expressions

When a single value is computed via a multi-step formula
(e.g., `hidden_error_signal.signal_value = backpropagated_sum * activation_derivative`,
where `backpropagated_sum` is itself a sum), the order is:

1. Compute each intermediate following its declared order.
2. Multiply intermediates following the parent `product_order`.

The receipt makes intermediates explicit so the reconciler doesn't have
to infer ordering. Every intermediate has a stored value; the reconciler
checks both the intermediate (against its own factors) and its use as
an input to the next step.

This is the structural lever against silent fabrication: every numerical
claim has a stored decomposition that the reconciler walks.

## Subtraction and addition

Subtraction is `a - b = a + (-b)` with `-b` applied as a unary sign
flip. The sign flip is exact in IEEE-754 (no precision loss).

For two-operand addition, the order is trivially fixed. For
multi-operand summations, see `summation_order` above.

For weight progression (`weight_after = weight_before + update`), the
two operands are added in declared order: `weight_before` first, then
`update`. Operationally this is one IEEE-754 addition; the order is
named for completeness, not because two-operand addition has order
ambiguity.

## Parser semantics

JSON parsers conforming to ECMA-404 + IEEE-754 round-to-nearest produce
the same double for any decimal string. The reconciler reads receipt
values via `JSON.parse` and operates on the resulting doubles.

Implications:

- Decimal strings that are exactly representable in double precision
  (e.g., `0.5`, `0.25`, `1.0`) round-trip losslessly.
- Decimal strings that are not exactly representable (e.g., `0.1`,
  `0.05`, `0.593269992`) parse to the nearest representable double, and
  the reconciler operates on that double.
- All conforming parsers agree on which double corresponds to a given
  decimal string (this is the round-to-nearest, ties-to-even rule baked
  into IEEE-754).

For tie-sensitive comparisons (when a result lands exactly between two
representable values), the choice of double parser can affect the
rounding decision by 1 ULP. The formatter policy fixture
(`fixtures/formatter.policy.golden.json`) sidesteps this by using
decimal-string inputs and a separate decimal-arithmetic formatter
(`formatDecimalStringForFixture`). The runtime formatter
(`formatNumberForEngine`) operates on doubles and may diverge from
policy by 1 ULP on tie cases. The runtime fixture
(`fixtures/templates/formatter.runtime-node.template.json` → generated
golden in v0.2+) documents this empirically.

## FMA prohibited

Fused multiply-add (`fma(a, b, c) = a * b + c` as a single rounded
operation) is **not permitted** in the engine or reconciler for v0.1.

Reason: FMA produces results that can differ from
`(a * b) + c` (two separately rounded operations) by 1 ULP. Allowing
FMA would make byte equality dependent on whether the runtime emitted
an FMA instruction or two separate operations, which depends on
compiler flags, CPU capability, and language runtime — none of which
are part of the receipt contract.

JavaScript / V8 does not expose FMA directly; the standard
multiply-and-add pattern in source code produces separate operations.
TypeScript via Node does not emit FMA. So this prohibition is a future
guard, not an immediate constraint for the v0.1 engine.

Any future port to a language with explicit `Math.fma` or compiler
auto-FMA must include the FMA-disable flag in its build doc.

## Tolerance

All comparisons in reconciliation use `numeric_policy.tolerance` (1e-9
in v0.1). The tolerance is symmetric:

```
|stored - recomputed| <= tolerance
```

passes; strictly greater fails.

Tolerance applies to value comparisons, not to bit patterns. Two
doubles that differ by 1 ULP near a magnitude of 1.0 differ by
approximately 2.2e-16, well within tolerance. Two doubles that differ
by 1 ULP near a magnitude of 1.0e+10 differ by approximately 1.9e-6 —
outside the 1e-9 tolerance for that magnitude.

For v0.1 the Mazur fixture's magnitudes are bounded in
[-1, 1.5] roughly; the chosen tolerance is comfortable.

For v0.2+ scenarios with larger magnitudes, tolerance may need to scale
with operand magnitude (ULP-aware tolerance). v0.1 uses absolute
tolerance only and explicitly does not handle large-magnitude
comparisons.

## What this doc does NOT cover

- The order in which the engine processes the network (forward pass
  order, backward pass order). That's left to the engine; the receipt
  records the results, not the traversal.
- Cross-platform arithmetic determinism beyond IEEE-754 conformance.
  v0.1 assumes a conforming runtime. v0.2+ may add additional pinning
  for runtimes that diverge.
- The internal representation of intermediates inside the engine. The
  engine may use any precision internally as long as the final stored
  values match the receipt at 9 sig figs under
  `numeric_policy.rounding`.

## Hybrid tolerance (v0.3+)

v0.3 generalizes the v0.1/v0.2 pure-atol comparator into a hybrid
tolerance form that combines absolute and relative slack in a single
symmetric expression:

```
|a - b| <= max(atol, rtol * max(|a|, |b|))
```

Defaults: `atol = 1e-12`, `rtol = 1e-9`. The reconciler invokes this via
`applyToleranceCheck(a, b, policy)`; the underlying primitive,
`normalizeTolerance(policy)`, accepts either an object `{atol, rtol}` or
a scalar number (legacy v0.1 / v0.2 sugar — treated as `{atol: X, rtol:
0}`).

**Symmetric max form rationale.** The formula

```
|a - b| <= max(atol, rtol * max(|a|, |b|))
```

bounds the comparison by the LARGER of an absolute floor and a relative
ceiling scaled by the larger operand magnitude. Compared to the strict
"sum" form `atol + rtol * |b|` (numpy.allclose, PyTorch
torch.testing.assert_close), the max form:

- treats `(a, b)` and `(b, a)` identically (true symmetry — the
  inequality holds regardless of operand order);
- collapses to pure-atol behavior when `rtol = 0` (so v0.1 receipts
  reconcile bit-identically against the v0.3 reconciler);
- scales with the LARGER magnitude in the pair, not a chosen reference,
  which matches the auditor's intuition that the rule is about how close
  the two values are, not about which one is "right";
- avoids the asymmetric weighting bias documented in floating-point-gui.de
  ("Comparing Floating Point Numbers, 2012 Edition", Bruce Dawson —
  https://randomascii.wordpress.com/2012/02/25/comparing-floating-point-numbers-2012-edition/)
  and in Boost.Test's FPC_STRONG fixture
  (https://www.boost.org/doc/libs/release/libs/test/doc/html/boost_test/testing_tools/extended_comparison/floating_point/floating_points_comparison_theory.html).

**Why `atol = 1e-12` and `rtol = 1e-9`.** The defaults absorb the
~3e-9 product drift on Mazur w6 / w8 previously documented in
`fixtures/bad/mazur.bad-gradient.meta.json` — the v0.1 reconciler
required a precision-normalization workaround because the pure-atol
1e-9 comparator was tight against the v0.1 multiplication ordering.
The v0.3 defaults remove the need for that workaround without weakening
the per-rule contract: the rtol envelope is wide enough to cover
binary64 product accumulation at receipt scale, and the atol floor of
1e-12 still catches "values almost-zero but disagreeing" cases.

**Backward compat.** A receipt that declares the legacy scalar form
`numeric_policy.tolerance: 1e-9` is still valid against the v0.2.0
schema (the `tolerance` field is `oneOf` an object or a scalar number).
The reconciler reads the scalar as `{atol: 1e-9, rtol: 0}` and the
comparator reduces to `|a - b| <= 1e-9` — bit-identical to v0.1 / v0.2
semantics. Mazur receipts in `fixtures/mazur.golden.jsonl` continue to
ship the scalar form; XOR and iris receipts emitted by `runGeneralStep`
ship the object form with the v0.3 defaults.

**Per-rule overrides** are reserved for v0.3.x — v0.3.0 uses the single
top-level `numeric_policy.tolerance` for every rule.

## Position in the law stack

> Contract precedes engine. Formatter policy precedes runtime formatting.
> Bad receipts precede good receipts. Runtime formatting precedes Mazur.
> Mazur precedes diagnostics.

Computation order lives inside the contract layer. The schema declares
`product_order` and `summation_order` as required fields; this doc
specifies what those values mean. The engine implements them; the
reconciler verifies them.

## Determinism boundary (v0.4+)

Computation order pins WHAT the engine multiplies and sums and in what
sequence. The determinism boundary pins WHERE that contract holds and
where it does NOT. They are complementary: the in-engine ordering rules
above are necessary but not sufficient for byte equality across
environments — the substrate has to cooperate.

### What's contractual

- Byte-equal `post_update_loss.total` on the pinned Node 22 ×
  {ubuntu, macos, windows} matrix
- Mazur 2-2-2 golden fixture: `0.29102777369359933`
- Per-rule reconciliation passes via the hybrid tolerance contract
  documented above

### What's NOT contractual

- Cross-engine (Bun, Deno, browsers) — different math implementations
- Cross-Node-major (24.x, 26.x, ...) — V8 fdlibm may be re-ported
- Arbitrary V8 minor bumps — ECMA-262 §21.3 leaves `Math.exp`
  precision implementation-defined
  (https://tc39.es/ecma262/#sec-math.exp)
- Bit-stability of values that flow through `Math.exp` (sigmoid, tanh,
  softmax) across V8 versions

A `Math.exp(-0.5)` canary test fires on the CI matrix as an
early-warning siren if V8's fdlibm port drifts within 22.x. The test
pins observed constants; a failure means "investigate V8 changelog,"
not "engine bug." The v0.4 CI matrix adds one explicit
`node-version: '22.11.0'` cell alongside the existing `22.x` cells so
the canary observes both a moving target (`22.x`) and a fixed
reference (`22.11.0`) on every run.

### Out of scope for v0.4

- Custom `Math.exp` (polynomial / lookup table) — would make
  backprop-trace authoritative over math semantics, not just
  observation; the verifier loses neutrality
- Decimal arithmetic (Decimal128 / decimal.js) — would fork the engine
  into two semantics (binary64 vs decimal) and the receipt's
  `number_encoding: "decimal"` claim already covers the formatter
  output without dragging arithmetic to a different substrate
- Bun/Deno/browser CI cells — guaranteed byte-equal breakage on first
  run; adding cells that are expected to fail erodes the value of the
  ones that pass

The v0.4 study-swarm consolidator-decision.md (Agent E's path) makes
these defers explicit: "v0.4 must NOT be a determinism wave — would
force the verifier into thesis-changing territory like polynomial
Math.exp or decimal.js." The CI canary is the smallest move that gives
the engine an early-warning siren for the substrate's actual behavior
without claiming engineering control over what the substrate does.

Cross-reference: README's "Determinism boundary" section mirrors this
content for users who never open the doc directory. The two are
load-bearing for the same contract; if one drifts from the other,
update both.
