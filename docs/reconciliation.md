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

## Quick reference: the 10 rules

| # | Rule | Status |
|---|------|--------|
| 1 | Output error signal == product(factors) | **implemented (v0.2)** |
| 2 | Backpropagated sum == sum(downstream contributions) AND contribution.value == downstream_signal * weight_value | **implemented (v0.2)** |
| 3 | Hidden error signal == backprop_sum * activation_derivative | **implemented (v0.2)** |
| 4 | Update gradient == product(optimizer.factors) | **implemented (v0.1)** |
| 5 | Update value == learning_rate * gradient | **implemented (v0.2)** |
| 6 | Weight progression: weight_after == weight_before + update | **implemented (v0.2)** |
| 7 | Parameter final state consistency | **implemented (v0.2)** |
| 8 | Provenance reference (factor.from path) | **implemented (v0.2)** |
| 9 | Multi-step parameter chain (`parameters_before[N]` equals prior `parameters_after[N-1]`) | **implemented (v0.3)** |
| 10 | Multi-step trace identity (shared `trace_id` + sequential `step_index`) | **implemented (v0.3)** |

Rules 1-8 ship in v0.2.0. Rules 9 + 10 ship in v0.3.0 and fire from the
multi-record verify path (`bp verify multi <file.jsonl>` /
`reconcileMultiStep(receipts)`), NOT from the single-record path. Each
rule landed with a deliberately-broken bad-* fixture per the
anti-circularity doctrine — bad receipts precede good receipts (Csmith /
CompCert lineage; see "Academic lineage" below and `CONTRIBUTING.md`).
Rules 9 + 10 ship with `fixtures/bad/multi-step.bad-chain.jsonl` and
`fixtures/bad/multi-step.bad-trace-id.jsonl` respectively.

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

### Rule 9: Multi-step parameter chain

For a multi-record JSONL file containing `N >= 2` receipts in
`step_index` order, every receipt at `step_index = K` (K > 0) MUST
satisfy:

```
receipt[K].parameters_before[id] == receipt[K-1].parameters_after[id]
```

for every `id` in `receipt[K].parameter_order`, within
`receipt[K].numeric_policy.tolerance` (hybrid-form). Single-step
receipts (`step_index = 0` or absent) skip Rule 9.

Mirrors the Proof-of-Learning (Jia et al. IEEE S&P 2021,
https://ar5iv.labs.arxiv.org/html/2103.05633) parameter-chain integrity
pattern: chain integrity is parameter-equality across step boundaries,
not a separate Merkle digest. The chain stays auditable from the
receipts alone — no out-of-band ledger required.

### Rule 10: Multi-step trace identity

For a multi-record JSONL file, every receipt MUST share an identical
`trace_id` (128-bit lowercase hex per W3C TraceContext,
https://www.w3.org/TR/trace-context/) AND the `step_index` values MUST
form a monotonic, dense, 0-based sequence (0, 1, 2, ..., N-1). Catches
accidental cross-run concatenation — a verifier that sees two distinct
`trace_id`s in one file reports a Rule 10 failure before evaluating
parameter chain integrity.

Single-step receipts (no `trace_id` / no `step_index`) bypass Rule 10
entirely.

## Multi-step receipts

Rules 9 + 10 fire only on the multi-record verify path. The split is
intentional: per-record reconciliation (Rules 1-8) stays self-contained
and is consumable by tools that stream individual receipts (`bp verify
mazur`, `bp verify general`, library callers using `reconcileReceipt()`).
The multi-record path adds two cross-record rules without changing how
single-record reconciliation works.

**Two-phase verification model**:

1. **Per-record pass.** For each receipt in the file, the reconciler runs
   the standard 8-rule pass. Any per-record failure surfaces immediately
   with the same field-path / stored / recomputed / delta / tolerance
   quartet as `bp reconcile receipt`.
2. **Cross-record pass.** Once per-record reconciliation completes, Rule
   10 (trace identity) fires first — a mismatched `trace_id` set or a
   non-dense `step_index` sequence aborts before Rule 9 runs (a chain
   spanning two distinct traces wouldn't have a meaningful prior-receipt
   anchor). If Rule 10 passes, Rule 9 (parameter chain) fires across
   adjacent receipts in `step_index` order.

**trace_id is 128-bit hex.** v0.3 adopts the W3C TraceContext
(https://www.w3.org/TR/trace-context/) `trace-id` shape: a lowercase
hex string of exactly 32 characters. The schema enforces
`pattern: "^[0-9a-f]{32}$"`. Receipt emitters generate the id once at
training-run start and reuse it across every step receipt.

**step_index is 0-based, monotonic, dense.** Sparse sequences (e.g.,
`[0, 1, 3]`) fail Rule 10 — the receipt set must record every step,
not just every Nth step. A 5-step training run produces 5 receipts with
`step_index` values 0, 1, 2, 3, 4.

**Single-step receipts are still valid.** Receipts emitted without
`trace_id` and `step_index` skip Rules 9 and 10 cleanly — those rules
have no work to do on a single-record file. The XOR and iris fixtures
shipped with v0.3 are single-step and exercise Rules 1-8 only. The
v0.2.0 schema's `allOf` constraint enforces "trace_id present iff
step_index present" so a receipt cannot carry one without the other.

**Entry points**: `bp verify multi <file.jsonl>` from the CLI;
`reconcileMultiStep(receipts: unknown[])` from the library (returns
the same `ReconciliationResult` shape as `reconcileReceipt`).

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

## Academic lineage

The "bad receipts precede good receipts" doctrine has direct precedent in
compiler testing. Csmith (Yang, Chen, Eide, Regehr, PLDI 2011 —
https://users.cs.utah.edu/~regehr/papers/pldi11-preprint.pdf) demonstrated
that adversarial corpus generation is the strongest test of a verifier:
"Csmith found bugs in every compiler we tested except for the proven parts
of CompCert" (Leroy, CACM 2009 —
https://xavierleroy.org/publi/compcert-CACM.pdf). The anti-circularity
ratchet — rule detection must precede lifecycle-metadata read — is the
in-domain equivalent of "the verifier may not consult the test oracle's
metadata." `mazur.bad-gradient.jsonl` is to the reconciler what Csmith's
generated adversarial inputs are to a C compiler.

## Reporting format

Successful reconciliation produces no stderr output and exits with code 0.

Failed reconciliation produces stderr of approximately the following form
and exits with code nonzero.

The example below illustrates the format when multiple rules are
wired and cascades become observable — v0.2 ships all eight rules, so
multi-rule output is the common case. Rule numbers other than the
originating failure carry a `Note: cascades from Rule N` line.

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

The exact body format is not prescribed. The **load-bearing**
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
