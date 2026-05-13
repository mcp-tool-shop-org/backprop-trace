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

## Position in the law stack

> Contract precedes engine. Formatter policy precedes runtime formatting.
> Bad receipts precede good receipts. Runtime formatting precedes Mazur.
> Mazur precedes diagnostics.

Computation order lives inside the contract layer. The schema declares
`product_order` and `summation_order` as required fields; this doc
specifies what those values mean. The engine implements them; the
reconciler verifies them.
