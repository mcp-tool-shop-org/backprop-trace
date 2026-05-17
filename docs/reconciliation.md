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

## Quick reference: the 13 rules (+ Rule 0.8 structural sub-check)

| # | Rule | Status |
|---|------|--------|
| 0.8 | Softmax probability bounds: when `topology.activation_output === "softmax"`, every `forward[output].out` MUST be in `[0, 1]` (Rule 0 sub-check; failure record uses `rule: 0` with "Rule 0.8" in message) | **implemented (v0.5)** |
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
| 11 | Softmax normalization (`sum(forward[output].out) == 1.0` when `topology.activation_output === "softmax"`) | **implemented (v0.5)** |
| 12 | Loss formula consistency (`loss.per_output[u]` and `loss.total` match `topology.loss` formula) | **implemented** — half_squared_error (v0.4.2) + cross_entropy_softmax (v0.5) |
| 13 | Softmax+CE collapsed↔Jacobian dual-form agreement (13a per-term mult, 13b summation, 13c collapsed-vs-dual); **GATED** — fires only when `OutputErrorSignal.dual_form` is present | **implemented (v0.5)** |

Rules 1-8 ship in v0.2.0. Rules 9 + 10 ship in v0.3.0 and fire from the
multi-record verify path (`bp verify multi <file.jsonl>` /
`reconcileMultiStep(receipts)`), NOT from the single-record path. Rule 12
ships in v0.4.2 as the loss-formula trust-gap closer — pre-v0.4.2, `loss.total`
was schema-validated but never math-checked, so a corrupted `loss.total` would
silently pass `reconcileReceipt`. **v0.5** lands the softmax + cross-entropy
wave: Rule 0.8 (probability bounds, a Rule 0 sub-check), Rule 11 (softmax
normalization), Rule 12's `cross_entropy_softmax` branch, and Rule 13 (gated
dual-form consistency with three sub-checks). Rule 13 is GATED — it fires
only when the receipt carries an `OutputErrorSignal.dual_form` block; the
engine emits dual_form for every softmax+CE receipt, but receipts authored
from PyTorch / JAX / other frameworks may omit it and Rule 13 silently
skips. This is the v0.5 consolidator's Q1 decision locked into the
reconciler. Each shipped rule landed with a deliberately-broken bad-*
fixture per the anti-circularity doctrine — bad receipts precede good
receipts (Csmith / CompCert lineage; see "Academic lineage" below and
`CONTRIBUTING.md`).

v0.5 ships **eight new bad fixtures**: `fixtures/bad/softmax-ce.bad-{prob-bound,
softmax-sum, ce-per-output, ce-total, dual-term, dual-sum, collapsed-vs-dual}.jsonl`
covering Rules 0.8 / 11 / 12 (CE) / 13 (three sub-checks). Rules 9 + 10 ship
with `fixtures/bad/multi-step.bad-{chain,trace-id}.jsonl` respectively.

### v0.5 — Rule 0.8 (softmax probability bounds)

When `topology.activation_output === "softmax"`, each output unit's
`forward[u].out` is a probability and must satisfy `0 <= out <= 1` within
the receipt's atol slack. The check fires inside `checkRule0Structural`
(Phase 0) and SHORT-CIRCUITS the numeric rules — a Rule 0.8 violation
returns from `reconcileReceipt` before Rules 1-13 get a chance to also
fail. This keeps diagnostics focused: a corrupted probability is reported
as a structural impossibility, not as a downstream cascade of math
failures.

The failure record uses `rule: 0` (the structural sentinel) with the
message naming `"Rule 0.8 (probability bounds)"` so the doctrine ratchet
test (which scans integer rule numbers) continues to work unchanged. The
bad fixture `fixtures/bad/softmax-ce.bad-prob-bound.jsonl` mutates
`forward.o1.out` to `-0.01` to exercise this path.

### v0.5 — Rule 11 (softmax normalization)

When `topology.activation_output === "softmax"`,
`sum(forward[output_unit].out)` MUST equal `1.0` within
`numeric_policy.tolerance`. The sum is computed left-to-right in
`topology.unit_order.output` order so the floating-point sum is
deterministic across reproductions.

Independent of Rule 0.8: a receipt could pass 0.8 (every value in [0,1])
while failing 11 (one value uniformly shrunk to make sum 0.99) and vice
versa (`-0.5` paired with `1.5` sums to 1 but violates 0.8). The
softmax+CE v0.5 numeric policy uses `{atol: 1e-11, rtol: 1e-7}` — softmax
outputs sum to 1.0 within roughly 1-2 ULP, well under the tolerance.

The bad fixture `fixtures/bad/softmax-ce.bad-softmax-sum.jsonl` mutates
`forward.o2.out` by `+0.1` to make the sum ~1.1.

### v0.5 — Rule 12 cross_entropy_softmax branch

For receipts that declare `topology.loss === "cross_entropy_softmax"`:

```
loss.per_output[u] == (y_u == 0 ? 0 : -y_u * log(p_u))
loss.total         == sum_u loss.per_output[u]
```

The `y_u === 0` short-circuit is mathematically faithful (the limit
`y * log(p) → 0` as `y → 0` holds at any `p`, including `p === 0`) AND
defensive against the `-0 * log(0) = NaN` JavaScript footgun. The engine
applies the same short-circuit when emitting; the reconciler mirrors it
exactly so a valid receipt with one-hot targets and any softmax
distribution passes cleanly.

