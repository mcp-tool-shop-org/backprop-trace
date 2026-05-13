# Reconciliation Rules

The reconciler validates that a receipt's math is internally consistent.

Reconciliation is **independent of**:

- Byte equality (whether the receipt's text bytes match a committed golden).
- Fixture lifecycle (whether the receipt is a draft or a promoted golden).
- Schema validity (a separate pass before reconciliation handles this).
- External anchors (published-value drift checks happen in `bp verify mazur`,
  not in `bp reconcile receipt`).

Reconciliation answers one question: **does the math the receipt claims
to have done actually add up?**

If the answer is "no," the reconciler refuses to certify the receipt and
the verifier fails closed.

## The eight rules

All comparisons use `numeric_policy.tolerance` (1e-9 in v0.1). All
multiplications follow declared `product_order`. All summations follow
declared `summation_order`. See `docs/computation-order.md` for arithmetic
ordering details.

### Rule 1: Output error signal consistency

For each unit `o` in `backward.output_error_signals`:

```
signal_value == product(factors[].value, in product_order)
```

within tolerance.

Factor `name` fields are labels (not validated by Rule 1). Only the
numeric product is checked. Provenance is checked separately by Rule 8.

### Rule 2: Downstream contribution and backpropagated sum

For each unit `h` in `backward.hidden_error_signals`:

For each `contribution` in `downstream_contributions`:

```
contribution.value == contribution.downstream_signal * contribution.weight_value
```

within tolerance.

Then:

```
backpropagated_sum == sum(downstream_contributions[].value, in summation_order)
```

within tolerance. The `summation_order` array is the canonical order;
contributions are summed by looking up each contribution whose `from`
matches the next key in `summation_order`.

### Rule 3: Hidden error signal consistency

For each unit `h` in `backward.hidden_error_signals`:

```
signal_value == backpropagated_sum * activation_derivative
```

within tolerance. Product order: `product_order` declares `left_to_right`,
so `backpropagated_sum` is the left operand.

### Rule 4: Update gradient consistency

For each entry in `updates`:

```
update.gradient == product(optimizer.factors[].value, in optimizer.product_order)
```

within tolerance.

**This is the rule targeted by the anti-circularity fixture.**
`fixtures/bad/mazur.bad-gradient.jsonl` mutates `updates[4].gradient`
(w5) by 1e-6 (1000x tolerance) while leaving factor values unchanged.
The reconciler must detect this and name Rule 4 in stderr.

### Rule 5: Update value consistency

For each entry in `updates`:

```
update.update == optimizer.learning_rate * update.gradient
```

within tolerance.

### Rule 6: Weight progression

For each entry in `updates`:

```
update.weight_after == update.weight_before + update.update
```

within tolerance.

### Rule 7: Final state consistency

For each parameter id in `parameters_after`:

- **If the id appears in some `updates[i].parameter_id`:**
  ```
  parameters_after[id] == parameters_before[id] + updates[i].update
  ```
  within tolerance.

- **If the id does NOT appear in any update:**
  - If `bias_policy.mode == "constant"`:
    ```
    parameters_after[id] == parameters_before[id]
    ```
    exactly (zero-delta requirement; tolerance does not apply here).
  - If `bias_policy.mode != "constant"`:
    The reconciler refuses to certify. This combination
    (non-constant bias policy + parameter not in updates) is
    underdetermined in v0.1.

### Rule 8: Provenance reference consistency

For each `NamedFactor` (in `output_error_signals[*].factors`,
`hidden_error_signals[*].downstream_contributions[*]` — implicit, via
its individual fields — or `updates[*].optimizer.factors`) that carries
a `from` field:

The factor's `value` must equal the value at the path indicated by
`from`, within tolerance.

Examples:
- `"from": "forward.h1.out"` → `value == forward.h1.out`
- `"from": "backward.output_error_signals.o1.signal_value"` → `value == backward.output_error_signals.o1.signal_value`
- `"from": "inputs.i1"` → `value == inputs.i1`

Factors without a `from` field skip Rule 8 (their values are taken on
faith at the leaf; they cannot lie about provenance because they don't
claim provenance).

## Failure-priority rule

**Reconciliation failures report before fixture-lifecycle failures.**

A math error in a draft fixture must surface as a math error, not as a
"draft not promoted" error. Lifecycle status is reported only once
reconciliation passes.

Concrete consequence: `fixtures/bad/mazur.bad-gradient.jsonl` has
`fixture_status.verification_state = expected_to_fail_reconciliation`
AND `post_update_forward.status = pending_engine_first_run`. The
reconciler ignores both and reports Rule 4 first. If the verifier
reports lifecycle status before reaching the math check, the
failure-priority rule is violated and the test fails.

## Reporting format

Successful reconciliation produces no stderr output and exits with code 0.

Failed reconciliation produces stderr of approximately the following form
and exits with code nonzero:

```
reconciliation failed

Rule 4: update.gradient mismatch on w5
  stored gradient:     -0.082166041
  recomputed gradient: -0.082167041
  delta:               1.000000000e-6
  tolerance:           1.000000000e-9
  factors (product_order: left_to_right):
    output_error_signal: -0.138498562
    upstream_activation:  0.593269992

Rule 5: update.update inconsistent with update.gradient on w5
  stored update:       -0.041083520
  recomputed update:   -0.041083021
  delta:               4.990000000e-7
  tolerance:           1.000000000e-9
  Note: cascades from Rule 4. Fix Rule 4 first.
```

The exact body format is not prescribed by v0.1. The **load-bearing**
requirements are:

- `reconciliation failed` appears as a prominent marker.
- The rule number (e.g., `Rule 4`) appears.
- The affected parameter id (e.g., `w5`) appears.
- Stored value, recomputed value, delta, and tolerance appear for each
  failing rule.
- Cascading failures are labeled as cascading (so a reader can prioritize
  the root cause).

Error formatting — specifically the use of scientific notation for delta
magnitudes — is the responsibility of `src/error-format.ts`, separate
from receipt-emission formatting in `src/format.ts`. The two share no
code. Receipt emission never uses scientific notation; error formatting
may.

## What reconciliation does NOT check

- Byte equality of the receipt file against a committed golden. That's
  `bp verify mazur`, not `bp reconcile receipt`.
- Fixture lifecycle (`fixture_status.*`). Reconciliation ignores these
  fields.
- Schema validity. Run schema validation separately before reconciling.
  A receipt that fails schema validation never reaches the reconciler.
- Floating-point precision policy compliance. That's the formatter's job
  (`fixtures/formatter.policy.golden.json`).
- Math against external "true" values (e.g., Mazur's published numbers).
  Published-anchor reconciliation runs only in `bp verify mazur` against
  `fixtures/mazur.published.json`.

## Command surface

```
bp reconcile receipt <file>
  Checks the eight rules above. Math only.
  Exit 0 if all rules pass within tolerance.
  Exit nonzero with stderr describing failures otherwise.

bp verify mazur
  Full gate. Runs reconciliation + byte equality vs golden + fixture_status
  + published-anchor drift. Defined only once the engine produces a real
  golden (after promotion of the draft).
```

The reconciler is testable in isolation before any engine code exists,
using `fixtures/bad/mazur.bad-gradient.jsonl` as input. Implements the
**bad receipts precede good receipts** clause of the law stack:

> Contract precedes engine. Formatter policy precedes runtime formatting.
> Bad receipts precede good receipts. Runtime formatting precedes Mazur.
> Mazur precedes diagnostics.