The bad fixtures `fixtures/bad/softmax-ce.bad-ce-per-output.jsonl` and
`fixtures/bad/softmax-ce.bad-ce-total.jsonl` mutate the two checked
fields independently — Rule 12's per_output and total checks fire
independently (the total is reconstructed from `forward + targets`, not
from `loss.per_output`).

### v0.5 — Rule 13 (gated dual-form consistency)

When `backward.output_error_signals[u].dual_form` is present, Rule 13
fires three sub-checks:

**13a — per-term multiplication**: each `jacobian_terms[j].term_value`
equals the left-to-right product of `jacobian_terms[j].factors`. The
engine emits two factors per term: `y_j` (target value) and
`delta_ju_minus_p_u` (the Kronecker delta minus the current unit's
probability). Their product is `y_j * (delta_ju - p_u)`.

**13b — summation**: `dual_form.summed_value` equals the sum of
`jacobian_terms[*].term_value`, summed left-to-right in
`dual_form.summation_order` order.

**13c — collapsed-vs-dual**: `dual_form.summed_value` equals
`OutputErrorSignal.signal_value` (the collapsed `y_u - p_u` form). This
is the load-bearing cross-form check — if both the collapsed factor and
the expanded Jacobian decomposition are emitted, they MUST agree at the
sum level. A disagreement means either the collapsed factor lied or the
dual decomposition is wrong.

**GATED behavior**: Rule 13 silently skips when `dual_form` is absent.
Mazur / XOR / iris / per-neuron-bias receipts have no dual_form and pass
Rule 13 cleanly. The v0.5 consolidator locked this as Q1 = GATED (not
mandatory) so receipts authored from other frameworks can omit dual_form
without tripping the reconciler. Q2 = NO engine auto-synthesis: the
engine emits dual_form when it generates softmax+CE receipts itself, but
does NOT back-fill dual_form on receipts that lack it.

The bad fixtures
`fixtures/bad/softmax-ce.bad-{dual-term,dual-sum,collapsed-vs-dual}.jsonl`
exercise the three sub-checks independently. The collapsed-vs-dual fixture
is the most surgical: it mutates the dual_form self-consistently (terms
still multiply correctly, sum still matches summed_value) so ONLY 13c
fires — proving the cross-form check has independent diagnostic power.

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
  Checks Rules 0/0.8/1-8/11/12/13 per the receipt's topology declaration.
  Single-record; multi-step rules 9/10 do not fire here.
  Exit 0 if all rules pass within tolerance.
  Exit nonzero with stderr describing failures otherwise.

bp verify mazur [<file>]
  Full Mazur (v0.1.0) gate. Runs schema validation + reconciliation +
  byte equality vs golden + fixture_status + published-anchor drift.
  Defaults to fixtures/mazur.golden.jsonl when <file> is omitted.

bp verify general <file>
  Generalized verify gate. Runs schema validation + reconciliation +
  engine-reproduction via runGeneralStep. Targets v0.2.0+ receipts (XOR,
  iris, per-neuron-bias, softmax+CE, custom topologies). A v0.1.0 Mazur
  receipt fed here exits 1 with a "use bp verify mazur" redirect — the
  general engine requires unit_order + parameter_order that v0.1 receipts
  don't carry.

bp verify multi <file.jsonl>
  Multi-record verifier. Runs per-record Rules 1-8/11/12/13 plus the
  cross-step Rules 9 (parameter chain) and 10 (trace identity + sequential
  step_index). Reads N JSONL records ordered by step_index 0..N-1, sharing
  a single trace_id.
```

### v0.5 — softmax+CE worked example (engine + CLI)

```bash
# Generate the canonical softmax+CE 2-2-3 first-run receipt (engine emits
# schema_version: "0.3.0", including the dual_form Jacobian decomposition).
node --import tsx -e "
  import { runGeneralStep, emitGeneralReceipt, SOFTMAX_CE_INPUT }
    from '@mcptoolshop/backprop-trace';
  process.stdout.write(emitGeneralReceipt(runGeneralStep(SOFTMAX_CE_INPUT)));
" > receipts/softmax-ce.jsonl

# Schema-validate against v0.3.0 (validator auto-dispatches based on
# the receipt's declared schema_version field):
bp validate receipt receipts/softmax-ce.jsonl

# Reconcile — runs Rule 0.8 (probability bounds), Rule 11 (softmax
# normalization), Rule 12 cross_entropy_softmax branch, and Rule 13
# (gated dual-form, fires because dual_form is present):
bp reconcile receipt receipts/softmax-ce.jsonl

# Full verify gate (schema + reconcile + engine-reproduce byte-equal):
bp verify general receipts/softmax-ce.jsonl
```

For receipts that do NOT carry `dual_form` (e.g., a PyTorch / JAX trace
re-formatted as a backprop-trace receipt), Rule 13 silently skips — the
reconciler still verifies Rules 0.8 / 11 / 12 against the collapsed
factors and probability outputs. This is the GATED behavior locked in
the v0.5 consolidator decision: opt into dual-form verification by
emitting `dual_form`; otherwise the collapsed form `factors=[{name:"target_minus_probability", value: y-p}]` + `signal_value=y-p` is sufficient
for the reconciler to certify the math.

The reconciler is testable in isolation before any engine code exists,
using `fixtures/bad/mazur.bad-gradient.jsonl` as input. Implements the
**bad receipts precede good receipts** clause of the law stack:

> Contract precedes engine. Formatter policy precedes runtime formatting.
> Bad receipts precede good receipts. Runtime formatting precedes Mazur.
> Mazur precedes diagnostics.
